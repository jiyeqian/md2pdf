// Shared directive names and editor examples; this module is browser-safe.
export const GB_BLOCKS = [
  { name: 'note', description: '普通说明（无默认标签）', body: '注的内容' },
  { name: 'example', description: '示例：标签独立', body: '示例内容' },
  { name: 'term', description: '术语与定义', body: '术语名称\nterm name\n\n术语定义' },
  { name: 'subfigure', description: '分图', body: '分图内容' },
  { name: 'important', description: '重要提示', body: '提示内容' },
  { name: 'index-section', description: '中文索引分区（双栏）', argument: 'lang=zh', body: ':::gb-index\n关键词 | @sec:section\n:::' },
  { name: 'index', description: '索引自动分组（可指定字母）', body: '关键词 | @sec:section' },
  { name: 'equation', description: '公式', body: '$$a=b$$\n\n式中：\n$a$ | 参数 a；\n$b$ | 参数 b。' },
  { name: 'table', description: '复杂表格', body: 'head:\n| 项目 | 数值 |\nbody:\n| 示例 | 1 |' },
];

// The completion menu offers common forms without adding directive names.
export const GB_NOTE_FORMS = [
  { argument: 'label="注："', description: '正文或术语注' },
  { argument: 'scope=table label="注："', description: '表注（放在表后）' },
  { argument: 'scope=figure label="注："', description: '图注（放在图后）' },
  { argument: 'scope=table label="a）" weight=normal', description: '表脚注（标记另行填写）' },
  { argument: 'scope=figure label="a）" weight=normal', description: '图脚注（标记另行填写）' },
  { argument: 'scope=table position=top align=right', description: '表上方右对齐说明（写在表后）', body: '单位为毫米' },
  { argument: 'scope=figure position=top align=right', description: '图上方右对齐说明（写在图后）', body: '单位为毫米' },
  { argument: 'weight=normal', description: '来源文字（原样显示）', body: '[来源：GB/T 20000.1—2014，5.3]' },
  { argument: 'scope=table align=left', description: '表来源（原样显示，写在表后）', body: '[来源：GB/T XXXXX—2026，表2]' },
  { argument: 'scope=figure align=left', description: '图来源（原样显示，写在图后）', body: '[来源：GB/T XXXXX—2026，图1]' },
];

export function parseGbParameters(value, allowed) {
  const params = {};
  let rest = value.trim();
  while (rest) {
    const match = /^([a-z][a-z-]*)=(?:"((?:[^"\\]|\\["\\])*)"|'((?:[^'\\]|\\['\\])*)'|([^\s"']+))(?=\s|$)/.exec(rest);
    if (!match || !allowed.includes(match[1]) || Object.hasOwn(params, match[1])) {
      const error = new Error('GB指令参数无效、重复或未知：' + rest); error.status = 400; throw error;
    }
    params[match[1]] = (match[2] ?? match[3] ?? match[4]).replace(/\\(["'\\])/g, '$1');
    rest = rest.slice(match[0].length).trim();
  }
  return params;
}
