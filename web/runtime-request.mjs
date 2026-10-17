// 界面只依赖此请求边界；默认沿用在线接口，静态构建才加载浏览器适配器。
export async function appFetch(input, init) {
  if (!window.__MD2PDF_STATIC_BASE__) return fetch(input, init);
  init?.signal?.throwIfAborted();
  const runtime = await import(new URL('offline-runtime.mjs', window.__MD2PDF_STATIC_BASE__).href);
  const work = runtime.appFetch(input, init);
  if (!init?.signal) return work;
  let abort;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      abort = () => reject(init.signal.reason || new DOMException('操作已取消', 'AbortError'));
      init.signal.addEventListener('abort', abort, { once:true });
      if (init.signal.aborted) abort();
    })]);
  } finally { if (abort) init.signal.removeEventListener('abort', abort); }
}
export async function exportPdf(document) {
  const runtime = await import(new URL('offline-pdf.mjs', window.__MD2PDF_STATIC_BASE__).href);
  return runtime.exportPdf(document);
}
