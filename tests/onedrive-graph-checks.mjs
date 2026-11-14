import test from 'node:test';
import assert from 'node:assert/strict';
import { createOneDriveGraph } from '../web/onedrive-graph.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
test('ordinary new-file upload confirms exact size and downloaded bytes', async () => {
  for (const status of [200, 201]) {
    const calls=[];
    const graph=createOneDriveGraph({token:async()=> 'secret',fetch:async (url,options)=>{
      if(url.includes('/special/approot')) return json({id:'root'});
      if(url.includes('/items/root?$select=id,name,eTag,folder,file,package,remoteItem,root,parentReference')) return json({id:'root',folder:{}});
      calls.push({url,options});
      if(url.endsWith('/createUploadSession')) return json({uploadUrl:'https://upload.example/session'});
      if(url.startsWith('https://upload.example/')) return json({id:'new',eTag:'tag',name:'a.md',file:{},size:5},status);
      if(url.includes('/items/new?')) return json({id:'new',eTag:'tag',name:'a.md','@microsoft.graph.downloadUrl':'https://s.files.1drv.com/file'});
      if(url.startsWith('https://s.files.1drv.com/')) return new Response('hello');
      throw new Error('unexpected');
    }});
    assert.equal((await graph.save({rootId:'root',name:'a.md',text:'hello'})).id,'new');
    const body=JSON.parse(calls[0].options.body);
    assert.equal(body.item['@microsoft.graph.conflictBehavior'],'fail');
    assert.equal(body.deferCommit,undefined);
    assert.equal(calls.filter(call=>call.url.includes('/items/root') && call.options.method==='PUT').length,0);
    for(const call of [calls[1],calls[3]]) { assert.equal(call.options.headers?.Authorization,undefined); assert.equal(call.options.credentials,'omit'); }
  }
});
test('collision, incomplete or inconsistent results never confirm a save', async () => {
  for (const scenario of ['409','412','202','zero','different','missing','readfail']) {
    const calls=[];
    const graph=createOneDriveGraph({token:async()=> 'token',fetch:async (url,options)=>{
      if(url.includes('/special/approot')) return json({id:'root'});
      if(url.includes('/items/root?$select=id,name,eTag,folder,file,package,remoteItem,root,parentReference')) return json({id:'root',folder:{}});
      calls.push({url,options});
      if(url.endsWith('/createUploadSession')) return json({uploadUrl:'https://upload.example/session'});
      if(url.startsWith('https://upload.example/') && options.method==='DELETE') return new Response(null,{status:204});
      if(url.startsWith('https://upload.example/')) {
        if(['409','412','202'].includes(scenario)) return json({},Number(scenario));
        return json({id:'new',eTag:'tag',name:'a.md',...(scenario==='missing'?{}:{file:{}}),size:scenario==='zero'?0:5},201);
      }
      if(url.includes('/items/new?')) return scenario==='readfail' ? json({error:{code:'itemNotFound'}},404) : json({id:'new',eTag:'tag',name:'a.md','@microsoft.graph.downloadUrl':'https://s.files.1drv.com/file'});
      if(url.startsWith('https://s.files.1drv.com/')) return new Response(scenario==='different'?'wrong':'hello');
      throw new Error('unexpected');
    }});
    await assert.rejects(graph.save({rootId:'root',name:'a.md',text:'hello'}),error => ['409','412'].includes(scenario) ? error.status===Number(scenario) : /保存未确认/.test(error.message));
    assert.equal(calls.filter(call=>call.options.method==='PUT' && call.url.startsWith('https://upload.example/')).length,1);
    if(['zero','different','missing','readfail'].includes(scenario)) assert.equal(calls.some(call=>call.options.method==='DELETE'),false);
  }
});
test('existing and empty files are rejected locally', async () => {
  const graph=createOneDriveGraph({token:async()=>{throw new Error('unexpected');}});
  await assert.rejects(graph.save({id:'a',eTag:'old',name:'a.md',text:'data'}),/不能安全覆盖/);
  await assert.rejects(graph.save({id:'a',name:'a.md',text:''}),/空文件/);
});
test('Graph stage and allowlisted error code exclude untrusted details', async () => {
  for (const [payload,expected] of [[{error:{code:'invalidRequest',message:'private-url',innerError:{id:'private-id'}}},'invalidRequest'],[{error:{code:'privatePerson',message:'private-url'}},''],[{error:{code:'bad-code?secret'}},'']]) {
    const graph=createOneDriveGraph({token:async()=> 'token',fetch:async()=>json(payload,400)});
    await assert.rejects(graph.list(),error => /读取应用文件夹失败（HTTP 400/.test(error.message) && (!expected || error.message.includes(expected)) && !/private|secret|bad-code/.test(error.message));
  }
});
test('download URL receives no Graph token', async () => {
  const calls = [];
  const graph = createOneDriveGraph({ token: async () => 'secret', fetch: async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? json({ id: 'x', name: 'x.md', eTag: 'tag', '@microsoft.graph.downloadUrl': 'https://public-sn3302.files.1drv.com/x' }) : new Response('content');
  } });
  assert.equal((await graph.open('x')).text, 'content');
  assert.equal(calls[1].options.headers, undefined);
  assert.equal(calls[1].options.credentials, 'omit');
});

