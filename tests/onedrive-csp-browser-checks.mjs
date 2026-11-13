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
const seen=[];
try {
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  staticServer=await startStaticServer({directory:path.resolve('dist/static'),port:0});
  staticServer.prependListener('request',(req,res)=>res.setHeader('Content-Security-Policy',pageCsp(null,{callback:req.url.startsWith('/onedrive-callback.html')})));
  await browser.start();
  browser.ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data); if(message.method!=='Fetch.requestPaused')return;
    const {requestId,request}=message.params, url=request.url; seen.push({url,method:request.method});
    let body='{}';
    if(url.includes('/special/approot')) body=JSON.stringify({id:'root'});
    else if(url.includes('/items/cloud?')) body=JSON.stringify({id:'cloud',name:'cloud.md',eTag:'old','@microsoft.graph.downloadUrl':'https://public-sn3302.files.1drv.com/test'});
    else if(url.includes('files.1drv.com')) body='# cloud';
    else if(url.endsWith('/createUploadSession')) body=JSON.stringify({uploadUrl:'https://sn3302.up.1drv.com/test'});
    else if(url.endsWith('/items/root') && request.method==='PUT') body=JSON.stringify({id:'new',name:'new.md',eTag:'new'});
    else if(url.includes('login.microsoftonline.com')) body=JSON.stringify({access_token:'test-token'});
    browser.send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Access-Control-Allow-Origin',value:'*'},{name:'Access-Control-Allow-Methods',value:'GET, POST, PUT, DELETE, OPTIONS'},{name:'Access-Control-Allow-Headers',value:'*'},{name:'Content-Type',value:'application/json'}],body:Buffer.from(body).toString('base64')}).catch(()=>{});
  });
  await browser.send('Fetch.enable',{patterns:[{urlPattern:'https://login.microsoftonline.com/*'},{urlPattern:'https://graph.microsoft.com/*'},{urlPattern:'https://*.files.1drv.com/*'},{urlPattern:'https://*.up.1drv.com/*'}]});
  for(const base of [`http://127.0.0.1:${app.server.address().port}`,`http://127.0.0.1:${staticServer.address().port}`]) {
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
      await new Promise(resolve=>setTimeout(resolve,150));
      return {opened:opened.text,saved:saved.id,blocked,violations,callbackAccessible};
    })()`);
    assert.equal(result.opened,'# cloud'); assert.equal(result.saved,'new'); assert.equal(result.callbackAccessible,true); assert.equal(result.blocked,true); assert.ok(result.violations.some(uri=>uri.includes('blocked.example')),JSON.stringify(result));
  }
  for(const host of ['login.microsoftonline.com','graph.microsoft.com','files.1drv.com','up.1drv.com']) assert.ok(seen.some(entry=>entry.url.includes(host)),host);
  console.log('Browser CSP network interception passed for Node and static');
} finally {await browser.stop();await new Promise(resolve=>app.server.close(resolve));if(staticServer)await new Promise(resolve=>staticServer.close(resolve));await rm(temp,{recursive:true,force:true});}
