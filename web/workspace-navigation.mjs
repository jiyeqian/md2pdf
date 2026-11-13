// Document actions are page-wide; navigation and system shortcuts stay with the browser.
export function documentShortcut(event) {
  if (event.isComposing || event.keyCode === 229 || event.repeat || event.shiftKey) return null;
  if (event.altKey && (event.ctrlKey || event.metaKey) && !event.getModifierState?.('AltGraph') && (event.code === 'KeyS' || String(event.key || '').toLowerCase() === 's')) return 'cloud-save';
  if (event.altKey) return null;
  if (!(event.ctrlKey || event.metaKey) || event.getModifierState?.('AltGraph')) return null;
  return ({ s: 'save', o: 'open', p: 'pdf' })[String(event.key || '').toLowerCase()] || null;
}
export async function currentTemplateType(draft, resolve) {
  if (!draft || typeof draft.md !== 'string') return '';
  const type = draft.opts?.type;
  const result = await resolve({ md: draft.md, opts: type ? { type } : {} });
  return typeof result?.type === 'string' ? result.type : '';
}
