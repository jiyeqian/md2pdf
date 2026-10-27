export function prepareGbLayout() {
  const content = document.querySelector('.cover-main');
  const boundaries = [...document.querySelectorAll('.cover-dates, .cover-org')]
    .filter(element => element.textContent.trim()).map(element => element.getBoundingClientRect().top);
  if (content && boundaries.length && content.getBoundingClientRect().bottom > Math.min(...boundaries) - 20 * 96 / 25.4) {
    throw new Error('国家标准封面名称、英文译名或采标信息过长，已停止导出以避免覆盖日期或发布机构；请检查内容和换行');
  }
}

// Paged.js margin-box font/vertical alignment support differs from ordinary CSS.
// Position the final labels in millimetres on each actual sheet, for all runtimes.
export function finalizeGbLayout(standard) {
  const pages = [...document.querySelectorAll('.pagedjs_page')];
  let front = 0, body = 0;
  const roman = number => {
    let result = '';
    for (const [value, glyph] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']]) {
      while (number >= value) { result += glyph; number -= value; }
    }
    return result;
  };
  for (const page of pages) {
    if (page.matches('.pagedjs_blank_page,.pagedjs_gb-cover_page,.pagedjs_gb-back-cover_page')) continue;
    const isFront = page.classList.contains('pagedjs_gb-front_page');
    const number = isFront ? ++front : ++body;
    const label = isFront ? roman(number) : String(number);
    page.dataset.gbPage = label;
    const right = page.classList.contains('pagedjs_right_page');
    for (const margin of page.querySelectorAll('.pagedjs_margin-content')) margin.style.visibility = 'hidden';
    const box = page.querySelector('.pagedjs_pagebox');
    if (standard) {
      const header = document.createElement('div');
      header.className = 'gb-fixed-header';
      header.textContent = standard;
      Object.assign(header.style, {position:'absolute',top:'25mm',left:right?'25mm':'20mm',width:'165mm',fontFamily:'"GB Hei"',fontSize:'10.5pt',lineHeight:'1',textAlign:right?'right':'left',color:'#000'});
      box.appendChild(header);
    }
    const footer = document.createElement('div');
    footer.className = 'gb-fixed-page-number';
    footer.textContent = label;
    Object.assign(footer.style, {position:'absolute',bottom:'20mm',[right?'right':'left']:'24mm',fontFamily:'"GB Song"',fontSize:'9pt',lineHeight:'1',color:'#000'});
    box.appendChild(footer);
  }
  for (const anchor of document.querySelectorAll('.pagedjs_pages .toc a[href^="#"]')) {
    const id = anchor.getAttribute('href').slice(1);
    const target = pages.map(page => page.querySelector('[id="' + CSS.escape(id) + '"]')).find(Boolean);
    if (target) anchor.dataset.gbPage = target.closest('.pagedjs_page').dataset.gbPage || '';
  }
  for (const note of document.querySelectorAll('.pagedjs_footnote_area .gb-footnote')) {
    const marker = [...note.classList].find(name => /^gb-footnote-\d+$/.test(name));
    if (!marker) continue;
    note.id = marker;
    for (const link of document.querySelectorAll('.' + marker + '[data-footnote-call]')) link.setAttribute('href','#' + marker);
  }
  const style = document.createElement('style');
  style.textContent = '.pagedjs_pages .toc a[data-gb-page]::after { content: attr(data-gb-page) !important; }';
  document.head.appendChild(style);
}
