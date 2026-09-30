const MAGIC = 0xB1B0AFBA;
const LIMIT = 384 * 1024 * 1024;
const tag = (b, i) => String.fromCharCode(...b.subarray(i, i + 4));
const range = (b, i, n) => { if (!Number.isSafeInteger(i) || !Number.isSafeInteger(n) || i < 0 || n < 0 || i + n > b.length) throw Error('字体文件不完整或目录越界'); };
const bytesOf = b => b instanceof Uint8Array ? b : new Uint8Array(b);
function face(b, start, index) {
  range(b, start, 12);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const signature = v.getUint32(start);
  const kind = signature === 0x4F54544F ? 'otf' : signature === 0x00010000 || signature === 0x74727565 ? 'ttf' : null;
  if (!kind) throw Error('不是可识别的 TTF 或 OTF 字体');
  const count = v.getUint16(start + 4);
  if (!count || count > 160) throw Error('字体表数量异常');
  range(b, start + 12, count * 16);
  const tables = new Map();
  for (let i = 0; i < count; i++) {
    const at = start + 12 + i * 16;
    const name = tag(b, at);
    const offset = v.getUint32(at + 8), length = v.getUint32(at + 12);
    range(b, offset, length);
    if (tables.has(name)) throw Error(`重复的字体表 ${name}`);
    tables.set(name, { offset, length });
  }
  const required = ['head', 'hhea', 'maxp', 'hmtx', 'cmap', 'name'];
  if (kind === 'ttf') {
    if (!(tables.has('loca') && tables.has('glyf')) && !(tables.has('CBDT') && tables.has('CBLC')) && !(tables.has('EBDT') && tables.has('EBLC')) && !tables.has('sbix')) throw Error('TTF 缺少轮廓或位图字形表');
  } else if (!tables.has('CFF ') && !tables.has('CFF2')) throw Error('OTF 缺少 CFF 轮廓');
  for (const key of required) if (!tables.has(key)) throw Error(`字体缺少 ${key} 表`);
  if (tables.get('head').length < 12) throw Error('字体 head 表不完整');
  let family = '';
  const names = tables.get('name');
  if (names.length >= 6) {
    const count = v.getUint16(names.offset + 2), base = v.getUint16(names.offset + 4);
    if (count > 4096 || 6 + count * 12 > names.length) throw Error('字体名称表异常');
    for (let i = 0; i < count; i++) {
      const at = names.offset + 6 + i * 12;
      if (v.getUint16(at + 6) !== 1 || v.getUint16(at) !== 3) continue;
      const len = v.getUint16(at + 8), rel = v.getUint16(at + 10);
      if (base + rel + len > names.length || len > 256 || len % 2) continue;
      family = Array.from({ length: len / 2 }, (_, n) => String.fromCharCode(v.getUint16(names.offset + base + rel + 2 * n))).join('').trim();
      if (family) break;
    }
  }
  return { index, start, kind, family: family || `字体面 ${index + 1}`, tables };
}
export function inspectFont(input) {
  const b = bytesOf(input); range(b, 0, 4);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const collection = tag(b, 0) === 'ttcf';
  let faces, signedCollection = false;
  if (collection) {
    range(b, 0, 12);
    const version = v.getUint32(4);
    if (version !== 0x00010000 && version !== 0x00020000) throw Error('不支持的 TTC 版本');
    const count = v.getUint32(8);
    if (!count || count > 128) throw Error('TTC 字体面数量异常');
    range(b, 12, count * 4 + (version === 0x00020000 ? 12 : 0));
    if (version === 0x00020000) {
      const at = 12 + count * 4;
      const signedLength = v.getUint32(at + 4), signedOffset = v.getUint32(at + 8);
      if (signedLength) {
        if (v.getUint32(at) !== 0x44534947) throw Error('TTC 签名目录异常');
        range(b, signedOffset, signedLength);
        signedCollection = true;
      }
    }
    faces = Array.from({ length: count }, (_, i) => face(b, v.getUint32(12 + i * 4), i));
  } else faces = [face(b, 0, 0)];
  return { format: collection ? 'ttc' : faces[0].kind, faces, signedCollection };
}
function sum(b) {
  let total = 0;
  for (let i = 0; i < b.length; i += 4) total = (total + (((b[i] || 0) << 24 | (b[i + 1] || 0) << 16 | (b[i + 2] || 0) << 8 | (b[i + 3] || 0)) >>> 0)) >>> 0;
  return total;
}
function relocate(b, src, collection) {
  // ponytail: signed/opaque-offset tables cannot be moved safely; reject instead of silently changing the font.
  if (src.tables.get('DSIG')?.length > 8 || src.tables.has('bhed')) throw Error('此字体含签名或特殊位图表，无法保证重新封装后有效；请保留原格式');
  const start = collection ? 16 : 0;
  let cursor = start + 12 + src.tables.size * 16;
  const places = [];
  for (const [name, old] of src.tables) {
    cursor = (cursor + 3) & ~3;
    places.push({ name, old, offset: cursor });
    cursor += (old.length + 3) & ~3;
    if (cursor > LIMIT) throw Error('输出超过 384 MB，已停止');
  }
  const out = new Uint8Array(cursor), v = new DataView(out.buffer);
  if (collection) {
    out.set([116, 116, 99, 102], 0);
    v.setUint32(4, 0x00010000);
    v.setUint32(8, 1);
    v.setUint32(12, 16);
  }
  out.set(b.subarray(src.start, src.start + 12), start);
  let headOffset = -1;
  for (let i = 0; i < places.length; i++) {
    const p = places[i], at = start + 12 + i * 16;
    out.set(Array.from(p.name, c => c.charCodeAt(0)), at);
    out.set(b.subarray(p.old.offset, p.old.offset + p.old.length), p.offset);
    if (p.name === 'head') { out.fill(0, p.offset + 8, p.offset + 12); headOffset = p.offset; }
    v.setUint32(at + 4, sum(out.subarray(p.offset, p.offset + p.old.length)));
    v.setUint32(at + 8, p.offset);
    v.setUint32(at + 12, p.old.length);
  }
  if (!collection) v.setUint32(headOffset + 8, (MAGIC - sum(out)) >>> 0);
  if (!collection && sum(out) !== MAGIC) throw Error('输出校验失败');
  const checked = inspectFont(out);
  if (checked.faces.length !== 1 || checked.faces[0].kind !== src.kind) throw Error('输出字体结构校验失败');
  for (const p of places) {
    const before = b.subarray(p.old.offset, p.old.offset + p.old.length);
    const after = out.subarray(p.offset, p.offset + p.old.length);
    if (before.some((x, i) => (p.name !== 'head' || i < 8 || i >= 12) && x !== after[i])) throw Error(`${p.name} 表内容变化，已停止`);
  }
  return out;
}
export function convertFont(input, target, faceIndex = 0) {
  const b = bytesOf(input), info = inspectFont(b);
  if (!['ttf', 'otf', 'ttc'].includes(target)) throw Error('请选择 TTF、OTF 或 TTC');
  if (target === info.format) return b.slice();
  if (info.signedCollection) throw Error('TTC 集合带数字签名，重新封装会丢失签名；请保留原格式');
  const selected = info.faces.find(x => x.index === Number(faceIndex));
  if (!selected) throw Error('找不到选中的字体面');
  // OpenType 规范允许使用 TrueType 轮廓的字体以 .otf 扩展名分发；原始字体表完全不变。
  if (target === 'otf' && selected.kind === 'ttf' && info.format === 'ttf') return b.slice();
  if (target !== 'ttc' && target !== selected.kind && !(target === 'otf' && selected.kind === 'ttf')) throw Error(`这份字体使用 ${selected.kind.toUpperCase()} 轮廓，强改为 ${target.toUpperCase()} 会重绘字形，可能丢失彩色、可变或提示信息；为保护原字体，已停止转换`);
  // ponytail: TTC imports select one face explicitly; the original multi-face TTC is never overwritten.
  return relocate(b, selected, target === 'ttc');
}
