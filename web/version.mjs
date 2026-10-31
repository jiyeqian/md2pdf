import { appFetch } from './runtime-request.mjs';
const node = document.querySelector('#app-version');
try {
  const response = await appFetch('/api/version');
  if (!response.ok) throw new Error('版本信息不可用');
  const info = await response.json();
  node.textContent = `${info.deployment === 'static' ? '静态版' : '服务器版'} v${info.version}`;
  node.title = `${info.deployment === 'static' ? '静态部署' : 'Node.js 服务端'}${info.commit ? ' · ' + info.commit : ''}`;
  node.hidden = false;
} catch { /* 版本加载失败不影响编辑与草稿恢复。 */ }
