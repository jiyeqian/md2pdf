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
  let rootId = '', folders = [], creatingFolder = false, confirmDelete = '', items = [], nextLink = '', loading = false, listError = '', info = '', retryPage = false, retryOpenItem = null;
  let listGeneration = 0, openGeneration = 0, visited = new Set(), lastHighlight = '', mutationBusy = false;
  function renderCloud() {
    if (!cloudPane) return;
    if (auth && !auth.connected() && (items.length || rootId || binding)) { rootId = ''; folders = []; items = []; nextLink = ''; visited.clear(); binding = null; ++openGeneration; }
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
    const action = (text, fn, disabled = false) => { const button = doc.createElement('button'); button.type = 'button'; button.className = 'md-cloud-panel-button'; button.textContent = text; button.disabled = disabled; button.addEventListener('click', fn); actions.append(button); };
    action('刷新', () => { void refresh(); }); action('新建文件夹', () => { if (!mutationBusy && !busy) { creatingFolder = true; renderCloud(); } }, mutationBusy || busy); action('断开', () => { void logout(); });
    if (folders.length) { const nav = doc.createElement('div'); nav.className = 'md-cloud-panel-actions'; cloudPane.append(nav); for (let i = 0; i < folders.length; i++) { const crumb = doc.createElement('button'); crumb.type = 'button'; crumb.className = 'md-cloud-panel-button'; crumb.textContent = folders[i].name; crumb.addEventListener('click', () => { folders = folders.slice(0, i + 1); items = []; nextLink = ''; confirmDelete = ''; void refresh(); }); nav.append(crumb); } }
    if (creatingFolder) { const form = doc.createElement('form'); form.className = 'md-cloud-panel-actions'; const input = doc.createElement('input'); input.placeholder = '文件夹名称'; input.setAttribute('aria-label', '文件夹名称'); const submit = doc.createElement('button'); submit.type = 'submit'; submit.disabled = mutationBusy || busy; submit.className = 'md-cloud-panel-button'; submit.textContent = '创建'; const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.className = 'md-cloud-panel-button'; cancel.textContent = '取消'; cancel.addEventListener('click', () => { creatingFolder = false; renderCloud(); }); form.append(input, submit, cancel); form.addEventListener('submit', e => { e.preventDefault(); void createFolder(input.value); }); cloudPane.append(form); }
    message(loading ? '正在加载…' : info); message(listError, true);
    const list = doc.createElement('div'); list.className = 'md-cloud-panel-list'; cloudPane.append(list);
    if (!items.length && !loading) { const empty = doc.createElement('p'); empty.className = 'md-sidebar-empty'; empty.textContent = nextLink ? '本页没有 Markdown 文件。' : '应用文件夹中没有 Markdown 文件。'; list.append(empty); }
    for (const item of items) {
      const row = doc.createElement('div'); row.className = 'md-cloud-panel-row'; list.append(row);
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'md-cloud-panel-file'; button.disabled = mutationBusy && !item.folder; button.dataset.cloudId = item.id;
      if (binding?.draftId === current() && binding.id === item.id) { button.classList.add('is-current'); button.setAttribute('aria-current', 'true'); }
      const name = doc.createElement('span'); name.className = 'md-cloud-panel-name'; name.textContent = (item.folder ? '📁 ' : '') + item.name;
      const size = doc.createElement('span'); size.className = 'md-cloud-panel-size'; size.textContent = item.folder ? '文件夹' : formatOneDriveSize(item.size);
      button.append(name, size); button.addEventListener('click', () => { if (item.folder) { folders.push({id:item.id,name:item.name}); items = []; nextLink = ''; confirmDelete = ''; void refresh(); } else void openItem(item); }); row.append(button);
      { const menu = doc.createElement('button'); menu.type = 'button'; menu.className = 'md-cloud-panel-button'; menu.textContent = '⋯'; menu.disabled = mutationBusy || busy; menu.setAttribute('aria-label', '删除 ' + item.name); menu.addEventListener('click', () => { confirmDelete = item.id; renderCloud(); }); row.append(menu); }
      if (confirmDelete === item.id) { const confirm = doc.createElement('div'); confirm.className = 'md-cloud-delete-confirm'; const text = doc.createElement('span'); text.textContent = item.folder ? '将文件夹‘' + item.name + '’及其全部内容移到 OneDrive 回收站？' : '将“' + item.name + '”移到 OneDrive 回收站？'; const yes = doc.createElement('button'); yes.type = 'button'; yes.disabled = mutationBusy || busy; yes.className = 'md-cloud-panel-button'; yes.textContent = '移到回收站'; yes.addEventListener('click', () => { void deleteFile(item); }); const no = doc.createElement('button'); no.type = 'button'; no.className = 'md-cloud-panel-button'; no.textContent = '取消'; no.addEventListener('click', () => { confirmDelete = ''; renderCloud(); }); confirm.append(text, yes, no); list.append(confirm); }
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
    const started = generation, request = ++listGeneration, client = graph; ++openGeneration;
    loading = true; listError = ''; retryPage = false; retryOpenItem = null; info = ''; renderCloud();
    try {
      const root = await client.getRoot();
      if (started !== generation || request !== listGeneration || client !== graph) return;
      if (!folders.length || folders[0].id !== root) folders = [{id:root,name:'应用文件夹'}];
      const page = await client.listPage(folders.at(-1).id);
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
      const page = await client.listPage(folders.at(-1).id, link);
      if (started !== generation || request !== listGeneration || client !== graph) return;
      if (page.nextLink && visited.has(page.nextLink)) throw new Error('OneDrive 返回了重复的分页地址，请刷新重试。');
      items = uniqueItems([...items, ...page.items]); nextLink = page.nextLink; if (nextLink) visited.add(nextLink);
    } catch (error) { if (started === generation && request === listGeneration) listError = errorMessage(error); }
    finally { if (started === generation && request === listGeneration) { loading = false; renderCloud(); } }
  }
  async function createFolder(name) {
    if (mutationBusy || busy) return; mutationBusy = true; renderCloud();
    const started = generation, request = listGeneration, client = graph, parent = folders.at(-1)?.id;
    try { await client.createFolder(parent, name); if (started !== generation || request !== listGeneration || client !== graph) return; creatingFolder = false; await refresh(); }
    catch (error) { if (started === generation && request === listGeneration) { listError = errorMessage(error); renderCloud(); } }
    finally { mutationBusy = false; renderCloud(); }
  }
  async function deleteFile(item) {
    if (mutationBusy || busy) return; mutationBusy = true; ++openGeneration; info = ''; renderCloud();
    const started = generation, request = listGeneration, client = graph;
    try { if (item.folder) await client.deleteFolder(item.id, item.eTag, item.name); else await client.deleteFile(item.id, item.eTag, item.name); if (started !== generation || client !== graph) return; if (binding?.id === item.id || item.folder && binding?.ancestors?.includes(item.id)) { binding = null; status(''); } if (request !== listGeneration) return; confirmDelete = ''; await refresh(); }
    catch (error) { if (started === generation && request === listGeneration) { listError = errorMessage(error); renderCloud(); } }
    finally { mutationBusy = false; renderCloud(); }
  }
  async function openItem(item) {
    if (mutationBusy) return;
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
      binding = { ...file, draftId: current(), rootId: folders.at(-1)?.id || rootId, ancestors: folders.map(folder => folder.id), savedText: file.text }; info = ''; renderCloud(); status('OneDrive · 已打开');
      const owner = sidebar?.element.ownerDocument.defaultView;
      if (owner?.matchMedia('(max-width: 600px)').matches) sidebar.close();
    } catch (error) { if (started === generation && request === openGeneration && error.name !== 'AbortError') { info = ''; listError = errorMessage(error); retryOpenItem = item; renderCloud(); } }
  }
  async function logout() {
    const old = auth, oldPrepare = preparing, oldConnection = connectionPromise, started = ++generation; ++listGeneration; ++openGeneration;
    auth = graph = binding = null; rootId = ''; folders = []; creatingFolder = false; confirmDelete = ''; items = []; nextLink = ''; visited = new Set(); loading = connecting = false; initializing = true; listError = ''; retryOpenItem = null; info = '正在断开…'; status(''); renderCloud();
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
    if (busy || mutationBusy) { status('OneDrive 操作进行中'); return; }
    busy = true; renderCloud();
    try { await action(); } catch (error) { status(errorMessage(error), true); }
    finally { busy = false; renderCloud(); }
  }
  async function filenameDialog(initial, path) {
    const doc = window.mdWorkspaceHosts?.activeDocument() || document;
    const dialog = doc.createElement('dialog'); dialog.className = 'template-confirm md-draft-confirm md-onedrive-dialog';
    dialog.setAttribute('aria-label', '保存到 OneDrive');
    const info = doc.createElement('p'); info.textContent = 'OneDrive / Apps / md2pdf' + path.map(name => ' / ' + name).join('') + ' · ' + (auth?.account() || 'Microsoft 账户') + '（保存副本）'; dialog.append(info);
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
  async function choiceDialog(message, choices) {
    const doc = window.mdWorkspaceHosts?.activeDocument() || document;
    const dialog = doc.createElement('dialog'); dialog.className = 'template-confirm md-draft-confirm md-onedrive-dialog'; dialog.setAttribute('aria-label', 'OneDrive 保存冲突');
    const p = doc.createElement('p'); p.textContent = message; dialog.append(p);
    const actions = doc.createElement('div'); actions.className = 'template-confirm-actions';
    for (const [label, value] of choices) { const button = doc.createElement('button'); button.type = 'button'; button.className = 'template-confirm-cancel'; button.textContent = label; button.addEventListener('click', () => dialog.close(value)); actions.append(button); }
    dialog.append(actions); doc.body.append(dialog); dialog.showModal();
    return new Promise(resolve => dialog.addEventListener('close', () => { const value = dialog.returnValue; dialog.remove(); resolve(value); }, {once:true}));
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
      const targetPath = folders.slice(1).map(folder => folder.name);
      const targetAncestors = folders.map(folder => folder.id);
      const targetRootId = folders.at(-1)?.id || rootId || await client.getRoot();
      if (current() !== draftId || generation !== operation) return;
      let result, name;
      if (existing) {
        try { result = await client.overwrite({id:existing.id,eTag:existing.eTag,parentId:existing.rootId,name:existing.name,text}); name = existing.name; }
        catch (error) {
          if (![404,409,412,413].includes(error.status)) throw error;
          if (current() !== draftId || generation !== operation) return;
          const choice = await choiceDialog(error.status === 413 ? '文件超过 10 MiB，不能条件覆盖。请选择保存副本，或取消。' : '云端文件已变化、移动或删除。请选择保存副本，或取消。', [['保存副本','copy'],['取消','cancel']]);
          if (choice !== 'copy' || current() !== draftId || generation !== operation) { status(''); return; }
        }
      }
      if (!result) {
        const files = await import('./editor-files.mjs');
        const options = window.mdWorkspaceHosts?.query('#options') || document.querySelector('#options');
        let proposed = files.markdownDownloadName(text, new Date(), options?.elements.type?.value || '');
        while (!result) {
          name = await filenameDialog(proposed, targetPath);
          if (current() !== draftId || generation !== operation) return;
          if (!name) { status(''); return; }
          if (!/\.(md|markdown|mdown)$/i.test(name)) name += '.md';
          try { result = await client.save({rootId:targetRootId,name,text}); }
          catch (error) {
            if (error.status !== 409) throw error;
            if (current() !== draftId || generation !== operation) return;
            const item = await client.findByName(targetRootId,name);
            if (current() !== draftId || generation !== operation) return;
            const choice = await choiceDialog('文件“' + item.name + '”已存在。确认覆盖、改名或取消。', [['覆盖','overwrite'],['改名','rename'],['取消','cancel']]);
            if (current() !== draftId || generation !== operation) return;
            if (choice === 'cancel' || !choice) { status(''); return; }
            if (choice === 'rename') { proposed = name; continue; }
            result = await client.overwrite({id:item.id,eTag:item.eTag,parentId:targetRootId,name:item.name,text});
          }
        }
      }
      if (current() !== draftId || generation !== operation) return;
      binding = { id: result.id, eTag: result.eTag, name: result.name || name, rootId: existing && result.id === existing.id ? existing.rootId : targetRootId, ancestors: existing && result.id === existing.id ? existing.ancestors : targetAncestors, draftId, savedText: text };
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
