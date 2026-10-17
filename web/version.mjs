import { appFetch } from './runtime-request.mjs';
const button = document.querySelector('#app-version');
try {
  const response = await appFetch('/api/version');
  if (!response.ok) throw new Error('版本信息不可用');
  const info = await response.json();
  button.textContent = 'v' + info.version;
  button.hidden = false;
  button.addEventListener('click', () => {
    const dialog = document.createElement('dialog');
    dialog.className = 'template-confirm';
    dialog.setAttribute('aria-label', '版本信息');
    const heading = document.createElement('h2');
    heading.textContent = 'md2pdf v' + info.version;
    const details = document.createElement('p');
    details.textContent = `部署方式：${info.deployment === 'static' ? '静态部署' : 'Node.js 服务端'}${info.commit ? ' · 提交：' + info.commit : ''}`;
    const actions = document.createElement('div');
    actions.className = 'template-confirm-actions';
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'template-confirm-cancel'; close.textContent = '关闭';
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove(), {once:true});
    actions.append(close); dialog.append(heading, details, actions);
    document.body.append(dialog); dialog.showModal();
  });
} catch { /* 版本加载失败不影响编辑与草稿恢复。 */ }
