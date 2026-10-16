let menu, trigger, catalogPromise;
const names = { general: '通用文档', paper: '学术论文', gb: '国家标准', skill: '技能文档' };
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
  menu.style.width = 'max-content';
  menu.style.minWidth = Math.min(128, width - 16) + 'px';
  menu.style.maxWidth = Math.min(220, width - 16) + 'px';
  menu.style.left = Math.max(left + 8, Math.min(rect.left, left + width - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(top + 8, Math.min(rect.bottom + 4, top + height - menu.offsetHeight - 8)) + 'px';
}
export async function openCreateMenu(anchor) {
  if (menu && !menu.hidden) { close(true); return; }
  trigger = anchor;
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'md-create-menu';
    menu.className = 'md-drafts-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', '从模板创建 Markdown');
    const template = document.createElement('a');
    template.id = 'browse-examples';
    template.href = '/';
    template.dataset.viewLink = 'templates';
    template.className = 'md-drafts-browse';
    template.textContent = '从模板库选择…';
    template.addEventListener('click', () => close());
    menu.append(template);
    document.body.append(menu);
    document.addEventListener('click', event => { if (!menu.contains(event.target) && !trigger.contains(event.target)) close(); });
    document.addEventListener('focusin', event => { if (!menu.contains(event.target) && !trigger.contains(event.target)) close(); });
    menu.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') close(); });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const items = [...menu.querySelectorAll('button:not(:disabled), a')];
        const index = items.indexOf(document.activeElement);
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
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
  const browse = menu.querySelector('a');
  if (!menu.querySelector('[data-template-id]')) {
    browse.textContent = '正在加载模板…';
    try {
      catalogPromise ||= fetch('/api/examples').then(async response => {
        if (!response.ok) throw new Error('模板加载失败，请重试。');
        return (await response.json()).examples;
      }).catch(error => { catalogPromise = null; throw error; });
      const catalog = await catalogPromise;
      for (const id of ['general', 'paper', 'gb', 'skill']) {
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
            const status = document.querySelector('#status');
            if (status) { status.textContent = error.message || '模板创建失败，请重试。'; status.dataset.error = 'true'; }
          } finally { buttons.forEach(button => { button.disabled = false; }); }
        });
        menu.insertBefore(item, browse);
      }
    } catch (error) {
      const status = document.querySelector('#status');
      if (status) { status.textContent = error.message; status.dataset.error = 'true'; }
    } finally { browse.textContent = '从模板库选择…'; }
  }
  position();
  if (!menu.hidden) (menu.querySelector('button') || browse).focus();
}
