// Serialized into the sandboxed preview; metadata never adds inline layout boxes.
export function installContentSync({ activeScope, revision, beforeLocate }) {
  const metadata = document.querySelector('script[data-md2pdf-content-map]');
  let source = [];
  try { source = JSON.parse(metadata?.textContent || '[]'); } catch { /* Legacy preview. */ }
  if (!source.length) return { bind() {}, refresh() { return []; }, capture() { return null; }, suppress() {}, locate() {}, outline() {} };
  const byId = new Map(source.map(item => [String(item.id), item]));
  let fragments = [], scoped = null, dirty = true, programmaticUntil = 0, userScroll = false, pending = 0;
  const tags = 'p,li,td,th,pre,h1,h2,h3,h4,h5,h6,caption,figcaption,.gb-important-paragraph,.keywords > .summary-content';
  const skip = 'script,style,svg,mjx-container,.fnref,.link-url,.gb-term-number,.gb-label,.gb-continuation,.gb-footnote,.gb-footnote-repeat,.gb-float-footnote-call,.gb-float-footnotes';
  const captionPrefix = /^[图表]\s*[A-Z]?(?:\d+(?:\.\d+)*)(?:\s*[：:]\s*|\s+)/;
  const ownText = node => {
    const points = [], walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let current, whitespace = null;
    while ((current = walker.nextNode())) {
      if (current.nodeType === 1) {
        if (current.tagName === 'BR' && points.length && !whitespace) whitespace = { ...points.at(-1), char: ' ' };
        continue;
      }
      const parent = current.parentElement;
      if (!parent || parent.closest(skip)) continue;
      const ref = parent.closest('a.ref');
      if (ref && /^#(?:fig|tab|sec)-/.test(ref.getAttribute('href') || '') && /^[\dA-Z.]+$/.test(ref.textContent.trim())) continue;
      if (node.matches('li') && parent.closest('li') !== node) continue;
      for (let offset = 0; offset < current.length; offset++) {
        if (/\s/.test(current.data[offset])) {
          if (points.length && !whitespace) whitespace = { node: current, offset, char: ' ' };
        } else {
          if (whitespace) { points.push(whitespace); whitespace = null; }
          points.push({ node: current, offset, char: current.data[offset] });
        }
      }
    }
    return { text: points.map(point => point.char).join(''), points };
  };
  const meaningful = node => !node.closest('.toc,.cover,.references,.footnotes') && !node.closest('pre')?.contains(node.parentElement);

  function bind() {
    const candidates = [...document.querySelectorAll(tags)].filter(meaningful);
    const cursors = new Map(), used = new Set();
    const cache = new Map();
    const text = node => { if (!cache.has(node)) cache.set(node, ownText(node).text); return cache.get(node); };
    const isTag = (node, tag) => node.matches(tag || 'p') || (tag === 'p' && node.matches('.gb-important-paragraph,.keywords > .summary-content'));
    const counts = new Map();
    for (const item of source) {
      if (!['text', 'code'].includes(item.kind) || !item.text) continue;
      const key = item.tag + '\n' + item.text;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const candidateCounts = new Map();
    for (const node of candidates) {
      const tag = node.matches('.gb-important-paragraph,.keywords > .summary-content') ? 'p' : node.tagName.toLowerCase();
      const value = node.matches('caption,figcaption') ? text(node).replace(captionPrefix, '') : text(node);
      const key = tag + '\n' + value;
      candidateCounts.set(key, (candidateCounts.get(key) || 0) + 1);
    }
    const ambiguous = new Set();
    for (const [key, count] of counts) {
      if (candidateCounts.get(key) !== count) ambiguous.add(key);
    }
    for (const item of source) {
      if (ambiguous.has(item.tag + '\n' + item.text)) continue;
      let target;
      if (item.kind === 'reference') target = document.getElementById('fn-' + item.number);
      else if (item.kind === 'math') target = [...document.querySelectorAll('main mjx-container')].find(node => !used.has(node));
      else if (item.kind === 'object' && /^gb-[\w-]+$/.test(item.key || '')) {
        const selector = item.key === 'gb-table' ? 'main table' : '.' + item.key;
        target = [...document.querySelectorAll(selector)].find(node => !used.has(node));
      }
      else if (item.kind === 'image') {
        const images = [...document.querySelectorAll('main img')].filter(node => !used.has(node));
        target = images[0];
      } else {
        const key = item.kind === 'diagram' ? 'diagram' : item.tag;
        const start = cursors.get(key) || 0;
        for (let index = start; index < candidates.length; index++) {
          const node = candidates[index];
          if (used.has(node)) continue;
          let matches = false;
          if (item.kind === 'diagram') matches = node.matches('pre.mermaid');
          else if (isTag(node, item.tag)) {
            const actual = text(node);
            matches = !!item.text && (actual === item.text || (node.matches('caption,figcaption') && actual.replace(captionPrefix, '') === item.text)
              || (item.kind === 'heading' && actual.endsWith(item.text) && Number(node.dataset.md2pdfSourceLine) === item.line));
          }
          if (matches) { target = node; cursors.set(key, index + 1); break; }
        }
      }
      if (!target) continue; // Unverified/generated content keeps the heading fallback.
      target.dataset.md2pdfSourceId = String(item.id);
      used.add(target);
      if (item.kind === 'object') target.querySelectorAll('mjx-container,img').forEach(node => used.add(node));
      if (target.closest('table')) used.add(target.closest('table'));
    }
    dirty = true;
  }

  function refresh() {
    const scope = activeScope();
    if (!scope) return [];
    if (!dirty && scope === scoped) return fragments;
    scoped = scope; dirty = false;
    const progress = new Map();
    fragments = [...scope.querySelectorAll('[data-md2pdf-source-id]')].flatMap(node => {
      const item = byId.get(node.dataset.md2pdfSourceId);
      if (!item) return [];
      const canonical = ownText(node);
      const atomic = !item.text || ['reference', 'image', 'diagram', 'math', 'object'].includes(item.kind);
      let start = 0, points = canonical.points;
      if (!atomic) {
        const repeated = !!node.closest('[data-repeated-header]');
        start = item.text.indexOf(canonical.text, repeated ? 0 : progress.get(item.id) || 0);
        // Numbered headings own a generated prefix; all other text must verify exactly.
        if (start < 0 && (item.kind === 'heading' || node.matches('caption,figcaption')) && canonical.text.endsWith(item.text)) {
          points = points.slice(canonical.text.length - item.text.length); start = 0;
        } else if (start < 0 || !canonical.text) return [];
        if (!repeated) progress.set(item.id, start + points.length);
      }
      return [{ node, item, start, points, atomic }];
    });
    return fragments;
  }

  function rectAt(fragment, index) {
    const point = fragment.points[index];
    if (!point || fragment.atomic) return fragment.node.getBoundingClientRect();
    const range = document.createRange();
    range.setStart(point.node, point.offset);
    // Avoid cutting an astral character in half.
    const length = point.node.data.codePointAt(point.offset) > 0xffff ? 2 : 1;
    range.setEnd(point.node, Math.min(point.node.length, point.offset + length));
    return range.getBoundingClientRect();
  }

  function atSource(from) {
    const all = refresh();
    const containing = all.filter(part => part.item.from <= from && from <= part.item.to);
    containing.sort((a, b) => (a.item.to - a.item.from) - (b.item.to - b.item.from));
    const selected = containing[0] || all.filter(part => part.item.kind === 'heading' && part.item.from <= from).at(-1);
    if (!selected) return null;
    const same = all.filter(part => part.item.id === selected.item.id);
    let best = null;
    for (const fragment of same) {
      if (fragment.atomic) return { fragment, index: 0, rect: rectAt(fragment, 0) };
      let low = 0, high = fragment.points.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (fragment.item.positions[fragment.start + middle] < from) low = middle + 1; else high = middle;
      }
      for (let index = Math.max(0, low - 1); index < Math.min(fragment.points.length, low + 1); index++) {
        const position = fragment.item.positions[fragment.start + index];
        const distance = Math.abs(position - from);
        if (!best || distance < best.distance) best = { fragment, index, distance };
      }
    }
    return best && { ...best, rect: rectAt(best.fragment, best.index) };
  }

  // A fixed overlay does not change line wrapping, pagination, or text selection.
  let overlay, overlayTimer;
  function highlight(from, to, anchor) {
    overlay?.remove(); clearTimeout(overlayTimer);
    overlay = document.createElement('div');
    overlay.dataset.md2pdfSyncHighlight = '';
    overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
    const rects = [];
    if (to > from) {
      for (const part of refresh()) {
        if (part.item.to < from || part.item.from > to) continue;
        const visible = part.node.getBoundingClientRect();
        if (visible.bottom <= 0 || visible.top >= innerHeight) continue;
        if (part.atomic) { rects.push(part.node.getBoundingClientRect()); continue; }
        const indices = part.points.map((_, i) => i).filter(i => {
          const pos = part.item.positions[part.start + i]; return pos >= from && pos < to;
        });
        // DOM ranges aggregate adjacent characters into line rectangles.
        if (indices.length) {
          const first = part.points[indices[0]], last = part.points[indices.at(-1)];
          const range = document.createRange(); range.setStart(first.node, first.offset); range.setEnd(last.node, last.offset + 1);
          rects.push(...range.getClientRects());
        }
      }
    } else if (anchor?.rect) rects.push(anchor.rect);
    // Limit drawing to the viewport; a whole-document selection stays inexpensive.
    for (const rect of rects.filter(r => r.bottom > 0 && r.top < innerHeight && r.width > 0 && r.height > 0).slice(0, 250)) {
      const mark = document.createElement('div');
      mark.style.cssText = `position:absolute;left:${rect.left}px;top:${rect.top}px;width:${Math.max(2, rect.width)}px;height:${rect.height}px;background:#42648b26;border-radius:2px;`;
      overlay.appendChild(mark);
    }
    document.body.appendChild(overlay);
    overlayTimer = setTimeout(() => overlay?.remove(), 1800);
  }

  function locate(data) {
    if (!Number.isSafeInteger(data.from) || data.from < 0) return;
    const anchor = atSource(data.from);
    if (!anchor) return;
    beforeLocate();
    userScroll = false; programmaticUntil = Date.now() + 200;
    const ratio = Number.isFinite(data.ratio) ? Math.max(0, Math.min(1, data.ratio)) : .3;
    const rect = anchor.rect;
    if (data.reason === 'scroll' || data.instant || rect.top < 12 || rect.bottom > innerHeight - 12) {
      scrollBy({ top: rect.top - innerHeight * ratio, behavior: 'instant' });
    }
    if (data.reason !== 'scroll') {
      const updated = atSource(data.from);
      highlight(data.from, Number.isSafeInteger(data.to) ? data.to : data.from, updated);
    }
  }

  function atPoint(x, y) {
    const all = refresh();
    const hit = document.elementFromPoint(x, y);
    const parent = hit?.closest('[data-md2pdf-source-id]');
    let fragment = all.find(part => part.node === parent);
    if (!fragment) fragment = all.reduce((best, part) => {
      const rect = part.node.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= innerHeight) return best;
      const distance = rect.top > y ? rect.top - y : rect.bottom < y ? y - rect.bottom : 0;
      return !best || distance < best.distance ? { part, distance } : best;
    }, null)?.part;
    if (!fragment) return null;
    if (fragment.atomic || !fragment.points.length) return { from: fragment.item.from, rect: fragment.node.getBoundingClientRect() };
    let best = null;
    // Binary search by the display line first. Inspect just that line for clicks.
    let low = 0, high = fragment.points.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1, rect = rectAt(fragment, middle);
      if (rect.bottom < y) low = middle + 1; else high = middle;
    }
    for (let index = low; index < fragment.points.length; index++) {
      const rect = rectAt(fragment, index);
      if (best && rect.top > y && rect.top > best.rect.bottom) break;
      const vertical = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
      const horizontal = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
      const distance = vertical * 10000 + horizontal;
      if (!best || distance < best.distance) best = { from: fragment.item.positions[fragment.start + index], rect, distance };
      if (index - low > 600) break;
    }
    return best;
  }

  function capture() {
    const scope = activeScope();
    const box = scope?.getBoundingClientRect();
    const anchor = atPoint(box ? (box.left + box.right) / 2 : innerWidth / 2, innerHeight * .3);
    return anchor && { from: anchor.from, anchorRatio: anchor.rect.top / Math.max(1, innerHeight) };
  }
  function outline(node) {
    const mapped = node.closest('[data-md2pdf-source-id]') || node.querySelector('[data-md2pdf-source-id]');
    const line = Number(node.dataset.md2pdfSourceLine || node.closest('[data-md2pdf-source-line]')?.dataset.md2pdfSourceLine);
    const item = byId.get(mapped?.dataset.md2pdfSourceId) || source.find(item => item.kind === 'heading' && item.line === line);
    if (item) send('outline', { from: item.from, to: item.to, rect: { top: 0 } });
  }
  function selectionSource() {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0), scope = activeScope();
    if (!scope?.contains(range.startContainer) || !scope.contains(range.endContainer)) return;
    let from = Infinity, to = -1, rect;
    for (const part of refresh()) {
      if (!range.intersectsNode(part.node)) continue;
      if (part.atomic) {
        from = Math.min(from, part.item.from); to = Math.max(to, part.item.to);
        rect ||= part.node.getBoundingClientRect();
        continue;
      }
      for (let index = 0; index < part.points.length; index++) {
        const point = part.points[index];
        if (range.comparePoint(point.node, point.offset) !== 0 || range.comparePoint(point.node, point.offset + 1) !== 0) continue;
        const position = part.item.positions[part.start + index];
        if (!Number.isSafeInteger(position)) continue;
        from = Math.min(from, position); to = Math.max(to, position + 1);
        rect ||= rectAt(part, index);
      }
    }
    if (to > from) send('selection', { from, to, rect });
  }
  let selectionTimer;
  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(selectionSource, 80);
  });
  function send(reason, anchor) {
    if (!anchor || !Number.isSafeInteger(anchor.from)) return;
    parent.postMessage({ type: 'md2pdf-content-source', revision: revision(), from: anchor.from, to: anchor.to,
      ratio: anchor.rect.top / Math.max(1, innerHeight), reason }, '*');
  }
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.revision !== revision()) return;
    if (event.data.type === 'md2pdf-content-locate') locate(event.data);
  });
  document.addEventListener('dblclick', event => {
    if (event.target.closest('a,button,input') || !activeScope()?.contains(event.target)) return;
    send('activate', atPoint(event.clientX, event.clientY));
  });
  for (const name of ['wheel', 'touchmove', 'pointerdown']) addEventListener(name, () => {
    userScroll = true; programmaticUntil = 0;
  }, { passive: true });
  addEventListener('scroll', () => {
    if (!userScroll || Date.now() < programmaticUntil || pending) return;
    overlay?.remove();
    pending = requestAnimationFrame(() => {
      pending = 0;
      if (!userScroll || Date.now() < programmaticUntil) return;
      const scope = activeScope(), box = scope?.getBoundingClientRect();
      send('scroll', atPoint(box ? (box.left + box.right) / 2 : innerWidth / 2, innerHeight * .3));
    });
  }, { passive: true });
  return { bind, refresh: () => { dirty = true; return refresh(); }, capture,
    suppress: () => { userScroll = false; programmaticUntil = Date.now() + 250; }, locate, outline };
}
