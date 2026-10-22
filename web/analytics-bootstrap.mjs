import { initAnalytics } from './analytics.mjs';
import { appFetch } from './runtime-request.mjs';
let lastReady;
window.addEventListener('md2pdf-offline-ready', event => {
  const ready = event.detail?.ready;
  if (typeof ready !== 'boolean' || ready === lastReady) return;
  lastReady = ready;
  window.md2pdfAnalytics?.track('offline_ready', { ready });
});

try {
  const [configResponse, versionResponse] = await Promise.all([
    fetch(new URL('./analytics-config.json', import.meta.url), { credentials: 'omit' }),
    appFetch('/api/version'),
  ]);
  if (!configResponse.ok || !versionResponse.ok) throw new Error('统计配置不可用');
  const [config, info] = await Promise.all([configResponse.json(), versionResponse.json()]);
  window.md2pdfAnalytics = initAnalytics({ ...config, version: info.version, deployment: info.deployment === 'static' ? 'static' : 'server' });
} catch {
  // 统计或版本配置失败不能阻断编辑器；隐私入口仍可使用。
  window.md2pdfAnalytics = initAnalytics({ enabled: false });
}
