export const ONEDRIVE_UNCONFIGURED = 'OneDrive 尚未配置，请参照「配置说明」完成设置。';
const scopes = ['Files.ReadWrite.AppFolder'];

export async function createOneDriveAuth({ base = new URL('.', import.meta.url), fetch: request = globalThis.fetch } = {}) {
  let config;
  try {
    const response = await request(new URL('onedrive-config.json', base), { cache: 'no-store' });
    if (!response.ok) throw new Error();
    config = await response.json();
  } catch { throw new Error(ONEDRIVE_UNCONFIGURED); }
  if (!config.clientId || !config.redirectUri) throw new Error(ONEDRIVE_UNCONFIGURED);
  const redirect = new URL(config.redirectUri, base);
  if (redirect.href !== new URL('onedrive-callback.html', base).href || redirect.origin !== location.origin) throw new Error('OneDrive 回调地址与当前部署地址不匹配。');
  if (!globalThis.isSecureContext) throw new Error('OneDrive 登录需要 HTTPS 或 localhost 安全上下文。');
  if (!globalThis.msal) await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('vendor/msal/msal-browser.min.js', base).href;
    script.onload = resolve;
    script.onerror = () => reject(new Error('无法加载 OneDrive 登录组件。'));
    document.head.append(script);
  });
  const client = new globalThis.msal.PublicClientApplication({
    auth: { clientId: config.clientId, authority: 'https://login.microsoftonline.com/consumers', redirectUri: redirect.href },
    cache: { cacheLocation: 'sessionStorage' },
    system: { telemetry: { client: { enableTelemetry: false } } }
  });
  await client.initialize();
  let account = null, generation = 0;
  return {
    account: () => account?.username || '',
    connected: () => !!account,
    async connect() {
      const started = generation;
      const result = await client.acquireTokenPopup({ scopes });
      if (started !== generation) { await client.clearCache(); throw new Error('连接已取消。'); }
      account = result.account; return result.accessToken;
    },
    async token() {
      if (account) {
        try { const started = generation; const result = await client.acquireTokenSilent({ scopes, account }); if (started !== generation) throw new Error('连接已取消。'); return result.accessToken; }
        catch (error) { if (!(error instanceof globalThis.msal.InteractionRequiredAuthError)) throw error; account = null; throw new Error('OneDrive 登录已过期，请重新连接；本地草稿仍保留。'); }
      }
      throw new Error('请先连接 OneDrive。');
    },
    async logout() { generation++; account = null; await client.clearCache(); }
  };
}
