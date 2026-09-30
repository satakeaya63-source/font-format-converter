# 字体格式转换器

在线使用：<https://font-format-converter-cy6.pages.dev/>

下载 [字体格式转换器.html](./字体格式转换器.html) 即可离线使用。多选导入 TTF、OTF、TTC，自动识别文件实际格式；单个字体单独导出，多个字体以 ZIP 打包，保留原文件名。TTC 转单字体时可选字体面。

**保真边界**：TTF/OTF 同格式原样复制；TTF 转 OTF 按 [OpenType 官方扩展名建议](https://learn.microsoft.com/en-us/typography/opentype/spec/recom)保留原有 TrueType 轮廓和全部字体表，输出的 OTF 不是 CFF 字形，较旧软件可能不识别。可把单字体封装为单面 TTC，或从 TTC 中提取指定字体面。重新封装时逐字节核对字体表（仅重算字体目录和 `head` 校验字段）。**CFF/CFF2 轮廓 OTF 转 TTF 不能无损完成**：重绘可能损失彩色、可变、提示等信息，本工具明确拒绝，不会生成伪字体。含数字签名或特殊位图表的重新封装也会拒绝。TTC 提取仅保留用户所选字体面，不会改动原文件。

所有文件均在浏览器本地处理，不上传。ZIP 打包使用 [fflate 0.8.2](https://github.com/101arrowz/fflate)（MIT），许可见页面底部弹窗。开发：`npm ci && npm run build`。

本工具源码公开、个人免费、允许二改再发布但须署名、禁止倒卖及换皮收费，许可见 [LICENSE](./LICENSE)。工具许可不改变输入字体的授权。

Required Notice: Copyright 无异（小红书号 49686051226）
