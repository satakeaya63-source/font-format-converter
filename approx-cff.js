import { inspectFont } from './font-core.js';

// CFF1 cubic outlines cannot be copied into a real TrueType glyf table. This
// separate, opt-in path fits quadratic curves with FontTools/cu2qu in Pyodide.
let runtimePromise;
const PREFIX = 'https://font-converter.local/';
const forbidden = ['CFF2', 'CBDT', 'CBLC', 'sbix', 'SVG ', 'EBDT', 'EBLC', 'fvar', 'gvar', 'HVAR', 'MVAR', 'STAT'];

export function approximateEligibility(input) {
  const info = inspectFont(input);
  if (info.format !== 'otf' || info.faces.length !== 1) throw Error('近似转换只接收单份 CFF 轮廓 OTF；请先提取字体面');
  const tables = info.faces[0].tables;
  if (!tables.has('CFF ') || forbidden.some(name => tables.has(name))) throw Error('此字体带有暂不支持的轮廓、彩色或可变信息，不能安全地近似转换');
  if (tables.has('COLR') !== tables.has('CPAL')) throw Error('彩色矢量层或调色板不完整，不能安全地近似转换');
  if (tables.has('COLR')) {
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    // ponytail: only the experimentally verified static COLR v0 path; v1 paint/variation needs its own oracle.
    if (tables.get('COLR').length < 14 || view.getUint16(tables.get('COLR').offset) !== 0 ||
        tables.get('CPAL').length < 12 || view.getUint16(tables.get('CPAL').offset) > 1)
      throw Error('目前仅支持 COLR v0 + CPAL 的静态矢量彩色字体');
  }
  if (tables.get('DSIG')?.length > 8) throw Error('此字体带数字签名，转换会使签名失效；已停止');
  if (input.length > 60 * 1024 * 1024) throw Error('近似转换的单份字体不得超过 60 MB');
  if (new DataView(input.buffer, input.byteOffset, input.byteLength).getUint16(4) > 160) throw Error('字体表数量异常');
  return info;
}

async function inflate(b64) {
  if (typeof DecompressionStream === 'undefined') throw Error('当前浏览器不支持本地字体转换引擎，请换较新的浏览器');
  const binary = atob(b64), gz = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) gz[i] = binary.charCodeAt(i);
  return new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
async function loadRuntime(progress) {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    progress('正在启动离线字体转换引擎，首次加载需要稍等…');
    const node = document.getElementById('approxRuntime');
    if (!node) throw Error('本地转换引擎缺失，请重新获取完整网页');
    let payload;
    try { payload = JSON.parse(node.textContent); }
    catch { throw Error('本地转换引擎不完整，请重新获取网页'); }
    const blobs = {};
    const mime = { mjs: 'text/javascript', js: 'text/javascript', wasm: 'application/wasm', zip: 'application/zip', json: 'application/json' };
    try {
      for (const [name, value] of Object.entries(payload)) {
        if (name.endsWith('.whl')) continue;
        blobs[name] = URL.createObjectURL(new Blob([await inflate(value)], { type: mime[name.split('.').at(-1)] || 'application/octet-stream' }));
      }
      const nativeFetch = window.fetch;
      const fetchReal = (url, options) => nativeFetch.call(window, url, options);
      window.fetch = (input, options) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        if (!url.startsWith(PREFIX)) return fetchReal(input, options);
        const name = url.slice(PREFIX.length).split('?')[0];
        return blobs[name] ? fetchReal(blobs[name]) : Promise.reject(Error('离线字体引擎缺少必需组件'));
      };
      try {
        const mod = await import(blobs['pyodide.mjs']);
        await import(blobs['pyodide.asm.js']);
        const py = await mod.loadPyodide({ indexURL: PREFIX, stdLibURL: blobs['python_stdlib.zip'], lockFileContents: await (await fetchReal(blobs['pyodide-lock.json'])).json() });
        py.FS.writeFile('/fonttools.whl', await inflate(payload['fonttools-4.56.0-py3-none-any.whl']));
        py.runPython("import sys\nsys.path.append('/fonttools.whl')\nimport fontTools");
        node.textContent = '';
        return py;
      } finally { window.fetch = nativeFetch; }
    } finally { for (const url of Object.values(blobs)) URL.revokeObjectURL(url); }
  })();
  try { return await runtimePromise; }
  catch (e) { runtimePromise = null; throw e; }
}

