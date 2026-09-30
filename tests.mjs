import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { inspectFont, convertFont } from './font-core.js';
const ttf = new Uint8Array(await readFile('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'));
const otf = new Uint8Array(await readFile('/usr/share/fonts/opentype/tlwg/Loma-Oblique.otf'));
const ttc = new Uint8Array(await readFile('/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'));
assert.equal(inspectFont(ttf).format, 'ttf');
assert.equal(inspectFont(otf).format, 'otf');
assert.equal(inspectFont(ttc).format, 'ttc');
assert.deepEqual(convertFont(ttf, 'ttf'), ttf);
assert.deepEqual(convertFont(otf, 'otf'), otf);
assert.deepEqual(convertFont(ttc, 'ttc'), ttc);
assert.deepEqual(convertFont(ttf, 'otf'), ttf, 'OpenType 规范允许保留 TrueType 轮廓并以 .otf 命名');
assert.throws(() => convertFont(otf, 'ttf'), /已停止转换/);
for (const input of [ttf, otf]) {
  const kind = inspectFont(input).format;
  const wrapped = convertFont(input, 'ttc');
  assert.equal(inspectFont(wrapped).format, 'ttc');
  assert.equal(inspectFont(wrapped).faces[0].kind, kind);
  const output = convertFont(wrapped, kind);
  const original = inspectFont(input).faces[0].tables;
  const restored = inspectFont(output).faces[0].tables;
  for (const [name, table] of original) {
    const before = input.subarray(table.offset, table.offset + table.length);
    const afterTable = restored.get(name);
    const after = output.subarray(afterTable.offset, afterTable.offset + afterTable.length);
    assert.equal(after.length, before.length);
    if (name === 'head') { assert.deepEqual(after.subarray(0, 8), before.subarray(0, 8)); assert.deepEqual(after.subarray(12), before.subarray(12)); }
    else assert.deepEqual(after, before, `${kind} ${name} 表必须原样保留`);
  }
}
const firstFace = inspectFont(ttc).faces[0];
const extracted = convertFont(ttc, firstFace.kind);
assert.equal(inspectFont(extracted).format, firstFace.kind);
for (const [name, table] of firstFace.tables) {
  if (name === 'head') continue;
  const after = inspectFont(extracted).faces[0].tables.get(name);
  assert.deepEqual(extracted.subarray(after.offset, after.offset + after.length), ttc.subarray(table.offset, table.offset + table.length), name);
}
const colorFont = new Uint8Array(await readFile('/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf'));
assert.equal(inspectFont(colorFont).format, 'ttf');
const colorCollection = convertFont(colorFont, 'ttc');
const colorStandalone = convertFont(colorCollection, 'ttf');
for (const key of ['CBDT', 'CBLC']) {
  const original = inspectFont(colorFont).faces[0].tables.get(key);
  const restored = inspectFont(colorStandalone).faces[0].tables.get(key);
  assert.ok(original && restored);
  assert.deepEqual(colorStandalone.subarray(restored.offset, restored.offset + restored.length), colorFont.subarray(original.offset, original.offset + original.length));
}
assert.deepEqual(convertFont(colorFont, 'otf'), colorFont, '彩色字体变为 OpenType/TrueType 不应修改任何字节');
const unsignedCollection = convertFont(ttf, 'ttc');
const signedCollection = new Uint8Array(unsignedCollection.length + 12 + 32);
signedCollection.set(unsignedCollection.subarray(16), 28);
const view = new DataView(signedCollection.buffer);
signedCollection.set([116, 116, 99, 102], 0);
view.setUint32(4, 0x00020000);
view.setUint32(8, 1);
view.setUint32(12, 28);
view.setUint32(16, 0x44534947);
view.setUint32(20, 32);
view.setUint32(24, unsignedCollection.length + 12);
for (let i = 0, count = view.getUint16(28 + 4); i < count; i++) {
  const at = 28 + 12 + i * 16;
  view.setUint32(at + 8, view.getUint32(at + 8) + 12);
}
assert.equal(inspectFont(signedCollection).signedCollection, true);
assert.deepEqual(convertFont(signedCollection, 'ttc'), signedCollection, '同格式原样保留签名');
assert.throws(() => convertFont(signedCollection, 'ttf'), /带数字签名/);
assert.throws(() => convertFont(signedCollection, 'otf'), /带数字签名/);
// 构建产物门禁：内联脚本必须语法正确、且不能残留构建占位符（占位符＝注入内容被
// replace 的 `$&` 语义改写，整段脚本会静默失效——2026-09-30 实际发生，页面完全不响应）。
const built = await readFile('字体格式转换器.html', 'utf8');
let scriptCount = 0;
for (const [, attrs, body] of built.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (!/^\s*$|type="text\/javascript"/.test(attrs) || !body.trim()) continue;
  scriptCount++;
  assert.doesNotThrow(() => new Script(body, { filename: '内置脚本' }), '内置脚本必须语法正确');
}
assert.ok(scriptCount >= 1, `至少一个可执行内联脚本，实际 ${scriptCount}`);
for (const marker of ['__APP_JS__', '__APPROX_RUNTIME__', '__APPROX_LICENSES__']) {
  assert.ok(!built.includes(marker), `构建产物残留占位符：${marker}`);
}
console.log('通过：真实 TTF/OTF/TTC 与彩色 Emoji 字体表保真、OpenType TrueType 扩展名、签名集合阻断、危险跨轮廓转换阻断、构建产物脚本可解析且无残留占位符');
