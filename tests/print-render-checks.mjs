import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.mjs';

test('print render returns isolated document and retains input validation', async () => {
  const app=createApp(); await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${app.server.address().port}/api/render`;
  const post=body=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try {
    const result=await post({md:'# PRINT MARKER',opts:{},printDocument:true});
    assert.equal(result.status,200); const data=await result.json();
    assert.match(data.html,/PRINT MARKER/); assert.doesNotMatch(data.html,/md2pdf-preview-enhance/);
    assert.equal((await post({md:'# PRINT MARKER',opts:{theme:'invalid'},printDocument:true})).status,400);
    assert.equal((await post({md:'# PRINT MARKER',opts:{},unexpected:true})).status,400);
  } finally { await new Promise(resolve=>app.server.close(resolve)); }
});
