import { validateEvent } from './analytics-schema.mjs';
const KEY='md2pdf.analytics.consent', POLICY=1, AGE=180*86400000;
let active;
export function track(event,properties={}) { return active?.track(event,properties)??false; }
export function initAnalytics(config={}) {
  active?.destroy();
  const env=globalThis;
  const visitProperties = visit(env);
  let consent=null, storage=true, dead=false, pageSent=false, previewAt=-Infinity, count=0, minute=Date.now();
  const pending=new Set();
  const signal=()=>env.navigator?.globalPrivacyControl===true||env.navigator?.doNotTrack==='1'||env.doNotTrack==='1';
  const enabled=()=>config.enabled===true&&env.location?.protocol==='https:'&&config.allowedHosts?.includes(env.location.hostname)&&(env.location.hostname!=='jiyeqian.github.io'||env.location.pathname.startsWith('/md2pdf/'))&&validEndpoint(config.endpoint);
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
    if (signal() || (previous?.basic && !consent?.basic) || (previous?.product && !consent?.product)) abort();
    return consent;
  }
  readConsent();
  function abort(){for(const p of pending)p.abort();pending.clear();}
  function send(event,properties){
    readConsent();
    if(dead||!enabled()||!storage||signal()||env.navigator?.onLine===false||!(event==='page_view'?consent?.basic:consent?.product))return false;
    const payload=validateEvent({event,version:config.version,deployment:config.deployment,properties});
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
    setConsent(next){abort();const choice={basic:next?.basic===true,product:next?.product===true};try{env.localStorage.setItem(KEY,JSON.stringify({...choice,policy:POLICY,savedAt:Date.now()}));storage=true;consent=choice;}catch{storage=false;consent=null;}ui?.refresh();page();return storage;},
    destroy(){dead=true;abort();env.removeEventListener?.('storage',onStorage);env.removeEventListener?.('focus',refreshChoice);env.document?.removeEventListener?.('visibilitychange',refreshChoice);ui?.remove();if(active===controller)active=undefined;},
  };
  function refreshChoice(){readConsent();ui?.refresh();}
  function onStorage(event){if(event.key===KEY||event.key===null){abort();refreshChoice();}}
  env.addEventListener?.('storage',onStorage);
  env.addEventListener?.('focus',refreshChoice);
  env.document?.addEventListener?.('visibilitychange',refreshChoice);
  if(env.document)ui=mount(env.document,controller,{enabled,signal,storage:()=>storage,hasChoice:()=>consent!==null});
  active=controller;page();return controller;
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
  root.innerHTML=`<button type="button" class="analytics-settings">隐私与统计</button><span class="analytics-prompt" hidden>允许可选统计，帮助改进排版？ <button type="button" data-choice="all">允许全部</button> <button type="button" data-choice="none">拒绝全部</button> <button type="button" data-choice="settings">自定义</button></span><dialog class="analytics-dialog" aria-labelledby="analytics-title"><h2 id="analytics-title">隐私与统计</h2><p>不上传文档正文、文件名和图片。不收集姓名、邮箱、浏览器指纹或持久访客标识。</p><p>自愿开启后，统计通过 Cloudflare 接收；事件明细保留约 90 天，并由每日任务清理。服务商恢复备份另按其保留规则处理，详见完整隐私说明。统计不用于营销订阅。撤回立即停止后续发送，已接收的记录按期删除。</p><p class="analytics-status" role="status"></p><label><input type="checkbox" name="basic"> 访问统计：国家／地区（Cloudflare 推断的两位国家码）、来源类别、设备、浏览器、系统、语言类别及版本</label><label><input type="checkbox" name="product"> 产品统计：模板／主题、预览结果与耗时和长度区间、导出操作及离线资源状态</label><p>浏览器打印仅统计发起操作，无法确认 PDF 已保存。网络服务处理连接时会接触 IP 等请求信息，但应用不保存这些信息。详见 <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Cloudflare 隐私政策</a>。选择仅保存在此浏览器，180 天后重新询问；拒绝不影响编辑和导出。</p><p><a href="./privacy.html" target="_blank" rel="noopener noreferrer">完整隐私说明</a>。隐私问题请通过 <a href="https://github.com/jiyeqian/md2pdf/issues" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">项目反馈</a> 联系维护者，请勿公开个人信息或文档内容。</p><div class="analytics-actions"><button type="button" data-choice="all">允许全部</button><button type="button" data-choice="none">拒绝全部</button><button type="button" data-choice="save">保存选择</button><button type="button" data-choice="close">关闭</button></div></dialog>`;
  const dialog=root.querySelector('dialog'),prompt=root.querySelector('.analytics-prompt'),basic=root.querySelector('[name="basic"]'),product=root.querySelector('[name="product"]');
  doc.body.append(dialog);
  function refresh(){const c=controller.getConsent();basic.checked=c.basic;product.checked=c.product;const blocked=!state.enabled()||state.signal()||!state.storage();basic.disabled=product.disabled=blocked;[...root.querySelectorAll('[data-choice="all"], [data-choice="save"]'), ...dialog.querySelectorAll('[data-choice="all"], [data-choice="save"]')].forEach(b=>{b.disabled=blocked;});prompt.hidden=state.hasChoice()||blocked;dialog.querySelector('.analytics-status').textContent=state.signal()?'已遵循浏览器“不跟踪／全球隐私控制”设置，统计已关闭。':!state.storage()?'无法保存隐私选择，统计保持关闭。':!state.enabled()?'此环境未启用统计，不会发送统计请求。':'两项统计均由你自愿选择，可随时撤回。';}
  const onClick=e=>{const b=e.target.closest('button');if(!b)return;const c=b.dataset.choice;if(b.classList.contains('analytics-settings')||c==='settings'){refresh();dialog.showModal();return;}if(['all','none','save'].includes(c)){controller.setConsent(c==='save'?{basic:basic.checked,product:product.checked}:{basic:c==='all',product:c==='all'});dialog.close();}else if(c==='close')dialog.close();};
  root.addEventListener('click',onClick);
  dialog.addEventListener('click',onClick);
  (doc.querySelector('.app-bottom .privacy')||doc.querySelector('.app-bottom')||doc.body).append(root);refresh();return{refresh,remove:()=>{root.remove();dialog.remove();}};
}
