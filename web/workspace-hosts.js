/* One controller and editor state, with UI hosted in either workspace document. */
(function () {
  'use strict';
  const root = document, documents = new Set([root]), listeners = new Set();
  const preview = root.querySelector('#preview');
  let active = root;
  function target(doc, type) { return type === 'resize' ? doc.defaultView : doc; }
  function bind(doc, entry, remove) {
    target(doc, entry.type)?.[remove ? 'removeEventListener' : 'addEventListener'](entry.type, entry.handler, entry.options);
  }
  function claim(event) { if (documents.has(event.currentTarget)) active = event.currentTarget; }
  function track(doc, remove) {
    for (const type of ['pointerdown', 'keydown', 'click', 'focusin']) doc[remove ? 'removeEventListener' : 'addEventListener'](type, claim, true);
  }
  track(root, false);
  const api = {
    on(type, handler, options) {
      // Application state events belong to the root controller only.
      const entry = { type, handler, options };
      listeners.add(entry);
      for (const doc of documents) if (!type.startsWith('md-') || doc === root) bind(doc, entry, false);
      return () => { for (const doc of documents) bind(doc, entry, true); listeners.delete(entry); };
    },
    add(doc) {
      if (!doc || documents.has(doc)) return;
      documents.add(doc); track(doc, false);
      for (const entry of listeners) if (!entry.type.startsWith('md-')) bind(doc, entry, false);
    },
    remove(doc) {
      if (!doc || doc === root || !documents.has(doc)) return;
      // Settle root-owned confirmation promises before their UI host disappears.
      for (const dialog of doc.querySelectorAll?.('dialog[open]') || []) {
        let CancelEvent = Event;
        try { CancelEvent = doc.defaultView?.Event || Event; } catch { /* A navigated host is no longer same-origin. */ }
        const cancel = new CancelEvent('cancel', { cancelable: true });
        dialog.dispatchEvent(cancel);
        if (!cancel.defaultPrevented && dialog.open) dialog.close('');
      }
      // Cached menus/dialogs must not retain the closed window's document.
      if (root.body && root.adoptNode) for (const node of doc.querySelectorAll('dialog:not([open]),.md-drafts-menu,.md-quick-actions')) {
        if (node.tagName !== 'DIALOG') node.hidden = true;
        root.body.appendChild(root.adoptNode(node));
      }
      for (const entry of listeners) bind(doc, entry, true);
      track(doc, true); documents.delete(doc);
      if (active === doc) active = root;
    },
    activeDocument() { return documents.has(active) && !active.defaultView?.closed ? active : root; },
    query(selector) {
      for (const doc of documents) { const node = doc.querySelector(selector); if (node) return node; }
      return null;
    },
    postFrame(frame, data) {
      if (typeof api.frameTransport === 'function') return api.frameTransport(frame, data);
      frame?.contentWindow?.postMessage(data, '*');
    },
    postPreview(data) {
      if (typeof api.previewTransport === 'function') return api.previewTransport(data);
      return api.postFrame(preview, data);
    }
  };
  window.mdWorkspaceHosts = api;
})();
