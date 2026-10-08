// 在线预览（srcdoc iframe 内的分页文档）专用增强。
//
// enhancePreview(html, type) 接收「已内联可信资源（Paged.js/MathJax/Mermaid 均内联为
// data: URL）、已注入 CSP、已完成错误捕获改写」的完整预览文档，返回增强后的文档。
// 它只作用于 /api/render 的预览路径；PDF 路径（webDocument(rendered.html)）不经过这里。
//
// 为什么必须这样做：
//   * Paged.js 在分页时会重新解析样式表并重写选择器/计数器，构建期写进 <style> 的
//     @media screen 与 counter-increment/counter-reset 会被丢掉 —— 于是页面在预览里
//     失去灰底白纸，且目录/有序列表序号全部退化成 0。因此：
//       - 屏幕观感样式改为「分页完成后」由运行时注入（Paged 不会再处理它）；
//       - 序号改成显式 DOM 属性（分页前写入，克隆到每页后仍在），再用 counter-free
//         的 ::before 规则贴出来。
//   * srcdoc 文档里的 #fragment 会按父页面 URL 解析，点击等于把工作台重新塞进 iframe。
//     因此必须在文档内部拦下「原生 #... 内链」，滚动到「已分页的可见副本」而不是原始
//     副本；外链 / 相对链接原样放行。
//
// 安全边界不变：不加 <base>、不去掉 sandbox（sandbox 在 web/index.html 的 iframe 上）、
// 不削弱 CSP。DOM 查找不做选择器字符串插值。

export const PREVIEW_MARKER = 'md2pdf-preview-enhance';

/* 分页完成之后才注入的屏幕观感样式：灰底画布 + 白色纸张 + 页间距 + 投影。 */
export const PREVIEW_SCREEN_CSS = [
  '@media screen {',
  '  html, body { background: #8f959e !important; }',
  '  body { margin: 0 !important; padding: 24px 0 40px !important; }',
  '  .pagedjs_pages { display: flex !important; flex-direction: column !important;',
  '    align-items: center !important; gap: 24px !important; transform-origin: top center !important; }',
  '  .pagedjs_page { background: #fff !important; margin: 0 auto !important;',
  '    box-shadow: 0 1px 2px rgba(0,0,0,.30), 0 12px 32px rgba(0,0,0,.22) !important; }',
  '  .md2pdf-preview-target { outline: 3px solid #2f6fd0 !important; outline-offset: 3px !important; }',
  '}',
].join('\n');

/* counter-free 序号样式，贴在被显式标记过的目录项与有序列表项上。
   GB 主题本来就用 target-counter + 隐藏列表标记，不参与。 */
export const PREVIEW_COUNTER_CSS = [
  '.toc li[data-preview-index]::before { content: attr(data-preview-index) !important; counter-increment: none !important; }',
  'ol > li[data-md2pdf-n]::before { content: attr(data-md2pdf-n) !important; counter-increment: none !important; }',
  '.web-page-number::before, .web-page-number::after { content: none !important; }',
].join('\n');

export function previewCss(type) {
  return type === 'gb' ? PREVIEW_SCREEN_CSS : PREVIEW_SCREEN_CSS + '\n' + PREVIEW_COUNTER_CSS;
}

// 目录序号在服务端写死到 DOM 属性上（确定性、且必然早于分页克隆）。
const TOC_MARK = /(<div class="toc">[\s\S]*?<ol>)([\s\S]*?)(<\/ol>)/;

function stampToc(html) {
  return html.replace(TOC_MARK, (_, start, entries, end) => {
    let index = 0;
    return start + entries.replace(/<li>/g, () => '<li data-preview-index="' + String(++index).padStart(2, '0') + '">') + end;
  });
}

