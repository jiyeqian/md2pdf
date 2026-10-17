import { enhancePreview } from './preview.mjs';
const DOC_CSP = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
export function prepareWebDocument(html, { scripts, logoUrl, logoData, preview = false, type = 'general' }) {
  for (const [url, data] of scripts) {
    html = html.replaceAll(`<script src="${url}"></script>`, () => `<script src="${data}"></script>`);
    html = html.replaceAll(`<script src="${url}" id="MathJax-script"></script>`, () => `<script id="MathJax-script" src="${data}"></script>`);
  }
  html = html.replaceAll(logoUrl, logoData);
  html = html.replace(/\.catch\(function \(\) \{ window\.__md2pdf(Mermaid|Paged)Ready = true; \}\)/g, (_, name) => `.catch(function (e) { window.__md2pdf${name}Error = String(e); window.__md2pdf${name}Ready = true; })`);
  html = html.replace(/catch \(e\) \{ window\.__md2pdf(Mermaid|Paged)Ready = true; \}/g, (_, name) => `catch (e) { window.__md2pdf${name}Error = String(e); window.__md2pdf${name}Ready = true; }`);
  html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${DOC_CSP}"><meta name="referrer" content="no-referrer">`);
  return preview ? enhancePreview(html, type) : html;
}
