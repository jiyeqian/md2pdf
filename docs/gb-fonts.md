# 字体配置说明

## 用户指定的字体

适用于全部模板的 `fonts` 配置。安装提示中列出的字体，或在文档中修正字体名称。建议优先填写 **PostScript Name（PostScript 名称）**，不要根据字体文件名或中文展示名猜测。家族名、完整名也可使用，但以浏览器实际加载结果为准。此处不提供字体下载，字体文件不会随文档传给服务器或其他设备。

缺字体仍可预览；WebApp 下载须确认风险后继续，取消则停止。CLI 默认停止，可用 `--allow-font-fallback` 明确允许回退。回退不改变文档配置。

各角色允许空字符串 `""`，表示清除该角色的自定义字体并采用模板／系统回退字体，不作为“配置无效”或空名称加载失败。省略角色则继承低层配置；GB 固定字体检查保持不变。

## macOS：在字体册查看名称

1. 打开“字体册”，展开字体家族，选中具体字面（如常规体或粗体）。
2. 点击工具栏“信息”按钮。
3. 复制 **PostScript 名称 / PostScript Name**，填入 `fonts`。

例如，方正楷体 GBK 的 PostScript 名称为 `FZKTK--GBK1-0`：

```yaml
fonts:
  heading: "FZKTK--GBK1-0"
```

不同字面可能有不同名称，必须选择实际需要的字面。[Apple 字体册操作说明](https://support.apple.com/en-ca/guide/font-book/fntbk1001/mac)。

## Linux：使用 Fontconfig

需要 `fc-scan`／`fc-list`（Fontconfig 工具）。读取指定字体文件，路径替换为实际文件：

```bash
fc-scan --format '%{postscriptname}\n' "/路径/字体.otf"
```

列出已安装字体的家族名及 PostScript 名称，找到目标行后复制第二列：

```bash
fc-list --format '%{family}\t%{postscriptname}\n'
```

不要把 `fc-match` 返回的替代字体当作目标字体；仅查询到名称也不代表字体已安装并可被浏览器使用。[Fontconfig 名称字段说明](https://fontconfig.pages.freedesktop.org/fontconfig/fontconfig-user.html)。

## Windows：从字体文件读取名称

以下方法需要 Python 和 FontTools；在 PowerShell 中执行。先安装工具：

```powershell
py -m pip install fonttools
```

读取 `.ttf`／`.otf` 文件，路径替换为自己的字体文件：

```powershell
py -c "from fontTools.ttLib import TTFont; print(TTFont(r'C:\路径\字体.otf')['name'].getDebugName(6))"
```

若是 `.ttc` 字体集合，列出集合中各字面的名称，选择所需字面：

```powershell
py -c "from fontTools.ttLib import TTCollection; [print(f['name'].getDebugName(6)) for f in TTCollection(r'C:\路径\字体.ttc').fonts]"
```

`6` 是字体名称表中的 PostScript 名称字段；若结果为 `None`，不要将它作为字体名，应向字体提供者核对。[名称字段规范](https://learn.microsoft.com/en-us/typography/opentype/spec/name)、[FontTools 读取说明](https://fonttools.readthedocs.io/en/latest/ttLib/tables/_n_a_m_e.html)。

## GB 模板所需的专用字体

- 方正书宋_GBK：默认正文及页码等专用区域。
- 方正黑体_GBK：默认标题及标准号等专用区域。
- 方正小标宋_GBK：封面标题及英文名称。
- Times New Roman：普通、粗体，用于西文及符号。

请使用合法授权的字体；项目不提供这些字体文件。缺字体时仍可用替代字体预览，但分页和版式可能不同；下载 PDF 时会提示缺失字体；可选择继续下载，但替代字体可能改变分页和版式。正式用途建议安装全部字体后再导出。

## 在浏览器设备安装

适用于服务器版的预览，以及静态版的预览和下载。

1. 安装提示缺失的字体。macOS：双击字体文件，在“字体册”中安装；Windows：右键字体文件，选择安装。
2. 完全退出并重新打开浏览器，再打开文档。
3. 确认预览正常，再下载 PDF。静态版在打印窗口选择“另存为 PDF”。

## 在服务器安装

服务器版的 PDF 由服务器生成，本机字体不会自动传给服务器。

1. 联系部署者，将授权字体安装到运行服务的系统中；容器部署须安装在容器内。
2. Linux 部署者可用 `fc-cache -f` 更新缓存，并用 `fc-match 'FZXBSK--GBK1-0'` 核对实际匹配字体，不能是替代字体。
3. 确认服务账户能够读取字体，重启 md2pdf 服务和其 Chrome 进程，再下载。

仅有同名字体不能保证相同效果，还需核对字体版本、字形覆盖及浏览器／打印环境。

托管静态网页的服务器安装字体，对用户浏览器无效。仍提示缺失时，核对字体是否启用、字体内部名称与 GBK 版本是否正确，并重新启动浏览器或服务。
