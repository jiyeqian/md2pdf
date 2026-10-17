// 仅静态构建注入此入口；在线页面不加载它。
window.__MD2PDF_STATIC_BASE__ = new URL('./', document.currentScript.src).href;
window.addEventListener('DOMContentLoaded', () => {
  import(new URL('offline-state.mjs', window.__MD2PDF_STATIC_BASE__).href).catch(() => {
    document.querySelector('#offline-state').textContent = '离线资源启动失败，请联网刷新重试。';
  });
});
