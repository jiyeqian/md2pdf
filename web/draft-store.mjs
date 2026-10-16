import { firstHeadingTitle, frontmatterTitle } from './editor-files.mjs';

export const DRAFT_LIST_LIMIT = 10;
export function draftTitle({ md = '', filename = '' }) {
  return frontmatterTitle(md) || firstHeadingTitle(md) || filename.replace(/\.(md|markdown|mdown)$/i, '') || '未命名文档';
}

export class DraftConflict extends Error {
  constructor() { super('草稿已在其他页面修改或删除，请先下载当前 Markdown，再重新打开草稿。'); }
}

// 更新和删除均在同一个事务中核对版本，避免旧标签页覆盖新内容或复活已删草稿。
export function openDraftStore(factory = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    const request = factory.open('md2pdf-local-documents', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('drafts', { keyPath: 'id' });
      db.createObjectStore('meta');
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭其他 md2pdf 页面后重试。'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      function transact(mode, work) {
        return new Promise((done, fail) => {
          const tx = db.transaction(['drafts', 'meta'], mode);
          let result, failure;
          tx.oncomplete = () => done(result);
          tx.onabort = tx.onerror = () => fail(failure || tx.error || new Error('无法保存草稿。'));
          work(tx.objectStore('drafts'), tx.objectStore('meta'), value => { result = value; }, error => { failure = error; tx.abort(); });
        });
      }
      resolve({
        close: () => db.close(),
        list: () => transact('readonly', (drafts, meta, done) => {
          drafts.getAll().onsuccess = event => done(event.target.result.sort((a, b) => b.savedAt - a.savedAt || a.id.localeCompare(b.id)));
        }),
        get: id => transact('readonly', (drafts, meta, done) => { drafts.get(id).onsuccess = event => done(event.target.result); }),
        active: () => transact('readonly', (drafts, meta, done) => { meta.get('active').onsuccess = event => done(event.target.result); }),
        activate: id => transact('readwrite', (drafts, meta) => { meta.put(id, 'active'); }),
        save: record => transact('readwrite', (drafts, meta, done, fail) => {
          drafts.get(record.id).onsuccess = event => {
            const previous = event.target.result;
            if (record.version ? !previous || previous.version !== record.version : previous) { fail(new DraftConflict()); return; }
            const next = { ...record, version: (previous?.version || 0) + 1, savedAt: Date.now() };
            next.title = draftTitle(next);
            drafts.put(next);
            meta.put(next.id, 'active');
            done(next);
          };
        }),
        remove: records => transact('readwrite', (drafts, meta, done, fail) => {
          for (const record of records) {
            drafts.get(record.id).onsuccess = event => {
              const current = event.target.result;
              if (current && current.version !== record.version) { fail(new DraftConflict()); return; }
              drafts.delete(record.id);
            };
          }
          meta.get('active').onsuccess = event => {
            if (records.some(record => record.id === event.target.result)) meta.put(null, 'active');
          };
          done(true);
        }),
      });
    };
  });
}
