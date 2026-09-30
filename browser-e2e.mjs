import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { unzipSync } from 'fflate';
import { readFile } from 'node:fs/promises';
import { inspectFont } from './font-core.js';
const browser = await chromium.launch({ executablePath: '/opt/data/tmp/pw-browsers/chromium-1243/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'] });
try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.FONT_QA_PAGE || 'file:///opt/data/work/font-format-converter/字体格式转换器.html');
    assert.equal(await page.locator('h1').innerText(), '字体格式转换器');
    assert.equal(await page.locator('.by').innerText(), 'By 无异');
    await page.getByRole('button', { name: '许可与来源' }).click();
    await page.getByText('PolyForm 许可原文（离线可读）').click();
    assert.match(await page.locator('#license').innerText(), /PolyForm Noncommercial License 1\.0\.0/);
    assert.equal(await page.locator('#license a[href="https://polyformproject.org/licenses/noncommercial/1.0.0"]').count(), 1);
    await page.getByText('第三方开源组件与许可（点开）').click();
    assert.ok(await page.getByText('fflate 0.8.2', { exact: false }).isVisible());
    await page.getByRole('button', { name: '关闭' }).click();
    await page.locator('#files').setInputFiles('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
    await page.locator('#list .badge').waitFor();
    assert.equal(await page.locator('#list .badge').innerText(), 'TTF');
    await page.locator('#target').selectOption('ttc');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '转换并下载' }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'DejaVuSans.ttc');
    assert.equal(inspectFont(new Uint8Array(await readFile(await download.path()))).format, 'ttc');
    await page.locator('#target').selectOption('otf');
    const otfDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '转换并下载' }).click();
    const otfDownload = await otfDownloadPromise;
    assert.equal(otfDownload.suggestedFilename(), 'DejaVuSans.otf');
    assert.deepEqual(new Uint8Array(await readFile(await otfDownload.path())), new Uint8Array(await readFile('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')));
    await page.locator('#files').setInputFiles('/usr/share/fonts/opentype/tlwg/Loma-Oblique.otf');
    await page.locator('#target').selectOption('ttf');
    await page.getByRole('button', { name: '转换并下载' }).click();
    await page.getByText('没有导出：', { exact: false }).waitFor();
    assert.match(await page.locator('#status').innerText(), /Loma-Oblique\.otf.*已停止转换/);
    await page.locator('#files').setInputFiles('/usr/share/fonts/opentype/tlwg/Loma.otf');
    await page.locator('#list .badge').last().waitFor();
    assert.equal(await page.locator('#list .badge').count(), 3);
    await page.locator('#target').selectOption('ttc');
    const zipPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '转换并下载' }).click();
    const zip = await zipPromise;
    assert.equal(zip.suggestedFilename(), '字体格式转换_TTC.zip');
    const entries = unzipSync(new Uint8Array(await readFile(await zip.path())));
    assert.deepEqual(Object.keys(entries).sort(), ['DejaVuSans.ttc', 'Loma-Oblique.ttc', 'Loma.ttc'].sort());
    for (const data of Object.values(entries)) assert.equal(inspectFont(data).format, 'ttc');
    if (viewport.width === 390) {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '手机横向溢出');
      assert.ok(await page.locator('#convert').evaluate(x => x.getBoundingClientRect().width >= 44));
    }
    assert.deepEqual(errors, []);
    console.log(`${viewport.width}px 浏览器通过：弹窗、单文件下载、拒绝损失、批量 ZIP、布局、零页面错误`);
    await page.close();
  }
} finally { await browser.close(); }
