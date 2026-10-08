// 预览增强的结构性检查（无需浏览器）：只断言 enhancePreview 产出的 HTML/脚本文本，
// 与真实浏览器行为解耦；浏览器集成验证在 ci/browser-checks.mjs 之后单独进行。
import test from 'node:test';
import assert from 'node:assert/strict';
import { enhancePreview, previewCss, PREVIEW_MARKER } from '../src/preview.mjs';

const DOC = [
  '<!DOCTYPE html><html lang="zh-CN"><head>',
  '<meta charset="utf-8">',
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'">',
  '</head><body>',
  '<div class="toc"><div class="toc-title">目 录</div><ol><li><a href="#sec-1">甲</a></li><li><a href="#sec-2">乙</a></li></ol></div>',
  '<main>',
  '<h2 id="sec-1">甲</h2>',
  '<ol start="3"><li>三</li><li value="7">七</li><li>八</li></ol>',
  '<ol reversed><li>a</li><li>b</li></ol>',
  '<ol class="references"><li id="fn-1">ref</li></ol>',
  '<p><a href="#fig-1">图 1</a> 与 <a href="https://example.com/x">外链</a> 与 <a href="page.md">相对</a> 与 <a href="#">空锚</a></p>',
  '</main>',
  '<script>if(window.__md2pdfPagedReady){parent.postMessage({type:\'md2pdf-ready\'},\'*\')}parent.postMessage({type:\'md2pdf-error\',error:\'x\'},\'*\')</script>',
  '</body></html>',
].join('\n');

function injectedScript(html) {
  const m = /<script data-[^>]*>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, '未找到注入脚本');
  return m[1];
}

test('注入的运行时脚本语法有效，且幂等', () => {
  const out = enhancePreview(DOC, 'general');
  assert.doesNotThrow(() => new Function(injectedScript(out)));
  const once = enhancePreview(DOC, 'general');
  const twice = enhancePreview(once, 'general');
  assert.equal(twice, once, 'enhancePreview 应幂等');
  assert.ok(out.includes('data-' + PREVIEW_MARKER + '="1"'));
});

test('保留前端 revision 约定的字面量 ready/error 字符串', () => {
  const out = enhancePreview(DOC, 'general');
  assert.ok(out.includes("type:'md2pdf-ready'"), 'ready 字面量缺失');
  assert.ok(out.includes("type:'md2pdf-error'"), 'error 字面量缺失');
});

test('目录项被写入两位显式序号', () => {
  const out = enhancePreview(DOC, 'general');
  assert.ok(out.includes('<li data-preview-index="01">'));
  assert.ok(out.includes('<li data-preview-index="02">'));
});

test('有序列表序号规则：start / value / reversed 均在脚本中出现', () => {
  const js = injectedScript(enhancePreview(DOC, 'general'));
  assert.match(js, /hasAttribute\("reversed"\)/);
  assert.match(js, /getAttribute\("start"\)/);
  assert.match(js, /getAttribute\("value"\)/);
  assert.match(js, /data-md2pdf-n/);
  assert.match(js, /setAttribute\("data-md2pdf-n"/);
});

test('非 gb：注入 counter-free 屏幕样式与列表/目录序号规则', () => {
  const out = enhancePreview(DOC, 'general');
  assert.ok(out.includes('md2pdf-preview-screen'));
  assert.ok(out.includes('@media screen'));
  assert.ok(out.includes('.toc li[data-preview-index]::before'));
  assert.ok(out.includes('ol > li[data-md2pdf-n]::before'));
  assert.ok(out.includes('.web-page-number::before'));
  assert.ok(out.includes('background: #8f959e'));
  assert.ok(out.includes('.pagedjs_page { background: #fff'));
});

test('gb：保留屏幕样式但不注入 counter 规则', () => {
  const out = enhancePreview(DOC, 'gb');
  assert.ok(out.includes('@media screen'));
  assert.ok(out.includes('md2pdf-preview-screen'));
  assert.ok(!out.includes('ol > li[data-md2pdf-n]::before'), 'gb 不应注入列表序号规则');
  assert.ok(!out.includes('.toc li[data-preview-index]::before'), 'gb 不应注入目录序号规则');
  const js = injectedScript(out);
  assert.match(js, /if \(!IS_GB\) stampLists\(\)/, 'gb 不应执行列表标记');
});

test('内链拦截：仅拦原生 #、安全解码、无选择器插值、外链不动', () => {
  const js = injectedScript(enhancePreview(DOC, 'general'));
  assert.match(js, /getAttribute\("href"\)/, '必须读原生属性而非解析后的 href');
  assert.match(js, /href\.charAt\(0\) !== "#"/);
  assert.match(js, /event\.preventDefault\(\)/);
  assert.match(js, /decodeURIComponent\(frag\)/);
  assert.match(js, /if \(!frag\) return;/, '空 # 应无害返回');
  assert.match(js, /document\.querySelector\("\.pagedjs_pages"\)/, '优先在分页副本内查找');
  assert.match(js, /findByAttr\(scope, "id", id\)/, 'id 精确匹配');
  assert.match(js, /findByAttr\(scope, "data-id", id\)/, 'data-id 回退');
  assert.match(js, /getAttribute\(attr\)/);
  assert.doesNotMatch(js, /querySelector\([^)]*\+\s*id/, '不得把 id 拼进选择器');
  assert.match(js, /scrollIntoView/);
  assert.doesNotMatch(js, /location\.(?:hash|href|reload)\s*=/, '不得导航或刷新');
});

test('保留页码 / 字体就绪 / 自适应 / 错误与超时检测', () => {
  const js = injectedScript(enhancePreview(DOC, 'general'));
  assert.match(js, /document\.fonts\.ready\.then/);
  assert.match(js, /web-page-number/);
  assert.match(js, /pages\.forEach/);
  assert.match(js, /\.style\.zoom/);
  assert.match(js, /__md2pdfMermaidError/);
  assert.match(js, /__md2pdfPagedError/);
  assert.match(js, /30000/);
});

test('安全边界不变：不注入 base、不改 CSP、不削弱沙箱约定', () => {
  const out = enhancePreview(DOC, 'general');
  assert.ok(!/<base\b/i.test(out), '不应注入 base');
  assert.ok(out.includes("content=\"default-src 'none'; script-src 'unsafe-inline'\""), 'CSP 应原样保留');
  assert.ok(!out.includes('sandbox=') || DOC.includes('sandbox='), '不应改写 sandbox');
  assert.ok(!out.includes('unsafe-eval'), '不应放宽脚本来源');
});

test('previewCss：gb 与非 gb 规则集不同', () => {
  assert.notEqual(previewCss('gb'), previewCss('general'));
  assert.ok(previewCss('gb').includes('@media screen'));
  assert.ok(!previewCss('gb').includes('data-md2pdf-n'));
});

test('非字符串输入抛错；无 body 时追加在末尾', () => {
  assert.throws(() => enhancePreview(null), TypeError);
  const noBody = '<html><head></head><main><ol><li>a</li></ol></main></html>';
  const out = enhancePreview(noBody, 'general');
  assert.ok(out.includes('md2pdf-preview-screen'));
  assert.ok(out.trimEnd().endsWith('</script>'));
});

