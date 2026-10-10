// Paged.js 会重写 CSS 计数器；分页前保存列表序号，分页后固定页码文本。
// 函数序列化到渲染文档执行，不依赖 Node 或闭包。
export function stampPagedLists(root = document) {
  for (const ol of root.querySelectorAll('main ol')) {
    if (ol.closest('.references, .footnotes, .toc')) continue;
    const items = Array.from(ol.children).filter(li => li.tagName === 'LI');
    const reversed = ol.hasAttribute('reversed');
    const start = parseInt(ol.getAttribute('start'), 10);
    let n = Number.isNaN(start) ? (reversed ? items.length : 1) : start;
    for (const li of items) {
      const value = parseInt(li.getAttribute('value'), 10);
      if (!Number.isNaN(value)) n = value;
      li.setAttribute('data-md2pdf-n', String(n));
      n += reversed ? -1 : 1;
    }
  }
}

export function finalizePagedCounters(showFooter, root = document) {
  const style = root.createElement('style');
  style.textContent = 'ol > li[data-md2pdf-n]::before { content: attr(data-md2pdf-n) !important; counter-increment: none !important; } .md2pdf-page-count::before, .md2pdf-page-count::after { content: none !important; }';
  root.head.appendChild(style);
  if (!showFooter) return;
  const pages = root.querySelectorAll('.pagedjs_page');
  pages.forEach((page, i) => {
    const footer = page.querySelector('.pagedjs_margin-bottom-center .pagedjs_margin-content');
    if (footer) {
      footer.classList.add('md2pdf-page-count');
      footer.textContent = (i + 1) + ' / ' + pages.length;
    }
  });
}
