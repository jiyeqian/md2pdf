(function (global) {
  'use strict';
  const storageKey = 'md2pdf.editor.gutters';
  function resolveVisible(saved, smallScreen) {
    return saved === 'shown' ? true : saved === 'hidden' ? false : !smallScreen;
  }
  global.mdEditorGutterHelpers = { resolveVisible };
  const doc = global.document;
  if (!doc) return;
  const panel = doc.querySelector('.editor-panel');
  const footer = panel && panel.querySelector('.editor-footer');
  if (!footer) return;
  const smallScreen = global.matchMedia('(max-width: 600px)');
  let saved = null;
  try { saved = global.localStorage.getItem(storageKey); } catch (_) { /* Storage may be unavailable in private contexts. */ }
  let visible = resolveVisible(saved, smallScreen.matches);
  const button = doc.createElement('button');
  button.id = 'editor-gutter-toggle';
  button.className = 'editor-gutter-toggle';
  button.type = 'button';
  button.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M5.5 8h1M5.5 12h1M5.5 16h1M12 8h6M12 12h6M12 16h6"/></svg>';
  footer.prepend(button);
  let frame = 0;
  let observedGutter = null;
  let buttonSlot = 28;
  const gutterResize = new ResizeObserver(scheduleAlign);
  function align() {
    frame = 0;
    const gutter = panel.querySelector('.cm-gutters');
    if (gutter !== observedGutter) {
      if (observedGutter) gutterResize.unobserve(observedGutter);
      observedGutter = gutter;
      if (gutter) gutterResize.observe(gutter);
    }
    const openButton = panel.querySelector('.md-wt-toolbar [aria-label="打开 Markdown"]');
    const anchor = openButton && openButton.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    // 两个按钮和整栏共享顶部打开按钮的中轴，显隐不改变对齐基准。
    if (anchor && anchor.width) buttonSlot = Math.max(28, (anchor.left + anchor.width / 2 - footerRect.left) * 2);
    panel.style.setProperty('--editor-gutter-width', buttonSlot + 'px');
    button.style.setProperty('--gutter-button-slot', buttonSlot + 'px');
  }
  function scheduleAlign() {
    if (!frame) frame = global.requestAnimationFrame(align);
  }
  function apply() {
    panel.classList.toggle('editor-gutters-hidden', !visible);
    button.setAttribute('aria-pressed', String(visible));
    const label = visible ? '隐藏行号与折叠栏' : '显示行号与折叠栏';
    button.setAttribute('aria-label', label);
    button.title = label;
    if (global.mdEditor && global.mdEditor.requestMeasure) global.mdEditor.requestMeasure();
    scheduleAlign();
  }
  button.addEventListener('click', function () {
    visible = !visible;
    saved = visible ? 'shown' : 'hidden';
    try { global.localStorage.setItem(storageKey, saved); } catch (_) { /* Keep the current session choice even without storage. */ }
    apply();
  });
  smallScreen.addEventListener('change', function () {
    visible = resolveVisible(saved, smallScreen.matches);
    apply();
  });
  new ResizeObserver(scheduleAlign).observe(panel);
  new MutationObserver(scheduleAlign).observe(panel, { childList: true, subtree: true });
  doc.addEventListener('md-editor-ready', apply);
  global.addEventListener('resize', scheduleAlign);
  apply();
})(typeof globalThis !== 'undefined' ? globalThis : this);
