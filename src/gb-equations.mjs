// Called after the GB semantic blocks and protected math have been restored.
// MathJax retains sole ownership of equation tags, labels and references.
export function applyGbEquations(html) {
  return html.replace(/<div class="gb-equation">([\s\S]*?)<\/div>/g, (original, content) => {
    const paragraphs = [...content.matchAll(/<p>([\s\S]*?)<\/p>/g)];
    if (paragraphs.length < 2 || content.replace(/<p>[\s\S]*?<\/p>/g, '').trim()) return original;
    const formula = paragraphs[0][1].trim();
    if (!/^\$\$[\s\S]+\$\$$/.test(formula)) return original;

    const lines = paragraphs.slice(1).flatMap(p => p[1].split(/\r?\n/)).map(line => line.trim()).filter(Boolean);
    if (!/^式中[：:]$/.test(lines.shift() || '') || !lines.length) return original;
    const rows = lines.map(line => {
      const separator = line.indexOf('|');
      if (separator < 0) return null;
      const symbol = line.slice(0, separator).trim();
      const definition = line.slice(separator + 1).trim();
      return symbol && definition ? [symbol, definition] : null;
    });
    if (rows.some(row => !row)) return original;
    return '<div class="gb-equation"><div class="gb-equation-formula">' + formula + '</div>'
      + '<div class="gb-equation-legend-title">式中：</div><table class="gb-equation-legend" role="presentation"><tbody>'
      + rows.map(([symbol, definition]) => '<tr><td class="gb-equation-symbol">' + symbol
        + '</td><td class="gb-equation-dash">——</td><td class="gb-equation-definition">' + definition + '</td></tr>').join('')
      + '</tbody></table></div>';
  });
}

export const GB_EQUATION_CSS = `
.gb-equation { display: inline-block; width: 100%; vertical-align: top; break-inside: avoid; }
.gb-equation-formula { text-align: center; }
.gb-equation-legend-title { margin-left: 2em; }
.gb-equation table.gb-equation-legend { width: calc(100% - 2em); margin: 0 0 0 2em; border: 0; border-collapse: collapse; table-layout: auto; font: 10.5pt/1.62 var(--font-body); }
.gb-equation table.gb-equation-legend tbody tr { background: transparent; }
.gb-equation table.gb-equation-legend tbody td, .gb-equation table.gb-equation-legend tbody td:first-child { border: 0; padding: 0; text-indent: 0; vertical-align: top; text-align: left; font: 10.5pt/1.62 var(--font-body); }
.gb-equation table.gb-equation-legend tbody td.gb-equation-symbol { width: 1px; white-space: nowrap; padding-right: .5em; }
.gb-equation table.gb-equation-legend tbody td.gb-equation-dash { width: 1px; white-space: nowrap; padding-right: .5em; }
.gb-equation table.gb-equation-legend tbody td.gb-equation-definition { overflow-wrap: anywhere; }
`;

// Run after pagination, when the cloned containers have their final width. This function is also
// serialized into the document, so it must not close over module variables.
export function finalizeGbEquations() {
  document.querySelectorAll('.gb-equation-leader').forEach(node => node.remove());
  for (const container of document.querySelectorAll('.pagedjs_page_content mjx-container[display="true"]')) {
    const svg = container.querySelector('svg');
    if (!svg) continue;
    const rows = [...svg.querySelectorAll('[data-mml-node="mlabeledtr"]')];
    const labels = [...svg.querySelectorAll('[data-labels] > [data-mml-node="mtd"]')];
    if (!rows.length || rows.length !== labels.length) continue;
    const bounds = container.getBoundingClientRect();
    container.style.position = 'relative';
    for (let i = 0; i < rows.length; i++) {
      const formula = rows[i].getBoundingClientRect();
      const label = labels[i].getBoundingClientRect();
      const left = Math.max(0, formula.right - bounds.left + 8);
      const right = Math.min(bounds.width, label.left - bounds.left - 4);
      if (!formula.width || !label.width || right <= left) continue;
      const leader = document.createElement('span');
      leader.className = 'gb-equation-leader';
      leader.setAttribute('aria-hidden', 'true');
      leader.textContent = '………………………………………………………………………………………………………………………………';
      Object.assign(leader.style, {
        display: 'block', position: 'absolute', left: left + 'px', width: (right - left) + 'px',
        top: (label.top - bounds.top + label.height / 2) + 'px',
        transform: 'translateY(-50%)', overflow: 'hidden', whiteSpace: 'nowrap',
        fontFamily: 'var(--font-body)', fontSize: '10.5pt', lineHeight: '1', textAlign: 'left', pointerEvents: 'none',
      });
      container.appendChild(leader);
    }
  }
}
