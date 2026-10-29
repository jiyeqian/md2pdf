// Serialized into the paged document, so this function must remain self-contained.
export function finalizeGbTableRules() {
  const ns = 'http://www.w3.org/2000/svg';
  document.querySelectorAll('svg[data-gb-table-rules]').forEach(svg => svg.remove());
  for (const page of document.querySelectorAll('.pagedjs_page')) {
    const pagebox = page.querySelector('.pagedjs_pagebox');
    if (!pagebox) continue;
    const box = pagebox.getBoundingClientRect();
    const scale = box.width / (210 * 96 / 25.4);
    if (!scale) continue;
    for (const table of page.querySelectorAll('table:not(.gb-equation-legend):not([role="presentation"])')) {
      if (table.closest('.pagedjs_page') !== page) continue;
      const cells = [...table.querySelectorAll('th, td')].filter(cell => cell.closest('table') === table);
      if (!cells.length) continue;
      const bounds = table.getBoundingClientRect();
      const rect = element => {
        const r = element.getBoundingClientRect();
        return { left: (r.left - bounds.left) / scale, top: (r.top - bounds.top) / scale,
          right: (r.right - bounds.left) / scale, bottom: (r.bottom - bounds.top) / scale };
      };
      const measured = cells.map(cell => ({ cell, r: rect(cell) })).filter(({ r }) => r.right > r.left && r.bottom > r.top);
      if (!measured.length) continue;
      const svg = document.createElementNS(ns, 'svg');
      const width = bounds.width / scale, height = bounds.height / scale;
      svg.setAttribute('data-gb-table-rules', '');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.style.cssText = `position:absolute;left:${(bounds.left - box.left) / scale}px;top:${(bounds.top - box.top) / scale}px;width:${width}px;height:${height}px;overflow:visible;pointer-events:none;`;
      const segments = { h: [], v: [] };
      for (const { cell, r } of measured) {
        const style = getComputedStyle(cell);
        for (const [side, axis, line, start, end] of [
          ['Top', 'h', r.top, r.left, r.right], ['Bottom', 'h', r.bottom, r.left, r.right],
          ['Left', 'v', r.left, r.top, r.bottom], ['Right', 'v', r.right, r.top, r.bottom],
        ]) {
          if (style.getPropertyValue('--gb-table-grid').trim() === '1' ||
              (style[`border${side}Style`] !== 'none' && parseFloat(style[`border${side}Width`]) > 0)) segments[axis].push({ line, start, end });
        }
      }
      const path = (d, strokeWidth) => {
        const el = document.createElementNS(ns, 'path');
        el.setAttribute('d', d);
        el.setAttribute('fill', 'none');
        el.setAttribute('stroke', '#000');
        el.setAttribute('stroke-width', String(strokeWidth * 96 / 72));
        el.setAttribute('stroke-linecap', 'butt');
        el.setAttribute('stroke-linejoin', 'miter');
        svg.appendChild(el);
      };
      // Merge coincident edges so rowspans and adjacent cells cannot darken a line.
      for (const axis of ['h', 'v']) {
        const items = segments[axis].sort((a, b) => a.line - b.line || a.start - b.start);
        const merged = [];
        for (const item of items) {
          const previous = merged[merged.length - 1];
          if (previous && Math.abs(previous.line - item.line) < 0.02 && item.start <= previous.end + 0.02) previous.end = Math.max(previous.end, item.end);
          else merged.push({ ...item });
        }
        if (merged.length) path(merged.map(({ line, start, end }) => axis === 'h' ? `M${start} ${line}H${end}` : `M${line} ${start}V${end}`).join(' '), 0.327);
      }
      const frame = group => {
        const rs = measured.filter(({ cell }) => group(cell)).map(({ r }) => r);
        if (!rs.length) return;
        const l = Math.min(...rs.map(r => r.left)), t = Math.min(...rs.map(r => r.top));
        const r = Math.max(...rs.map(r => r.right)), b = Math.max(...rs.map(r => r.bottom));
        path(`M${l} ${t}H${r}V${b}H${l}Z`, 0.764);
      };
      frame(() => true);
      const head = table.querySelector('thead');
      if (head) frame(cell => cell.closest('thead') === head);
      for (const row of table.querySelectorAll('tfoot tr, tbody tr.gb-table-notes')) {
        if (row.closest('table') === table) frame(cell => cell.closest('tr') === row);
      }
      table.classList.add('gb-vector-rules');
      pagebox.appendChild(svg);
    }
  }
}
