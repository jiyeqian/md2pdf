import { appFetch } from './runtime-request.mjs';
let menu, trigger, catalogPromise, leaveTimer;
function cancelLeave() { clearTimeout(leaveTimer); }
function scheduleLeave(event) { if (event?.pointerType && event.pointerType !== 'mouse') return; cancelLeave(); leaveTimer = setTimeout(() => close(), 300); }
document.addEventListener('md-panel-host-change', () => close());
const names = { general: '通用文档', paper: '学术论文', gb: '国家标准' };
function close(focus = false) {
  cancelLeave();
  trigger?.removeEventListener('pointerleave', scheduleLeave);
  trigger?.removeEventListener('pointerenter', cancelLeave);
  if (menu) menu.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
  if (focus) trigger?.focus();
}
function position() {
  if (!menu || menu.hidden) return;
  const document = menu.ownerDocument, host = document.defaultView;
  const rect = trigger.getBoundingClientRect(), view = host.visualViewport;
  const left = view?.offsetLeft || 0, top = view?.offsetTop || 0;
  const width = view?.width || host.innerWidth, height = view?.height || host.innerHeight;
  const editor = document.querySelector('.cm-content, #markdown');
  menu.style.fontSize = Math.min(12, parseFloat(getComputedStyle(editor).fontSize) || 13) + 'px';
  menu.style.width = 'max-content';
  menu.style.minWidth = '0';
  menu.style.maxWidth = Math.min(220, width - 16) + 'px';
  if (trigger.closest('.md-focus-popup') && window.mdPositionToolbarSubmenu) { window.mdPositionToolbarSubmenu(trigger, menu, false); return; }
  menu.style.left = Math.max(left + 8, Math.min(rect.left, left + width - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(top + 8, Math.min(rect.bottom + 4, top + height - menu.offsetHeight - 8)) + 'px';
}
export async function openCreateMenu(anchor) {
  if (menu && !menu.hidden) { close(true); return; }
  trigger = anchor;
  const document = anchor.ownerDocument;
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'md-create-menu';
    menu.className = 'md-drafts-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', '创建 Markdown');
    menu.tabIndex = -1;
    const blank = document.createElement('button');
    blank.type = 'button';
    blank.textContent = '创建空文件';
    blank.setAttribute('aria-label', '创建空文件');
    blank.addEventListener('click', async () => {
      try { await window.mdCreateBlank(); close(); window.mdEditor?.focus(); }
      catch (error) {
        const status = window.mdWorkspaceHosts?.query('#status') || document.querySelector('#status');
        if (status) { status.textContent = error.message || '创建失败，请重试。'; status.dataset.error = 'true'; }
      }
    });
    menu.append(blank);
    const heading = document.createElement('div');
    heading.className = 'md-drafts-heading';
    heading.textContent = '从模板创建';
    menu.append(heading);
    const template = document.createElement('a');
    template.id = 'browse-examples';
    template.href = window.__MD2PDF_STATIC_BASE__ || '/';
    template.dataset.viewLink = 'templates';
    template.className = 'md-drafts-browse';
    template.textContent = '更多模板';
    template.addEventListener('click', event => {
      close();
      if (menu.ownerDocument !== window.document) {
        event.preventDefault(); window.mdWindowMode?.exit();
        window.document.querySelector('#examples-link-top')?.click();
      }
    });
    menu.append(template);
    document.body.append(menu);
    const on = (type, handler, options) => window.mdWorkspaceHosts ? window.mdWorkspaceHosts.on(type, handler, options) : document.addEventListener(type, handler, options);
    on('click', event => { if (!menu.contains(event.target) && !trigger.contains(event.target)) close(); });
    on('focusin', event => { if (!menu.contains(event.target) && !trigger.contains(event.target)) close(); });
    menu.addEventListener('pointerleave', scheduleLeave);
    menu.addEventListener('pointerenter', cancelLeave);
    menu.addEventListener('md-toolbar-dismiss', () => close());
    on('md-preview-pointer-enter', () => { if (!menu.hidden) scheduleLeave(); });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const items = [...menu.querySelectorAll('button:not(:disabled), a')];
        const index = items.indexOf(menu.ownerDocument.activeElement);
        items[index < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    });
    on('resize', position);
    on('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
  }
  if (menu.ownerDocument !== document) document.body.appendChild(document.adoptNode(menu));
  const drafts = document.querySelector('#md-drafts-menu');
  if (drafts) drafts.hidden = true;
  menu.hidden = false;
  trigger.addEventListener('pointerleave', scheduleLeave);
  trigger.addEventListener('pointerenter', cancelLeave);
  trigger.setAttribute('aria-controls', menu.id);
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'true');
  position();
  const browse = menu.querySelector('a');
  if (!menu.querySelector('[data-template-id]')) {
    browse.textContent = '正在加载模板…';
    try {
      catalogPromise ||= appFetch('/api/examples').then(async response => {
        if (!response.ok) throw new Error('模板加载失败，请重试。');
        return (await response.json()).examples;
      }).catch(error => { catalogPromise = null; throw error; });
      const catalog = await catalogPromise;
      for (const id of ['general', 'paper', 'gb']) {
        const meta = catalog.find(entry => entry.id === id);
        if (!meta || menu.querySelector('[data-template-id="' + id + '"]')) continue;
        const item = document.createElement('button');
        item.type = 'button';
        item.dataset.templateId = id;
        item.textContent = names[id];
        item.title = meta.title || names[id];
        item.addEventListener('click', async () => {
          const buttons = [...menu.querySelectorAll('button')];
          buttons.forEach(button => { button.disabled = true; });
          try { await window.mdCreateFromTemplate(meta); close(); window.mdEditor?.focus(); }
          catch (error) {
            const status = window.mdWorkspaceHosts?.query('#status') || document.querySelector('#status');
            if (status) { status.textContent = error.message || '模板创建失败，请重试。'; status.dataset.error = 'true'; }
          } finally { buttons.forEach(button => { button.disabled = false; }); }
        });
        menu.insertBefore(item, browse);
      }
    } catch (error) {
      const status = window.mdWorkspaceHosts?.query('#status') || document.querySelector('#status');
      if (status) { status.textContent = error.message; status.dataset.error = 'true'; }
    } finally { browse.textContent = '更多模板'; }
  }
  position();
  if (!menu.hidden) menu.focus({ preventScroll: true });
}
