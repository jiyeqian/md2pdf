// Serialized into both PDF and preview documents; no Node dependencies.
export function installPagedLayout(contentHeight) {
  // A split table is reconstructed from ancestors without its earlier thead.
  // Insert the header while laying out each continuation, so it reserves space.
  class TableHeaders extends Paged.Handler {
    renderNode(node, source) {
      const element = node.nodeType === 1 ? node : node.parentElement;
      if (!element) return;
      const table = element.closest('table');
      const original = source.nodeType === 1 ? source.closest('table') : source.parentElement?.closest('table');
      if (!table || !original || table.tHead || !original.tHead || element.closest('thead')) return;
      const header = original.tHead.cloneNode(true);
      header.setAttribute('data-repeated-header', '');
      header.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      table.insertBefore(header, table.firstChild);
    }
  }
  Paged.registerHandlers(TableHeaders);
  for (const table of document.querySelectorAll('main table')) {
    const headerHeight = table.tHead?.getBoundingClientRect().height || 0;
    for (const row of table.querySelectorAll('tbody > tr')) {
      if (row.getBoundingClientRect().height > contentHeight - headerHeight) {
        row.style.setProperty('break-inside', 'auto', 'important');
      }
    }
  }
}
