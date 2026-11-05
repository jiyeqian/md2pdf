// These helpers are serialized into the sandboxed preview, so they deliberately
// have no module dependencies or references to outer scope.
export function readPreviewTransferState(document) {
  let state;
  try { state = JSON.parse(document.querySelector('script[data-md2pdf-transfer-state]')?.textContent || 'null'); }
  catch { return null; }
  if (!state || state.version !== 1 || typeof state.flow !== 'boolean' || !Number.isFinite(state.zoom) || state.zoom < 20 || state.zoom > 200) return null;
  const position = state.position;
  if (!position || !Number.isFinite(position.offset) || !Number.isFinite(position.ratio) || position.ratio < 0 || position.ratio > 1) return null;
  return {
    version: 1, zoom: state.zoom, flow: state.flow,
    position: {
      from: Number.isSafeInteger(position.from) && position.from >= 0 ? position.from : undefined,
      anchorRatio: Number.isFinite(position.anchorRatio) ? position.anchorRatio : undefined,
      line: Number.isSafeInteger(position.line) && position.line >= 0 ? position.line : 0,
      offset: position.offset, ratio: position.ratio,
      ...(Number.isSafeInteger(position.revision) && position.revision >= 0 ? { revision: position.revision } : {}),
      ...(Object.hasOwn(position, 'selection') ? { selection: position.selection && position.selection.version === 1
        && ['flow', 'paged'].includes(position.selection.scope)
        && Number.isSafeInteger(position.selection.anchor) && position.selection.anchor >= 0
        && Number.isSafeInteger(position.selection.focus) && position.selection.focus >= 0
        ? { version: 1, scope: position.selection.scope, anchor: position.selection.anchor, focus: position.selection.focus,
          anchorBias: position.selection.anchorBias === -1 ? -1 : 1, focusBias: position.selection.focusBias === -1 ? -1 : 1 } : null } : {}),
      ...(Object.hasOwn(position, 'highlight') ? { highlight: position.highlight && Number.isSafeInteger(position.highlight.from)
        && position.highlight.from >= 0 && Number.isSafeInteger(position.highlight.to) && position.highlight.to >= position.highlight.from
        ? { from: position.highlight.from, to: position.highlight.to } : null } : {}),
    },
    fonts: Array.isArray(state.fonts) ? state.fonts.filter(font => typeof font === 'string').slice(0, 64) : [],
  };
}

export function capturePreviewTransfer(document, state, runtimeSource) {
  const clone = document.documentElement.cloneNode(true);
  const originalStyles = [...document.querySelectorAll('style')], copiedStyles = [...clone.querySelectorAll('style')];
  // Paged.js and MathJax also insert CSS through CSSOM; cloning textContent alone
  // silently loses those rules even though the source preview looks correct.
  originalStyles.forEach((style, index) => {
    if (!copiedStyles[index]) return;
    try {
      if (style.sheet?.cssRules?.length) copiedStyles[index].textContent = [...style.sheet.cssRules].map(rule => rule.cssText).join('\n');
    } catch { /* Existing inline text remains available for unreadable sheets. */ }
  });
  let runtime = clone.querySelector('script[data-md2pdf-preview-enhance="1"]');
  if (!runtime) {
    // Paged.js may remove the executing enhancement element with its original
    // source tree. Only restore code captured from our own currentScript.
    if (typeof runtimeSource !== 'string' || !runtimeSource.trim()) throw new Error('预览转移缺少运行时');
    runtime = document.createElement('script');
    runtime.setAttribute('data-md2pdf-preview-enhance', '1'); runtime.textContent = runtimeSource;
    clone.querySelector('body').appendChild(runtime);
  }
  for (const script of clone.querySelectorAll('script')) {
    if (script === runtime || (script.getAttribute('type') === 'application/json' && script.hasAttribute('data-md2pdf-content-map'))) continue;
    script.remove();
  }
  for (const node of clone.querySelectorAll('[data-md2pdf-sync-highlight],iframe,object,embed')) node.remove();
  for (const node of clone.querySelectorAll('.md2pdf-preview-target')) node.classList.remove('md2pdf-preview-target');
  for (const node of [clone, ...clone.querySelectorAll('*')]) {
    for (const attribute of [...node.attributes]) if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
  }
  const ids = new Set([...clone.querySelectorAll('[id]')].map(node => node.id));
  for (const svg of clone.querySelectorAll('svg')) {
    for (const node of [svg, ...svg.querySelectorAll('*')]) {
      for (const attribute of [...node.attributes]) {
        let value = attribute.value.replace(/url\((["']?)[^#)]*#([^)'"\s]+)\1\)/g,
          (whole, quote, id) => ids.has(id) ? 'url(#' + id + ')' : whole);
        if (node.tagName.toLowerCase() === 'use' && /^(?:href|xlink:href)$/.test(attribute.name)) {
          const fragment = /#([^#]+)$/.exec(value)?.[1]; if (ids.has(fragment)) value = '#' + fragment;
        }
        if (value !== attribute.value) node.setAttribute(attribute.name, value);
      }
    }
  }
  // Use an inert JSON node and escape '<' so even author-controlled font names
  // or future metadata cannot terminate the element and inject active content.
  const metadata = document.createElement('script');
  metadata.type = 'application/json'; metadata.setAttribute('data-md2pdf-transfer-state', '');
  metadata.textContent = JSON.stringify(state).replace(/</g, '\\u003c');
  clone.querySelector('head').appendChild(metadata);
  return '<!DOCTYPE html>\n' + clone.outerHTML;
}