test('download rejects untrusted origins and reports safe failure details', async () => {
  let calls = 0;
  const graph = createOneDriveGraph({ token: async () => 'secret', fetch: async () => {
    calls++; return json({id:'x',name:'x.md',eTag:'tag','@microsoft.graph.downloadUrl':'https://evil.example/x?secret=private'});
  }});
  await assert.rejects(graph.open('x'), error => /evil.example/.test(error.message) && !error.message.includes('private'));
  assert.equal(calls,1);
  const failed = createOneDriveGraph({token:async()=> 'secret',fetch:async url => {
    if (url.startsWith('https://graph.microsoft.com')) return json({id:'x',name:'x.md',eTag:'tag','@microsoft.graph.downloadUrl':'https://s.files.1drv.com/x?secret=private'});
    throw new TypeError('private');
  }});
  await assert.rejects(failed.open('x'), error => /下载文件失败/.test(error.message) && /https:\/\/s.files.1drv.com/.test(error.message) && !error.message.includes('private'));
});

test('missing metadata reports only missing names, facets and safe size', async () => {
  const selected=[];
  const graph=createOneDriveGraph({token:async()=> 'token',fetch:async url=>{
    selected.push(url);
    return json({id:'private-id',name:'private-name',eTag:'private-etag',file:{},size:42,privateField:'private-value'});
  }});
  await assert.rejects(graph.open('x'), error => /@microsoft.graph.downloadUrl/.test(error.message) && /file/.test(error.message) && /42/.test(error.message) && !error.message.includes('private'));
  assert.match(selected[0], /file,folder,package,size,@microsoft.graph.downloadUrl/);
  assert.equal(selected[1], 'https://graph.microsoft.com/v1.0/me/drive/items/x');
});

test('each missing required metadata field is reported without exposing values', async () => {
  const fields = ['id', 'eTag', '@microsoft.graph.downloadUrl'];
  for (const field of fields) {
    const item = {id:'secret-id',eTag:'secret-etag','@microsoft.graph.downloadUrl':'https://s.files.1drv.com/path?secret=query',folder:{},package:{},size:0};
    delete item[field];
    const graph = createOneDriveGraph({ token:async()=> 'token', fetch:async()=>json(item) });
    await assert.rejects(graph.open('x'), error => error.message.includes(field) && /folder\/package/.test(error.message) && /0 字节/.test(error.message) && !error.message.includes('secret'));
  }
});

test('personal content download accepts only the exact Microsoft host', async () => {
  for (const [host, allowed] of [['my.microsoftpersonalcontent.com',true],['my.microsoftpersonalcontent.com.evil.test',false],['evilmy.microsoftpersonalcontent.com',false]]) {
    let calls=0;
    const graph=createOneDriveGraph({token:async()=> 'token',fetch:async()=>{calls++;return calls===1 ? json({id:'x',eTag:'tag',name:'x.md','@microsoft.graph.downloadUrl':`https://${host}/file?secret=private`}) : new Response('ok');}});
    if (allowed) assert.equal((await graph.open('x')).text,'ok');
    else { await assert.rejects(graph.open('x'),/不受支持/); assert.equal(calls,1); }
  }
});

