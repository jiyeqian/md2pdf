import test from 'node:test';
import assert from 'node:assert/strict';
import { createOneDriveAuth } from '../web/onedrive-auth.mjs';

test('unconfigured deployment fails locally without loading the login library', async () => {
  const calls = [];
  await assert.rejects(createOneDriveAuth({ base: new URL('https://example.test/nested/'), fetch: async (url, options) => {
    calls.push([String(url), options]);
    return new Response('{"clientId":"","redirectUri":""}', { status: 200 });
  } }), /尚未配置/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://example.test/nested/onedrive-config.json');
  assert.equal(calls[0][1].cache, 'no-store');
});

test('rejects mismatched callback and insecure contexts before loading MSAL', async () => {
  const oldLocation = globalThis.location, oldSecure = globalThis.isSecureContext;
  try {
    globalThis.location = { origin:'https://example.test' };
    globalThis.isSecureContext = true;
    const config = redirectUri => async () => new Response(JSON.stringify({clientId:'test',redirectUri}));
    await assert.rejects(createOneDriveAuth({base:new URL('https://example.test/nested/'),fetch:config('https://other.test/onedrive-callback.html')}), /不匹配/);
    globalThis.location = { origin:'http://127.0.0.1:3000' };
    await assert.rejects(createOneDriveAuth({base:new URL('http://127.0.0.1:3000/'),fetch:config('http://localhost:3000/onedrive-callback.html')}), /不匹配/);
    globalThis.location = { origin:'https://example.test' };
    globalThis.isSecureContext = false;
    await assert.rejects(createOneDriveAuth({base:new URL('https://example.test/nested/'),fetch:config('https://example.test/nested/onedrive-callback.html')}), /HTTPS/);
  } finally { globalThis.location = oldLocation; globalThis.isSecureContext = oldSecure; }
});

test('login library load failure gives an actionable error', async () => {
  const oldLocation = globalThis.location, oldSecure = globalThis.isSecureContext, oldDocument = globalThis.document;
  try {
    globalThis.location = { origin:'https://example.test' }; globalThis.isSecureContext = true;
    globalThis.document = { createElement: () => ({}), head: { append: script => script.onerror() } };
    await assert.rejects(createOneDriveAuth({base:new URL('https://example.test/'),fetch:async()=>new Response(JSON.stringify({clientId:'test',redirectUri:'https://example.test/onedrive-callback.html'}))}), /无法加载/);
  } finally { globalThis.location = oldLocation; globalThis.isSecureContext = oldSecure; globalThis.document = oldDocument; }
});

test('background token requests never open a popup and late login cannot reconnect', async () => {
  const oldLocation=globalThis.location, oldSecure=globalThis.isSecureContext, oldMsal=globalThis.msal;
  let popups=0, release, clears=0;
  try {
    globalThis.location={origin:'https://example.test'}; globalThis.isSecureContext=true;
    globalThis.msal={InteractionRequiredAuthError:class extends Error {},PublicClientApplication:class {
      async initialize() {} acquireTokenPopup() { popups++; return new Promise(resolve=>{release=resolve;}); }
      async acquireTokenSilent() { throw new globalThis.msal.InteractionRequiredAuthError(); }
      async clearCache() { clears++; }
    }};
    const auth=await createOneDriveAuth({base:new URL('https://example.test/'),fetch:async()=>new Response(JSON.stringify({clientId:'test',redirectUri:'https://example.test/onedrive-callback.html'}))});
    await assert.rejects(auth.token(),/请先连接/); assert.equal(popups,0);
    const pending=auth.connect(); await auth.logout(); release({account:{username:'test'},accessToken:'token'});
    await assert.rejects(pending,/取消/); assert.equal(auth.connected(),false); assert.equal(clears,2);
    const connected=auth.connect(); release({account:{username:'test'},accessToken:'token'}); await connected;
    await assert.rejects(auth.token(),/已过期/); assert.equal(auth.connected(),false); assert.equal(popups,2);
  } finally { globalThis.location=oldLocation; globalThis.isSecureContext=oldSecure; globalThis.msal=oldMsal; }
});
