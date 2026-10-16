import { openDraftStore, DRAFT_LIST_LIMIT, DraftConflict } from './draft-store.mjs';

const signature = record => JSON.stringify([record.md, record.opts, record.templateId, record.previewType, record.filename]);
const newId = () => crypto.randomUUID();
const menuFontSize = () => {
  const editor = document.querySelector('.cm-content, #markdown');
  return Math.min(12, editor ? parseFloat(getComputedStyle(editor).fontSize) || 13 : 13);
};

function confirmDelete(message) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'template-confirm md-draft-confirm';
    dialog.style.fontSize = menuFontSize() + 'px';
    dialog.setAttribute('aria-label', message);
    const text = document.createElement('p');
    text.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'template-confirm-actions';
    for (const [label, accepted] of [['取消', false], ['删除', true]]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.className = accepted ? 'primary' : 'template-confirm-cancel';
      button.addEventListener('click', () => finish(accepted));
      actions.append(button);
    }
    const finish = accepted => { dialog.close(); dialog.remove(); resolve(accepted); };
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    dialog.append(text, actions);
    document.body.append(dialog);
    dialog.showModal();
    actions.firstElementChild.focus();
  });
}

export async function initializeLocalDrafts({ capture, apply, mirror, legacy, report }) {
  const store = await openDraftStore();
  let active = null, filename = '', savedSignature = '', timer, tail = Promise.resolve(), menu, trigger, input;
  let pending = false;
  let channel;
  try { channel = new BroadcastChannel('md2pdf-drafts'); } catch { /* 旧浏览器在重新激活页面时复核。 */ }
  const notify = () => channel?.postMessage({ changed: true });
  const enqueue = action => { const result = tail.then(action); tail = result.catch(() => {}); return result; };
  const snapshot = () => ({ ...capture(), filename });
  function state(message, error = false) { report(message, error); }
  function syncMirror() { mirror({ ...snapshot(), id: active?.id, version: active?.version, dirty: pending, blank: !active && !capture().md.trim() }); }
  function adopt(record) {
    active = record || null;
    filename = record?.filename || '';
    savedSignature = record ? signature(record) : '';
    pending = !!record && signature(snapshot()) !== savedSignature;
    syncMirror();
    state(pending ? '正在保存草稿…' : record ? '草稿已保存到此浏览器' : '');
  }
  async function saveNow() {
    clearTimeout(timer);
    const data = snapshot();
    if (!active && !data.md.trim()) { pending = false; syncMirror(); state(''); return; }
    if (active && signature(data) === savedSignature) { pending = false; syncMirror(); state('草稿已保存到此浏览器'); return; }
    try {
      const saved = await store.save({ ...data, id: active?.id || newId(), version: active?.version || 0 });
      adopt(saved);
      notify();
      if (pending) await saveNow();
    } catch (error) {
      pending = true;
      state(error instanceof DraftConflict ? error.message : '草稿未保存：浏览器存储不可用或空间不足。请下载 Markdown 后再离开。', true);
      throw error;
    }
  }
  function schedule() {
    pending = active ? signature(snapshot()) !== savedSignature : !!capture().md.trim();
    syncMirror();
    if (!pending) return;
    state('正在保存草稿…');
    clearTimeout(timer);
    timer = setTimeout(() => enqueue(saveNow).catch(() => {}), 350);
  }
  function reset() {
    clearTimeout(timer);
    active = null;
    filename = '';
    apply({ md: '', opts: {}, templateId: '', previewType: '' });
    adopt(null);
  }
  async function replace(record) {
    return enqueue(async () => {
      await saveNow();
      const emptyOptions = Object.fromEntries(Object.keys(capture().opts).map(key => [key, '']));
      const saved = await store.save({ ...record, opts: { ...emptyOptions, ...record.opts },
        filename: record.filename || '', id: newId(), version: 0 });
      apply(saved);
      adopt(saved);
      notify();
      if (pending) schedule();
    });
  }
  async function restore(id) {
    return enqueue(async () => {
      await saveNow();
      const record = await store.get(id);
      if (!record) throw new Error('此草稿已被删除，请重新打开列表。');
      active = record;
      filename = record.filename || '';
      apply(record);
      adopt(record);
      await store.activate(id);
      closeMenu(true);
    });
  }
  async function remove(records, allVisible = false) {
    const current = records.find(record => record.id === active?.id);
    const message = allVisible ? '当前列表中的全部草稿，确认删除？'
      : current ? `当前正在编辑“${current.title}”，确认删除？` : `确认删除草稿“${records[0].title}”？`;
    if (!await confirmDelete(message)) return;
    await enqueue(async () => {
      clearTimeout(timer);
      // 确认期间当前文档可能自动保存过；采用本页最新版本，其他页面的更新仍需事务核对。
      const targets = records.map(record => record.id === active?.id ? active : record);
      await store.remove(targets);
      if (current) reset();
      else if (pending) await saveNow();
      notify();
      await renderMenu();
      (menu.querySelector('[data-draft-open]') || menu.querySelector('button'))?.focus();
    });
  }
  function closeMenu(focus = false) {
    if (menu) menu.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
    if (focus) trigger?.focus();
  }
  const button = (text, action) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = text;
    node.addEventListener('click', () => Promise.resolve().then(action).catch(error => state(error.message, true)));
    return node;
  };
  function positionMenu() {
    if (!menu || menu.hidden) return;
    const bounds = trigger.getBoundingClientRect();
    const view = window.visualViewport;
    const left = view?.offsetLeft || 0, top = view?.offsetTop || 0;
    const width = view?.width || innerWidth, height = view?.height || innerHeight;
    menu.style.maxHeight = Math.max(60, height - 16) + 'px';
    menu.style.fontSize = menuFontSize() + 'px';
    menu.style.width = Math.min(276, width - 16) + 'px';
    menu.style.left = Math.max(left + 8, Math.min(bounds.left, left + width - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(top + 8, Math.min(bounds.bottom + 4, top + height - menu.offsetHeight - 8)) + 'px';
  }
  async function renderMenu() {
    const records = await store.list();
    const visible = records.slice(0, DRAFT_LIST_LIMIT);
    menu.replaceChildren(button('从文件打开…', () => { closeMenu(); input.click(); }));
    const heading = document.createElement('div');
    heading.className = 'md-drafts-heading';
    heading.textContent = `已保存草稿 · ${records.length}`;
    menu.append(heading);
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.textContent = '暂无已保存草稿';
      menu.append(empty);
    }
    for (const record of visible) {
      const row = document.createElement('div');
      row.className = 'md-draft-row';
      const open = button('', () => restore(record.id));
      open.dataset.draftOpen = record.id;
      open.title = record.title;
      open.setAttribute('aria-label', record.title);
      if (record.id === active?.id) open.setAttribute('aria-current', 'true');
      const title = document.createElement('span');
      title.className = 'md-draft-title';
      title.textContent = record.title;
      const mark = document.createElement('span');
      mark.className = 'md-draft-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = record.id === active?.id ? '✓' : '';
      const time = document.createElement('small');
      time.textContent = new Date(record.savedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      open.append(mark, title, time);
      const del = button('×', () => remove([record]));
      del.className = 'md-draft-delete';
      del.setAttribute('aria-label', `删除草稿“${record.title}”`);
      del.title = `删除草稿“${record.title}”`;
      del.dataset.draftDelete = record.id;
      row.append(open, del);
      menu.append(row);
    }
    const clear = button('清除列表草稿', () => remove(visible, true));
    clear.className = 'md-drafts-clear';
    clear.disabled = !visible.length;
    menu.append(clear);
    positionMenu();
  }
  async function openMenu(anchor, fileInput) {
    if (menu && !menu.hidden) { closeMenu(true); return; }
    trigger = anchor;
    input = fileInput;
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'md-drafts-menu';
      menu.className = 'md-drafts-menu';
      menu.setAttribute('role', 'dialog');
      menu.setAttribute('aria-label', '打开 Markdown');
      document.body.append(menu);
      menu.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
          const index = buttons.indexOf(document.activeElement);
          buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }
      });
      document.addEventListener('click', event => { if (!menu.contains(event.target) && !trigger.contains(event.target)) closeMenu(); });
      document.addEventListener('focusin', event => { if (!menu.contains(event.target) && !trigger.contains(event.target) && !document.querySelector('dialog[open]')) closeMenu(); });
      window.addEventListener('resize', positionMenu);
      window.visualViewport?.addEventListener('resize', positionMenu);
      window.visualViewport?.addEventListener('scroll', positionMenu);
      window.addEventListener('scroll', positionMenu, true);
      menu.addEventListener('pointerleave', event => {
        if (event.pointerType === 'mouse' && !document.querySelector('dialog[open]')) closeMenu();
      });
    }
    menu.hidden = false;
    trigger.setAttribute('aria-controls', menu.id);
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'true');
    try { await enqueue(saveNow); } catch { /* 保留文件下载及草稿管理入口。 */ }
    await renderMenu();
    menu.querySelector('button')?.focus();
  }
  async function reconcile() {
    await enqueue(async () => {
      if (active) {
        const current = await store.get(active.id);
        if (!current) reset();
        else if (current.version !== active.version) {
          if (signature(snapshot()) === savedSignature) { apply(current); adopt(current); }
          else state(new DraftConflict().message, true);
        }
      }
      if (menu && !menu.hidden) await renderMenu();
    });
  }
  if (channel) channel.onmessage = () => reconcile().catch(error => state(error.message, true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') enqueue(saveNow).catch(() => {});
    else reconcile().catch(error => state(error.message, true));
  });
  window.addEventListener('beforeunload', event => { if (pending) { event.preventDefault(); event.returnValue = ''; } });

  let restored, blank = false;
  if (legacy?.id) {
    restored = await store.get(legacy.id);
    blank = !restored;
    if (restored && legacy.dirty && signature(legacy) !== signature(restored)) {
      // 会话镜像兜住页面在防抖保存前关闭的最后修改；有并发版本时另存，避免覆盖。
      restored = await store.save({ ...legacy,
        id: legacy.version === restored.version ? restored.id : newId(),
        version: legacy.version === restored.version ? restored.version : 0 });
    }
  } else if (legacy?.blank) blank = true;
  else if (legacy?.md?.trim()) {
    const records = await store.list();
    restored = records.find(record => record.md === legacy.md && JSON.stringify(record.opts) === JSON.stringify(legacy.opts));
    restored ||= await store.save({ ...legacy, id: newId(), version: 0 });
  } else {
    const id = await store.active();
    if (id) restored = await store.get(id);
    blank = id === null || !!id && !restored;
  }
  // 此时应用尚未应用恢复内容，不写会话镜像，避免把空编辑器覆盖到已保存文档。
  active = restored || null;
  filename = restored?.filename || '';
  savedSignature = restored ? signature(restored) : '';
  return { restored, blank, schedule, flush: () => enqueue(saveNow), openMenu,
    openFile: (md, name) => replace({ md, filename: name, opts: {}, templateId: '', previewType: '' }),
    createBlank: () => enqueue(async () => { await saveNow(); await store.activate(null); reset(); }),
    replace, store, current: () => active?.id || null };
}
