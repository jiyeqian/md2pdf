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
    title.textContent = '使用模板';
    const message = document.createElement('p');
    message.textContent = '使用该模板会替换编辑器中的内容，是否继续？';
    const actions = document.createElement('div');
    actions.className = 'template-confirm-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'template-confirm-cancel';
    cancel.textContent = '取消';
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'primary';
    accept.textContent = '使用模板';
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
