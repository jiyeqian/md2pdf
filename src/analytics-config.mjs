import { readFileSync } from 'node:fs';

export function analyticsConfig(env = process.env) {
  const config = JSON.parse(readFileSync(new URL('../web/analytics-config.json', import.meta.url), 'utf8'));
  const endpoint = env.MD2PDF_ANALYTICS_ENDPOINT ?? config.endpoint;
  let url;
  try { url = new URL(endpoint); } catch { /* 尚未配置接收服务时保持关闭。 */ }
  const valid = url && url.protocol === 'https:' && !url.username && !url.password
    && !url.search && !url.hash && url.pathname === '/events';
  const enabled = env.MD2PDF_ANALYTICS_ENABLED === undefined ? config.enabled === true : env.MD2PDF_ANALYTICS_ENABLED === '1';
  return { enabled: Boolean(enabled && valid), endpoint: valid ? url.href : '' };
}
