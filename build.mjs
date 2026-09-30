import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const js = (await build({ entryPoints: ['app.js'], bundle: true, format: 'iife', platform: 'browser', write: false, minify: true, legalComments: 'none' })).outputFiles[0].text.replaceAll('</script', '<\\/script');
const template = await readFile('template.html', 'utf8');
// 替换必须用函数形式：注入内容里的 `$&`、`$1` 会被字符串形式的 replace 当成替换模式，
// 把压缩后的 `$&&x` 之类改成占位符文本、直接毁掉整段脚本（2026-09-30 实际发生）。
const insert = (haystack, marker, value) => {
  if (!haystack.includes(marker)) throw Error(`缺少构建插槽：${marker}`);
  return haystack.replace(marker, () => value);
};
const html = insert(insert(insert(template,
  '/* __APP_JS__ */', js),
  '/* __APPROX_RUNTIME__ */', (await readFile('vendor/pyodide-fonttools-gzip.json', 'utf8')).trim()),
  '<!-- __APPROX_LICENSES__ -->', await readFile('vendor/approx-licenses.html', 'utf8'));
for (const marker of ['__APP_JS__', '__APPROX_RUNTIME__', '__APPROX_LICENSES__']) {
  if (html.includes(marker)) throw Error(`构建残留占位符：${marker}`);
}
await writeFile('字体格式转换器.html', html);
// The current published snapshot is not overwritten by a candidate build.
if (process.argv.includes('--release')) {
  await mkdir('dist', { recursive: true });
  await writeFile('dist/index.html', html);
}
console.log(`生成单文件 ${Buffer.byteLength(html)} 字节` + (process.argv.includes('--release') ? '（已同步 dist）' : '（本地候选版，未同步 dist）'));
