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
  message.textContent = '未能加载字体：' + fonts.join('、') + '。当前为替代字体，输出 PDF 的分页和版式可能不同。';
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
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'template-confirm-cancel';
  cancel.textContent = '取消';
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'primary';
  download.textContent = '下载';
  actions.append(cancel, download);
  dialog.append(message, help, actions);
  document.body.append(dialog);
  return new Promise(resolve => {
    const finish = accepted => { dialog.close(); dialog.remove(); if (previous?.isConnected) previous.focus(); resolve(accepted); };
    cancel.addEventListener('click', () => finish(false));
    download.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    dialog.showModal();
    download.focus();
  });
};

// A failed strict attempt never silently opts the document into fallback export.
window.mdExportWithFontConsent = async action => {
  try { return await action(false); }
  catch (error) {
    if (error.code !== 'GB_FONT_MISSING') throw error;
    if (!await window.mdShowFontError(error.fonts)) throw Object.assign(new Error('已取消 PDF 下载。'), {code:'EXPORT_CANCELLED'});
    return action(true);
  }
};
