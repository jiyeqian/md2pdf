import { withGbFontFallback } from './src/gb-fonts.mjs';
import { renderDocument } from './runtime.mjs';
import { printDocument } from './print-document.mjs';
export const exportPdf = body => printDocument(body, renderDocument, withGbFontFallback);
