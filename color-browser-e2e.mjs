import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { inspectFont } from './font-core.js';

const fixture = new Uint8Array(await readFile('fixtures/cff-colr-v0.otf'));
const browser = await chromium.launch({ executablePath: '/opt/data/tmp/pw-browsers/chromium-1243/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ acceptDownloads: true });
  page.setDefaultTimeout(240000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.FONT_QA_PAGE || 'file:///opt/data/work/font-format-converter/字体格式转换器.html');
  await page.locator('#files').setInputFiles({ name: 'SyntheticColor.otf', mimeType: 'font/otf', buffer: Buffer.from(fixture) });
  await page.locator('#approxArea').waitFor({ state: 'visible' });
  assert.match(await page.locator('#approxArea').innerText(), /COLR v0 \+ CPAL/);
  await page.locator('#convert').click();
  await page.locator('#status.error').waitFor();
  assert.match(await page.locator('#status').innerText(), /已停止转换/);
  await page.locator('#approxConsent').check();
  page.once('dialog', dialog => dialog.accept());
  const pending = page.waitForEvent('download', { timeout: 240000 });
  await page.locator('#convert').click();
  const downloaded = await Promise.race([pending, page.locator('#status.error').waitFor().then(async () => { throw Error(await page.locator('#status').innerText()); })]);
  assert.equal(downloaded.suggestedFilename(), 'SyntheticColor.ttf');
  const output = new Uint8Array(await readFile(await downloaded.path()));
  const src = inspectFont(fixture).faces[0].tables;
  const dst = inspectFont(output).faces[0].tables;
  assert.equal(inspectFont(output).format, 'ttf');
  assert.ok(dst.has('glyf') && dst.has('loca') && !dst.has('CFF '));
  for (const table of ['COLR', 'CPAL']) {
    assert.deepEqual(output.subarray(dst.get(table).offset, dst.get(table).offset + dst.get(table).length), fixture.subarray(src.get(table).offset, src.get(table).offset + src.get(table).length), `${table} must be byte-identical`);
  }
  const pixels = await page.evaluate(async ({ original, converted }) => {
    const draw = async (encoded, label) => {
      const bytes = Uint8Array.from(atob(encoded), x => x.charCodeAt(0));
      const face = await new FontFace(label, bytes).load();
      document.fonts.add(face);
      const canvas = document.createElement('canvas'); canvas.width = 230; canvas.height = 200;
      const ctx = canvas.getContext('2d'); ctx.font = `200px ${label}`;
      ctx.fillText('A', 0, 170);
      return [[50, 90], [150, 90]].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
    };
    return [await draw(original, 'sourceColorQA'), await draw(converted, 'convertedColorQA')];
  }, { original: Buffer.from(fixture).toString('base64'), converted: Buffer.from(output).toString('base64') });
  assert.deepEqual(pixels[1], pixels[0], 'source and output must render the same red/blue colors');
  assert.deepEqual(pixels[0], [[255, 0, 0, 128], [0, 0, 255, 255]]);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.locator('#approxArea').isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '手机视口不得横向溢出');
  await page.screenshot({ path: '/opt/data/tmp/font-converter-color-mobile.png', fullPage: true });
  const broken = fixture.slice();
  const v = new DataView(broken.buffer);
  const colr = src.get('COLR').offset;
  v.setUint16(colr + v.getUint32(colr + 8), 0xFFFF);
  await page.locator('#clear').click();
  await page.locator('#files').setInputFiles({ name: 'BrokenColor.otf', mimeType: 'font/otf', buffer: Buffer.from(broken) });
  await page.locator('#approxConsent').check();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#convert').click();
  await page.locator('#status.error').waitFor();
  assert.match(await page.locator('#status').innerText(), /没有导出：BrokenColor\.otf：近似转换或产物核对失败/);
  assert.deepEqual(errors, []);
  console.log('彩色 CFF 浏览器通过：风险确认、COLR/CPAL 字节、红蓝渲染、坏层引用拒绝');
  await page.close();
} finally { await browser.close(); }
