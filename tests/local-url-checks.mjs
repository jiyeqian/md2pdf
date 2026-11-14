import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startStaticServer } from '../src/static-server.mjs';

async function request(port, host) {
  return new Promise((resolve,reject)=>http.get({hostname:'127.0.0.1',port,path:'/',headers:{Host:`${host}:${port}`}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject));
}
async function availablePort() {
  const server=http.createServer(); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port; await new Promise(resolve=>server.close(resolve)); return port;
}
test('Node workbench logs localhost while accepting both loopback Host names', async () => {
  const port=await availablePort();
  const child=spawn(process.execPath,['src/md2pdf.mjs','webapp','--port',String(port)],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
  let output='', errors=''; child.stderr.on('data',data=>{errors+=data;});
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('startup timeout: '+errors)),10000);
      child.on('exit',code=>{clearTimeout(timer);reject(new Error('startup exited '+code+': '+errors));});
      child.stdout.on('data',data=>{output+=data;if(output.includes('md2pdf 工作台：')){clearTimeout(timer);resolve();}});
    });
    assert.match(output,new RegExp(`http://localhost:${port}`));
    assert.equal(await request(port,'localhost'),200); assert.equal(await request(port,'127.0.0.1'),200);
    assert.equal((await fetch(`http://localhost:${port}/`)).status,200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status,200);
    assert.equal(await request(port,'evil.example'),403);
  } finally { child.kill('SIGTERM'); await new Promise(resolve=>child.once('exit',resolve)); }
});
test('static workbench logs localhost while accepting both loopback Host names', async () => {
  const original=console.log, logs=[]; let server;
  try {
    console.log=(...args)=>logs.push(args.join(' '));
    server=await startStaticServer({directory:path.resolve('web'),port:0});
  } finally { console.log=original; }
  try {
    const port=server.address().port;
    assert.ok(logs.some(line=>line.includes(`http://localhost:${port}/`)));
    assert.equal(server.address().address,'127.0.0.1');
    assert.equal(await request(port,'localhost'),200); assert.equal(await request(port,'127.0.0.1'),200);
    assert.equal((await fetch(`http://localhost:${port}/`)).status,200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status,200);
    assert.equal(await request(port,'evil.example'),403);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
