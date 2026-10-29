export const GB_FONT_CHECKS = [
  ['10.5pt "GB Song"', undefined, '方正书宋_GBK'],
  ['10.5pt "GB Hei"', undefined, '方正黑体_GBK'],
  ['17pt "GB Cover"', undefined, '方正小标宋_GBK'],
  ['14pt "GB Cover Latin"', 'ABCabc-', '方正小标宋_GBK'],
  ['10.5pt "GB Hei Latin"', 'ABCabc', 'Times New Roman 粗体'],
  ['10.5pt "GB Symbols"', '−•', 'Times New Roman 普通'],
];

// Serialized into GB documents; do not reference module globals here.
export async function requireGbFonts(checks) {
  const missing = await Promise.all(checks.map(async ([font, text, label]) => {
    try { return (await document.fonts.load(font, text ?? 'BESbswy')).length ? null : label; }
    catch { return label; }
  }));
  const fonts = [...new Set(missing.filter(Boolean))];
  if (fonts.length) {
    window.__md2pdfFontError = { code: 'GB_FONT_MISSING', fonts };
    throw new Error('国家标准所需字体未能加载：' + fonts.join('、') + '。请确认渲染设备已安装这些字体且渲染进程可访问。');
  }
  return document.fonts.ready;
}

// Only allow known public family names across the browser/server error boundary.
export function gbFontDiagnostic(value) {
  if (value?.code !== 'GB_FONT_MISSING') return null;
  const known = [...new Set(GB_FONT_CHECKS.map(([, , label]) => label))];
  const fonts = known.filter(label => Array.isArray(value.fonts) && value.fonts.includes(label));
  return { code: 'GB_FONT_MISSING', fonts: fonts.length ? fonts : known };
}

// Only called by export entry points after explicit user confirmation.
export function withGbFontFallback(html) {
  return html.replace('<head>', '<head><script>window.__md2pdfAllowFontFallback=true;</script>');
}
