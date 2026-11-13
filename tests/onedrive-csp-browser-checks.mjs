import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createApp} from '../src/server.mjs';
import {startStaticServer} from '../src/static-server.mjs';
import {pageCsp} from '../src/page-csp.mjs';
import {Chrome,findChrome} from '../src/chrome.mjs';
const app=createApp(); const temp=await mkdtemp(path.join(os.tmpdir(),'md2pdf-csp-')); const browser=new Chrome(findChrome(),temp);
let staticServer;
const evalJS=async expression=>{const r=await browser.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.equal(r.exceptionDetails,undefined,JSON.stringify(r.exceptionDetails));return r.result.value;};
const seen=[]; let uploadHost='sn3302.up.1drv.com';
try {
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  staticServer=await startStaticServer({directory:path.resolve('dist/static'),port:0});
  staticServer.prependListener('request',(req,res)=>res.setHeader('Content-Security-Policy',pageCsp(null,{callback:req.url.startsWith('/onedrive-callback.html')})));
  await browser.start();
  browser.ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data); if(message.method!=='Fetch.requestPaused')return;
    const {requestId,request}=message.params, url=request.url; seen.push({url,method:request.method,headers:request.headers});
    let body='{}', status=200, extra=[];
    if(url==='https://public-sn3302.files.1drv.com/test') { status=302; extra=[{name:'Location',value:'https://public-sn3302.files.1drv.com/final'}]; }
    if(url.includes('/special/approot')) body=JSON.stringify({id:'root'});
    else if(url.includes('/items/cloud?')) body=JSON.stringify({id:'cloud',name:'cloud.md',eTag:'old','@microsoft.graph.downloadUrl':'https://public-sn3302.files.1drv.com/test'});
    else if(url.includes('files.1drv.com')) body=url.includes('/readback') ? 'body' : '# cloud';
    else if(url.includes('/items/new?')) body=JSON.stringify({id:'new',name:'new.md',eTag:'new','@microsoft.graph.downloadUrl':'https://public-sn3302.files.1drv.com/readback'});
    else if(url.endsWith('/createUploadSession')) body=JSON.stringify({uploadUrl:'https://' + uploadHost + '/test'});
    else if((url.includes('up.1drv.com') || url.includes('my.microsoftpersonalcontent.com')) && request.method==='PUT') {status=201; body=JSON.stringify({id:'new',name:'new.md',eTag:'new',file:{},size:4});}
    else if(url.includes('login.microsoftonline.com')) body=JSON.stringify({access_token:'test-token'});
    browser.send('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:[...extra,{name:'Access-Control-Allow-Origin',value:'*'},{name:'Access-Control-Allow-Methods',value:'GET, POST, PUT, DELETE, OPTIONS'},{name:'Access-Control-Allow-Headers',value:'*'},{name:'Content-Type',value:'application/json'}],body:Buffer.from(body).toString('base64')}).catch(()=>{});
  });
  await browser.send('Fetch.enable',{patterns:[{urlPattern:'https://login.microsoftonline.com/*'},{urlPattern:'https://graph.microsoft.com/*'},{urlPattern:'https://*.files.1drv.com/*'},{urlPattern:'https://*.up.1drv.com/*'},{urlPattern:'https://my.microsoftpersonalcontent.com/*'}]});
  for(const base of [`http://127.0.0.1:${app.server.address().port}`,`http://127.0.0.1:${staticServer.address().port}`]) {
    uploadHost=base.endsWith(':'+app.server.address().port) ? 'my.microsoftpersonalcontent.com' : 'sn3302.up.1drv.com';
    await browser.send('Page.navigate',{url:base+'/'});
    const result=await evalJS(`(async()=>{
      const violations=[]; document.addEventListener('securitypolicyviolation',event=>violations.push(event.blockedURI));
      const token=async()=>{const response=await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token',{method:'POST',body:'x'});return (await response.json()).access_token;};
      const {createOneDriveGraph}=await import('./onedrive-graph.mjs');
      const graph=createOneDriveGraph({token});
      const opened=await graph.open('cloud');
      const saved=await graph.save({rootId:'root',name:'new.md',text:'body'});
      const frame = document.createElement('iframe'); frame.src='./onedrive-callback.html'; document.body.append(frame);
      await new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=reject;setTimeout(()=>reject(new Error('callback iframe timeout')),5000);});
      const callbackAccessible = !!frame.contentDocument?.querySelector('title'); frame.remove();
      let blocked=false;try{await fetch('https://blocked.example/test');}catch{blocked=true;}
      let suffixBlocked=false;try{await fetch('https://my.microsoftpersonalcontent.com.evil.test/test');}catch{suffixBlocked=true;}
      await new Promise(resolve=>setTimeout(resolve,150));
      return {opened:opened.text,saved:saved.id,blocked,suffixBlocked,violations,callbackAccessible};
    })()`);
    assert.equal(result.opened,'# cloud'); assert.equal(result.saved,'new'); assert.equal(result.callbackAccessible,true); assert.equal(result.blocked,true); assert.equal(result.suffixBlocked,true); assert.ok(result.violations.some(uri=>uri.includes('my.microsoftpersonalcontent.com.evil.test'))); assert.ok(result.violations.some(uri=>uri.includes('blocked.example')),JSON.stringify(result));
  }
  for(const host of ['login.microsoftonline.com','graph.microsoft.com','files.1drv.com','up.1drv.com','my.microsoftpersonalcontent.com']) assert.ok(seen.some(entry=>entry.url.includes(host)),host);
  assert.ok(seen.some(entry=>entry.url.endsWith('/final')));
  assert.ok(seen.some(entry=>entry.url.startsWith('https://my.microsoftpersonalcontent.com/') && entry.method==='PUT'));
  assert.ok(seen.filter(entry=>entry.url.includes('files.1drv.com') || entry.url.includes('up.1drv.com') || entry.url.includes('my.microsoftpersonalcontent.com')).every(entry=>!Object.keys(entry.headers).some(key=>['authorization','cookie','referer'].includes(key.toLowerCase()))));
  console.log('Browser CSP network interception passed for Node and static');
} finally {await browser.stop();await new Promise(resolve=>app.server.close(resolve));if(staticServer)await new Promise(resolve=>staticServer.close(resolve));await rm(temp,{recursive:true,force:true});}
