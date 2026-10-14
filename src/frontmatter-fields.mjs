export const TEXT_FIELDS = ['title', 'kicker', 'colophonLeft', 'colophonCenter', 'colophonRight', 'headerLeft', 'headerCenter', 'headerRight', 'footerLeft', 'footerCenter', 'footerRight', 'bibliographyTitle'];
export const NUMBER_FIELDS = {
  fontSize: { min: 0.1 },
  lineHeight: { min: 0.1 },
  marginTop: { min: 0 },
  marginBottom: { min: 0 },
  marginLeft: { min: 0 },
  marginRight: { min: 0 },
  marginSide: { min: 0 },
  tocDepth: { min: 1, enum: [1, 2] },
};
export const BOOL_FIELDS = ['header', 'colophonEnabled', 'footer', 'meta', 'lead', 'toc', 'outline', 'floatNumbering', 'gbCover', 'gbDefaults', 'linkUrls', 'landscape'];
export const CONTROL_FIELDS = ['enable', 'disable'];
export const SPECIAL_FIELDS = ['margin', 'bibliography'];
export const CONFIG_FIELDS = new Set([
  ...TEXT_FIELDS, ...Object.keys(NUMBER_FIELDS), ...BOOL_FIELDS,
  ...'theme type numbering numberScheme'.split(' '), ...CONTROL_FIELDS, ...SPECIAL_FIELDS,
]);

// kebab-case（及少量别名）→ 规范 camelCase
export const FM_ALIASES = {
  fontSize: ['font-size'],
  lineHeight: ['line-height'],
  tocDepth: ['toc-depth'],
  numberScheme: ['number-scheme'],
  floatNumbering: ['float-numbering'],
  gbCover: ['gb-cover'],
  gbDefaults: ['gb-defaults'],
  linkUrls: ['link-urls'],
  marginTop: ['margin-top'],
  marginBottom: ['margin-bottom'],
  marginLeft: ['margin-left'],
  marginRight: ['margin-right'],
  marginSide: ['margin-side'],
  colophonLeft: ['colophon-left', 'colophon'],
  colophonCenter: ['colophon-center'],
  colophonRight: ['colophon-right'],
  headerLeft: ['header-left'],
  headerCenter: ['header-center'],
  headerRight: ['header-right'],
  footerLeft: ['footer-left'],
  footerCenter: ['footer-center'],
  footerRight: ['footer-right'],
  bibliographyTitle: ['bibliography-title'],
};

// Supported metadata from render.mjs and docs/gb-template.md; no type detection is needed.
export const METADATA_FIELDS = ['name', 'description', 'category', 'author', 'affiliation', 'abstract', 'keywords', 'standard', '中文名称', '英文名称', 'title_en', '标准号', '国际标准分类号', 'ICS', 'ics', '中国标准分类号', 'CCS', 'ccs', '发布日期', 'date', '实施日期', '全部代替标准', '代替标准', '发布单位', '发布机构', '发布机构2', '文件类别', '采标国际标准', '采标英文名称', '采标中文名称', '采标程度', 'gb_source_cover', '标准状态', '标准性质', '标准类别', '标准计划', '归口单位', '执行单位', '主管部门', '起草单位', '起草人'];
export const ARRAY_FIELDS = new Set(['enable', 'disable', '发布单位', '起草单位', '起草人']);
export const FRONTMATTER_FIELDS = [...new Set([...[...CONFIG_FIELDS].map(field => FM_ALIASES[field]?.[0] || field), ...METADATA_FIELDS])];
export const canonicalFrontmatterField = key => Object.entries(FM_ALIASES).find(([, aliases]) => aliases.includes(key))?.[0] || key;
