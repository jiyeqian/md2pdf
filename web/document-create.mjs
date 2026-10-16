let menu, trigger;
function close(focus = false) {
  if (menu) menu.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
  if (focus) trigger?.focus();
}
function position() {
  if (!menu || menu.hidden) return;
  const rect = trigger.getBoundingClientRect(), view = window.visualViewport;
  const left = view?.offsetLeft || 0, top = view?.offsetTop || 0;
  const width = view?.width || innerWidth, height = view?.height || innerHeight;
  const editor = document.querySelector('.cm-content, #markdown');
  menu.style.fontSize = Math.min(12, parseFloat(getComputedStyle(editor).fontSize) || 13) + 'px';
  menu.style.width = Math.min(276, width - 16) + 'px';
  menu.style.left = Math.max(left + 8, Math.min(rect.left, left + width - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(top + 8, Math.min(rect.bottom + 4, top + height - menu.offsetHeight - 8)) + 'px';
}
export function openCreateMenu(anchor) {
  if (menu && !menu.hidden) { close(true); return; }
  trigger = anchor;
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'md-create-menu';
    menu.className = 'md-drafts-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', '创建 Markdown');
    const blank = document.createElement('button');
    blank.type = 'button';
    blank.textContent = '创建空文件';
    blank.addEventListener('click', async () => {
      try { await window.mdCreateBlank(); close(); }
      catch { /* 保存失败提示由草稿管理器保留，当前文档不被替换。 */ }
    });
    const template = document.createElement('a');
    template.id = 'browse-examples';
    template.href = '/';
    template.dataset.viewLink = 'templates';
    template.textContent = '从模板创建';
    template.addEventListener('click', () => close());
    menu.append(blank, template);
    document.body.append(menu);
    document.addEventListener('click', event => { if (!menu.contains(event.target) && !trigger.contains(event.target)) close(); });
    document.addEventListener('focusin', event => { if (!menu.contains(event.target) && !trigger.contains(event.target)) close(); });
    menu.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') close(); });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        (document.activeElement === blank ? template : blank).focus();
      }
    });
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
  }
  const drafts = document.querySelector('#md-drafts-menu');
  if (drafts) drafts.hidden = true;
  menu.hidden = false;
  trigger.setAttribute('aria-controls', menu.id);
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'true');
  position();
  menu.querySelector('button').focus();
}
