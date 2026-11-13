const scopes = ['Files.ReadWrite.AppFolder'];

export async function createOneDriveAuth({ base = new URL('.', import.meta.url), fetch: request = globalThis.fetch } = {}) {
  let config;
  try {
    const response = await request(new URL('onedrive-config.json', base), { cache: 'no-store' });
    if (!response.ok) throw new Error();
    config = await response.json();
  } catch { throw new Error('OneDrive 尚未配置，请联系部署者设置公开客户端 ID 和回调地址。'); }
  if (!config.clientId || !config.redirectUri) throw new Error('OneDrive 尚未配置，请联系部署者设置公开客户端 ID 和回调地址。');
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
  let account = null;
  return {
    account: () => account?.username || '',
    connected: () => !!account,
    async connect() { const result = await client.acquireTokenPopup({ scopes }); account = result.account; return result.accessToken; },
    async token() {
      if (account) {
        try { return (await client.acquireTokenSilent({ scopes, account })).accessToken; }
        catch (error) { if (!(error instanceof globalThis.msal.InteractionRequiredAuthError)) throw error; account = null; throw new Error('OneDrive 登录已过期，请重新连接；本地草稿仍保留。'); }
      }
      const result = await client.acquireTokenPopup({ scopes, ...(account ? { account } : {}) });
      account = result.account;
      return result.accessToken;
    },
    async logout() { account = null; await client.clearCache(); }
  };
}
