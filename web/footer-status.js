// 两种部署共用底栏状态；高优先级操作不会被后台就绪消息覆盖。
(() => {
  const states = new Map();
  const labels = {
    preparing:'准备离线资源…', update:'保存并更新', retry:'重试离线准备',
    saveError:'保存失败请重试', checkError:'检查更新', unsupported:'不支持离线启动',
  };
  const priority = {saveError:6, retry:5, update:4, checkError:3, preparing:2, unsupported:1};
  let busy = false;
  function render() {
    const node = document.querySelector('#app-resource-status');
    if (!node) return;
    const current = [...states.values()].filter(entry=>entry.state!=='unsupported').sort((a,b)=>priority[b.state]-priority[a.state])[0];
    node.replaceChildren();
    const center = node.closest('.app-bottom-center');
    if(center)center.title=[...states.values()].some(entry=>entry.state==='unsupported')?labels.unsupported:'';
    if (!current) return;
    const control = document.createElement(current.action ? 'button' : 'span');
    if (current.action) {control.type='button';control.disabled=busy;}
    const icon = document.createElement('span');icon.className='resource-icon';icon.setAttribute('aria-hidden','true');
    icon.textContent = ['retry','saveError','unsupported'].includes(current.state) ? '!' : '↻';
    const text = document.createElement('span');text.textContent=labels[current.state];
    control.append(icon,text);node.append(control);
    if (current.action) control.addEventListener('click',async()=>{
      if(busy)return;
      busy=true;render();
      try { await current.action(); }
      catch { /* 保持原操作入口，便于再次尝试。 */ }
      finally {busy=false;render();}
    });
  }
  function set(group,state,action) {states.set(group,{state,action});render();}
  function clear(group) {states.delete(group);render();}
  async function saveAndUpdate(activate) {
    try {
      if(!window.mdDrafts)throw new Error('草稿尚未就绪');
      await window.mdDrafts.flush();
    } catch {set('save','saveError',()=>saveAndUpdate(activate));return;}
    clear('save');
    await activate();
  }
  window.mdFooterStatus={set,clear,saveAndUpdate};
})();
