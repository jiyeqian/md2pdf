import { createOneDriveAuth, ONEDRIVE_UNCONFIGURED } from './onedrive-auth.mjs';
import { createOneDriveGraph } from './onedrive-graph.mjs';

export function formatOneDriveSize(size) {
  if (!Number.isSafeInteger(size) || size < 0) return '大小未知';
  if (size === 0) return '0 B · 空文件';
  if (size < 1024) return `${size} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = size / 1024, index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${Number(value.toFixed(1))} ${units[index]}`;
}

export function initializeOneDrive() {
  let graph, auth, binding = null, busy = false, generation = 0;
  const current = () => window.mdDrafts?.current();
  const status = (message, error = false) => {
    const panel = window.mdWorkspaceHosts?.query('.editor-panel') || document.querySelector('.editor-panel');
    if (!panel) return;
    let notice = panel.querySelector('.md-cloud-notice');
    if (!notice) {
      const doc = panel.ownerDocument;
      notice = doc.createElement('div'); notice.className = 'md-cloud-notice';
      const body = doc.createElement('div'); body.className = 'md-cloud-notice-body';
      const node = doc.createElement('span'); node.className = 'md-cloud-status'; node.setAttribute('role', 'status');
      const detail = doc.createElement('div'); detail.className = 'md-cloud-error'; detail.setAttribute('role', 'alert'); detail.hidden = true;
      const close = doc.createElement('button'); close.type = 'button'; close.className = 'md-cloud-close'; close.setAttribute('aria-label', '关闭 OneDrive 提示'); close.textContent = '×';
      close.addEventListener('click', () => { notice.hidden = true; panel.querySelector('button[aria-label="打开 Markdown"]')?.focus(); });
      body.append(node, detail); notice.append(body, close);
      const anchor = panel.querySelector('.md-wt-toolbar') || panel.querySelector('.panel-heading');
      if (anchor) anchor.after(notice); else panel.append(notice);
    }
    const node = notice.querySelector('.md-cloud-status'), detail = notice.querySelector('.md-cloud-error');
    node.textContent = error ? 'OneDrive · 操作失败' : message;
    node.title = message;
    detail.textContent = error ? message + ' 本地草稿仍保留。' : '';
    if (error && message === ONEDRIVE_UNCONFIGURED) {
      const link = panel.ownerDocument.createElement('a'); link.className = 'md-notice-link';
      link.href = new URL('onedrive-setup.html', import.meta.url).href;
      link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = '配置说明';
      detail.replaceChildren('OneDrive 尚未配置，请参照「', link, '」完成设置。本地草稿仍保留。');
    }
    detail.hidden = !error;
    notice.dataset.error = String(error);
    notice.hidden = !message;
  };
  let sidebar, cloudPane, wantOpen = false, preparing, connectionPromise, initializing = false, connecting = false;
  let rootId = '', items = [], nextLink = '', loading = false, listError = '', info = '', retryPage = false, retryOpenItem = null;
  let listGeneration = 0, openGeneration = 0, visited = new Set(), lastHighlight = '';
  function renderCloud() {
    if (!cloudPane) return;
    if (auth && !auth.connected() && (items.length || rootId || binding)) { rootId = ''; items = []; nextLink = ''; visited.clear(); binding = null; ++openGeneration; }
    const doc = cloudPane.ownerDocument;
    cloudPane.replaceChildren();
    const addButton = (text, action, disabled = false) => {
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'md-cloud-panel-button';
      button.textContent = text; button.disabled = disabled; button.addEventListener('click', action); cloudPane.append(button); return button;
    };
    const message = (text, error = false) => {
      if (!text) return;
      const p = doc.createElement('p'); p.className = error ? 'md-cloud-panel-error' : 'md-sidebar-empty';
      p.setAttribute('role', error ? 'alert' : 'status'); p.textContent = text;
      if (error && text === ONEDRIVE_UNCONFIGURED) {
        const link = doc.createElement('a'); link.href = new URL('onedrive-setup.html', import.meta.url).href;
        link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = '配置说明';
        p.replaceChildren('OneDrive 尚未配置，请参照「', link, '」完成设置。');
      }
      cloudPane.append(p);
    };
    if (!auth?.connected()) {
      const p = doc.createElement('p'); p.className = 'md-sidebar-empty'; p.textContent = '连接个人 OneDrive，访问应用文件夹中的 Markdown。'; cloudPane.append(p);
      message(listError, true); message(info);
      if (listError && !auth) addButton('重试', () => { listError = ''; void prepare(); }, initializing);
      else addButton(initializing ? '正在准备…' : connecting ? '正在连接…' : '连接 OneDrive', connectFromClick, initializing || connecting || !auth);
      return;
    }
    const account = doc.createElement('p'); account.className = 'md-cloud-panel-account'; account.textContent = 'OneDrive / Apps / md2pdf · ' + (auth.account() || 'Microsoft 账户'); cloudPane.append(account);
    const actions = doc.createElement('div'); actions.className = 'md-cloud-panel-actions'; cloudPane.append(actions);
    const action = (text, fn) => { const button = doc.createElement('button'); button.type = 'button'; button.className = 'md-cloud-panel-button'; button.textContent = text; button.addEventListener('click', fn); actions.append(button); };
    action('刷新', () => { void refresh(); }); action('断开', () => { void logout(); });
    message(loading ? '正在加载…' : info); message(listError, true);
    const list = doc.createElement('div'); list.className = 'md-cloud-panel-list'; cloudPane.append(list);
    if (!items.length && !loading) { const empty = doc.createElement('p'); empty.className = 'md-sidebar-empty'; empty.textContent = nextLink ? '本页没有 Markdown 文件。' : '应用文件夹中没有 Markdown 文件。'; list.append(empty); }
    for (const item of items) {
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'md-cloud-panel-file'; button.dataset.cloudId = item.id;
      if (binding?.draftId === current() && binding.id === item.id) { button.classList.add('is-current'); button.setAttribute('aria-current', 'true'); }
      const name = doc.createElement('span'); name.className = 'md-cloud-panel-name'; name.textContent = item.name;
      const size = doc.createElement('span'); size.className = 'md-cloud-panel-size'; size.textContent = formatOneDriveSize(item.size);
      button.append(name, size); button.addEventListener('click', () => { void openItem(item); }); list.append(button);
    }
    lastHighlight = binding?.draftId === current() ? binding.id : '';
    if (listError && retryOpenItem) addButton('重试打开', () => { void openItem(retryOpenItem); }, loading);
    else if (listError && !retryPage) addButton('重试', () => { void refresh(); }, loading);
    if (nextLink) addButton(listError && retryPage && !retryOpenItem ? '重试加载' : '加载更多', () => { void loadMore(); }, loading);
  }
  function attachSidebar(value) {
    if (sidebar || !value) return;
    sidebar = value; cloudPane = sidebar.addView({key:'cloud', label:'云文件', icon:'M7 18h10a4 4 0 0 0 .3-8A5.5 5.5 0 0 0 6.7 9 4.5 4.5 0 0 0 7 18z', onActive: active => { if (active && !auth && !preparing) void prepare(); }});
    cloudPane.classList.add('md-cloud-panel'); renderCloud();
    if (wantOpen) showCloud();
  }
  function showCloud() {
    wantOpen = true;
    if (!sidebar) return;
    wantOpen = false; sidebar.selectView('cloud'); sidebar.open();
  }
  function prepare() {
    if (auth || preparing) return preparing;
    const started = generation; initializing = true; listError = ''; renderCloud();
    const task = (async () => {
      try {
        const candidate = await createOneDriveAuth();
        if (started !== generation) { await candidate.logout(); return; }
        auth = candidate; graph = createOneDriveGraph({ token: () => candidate.token() });
      } catch (error) { if (started === generation) listError = errorMessage(error); }
      finally { if (preparing === task) preparing = null; if (started === generation) { initializing = false; renderCloud(); } }
    })();
    preparing = task; return task;
  }
  function connectFromClick() {
    if (!auth || connecting) return;
    const instance = auth, started = generation;
    // Call before any await so the Microsoft popup retains this user gesture.
    let promise;
    try { promise = instance.connect(); } catch (error) { listError = errorMessage(error); renderCloud(); return; }
    connecting = true; connectionPromise = Promise.resolve(promise); listError = ''; info = ''; renderCloud();
    connectionPromise.then(() => {
      if (started !== generation || auth !== instance) return;
      connecting = false; void refresh();
    }).catch(error => { if (started === generation && auth === instance) { connecting = false; listError = errorMessage(error); renderCloud(); } }).finally(() => { if (connectionPromise === promise) connectionPromise = null; });
  }
  async function refresh() {
    if (!auth?.connected() || !graph) { showCloud(); return; }
    const started = generation, request = ++listGeneration, client = graph;
    loading = true; listError = ''; retryPage = false; retryOpenItem = null; info = ''; renderCloud();
    try {
      const root = await client.getRoot();
      if (started !== generation || request !== listGeneration || client !== graph) return;
      const page = await client.listPage(root);
      if (started !== generation || request !== listGeneration || client !== graph) return;
      rootId = root; items = uniqueItems(page.items); nextLink = page.nextLink; visited = new Set();
      if (nextLink) visited.add(nextLink);
    } catch (error) { if (started === generation && request === listGeneration) listError = errorMessage(error); }
    finally { if (started === generation && request === listGeneration) { loading = false; renderCloud(); } }
  }
  function uniqueItems(values) {
    const ids = new Set(); return values.filter(item => !ids.has(item.id) && ids.add(item.id));
  }
  async function loadMore() {
    if (loading || !nextLink || !graph || !auth?.connected()) return;
    const started = generation, request = listGeneration, client = graph, link = nextLink;
    if (visited.size > 100) { listError = '文件列表超过分页上限，请整理应用文件夹。'; nextLink = ''; renderCloud(); return; }
    loading = true; listError = ''; retryPage = true; retryOpenItem = null; renderCloud();
    try {
      const page = await client.listPage(rootId, link);
      if (started !== generation || request !== listGeneration || client !== graph) return;
      if (page.nextLink && visited.has(page.nextLink)) throw new Error('OneDrive 返回了重复的分页地址，请刷新重试。');
      items = uniqueItems([...items, ...page.items]); nextLink = page.nextLink; if (nextLink) visited.add(nextLink);
    } catch (error) { if (started === generation && request === listGeneration) listError = errorMessage(error); }
    finally { if (started === generation && request === listGeneration) { loading = false; renderCloud(); } }
  }
  async function openItem(item) {
    if (!window.mdDrafts || !graph) { listError = '本地草稿不可用，无法安全打开云端文件。'; renderCloud(); return; }
    retryOpenItem = null;
    const started = generation, request = ++openGeneration, client = graph, before = current(), beforeText = window.mdEditor?.getValue();
    try {
      await window.mdDrafts.flush();
      if (started !== generation || request !== openGeneration || client !== graph || (before ? current() !== before : window.mdEditor?.getValue() !== beforeText)) return;
      const draftId = current(); info = '正在打开…'; listError = ''; renderCloud();
      const file = await client.open(item.id);
      const valid = () => started === generation && request === openGeneration && client === graph && current() === draftId;
      if (!valid()) return;
      await window.mdDrafts.openFile(file.text, file.name, valid);
      if (started !== generation || request !== openGeneration || client !== graph) return;
      binding = { ...file, draftId: current(), rootId, savedText: file.text }; info = ''; renderCloud(); status('OneDrive · 已打开');
      const owner = sidebar?.element.ownerDocument.defaultView;
      if (owner?.matchMedia('(max-width: 600px)').matches) sidebar.close();
    } catch (error) { if (started === generation && request === openGeneration && error.name !== 'AbortError') { info = ''; listError = errorMessage(error); retryOpenItem = item; renderCloud(); } }
  }
  async function logout() {
    const old = auth, oldPrepare = preparing, oldConnection = connectionPromise, started = ++generation; ++listGeneration; ++openGeneration;
    auth = graph = binding = null; rootId = ''; items = []; nextLink = ''; visited = new Set(); loading = connecting = false; initializing = true; listError = ''; retryOpenItem = null; info = '正在断开…'; status(''); renderCloud();
    try { await old?.logout(); }
    catch { if (started === generation) listError = '无法清除本次连接，请重试。'; }
    await oldConnection?.catch(() => {});
    await oldPrepare?.catch(() => {});
    if (started === generation) { initializing = false; info = ''; renderCloud(); if (!listError && sidebar?.isOpen() && sidebar.selectedView === 'cloud') void prepare(); }
  }
  function open() { showCloud(); }
  if (window.mdEditorSidebar) attachSidebar(window.mdEditorSidebar);
  else document.addEventListener('md-editor-sidebar-ready', () => attachSidebar(window.mdEditorSidebar), {once:true});
  function errorMessage(error) {
    return error?.message || 'OneDrive 操作失败，本地草稿仍保留。';
  }
  async function perform(action) {
    if (busy) { status('OneDrive 操作进行中'); return; }
    busy = true;
    try { await action(); } catch (error) { status(errorMessage(error), true); }
    finally { busy = false; }
  }
  async function filenameDialog(initial) {
    const doc = window.mdWorkspaceHosts?.activeDocument() || document;
    const dialog = doc.createElement('dialog'); dialog.className = 'template-confirm md-draft-confirm md-onedrive-dialog';
    dialog.setAttribute('aria-label', '保存到 OneDrive');
    const info = doc.createElement('p'); info.textContent = 'OneDrive / Apps / md2pdf · ' + (auth?.account() || 'Microsoft 账户'); dialog.append(info);
    const label = doc.createElement('label'); label.className = 'md-onedrive-label'; label.textContent = '文件名';
    const input = doc.createElement('input'); input.value = initial; label.append(input); dialog.append(label);
    const actions = doc.createElement('div'); actions.className = 'template-confirm-actions';
    for (const [text, value] of [['取消', false], ['保存', true]]) {
      const button = doc.createElement('button'); button.type = 'button'; button.className = value ? 'primary' : 'template-confirm-cancel'; button.textContent = text;
      button.addEventListener('click', () => dialog.close(value ? input.value : '')); actions.append(button);
    }
    dialog.append(actions); doc.body.append(dialog); dialog.showModal(); input.focus(); input.select();
    return new Promise(resolve => dialog.addEventListener('close', () => { const value = dialog.returnValue; dialog.remove(); resolve(value); }, { once: true }));
  }
  async function save() {
    await perform(async () => {
      if (!window.mdDrafts) throw new Error('本地草稿不可用，无法安全保存到 OneDrive。');
      await window.mdDrafts.flush();
      const draftId = current(), text = window.mdEditor.getValue(), operation = generation;
      const existing = binding?.draftId === draftId ? binding : null;
      status('正在保存到 OneDrive…');
      if (!auth?.connected() || !graph) { status(''); info = '请连接后再次保存。'; showCloud(); renderCloud(); return; }
      const client = graph;
      if (current() !== draftId || generation !== operation) return;
      const targetRootId = existing?.rootId || rootId || await client.getRoot();
      if (current() !== draftId || generation !== operation) return;
      const files = await import('./editor-files.mjs');
      const options = window.mdWorkspaceHosts?.query('#options') || document.querySelector('#options');
      let name = await filenameDialog(files.markdownDownloadName(text, new Date(), options?.elements.type?.value || ''));
      if (current() !== draftId || generation !== operation) return;
      if (!name) { status(''); return; }
      if (!/\.(md|markdown|mdown)$/i.test(name)) name += '.md';
      const result = await client.save({ rootId: targetRootId, name, text });
      if (current() !== draftId || generation !== operation) return;
      binding = { id: result.id, eTag: result.eTag, name: result.name || name, rootId: targetRootId, draftId, savedText: text };
      status(window.mdEditor.getValue() === text ? 'OneDrive · 已保存' : 'OneDrive · 有未保存更改');
      if (sidebar?.isOpen() && sidebar.selectedView === 'cloud') void refresh();
    });
  }
  function syncCloudState() {
    if (binding?.draftId === current()) status(window.mdEditor?.getValue() === binding.savedText ? 'OneDrive · 已保存' : 'OneDrive · 有未保存更改');
    else status('');
    const selected = binding?.draftId === current() ? binding.id : '';
    if (selected !== lastHighlight && cloudPane) {
      lastHighlight = selected;
      for (const button of cloudPane.querySelectorAll('.md-cloud-panel-file')) {
        const active = button.dataset.cloudId === selected; button.classList.toggle('is-current', active);
        if (active) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
      }
    }
  }
  document.addEventListener('md-editor-change', syncCloudState);
  document.addEventListener('md-draft-active-change', syncCloudState);
  return { open, save, logout };
}
