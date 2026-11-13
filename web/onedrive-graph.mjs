const GRAPH = 'https://graph.microsoft.com/v1.0';

export class OneDriveError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

// Access tokens are sent only to Graph; upload and download URLs are preauthenticated.
export function createOneDriveGraph({ token, fetch: request = globalThis.fetch }) {
  async function graph(path, options = {}) {
    const accessToken = await token();
    const response = await request(GRAPH + path, { ...options, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { ...options.headers, Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new OneDriveError(response.status === 409 || response.status === 412 ? '云端文件已更改或同名文件已存在，请另存。' : `OneDrive 请求失败（${response.status}）。`, response.status);
    return response.json();
  }
  function preauthenticatedUrl(value) {
    let url;
    try { url = new URL(value); } catch { throw new OneDriveError('OneDrive 返回了无效的传输地址。'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new OneDriveError('OneDrive 返回了不安全的传输地址。');
    return url.href;
  }
  async function transfer(url, options) {
    const response = await request(preauthenticatedUrl(url), { ...options, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new OneDriveError(response.status === 409 || response.status === 412 ? '云端文件已更改或同名文件已存在，请另存。' : `OneDrive 传输失败（${response.status}）。`, response.status);
    return response;
  }
  const idPath = id => '/me/drive/items/' + encodeURIComponent(id);
  return {
    async list() {
      const root = await graph('/me/drive/special/approot?$select=id');
      let path = idPath(root.id) + '/children?$select=id,name,eTag,file&$top=200';
      const items = [];
      let pages = 0;
      do {
        if (++pages > 100) throw new OneDriveError('云端文件列表过长，请整理应用文件夹。');
        const result = await graph(path);
        items.push(...result.value.filter(item => item.file && /\.(md|markdown|mdown)$/i.test(item.name)));
        if (result['@odata.nextLink']) {
          const next = new URL(result['@odata.nextLink']);
          if (next.origin !== 'https://graph.microsoft.com' || !next.pathname.startsWith('/v1.0/')) throw new OneDriveError('OneDrive 返回了无效的分页地址。');
          path = next.pathname.slice('/v1.0'.length) + next.search;
        } else path = '';
      } while (path);
      return { rootId: root.id, items };
    },
    async open(id) {
      const item = await graph(idPath(id) + '?$select=id,name,eTag,@microsoft.graph.downloadUrl');
      if (!item.id || !item.eTag || !item['@microsoft.graph.downloadUrl']) throw new OneDriveError('无法取得云端文件版本。');
      const response = await transfer(item['@microsoft.graph.downloadUrl'], {});
      return { id: item.id, name: item.name, eTag: item.eTag, text: (await response.text()).replace(/^\uFEFF/, '') };
    },
    async save({ id, eTag, rootId, name, text }) {
      const bytes = new TextEncoder().encode(text);
      if (!bytes.length) throw new OneDriveError('暂不支持保存空文件；本地草稿未受影响。');
      if (id) throw new OneDriveError('暂不能安全覆盖已有云端文件，请选择另存；本地草稿仍保留。');
      if (!id && (!rootId || !name || name !== name.trim() || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[.]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))) throw new OneDriveError('请输入有效的文件名。');
      const path = id ? idPath(id) : idPath(rootId) + ':/' + encodeURIComponent(name) + ':';
      const session = await graph(path + '/createUploadSession', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(id ? { 'If-Match': eTag } : {}) },
        body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'fail', ...(!id ? { name } : {}) }, deferCommit: true })
      });
      const uploadUrl = preauthenticatedUrl(session.uploadUrl);
      try {
      // All non-final fragments are multiples of 320 KiB.
      const chunkSize = 10 * 320 * 1024;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const end = Math.min(offset + chunkSize, bytes.length);
        await transfer(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${offset}-${end - 1}/${bytes.length}` }, body: bytes.slice(offset, end) });
      }
      // Personal OneDrive completes deferred uploads through its parent item.
      const commitPath = idPath(rootId);
      const result = await graph(commitPath, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(id ? { 'If-Match': eTag } : {}) }, body: JSON.stringify({ name, '@microsoft.graph.conflictBehavior': 'fail', '@microsoft.graph.sourceUrl': uploadUrl }) });
      if (!result.id || !result.eTag) throw new OneDriveError('保存结果缺少版本信息，请重新打开云端文件确认。');
      return result;
      } catch (error) {
        try { await transfer(uploadUrl, { method: 'DELETE' }); } catch { /* Session expires even if cleanup fails. */ }
        throw error;
      }
    }
  };
}