test('missing selected download URL retries full metadata only for the same version', async () => {
  for (const scenario of ['ok','missing','id-change','etag-change']) {
    const calls=[];
    const graph=createOneDriveGraph({token:async()=> 'token',fetch:async (url,options)=>{
      calls.push({url,options});
      if (calls.length===1) return json({id:'item',name:'a.md',eTag:'v1',file:{},size:4});
      if (calls.length===2) return json({id:scenario==='id-change'?'other':'item',name:'a.md',eTag:scenario==='etag-change'?'v2':'v1',file:{},size:4,...(scenario==='missing'?{}:{'@microsoft.graph.downloadUrl':'https://s.files.1drv.com/file?private=secret'})});
      return new Response('text');
    }});
    if (scenario==='ok') { assert.equal((await graph.open('item')).text,'text'); assert.equal(calls[2].options.headers,undefined); assert.equal(calls[2].options.credentials,'omit'); }
    else { await assert.rejects(graph.open('item'), scenario==='missing' ? /缺少 @microsoft.graph.downloadUrl/ : /版本已变化/); assert.equal(calls.length,2); }
    assert.equal(calls[1].url,'https://graph.microsoft.com/v1.0/me/drive/items/item');
  }
});

test('list requests and retains file sizes including empty files', async () => {
  const calls=[];
  const graph=createOneDriveGraph({token:async()=> 'token',fetch:async url=>{calls.push(url);return calls.length===1?json({id:'root'}):json({value:[{id:'a',name:'empty.md',file:{},size:0},{id:'b',name:'normal.md',file:{},size:5652}]});}});
  const list=await graph.list();
  assert.match(calls[1], /\$select=id,name,eTag,file,folder,size/);
  assert.deepEqual(list.items.map(item=>item.size),[0,5652]);
});

test('pagination is explicit, validates next links and never sends bearer to another origin', async () => {
  const calls=[];
  const next='https://graph.microsoft.com/v1.0/me/drive/items/root/children?$skiptoken=next';
  const graph=createOneDriveGraph({token:async()=> 'secret',fetch:async (url,options)=>{
    calls.push({url,options});
    if(url.includes('/special/approot')) return json({id:'root'});
    if(url===next) return json({value:[{id:'second',name:'second.md',file:{},size:0}]});
    return json({value:[{id:'ignored',name:'other.txt',file:{},size:2}], '@odata.nextLink':next});
  }});
  const page=await graph.list();
  assert.equal(calls.length,2); assert.match(calls[1].url,/\$top=100/); assert.deepEqual(page.items,[]); assert.equal(page.nextLink,next);
  assert.equal((await graph.listPage('root',next)).items[0].id,'second');
  for(const invalid of ['https://graph.microsoft.com.evil.test/v1.0/x','https://graph.microsoft.com/v2.0/x','https://user@graph.microsoft.com/v1.0/x',{},42]) await assert.rejects(graph.listPage('root',invalid));
  assert.equal(calls.length,3);
});


test('folder deletion uses fresh folder metadata and If-Match even when nonempty', async () => {
  for (const mode of ['ok','changed','missing','renamed','deleted']) {
    const calls=[]; const graph=createOneDriveGraph({token:async()=> 't',fetch:async(url,options)=>{calls.push({url,options});
      if(url.includes('/special/approot')) return json({id:'root'});
      if(url.includes('/items/root?')) return json({id:'root',folder:{}});
      if(options.method==='DELETE') return mode==='deleted'?json({},404):new Response(null,{status:mode==='changed'?412:204});
      return json({id:'folder',name:mode==='renamed'?'other':'name',folder:{childCount:2},parentReference:{id:'root'},...(mode==='missing'?{}:{eTag:'tag'})});
    }});
    if(mode==='ok') {await graph.deleteFolder('folder','tag','name');assert.equal(calls.at(-1).options.headers['If-Match'],'tag');}
    else await assert.rejects(graph.deleteFolder('folder','tag','name'));
    if(['missing','renamed'].includes(mode)) assert.ok(!calls.some(x=>x.options.method==='DELETE'));
  }
});
test('file deletion uses original version and new folders do not overwrite', async () => {
  const calls=[]; const graph=createOneDriveGraph({token:async()=> 't',fetch:async(url,options)=>{ if(url.includes('/special/approot')) return json({id:'root'}); if(url.includes('/items/root?') || url.includes('/items/parent?')) return json({id:url.includes('/items/root?')?'root':'parent',folder:{},parentReference:{id:'root'}}); if(url.includes('/items/file?')) return json({id:'file',name:'a.md',eTag:'tag',file:{},parentReference:{id:'root'}}); calls.push({url,options});return options.method==='DELETE'?new Response(null,{status:204}):json({id:'folder',folder:{}});}});
  await graph.deleteFile('file','tag','a.md'); assert.equal(calls[0].options.headers['If-Match'],'tag');
  await graph.createFolder('parent','new'); assert.equal(JSON.parse(calls[1].options.body)['@microsoft.graph.conflictBehavior'],'fail');
  await assert.rejects(graph.deleteFile('file',''));
});