export function installPreviewTransfer({ parent, revision, isReady, capture, listen }) {
  listen('message', event => {
    const data = event.data;
    if (event.source !== parent || !data || data.type !== 'md2pdf-transfer-capture' || data.revision !== revision()
      || typeof data.id !== 'string' || !data.id.length || data.id.length > 100 || !isReady()) return;
    try {
      const snapshot = capture();
      parent.postMessage({ type: 'md2pdf-transfer-snapshot', id: data.id, revision: revision(), html: snapshot.html, position: snapshot.position }, '*');
    } catch {
      parent.postMessage({ type: 'md2pdf-transfer-error', id: data.id, revision: revision() }, '*');
    }
  });
}

export function installPreviewPositionStream({ parent, revision, capturePosition, listen, frame }) {
  let enabled = false, pending = false;
  listen('message', event => {
    const data = event.data;
    if (event.source !== parent || !data || data.type !== 'md2pdf-window-position-stream'
      || data.revision !== revision() || typeof data.enabled !== 'boolean') return;
    enabled = data.enabled;
  });
  const schedule = () => {
    if (!enabled || pending) return;
    pending = true;
    frame(() => {
      pending = false;
      if (!enabled) return;
      parent.postMessage({ type: 'md2pdf-position', id: 'window-position', revision: revision(), position: capturePosition() }, '*');
    });
  };
  listen('scroll', schedule, { passive: true });
  listen('selectionchange', schedule);
}

export function installPreviewSelection({ activeScope, getSelection }) {
  let protectedSelection = null, protectedUntil = 0;
  const mode = scope => scope.id === 'md2pdf-preview-flow' ? 'flow' : 'paged';
  function collect(scope) {
    const entries = [], bounds = new Map(), stack = [{ node: scope, exit: false }];
    let length = 0, count = 0;
    while (stack.length) {
      if (++count > 400000 || length > 16777216) return null;
      const { node, exit } = stack.pop();
      if (exit) { bounds.get(node).to = length; continue; }
      const range = { from: length, to: length }; bounds.set(node, range);
      if (node.nodeType === 3) { length += node.data.length; range.to = length; if (node.data.length) entries.push({ node, ...range }); continue; }
      if (node.nodeType === 1 && /^(?:SCRIPT|STYLE)$/i.test(node.tagName)) continue;
      stack.push({ node, exit: true });
      const children = node.childNodes || [];
      for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], exit: false });
    }
    return { entries, bounds, length };
  }
  function capture() {
    try {
      const scope = activeScope(), selection = getSelection();
      if (!scope || !selection?.rangeCount || !scope.contains(selection.anchorNode) || !scope.contains(selection.focusNode))
        return Date.now() < protectedUntil ? protectedSelection : null;
      const data = collect(scope); if (!data?.entries.length) return null;
      const point = (node, offset) => {
        const range = data.bounds.get(node);
        if (!range || !Number.isSafeInteger(offset) || offset < 0) return null;
        if (node.nodeType === 3) return offset <= node.data.length ? { offset: range.from + offset, bias: offset === node.data.length ? -1 : 1 } : null;
        if (node.nodeType !== 1 || /^(?:SCRIPT|STYLE)$/i.test(node.tagName) || offset > node.childNodes.length) return null;
        return { offset: offset === node.childNodes.length ? range.to : data.bounds.get(node.childNodes[offset]).from, bias: offset === node.childNodes.length ? -1 : 1 };
      };
      const anchor = point(selection.anchorNode, selection.anchorOffset), focus = point(selection.focusNode, selection.focusOffset);
      if (!anchor || !focus) return null;
      const saved = { version: 1, scope: mode(scope), anchor: anchor.offset, focus: focus.offset, anchorBias: anchor.bias, focusBias: focus.bias };
      if (Date.now() < protectedUntil) protectedSelection = saved;
      return saved;
    } catch { return null; }
  }
  function restore(saved) {
    if (!saved || saved.version !== 1 || !Number.isSafeInteger(saved.anchor) || !Number.isSafeInteger(saved.focus)
      || saved.anchor < 0 || saved.focus < 0 || saved.anchor > 16777216 || saved.focus > 16777216) return false;
    try {
      const scope = activeScope(), selection = getSelection();
      if (!scope || mode(scope) !== saved.scope || !selection) return false;
      const data = collect(scope);
      if (!data?.entries.length || saved.anchor > data.length || saved.focus > data.length) return false;
      const point = (offset, bias) => {
        let low = 0, high = data.entries.length;
        while (low < high) { const mid = (low + high) >> 1; if (bias === -1 ? data.entries[mid].to < offset : data.entries[mid].to <= offset) low = mid + 1; else high = mid; }
        const entry = data.entries[Math.min(low, data.entries.length - 1)];
        return { node: entry.node, offset: Math.max(0, Math.min(entry.node.data.length, offset - entry.from)) };
      };
      const anchor = point(saved.anchor, saved.anchorBias), focus = point(saved.focus, saved.focusBias);
      if (selection.anchorNode === anchor.node && selection.anchorOffset === anchor.offset && selection.focusNode === focus.node && selection.focusOffset === focus.offset) return true;
      if (typeof selection.setBaseAndExtent === 'function') selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
      else if (typeof selection.extend === 'function') { selection.collapse(anchor.node, anchor.offset); selection.extend(focus.node, focus.offset); }
      else return false;
      protectedSelection = saved; protectedUntil = Date.now() + 800;
      return true;
    } catch { return false; }
  }
  return { capture, restore, protect() { const saved = capture(); if (saved && saved.anchor !== saved.focus) { protectedSelection = saved; protectedUntil = Date.now() + 800; } },
    clearProtection() { protectedSelection = null; protectedUntil = 0; } };
}
