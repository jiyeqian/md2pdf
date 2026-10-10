// 下载名取正文中的首个一级标题，忽略 front matter 与代码块。
export function markdownDownloadName(markdown, date = new Date()) {
  const lines = String(markdown).replace(/^\uFEFF/, '').split(/\r?\n/);
  let fence = null;
  let frontMatter = lines[0] === '---';
  let title = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (frontMatter) {
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) frontMatter = false;
      continue;
    }
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line)) fence = null;
      continue;
    }
    if (marker) { fence = marker[1]; continue; }
    const atx = /^ {0,3}#\s+(.+?)\s*$/.exec(line);
    if (atx) { title = atx[1].replace(/\s+#+\s*$/, ''); break; }
    if (/^ {0,3}\S/.test(line) && /^ {0,3}=+\s*$/.test(lines[i + 1] || '')) { title = line.trim(); break; }
  }
  const stem = title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[.\s]+$/g, '').slice(0, 100).trim() || 'md2pdf_document';
  const pad = n => String(n).padStart(2, '0');
  const stamp = date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + '_' + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
  return stem + '_' + stamp + '.md';
}
