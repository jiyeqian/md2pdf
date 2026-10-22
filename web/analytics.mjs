import { validateEvent } from './analytics-schema.mjs';
const KEY='md2pdf.analytics.consent', POLICY=2, AGE=180*86400000;
const VISITOR_KEY='md2pdf.analytics.visitor';
let active;
export function track(event,properties={}) { return active?.track(event,properties)??false; }
export function initAnalytics(config={}) {
  active?.destroy();
  const env=globalThis;
  const visitProperties = visit(env);
  let consent=null, storage=true, dead=false, pageSent=false, previewAt=-Infinity, count=0, minute=Date.now();
  const pending=new Set();
  const signal=()=>env.navigator?.globalPrivacyControl===true||env.navigator?.doNotTrack==='1'||env.doNotTrack==='1';
  const enabled=()=>config.enabled===true&&['http:','https:'].includes(env.location?.protocol)&&validEndpoint(config.endpoint);
  function readConsent() {
    const previous = consent;
    consent = null;
    try {
      const value = JSON.parse(env.localStorage.getItem(KEY));
      storage = true;
      if (value?.policy === POLICY && typeof value.basic === 'boolean' && typeof value.product === 'boolean' && Number.isFinite(value.savedAt) && value.savedAt <= Date.now() && Date.now() - value.savedAt < AGE) {
        consent = { basic: value.basic, product: value.product };
      }
    } catch { storage = false; }
    if (!consent?.basic || signal()) { clearVisitor(false); pageSent=false; }
    if (signal() || (previous?.basic && !consent?.basic) || (previous?.product && !consent?.product)) abort();
    return consent;
  }
  readConsent();
  function abort(){for(const p of pending)p.abort();pending.clear();}
  function clearVisitor(forget){
    let id;
    try{id=env.localStorage.getItem(VISITOR_KEY);env.localStorage.removeItem(VISITOR_KEY);}catch{return;}
    if(!forget||!id||!enabled()||signal()||env.navigator?.onLine===false)return;
    // Withdrawal is the sole non-analytics request; never queue an offline deletion.
    try{Promise.resolve(env.fetch(new URL('/forget',config.endpoint).href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({visitorId:id}),credentials:'omit',referrerPolicy:'no-referrer',mode:'cors',cache:'no-store',keepalive:true})).catch(()=>{});}catch{}
  }
  function visitor(){
    try{let id=env.localStorage.getItem(VISITOR_KEY);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id||'')){id=randomVisitorId(env.crypto);env.localStorage.setItem(VISITOR_KEY,id);}return id;}catch{return null;}
  }
  function send(event,properties){
    readConsent();
    if(dead||!enabled()||!storage||signal()||env.navigator?.onLine===false||!(event==='page_view'?consent?.basic:consent?.product))return false;
    const visitorId=event==='page_view'?visitor():null;
    if(event==='page_view'&&!visitorId)return false;
    const payload=validateEvent({event,version:config.version,deployment:config.deployment,site:site(env,config.deployment),properties,...(visitorId?{visitorId}:{})});
    if(!payload)return false;
    const now=Date.now();if(now-minute>=60000){minute=now;count=0;}
    if(count>=30||(event==='preview_finished'&&now-previewAt<30000))return false;
    if(event==='preview_finished')previewAt=now;count++;
    const controller=new AbortController();pending.add(controller);
    try{Promise.resolve(env.fetch(config.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),credentials:'omit',referrerPolicy:'no-referrer',mode:'cors',cache:'no-store',keepalive:true,signal:controller.signal})).catch(()=>{}).finally(()=>pending.delete(controller));}catch{pending.delete(controller);return false;}
    return true;
  }
  function page(){if(!pageSent&&consent?.basic)pageSent=send('page_view',visitProperties);}
  let ui;
  const controller={
    track:(event,properties={})=>event!=='page_view'&&send(event,properties),
    getConsent:()=>{readConsent();return {basic:!!(consent?.basic&&!signal()),product:!!(consent?.product&&!signal())};},
    setConsent(next){abort();const choice={basic:next?.basic===true,product:next?.product===true};if(!choice.basic){clearVisitor(true);pageSent=false;}try{env.localStorage.setItem(KEY,JSON.stringify({...choice,policy:POLICY,savedAt:Date.now()}));storage=true;consent=choice;}catch{storage=false;consent=null;}ui?.refresh();page();return storage;},
    destroy(){dead=true;abort();env.removeEventListener?.('storage',onStorage);env.removeEventListener?.('focus',refreshChoice);env.document?.removeEventListener?.('visibilitychange',refreshChoice);ui?.remove();if(active===controller)active=undefined;},
  };
  function refreshChoice(){readConsent();ui?.refresh();page();}
  function onStorage(event){if(event.key===KEY||event.key===null){abort();refreshChoice();}}
  env.addEventListener?.('storage',onStorage);
  env.addEventListener?.('focus',refreshChoice);
  env.document?.addEventListener?.('visibilitychange',refreshChoice);
  if(env.document)ui=mount(env.document,controller,{enabled,signal,endpoint:config.endpoint,storage:()=>storage,hasChoice:()=>consent!==null});
  active=controller;page();return controller;
}
function randomVisitorId(crypto){
  if(typeof crypto?.randomUUID==='function')return crypto.randomUUID();
  // getRandomValues also works on HTTP self-hosted sites; Math.random is unsuitable.
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function site(env,deployment){
  const host=env.location?.hostname||'';
  if(host==='md2pdf.app.workbuddy.host'&&deployment==='server')return 'official-server';
  if((host==='md2pdf.qianjiye.de'||host==='jiyeqian.github.io'&&env.location.pathname.startsWith('/md2pdf/'))&&deployment==='static')return 'official-static';
  if(host==='localhost'||host.endsWith('.localhost')||host==='127.0.0.1'||host==='[::1]'||!host.includes('.')||/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host))return 'local';
  return 'self-hosted';
}
function validEndpoint(value){try{const u=new URL(value);return u.protocol==='https:'&&u.pathname==='/events'&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}}
function visit(env){
  const ua=env.navigator?.userAgent||'',lang=(env.navigator?.language||'').toLowerCase();
  const p={source:'direct',device:/ipad|tablet/i.test(ua)?'tablet':/mobile|iphone|android/i.test(ua)?'mobile':'desktop',browser:/edg\//i.test(ua)?'edge':/firefox\//i.test(ua)?'firefox':/chrome|crios/i.test(ua)?'chrome':/safari/i.test(ua)?'safari':'other',os:/iphone|ipad|ipod/i.test(ua)?'ios':/android/i.test(ua)?'android':/windows/i.test(ua)?'windows':/macintosh|mac os/i.test(ua)?'macos':/linux/i.test(ua)?'linux':'other',language:lang.startsWith('zh')?'zh':lang.startsWith('en')?'en':'other'};
  try{const campaign=new URL(env.location.href).searchParams.get('utm_source');if(campaign){p.source='campaign';p.campaign=['github','wechat','zhihu','xiaohongshu'].includes(campaign.toLowerCase())?campaign.toLowerCase():'other';}else if(env.document?.referrer){const host=new URL(env.document.referrer).hostname;if(host!==env.location.hostname)p.source=/(^|\.)(google\.[a-z.]+|bing\.com|baidu\.com|duckduckgo\.com)$/.test(host)?'search':/(^|\.)(github\.com|weixin\.qq\.com|zhihu\.com|xiaohongshu\.com|x\.com|twitter\.com|facebook\.com)$/.test(host)?'social':'referral';}}catch{/* Never transmit raw sources. */}
  return p;
}
function mount(doc,controller,state){
  const root=doc.createElement('span');root.className='analytics-controls';
  root.innerHTML=`<button type="button" class="analytics-settings">隐私与统计</button><span class="analytics-prompt" hidden>允许可选统计，帮助改进排版？ <button type="button" data-choice="all">允许全部</button> <button type="button" data-choice="none">拒绝全部</button> <button type="button" data-choice="settings">自定义</button></span><dialog class="analytics-dialog" aria-labelledby="analytics-title" aria-describedby="analytics-summary"><header class="analytics-heading"><h2 id="analytics-title">隐私与统计</h2><button type="button" class="analytics-close" data-choice="close" aria-label="关闭">×</button></header><p id="analytics-summary">使用统计发送至 <span class="analytics-service">md2pdf 统计服务</span>，不上传用户文档。拒绝不影响使用。</p><p class="analytics-status" role="status"></p><label><input type="checkbox" name="basic"><span>访问统计<small>活跃浏览器、地区、来源与设备</small></span></label><label><input type="checkbox" name="product"><span>产品统计<small>模板、预览与导出</small></span></label><p class="analytics-hint">可随时撤回 · 明细保留约 90 天<br><a href="./privacy.html" target="_blank" rel="noopener noreferrer">完整隐私说明</a></p><div class="analytics-actions"><button type="button" data-choice="all">允许全部</button><button type="button" data-choice="none">拒绝全部</button><button type="button" data-choice="save">保存选择</button></div></dialog>`;
  const dialog=root.querySelector('dialog'),prompt=root.querySelector('.analytics-prompt'),basic=root.querySelector('[name="basic"]'),product=root.querySelector('[name="product"]');
  doc.body.append(dialog);
  try{if(new URL(state.endpoint).hostname!=='md2pdf-analytics.jiye-qian.workers.dev')dialog.querySelector('.analytics-service').textContent='部署者配置的统计服务';}catch{}
  function refresh(){const c=controller.getConsent();basic.checked=c.basic;product.checked=c.product;const blocked=!state.enabled()||state.signal()||!state.storage();basic.disabled=product.disabled=blocked;[...root.querySelectorAll('[data-choice="all"], [data-choice="save"]'), ...dialog.querySelectorAll('[data-choice="all"], [data-choice="save"]')].forEach(b=>{b.disabled=blocked;});prompt.hidden=state.hasChoice()||blocked;const status=dialog.querySelector('.analytics-status');status.textContent=state.signal()?'浏览器隐私设置已关闭统计。':!state.storage()?'无法保存选择，统计已关闭。':!state.enabled()?'此环境未启用统计。':'';status.hidden=!status.textContent;}
  const onClick=e=>{const b=e.target.closest('button');if(!b)return;const c=b.dataset.choice;if(b.classList.contains('analytics-settings')||c==='settings'){refresh();dialog.showModal();return;}if(['all','none','save'].includes(c)){controller.setConsent(c==='save'?{basic:basic.checked,product:product.checked}:{basic:c==='all',product:c==='all'});dialog.close();}else if(c==='close')dialog.close();};
  root.addEventListener('click',onClick);
  dialog.addEventListener('click',onClick);
  (doc.querySelector('#analytics-slot')||doc.querySelector('.app-bottom .privacy')||doc.querySelector('.app-bottom')||doc.body).append(root);refresh();return{refresh,remove:()=>{root.remove();dialog.remove();}};
}
