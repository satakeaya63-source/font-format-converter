import { zipSync } from 'fflate';
import { inspectFont, convertFont } from './font-core.js';
import { approximateCffToTtf, approximateEligibility } from './approx-cff.js';

const $ = id => document.getElementById(id);
let items = [];
let busy = false;
const limit = 384 * 1024 * 1024;
function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function stem(name) { return name.replace(/\.(ttf|otf|ttc)$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 160) || '字体'; }
function outputNames(entries, extension) {
  const used = new Set();
  return entries.map(({ file }) => {
    const base = stem(file.name);
    let name = `${base}.${extension}`, n = 2;
    while (used.has(name.toLowerCase())) name = `${base} (${n++}).${extension}`;
    used.add(name.toLowerCase());
    return name;
  });
}
function render() {
  const list = $('list');
  list.replaceChildren();
  for (const [i, item] of items.entries()) {
    const row = document.createElement('div'); row.className = 'font-row';
    const text = document.createElement('div'); text.className = 'font-name';
    const title = document.createElement('strong'); title.textContent = item.file.name;
    const badge = document.createElement('small'); badge.className = 'badge'; badge.textContent = item.info.format === 'ttf' && /\.otf$/i.test(item.file.name) ? 'OTF · TrueType轮廓' : item.info.format.toUpperCase();
    text.append(title, badge); row.append(text);
    if (item.info.faces.length > 1 && $('target').value !== 'ttc') {
      const label = document.createElement('label'); label.textContent = '导出的字体面';
      const select = document.createElement('select'); select.setAttribute('aria-label', `${item.file.name} 导出的字体面`);
      for (const face of item.info.faces) {
        const opt = document.createElement('option'); opt.value = String(face.index);
        opt.textContent = `${face.index + 1}. ${face.family} · ${face.kind.toUpperCase()}`;
        select.append(opt);
      }
      select.value = String(item.faceIndex);
      select.disabled = busy;
      select.addEventListener('change', () => { item.faceIndex = Number(select.value); updateNote(); });
      label.append(select); row.append(label);
    }
    const remove = document.createElement('button'); remove.className = 'remove'; remove.type = 'button';
    remove.setAttribute('aria-label', `移除 ${item.file.name}`); remove.textContent = '移除';
    remove.disabled = busy;
    remove.addEventListener('click', () => { if (busy) return; items.splice(i, 1); render(); status(items.length ? `已选择 ${items.length} 个字体` : '等待导入字体。'); });
    row.append(remove); list.append(row);
  }
  $('fileCount').textContent = items.length ? `${items.length} 个文件` : '尚未导入';
  $('convert').disabled = !items.length || busy;
  $('clear').hidden = !items.length;
  $('clear').disabled = busy;
  $('target').disabled = busy;
  $('approxConsent').disabled = busy;
  $('pick').disabled = busy;
  $('files').disabled = busy;
  updateNote();
}
function updateNote() {
  const target = $('target').value;
  const approximate = items.filter(x => target === 'ttf' && x.info.faces.find(f => f.index === x.faceIndex)?.kind === 'otf');
  $('approxArea').hidden = !approximate.length;
  const incompatible = items.filter(x => (x.info.signedCollection && target !== x.info.format) || (x.info.format !== target && target !== 'ttc' && !(target === 'otf' && x.info.faces.find(f => f.index === x.faceIndex)?.kind === 'ttf') && x.info.faces.find(f => f.index === x.faceIndex)?.kind !== target));
  $('note').textContent = incompatible.length
    ? `注意：${incompatible.length} 个文件无法无损转换为 ${target.toUpperCase()}；默认停止。${approximate.length ? '若需要 TTF，可在下方主动选择近似转换。' : ''}`
    : '保留原始字形和彩色、可变字体表。TTF 转 OTF 按 OpenType 规范保留 TrueType 轮廓（不是重绘成 CFF）；TTC 转单字体时只导出选定的字体面。';
  $('note').classList.toggle('warning', Boolean(incompatible.length));
}
async function importFiles(files) {
  if (busy) return;
  const chosen = Array.from(files);
  if (!chosen.length) return;
  if (chosen.some(f => f.size > limit)) return status('有字体超过 384 MB，已停止导入。', true);
  const parsed = [], failures = [];
  for (const file of chosen) {
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      parsed.push({ file, data, info: inspectFont(data), faceIndex: 0 });
    } catch (error) { failures.push(`${file.name}：${error.message}`); }
  }
  items.push(...parsed);
  render();
  status(failures.length ? `已导入 ${parsed.length} 个；未导入：${failures.join('；')}` : `已导入 ${parsed.length} 个字体，格式已自动识别。`, Boolean(failures.length));
}
function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function exportFiles() {
  if (!items.length || busy) return;
  const target = $('target').value;
  const approximate = items.filter(x => target === 'ttf' && x.info.faces.find(f => f.index === x.faceIndex)?.kind === 'otf');
  const optedIn = Boolean(approximate.length && $('approxConsent').checked);
  if (optedIn && !window.confirm(`将近似转换 ${approximate.length} 份 OTF 字体：必须重新拟合曲线，细节和提示信息可能变化；不能承诺与原版完全一致。原件不会修改。确认继续吗？`)) return;
  busy = true; render();
  status('正在核对字体内容，请稍候…');
  try {
    const names = outputNames(items, target), output = [];
    let total = 0;
    for (const [index, item] of items.entries()) {
      let data;
      try {
        if (optedIn && approximate.includes(item)) {
          const otf = item.info.format === 'ttc' ? convertFont(item.data, 'otf', item.faceIndex) : item.data;
          approximateEligibility(otf);
          data = await approximateCffToTtf(otf, message => status(`${item.file.name}：${message}`));
        } else data = convertFont(item.data, target, item.faceIndex);
      }
      catch (error) { throw Error(`${item.file.name}：${error.message}`); }
      total += data.length;
      if (total > limit) throw Error('导出总大小超过 384 MB，已停止打包');
      output.push([names[index], data]);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (output.length === 1) download(output[0][1], output[0][0], 'font/collection');
    else {
      const zip = zipSync(Object.fromEntries(output), { level: 0 });
      download(zip, `字体格式转换_${target.toUpperCase()}.zip`, 'application/zip');
    }
    status(`已导出 ${output.length} 个 ${target.toUpperCase()} 字体${output.length > 1 ? '（ZIP 压缩包）' : ''}。${optedIn ? '近似转换可能与原版有细微差异，请先试装验证。' : ''}`);
  } catch (error) {
    status(`没有导出：${error.message}。原始文件未修改。`, true);
  } finally { if (optedIn) $('approxConsent').checked = false; busy = false; render(); }
}
$('pick').addEventListener('click', () => $('files').click());
$('files').addEventListener('change', event => { importFiles(event.target.files); event.target.value = ''; });
$('target').addEventListener('change', () => { $('approxConsent').checked = false; render(); });
$('convert').addEventListener('click', exportFiles);
$('clear').addEventListener('click', () => { if (busy) return; items = []; render(); status('已清空选择，原始文件未修改。'); });
const drop = $('drop');
for (const eventName of ['dragenter', 'dragover']) drop.addEventListener(eventName, e => { e.preventDefault(); drop.classList.add('over'); });
for (const eventName of ['dragleave', 'drop']) drop.addEventListener(eventName, e => { e.preventDefault(); drop.classList.remove('over'); });
drop.addEventListener('drop', e => importFiles(e.dataTransfer.files));
$('licenseButton').addEventListener('click', () => $('license').showModal());
$('licenseClose').addEventListener('click', () => $('license').close());
$('license').addEventListener('click', e => { if (e.target === $('license')) $('license').close(); });
render();
