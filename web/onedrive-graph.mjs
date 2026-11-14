const GRAPH = 'https://graph.microsoft.com/v1.0';
const ERROR_CODES = new Set(['invalidRequest', 'badRequest', 'generalException', 'accessDenied', 'itemNotFound', 'notSupported', 'nameAlreadyExists', 'resourceModified', 'quotaLimitReached', 'activityLimitReached', 'unauthenticated', 'invalidRange', 'serviceNotAvailable', 'tooManyRequests', 'invalidAuthenticationToken', 'invalidArgument', 'resourceNotFound']);
async function graphErrorCode(response) {
  try {
    const code = (await response.json())?.error?.code;
    return typeof code === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(code) && ERROR_CODES.has(code) ? code : '';
  } catch { return ''; }
}

export class OneDriveError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

// Access tokens are sent only to Graph; upload and download URLs are preauthenticated.
export function createOneDriveGraph({ token, fetch: request = globalThis.fetch }) {
  async function graph(path, options = {}, stage = 'OneDrive 请求') {
    const accessToken = await token();
    let response;
    try { response = await request(GRAPH + path, { ...options, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { ...options.headers, Authorization: `Bearer ${accessToken}` } }); }
    catch { throw new OneDriveError(`${stage}失败（网络或跨域请求受阻）。`); }
    if (!response.ok) {
      const code = await graphErrorCode(response);
      const reason = response.status === 409 || response.status === 412 ? '云端文件已更改或同名文件已存在，请另存。' : '';
      throw new OneDriveError(`${stage}失败（HTTP ${response.status}${code ? `；${code}` : ''}）。${reason}`, response.status);
    }
    return response.status === 204 ? null : response.json();
  }
  function preauthenticatedUrl(value) {
    let url;
    try { url = new URL(value); } catch { throw new OneDriveError('OneDrive 返回了无效的传输地址。'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new OneDriveError('OneDrive 返回了不安全的传输地址。');
    return url.href;
  }
  function downloadUrl(value) {
    const url = new URL(preauthenticatedUrl(value));
    if (url.port || !(url.hostname === 'my.microsoftpersonalcontent.com' || url.hostname.endsWith('.files.1drv.com'))) throw new OneDriveError(`下载地址不受支持（来源：${url.origin}）。`);
    return url;
  }
  async function transfer(url, options, { download = false } = {}) {
    const target = download ? downloadUrl(url) : new URL(preauthenticatedUrl(url));
    let response;
    try { response = await request(target.href, { ...options, credentials: 'omit', redirect: download ? 'follow' : 'error', cache: 'no-store', referrerPolicy: 'no-referrer' }); }
    catch { throw new OneDriveError(`${download ? '下载文件' : 'OneDrive 传输'}失败（网络、跨域或重定向受阻；来源：${target.origin}）。`); }
    if (!response.ok) throw new OneDriveError(response.status === 409 || response.status === 412 ? '云端文件已更改或同名文件已存在，请另存。' : `${download ? '下载文件' : 'OneDrive 传输'}失败（HTTP ${response.status}；来源：${target.origin}）。`, response.status);
    if (download && response.url) downloadUrl(response.url);
    return response;
  }
  const idPath = id => '/me/drive/items/' + encodeURIComponent(id);
  async function metadata(id) {
    return graph(idPath(id) + '?$select=id,name,eTag,folder,file,package,remoteItem,root,parentReference', {}, '确认云端项目');
  }
  async function withinFolder(id) {
    const root = await graph('/me/drive/special/approot?$select=id', {}, '读取应用文件夹');
    if (!root?.id || !id) throw new OneDriveError('无法确认应用文件夹，操作已取消。');
    const seen = new Set(); let current = id;
    for (let depth = 0; depth < 64; depth++) {
      if (seen.has(current)) break; seen.add(current);
      const item = await metadata(current);
      if (item.id !== current || !item.folder || item.file || item.package || item.remoteItem || (item.root && current !== root.id)) break;
      if (current === root.id) return root.id;
      if (typeof item.parentReference?.id !== 'string' || !item.parentReference.id) break;
      current = item.parentReference.id;
    }
    throw new OneDriveError('目标不在应用文件夹中或无法确认，操作已取消。');
  }
  return {
    async getRoot() {
      const root = await graph('/me/drive/special/approot?$select=id', {}, '读取应用文件夹');
      if (typeof root.id !== 'string' || !root.id) throw new OneDriveError('无法取得应用文件夹。');
      return root.id;
    },
    async listPage(rootId, nextLink = '') {
      let page = idPath(rootId) + '/children?$select=id,name,eTag,file,folder,size&$top=100';
      if (nextLink) {
        if (typeof nextLink !== 'string') throw new OneDriveError('OneDrive 返回了无效的分页地址。');
        let next;
        try { next = new URL(nextLink); } catch { throw new OneDriveError('OneDrive 返回了无效的分页地址。'); }
        if (next.origin !== 'https://graph.microsoft.com' || next.username || next.password || next.hash || !next.pathname.startsWith('/v1.0/')) throw new OneDriveError('OneDrive 返回了无效的分页地址。');
        page = next.pathname.slice('/v1.0'.length) + next.search;
      }
      const result = await graph(page, {}, '读取文件列表');
      if (!Array.isArray(result.value)) throw new OneDriveError('OneDrive 返回了无效的文件列表。');
      const next = result['@odata.nextLink'];
      if (next != null && typeof next !== 'string') throw new OneDriveError('OneDrive 返回了无效的分页地址。');
      return { items: result.value.filter(item => (item.folder || item.file && /\.(md|markdown|mdown)$/i.test(item.name)) && typeof item.id === 'string' && item.id && typeof item.name === 'string'), nextLink: next || '' };
    },
    async list() {
      const rootId = await this.getRoot();
      return { rootId, ...await this.listPage(rootId) };
    },
    async createFolder(parentId, name) {
      if (!parentId || !name || name !== name.trim() || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[.]$/.test(name)) throw new OneDriveError('请输入有效的文件夹名称。');
      await withinFolder(parentId);
      return graph(idPath(parentId) + '/children', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) }, '创建文件夹');
    },
    async deleteFolder(id, eTag, name) {
      if (!id || !eTag || !name) throw new OneDriveError('无法确认文件夹版本，未删除。');
      const item = await metadata(id);
      if (item.id !== id || item.name !== name || item.eTag !== eTag || !item.folder || item.file || item.package || item.remoteItem || item.root || !item.parentReference?.id) throw new OneDriveError('文件夹已变化或类型无法确认，未删除。');
      const root = await withinFolder(item.parentReference.id);
      if (id === root) throw new OneDriveError('不能删除应用文件夹。');
      return graph(idPath(id), { method: 'DELETE', headers: { 'If-Match': eTag } }, '移到回收站');
    },
    async deleteFile(id, eTag, name) {
      if (!id || !eTag || !name) throw new OneDriveError('无法确认云端文件版本，未删除。');
      const item = await metadata(id);
      if (item.id !== id || item.name !== name || item.eTag !== eTag || !item.file || item.folder || item.package || item.remoteItem || item.root || !item.parentReference?.id) throw new OneDriveError('云端文件已变化或类型无法确认，未删除。');
      const root = await withinFolder(item.parentReference.id);
      if (id === root) throw new OneDriveError('不能删除应用文件夹。');
      return graph(idPath(id), { method: 'DELETE', headers: { 'If-Match': eTag } }, '移到回收站');
    },
    async readContent(id) {
      let item = await graph(idPath(id) + '?$select=id,name,eTag,file,folder,package,size,@microsoft.graph.downloadUrl', {}, '获取文件信息');
      if (typeof item.id === 'string' && item.id && typeof item.eTag === 'string' && item.eTag && !item['@microsoft.graph.downloadUrl']) {
        const full = await graph(idPath(id), {}, '获取完整文件信息');
        if (full.id !== item.id || full.eTag !== item.eTag) throw new OneDriveError('获取文件信息失败：云端文件版本已变化，请重新打开。');
        item = full;
      }
      const missing = ['id', 'eTag', '@microsoft.graph.downloadUrl'].filter(key => typeof item[key] !== 'string' || !item[key]);
      if (missing.length) {
        const facets = ['file', 'folder', 'package'].filter(key => !!item[key]);
        const size = Number.isSafeInteger(item.size) && item.size >= 0 ? String(item.size) : '未知';
        throw new OneDriveError(`获取文件信息失败：缺少 ${missing.join('、')}；类型 ${facets.join('/') || '未知'}；大小 ${size} 字节。`);
      }
      const response = await transfer(item['@microsoft.graph.downloadUrl'], {}, { download: true });
      return { id: item.id, name: item.name, eTag: item.eTag, bytes: new Uint8Array(await response.arrayBuffer()) };
    },
    async open(id) {
      const file = await this.readContent(id);
      return { id: file.id, name: file.name, eTag: file.eTag, text: new TextDecoder().decode(file.bytes).replace(/^\uFEFF/, '') };
    },
    async findByName(parentId, name) {
      await withinFolder(parentId);
      const item = await graph(idPath(parentId) + ':/' + encodeURIComponent(name) + ':?$select=id,name,eTag,file,folder,package,remoteItem,root,parentReference', {}, '确认同名文件');
      if (!item.id || item.name !== name || !item.eTag || !item.file || item.folder || item.package || item.remoteItem || item.root || item.parentReference?.id !== parentId) throw new OneDriveError('无法确认同名文件，未覆盖。');
      return item;
    },
    async overwrite({ id, eTag, parentId, name, text }) {
      const bytes = new TextEncoder().encode(text);
      if (bytes.length > 10 * 1024 * 1024) throw new OneDriveError('文件超过条件覆盖的 10 MiB 上限，请保存副本。', 413);
      if (!id || !eTag || !parentId || !name) throw new OneDriveError('无法确认云端版本，请保存副本。');
      const item = await metadata(id);
      if (item.id !== id || item.name !== name || item.eTag !== eTag || !item.file || item.folder || item.package || item.remoteItem || item.root || item.parentReference?.id !== parentId) throw new OneDriveError('云端文件已更改或移动，请保存副本。', 412);
      await withinFolder(parentId);
      const result = await graph(idPath(id) + '/content', {method:'PUT',headers:{'Content-Type':'text/plain','If-Match':eTag},body:bytes}, '覆盖文件');
      if (result?.id !== id || !result.eTag || !result.file || result.size !== bytes.length) throw new OneDriveError('覆盖结果信息不符，保存未确认；请检查云端。');
      let saved;
      try { saved = await this.readContent(id); } catch { throw new OneDriveError('读取覆盖结果失败，保存未确认；请检查云端。'); }
      if (saved.eTag !== result.eTag || saved.bytes.length !== bytes.length || saved.bytes.some((byte,index)=>byte !== bytes[index])) throw new OneDriveError('云端读回内容不一致，保存未确认；请检查云端。');
      return result;
    },
    async save({ id, eTag, rootId, name, text }) {
      const bytes = new TextEncoder().encode(text);
      if (!bytes.length) throw new OneDriveError('暂不支持保存空文件；本地草稿未受影响。');
      if (id) throw new OneDriveError('暂不能安全覆盖已有云端文件，请选择另存；本地草稿仍保留。');
      if (!id && (!rootId || !name || name !== name.trim() || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[.]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))) throw new OneDriveError('请输入有效的文件名。');
      await withinFolder(rootId);
      const path = id ? idPath(id) : idPath(rootId) + ':/' + encodeURIComponent(name) + ':';
      const session = await graph(path + '/createUploadSession', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'fail', name } })
      }, '创建上传会话');
      const uploadUrl = preauthenticatedUrl(session.uploadUrl);
      let completed = false;
      try {
        const chunkSize = 10 * 320 * 1024;
        let result;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          const end = Math.min(offset + chunkSize, bytes.length);
          const response = await transfer(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${offset}-${end - 1}/${bytes.length}` }, body: bytes.slice(offset, end) });
          if (end === bytes.length) {
            if (response.status !== 200 && response.status !== 201) throw new OneDriveError('上传未完成，保存未确认；请检查云端后重试。');
            completed = true;
            try { result = await response.json(); } catch { throw new OneDriveError('上传结果无效，保存未确认；请检查云端。'); }
          } else if (response.status !== 202) throw new OneDriveError('上传分片响应异常，保存未确认；请检查云端。');
        }
        if (!result?.id || !result.eTag || !result.file || result.size !== bytes.length) throw new OneDriveError('上传结果缺少文件信息或大小不符，保存未确认；请检查云端。');
        let saved;
        try { saved = await this.readContent(result.id); }
        catch (error) { throw new OneDriveError(`读取保存结果失败，保存未确认；请检查云端。${error instanceof OneDriveError ? ' ' + error.message : ''}`); }
        if (saved.eTag !== result.eTag || saved.bytes.length !== bytes.length || saved.bytes.some((byte, index) => byte !== bytes[index])) throw new OneDriveError('云端读回内容不一致，保存未确认；请检查云端。');
        return result;
      } catch (error) {
        if (!completed) try { await transfer(uploadUrl, { method: 'DELETE' }); } catch { /* Session expires even if cleanup fails. */ }
        throw error;
      }
    }
  };
}
