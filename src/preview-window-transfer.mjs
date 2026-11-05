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
  listen('scroll', () => {
    if (!enabled || pending) return;
    pending = true;
    frame(() => {
      pending = false;
      if (!enabled) return;
      parent.postMessage({ type: 'md2pdf-position', id: 'window-position', revision: revision(), position: capturePosition() }, '*');
    });
  }, { passive: true });
}