// 运行时脚本：分页前同步写序号属性；分页后注入屏幕样式、页码、自适应缩放并回传状态。
function runtimeScript(type) {
  const isGb = type === 'gb';
  const css = JSON.stringify(previewCss(type));
  const lines = [
    '<script data-' + PREVIEW_MARKER + '="1">',
    '(function () {',
    "  var IS_GB = " + JSON.stringify(isGb) + ';',
    '  var PREVIEW_CSS = ' + css + ';',
    '  var stamped = false;',
    '',
    '  // 分页前：把有序列表的序号写成显式属性，尊重 start / value / reversed。',
    '  // 只处理 <main> 内的 ol，跳过 .references / .footnotes（参考文献与脚注另成体系）。',
    '  function stampLists() {',
    '    if (stamped) return; stamped = true;',
    "    var ols = document.querySelectorAll('main ol'), i, ol;",
    '    for (i = 0; i < ols.length; i++) {',
    '      ol = ols[i];',
    '      if (ol.closest(".references, .footnotes, .toc")) continue;',
    '      var lis = [], kids = ol.children, k;',
    '      for (k = 0; k < kids.length; k++) if (kids[k].tagName === "LI") lis.push(kids[k]);',
    '      var rev = ol.hasAttribute("reversed");',
    '      var start = parseInt(ol.getAttribute("start"), 10);',
    '      var n = rev ? (isNaN(start) ? lis.length : start) : (isNaN(start) ? 1 : start);',
    '      for (k = 0; k < lis.length; k++) {',
    '        var v = parseInt(lis[k].getAttribute("value"), 10);',
    '        if (!isNaN(v)) n = v;',
    '        lis[k].setAttribute("data-md2pdf-n", String(n));',
    '        n += rev ? -1 : 1;',
    '      }',
    '    }',
    '  }',
    '',
    '  // 按属性逐节点比较，避免把未净化的 fragment 插进选择器字符串。',
    '  function findByAttr(root, attr, value) {',
    '    var nodes = root.getElementsByTagName("*"), i;',
    '    for (i = 0; i < nodes.length; i++) {',
    '      var got = attr === "id" ? nodes[i].id : nodes[i].getAttribute(attr);',
    '      if (got === value) return nodes[i];',
    '    }',
    '    return null;',
    '  }',
    '',
    '  // 优先取「已分页的可见副本」：.pagedjs_pages 内的 id，其次 data-id，最后才回退整篇文档。',
    '  function findTarget(id) {',
    '    var scope = document.querySelector(".pagedjs_pages");',
    '    if (scope) {',
    '      var hit = findByAttr(scope, "id", id) || findByAttr(scope, "data-id", id);',
    '      if (hit) return hit;',
    '    }',
    '    var direct = document.getElementById(id);',
    '    if (direct) return direct;',
    '    return findByAttr(document, "data-id", id);',
    '  }',
    '',
    '  var highlightTimer, highlightedElement;',
    '  function highlight(el) {',
    '    if (highlightedElement) highlightedElement.classList.remove("md2pdf-preview-target");',
    '    highlightedElement = el;',
    '    el.classList.add("md2pdf-preview-target");',
    '    clearTimeout(highlightTimer);',
    '    highlightTimer = setTimeout(function () { el.classList.remove("md2pdf-preview-target"); }, 1200);',
    '  }',
    '',
    '  // 只拦「原生 #... 内链」。外链 / 相对链接 / 已是完整 URL 的一律不改。',
    '  function onClick(event) {',
    '    var node = event.target, anchor = null;',
    '    while (node && node.nodeType === 1) {',
    '      if ((node.tagName || "").toUpperCase() === "A") { anchor = node; break; }',
    '      node = node.parentNode;',
    '    }',
    '    if (!anchor) return;',
    '    var href = anchor.getAttribute("href");',
    '    if (!href || href.charAt(0) !== "#") return;',
    '    event.preventDefault();',
    '    var frag = href.slice(1);',
    '    if (!frag) return;',
    '    var id = frag;',
    '    try { id = decodeURIComponent(frag); } catch (e) { id = frag; }',
    '    var target = findTarget(id);',
    '    if (!target) return;',
    '    try { target.scrollIntoView({ behavior: "smooth", block: "start" }); }',
    '    catch (e) { target.scrollIntoView(); }',
    '    highlight(target);',
    '  }',
    '',
    '  function injectStyles() {',
    '    if (document.getElementById("md2pdf-preview-screen")) return;',
    '    var style = document.createElement("style");',
    '    style.id = "md2pdf-preview-screen";',
    '    style.textContent = PREVIEW_CSS;',
    '    (document.head || document.documentElement).appendChild(style);',
    '  }',
    '  document.addEventListener("click", function (event) {',
    '    var heading = event.target.closest && event.target.closest(".pagedjs_pages [data-md2pdf-source-line]");',
    '    if (heading && !event.target.closest("a")) {',
    "      parent.postMessage({type:'md2pdf-source',line:Number(heading.getAttribute('data-md2pdf-source-line'))}, '*');",
    '    }',
    '  });',
    '  addEventListener("message", function (event) {',
    '    if (event.source !== parent || !event.data || event.data.type !== "md2pdf-locate" || !Number.isSafeInteger(event.data.line) || event.data.line < 1) return;',
    '    var headings = document.querySelectorAll(".pagedjs_pages [data-md2pdf-source-line]"), best = null;',
    '    for (var i = 0; i < headings.length; i++) {',
    '      var line = Number(headings[i].getAttribute("data-md2pdf-source-line"));',
    '      if (line <= event.data.line && (!best || line > Number(best.getAttribute("data-md2pdf-source-line")))) best = headings[i];',
    '    }',
    '    if (!best) best = headings[0];',
    '    if (best) { best.scrollIntoView({behavior:"smooth",block:"start"}); highlight(best); }',
    '  });',
    '',
    '  function fit() {',
    '    var page = document.querySelector(".pagedjs_page");',
    '    var pages = document.querySelector(".pagedjs_pages");',
    '    if (page && pages) pages.style.zoom = Math.min(1, (document.documentElement.clientWidth - 24) / page.offsetWidth);',
    '  }',
    '',
    '  var started = Date.now();',
    '  function check() {',
    '    var failed = window.__md2pdfMermaidError || window.__md2pdfPagedError;',
    '    if (failed) { parent.postMessage({type:\'md2pdf-error\',error:\'公式、图表或分页失败\'}, \'*\'); return; }',
    '    if (window.__md2pdfMathReady !== false && window.__md2pdfMermaidReady !== false && window.__md2pdfPagedReady !== false) {',
    '      document.fonts.ready.then(function () {',
    '        injectStyles();',
    '        if (!IS_GB) {',
    '          var pages = document.querySelectorAll(".pagedjs_page");',
    '          pages.forEach(function (page, index) {',
    '            var footer = page.querySelector(".pagedjs_margin-bottom-center .pagedjs_margin-content");',
    '            if (footer) { footer.classList.add("web-page-number"); footer.textContent = (index + 1) + " / " + pages.length; footer.style.fontSize = "8pt"; footer.style.color = "#8a8578"; }',
    '          });',
    '        }',
    '        fit();',
    '        addEventListener("resize", fit);',
    '        parent.postMessage({type:\'md2pdf-ready\'}, \'*\');',
    '      });',
    '      return;',
    '    }',
    '    if (Date.now() - started > 30000) { parent.postMessage({type:\'md2pdf-error\',error:\'排版超时，请缩短文档或检查公式与图表\'}, \'*\'); return; }',
    '    setTimeout(check, 100);',
    '  }',
    '',
    '  if (!IS_GB) stampLists();',
    '  document.addEventListener("click", onClick, true);',
    '  addEventListener("load", check);',
    '})();',
    '</script>',
  ];
  return lines.join('\n');
}

export function enhancePreview(html, type = 'general') {
  if (typeof html !== 'string') throw new TypeError('enhancePreview 需要 HTML 字符串');
  if (html.includes('data-' + PREVIEW_MARKER + '="1"')) return html; // 幂等：已增强过就不再注入
  const enhanced = stampToc(html);
  return enhanced.includes('</body>') ? enhanced.replace('</body>', runtimeScript(type) + '\n</body>') : enhanced + runtimeScript(type);
}