const SETUP = `from fontTools.ttLib import TTFont, newTable
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.boundsPen import BoundsPen
source = TTFont('/approx-input.otf', recalcBBoxes=True)
assert 'CFF ' in source and 'CFF2' not in source
source_order = source.getGlyphOrder()
source_index = {n: i for i, n in enumerate(source_order)}
source_cmap = source.getBestCmap() or {}
source_ids = {cp: source_index[n] for cp,n in source_cmap.items()}
source_tables = {tag: source.getTableData(tag) for tag in ('name','GSUB','GPOS','GDEF','BASE','COLR','CPAL') if tag in source}
source_color_layers = {}
if 'COLR' in source:
    assert 'CPAL' in source and source['COLR'].version == 0
    palette = source['CPAL']
    assert palette.palettes and all(len(p) == palette.numPaletteEntries for p in palette.palettes)
    source_color_layers = {source_index[base]: [(source_index[layer.name], layer.colorID) for layer in layers]
                           for base, layers in source['COLR'].ColorLayers.items()}
    assert all(color == 0xFFFF or color < palette.numPaletteEntries
               for layers in source_color_layers.values() for _, color in layers)
# cmap 不逐字节保留（FontTools 会按规范重新编码子表），所以按「每个子表、逐字符→字形编号」核对。
# 必须过字形序号比，getBestCmap 给的是字形名，按名字比会出假阳性。
source_ids_by_sub = {}
for table in source['cmap'].tables:
    if not hasattr(table, 'cmap'): continue
    source_ids_by_sub[(table.platformID, table.platEncID, table.format)] = {cp: source_index[n] for cp, n in table.cmap.items()}
source_vorg = source['VORG'] if 'VORG' in source else None
source_vertical = ({n: source_vorg.VOriginRecords.get(n, source_vorg.defaultVertOriginY) for n in source_order} if source_vorg else {})
source_advance = [source['hmtx'][n][0] for n in source_order]
source_vertical_advance = [source['vmtx'][n][0] for n in source_order] if 'vmtx' in source else None
source_glyphs = source.getGlyphSet()
color_ids = {gid for base, layers in source_color_layers.items() for gid in [base, *(layer for layer, _ in layers)]}
def bounds(glyph_set, name):
    pen = BoundsPen(glyph_set)
    glyph_set[name].draw(pen)
    return pen.bounds
source_color_bounds = {gid: bounds(source_glyphs, source_order[gid]) for gid in color_ids}
converted_glyf = newTable('glyf')
converted_glyf.glyphs = {}
`;
const BATCH = `for glyph_name in source_order[batch_start:batch_end]:
    pen = TTGlyphPen(source_glyphs)
    cubic_to_quad = Cu2QuPen(pen, max_err=1.0, reverse_direction=True)
    source_glyphs[glyph_name].draw(cubic_to_quad)
    converted_glyf.glyphs[glyph_name] = pen.glyph()
`;
const FINISH = `for glyph_name in source_order:
    glyph = converted_glyf.glyphs[glyph_name]
    glyph.recalcBounds(converted_glyf)
    # CFF side bearings are often zero even when the actual contour starts at x > 0.
    # TrueType glyph sets place contours using hmtx LSB; it must match xMin or
    # color layers with different offsets collapse onto the same position.
    advance, _ = source['hmtx'][glyph_name]
    source['hmtx'][glyph_name] = (advance, glyph.xMin if glyph.numberOfContours else 0)
    if source_vorg and 'vmtx' in source:
        old_advance, _ = source['vmtx'][glyph_name]
        source['vmtx'][glyph_name] = (old_advance, source_vertical[glyph_name] - (glyph.yMax if glyph.numberOfContours else 0))
source['glyf'] = converted_glyf
source['loca'] = newTable('loca')
maxp = source['maxp']
maxp.tableVersion = 0x00010000
for field in ('maxPoints','maxContours','maxCompositePoints','maxCompositeContours','maxZones','maxTwilightPoints','maxStorage','maxFunctionDefs','maxInstructionDefs','maxStackElements','maxSizeOfInstructions','maxComponentElements','maxComponentDepth'):
    setattr(maxp, field, 0)
maxp.maxZones = 1
source['head'].glyphDataFormat = 0
source.sfntVersion = '\\x00\\x01\\x00\\x00'
del source['CFF ']
if 'DSIG' in source: del source['DSIG']
if 'VORG' in source: del source['VORG']
source.save('/approx-output.ttf')
checked = TTFont('/approx-output.ttf')
assert 'glyf' in checked and 'loca' in checked and 'CFF ' not in checked
assert len(source_order) == checked['maxp'].numGlyphs
checked_order = checked.getGlyphOrder()
checked_index = {n: i for i, n in enumerate(checked_order)}
assert source_ids == {cp: checked_index[n] for cp,n in (checked.getBestCmap() or {}).items()}
for key, mapping in source_ids_by_sub.items():
    subtable = checked['cmap'].getcmap(key[0], key[1])
    assert subtable is not None and subtable.format == key[2], 'cmap 子表丢失或格式变化'
    assert mapping == {cp: checked_index[n] for cp, n in subtable.cmap.items()}, 'cmap 子表映射变化'
assert source_advance == [checked['hmtx'][n][0] for n in checked_order]
if source_vertical_advance:
    assert source_vertical_advance == [checked['vmtx'][n][0] for n in checked_order]
if source_vorg:
    for i, glyph_name in enumerate(checked_order):
        glyph = checked['glyf'][glyph_name]
        origin = (glyph.yMax if glyph.numberOfContours else 0) + checked['vmtx'][glyph_name][1]
        assert origin == source_vertical[source_order[i]], 'vertical origin changed'
for tag, original in source_tables.items():
    assert checked.getTableData(tag) == original, tag + ' changed'
if source_color_layers:
    assert 'COLR' in checked and 'CPAL' in checked
    checked_color_layers = {checked_index[base]: [(checked_index[layer.name], layer.colorID) for layer in layers]
                            for base, layers in checked['COLR'].ColorLayers.items()}
    assert checked_color_layers == source_color_layers, '彩色层的字形编号或颜色索引变化'
    checked_glyphs = checked.getGlyphSet()
    for gid, before in source_color_bounds.items():
        after = bounds(checked_glyphs, checked_order[gid])
        assert (before is None and after is None) or (before is not None and after is not None and
               all(abs(x - y) <= 2 for x, y in zip(before, after))), '彩色层轮廓位置变化'
checked.close()
source.close()
`;

