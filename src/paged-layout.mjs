// Serialized into both PDF and preview documents; no Node dependencies.
export function installPagedLayout(contentHeight, chapterStart, relaxFirstChapter, contentWidth, gb = false) {
  const width = document.body.style.getPropertyValue('width');
  const priority = document.body.style.getPropertyPriority('width');
  // Measure in the printable width, rather than the editor iframe width.
  document.body.style.setProperty('width', contentWidth + 'px', 'important');
  const main = document.querySelector('main');
  const first = main?.querySelector(':scope > section:has(> h2[data-chapter])');
  if (first && !first.querySelector(':scope > ol.references') && relaxFirstChapter && chapterStart !== 'continuous') {
    const heading = first.querySelector('h2[data-chapter]');
    const line = parseFloat(getComputedStyle(heading).lineHeight) || 24;
    const next = heading.nextElementSibling;
    const needed = next?.tagName === 'TABLE'
      ? (next.tHead?.getBoundingClientRect().height || 0) + (next.tBodies[0]?.rows[0]?.getBoundingClientRect().height || line * 2)
      : line * 2;
    const fitsFirstPage = heading.getBoundingClientRect().bottom - document.body.getBoundingClientRect().top + needed <= contentHeight;
    if (chapterStart === 'page' || fitsFirstPage) first.setAttribute('data-first-chapter', '');
  }
  for (const marker of main?.querySelectorAll('.md2pdf-pagebreak') || []) {
    let current = marker, next = current.nextElementSibling;
    while (!next && current.parentElement !== main) {
      current = current.parentElement;
      next = current?.nextElementSibling;
      if (!current) break;
    }
    while (next?.classList.contains('md2pdf-pagebreak')) next = next.nextElementSibling;
    if (next && main.contains(next)) {
      next.classList.add('md2pdf-forced-pagebreak');
      // Keep odd-page chapter alignment when an explicit break meets a chapter.
      if (next.matches('section:has(> h2[data-chapter])')) next.removeAttribute('data-first-chapter');
    }
    marker.remove();
  }
  // A split table is reconstructed from ancestors without its earlier thead.
  // Insert the header while laying out each continuation, so it reserves space.
  class TableHeaders extends Paged.Handler {
    renderNode(node, source) {
      const element = node.nodeType === 1 ? node : node.parentElement;
      if (!element) return;
      const table = element.closest('table');
      const sourceElement = source.nodeType === 1 ? source : source.parentElement;
      // A new table/caption is still waiting for its original header. Only
      // tbody/tfoot continuations need a copy before their first data row.
      if (!sourceElement?.closest('tbody, tfoot')) return;
      const original = sourceElement.closest('table');
      if (!table || !original || table.tHead || !original.tHead || element.closest('thead')) return;
      const header = original.tHead.cloneNode(true);
      header.setAttribute('data-repeated-header', '');
      header.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      table.insertBefore(header, table.firstChild);
      if (gb && original.caption && !table.caption) {
        const caption = original.caption.cloneNode(true);
        caption.removeAttribute('id');
        caption.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
        const continued = document.createElement('span');
        continued.className = 'gb-continuation';
        continued.textContent = '（续）';
        caption.appendChild(continued);
        table.insertBefore(caption, table.firstChild);
      }
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
  if (width) document.body.style.setProperty('width', width, priority);
  else document.body.style.removeProperty('width');
}
