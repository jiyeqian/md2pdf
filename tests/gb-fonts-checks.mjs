import test from 'node:test';
import assert from 'node:assert/strict';
import { GB_FONT_CHECKS, requireGbFonts, gbFontDiagnostic } from '../src/gb-fonts.mjs';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('font failures report all missing families once before pagination', async () => {
  const window = {};
  const document = { fonts: { ready: Promise.resolve(), load: async font => {
    if (font.includes('Cover')) throw new Error('/private/font-file');
    return [{}];
  } } };
  const check = vm.runInNewContext('(' + requireGbFonts.toString() + ')', { window, document });
  await assert.rejects(check(GB_FONT_CHECKS), /方正小标宋_GBK/);
  assert.deepEqual(Array.from(window.__md2pdfFontError.fonts), ['方正小标宋_GBK']);
  assert.deepEqual(gbFontDiagnostic(window.__md2pdfFontError), { code:'GB_FONT_MISSING', fonts:['方正小标宋_GBK'] });
  assert.equal(gbFontDiagnostic(new Error('/private/font-file')), null);
  assert.ok(!JSON.stringify(gbFontDiagnostic({code:'GB_FONT_MISSING',fonts:['/private/font-file']})).includes('/private/'));
});

test('font popup uses application styling and published help link', async () => {
  const nodes = [];
  const document = { querySelector:()=>null, body:{append:n=>nodes.push(n)}, createElement:()=>({children:[],events:{},setAttribute(){},append(...items){this.children.push(...items)},addEventListener(k,f){this.events[k]=f},showModal(){},focus(){this.focused=true;},close(){},remove(){}}) };
  const window = {};
  vm.runInNewContext(await readFile(new URL('../web/template-confirm.js',import.meta.url),'utf8'),{window,document});
  window.mdShowFontError(['方正小标宋_GBK']);
  assert.match(nodes[0].className,/template-confirm/);
  assert.equal(nodes[0].children[0].textContent,'未能加载字体：方正小标宋_GBK。当前为替代字体，输出 PDF 的分页和版式可能不同。');
  assert.equal(nodes[0].children[1].children[1].href,'./gb-fonts.html');
  assert.equal(nodes[0].children[2].children[0].className,'template-confirm-cancel');
  assert.equal(nodes[0].children[2].children[1].className,'primary');
  assert.equal(nodes[0].children[2].children[1].type,'button');
  assert.equal(nodes[0].children[2].children[1].textContent,'下载');
  assert.equal(nodes[0].children[2].children[1].focused,true);
});

test('only enhanced preview enables fallback; PDF keeps strict font validation', async () => {
  const {render} = await import('../src/render.mjs');
  const {enhancePreview} = await import('../src/preview.mjs');
  const rendered = await render('# 字体预览', {type:'gb',pagedHtml:true});
  const raw = rendered.pagedHtml || rendered.html;
  assert.ok(!raw.includes('window.__md2pdfAllowFontFallback=true'));
  const preview = enhancePreview(raw,'gb');
  assert.ok(preview.includes('<head><script>window.__md2pdfAllowFontFallback=true;</script>'));
  assert.ok(preview.includes('fonts:window.__md2pdfFontError'));
  assert.ok(preview.includes('替代字体预览'));
  assert.ok(!preview.includes('document.body.style.visibility = "hidden"'));
  assert.equal(rendered.printOptions.requireGbFonts,true);
  const app = await readFile(new URL('../web/app.js',import.meta.url),'utf8');
  assert.match(app,/link.href = '\.\/gb-fonts.html'/);
  assert.match(app,/statusEl.replaceChildren\(link\)/);
});

test('missing fonts run pagination only in preview fallback mode', async () => {
  const {render} = await import('../src/render.mjs');
  const {pagedHtml} = await render('# 字体测试',{type:'gb',pagedHtml:true});
  const start = pagedHtml.match(/function start\(\) \{ window\.__md2pdfFontCheck[^\n]+/)[0];
  for (const fallback of [true,false]) {
    let runs=0;
    const window={__md2pdfAllowFontFallback:fallback,__md2pdfFontError:{fonts:['方正书宋_GBK']},__md2pdfFontCheck:Promise.reject(new Error('missing'))};
    vm.runInNewContext(start+'; start();',{window,document:{fonts:{ready:Promise.resolve()}},requireGbFonts:async()=>{throw new Error('missing');},run:()=>{runs++;}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(runs,fallback?1:0);
    assert.equal(Boolean(window.__md2pdfPagedError),!fallback);
  }
});

test('export retries with fallback only after consent, cancellation never retries', async () => {
  for (const consent of [true,false]) for (const code of ['GB_FONT_MISSING','FONT_MISSING']) {
    const window = {};
    vm.runInNewContext(await readFile(new URL('../web/template-confirm.js',import.meta.url),'utf8'),{window,document:{}});
    window.mdShowFontError=async()=>consent;
    const attempts=[];
    const result=window.mdExportWithFontConsent(async allow=>{
      attempts.push(allow);
      if(!allow) throw Object.assign(new Error('missing'),{code,fonts:['方正书宋_GBK']});
      return 'pdf';
    });
    if(consent) assert.equal(await result,'pdf');
    else await assert.rejects(result,/已取消/);
    assert.deepEqual(attempts,consent?[false,true]:[false]);
  }
});
