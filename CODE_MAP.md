# 字体格式转换器代码图

导入框（多选） → 浏览器读取字体文件 → SFNT/TTC 目录识别与大小/偏移校验 → 列出原始格式、字体面 → 选择目标格式 → 检查轮廓兼容性 → 同格式原样复制 / TTC 封装 / 从 TTC 提取选定字体面 → 输出结构与表内容校验 → 单文件下载或多个文件 ZIP 打包 → 页面状态回执。

CFF 轮廓 OTF → TTF 另有一条**显式勾选 + 二次确认**的近似支路：勾选风险说明 → `window.confirm` → 仅静态 CFF1（含 COLR v0+CPAL 成对出现的彩色矢量层）进入 → 内嵌 Pyodide/FontTools cu2qu 拟合所有字形 → 同步重算 TrueType 左侧边距避免彩色层错位 → 保存原有 COLR/CPAL → 重新解析并按每个 `cmap` 子表语义核对字符→字形编号（不要求子表原字节相同）、全部字形数、横竖排进位、竖排原点，name/GSUB/GPOS/GDEF/BASE/COLR/CPAL 原字节，以及彩色层字形编号、颜色索引、轮廓边界 → 有差异不下载。

- `font-core.js`：只搬运字体原始表字节，不重绘轮廓；TTC 包装/提取需要重新计算目录和校验和；不兼容的轮廓转换明确拒绝。
- `approx-cff.js`：可选的近似转换（唯一会重绘轮廓的路径，默认不启用）。单面静态 CFF1，或 CFF1+COLR v0+CPAL 成对、无其他彩色/可变/有效签名时可用；`approximateEligibility` 先卡门禁，`approximateCffToTtf` 在 Pyodide 里分批拟合并自校验。
- `app.js`：导入、识别、字体面选择、导出、同名冲突和错误提示；`#approxArea` 勾选态决定是否走近似支路。
- `template.html`：页面、联系作者、许可与来源弹窗、`#approxRuntime` 载荷槽。
- `vendor/`：`pyodide-fonttools-gzip.json`（内嵌运行时载荷，gzip+base64，来自字体编辑工具）、`approx-licenses.html`（FontTools/Pyodide/PSF/Emscripten 许可全文）。
- `build.mjs`：把 JS、运行时载荷和许可打进单文件 HTML；**插槽替换必须用函数形式**（`$&` 会被字符串形式 replace 当替换模式，2026-09-30 因此毁过整段脚本）；`dist/index.html` 只作发布副本。
- `tests.mjs`：真实字体 round-trip、表字节保留、签名集合阻断、COLR 门禁，以及**构建产物门禁**（内联脚本可解析 + 无残留占位符）；浏览器交互、ZIP 下载、桌面/手机布局由 `browser-e2e.mjs` 测；`color-browser-e2e.mjs` 用 `fixtures/make-cff-colr.py` 生成的纯自制夹具验证风险确认、红/蓝透明层像素与无效层引用拒绝；三个用户字体由本地不公开的 `approx-user-fonts-e2e.mjs` 实测。

本项目为新目录；不修改字体编辑器的权威源文件。无用户指定不得触碰的制品。