test('mutations reject root, outside folders and unsafe file types', async () => {
  for (const mode of ['outside','remote','package','rootDelete','folderAsFile']) {
    let mutations=0;
    const g=createOneDriveGraph({token:async()=> 't',fetch:async(url,options)=>{
      if(options.method) mutations++;
      if(url.includes('/special/approot')) return json({id:'root'});
      if(url.includes('/items/root?')) return json({id:'root',folder:{}});
      if(url.includes('/items/target?') && mode==='rootDelete') return json({id:'target',name:'target',folder:{childCount:0},cTag:'ctag',root:{}});
      if(url.includes('/items/target?') && mode==='folderAsFile') return json({id:'target',name:'a.md',eTag:'tag',folder:{},parentReference:{id:'root'}});
      return json({id:'target',folder:{},...(mode==='remote'?{remoteItem:{}}:{}),...(mode==='package'?{package:{}}:{}),parentReference:{id:'outside'}});
    }});
    if(mode==='rootDelete') await assert.rejects(g.deleteFolder('target','tag','target'));
    else if(mode==='folderAsFile') await assert.rejects(g.deleteFile('target','tag','a.md'));
    else await assert.rejects(g.createFolder('target','new'));
    assert.equal(mutations,0);
  }
});

test('overwrite uses original id and If-Match; changed or missing targets never fall back', async () => {
  for (const mode of ['ok','changed','deleted','late','wrongid','readback']) {
    const calls=[];
    const g=createOneDriveGraph({token:async()=> 'secret',fetch:async(url,options)=>{
      calls.push({url,options});
      if(url.includes('/special/approot')) return json({id:'root'});
      if(url.includes('/items/root?')) return json({id:'root',folder:{}});
      if(url.endsWith('/items/file/content')) {
        assert.equal(options.headers['If-Match'],'original');
        if(mode==='late') return json({},412);
        return json({id:mode==='wrongid'?'other':'file',eTag:'new',name:'a.md',file:{},size:5});
      }
      if(url.includes('/items/file?$select=id,name,eTag,folder,file,package,remoteItem,root,parentReference')) {
        if(mode==='deleted') return json({},404);
        return json({id:'file',name:'a.md',eTag:mode==='changed'?'changed':'original',file:{},parentReference:{id:'root'}});
      }
      if(url.includes('/items/file?')) return json({id:'file',name:'a.md',eTag:'new','@microsoft.graph.downloadUrl':'https://s.files.1drv.com/file'});
      if(url.startsWith('https://s.files.1drv.com')) return new Response(mode==='readback'?'other':'hello');
      throw new Error('unexpected');
    }});
    if(mode==='ok') assert.equal((await g.overwrite({id:'file',eTag:'original',parentId:'root',name:'a.md',text:'hello'})).id,'file');
    else await assert.rejects(g.overwrite({id:'file',eTag:'original',parentId:'root',name:'a.md',text:'hello'}));
    const writes=calls.filter(x=>x.options.method==='PUT'); assert.ok(writes.length<=1); assert.ok(writes.every(x=>x.url.endsWith('/items/file/content')));
    if(mode==='changed'||mode==='deleted') assert.equal(writes.length,0);
  }
});
