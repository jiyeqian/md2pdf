// 仅静态构建注入此入口；在线页面不加载它。
window.__MD2PDF_STATIC_BASE__ = new URL('./', document.currentScript.src).href;
window.addEventListener('DOMContentLoaded', () => {
  import(new URL('state.mjs', window.__MD2PDF_STATIC_BASE__).href).catch(() => {
    window.mdFooterStatus.set('cache','retry',()=>window.mdFooterStatus.saveAndUpdate(async()=>location.reload()));
  });
});
