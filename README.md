# 字体格式转换器

在线使用：<https://font-format-converter-cy6.pages.dev/>

下载 [字体格式转换器.html](./字体格式转换器.html) 即可离线使用。多选导入 TTF、OTF、TTC，自动识别文件实际格式；单个字体单独导出，多个字体以 ZIP 打包，保留原文件名。TTC 转单字体时可选字体面。

**保真边界**：默认 TTF/OTF 同格式原样复制；TTF 转 OTF 按 [OpenType 官方扩展名建议](https://learn.microsoft.com/en-us/typography/opentype/spec/recom)保留原有 TrueType 轮廓和全部字体表，输出的 OTF 不是 CFF 字形，较旧软件可能不识别。可把单字体封装为单面 TTC，或从 TTC 中提取指定字体面。重新封装时逐字节核对字体表（仅重算字体目录和 `head` 校验字段）。**CFF/CFF2 轮廓 OTF 转 TTF 不能无损完成**：默认明确拒绝，不会生成伪字体；含数字签名或特殊位图表的重新封装也会拒绝。TTC 提取仅保留用户所选字体面，不会改动原文件。

**可选的近似转换**：单面、静态 CFF1 OTF 转 TTF 时，用户须先勾选风险说明，再在二次弹窗确认。使用本地内嵌的 Pyodide + FontTools cu2qu 将三次曲线拟合为二次曲线；拟合细节和原 CFF 提示信息不能保证相同。含完整 `COLR v0 + CPAL` 的静态矢量彩色字体可沿此路径转换：所有底层字形轮廓（包括彩色层）拟合为 TrueType 曲线，彩色表和颜色索引保留；其他彩色结构、可变字体、有效数字签名仍拒绝。生成后重新解析 TTF，核对：字符→字形编号**逐个子表**一致（cmap 会按 OpenType 规范重新编码，不逐字节保留）、全部字形数、横竖排进位、竖排原点，以及 `name`/`GSUB`/`GPOS`/`GDEF`/`BASE`/`COLR`/`CPAL` 的原始字节；彩色层字形编号与颜色索引另行逐层核对，有差异则不下载。大字库建议在桌面浏览器运行。

所有文件均在浏览器本地处理，不上传。ZIP 打包使用 [fflate 0.8.2](https://github.com/101arrowz/fflate)（MIT）；可选转换内嵌 Pyodide 0.28.2（MPL-2.0）及 FontTools 4.56.0（MIT），离线许可全文在页面底部弹窗。内嵌运行时的压缩载荷来自本机字体编辑工具，组件版本、来源和许可在 `vendor/approx-licenses.html`。开发：`npm ci && npm run build`，此命令只生成本地候选版；测试、复审通过且获准发布后才运行 `npm run build -- --release` 同步到 `dist/index.html`。原始字体及转换产物不得提交进公开仓库。

本工具源码公开、个人免费、允许二改再发布但须署名、禁止倒卖及换皮收费，许可见 [LICENSE](./LICENSE)。工具许可不改变输入字体的授权。

Required Notice: Copyright 无异（小红书号 49686051226）