export async function approximateCffToTtf(input, progress = () => {}) {
  approximateEligibility(input);
  const py = await loadRuntime(progress);
  const fs = py.FS;
  try {
    fs.writeFile('/approx-input.otf', input);
    py.runPython(SETUP);
    const count = py.runPython('len(source_order)');
    for (let start = 0; start < count; start += 512) {
      py.globals.set('batch_start', start);
      py.globals.set('batch_end', Math.min(start + 512, count));
      py.runPython(BATCH);
      progress(`正在拟合字形：${Math.min(start + 512, count)} / ${count}`);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    progress('正在写入并核对字体、字符映射和竖排信息…');
    py.runPython(FINISH);
    const output = new Uint8Array(fs.readFile('/approx-output.ttf'));
    if (inspectFont(output).format !== 'ttf') throw Error('输出不是有效的 TTF');
    return output;
  } catch (error) {
    console.error('CFF approximation failed:', error);
    throw Error('近似转换或产物核对失败，已停止导出；原始字体未修改');
  } finally {
    for (const path of ['/approx-input.otf', '/approx-output.ttf']) {
      try { fs.unlink(path); } catch { /* missing after failed conversion */ }
    }
    try { py.runPython("for k in ('source','source_order','source_index','source_cmap','source_ids','source_tables','source_color_layers','checked_color_layers','source_color_bounds','color_ids','checked_glyphs','palette','source_ids_by_sub','source_vorg','source_vertical','source_advance','source_vertical_advance','source_glyphs','converted_glyf','checked','checked_order','checked_index','subtable','key','mapping','glyph','glyph_name','pen','cubic_to_quad','metrics'): globals().pop(k, None)\nimport gc\ngc.collect()"); } catch { /* do not hide original error */ }
  }
}
