import { isFontFamilyName } from './fonts.mjs';
export const GB_FONT_CHECKS = [
  ['10.5pt "GB Song"', undefined, '方正书宋_GBK'],
  ['10.5pt "GB Hei"', undefined, '方正黑体_GBK'],
  ['17pt "GB Cover"', undefined, '方正小标宋_GBK'],
  ['14pt "GB Cover Latin"', 'ABCabc-', '方正小标宋_GBK'],
  ['10.5pt "GB Hei Latin"', 'ABCabc', 'Times New Roman 粗体'],
  ['10.5pt "GB Symbols"', '−•', 'Times New Roman 普通'],
];

// Serialized into documents; do not reference module globals here.
export async function requireGbFonts(checks) {
  const missing = await Promise.all(checks.map(async ([font, text, label]) => {
    try { return (await document.fonts.load(font, text ?? 'BESbswy')).length ? null : label; }
    catch { return label; }
  }));
  const fonts = [...new Set(missing.filter(Boolean))];
  if (fonts.length) {
    window.__md2pdfFontError = { code: checks.some(check => check[3] === 'custom') ? 'FONT_MISSING' : 'GB_FONT_MISSING', fonts };
    throw new Error('未能加载字体：' + fonts.join('、') + '。');
  }
  return document.fonts.ready;
}

// Expose only known GB or validated user family names, never raw errors or paths.
export function gbFontDiagnostic(value) {
  if (!['GB_FONT_MISSING','FONT_MISSING'].includes(value?.code)) return null;
  if (value.code === 'FONT_MISSING') {
    const fonts = [...new Set((Array.isArray(value.fonts) ? value.fonts : []).filter(isFontFamilyName))].slice(0,12);
    return fonts.length ? {code:'FONT_MISSING',fonts} : null;
  }
  const known = [...new Set(GB_FONT_CHECKS.map(([, , label]) => label))];
  const fonts = known.filter(label => Array.isArray(value.fonts) && value.fonts.includes(label));
  return { code: 'GB_FONT_MISSING', fonts: fonts.length ? fonts : known };
}

// Only called by export entry points after explicit user confirmation.
export function withGbFontFallback(html) {
  return html.replace('<head>', '<head><script>window.__md2pdfAllowFontFallback=true;</script>');
}
