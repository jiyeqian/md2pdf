// md2pdf web editor — image insertion (screenshot paste / file drop / picker).
//
// Owned module. Loads after editor-core.js and installs CodeMirror extensions
// through the core's minimal interface; it never touches the core internals:
//   * window.mdEditor.addExtension(ext)  — install a CM extension at runtime
//   * document 'md-editor-transaction'   — { changes } mapped ChangeSet per edit,
//     used to keep a pending insertion anchor correct while files are read.
//
// Behaviour:
//   * Paste / drop / toolbar button accept PNG/JPEG/GIF/WebP only (<= 10 MB each;
//     PDF/SVG rejected with a clear message). Files are encoded locally to full
//     data URLs via FileReader — this module uploads nothing.
//   * Inserted as an independent paragraph ![说明 {#fig:image-N}](data:...); the
//     image-N id is unique across the whole document. One transaction => one undo.
//   * Images larger than 2 MB open an accessible <dialog>: keep original (default),
//     compress, or cancel. Never silently compressed.
//   * Plain-text paste keeps its default behaviour (files.length === 0 => false).
//   * Long base64 data URLs are folded to a short expandable placeholder purely as
//     a view decoration — the underlying text (textarea / copy / export) is never
//     modified. A selection that touches a folded range reveals the raw text.
//
// The file is a classic script (IIFE, no import/export) and also a valid ES
// module so the pure helpers can be unit-tested under Node.

