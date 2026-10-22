import assert from 'node:assert/strict';
import { initAnalytics, track } from '../web/analytics.mjs';

const descriptors = new Map(['navigator','location','localStorage','fetch','document','addEventListener','removeEventListener'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
const config={enabled:true,endpoint:'https://metrics.example.com/events',version:'1.15.6',deployment:'static'};
let current;
function fixture({protocol='https:',host='md2pdf.qianjiye.de',path='/',online=true,gpc=false,dnt='0',brokenStorage=false,saved=null}={}){
  current?.destroy();
  const calls=[];const values=new Map(saved?[['md2pdf.analytics.consent',JSON.stringify(saved)]]:[]);
  const define=(key,value)=>Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const listeners = new Map();
  define('addEventListener', (type, listener) => listeners.set(type, listener));
  define('removeEventListener', (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); });
  define('document',undefined);
  define('navigator',{onLine:online,globalPrivacyControl:gpc,doNotTrack:dnt,userAgent:'Mozilla Macintosh Chrome/123',language:'zh-CN'});
  define('location',{protocol,hostname:host,pathname:path,href:`${protocol}//${host}${path}?utm_source=private-document-title`});
  define('localStorage',{getItem:key=>{if(brokenStorage)throw Error('blocked');return values.get(key)??null;},setItem:(key,value)=>{if(brokenStorage)throw Error('blocked');values.set(key,value);},removeItem:key=>values.delete(key)});
  define('fetch',(url,options)=>{calls.push({url,options,body:JSON.parse(options.body)});return new Promise(()=>{});});
  current=initAnalytics(config);return {calls,values,controller:current,dispatch:(type,event={})=>listeners.get(type)?.(event)};
}
try{
  let f=fixture();assert.equal(f.calls.length,0,'no consent must send nothing');
  assert.equal(track('export_started',{method:'browser-print'}),false);
  globalThis.location.href='https://md2pdf.qianjiye.de/';
  f.controller.setConsent({basic:true,product:false});assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.event,'page_view');assert.match(f.calls[0].body.visitorId,/^[0-9a-f-]{36}$/);assert.equal(f.calls[0].body.site,'official-static');
  const firstId=f.calls[0].body.visitorId;assert.equal(f.values.get('md2pdf.analytics.visitor'),firstId);
  assert.equal(f.calls[0].body.properties.campaign,'other');assert(!JSON.stringify(f.calls[0].body).includes('private-document-title'));
  assert.equal(f.calls[0].options.credentials,'omit');assert.equal(f.calls[0].options.referrerPolicy,'no-referrer');
  assert.equal(f.controller.track('export_started',{method:'browser-print'}),false,'product requires separate opt in');
  f.controller.setConsent({basic:true,product:true});assert.equal(f.calls.length,1,'page view once per document');assert.equal(f.values.get('md2pdf.analytics.visitor'),firstId);
  assert.equal(track('export_started',{method:'browser-print'}),true);assert(!('visitorId' in f.calls.at(-1).body));
  assert.equal(track('export_started',{method:'browser-print',title:'secret'}),false);
  assert.equal(track('unexpected',{text:'secret'}),false);assert.equal(track('page_view',{}),false);
  const preview={success:true,duration:'lt1s',length:'lt1k',template:'general'};
  assert.equal(track('preview_finished',preview),true);assert.equal(track('preview_finished',preview),false,'preview rate limited');
  const lastRequest=f.calls.at(-1);f.controller.setConsent({basic:false,product:false});
  assert.equal(lastRequest.options.signal.aborted,true,'withdrawal aborts pending requests');
  assert.equal(f.calls.at(-1).url,'https://metrics.example.com/forget');assert(!f.values.has('md2pdf.analytics.visitor'));
  const before=f.calls.length;assert.equal(track('export_started',{method:'browser-print'}),false);assert.equal(f.calls.length,before);
  assert.deepEqual(Object.keys(JSON.parse(f.values.get('md2pdf.analytics.consent'))).sort(),['basic','policy','product','savedAt']);
  for(const options of [{online:false},{gpc:true},{dnt:'1'},{protocol:'file:'},{brokenStorage:true}]){
    f=fixture(options);f.controller.setConsent({basic:true,product:true});assert.equal(f.calls.length,0,JSON.stringify(options));assert(!f.values.has('md2pdf.analytics.visitor'));assert.equal(track('export_started',{method:'browser-print'}),false);
  }
  f=fixture({saved:{basic:true,product:true,policy:1,savedAt:Date.now()}});assert.equal(f.calls.length,0,'policy 1 must be reconfirmed');assert(!f.values.has('md2pdf.analytics.visitor'));
  for(const [host,expected] of [['localhost','local'],['127.0.0.1','local'],['192.168.1.2','local'],['private.example.com','self-hosted'],['jiyeqian.github.io','self-hosted']]){f=fixture({host,protocol:'http:'});f.controller.setConsent({basic:true});assert.equal(f.calls[0].body.site,expected);assert(!JSON.stringify(f.calls[0].body).includes(host),'host never transmitted');}
  f=fixture({saved:{basic:true,product:true,policy:2,savedAt:Date.now()-181*86400000}});assert.equal(f.calls.length,0,'expired consent ignored');
  f=fixture({saved:{basic:true,product:false,policy:2,savedAt:Date.now()}});assert.equal(f.calls.length,1,'valid stored consent respected');
  f=fixture();f.controller.setConsent({product:true});assert(!f.values.has('md2pdf.analytics.visitor'));assert.equal(f.calls.length,0,'product-only consent sends no visits');
  for(let i=0;i<40;i++)track('offline_ready',{ready:true});assert.equal(f.calls.length,30,'all events have rate bound');
  f=fixture();
  f.values.set('md2pdf.analytics.consent',JSON.stringify({basic:true,product:false,policy:2,savedAt:Date.now()}));
  f.dispatch('storage',{key:'md2pdf.analytics.consent'});
  assert.equal(f.calls.length,1,'another tab grant sends the first visit');
  f.dispatch('focus');assert.equal(f.calls.length,1,'focus does not duplicate visit');
  f.controller.setConsent({basic:false});
  const withdrawnId=f.calls[0].body.visitorId;
  f.controller.setConsent({basic:true});
  assert.notEqual(f.calls.at(-1).body.visitorId,withdrawnId,'reconsent starts fresh identifier and visit');
  f=fixture();f.controller.setConsent({basic:true,product:true});
  let request=f.calls.at(-1);
  f.values.set('md2pdf.analytics.consent',JSON.stringify({basic:false,product:false,policy:2,savedAt:Date.now()}));
  f.dispatch('storage',{key:'md2pdf.analytics.consent'});
  assert.equal(request.options.signal.aborted,true,'other tab withdrawal aborts pending request');
  assert.equal(track('offline_ready',{ready:true}),false,'other tab withdrawal stops tracking');
  f.controller.setConsent({basic:true,product:true});request=f.calls.at(-1);
  f.values.clear();f.dispatch('storage',{key:null});
  assert.equal(request.options.signal.aborted,true,'storage.clear aborts pending requests');
  assert.deepEqual(f.controller.getConsent(),{basic:false,product:false});
  f.controller.setConsent({basic:false,product:true});
  f.values.set('md2pdf.analytics.consent','invalid json');
  assert.equal(track('offline_ready',{ready:true}),false,'every send rereads storage without an event');
  f.controller.setConsent({basic:true,product:true});
  const realNow=Date.now;
  const future=realNow()+181*86400000;
  try { Date.now=()=>future; assert.equal(track('offline_ready',{ready:true}),false,'open tab consent expires');assert.deepEqual(f.controller.getConsent(),{basic:false,product:false}); } finally {Date.now=realNow;}
  f=fixture();current.destroy();current=initAnalytics({...config,endpoint:'https://metrics.example.com/not-events'});current.setConsent({basic:true,product:true});assert.equal(f.calls.length,0,'only /events endpoint accepted');
  f.controller.destroy();assert.equal(track('offline_ready',{ready:true}),false);
  console.log('analytics client checks passed');
}finally{
  current?.destroy();
  for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
}
