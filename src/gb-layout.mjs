export function prepareGbLayout() {
  const cover = document.querySelector('.cover');
  if (!cover || cover.dataset.gbInkPrepared === 'true') return;
  const mm = value => value * 96 / 25.4;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const shifts = new WeakMap();
  const glyphs = new Map();
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  // A zero-size inline block exposes the real baseline. Range positions preserve
  // browser wrapping/spacing; Canvas supplies glyph ink extents relative to it.
  const ink = element => {
    if (!element) return null;
    const origin = cover.getBoundingClientRect();
    const scaleX = origin.width / mm(210), scaleY = origin.height / mm(297);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (walker.currentNode.data.trim()) nodes.push(walker.currentNode);
    const bounds = [];
    for (const node of nodes) {
      const style = getComputedStyle(node.parentElement);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      // Measure outlines at a larger size to reduce font-size quantization;
      // divide back to CSS pixels without changing the rendered font size.
      const metricScale = 32;
      context.font = `${style.fontStyle} ${style.fontWeight} ${parseFloat(style.fontSize) * metricScale}px ${style.fontFamily}`;
      const marker = document.createElement('span');
      marker.setAttribute('aria-hidden', 'true');
      marker.style.cssText = 'display:inline-block;position:static;float:none;width:0;height:0;min-width:0;min-height:0;margin:0;padding:0;border:0;vertical-align:baseline;font-size:0;line-height:0;transform:none;';
      node.after(marker);
      try {
        const runs = [];
        for (const { segment, index } of segmenter.segment(node.data)) {
          const range = document.createRange();
          range.setStart(node, index); range.setEnd(node, index + segment.length);
          const rect = range.getBoundingClientRect();
          if (segment.trim() && rect.width && rect.height) runs.push({ segment, rect });
        }
        if (!runs.length) continue;
        const baseline = (marker.getBoundingClientRect().top - origin.top) / scaleY;
        const lastTop = runs.at(-1).rect.top;
        for (const { segment, rect } of runs) {
          const key = font + '\0' + segment;
          let metrics = glyphs.get(key);
          if (!metrics) { metrics = context.measureText(segment); glyphs.set(key, metrics); }
          const x = (rect.left - origin.left) / scaleX;
          const y = baseline + (rect.top - lastTop) / scaleY;
          bounds.push({ left:x - metrics.actualBoundingBoxLeft / metricScale, right:x + metrics.actualBoundingBoxRight / metricScale,
            top:y - metrics.actualBoundingBoxAscent / metricScale, bottom:y + metrics.actualBoundingBoxDescent / metricScale });
        }
      } finally { marker.remove(); }
    }
    if (!bounds.length) return null;
    const left = Math.min(...bounds.map(b => b.left)), right = Math.max(...bounds.map(b => b.right));
    const top = Math.min(...bounds.map(b => b.top)), bottom = Math.max(...bounds.map(b => b.bottom));
    return { left, right, top, bottom, width:right-left, height:bottom-top };
  };
  const move = (element, x = 0, y = 0) => {
    if (!element) return;
    const before = shifts.get(element) || {x:0,y:0};
    const next = {x:before.x+x,y:before.y+y};
    shifts.set(element,next);
    element.style.transform = `translate(${next.x}px, ${next.y}px)`;
  };
  const place = (element, target) => {
    const bounds = ink(element);
    if (!bounds) return null;
    const x = target.left !== undefined ? target.left-bounds.left
      : target.right !== undefined ? target.right-bounds.right
      : target.center !== undefined ? target.center-(bounds.left+bounds.right)/2 : 0;
    const y = target.top !== undefined ? target.top-bounds.top
      : target.bottom !== undefined ? target.bottom-bounds.bottom : 0;
    move(element,x,y);
    return ink(element);
  };
  const withinWidth = (bounds, label) => {
    if (bounds && (bounds.left < mm(25)-.5 || bounds.right > mm(195)+.5)) {
      throw new Error(`国家标准封面${label}超出版心，已停止导出；请检查内容和换行`);
    }
  };
  const ics = cover.querySelector('.cover-ics');
  if (ics) {
    for (const node of [...ics.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE || !node.data.trim()) continue;
      const line = document.createElement('span');
      line.className = 'gb-cover-ics-line';
      node.replaceWith(line); line.appendChild(node);
    }
    place(ics, {top:mm(10)});
    for (const line of ics.querySelectorAll('.gb-cover-ics-line')) place(line, {left:mm(25)});
  }

  const banner = cover.querySelector('.cover-head');
  let bannerInk = ink(banner);
  if (bannerInk) {
    banner.style.height = 'auto';
    for (let attempt=0; attempt<3; attempt++) {
      bannerInk = ink(banner);
      const size = parseFloat(getComputedStyle(banner).fontSize);
      banner.style.fontSize = (size * mm(8) / bannerInk.height) + 'px';
    }
    bannerInk = ink(banner);
    banner.style.width = (parseFloat(getComputedStyle(banner).width) + mm(170)-bannerInk.width) + 'px';
    place(banner, {left:mm(25),top:mm(42)});
  }

  const number = cover.querySelector('.cover-stdno');
  const numberInk = place(number, {right:mm(190),top:mm(59)});
  withinWidth(numberInk,'标准号');
  const superseded = cover.querySelector('.cover-sup');
  const supersededInk = numberInk ? place(superseded, {right:mm(190),top:numberInk.bottom+mm(3)}) : null;
  withinWidth(supersededInk,'代替文件编号');
  if ((supersededInk || numberInk)?.bottom > mm(75)-.5) {
    throw new Error('国家标准封面标准号或代替文件编号过长，已停止导出以避免覆盖分隔线');
  }

  const chinese = cover.querySelector('.cover-cn');
  let last = place(chinese, {center:mm(110),top:mm(115)});
  withinWidth(last,'名称');
  const english = cover.querySelector('.cover-en');
  if (last && ink(english)) {
    last = place(english, {center:mm(110),top:last.bottom+mm(10)});
    withinWidth(last,'英文译名');
  }
  const adoption = cover.querySelector('.cover-iso');
  if (last && ink(adoption)) {
    last = place(adoption, {center:mm(110),top:last.bottom+mm(15)});
    withinWidth(last,'采标信息');
  }

  const dateSlots = [...cover.querySelectorAll('.cover-dates > span')];
  const dates = dateSlots.filter(element => element.textContent.trim());
  dateSlots.forEach((element,index) => place(element, {
    ...(index === 0 ? {left:mm(25)} : {right:mm(195)}), bottom:mm(256.5),
  }));
  const dateInk = dates.map(ink);
  dateInk.forEach(bounds => withinWidth(bounds,'日期'));
  if (dateInk.length === 2 && dateInk[0].right >= dateInk[1].left) {
    throw new Error('国家标准封面发布日期与实施日期重叠，已停止导出；请检查日期内容');
  }
  const names = cover.querySelector('.cover-org-names');
  const issuerRows = [...(names?.querySelectorAll('.cover-org-name') || [])].filter(row => row.textContent.trim());
  // Profiles record first-to-last glyph origins in independently measured covers.
  // Keep these inside the function: it is serialized into all three runtimes.
  const issuerProfiles = [
    { names:['国家市场监督管理总局','国家标准化管理委员会'], span:61.001275 },
    { names:['中华人民共和国国家质量监督检验检疫总局','中国国家标准化管理委员会'], span:99.82023611111111 },
    { names:['中华人民共和国国家卫生健康委员会','国家市场监督管理总局'], span:83.18323611111109 },
  ];
  const rows = issuerRows.map(row => {
    row.textContent = row.textContent.trim().replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '');
    row.style.letterSpacing = '0px';
    const node = row.firstChild;
    const segments = [...segmenter.segment(node.data)];
    const origins = segments.map(({index,segment}) => {
      const range = document.createRange();
      range.setStart(node,index); range.setEnd(node,index+segment.length);
      return range.getBoundingClientRect().left;
    });
    const scale = cover.getBoundingClientRect().width / mm(210);
    return {row, count:segments.length, span:(origins.at(-1)-origins[0])/scale,
      width:row.getBoundingClientRect().width/scale};
  });
  const profile = issuerProfiles.find(profile => profile.names.length === rows.length &&
    profile.names.every((name,index) => name === rows[index].row.textContent));
  const target = profile ? mm(profile.span) : Math.max(0,...rows.map(row => row.span+mm(.78)*Math.max(0,row.count-1)));
  for (const {row,count,span,width} of rows) {
    if (count < 2) continue;
    const extra = target-span;
    row.style.letterSpacing = `${extra/(count-1)}px`;
    // CSS includes trailing tracking; exclude it from the shared row box.
    row.style.width = `${width+extra}px`;
  }
  let namesInk = place(names, {bottom:mm(277)});
  const publisher = cover.querySelector('.cover-org-pub');
  if (namesInk && ink(publisher)) {
    const pubInk = ink(publisher);
    move(publisher,0,(namesInk.top+namesInk.bottom-pubInk.top-pubInk.bottom)/2);
    const [fa,bu] = publisher.querySelectorAll('span');
    const faInk = place(fa,{left:namesInk.right+mm(5)});
    if (faInk) place(bu,{left:faInk.right+mm(3)});
    const group = ink(cover.querySelector('.cover-org'));
    const dx = mm(110)-(group.left+group.right)/2;
    move(names,dx,0); move(publisher,dx,0);
    namesInk = ink(names);
  }
  withinWidth(ink(cover.querySelector('.cover-org')),'发布机构');
  const boundaries = [...dates.map(ink),namesInk].filter(Boolean).map(bounds => bounds.top);
  if (last && boundaries.length && last.bottom > Math.min(...boundaries)-mm(20)) {
    throw new Error('国家标准封面名称、英文译名或采标信息过长，已停止导出以避免覆盖日期或发布机构；请检查内容和换行');
  }
  cover.dataset.gbInkPrepared = 'true';
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
