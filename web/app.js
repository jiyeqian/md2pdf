const editor = document.querySelector('#markdown');
const form = document.querySelector('#options');
const preview = document.querySelector('#preview');
const status = document.querySelector('#status');
const download = document.querySelector('#download');
const example = document.querySelector('#example');
let timer;
let controller;
let revision = 0;
let downloading = false;
let loadingExample = false;
let previewTimer;
let previewRevision = -1;

function setStatus(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}

function updateCount() {
  document.querySelector('#count').textContent = `${editor.value.length.toLocaleString('zh-CN')} 字符`;
  download.disabled = downloading || loadingExample || !editor.value.trim();
}

function payload() {
  const options = {};
  for (const [key, value] of new FormData(form)) {
    if (!value) continue;
    if (key === 'margin') {
      options.marginTop = options.marginBottom = options.marginLeft = options.marginRight = Number(value);
    } else if (key === 'fontSize') options[key] = Number(value);
    else if (key === 'toc') options[key] = value === 'true';
    else options[key] = value;
  }
  return { md: editor.value, opts: options };
}

async function request(url, body, signal) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `请求失败（${response.status}）`);
  }
  return response;
}

function schedulePreview() {
  revision++;
  previewRevision = -1;
  clearTimeout(timer);
  clearTimeout(previewTimer);
  controller?.abort();
  updateCount();
  setStatus('等待更新…');
  timer = setTimeout(renderPreview, 450);
}

async function renderPreview() {
  const current = revision;
  if (!form.reportValidity()) {
    setStatus('请检查排版选项。', true);
    return;
  }
  if (!editor.value.trim()) {
    preview.removeAttribute('srcdoc');
    document.querySelector('#empty-preview').hidden = false;
    setStatus('输入 Markdown 即可开始排版。');
    return;
  }
  controller = new AbortController();
  setStatus('正在生成预览…');
  try {
    const response = await request('/api/render', payload(), controller.signal);
    const result = await response.json();
    if (current !== revision) return;
    document.querySelector('#empty-preview').hidden = true;
    document.querySelector('#document-type').textContent = `${result.type} · A4`;
    previewRevision = current;
    preview.srcdoc = result.html.replaceAll("type:'md2pdf-ready'", "type:'md2pdf-ready',revision:" + current).replaceAll("type:'md2pdf-error'", "type:'md2pdf-error',revision:" + current);
    setStatus('正在加载公式、图表与分页…');
    previewTimer = setTimeout(() => {
      if (current === revision) setStatus('排版等待超时，请修改内容或重试。', true);
    }, 60000);
  } catch (error) {
    if (error.name !== 'AbortError' && current === revision) setStatus(error.message, true);
  }
}

window.addEventListener('message', event => {
  if (event.source !== preview.contentWindow || !event.data || event.data.revision !== previewRevision || previewRevision !== revision) return;
  if (event.data.type === 'md2pdf-ready') {
    clearTimeout(previewTimer);
    if (!downloading) setStatus('预览已更新');
  } else if (event.data.type === 'md2pdf-error') {
    clearTimeout(previewTimer);
    setStatus(event.data.error || '预览排版失败。', true);
  }
});

async function loadExample() {
  loadingExample = true;
  example.disabled = true;
  updateCount();
  const startedAt = revision;
  setStatus('正在加载示例…');
  try {
    const response = await fetch('/api/example');
    if (!response.ok) throw new Error('示例加载失败，请直接输入 Markdown。');
    const result = await response.json();
    // A slow initial response must never overwrite text entered while loading.
    if (startedAt !== revision) return;
    editor.value = result.md;
    schedulePreview();
  } catch (error) {
    if (startedAt === revision) setStatus(error.message, true);
  } finally {
    loadingExample = false;
    example.disabled = false;
    editor.placeholder = '在此输入 Markdown…';
    updateCount();
  }
}

editor.addEventListener('input', schedulePreview);
form.addEventListener('input', schedulePreview);
form.addEventListener('submit', event => event.preventDefault());
example.addEventListener('click', () => {
  if (!editor.value.trim() || window.confirm('加载示例会替换当前正文，是否继续？')) loadExample();
});
download.addEventListener('click', async () => {
  if (!form.reportValidity()) return;
  downloading = true;
  updateCount();
  download.textContent = '正在导出…';
  setStatus('正在生成 PDF，复杂文档可能需要稍等。');
  try {
    const response = await request('/api/pdf', payload());
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const filename = /filename\*=UTF-8''([^;]+)/i.exec(response.headers.get('Content-Disposition') || '');
    anchor.download = filename ? decodeURIComponent(filename[1]) : 'document.pdf';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setStatus('PDF 已生成，下载已开始。');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    downloading = false;
    download.textContent = '下载 PDF ↓';
    updateCount();
  }
});
loadExample();