(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Pure helpers (exposed for tests; no DOM access).
  // ---------------------------------------------------------------------------

  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;   // hard per-image limit
  const LARGE_IMAGE_BYTES = 2 * 1024 * 1024;  // prompt threshold (never auto-compress)
  const FOLD_THRESHOLD = 160;                 // min data-URL length worth folding
  const SUPPORTED_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const EXT_MIME = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', svg: 'image/svg+xml',
  };

  function clampInt(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(Math.max(Math.trunc(n), min), max);
  }

  function fileExt(name) {
    const m = /\.([A-Za-z0-9]+)$/.exec(String(name == null ? '' : name));
    return m ? m[1].toLowerCase() : '';
  }

  // Validate one File-like object. kind is a coarse class used for messaging.
  function classifyFile(file) {
    const name = file && file.name ? String(file.name) : '';
    let type = file && file.type ? String(file.type).toLowerCase() : '';
    const size = file && Number.isFinite(file.size) ? file.size : 0;
    const ext = fileExt(name);
    if (!type && ext && EXT_MIME[ext]) type = EXT_MIME[ext];
    const out = { ok: false, code: '', message: '', kind: '', mime: type, size: size, large: size > LARGE_IMAGE_BYTES, animated: false };
    if (type === 'application/pdf' || ext === 'pdf') {
      out.code = 'pdf'; out.kind = 'pdf';
      out.message = 'PDF 文件无法作为图片插入，请先转换为 PNG / JPEG 图片再试。';
      return out;
    }
    if (type === 'image/svg+xml' || ext === 'svg') {
      out.code = 'svg'; out.kind = 'svg';
      out.message = 'SVG 为矢量格式，暂不支持本地编码，请改用 PNG / JPEG / GIF / WebP。';
      return out;
    }
    if (SUPPORTED_MIME.indexOf(type) === -1) {
      out.code = 'unsupported'; out.kind = 'unsupported';
      out.message = '不支持的格式：' + (type || (ext ? '.' + ext : '未知')) + '（仅支持 PNG / JPEG / GIF / WebP）。';
      return out;
    }
    if (size > MAX_IMAGE_BYTES) {
      out.code = 'tooLarge'; out.kind = 'image';
      out.message = '图片超过 ' + Math.round(MAX_IMAGE_BYTES / 1024 / 1024) + 'MB 上限，未插入。';
      return out;
    }
    out.ok = true;
    out.kind = 'image';
    out.animated = type === 'image/gif';
    return out;
  }

  const GENERIC_NAME = /^(image|img|screenshot|screen[-_ ]?shot|pasted|clipboard|blob|untitled|clipboardimage|截图|屏幕快照|未命名)/i;

  // Caption for the alt text: basename without extension, safely escaped so it
  // cannot break the ![alt {#fig:id}](...) syntax. Screenshots/generic names => 截图.
  function sanitizeCaption(name) {
    let base = String(name == null ? '' : name);
    base = base.split(/[\\/]/).pop() || '';
    base = base.replace(/\.[A-Za-z0-9]+$/, '');
    base = base.replace(/[\u0000-\u001f\u007f]/g, ' ');
    base = base.replace(/[\[\](){}<>\x60*|#~^\\!]/g, ' ');
    base = base.replace(/\s+/g, ' ').trim();
    if (!base || GENERIC_NAME.test(base) || /^[\d\s]+$/.test(base)) return '截图';
    return base.slice(0, 60).trim() || '截图';
  }

  // Next free {#fig:image-N} id, scanning the whole document for uniqueness.
  function nextImageId(text) {
    const src = typeof text === 'string' ? text : '';
    const re = /\{#fig:image-(\d+)\}/g;
    let max = 0, m;
    while ((m = re.exec(src)) !== null) { const n = Number(m[1]); if (n > max) max = n; }
    return 'image-' + (max + 1);
  }

  function buildImageBlock(image) {
    const caption = sanitizeCaption(image && image.caption);
    const id = image && image.id ? String(image.id) : 'image-1';
    const url = image && image.url != null ? String(image.url) : '';
    return '![' + caption + ' {#fig:' + id + '}](' + url + ')';
  }

  // Paragraph separators so the block always lands as its own paragraph.
  function gapBefore(text, pos) {
    if (pos <= 0) return '';
    if (text.charAt(pos - 1) === '\n') return (pos >= 2 && text.charAt(pos - 2) === '\n') ? '' : '\n';
    return '\n\n';
  }
  function gapAfter(text, pos) {
    if (pos >= text.length) return '\n';
    if (text.charAt(pos) === '\n') return (text.charAt(pos + 1) === '\n') ? '' : '\n';
    return '\n\n';
  }

  // Plan a whole insertion (pure): assigns unique ids, builds blocks in order,
  // and returns the exact string plus the cursor offset after insertion.
  function planImageInsertion(options) {
    const opts = options || {};
    const text = typeof opts.text === 'string' ? opts.text : '';
    const from = clampInt(opts.from, 0, text.length);
    const to = clampInt(opts.to === undefined || opts.to === null ? from : opts.to, from, text.length);
    const images = Array.isArray(opts.images) ? opts.images.filter(Boolean) : [];
    if (!images.length) return { insert: '', selection: from, ids: [], count: 0 };
    const re = /\{#fig:image-(\d+)\}/g;
    let max = 0, m;
    while ((m = re.exec(text)) !== null) { const n = Number(m[1]); if (n > max) max = n; }
    const ids = [];
    const blocks = [];
    for (const image of images) {
      const id = 'image-' + (++max);
      ids.push(id);
      blocks.push(buildImageBlock({ caption: image.caption, id: id, url: image.url }));
    }
    const insert = gapBefore(text, from) + blocks.join('\n\n') + gapAfter(text, to);
    return { insert: insert, selection: from + insert.length, ids: ids, count: images.length };
  }

  const DATA_URL_RE = /data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;

  // Foldable ranges: full data URLs at least minLength chars long, on one line.
  function findFoldRanges(text, minLength) {
    const src = typeof text === 'string' ? text : '';
    const min = Number.isFinite(minLength) ? minLength : FOLD_THRESHOLD;
    const out = [];
    DATA_URL_RE.lastIndex = 0;
    let m;
    while ((m = DATA_URL_RE.exec(src)) !== null) {
      const from = m.index;
      const to = from + m[0].length;
      if (m[0].length < min) continue;
      const nl = src.indexOf('\n', from);
      if (nl !== -1 && nl < to) continue;
      out.push({ from: from, to: to });
    }
    return out;
  }

  function foldPlaceholder(range) {
    return '图片数据 base64 · ' + (range.to - range.from) + ' 字符';
  }

  // Mime carried by a data URL ('application/octet-stream' when the File had no
  // type). Lower-cased; '' when the string is not a data URL.
  function dataUrlMime(url) {
    const m = /^data:([^;,]*)/i.exec(String(url == null ? '' : url));
    return m ? String(m[1]).toLowerCase() : '';
  }

  // A data URL usable as an image source must carry a concrete image/* mime.
  function isImageDataUrl(url) {
    return /^image\//.test(dataUrlMime(url));
  }

  // Resolve the mime to stamp on the data URL: trust a concrete image/* mime the
  // reader produced; otherwise fall back to the mime inferred from the extension
  // (FileReader yields application/octet-stream for type-less screenshots).
  function resolvedMime(rawMime, declaredMime) {
    const raw = String(rawMime == null ? '' : rawMime).toLowerCase();
    if (raw && raw.indexOf('image/') === 0) return raw;
    const declared = String(declaredMime == null ? '' : declaredMime).toLowerCase();
    return declared || raw || '';
  }

  // Compression is a win only when the re-encoded data URL is strictly smaller;
  // otherwise keep the original (never claim a compression that did not shrink).
  function chooseCompressed(originalUrl, candidateUrl) {
    const original = String(originalUrl == null ? '' : originalUrl);
    const candidate = String(candidateUrl == null ? '' : candidateUrl);
    if (candidate && candidate.length < original.length) return { url: candidate, compressed: true };
    return { url: original, compressed: false };
  }

  global.mdEditorImageHelpers = {
    MAX_IMAGE_BYTES: MAX_IMAGE_BYTES,
    LARGE_IMAGE_BYTES: LARGE_IMAGE_BYTES,
    FOLD_THRESHOLD: FOLD_THRESHOLD,
    SUPPORTED_MIME: SUPPORTED_MIME,
    classifyFile: classifyFile,
    sanitizeCaption: sanitizeCaption,
    nextImageId: nextImageId,
    buildImageBlock: buildImageBlock,
    planImageInsertion: planImageInsertion,
    findFoldRanges: findFoldRanges,
    foldPlaceholder: foldPlaceholder,
    gapBefore: gapBefore,
    gapAfter: gapAfter,
    dataUrlMime: dataUrlMime,
    isImageDataUrl: isImageDataUrl,
    resolvedMime: resolvedMime,
    chooseCompressed: chooseCompressed,
    dropRange: dropRange,
  };

  // ---------------------------------------------------------------------------
  // Browser-only initialization.
  // ---------------------------------------------------------------------------

  if (!global.document || typeof global.document.querySelector !== 'function') return;

  const H = global.mdEditorImageHelpers;
  let doc = null;
  let picker = null;
  let statusEl = null;
  let toolbarMounted = false;

  function fileName(file) { return file && file.name ? String(file.name) : '图片'; }
  function formatSize(bytes) {
    const mb = bytes / 1024 / 1024;
    return mb >= 1 ? mb.toFixed(1) + 'MB' : Math.max(1, Math.round(bytes / 1024)) + 'KB';
  }

  function setStatus(message, error) {
    const text = message ? String(message) : '';
    if (statusEl) { statusEl.textContent = text; statusEl.dataset.error = String(!!error); }
    if (error && global.console && global.console.warn) global.console.warn('[md2pdf] 图片插入：' + text);
  }

  function collectFiles(data) {
    const files = [];
    const seen = new Set();
    function push(file) {
      if (!file) return;
      const key = (file.name || '') + '|' + file.size + '|' + (file.lastModified || 0) + '|' + (file.type || '');
      if (seen.has(key)) return;
      seen.add(key);
      files.push(file);
    }
    if (data.files && data.files.length) for (const file of data.files) push(file);
    if (data.items && data.items.length) {
      for (const item of data.items) {
        if (item && item.kind === 'file' && typeof item.getAsFile === 'function') push(item.getAsFile());
      }
    }
    return files;
  }

  function readAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(reader.error || new Error('读取文件失败')); };
      reader.readAsDataURL(file);
    });
  }

  // Read a File into a data URL whose mime is guaranteed to be image/*.
  // FileReader uses File.type, which is '' for many screenshots/downloads, so it
  // emits a bare 'data:application/octet-stream' prefix that no renderer accepts.
  // When that happens we re-wrap the bytes in a Blob carrying the inferred mime.
  async function readAsImageDataUrl(file, declaredMime) {
    const raw = await readAsDataURL(file);
    if (H.isImageDataUrl(raw)) return raw;
    const mime = H.resolvedMime(H.dataUrlMime(raw), declaredMime);
    if (!mime || mime.indexOf('image/') !== 0) return raw;
    try {
      const bytes = await file.arrayBuffer();
      const blob = new Blob([bytes], { type: mime });
      return await readAsDataURL(blob);
    } catch (error) {
      return raw;
    }
  }

  // Verify the bytes are a decodable image before inserting; a truncated or
  // renamed file must be rejected instead of pasted as a broken data URL.
  async function canDecode(file) {
    try {
      if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(file);
        if (bitmap && typeof bitmap.close === 'function') bitmap.close();
        return true;
      }
      if (typeof Image === 'function') {
        const url = await readAsDataURL(file);
        return await new Promise(function (resolve) {
          const image = new Image();
          image.onload = function () { resolve(true); };
          image.onerror = function () { resolve(false); };
          image.src = url;
        });
      }
      return true; // cannot verify in this environment: do not block the insert
    } catch (error) {
      return false;
    }
  }

  // Only used when the user explicitly chooses 压缩 in the large-image dialog.
  // Returns { url, compressed }: compressed is false on failure or when the
  // re-encoded image did not actually shrink, and the original is kept.
  async function compressImage(file, declaredMime) {
    const opts = {};
    const maxEdge = opts.maxEdge || 1600;
    const quality = Number(opts.quality) || 0.85;
    const original = await readAsImageDataUrl(file, declaredMime);
    try {
      if (typeof createImageBitmap !== 'function') return { url: original, compressed: false };
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = doc.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, width, height);
      if (typeof bitmap.close === 'function') bitmap.close();
      const mime = resolvedCompressMime(declaredMime);
      const candidate = canvas.toDataURL(mime, mime === 'image/jpeg' ? quality : undefined);
      return H.chooseCompressed(original, candidate);
    } catch (error) {
      return { url: original, compressed: false }; // never lose the image on a compression error
    }
  }

  // PNG/GIF keep a PNG target (preserve alpha); everything else re-encodes to JPEG.
  function resolvedCompressMime(declaredMime) {
    const mime = String(declaredMime == null ? '' : declaredMime).toLowerCase();
    return (mime === 'image/png' || mime === 'image/gif') ? 'image/png' : 'image/jpeg';
  }

  function dialogButton(label, kind) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-label', label);
    button.className = 'md-editor-button md-image-dialog-button' + (kind ? ' md-image-dialog-button--' + kind : '');
    return button;
  }

  // Accessible, non-blocking <dialog> prompt (no blocking browser confirmation is used).
  function askLargeImage(file, verdict) {
    const animated = !!(verdict && verdict.animated);
    return new Promise(function (resolve) {
      const dialog = doc.createElement('dialog');
      dialog.className = 'md-image-dialog';
      dialog.setAttribute('aria-labelledby', 'md-image-dialog-title');

      const title = doc.createElement('h2');
      title.id = 'md-image-dialog-title';
      title.textContent = animated ? '动图较大' : '图片较大';
      const body = doc.createElement('p');
      body.textContent = fileName(file) + ' 约 ' + formatSize(file.size) + '，超过 2MB。默认保留原图；如需减小体积可选择压缩（会降低分辨率或质量）。';
      const hint = doc.createElement('p');
      hint.className = 'md-image-dialog-hint';
      hint.textContent = animated
        ? 'GIF 默认保留动图；选择压缩后动图会变为静态图，请谨慎选择。'
        : '不压缩将保留图表原始质量，适合专业排版。';

      const actions = doc.createElement('div');
      actions.className = 'md-image-dialog-actions';
      const keep = dialogButton('保留原图', 'primary');
      const compress = dialogButton('压缩');
      const cancel = dialogButton('取消');
      actions.append(keep, compress, cancel);
      dialog.append(title, body, hint, actions);

      let settled = false;
      function done(choice) {
        if (settled) return;
        settled = true;
        try { dialog.close(); } catch (error) { /* already closed */ }
        if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
        resolve(choice);
      }
      keep.addEventListener('click', function () { done('keep'); });
      compress.addEventListener('click', function () { done('compress'); });
      cancel.addEventListener('click', function () { done('cancel'); });
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); done('cancel'); });

      doc.body.append(dialog);
      if (typeof dialog.showModal === 'function') { dialog.showModal(); keep.focus(); }
      else done('keep'); // environments without <dialog> default to keeping the original
    });
  }

  // Core insertion pipeline shared by paste, drop and the picker.
  // range is an optional explicit { from, to } anchor (drop uses the drop point);
  // when omitted the current selection is used.
  async function startInsertion(files, range) {
    const api = global.mdEditor;
    const list = Array.from(files || []);
    if (!api || !api.__mounted || !list.length) return;

    const accepted = [];
    const notes = [];
    for (const file of list) {
      const verdict = H.classifyFile(file);
      if (!verdict.ok) { notes.push(fileName(file) + '：' + verdict.message); continue; }
      accepted.push({ file: file, verdict: verdict });
    }
    if (!accepted.length) { setStatus(notes.join(' '), true); return; }

    // Anchor: keep the target range correct while files are read asynchronously.
    const selection = api.getSelection();
    const explicit = range && Number.isFinite(range.from);
    let from = explicit ? range.from : selection.from;
    let to = explicit ? (Number.isFinite(range.to) ? range.to : range.from) : selection.to;

    // If the document is replaced by a programmatic load (switching examples)
    // while we await the file reads, the pending anchor is meaningless: abort.
    let reset = false;
    function onReset() { reset = true; }
    function mapAnchor(event) {
      const changes = event && event.detail && event.detail.changes;
      if (!changes) return;
      from = changes.mapPos(from, 1);
      to = changes.mapPos(to, 1);
    }
    doc.addEventListener('md-editor-reset', onReset);
    doc.addEventListener('md-editor-transaction', mapAnchor);

    try {
      const images = [];
      let compressed = 0, cancelled = 0, rejected = 0;
      for (const item of accepted) {
        const file = item.file;
        const verdict = item.verdict;
        if (!(await canDecode(file))) {
          rejected++;
          notes.push(fileName(file) + '：无法解码（文件可能已损坏），未插入');
          continue;
        }
        const originalUrl = await readAsImageDataUrl(file, verdict.mime);
        let url = originalUrl;
        if (file.size > H.LARGE_IMAGE_BYTES) {
          const choice = await askLargeImage(file, verdict);
          if (choice === 'cancel') { cancelled++; notes.push(fileName(file) + '：已取消'); continue; }
          if (choice === 'compress') {
            const result = await compressImage(file, verdict.mime);
            if (result.compressed) {
              url = result.url;
              compressed++;
              if (verdict.animated) notes.push(fileName(file) + '：压缩后动图已变为静态图');
            } else {
              notes.push(fileName(file) + '：压缩未减小体积，已保留原图');
            }
          }
        }
        images.push({ caption: H.sanitizeCaption(file.name), url: url });
      }
      if (reset) { setStatus('文档已切换，图片未插入，请重试。', true); return; }
      if (!images.length) { setStatus(notes.join(' '), false); return; }

      const plan = H.planImageInsertion({ text: api.getValue(), from: from, to: to, images: images });
      if (!plan.insert) return;
      api.replaceRange(from, to, plan.insert); // one transaction => one undo step
      api.setSelection(plan.selection);

      const parts = ['已插入 ' + plan.count + ' 张图片'];
      if (compressed) parts.push('其中 ' + compressed + ' 张已压缩');
      if (cancelled) parts.push('取消 ' + cancelled + ' 张');
      if (rejected) parts.push('跳过 ' + rejected + ' 张');
      if (notes.length) parts.push(notes.join(' '));
      setStatus(parts.join('；'), false);
    } catch (error) {
      setStatus('插入图片失败：' + (error && error.message ? error.message : error), true);
    } finally {
      doc.removeEventListener('md-editor-reset', onReset);
      doc.removeEventListener('md-editor-transaction', mapAnchor);
    }
  }

  function handleFilesEvent(event, data, view) {
    if (!data) return false;
    const files = collectFiles(data);
    if (!files.length) return false; // plain-text paste/drop keeps default behaviour
    event.preventDefault();
    // Drop lands at the pointer, not at the previous selection.
    startInsertion(files, dropRange(event, view));
    return true;
  }

  // Explicit insertion anchor for a drop: the document position under the
  // pointer. Returns null when unavailable (then the selection is used).
  function dropRange(event, view) {
    if (!view || typeof view.posAtCoords !== 'function') return null;
    const x = event.clientX, y = event.clientY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    let pos = null;
    try { pos = view.posAtCoords({ x: x, y: y }); } catch (error) { pos = null; }
    if (!Number.isFinite(pos)) return null;
    return { from: pos, to: pos };
  }

  function createExtensions(Vend, api) {
    class FoldWidget extends Vend.WidgetType {
      constructor(from, to) { super(); this.from = from; this.to = to; }
      eq(other) { return other.from === this.from && other.to === this.to; }
      toDOM() {
        const widget = this;
        const span = doc.createElement('span');
        span.className = 'md-image-fold';
        span.textContent = foldPlaceholder(this);
        span.title = '点击展开原始数据';
        span.setAttribute('role', 'button');
        span.setAttribute('tabindex', '0');
        span.setAttribute('aria-label', '已折叠的图片数据，共 ' + (this.to - this.from) + ' 字符，点击展开');
        function reveal(event) {
          if (event && typeof event.preventDefault === 'function') event.preventDefault();
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
          api.focus();
          api.setSelection(widget.from);
        }
        span.addEventListener('mousedown', reveal);
        span.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') reveal(event);
        });
        return span;
      }
      ignoreEvent() { return true; } // the module fully owns interaction on the widget
    }

    function selectionTouches(state, from, to) {
      for (const range of state.selection.ranges) {
        if (range.from <= to && from <= range.to) return true;
      }
      return false;
    }

    function buildDecorations(state) {
      const text = state.doc.toString();
      const ranges = H.findFoldRanges(text, H.FOLD_THRESHOLD);
      const specs = [];
      for (const range of ranges) {
        if (selectionTouches(state, range.from, range.to)) continue; // reveal when selected
        specs.push(Vend.Decoration.replace({ widget: new FoldWidget(range.from, range.to) }).range(range.from, range.to));
      }
      return Vend.Decoration.set(specs, true);
    }

    const foldPlugin = Vend.ViewPlugin.fromClass(class {
      constructor(view) { this.decorations = buildDecorations(view.state); }
      update(update) {
        if (update.docChanged || update.selectionSet || update.viewportChanged ||
            update.transactions.some(function (tr) { return tr.reconfigured; })) {
          this.decorations = buildDecorations(update.state);
        }
      }
    }, { decorations: function (value) { return value.decorations; } });

    const interactionExtension = Vend.EditorView.domEventHandlers({
      paste: function (event) { return handleFilesEvent(event, event.clipboardData, null); },
      drop: function (event, view) { return handleFilesEvent(event, event.dataTransfer, view); },
    });

    return { foldPlugin: foldPlugin, interactionExtension: interactionExtension };
  }

  function installStatus(toolbar) {
    const el = doc.createElement('span');
    el.className = 'md-image-status';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    toolbar.append(el);
    return el;
  }

  function ensurePicker() {
    if (picker) return picker;
    picker = doc.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.accept = SUPPORTED_MIME.join(',');
    picker.className = 'md-image-picker';
    picker.setAttribute('aria-hidden', 'true');
    picker.tabIndex = -1;
    picker.addEventListener('change', function () {
      // picker.files is a live FileList: snapshot it *before* clearing value,
      // which otherwise empties the list and drops the selection.
      const files = Array.from(picker.files);
      picker.value = '';
      if (files.length) startInsertion(files);
    });
    doc.body.append(picker);
    return picker;
  }

  // Compact line-art SVG icon (same style as the workspace toolbar icons).
  function imageIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'md-wt-icon');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const shapes = [
      { rect: [4.2, 5, 11.6, 10], rx: 1.8 },
      { circle: [7.8, 8.6, 1.3] },
      { d: 'M5 14.6l3.2-3.4 2.4 2.3 3-3.4 1.2 1.3' },
    ];
    for (const shape of shapes) {
      let node;
      if (shape.circle) {
        node = doc.createElementNS(NS, 'circle');
        node.setAttribute('cx', shape.circle[0]);
        node.setAttribute('cy', shape.circle[1]);
        node.setAttribute('r', shape.circle[2]);
      } else if (shape.rect) {
        node = doc.createElementNS(NS, 'rect');
        node.setAttribute('x', shape.rect[0]);
        node.setAttribute('y', shape.rect[1]);
        node.setAttribute('width', shape.rect[2]);
        node.setAttribute('height', shape.rect[3]);
        if (shape.rx != null) node.setAttribute('rx', shape.rx);
      } else {
        node = doc.createElementNS(NS, 'path');
        node.setAttribute('d', shape.d);
      }
      node.setAttribute('fill', 'none');
      node.setAttribute('stroke', 'currentColor');
      node.setAttribute('stroke-width', '1.4');
      node.setAttribute('stroke-linecap', 'round');
      node.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(node);
    }
    return svg;
  }

  // Mount the icon button into the insert group's mount point (or the toolbar
  // itself as a fallback). Only appearance/mounting changes here; the picker
  // and the whole insertion pipeline below are untouched.
  function installToolbarButton(container) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'md-wt-button md-image-insert';
    // Keep the dynamically mounted button in its group's arrow-key navigation.
    button.tabIndex = container.closest('[role="group"]') ? -1 : 0;
    button.setAttribute('aria-label', '插入图片');
    button.title = '插入图片（选择文件，或直接粘贴 / 拖放）';
    button.appendChild(imageIcon());
    button.addEventListener('click', function () { ensurePicker().click(); });
    container.append(button);
  }

  // Mount the button + status into the *visible* workspace toolbar. It is built
  // by editor-workspace.js which may run after this module, so wait for it once.
  function mountControls() {
    if (toolbarMounted) return true;
    const toolbar = doc.querySelector('.md-wt-toolbar');
    if (!toolbar) return false;
    toolbarMounted = true;
    const mount = toolbar.querySelector('[data-md-wt-mount="images"]') || toolbar;
    installToolbarButton(mount);
    statusEl = installStatus(toolbar);
    return true;
  }

  function waitForToolbar() {
    if (mountControls()) return;
    if (typeof global.MutationObserver !== 'function') return;
    const root = doc.documentElement || doc.body;
    if (!root) return;
    const observer = new global.MutationObserver(function () {
      if (mountControls()) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  function boot() {
    if (global.__mdpdfImages) return;
    const Vend = global.MDEditorVendor;
    const api = global.mdEditor;
    if (!Vend || !api || !api.__mounted || typeof api.addExtension !== 'function') return;
    if (!Vend.ViewPlugin || !Vend.Decoration || !Vend.WidgetType || !Vend.EditorView ||
        typeof Vend.EditorView.domEventHandlers !== 'function') return;
    global.__mdpdfImages = true;
    doc = global.document;
    const extensions = createExtensions(Vend, api);
    api.addExtension(extensions.foldPlugin);
    api.addExtension(extensions.interactionExtension);
    waitForToolbar();
    ensurePicker();
  }

  if (global.mdEditor) boot();
  else {
    global.document.addEventListener('md-editor-ready', boot, { once: true });
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', boot, { once: true });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
