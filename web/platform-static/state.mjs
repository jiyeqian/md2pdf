const footer = window.mdFooterStatus;
const base = window.__MD2PDF_STATIC_BASE__;
let registration, checking = false;
const applyUpdate = () => footer.saveAndUpdate(async()=>location.reload());
function report(data) {
  window.dispatchEvent(new CustomEvent('md2pdf-offline-ready', { detail: { ready: data.ready === true } }));
  if (data.current !== data.pinned) footer.set('update','update',applyUpdate);
  else footer.clear('update');
  if(data.ready)footer.clear('cache');
  else footer.set('cache','retry',prepare);
}
const status = () => navigator.serviceWorker.controller?.postMessage({type:'APP_CACHE_STATUS'});
async function prepare() {
  if (!isSecureContext || !('serviceWorker' in navigator)) {footer.set('cache','unsupported');return;}
  footer.set('cache','preparing');
  try {
    registration = await navigator.serviceWorker.register(new URL('service-worker.js',base),{scope:base,updateViaCache:'none'});
    registration.addEventListener('updatefound',()=>{
      const worker=registration.installing;
      worker?.addEventListener('statechange',()=>{
        if(worker.state==='activated')status();
        if(worker.state==='redundant')footer.set('cache','retry',prepare);
      });
    });
    await registration.update();
    status();
  } catch {footer.set('cache','retry',prepare);}
}
if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='APP_CACHE_STATUS')report(event.data);});
  navigator.serviceWorker.addEventListener('controllerchange',status);
}
async function check() {
  if(!navigator.onLine || !registration || checking)return;
  checking=true;
  try {await registration.update();footer.clear('check');status();}
  catch {footer.set('check','checkError',check);}
  finally {checking=false;}
}
window.addEventListener('online',check);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check();});
let appReady=window.__MD2PDF_APP_READY__===true, previewReady=window.__MD2PDF_PREVIEW_READY__===true;
let cacheStarted=false, fallbackDue=false;
const startCache=(force=false)=>{
  if(cacheStarted||(!force&&document.visibilityState==='hidden')||!appReady||(!previewReady&&!fallbackDue))return;
  cacheStarted=true;
  prepare();
};
function scheduleFallback(){
  const hasDocument=!!window.mdEditor?.getValue?.().trim();
  setTimeout(()=>{fallbackDue=true;startCache();},hasDocument?35000:10000);
}
window.addEventListener('md-app-ready',()=>{
  appReady=true;
  scheduleFallback();
  startCache();
},{once:true});
window.addEventListener('md-preview-ready',()=>{previewReady=true;startCache();},{once:true});
window.addEventListener('md-preview-error',()=>{fallbackDue=true;startCache();},{once:true});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')startCache();});
setTimeout(()=>{fallbackDue=true;startCache(true);},60000);
if(appReady&&!previewReady)scheduleFallback();
