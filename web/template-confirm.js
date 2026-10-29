/* Shared template replacement confirmation on both editor and template pages. */
(() => {
  let pending;
  window.mdConfirmTemplate = () => {
    if (pending) return pending;
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'template-confirm';
    dialog.setAttribute('aria-labelledby', 'template-confirm-title');
    const title = document.createElement('h2');
    title.id = 'template-confirm-title';
    title.textContent = '从模板创建';
    const message = document.createElement('p');
    message.textContent = '从模板创建会替换当前文档内容，是否继续？';
    const actions = document.createElement('div');
    actions.className = 'template-confirm-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'template-confirm-cancel';
    cancel.textContent = '取消';
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'primary';
    accept.textContent = '创建并替换';
    actions.append(cancel, accept);
    dialog.append(title, message, actions);
    document.body.append(dialog);
    pending = new Promise(resolve => {
      const finish = accepted => {
        dialog.close();
        dialog.remove();
        pending = null;
        if (previousFocus?.isConnected) previousFocus.focus();
        resolve(accepted);
      };
      cancel.addEventListener('click', () => finish(false));
      accept.addEventListener('click', () => finish(true));
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
      dialog.showModal();
      cancel.focus();
    });
    return pending;
  };
})();

// Use the existing application dialog style for actionable font failures.
window.mdShowFontError = fonts => {
  if (document.querySelector('.font-error-dialog')) return;
  const previous = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'template-confirm font-error-dialog';
  dialog.setAttribute('aria-label', '字体未能加载');
  const message = document.createElement('p');
  message.textContent = '未能加载字体：' + fonts.join('、') + '。';
  const help = document.createElement('p');
  help.append('请查看');
  const link = document.createElement('a');
  link.href = './gb-fonts.html';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = '字体配置说明';
  help.append(link, '。');
  const actions = document.createElement('div');
  actions.className = 'template-confirm-actions';
  const close = document.createElement('button');
  close.className = 'primary';
  close.textContent = '知道了';
  actions.append(close);
  dialog.append(message, help, actions);
  document.body.append(dialog);
  const finish = () => { dialog.close(); dialog.remove(); if (previous?.isConnected) previous.focus(); };
  close.addEventListener('click', finish);
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); });
  dialog.showModal();
  close.focus();
};
