export const CHAPTER_START_VALUES = ['continuous', 'page', 'odd-page'];
export const TOC_DEPTH_VALUES = [1, 2, 3];
export const TOC_LEVEL_VALUES = [0, ...TOC_DEPTH_VALUES];
export const TEXT_FIELDS = ['title', 'headerLeft', 'headerCenter', 'headerRight', 'footerLeft', 'footerCenter', 'footerRight'];
export const NUMBER_FIELDS = {
  fontSize: { min: 0.1 },
  lineHeight: { min: 0.1 },
  marginTop: { min: 0 },
  marginBottom: { min: 0 },
  marginLeft: { min: 0 },
  marginRight: { min: 0 },
  marginSide: { min: 0 },
  tocDepth: { min: 1, enum: TOC_DEPTH_VALUES },
};
export const BOOL_FIELDS = ['header', 'colophonEnabled', 'footer', 'meta', 'lead', 'toc', 'outline', 'floatNumbering', 'gbCover', 'gbDefaults', 'linkUrls', 'landscape'];
export const CONTROL_FIELDS = ['enable', 'disable'];
export const SPECIAL_FIELDS = ['margin', 'bibliography', 'fonts'];
export const CONFIG_FIELDS = new Set([
  ...TEXT_FIELDS, ...Object.keys(NUMBER_FIELDS), ...BOOL_FIELDS,
  ...'theme type numbering numberScheme chapterStart'.split(' '), ...CONTROL_FIELDS, ...SPECIAL_FIELDS,
]);

// kebab-case（及少量别名）→ 规范 camelCase
export const FM_ALIASES = {
  colophonEnabled: ['colophon-enabled'],
  fontSize: ['font-size'],
  lineHeight: ['line-height'],
  tocDepth: ['toc-depth'],
  numberScheme: ['number-scheme'],
  chapterStart: ['chapter-start'],
  floatNumbering: ['float-numbering'],
  gbCover: ['gb-cover'],
  gbDefaults: ['gb-defaults'],
  linkUrls: ['link-urls'],
  marginTop: ['margin-top'],
  marginBottom: ['margin-bottom'],
  marginLeft: ['margin-left'],
  marginRight: ['margin-right'],
  marginSide: ['margin-side'],
  headerLeft: ['header-left'],
  headerCenter: ['header-center'],
  headerRight: ['header-right'],
  footerLeft: ['footer-left'],
  footerCenter: ['footer-center'],
  footerRight: ['footer-right'],
};

// Supported metadata from render.mjs and docs/gb-template.md; no type detection is needed.
export const METADATA_FIELDS = ['version', 'name', 'description', 'category', 'author', 'affiliation', 'authors', 'affiliations', 'tags', 'standard', '中文名称', '英文名称', 'title_en', '标准号', '国际标准分类号', 'ICS', 'ics', '中国标准分类号', 'CCS', 'ccs', '发布日期', 'date', '实施日期', '全部代替标准', '代替标准', '发布单位', '发布机构', '发布机构2', '文件类别', '采标国际标准', '采标英文名称', '采标中文名称', '采标程度', 'gb_source_cover', '标准状态', '标准性质', '标准类别', '标准计划', '归口单位', '执行单位', '主管部门', '起草单位', '起草人'];
export const ARRAY_FIELDS = new Set(['enable', 'disable', 'tags', 'authors', 'affiliations', '发布单位', '起草单位', '起草人']);
export const FRONTMATTER_FIELDS = [...new Set([...[...CONFIG_FIELDS].map(field => FM_ALIASES[field]?.[0] || field), ...METADATA_FIELDS.filter(field => field !== 'ics' && field !== 'ccs')])];
export const canonicalFrontmatterField = key => Object.entries(FM_ALIASES).find(([, aliases]) => aliases.includes(key))?.[0] || key;

// Preferred scalar input for ordinary metadata; existing document values are untouched.
export const TEXT_METADATA_FIELDS = new Set(['version', 'author', 'date', '发布日期', '实施日期', '全部代替标准', '代替标准', 'name', 'description', 'category', 'affiliation', 'standard', '中文名称', '英文名称', 'title_en', '标准号', '国际标准分类号', 'ICS', '中国标准分类号', 'CCS', '文件类别', '采标国际标准', '采标英文名称', '采标中文名称', '采标程度', '标准状态', '标准性质', '标准类别', '标准计划', '归口单位', '执行单位', '主管部门']);
export const FEATURES = {
  header: 'header', colophon: 'colophonEnabled', footer: 'footer', meta: 'meta', lead: 'lead', toc: 'toc', outline: 'outline',
  'float-numbering': 'floatNumbering', 'gb-cover': 'gbCover', 'gb-defaults': 'gbDefaults', 'link-urls': 'linkUrls', landscape: 'landscape',
};
export const NUMBERING_VALUES = ['auto', 'force', 'none'];
export const BIBLIOGRAPHY_VALUES = ['footnote', 'bib'];

export const REMOVED_CONTENT_FIELDS = new Set(['abstract','keywords','kicker','colophon','colophon-left','colophon-center','colophon-right','colophonLeft','colophonCenter','colophonRight','bibliography-title','bibliographyTitle']);
