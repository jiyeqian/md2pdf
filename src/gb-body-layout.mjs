// Both functions are serialized into the standalone paged document.
export function prepareGbBodyLayout(standard) {
  // Paged.js counters can be decremented while splitting nested lists. Freeze source labels first.
  const alpha=n=>{let value='';do{n--;value=String.fromCharCode(97+n%26)+value;n=Math.floor(n/26);}while(n>0);return value;};
  for(const list of document.querySelectorAll('main ol, main ul')){
    if(list.matches('.references,.footnotes,.gb-index-entries')||list.closest('.gb-index'))continue;
    let level=1,parent=list.parentElement?.closest('ol,ul');
    while(parent){level++;parent=parent.parentElement?.closest('ol,ul');}
    let number=Number(list.getAttribute('start'))||1;
    for(const item of list.children){
      if(item.tagName!=='LI')continue;
      const explicit=Number(item.getAttribute('value'));if(item.hasAttribute('value')&&Number.isInteger(explicit)&&explicit>0)number=explicit;
      item.dataset.gbMarker=list.tagName==='OL'?(level===1?alpha(Math.max(1,number)):number)+')':level===1?'——':'•';
      number++;
    }
  }

  if (!document.querySelector('.cover')) {
    const sections = [...document.querySelectorAll('main > section')];
    for (const [index, section] of sections.entries()) {
      if (section.querySelector(':scope > h2.front')) {
        section.dataset.page = 'gb-front';
        if (index) section.dataset.breakBefore = 'page';
      } else if (section.querySelector(':scope > h2.body-start')) {
        section.dataset.page = 'gb-body';
        if (index) section.dataset.breakBefore = 'right';
      }
    }
  }
  const mm = n => n * 96 / 25.4;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const segmenter = new Intl.Segmenter(undefined, {granularity:'grapheme'});
  const ink = element => {
    if (!element) return null;
    const bounds = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (walker.currentNode.data.trim()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const style = getComputedStyle(node.parentElement);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${parseFloat(style.fontSize)*32}px ${style.fontFamily}`;
      const marker = document.createElement('span');
      marker.style.cssText = 'display:inline-block;width:0;height:0;margin:0;padding:0;border:0;vertical-align:baseline;font-size:0;line-height:0;';
      node.after(marker);
      try {
        const runs = [];
        for (const {segment,index} of segmenter.segment(node.data)) {
          if (!segment.trim()) continue;
          const range = document.createRange();
          range.setStart(node,index); range.setEnd(node,index+segment.length);
          const rect = range.getBoundingClientRect();
          if (rect.width && rect.height) runs.push({segment,rect});
        }
        if (!runs.length) continue;
        const baseline = marker.getBoundingClientRect().top, lastTop = runs.at(-1).rect.top;
        for (const {segment,rect} of runs) {
          const m = ctx.measureText(segment), y = baseline + rect.top - lastTop;
          bounds.push({top:y-m.actualBoundingBoxAscent/32,bottom:y+m.actualBoundingBoxDescent/32});
        }
      } finally { marker.remove(); }
    }
    return bounds.length ? {top:Math.min(...bounds.map(b=>b.top)),bottom:Math.max(...bounds.map(b=>b.bottom))} : null;
  };
  const sample = document.createElement('div');
  sample.textContent = standard || '国';
  sample.style.cssText = 'position:absolute;left:-10000px;top:0;width:165mm;font:10.5pt/1 "GB Hei Latin", "GB Hei";text-align:right;';
  document.body.appendChild(sample);
  const header = ink(sample);
  sample.remove();
  if (!header) return;
  const contentTop = mm(25+5) + header.bottom-header.top;
  window.__gbContentTop = contentTop;
  const pageStyle = document.createElement('style');
  pageStyle.textContent = `@page gb-front { margin-top: ${contentTop}px; } @page gb-body { margin-top: ${contentTop}px; }`;
  document.head.appendChild(pageStyle);
  const targetOffset = mm(25+15) + header.bottom-header.top - contentTop;
  const calibrate = (container, heading, title, next, gap) => {
    if (!heading || !title || heading.dataset.gbBodyInkPrepared) return;
    container.style.width = '165mm';
    heading.style.marginTop = '0';
    heading.style.paddingTop = '0';
    if (title !== heading) title.style.marginTop = '0';
    const box = heading.getBoundingClientRect(), titleInk = ink(title);
    if (!titleInk) return;
    heading.style.paddingTop = `${Math.max(0,targetOffset-(titleInk.top-box.top))}px`;
    if (next) {
      const spacer = title === heading ? heading : title;
      // Padding survives page breaks and cannot collapse into neighbouring margins.
      spacer.style.marginBottom = '0';
      spacer.style.paddingBottom = '0';
      if (title === heading) next.style.marginTop = '0';
      const a = ink(title), b = ink(next);
      if (a && b) {
        const adjustment = mm(gap)-(b.top-a.bottom);
        if (adjustment >= 0) spacer.style.paddingBottom = `${adjustment}px`;
        else spacer.style.marginBottom = `${adjustment}px`;
      }
    }
    heading.dataset.gbBodyInkPrepared = 'true';
  };
  const toc = document.querySelector('.toc');
  if (toc) calibrate(toc,toc.querySelector('.toc-title'),toc.querySelector('.toc-title'),toc.querySelector('ol li'),12);
  for (const section of document.querySelectorAll('main > section')) {
    const heading = section.querySelector(':scope > h2.front, :scope > h2.back, :scope > h2.appendix, :scope > h2.body-start');
    if (!heading) continue;
    if (heading.classList.contains('body-start')) {
      const title = heading.querySelector('.gb-body-title');
      if (title) calibrate(section,heading,title,heading.querySelector('.gb-important, .gb-first-heading'),12);
    } else {
      calibrate(section,heading,heading,heading.nextElementSibling,heading.classList.contains('front') ? 12 : 5);
    }
  }
}

export function finalizeGbBodyLayout() {
  const mm = n => n * 96 / 25.4;
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
  const segmenter = new Intl.Segmenter(undefined,{granularity:'grapheme'});
  const ink = (element, box) => {
    if (!element) return null;
    const origin = box.getBoundingClientRect(), sx = origin.width/mm(210), sy = origin.height/mm(297), bounds = [];
    const walker = document.createTreeWalker(element,NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) if (walker.currentNode.data.trim()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const style = getComputedStyle(node.parentElement);
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${parseFloat(style.fontSize)*32}px ${style.fontFamily}`;
      const marker = document.createElement('span');
      marker.style.cssText = 'display:inline-block;width:0;height:0;margin:0;padding:0;border:0;vertical-align:baseline;font-size:0;line-height:0;';
      node.after(marker);
      try {
        const runs = [];
        for (const {segment,index} of segmenter.segment(node.data)) {
          if (!segment.trim()) continue;
          const range = document.createRange(); range.setStart(node,index); range.setEnd(node,index+segment.length);
          const rect = range.getBoundingClientRect();
          if (rect.width && rect.height) runs.push({segment,rect});
        }
        if (!runs.length) continue;
        const baseline = (marker.getBoundingClientRect().top-origin.top)/sy, lastTop = runs.at(-1).rect.top;
        for (const {segment,rect} of runs) {
          const m = ctx.measureText(segment), x = (rect.left-origin.left)/sx, y = baseline+(rect.top-lastTop)/sy;
          bounds.push({left:x-m.actualBoundingBoxLeft/32,right:x+m.actualBoundingBoxRight/32,top:y-m.actualBoundingBoxAscent/32,bottom:y+m.actualBoundingBoxDescent/32});
        }
      } finally { marker.remove(); }
    }
    return bounds.length ? {left:Math.min(...bounds.map(b=>b.left)),right:Math.max(...bounds.map(b=>b.right)),top:Math.min(...bounds.map(b=>b.top)),bottom:Math.max(...bounds.map(b=>b.bottom))} : null;
  };
  for (const page of document.querySelectorAll('.pagedjs_page')) {
    const box = page.querySelector('.pagedjs_pagebox');
    if (!box) continue;
    const right = page.classList.contains('pagedjs_right_page');
    const header = page.querySelector('.gb-fixed-header'), footer = page.querySelector('.gb-fixed-page-number');
    const h = ink(header,box);
    if (h) {
      header.style.top = `${parseFloat(getComputedStyle(header).top)+mm(25)-h.top}px`;
      header.style.left = `${parseFloat(getComputedStyle(header).left)+(right ? mm(190)-h.right : mm(20)-h.left)}px`;
    }
    const f = ink(footer,box);
    if (f) {
      footer.style.bottom = `${parseFloat(getComputedStyle(footer).bottom)+f.bottom-mm(277)}px`;
      const side = right ? 'right' : 'left';
      footer.style[side] = `${parseFloat(getComputedStyle(footer)[side])+(right ? f.right-mm(186) : mm(24)-f.left)}px`;
    }
  }
}
