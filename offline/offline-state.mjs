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
// 原型草稿留在原数据库；由用户选择导入，避免覆盖现有正式草稿。
try{
  if(indexedDB.databases&&(await indexedDB.databases()).some(db=>db.name==='md2pdf-offline-prototype')){
    const legacy=await new Promise((resolve,reject)=>{const r=indexedDB.open('md2pdf-offline-prototype');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;if(!db.objectStoreNames.contains('drafts')){db.close();resolve(null);return;}const tx=db.transaction('drafts');const get=tx.objectStore('drafts').get('current');tx.oncomplete=()=>{db.close();resolve(get.result);};tx.onerror=()=>{db.close();reject(tx.error);};};});
    if(typeof legacy==='string'&&legacy.trim()){
      const button=document.createElement('button');button.type='button';button.textContent='导入早期原型草稿';
      button.addEventListener('click',async()=>{button.disabled=true;try{if(!window.mdDrafts)throw new Error('编辑器尚未就绪');await window.mdDrafts.openFile(legacy,'原型草稿.md');button.remove();}catch{button.disabled=false;}});
      document.querySelector('#offline-state').append(button);
    }
  }
}catch{ /* 读取旧草稿失败不影响正式草稿。 */ }
