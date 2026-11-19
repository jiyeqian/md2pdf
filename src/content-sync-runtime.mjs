// Serialized into the sandboxed preview; metadata never adds inline layout boxes.
export function installContentSync({ activeScope, revision, beforeLocate }) {
  const metadata = document.querySelector('script[data-md2pdf-content-map]');
  let source = [];
  try { source = JSON.parse(metadata?.textContent || '[]'); } catch { /* Legacy preview. */ }
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
  let outlineFrom = null, restoredSelection = null, reportedSelection = null;
  let overlay, overlayTimer, selectedRange = null, paintFrame = 0, selectionGuardUntil = 0;
  function highlight(from, to, anchor) {
    overlay?.remove(); clearTimeout(overlayTimer);
    selectedRange = to > from ? { from, to } : null;
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
    if (!selectedRange) overlayTimer = setTimeout(() => overlay?.remove(), 1800);
  }

  function repaintSelection() {
    if (paintFrame || !selectedRange) return;
    paintFrame = requestAnimationFrame(() => {
      paintFrame = 0;
      if (selectedRange) highlight(selectedRange.from, selectedRange.to);
    });
  }
  addEventListener('resize', repaintSelection);
  addEventListener('resize', () => {
    if (outlineFrom !== null) requestAnimationFrame(() => {
      if (outlineFrom !== null && document.documentElement.clientWidth && innerHeight) locate({from:outlineFrom,to:outlineFrom,reason:'outline',ratio:0,instant:true});
    });
  });
  addEventListener('scroll', repaintSelection, { passive: true });

  function locate(data) {
    if (!Number.isSafeInteger(data.from) || data.from < 0) return;
    outlineFrom = data.reason === 'outline' ? data.from : null;
    beforeLocate(data);
    if (data.reason === 'cursor' && data.to > data.from) {
      selectedRange = null; overlay?.remove(); clearTimeout(overlayTimer);
      const selection = getSelection();
      if (selection?.rangeCount && activeScope()?.contains(selection.anchorNode)) { selectionGuardUntil = Date.now() + 1000; selection.removeAllRanges(); }
    }
    const anchor = atSource(data.from);
    if (!anchor) return;
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
    if (item) { outlineFrom = item.from; suppressSelectionEcho(); }
    if (item) send('outline', { from: item.from, to: item.to, rect: { top: 0 } });
  }
  function suppressSelectionEcho() {
    const selection = getSelection();
    restoredSelection = selection?.rangeCount ? { anchor: selection.anchorNode, anchorOffset: selection.anchorOffset,
      focus: selection.focusNode, focusOffset: selection.focusOffset } : null;
  }
  function selectionSource() {
    const selection = getSelection();
    if ([restoredSelection, reportedSelection].some(saved => saved && selection?.anchorNode === saved.anchor && selection.anchorOffset === saved.anchorOffset
      && selection.focusNode === saved.focus && selection.focusOffset === saved.focusOffset)) return;
    restoredSelection = null;
    if (!selection || selection.isCollapsed || !selection.rangeCount) { if (Date.now() < selectionGuardUntil) return; send('selection', { from: 0, to: 0, rect: { top: 0 } }); return; }
    const range = selection.getRangeAt(0), scope = activeScope();
    if (!scope?.contains(range.startContainer) || !scope.contains(range.endContainer)) return;
    selectedRange = null; overlay?.remove(); clearTimeout(overlayTimer);
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
    if (to > from) {
      send('selection', { from, to, rect });
      reportedSelection = {anchor:selection.anchorNode,anchorOffset:selection.anchorOffset,focus:selection.focusNode,focusOffset:selection.focusOffset};
    }
  }
  // Formatting requires exact boundaries in one mapped fragment, not the
  // approximate ranges used for scroll synchronisation.
  document.addEventListener('contextmenu', event => {
    const selection = getSelection(), scope = activeScope();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1 || !scope?.contains(event.target)) return;
    const range = selection.getRangeAt(0);
    const parts = refresh();
    const candidates = parts.filter(part => !part.atomic
      && parts.filter(other => other.item.id === part.item.id).length === 1
      && part.start === 0 && part.points.length === part.item.text.length
      && part.node.dataset.md2pdfFormatSourceId === String(part.item.id)
      && !part.node.closest('[data-repeated-header]')
      && part.node.contains(range.startContainer) && part.node.contains(range.endContainer));
    let mapped = null;
    if (candidates.length === 1) {
      const part = candidates[0], allAtoms = part.item.formatAtoms || [];
      const atoms = allAtoms.filter(atom => ['ref', 'footnote', 'math', 'gbFootnote'].includes(atom.kind));
      const nodes = [...part.node.querySelectorAll('sup.fnref,a.ref,mjx-container,.gb-footnote,.gb-footnote-repeat,.gb-float-footnote-call')].filter(node => !node.parentElement.closest('sup.fnref,mjx-container,.gb-footnote,.gb-footnote-repeat,.gb-float-footnote-call'));
      const verified = nodes.length === atoms.length && nodes.every((node, i) => {
        const atom = atoms[i];
        if (atom.kind === 'math') return node.matches('mjx-container');
        if (atom.kind === 'gbFootnote') return node.matches('.gb-footnote,.gb-footnote-repeat,.gb-float-footnote-call');
        if (atom.kind === 'footnote') return node.matches('sup.fnref')
          && node.querySelector('a')?.getAttribute('href') === '#fn-' + atom.number;
        return node.matches('a.ref') && atom.expectedId && node.getAttribute('href') === '#' + atom.expectedId;
      });
      if (verified) {
        const units = part.points.map((point, i) => ({ point, from: part.item.positions[part.start + i], to: part.item.positions[part.start + i] + 1, text: point.char }));
        for (let i = 0; i < atoms.length; i++) {
          const walker = document.createTreeWalker(nodes[i], NodeFilter.SHOW_TEXT), points = [];
          let textNode;
          while ((textNode = walker.nextNode())) for (let offset = 0; offset < textNode.length; offset++) points.push({ node: textNode, offset });
          units.push({ ...atoms[i], points, node: nodes[i], text: nodes[i].textContent });
          // Canonical scroll text merges whitespace across omitted references.
          // Preserve a single verified source space after the reference for editing.
          const next = units.find(unit => unit.point && unit.from === atoms[i].to + 1);
          if (next && next.point.offset > 0 && next.point.node.data[next.point.offset - 1] === ' '
            && !units.some(unit => unit.from === atoms[i].to)) {
            units.push({ point: { node: next.point.node, offset: next.point.offset - 1 }, from: atoms[i].to, to: atoms[i].to + 1, text: ' ' });
          }
        }
        units.sort((a, b) => a.from - b.from);
        let invalid = units.some((unit, i) => {
          if (!i) return false;
          const previous = units[i - 1];
          if (previous.to > unit.from) return true;
          const left = document.createRange(), right = document.createRange();
          if (previous.node) left.selectNode(previous.node); else { left.setStart(previous.point.node, previous.point.offset); left.setEnd(previous.point.node, previous.point.offset + 1); }
          if (unit.node) right.selectNode(unit.node); else { right.setStart(unit.point.node, unit.point.offset); right.setEnd(unit.point.node, unit.point.offset + 1); }
          left.collapse(false); right.collapse(true);
          return left.compareBoundaryPoints(Range.START_TO_START, right) > 0;
        });
        const selected = units.filter(unit => {
          if (unit.node) {
            if (!range.intersectsNode(unit.node)) return false;
            const parent = unit.node.parentNode, index = [...parent.childNodes].indexOf(unit.node);
            const whole = range.comparePoint(parent, index) === 0 && range.comparePoint(parent, index + 1) === 0;
            if (whole) return true;
            if (unit.points.length && unit.kind !== 'math' && !unit.node.matches('.gb-footnote')) {
              const included = unit.points.filter(point => range.comparePoint(point.node, point.offset) === 0 && range.comparePoint(point.node, point.offset + 1) === 0).length;
              if (included === unit.points.length) return true;
              if (!included) return false;
            }
            invalid = true;
            return false;
          }
          const points = [unit.point];
          const included = points.filter(point => range.comparePoint(point.node, point.offset) === 0 && range.comparePoint(point.node, point.offset + 1) === 0).length;
          if (included && included !== points.length) invalid = true;
          return included > 0;
        });
        if (!invalid && selected.length && selected.every((unit, i) => !i || units.indexOf(unit) === units.indexOf(selected[i - 1]) + 1)) {
          const first = selected[0], lastUnit = selected.at(-1);
          const exact = document.createRange();
          if (first.node) exact.setStartBefore(first.node); else exact.setStart(first.point.node, first.point.offset);
          if (lastUnit.node) exact.setEndAfter(lastUnit.node); else exact.setEnd(lastUnit.point.node, lastUnit.point.offset + 1);
          const text = selected.map(unit => unit.text).join('');
          const contents = range.cloneContents();
          contents.querySelectorAll('sup.fnref,a.ref,mjx-container,.gb-footnote,.gb-footnote-repeat,.gb-float-footnote-call').forEach(node => node.remove());
          if (range.toString() === text && exact.toString() === text && !contents.querySelector(skip)) {
            const from = selected[0].from, to = lastUnit.to;
            if (Number.isSafeInteger(from) && Number.isSafeInteger(to) && to > from
              && !allAtoms.some(atom => !atoms.includes(atom) && from < atom.to && to > atom.from)) mapped = { id: part.item.id, from, to };
          }
        }
      }
    }
    if (!mapped || parent === window) return;
    event.preventDefault();
    const selectionRect = range.getClientRects()[0] || range.getBoundingClientRect();
    const anchor = capture();
    parent.postMessage({ type: 'md2pdf-format-menu', revision: revision(), mapped, x: selectionRect.left, y: selectionRect.top, bottom: selectionRect.bottom,
      position: { from: anchor?.from, anchorRatio: anchor?.anchorRatio, offset: 0, ratio: scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight) } }, '*');
  });
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
    if (event.source !== parent || !event.data) return;
    if (event.data.type === 'md2pdf-capture-position' || event.data.type === 'md2pdf-restore-position' || event.data.type === 'md2pdf-restore-selection') selectionGuardUntil = Date.now() + 1000;
    if (event.data.revision !== revision()) return;
    if (event.data.type === 'md2pdf-transfer-capture') selectionGuardUntil = Date.now() + 1000;
    if (event.data.type === 'md2pdf-format-select') {
      const { from, to } = event.data;
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to <= from) return;
      const parts = refresh();
      const matches = parts.filter(part => !part.atomic && part.start === 0 && part.points.length === part.item.text.length
        && part.node.dataset.md2pdfFormatSourceId === String(part.item.id)
        && parts.filter(other => other.item.id === part.item.id).length === 1
        && part.item.positions.includes(from) && part.item.positions.includes(to - 1));
      if (matches.length !== 1) return;
      const part = matches[0], first = part.points[part.item.positions.indexOf(from)], last = part.points[part.item.positions.indexOf(to - 1)];
      if (!first || !last) return;
      const selection = getSelection();
      try { selection.setBaseAndExtent(first.node, first.offset, last.node, last.offset + 1); suppressSelectionEcho(); } catch { /* Layout changed before restoration. */ }
    }
    if (event.data.type === 'md2pdf-content-locate') locate(event.data);
  });
  document.addEventListener('keydown', () => { selectionGuardUntil = 0; outlineFrom = null; restoredSelection = null; reportedSelection = null; });
  document.addEventListener('dblclick', event => {
    if (event.target.closest('a,button,input') || !activeScope()?.contains(event.target)) return;
    send('activate', atPoint(event.clientX, event.clientY));
  });
  for (const name of ['wheel', 'touchmove', 'pointerdown']) addEventListener(name, () => {
    userScroll = true; programmaticUntil = 0; selectionGuardUntil = 0; outlineFrom = null; restoredSelection = null; reportedSelection = null;
  }, { passive: true });
  addEventListener('scroll', () => {
    if (!userScroll || Date.now() < programmaticUntil || pending) return;
    if (!selectedRange) overlay?.remove();
    pending = requestAnimationFrame(() => {
      pending = 0;
      if (!userScroll || Date.now() < programmaticUntil) return;
      const scope = activeScope(), box = scope?.getBoundingClientRect();
      send('scroll', atPoint(box ? (box.left + box.right) / 2 : innerWidth / 2, innerHeight * .3));
    });
  }, { passive: true });
  return { bind, refresh: () => { dirty = true; return refresh(); }, capture,
    suppress: () => { userScroll = false; programmaticUntil = Date.now() + 250; }, locate, outline, flushSelection: () => { clearTimeout(selectionTimer); selectionSource(); }, suppressSelectionEcho, captureOutline: () => outlineFrom, captureHighlight: () => selectedRange,
    restoreHighlight: range => { if (range && Number.isSafeInteger(range.from) && Number.isSafeInteger(range.to) && range.to > range.from) highlight(range.from, range.to); } };
}
