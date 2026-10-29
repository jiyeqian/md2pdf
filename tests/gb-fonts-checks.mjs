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
  const document = { querySelector:()=>null, body:{append:n=>nodes.push(n)}, createElement:()=>({children:[],events:{},setAttribute(){},append(...items){this.children.push(...items)},addEventListener(k,f){this.events[k]=f},showModal(){},focus(){},close(){},remove(){}}) };
  const window = {};
  vm.runInNewContext(await readFile(new URL('../web/template-confirm.js',import.meta.url),'utf8'),{window,document});
  window.mdShowFontError(['方正小标宋_GBK']);
  assert.match(nodes[0].className,/template-confirm/);
  assert.equal(nodes[0].children[0].textContent,'未能加载字体：方正小标宋_GBK。');
  assert.equal(nodes[0].children[1].children[1].href,'./gb-fonts.html');
});
