import test from 'node:test';
import assert from 'node:assert/strict';
import { bindManualUpdate, waitForInstallation } from '../web/manual-update.mjs';

function fixture({ online = true, status = {ready:true,current:'new',pinned:'old'}, update = async()=>{} } = {}) {
  const states = new Map(); let applied = 0, clicked;
  const registration = {update, active:{state:'activated'}};
  const check = bindManualUpdate({
    window:{navigator:{onLine:online},mdFooterStatus:{set:(key,state)=>states.set(key,state),clear:key=>states.delete(key)}},
    document:{querySelector:()=>({addEventListener:(_,handler)=>{clicked=handler;}})},
    getRegistration:async()=>registration, queryStatus:async()=>status,
    applyUpdate:async()=>{applied++;},
  });
  return {check,states,get applied(){return applied;},get clicked(){return clicked;}};
}
test('manual update applies a ready newer release once despite repeated clicks', async()=>{
  let release;
  const f=fixture({update:()=>new Promise(resolve=>{release=resolve;})});
  const first=f.check();
  await Promise.resolve();
  await f.check();
  assert.equal(f.states.get('manual'),'checking');
  release(); await first;
  assert.equal(f.applied,1);
});
test('offline and incomplete downloads preserve the page and report failure',async()=>{
  for(const options of [{online:false},{status:{ready:false,current:'new',pinned:'old'}}]){
    const f=fixture(options); await f.check();
    assert.equal(f.applied,0); assert.equal(f.states.get('manual'),'checkError');
  }
});
test('installation waits for complete assets and rejects a failed or timed-out worker',async()=>{
  const worker=new EventTarget();worker.state='installing';
  let finished=false;
  const pending=waitForInstallation(worker).then(()=>{finished=true;});
  await Promise.resolve();assert.equal(finished,false);
  worker.state='installed';worker.dispatchEvent(new Event('statechange'));
  await pending;assert.equal(finished,true);
  worker.state='redundant';await assert.rejects(waitForInstallation(worker),/失败/);
  worker.state='installing';await assert.rejects(waitForInstallation(worker,5),/超时/);
});
