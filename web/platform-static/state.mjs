const node = document.querySelector('#offline-cache');
const base = window.__MD2PDF_STATIC_BASE__;
let registration;
function report(data) {
  node.replaceChildren();
  if (data.current !== data.pinned) {
    node.append('新版已就绪。');
    const button=document.createElement('button');button.textContent='保存草稿并更新';button.type='button';
    button.addEventListener('click',async()=>{
      button.disabled=true;
      try { if(!window.mdDrafts)throw new Error();await window.mdDrafts.flush();location.reload(); }
      catch {node.firstChild.textContent='草稿尚未保存，请下载备份后重试。';button.disabled=false;}
    });node.append(button);
  } else node.textContent=data.ready?'完整离线资源已就绪。':'离线资源不完整，请联网重新准备。';
}
const status=()=>navigator.serviceWorker.controller?.postMessage({type:'APP_CACHE_STATUS'});
if(isSecureContext&&'serviceWorker'in navigator){
  navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='APP_CACHE_STATUS')report(event.data);});
  navigator.serviceWorker.addEventListener('controllerchange',status);
  try{
    registration=await navigator.serviceWorker.register(new URL('service-worker.js',base),{scope:base,updateViaCache:'none'});
    registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='activated')status();if(worker.state==='redundant')node.textContent='离线资源准备失败，请联网重试。';});});status();
  }catch{node.textContent='离线资源准备失败，请联网重试。';}
}else node.textContent='离线启动需要可信 HTTPS 或 localhost。';
async function check(){if(navigator.onLine&&registration){try{await registration.update();status();}catch{}}}
window.addEventListener('online',check);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check();});
