// 图片插入模块（web/editor-images.js）的纯逻辑与契约检查（无需浏览器）。
//
// 覆盖：文件格式/容量判定、标题安全转义、唯一图引用 ID、块与段落拼装、
// base64 折叠范围识别，以及内核扩展接口与折叠实现（非 CSS 截断）的源码契约。
//
// Run: node --test ci/editor-images-checks.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await import(new URL('../web/editor-images.js', import.meta.url).href);
const H = globalThis.mdEditorImageHelpers;
const MB = 1024 * 1024;

test('纯助手已挂载', () => {
  assert.ok(H, 'globalThis.mdEditorImageHelpers 存在');
  assert.equal(typeof H.classifyFile, 'function');
  assert.equal(typeof H.planImageInsertion, 'function');
  assert.equal(typeof H.findFoldRanges, 'function');
});

test('容量常量：单图上限 10MB，2MB 为提示阈值', () => {
  assert.equal(H.MAX_IMAGE_BYTES, 10 * MB);
  assert.equal(H.LARGE_IMAGE_BYTES, 2 * MB);
});

test('data URL mime：识别具体类型，octet-stream 视为不可用', () => {
  assert.equal(typeof H.dataUrlMime, 'function');
  assert.equal(typeof H.isImageDataUrl, 'function');
  assert.equal(H.dataUrlMime('data:image/png;base64,AAAA'), 'image/png');
  assert.equal(H.dataUrlMime('data:application/octet-stream;base64,AAAA'), 'application/octet-stream');
  assert.equal(H.dataUrlMime('not-a-data-url'), '');
  assert.equal(H.isImageDataUrl('data:image/webp;base64,AAAA'), true);
  assert.equal(H.isImageDataUrl('data:application/octet-stream;base64,AAAA'), false);
});

test('resolvedMime：具体 image/* 优先，空类型回落到扩展名推断', () => {
  assert.equal(typeof H.resolvedMime, 'function');
  assert.equal(H.resolvedMime('application/octet-stream', 'image/png'), 'image/png', 'type 为空 + extPNG 补正确前缀');
  assert.equal(H.resolvedMime('image/jpeg', 'image/png'), 'image/jpeg', '读到的具体类型优先');
  assert.equal(H.resolvedMime('', 'image/webp'), 'image/webp');
  assert.equal(H.resolvedMime('', ''), '');
});

test('chooseCompressed：仅在真正变小时才认作已压缩', () => {
  assert.equal(typeof H.chooseCompressed, 'function');
  const shorter = H.chooseCompressed('data:x,' + 'A'.repeat(100), 'data:x,' + 'A'.repeat(10));
  assert.equal(shorter.compressed, true);
  assert.equal(shorter.url.length, 17);
  const same = H.chooseCompressed('data:x,AAAA', 'data:x,BBBB');
  assert.equal(same.compressed, false, '体积未减小不得谎报已压缩');
  assert.equal(same.url, 'data:x,AAAA');
  const empty = H.chooseCompressed('data:x,AAAA', '');
  assert.equal(empty.compressed, false);
  assert.equal(empty.url, 'data:x,AAAA');
});

test('GIF 标记为动图，其它格式不标记', () => {
  assert.equal(H.classifyFile({ name: 'a.gif', type: 'image/gif', size: 10 }).animated, true);
  assert.equal(H.classifyFile({ name: 'a.png', type: 'image/png', size: 10 }).animated, false);
  assert.equal(H.classifyFile({ name: 'x.bmp', type: 'image/bmp', size: 10 }).animated, false);
});

test('受支持格式通过，尺寸与类型可判定', () => {
  for (const [name, type] of [['a.png', 'image/png'], ['a.jpg', 'image/jpeg'], ['a.gif', 'image/gif'], ['a.webp', 'image/webp']]) {
    const r = H.classifyFile({ name, type, size: 1024 });
    assert.equal(r.ok, true, name + ' 应通过');
    assert.equal(r.kind, 'image');
  }
  // 仅有扩展名（剪贴板/系统可能不带 type）也要能识别。
  assert.equal(H.classifyFile({ name: 'b.JPG', type: '', size: 10 }).mime, 'image/jpeg');
});

