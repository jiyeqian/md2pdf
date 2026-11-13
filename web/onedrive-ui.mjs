import { createOneDriveAuth } from './onedrive-auth.mjs';
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
    const title = window.mdWorkspaceHosts?.query('.editor-panel .panel-heading') || document.querySelector('.editor-panel .panel-heading');
    if (!title) return;
    let node = title.querySelector('.md-cloud-status');
    if (!node) { node = document.createElement('span'); node.className = 'md-cloud-status'; node.setAttribute('role', 'status'); title.append(node); }
    node.textContent = error ? 'OneDrive · 操作失败' : message;
    node.title = message;
    const panel = title.parentElement;
    let detail = panel.querySelector('.md-cloud-error');
    if (!detail) { detail = title.ownerDocument.createElement('div'); detail.className = 'md-cloud-error'; detail.setAttribute('role', 'alert'); detail.hidden = true; title.after(detail); }
    detail.textContent = error ? message + ' 本地草稿仍保留。' : '';
    detail.hidden = !error;
  };
  async function service() {
    if (!graph) { auth = await createOneDriveAuth(); graph = createOneDriveGraph({ token: () => auth.token() }); }
    return graph;
  }
  async function connect() {
    if (auth.connected()) return true;
    const doc = window.mdWorkspaceHosts?.activeDocument() || document;
    const dialog = doc.createElement('dialog'); dialog.className = 'template-confirm md-draft-confirm md-onedrive-dialog';
    dialog.setAttribute('aria-label', '连接 OneDrive');
    const info = doc.createElement('p'); info.textContent = '登录个人 Microsoft 账户以访问应用文件夹。Markdown 文件将直接保存到你的 OneDrive。'; dialog.append(info);
    const actions = doc.createElement('div'); actions.className = 'template-confirm-actions';
    const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.className = 'template-confirm-cancel'; cancel.textContent = '取消'; cancel.addEventListener('click', () => dialog.close());
    const button = doc.createElement('button'); button.type = 'button'; button.className = 'primary'; button.textContent = '连接 OneDrive';
    button.addEventListener('click', () => { button.disabled = true; cancel.disabled = true; auth.connect().then(() => dialog.close('connected')).catch(error => { info.textContent = errorMessage(error); button.disabled = false; cancel.disabled = false; }); });
    dialog.addEventListener('cancel', event => { if (cancel.disabled) event.preventDefault(); });
    actions.append(cancel, button); dialog.append(actions); doc.body.append(dialog); dialog.showModal(); button.focus();
    return new Promise(resolve => dialog.addEventListener('close', () => { const ok = dialog.returnValue === 'connected'; dialog.remove(); resolve(ok); }, { once: true }));
  }
  function errorMessage(error) {
    return error?.message || 'OneDrive 操作失败，本地草稿仍保留。';
  }
  async function perform(action) {
    if (busy) { status('OneDrive 操作进行中'); return; }
    busy = true;
    try { await action(); } catch (error) { status(errorMessage(error), true); }
    finally { busy = false; }
  }
  async function logout() { generation++; const previous = auth; auth = graph = binding = null; await previous?.logout(); status('已退出 OneDrive'); }
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
  async function open() {
    await perform(async () => {
      await window.mdDrafts?.flush();
      const start = current(), operation = generation;
      status('正在读取 OneDrive…');
      const client = await service();
      if (!await connect() || current() !== start || generation !== operation) return;
      const list = await client.list();
      if (current() !== start || generation !== operation) return;
      const doc = window.mdWorkspaceHosts?.activeDocument() || document;
      const dialog = doc.createElement('dialog');
      dialog.className = 'template-confirm md-draft-confirm md-onedrive-dialog';
      dialog.setAttribute('aria-label', '从 OneDrive 打开 Markdown');
      const heading = doc.createElement('h2'); heading.textContent = '从 OneDrive 打开'; dialog.append(heading);
      const account = doc.createElement('p'); account.className = 'md-onedrive-account'; account.textContent = 'OneDrive / Apps / md2pdf · ' + (auth.account() || 'Microsoft 账户'); dialog.append(account);
      const signout = doc.createElement('button'); signout.type = 'button'; signout.className = 'template-confirm-cancel'; signout.textContent = '退出账户';
      signout.addEventListener('click', () => { dialog.close(); logout().catch(error => status(errorMessage(error))); });
      const files = doc.createElement('div'); files.className = 'md-onedrive-files'; dialog.append(files);
      if (!list.items.length) { const empty = doc.createElement('p'); empty.textContent = '应用文件夹中没有 Markdown 文件。'; files.append(empty); }
      for (const item of list.items) {
        const button = doc.createElement('button'); button.type = 'button'; button.className = 'md-onedrive-file';
        const name = doc.createElement('span'); name.className = 'md-onedrive-name'; name.textContent = item.name;
        const size = doc.createElement('span'); size.className = 'md-onedrive-size'; size.textContent = formatOneDriveSize(item.size);
        button.append(name, size); button.addEventListener('click', () => { dialog.close(item.id); }); files.append(button);
      }
      const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.className = 'template-confirm-cancel'; cancel.textContent = '取消'; cancel.addEventListener('click', () => dialog.close());
      const actions = doc.createElement('div'); actions.className = 'template-confirm-actions'; actions.append(signout, cancel); dialog.append(actions);
      doc.body.append(dialog); dialog.showModal(); cancel.focus();
      const chosen = await new Promise(resolve => dialog.addEventListener('close', () => { const value = dialog.returnValue; dialog.remove(); resolve(value); }, { once: true }));
      if (!chosen || current() !== start) { status(''); return; }
      const file = await client.open(chosen);
      if (current() !== start || generation !== operation) return;
      if (!window.mdDrafts) throw new Error('本地草稿不可用，无法安全打开云端文件。');
      await window.mdDrafts.openFile(file.text, file.name);
      binding = { ...file, draftId: current(), rootId: list.rootId, savedText: file.text };
      status('OneDrive · 已打开');
    });
  }
  async function save() {
    await perform(async () => {
      if (!window.mdDrafts) throw new Error('本地草稿不可用，无法安全保存到 OneDrive。');
      await window.mdDrafts.flush();
      const draftId = current(), text = window.mdEditor.getValue(), operation = generation;
      const existing = binding?.draftId === draftId ? binding : null;
      status('正在保存到 OneDrive…');
      const client = await service();
      if (!await connect()) return;
      if (current() !== draftId || generation !== operation) return;
      const rootId = existing?.rootId || (await client.list()).rootId;
      if (current() !== draftId || generation !== operation) return;
      const files = await import('./editor-files.mjs');
      const options = window.mdWorkspaceHosts?.query('#options') || document.querySelector('#options');
      let name = await filenameDialog(files.markdownDownloadName(text, new Date(), options?.elements.type?.value || ''));
      if (current() !== draftId || generation !== operation) return;
      if (!name) { status(''); return; }
      if (!/\.(md|markdown|mdown)$/i.test(name)) name += '.md';
      const result = await client.save({ rootId, name, text });
      if (current() !== draftId || generation !== operation) return;
      binding = { id: result.id, eTag: result.eTag, name: result.name || name, rootId, draftId, savedText: text };
      status(window.mdEditor.getValue() === text ? 'OneDrive · 已保存' : 'OneDrive · 有未保存更改');
    });
  }
  document.addEventListener('md-editor-change', () => {
    if (binding?.draftId === current()) status(window.mdEditor?.getValue() === binding.savedText ? 'OneDrive · 已保存' : 'OneDrive · 有未保存更改');
    else status('');
  });
  return { open, save, logout };
}
