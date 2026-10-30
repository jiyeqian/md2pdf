// Shared local-font configuration. No font files or remote font URLs are accepted.
export const FONT_ROLES = ['body', 'heading', 'western', 'code'];
const GENERIC_FAMILIES = new Set(['serif','sans-serif','monospace','system-ui','cursive','fantasy','emoji','math','inherit','initial','unset','revert']);
export function isFontFamilyName(value) {
  return typeof value === 'string' && value === value.trim() && /^[\p{L}\p{N}\p{M} _().+\-]{1,100}$/u.test(value) && !GENERIC_FAMILIES.has(value.toLowerCase()) && !/^(?:url|var|local|calc|env)\s*\(/i.test(value);
}
export function normalizeFonts(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') throw new Error('fonts 必须为映射，例如 fonts: { body: "Noto Serif CJK SC" }');
  for (const key of Object.keys(value)) if (!FONT_ROLES.includes(key)) throw new Error('fonts 的未知字段：' + key + '（可用：' + FONT_ROLES.join('、') + '）');
  const out = {};
  for (const role of FONT_ROLES) if (Object.hasOwn(value,role)) {
    if (!isFontFamilyName(value[role])) throw new Error('fonts.' + role + ' 必须是单个非空的已安装字体名称（不接受列表、通用字体类别、路径或 CSS）');
    out[role] = value[role];
  }
  return out;
}

export function documentFonts(value, gb = false) {
  const fonts = value === undefined ? {} : normalizeFonts(value);
  const checks = [], faces = [];
  const alias = role => '"MD2PDF User ' + role + '"';
  for (const [role, family] of Object.entries(fonts)) {
    const range = role === 'western' ? ' unicode-range: U+0030-0039, U+0041-005A, U+0061-007A, U+00C0-024F, U+1E00-1EFF;' : '';
    // local() matches full/PostScript names; common regular-face names also
    // allow family names such as Menlo without enumerating installed fonts.
    const sources = [family, family+' Regular', family+'-Regular', family+' Roman', family+'-Roman'].map(name=>'local('+JSON.stringify(name)+')').join(', ');
    faces.push('@font-face { font-family: '+alias(role)+'; src: '+sources+';'+range+' }');
    checks.push(['12pt '+alias(role), role === 'western' ? 'ABCabc0123é' : undefined, family, 'custom']);
  }
  if (!checks.length) return {css:'',checks};
  const css = [...faces, ':root { --md2pdf-default-body: var(--font-body); --md2pdf-default-head: var(--font-head); --md2pdf-default-mono: var(--font-mono); }'];
  const scope = gb ? 'main, .toc, .pagedjs_footnote_area' : 'body';
  const prefix = fonts.western ? alias('western')+', ' : '';
  if (fonts.body || fonts.western) css.push(scope+' { --font-body: '+prefix+(fonts.body ? alias('body')+', ' : '')+'var(--md2pdf-default-body); font-family: var(--font-body); }');
  if (fonts.western) css.push(scope+' { --font-head: '+prefix+'var(--md2pdf-default-head); }');
  const headings = gb ? ':is(main, .toc) :is(h1,h2,h3,h4,h5,h6), .toc-title' : 'body :is(h1,h2,h3,h4,h5,h6), .toc-title';
  if (fonts.heading || fonts.western) css.push(headings+' { font-family: '+prefix+(fonts.heading ? alias('heading')+', ' : '')+'var(--md2pdf-default-head) !important; }');
  if (gb) css.push('.gb-body-title { font-family: var(--md2pdf-default-head); }');
  if (fonts.code) css.push((gb ? 'main' : 'body')+' :is(pre,code,kbd,samp) { font-family: '+alias('code')+', var(--md2pdf-default-mono) !important; }');
  return {css:css.join('\n'),checks};
}