test('PDF / SVG 被拒绝并给出清晰信息', () => {
  const pdf = H.classifyFile({ name: 'doc.pdf', type: 'application/pdf', size: 100 });
  assert.equal(pdf.ok, false);
  assert.equal(pdf.code, 'pdf');
  assert.match(pdf.message, /PDF/);
  assert.equal(H.classifyFile({ name: 'c.PDF', type: '', size: 100 }).code, 'pdf');
  const svg = H.classifyFile({ name: 'i.svg', type: 'image/svg+xml', size: 100 });
  assert.equal(svg.code, 'svg');
  assert.match(svg.message, /SVG/);
});

test('不支持的格式被拒绝', () => {
  const r = H.classifyFile({ name: 'x.bmp', type: 'image/bmp', size: 10 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'unsupported');
  assert.match(r.message, /PNG/);
});

test('超过 10MB 拒绝，恰好 10MB 通过；2MB 阈值标记 large', () => {
  assert.equal(H.classifyFile({ name: 'x.png', type: 'image/png', size: 10 * MB }).ok, true);
  const big = H.classifyFile({ name: 'x.png', type: 'image/png', size: 10 * MB + 1 });
  assert.equal(big.code, 'tooLarge');
  assert.equal(H.classifyFile({ name: 'x.png', type: 'image/png', size: 2 * MB }).large, false);
  assert.equal(H.classifyFile({ name: 'x.png', type: 'image/png', size: 2 * MB + 1 }).large, true);
});

test('标题：文件名安全转义，截图/通用名回落', () => {
  assert.equal(H.sanitizeCaption('photo.png'), 'photo');
  assert.equal(H.sanitizeCaption('/tmp/图 表.png'), '图 表');
  assert.equal(H.sanitizeCaption('C:\\Users\\x\\图表.png'), '图表');
  assert.equal(H.sanitizeCaption('a]b[c(d).png'), 'a b c d');
  assert.equal(H.sanitizeCaption('image.png'), '截图');
  assert.equal(H.sanitizeCaption('Screenshot 2024-01-01.png'), '截图');
  assert.equal(H.sanitizeCaption(''), '截图');
  assert.equal(H.sanitizeCaption('a'.repeat(100) + '.png').length, 60);
  assert.ok(!/[\[\](){}]/.test(H.sanitizeCaption('a]b[c(d)e{f}.png')), '结果不含破坏语法的字符');
});

test('唯一图引用 ID 顺序递增并跳过已用编号', () => {
  assert.equal(H.nextImageId(''), 'image-1');
  assert.equal(H.nextImageId('![x](y) {#fig:image-1}'), 'image-2');
  assert.equal(H.nextImageId('{#fig:image-1} {#fig:image-3} {#tab:t-9}'), 'image-4');
});

test('块语法与要求一致', () => {
  assert.equal(
    H.buildImageBlock({ caption: 'photo', id: 'image-2', url: 'data:image/png;base64,AAAA' }),
    '![photo {#fig:image-2}](data:image/png;base64,AAAA)',
  );
});

test('planImageInsertion：独立段落、顺序稳定、ID 不重复', () => {
  const one = H.planImageInsertion({ text: '', from: 0, to: 0, images: [{ caption: 'a', url: 'data:image/png;base64,AAAA' }] });
  assert.equal(one.insert, '![a {#fig:image-1}](data:image/png;base64,AAAA)\n');
  assert.equal(one.selection, one.insert.length);
  assert.deepEqual(one.ids, ['image-1']);

  const mid = H.planImageInsertion({ text: 'hello', from: 5, to: 5, images: [{ caption: 'b', url: 'u' }] });
  assert.equal(mid.insert, '\n\n![b {#fig:image-1}](u)\n');

  const multi = H.planImageInsertion({
    text: '{#fig:image-5}',
    from: 0, to: 0,
    images: [{ caption: '一', url: 'u1' }, { caption: '二', url: 'u2' }],
  });
  assert.deepEqual(multi.ids, ['image-6', 'image-7']);
  assert.equal(multi.count, 2);
  assert.equal(multi.insert, '![一 {#fig:image-6}](u1)\n\n![二 {#fig:image-7}](u2)\n\n');

  const none = H.planImageInsertion({ text: 'abc', from: 1, to: 2, images: [] });
  assert.equal(none.count, 0);
  assert.equal(none.insert, '');
  assert.equal(none.selection, 1);
});

test('段落间隔：已有空行不重复插入', () => {
  assert.equal(H.gapBefore('a\n\nb', 3), '');
  assert.equal(H.gapBefore('a\nb', 2), '\n');
  assert.equal(H.gapBefore('ab', 2), '\n\n');
  assert.equal(H.gapAfter('a\n\nb', 1), '');
  assert.equal(H.gapAfter('a\nb', 1), '\n');
  assert.equal(H.gapAfter('ab', 1), '\n\n');
  assert.equal(H.gapAfter('ab', 2), '\n');
});

test('findFoldRanges：识别长 base64，忽略短串与跨行串', () => {
  const prefix = 'data:image/png;base64,';
  const long = prefix + 'A'.repeat(200);
  const ranges = H.findFoldRanges('前 ' + long + ' 后');
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].to - ranges[0].from, long.length);

  assert.deepEqual(H.findFoldRanges(prefix + 'AAAA', 160), [], '短串不折叠');
  // 阈值边界
  assert.equal(H.findFoldRanges('A'.repeat(0) + prefix + 'A'.repeat(160 - prefix.length), 160).length, 1);
  assert.equal(H.findFoldRanges(prefix + 'A'.repeat(160 - prefix.length - 1), 160).length, 0);
  // 两个地址按顺序返回
  const two = H.findFoldRanges(long + ' ' + long, 160);
  assert.equal(two.length, 2);
  assert.ok(two[0].from < two[1].from);
  // 含换行的串（被换行截断）不折叠
  assert.deepEqual(H.findFoldRanges(prefix + 'A'.repeat(100) + '\n' + 'A'.repeat(100), 160), []);
});

