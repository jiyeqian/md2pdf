export function createCacheReadinessGate({ window, document, start, setTimer = setTimeout }) {
  let appReady = window.__MD2PDF_APP_READY__ === true;
  let previewReady = window.__MD2PDF_PREVIEW_READY__ === true;
  let cacheStarted = false, fallbackDue = window.__MD2PDF_PREVIEW_ERROR__ === true, fallbackScheduled = false;
  const startCache = (force = false) => {
    if (cacheStarted || (!force && document.visibilityState === 'hidden') || !appReady || (!previewReady && !fallbackDue)) return;
    cacheStarted = true;
    start();
  };
  const scheduleFallback = () => {
    if (fallbackScheduled) return;
    fallbackScheduled = true;
    const hasDocument = !!window.mdEditor?.getValue?.().trim();
    setTimer(() => { fallbackDue = true; startCache(); }, hasDocument ? 35000 : 10000);
  };
  window.addEventListener('md-app-ready', () => { appReady = true; scheduleFallback(); startCache(); }, { once:true });
  window.addEventListener('md-preview-ready', () => { previewReady = true; startCache(); }, { once:true });
  window.addEventListener('md-preview-error', () => { fallbackDue = true; startCache(); }, { once:true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') startCache(); });
  setTimer(() => { fallbackDue = true; startCache(true); }, 60000);
  if (appReady) {
    if (previewReady || fallbackDue) startCache();
    else scheduleFallback();
  }
  return { startCache };
}
