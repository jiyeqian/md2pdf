// Shared directive names and editor examples; this module is browser-safe.
export const GB_BLOCKS = [
  { name: 'note', description: '注', body: '注的内容' },
  { name: 'example', description: '示例：标签独立', body: '示例内容' },
  { name: 'term', description: '术语与定义', body: '术语名称\nterm name\n\n术语定义' },
  { name: 'source', description: '来源', body: 'GB/T 20000.1—2014，5.3' },
  { name: 'unit', description: '单位', body: '单位为毫米' },
  { name: 'subfigure', description: '分图', body: '分图内容' },
  { name: 'table-note', description: '表注', body: '表注内容' },
  { name: 'important', description: '重要提示', body: '提示内容' },
  { name: 'figure-note', description: '图注', body: '图注内容' },
  { name: 'figure-footnote', description: '图脚注', argument: 'a）', body: '图脚注内容' },
  { name: 'table-footnote', description: '表脚注', argument: 'a）', body: '表脚注内容' },
  { name: 'index', description: '索引分组', argument: 'A', body: '关键词 | 3.1' },
  { name: 'equation', description: '公式', body: '$$a=b$$\n\n式中：\n$a$ | 参数 a；\n$b$ | 参数 b。' },
  { name: 'table', description: '复杂表格', body: 'head:\n| 项目 | 数值 |\nbody:\n| 示例 | 1 |' },
];