test('foldPlaceholder 简短且标注字符数', () => {
  const label = H.foldPlaceholder({ from: 0, to: 1234 });
  assert.match(label, /1234/);
  assert.match(label, /base64/);
});

test('内核扩展契约：addExtension 与映射事务事件', async () => {
  const core = await readFile(path.join(ROOT, 'web/editor-core.js'), 'utf8');
  assert.match(core, /addExtension:/, 'core 暴露 addExtension');
  assert.match(core, /md-editor-transaction/, 'core 派发映射事务事件');
  assert.match(core, /externalCompartment/, 'core 用独立 compartment 安装扩展');
  assert.match(core, /fullExtensions/, '重置文档状态时保留外部扩展');
  assert.match(core, /changes: update\.changes/, '事件携带 ChangeSet 供 mapPos');
  assert.match(core, /setValue:/, 'setValue 仍在（未被破坏）');
  assert.match(core, /dispatchEvent\(new CustomEvent\('md-editor-reset'/, '程序化重建文档时派发 md-editor-reset');
});

test('vendor 导出折叠所需的最小编解码能力', async () => {
  const src = await readFile(path.join(ROOT, 'web/editor-vendor.js'), 'utf8');
  const sandbox = { window: {}, self: {}, console: { warn() {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'editor-vendor.js' });
  const V = sandbox.MDEditorVendor;
  for (const name of ['ViewPlugin', 'Decoration', 'WidgetType', 'StateEffect', 'EditorView']) {
    assert.equal(typeof V[name], 'function', 'vendor 导出 ' + name);
  }
  assert.equal(typeof V.Decoration.replace, 'function');
  assert.equal(typeof V.ViewPlugin.fromClass, 'function');
});

test('真实 CodeMirror 装饰：默认折叠，选区触及则展开', async () => {
  const src = await readFile(path.join(ROOT, 'web/editor-vendor.js'), 'utf8');
  const sandbox = { window: {}, self: {}, console: { warn() {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'editor-vendor.js' });
  const V = sandbox.MDEditorVendor;

  const text = '前 ' + 'data:image/png;base64,' + 'A'.repeat(200);
  const ranges = H.findFoldRanges(text, H.FOLD_THRESHOLD);
  assert.equal(ranges.length, 1);

  class W extends V.WidgetType {
    toDOM() { return null; }
    eq() { return true; }
  }
  function build(state) {
    const specs = [];
    for (const r of H.findFoldRanges(state.doc.toString(), H.FOLD_THRESHOLD)) {
      const hit = state.selection.ranges.some(s => s.from <= r.to && r.from <= s.to);
      if (hit) continue;
      specs.push(V.Decoration.replace({ widget: new W() }).range(r.from, r.to));
    }
    return V.Decoration.set(specs, true);
  }

  assert.equal(build(V.EditorState.create({ doc: text })).size, 1, '无选区时折叠');
  const inside = V.EditorState.create({ doc: text, selection: { anchor: ranges[0].from + 2 } });
  assert.equal(build(inside).size, 0, '光标/选区在范围内时展开');
});

test('图片模块源码契约：真实折叠、无 confirm、插入单事务', async () => {
  const src = await readFile(path.join(ROOT, 'web/editor-images.js'), 'utf8');
  assert.match(src, /Decoration\.replace/, '用 Decoration.replace 折叠（非 CSS 截断）');
  assert.match(src, /ViewPlugin\.fromClass/, '折叠由 ViewPlugin 提供');
  assert.match(src, /showModal/, '使用原生 <dialog>');
  assert.ok(!/window\.confirm|\bconfirm\(/.test(src), '不使用阻塞式 confirm');
  assert.ok(!/\.innerHTML\s*=/.test(src), '无 innerHTML 赋值');
  assert.ok(!/\beval\s*\(/.test(src), '无 eval');
  assert.ok(!/\.setValue\(/.test(src), '绝不调用 setValue（保护撤销历史）');
  assert.match(src, /api\.replaceRange\(from, to, plan\.insert\)/, '整次插入为单个事务');
  assert.match(src, /md-editor-transaction/, '异步读取期间用事务映射保持光标');
  assert.match(src, /readAsDataURL/, '通过 FileReader 本地编码');
  assert.match(src, /image\/webp/, '接受 WebP');
  assert.match(src, /clipboardData/, '处理截图粘贴');
  assert.match(src, /dataTransfer/, '处理文件拖放');
  assert.match(src, /插入图片/, '工具栏按钮文案');
});

test('集成缺陷：按钮/状态挂到可见工作区工具条，等 DOM 且只挂一次', async () => {
  const src = await readFile(path.join(ROOT, 'web/editor-images.js'), 'utf8');
  assert.match(src, /'\.md-wt-toolbar'/, '使用可见的 .md-wt-toolbar');
  assert.ok(!/querySelector\('\.md-editor-toolbar'\)/.test(src), '不再挂到隐藏的 .md-editor-toolbar');
  assert.match(src, /MutationObserver/, '工具条未生成时用 MutationObserver 等待');
  assert.match(src, /observer\.disconnect\(\)/, '找到后断开 observer');
  assert.match(src, /let toolbarMounted = false/, '存在只挂一次的守卫');
  assert.match(src, /if \(toolbarMounted\) return true/, '重复调用不再重复挂载');
});

test('集成缺陷：picker.files 为 liveFileList，先快照再清空 value', async () => {
  const src = await readFile(path.join(ROOT, 'web/editor-images.js'), 'utf8');
  assert.match(src, /Array\.from\(picker\.files\)/, '先 Array.from 快照 FileList');
  const order = src.indexOf('Array.from(picker.files)') < src.indexOf("picker.value = ''");
  assert.ok(order, '快照发生在清空 value 之前');
});

test('集成缺陷：拖放用 posAtCoords 落点，domEventHandlers 第二参数为 view', async () => {
  const src = await readFile(path.join(ROOT, 'web/editor-images.js'), 'utf8');
  assert.match(src, /posAtCoords\(\{ x: x, y: y \}\)/, '拖放用 view.posAtCoords 计算落点');
  assert.match(src, /drop: function \(event, view\)/, 'drop 处理器接收 view 参数');
  assert.match(src, /function startInsertion\(files, range\)/, 'startInsertion 支持显式范围');
  assert.match(src, /const explicit = range && Number\.isFinite\(range\.from\)/, '显式范围优先于旧选区');
});

test('集成缺陷：异步期间文档被重建则取消插入并提示重试', async () => {
  const src = await readFile(path.join(ROOT, 'web/editor-images.js'), 'utf8');
  assert.match(src, /addEventListener\('md-editor-reset', onReset\)/, '监听文档重建');
  assert.match(src, /removeEventListener\('md-editor-reset', onReset\)/, 'finally 里清理 listener');
  assert.match(src, /文档已切换，图片未插入，请重试/, '取消时提示重试');
});

test('集成缺陷：压缩失败/无缩小不谎报已压缩，保留原图', async () => {
  const src = await readFile(path.join(ROOT, 'web/editor-images.js'), 'utf8');
  assert.match(src, /H\.chooseCompressed\(original, candidate\)/, '用 chooseCompressed 决策是否真的变小');
  assert.match(src, /压缩未减小体积，已保留原图/, '未缩小时明确保留原图');
  assert.ok(!/compressed\+\+;\s*\}/.test(src) || src.includes('if (result.compressed)'), '仅在真正压缩时才计数');
});

test('集成缺陷：空 type 的图片补正确 mime 前缀（Blob 规范），解码失败拒绝', async () => {
  const src = await readFile(path.join(ROOT, 'web/editor-images.js'), 'utf8');
  assert.match(src, /readAsImageDataUrl/, '读取时规范化 data URL 前缀');
  assert.match(src, /new Blob\(\[bytes\], \{ type: mime \}\)/, '用 Blob 规范 mime');
  assert.match(src, /H\.resolvedMime\(/, '回落到扩展名推断的 mime');
  assert.match(src, /async function canDecode/, '插入前校验可解码');
  assert.match(src, /无法解码（文件可能已损坏），未插入/, '损坏文件被拒绝并提示');
});

test('集成缺陷：GIF 默认保留动图，压缩提示变静态', async () => {
  const src = await readFile(path.join(ROOT, 'web/editor-images.js'), 'utf8');
  assert.match(src, /GIF 默认保留动图；选择压缩后动图会变为静态图/, '对话框提示动图行为');
  assert.match(src, /压缩后动图已变为静态图/, '压缩 GIF 后如实提示');
  assert.match(src, /animated/, '按 animated 分类构造提示');
});

test('拖放使用鼠标坐标映射的文档位置，失败时安全回落', () => {
  let coords;
  const result = H.dropRange({clientX: 120, clientY: 340}, {posAtCoords: point => {coords = point; return 17;}});
  assert.deepEqual(coords, {x: 120, y: 340});
  assert.deepEqual(result, {from: 17, to: 17});
  assert.equal(H.dropRange({clientX: NaN, clientY: 340}, {posAtCoords: () => {throw new Error('不应调用');}}), null);
  assert.equal(H.dropRange({clientX: 120, clientY: 340}, {posAtCoords: () => null}), null);
  assert.equal(H.dropRange({clientX: 120, clientY: 340}, {posAtCoords: () => {throw new Error('坐标不可用');}}), null);
  assert.equal(H.dropRange({clientX: 120, clientY: 340}, {posAtCoords: () => NaN}), null);
});
