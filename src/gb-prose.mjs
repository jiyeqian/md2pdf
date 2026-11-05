import { elements } from './gb-content.mjs';

// Published GB samples advance commas/semicolons by about half a character.
// Keep the author's punctuation and CJK glyph widths; only reclaim its trailing space.
export function calibrateGbProse(html) {
  const edits = [];
  for (const p of elements(html)) {
    if (p.tag !== 'p' || !p.closeStart || p.parent?.tag !== 'section') continue;
    const heading = p.parent.children.find(n => n.tag === 'h2');
    const role = heading && /data-gb-role="([^"]+)"/.exec(heading.token)?.[1];
    if (role && role !== 'appendix') continue;
    const inner = html.slice(p.openEnd, p.closeStart);
    const protectedRanges = elements(inner).filter(n =>
      ['code','pre','sup','sub','math','script','style','textarea'].includes(n.tag) || /class="[^"]*\b(?:gb-footnote|gb-prose-punctuation)\b/.test(n.token)
    ).filter(n => n.end).map(n => [n.start,n.end]);
    const protectedTokens = /<!--[\s\S]*?-->|<\/?[A-Za-z][\w:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>|\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\])*\$|[，；]/g;
    const content = inner.replace(protectedTokens,(token,offset) => {
      if (token !== '，' && token !== '；') return token;
      if (protectedRanges.some(([start,end]) => start <= offset && offset < end)) return token;
      return '<span class="gb-prose-punctuation">' + token + '</span>';
    });
    if (content !== inner) edits.push({start:p.openEnd,end:p.closeStart,text:content});
  }
  for (const e of edits.reverse()) html = html.slice(0,e.start) + e.text + html.slice(e.end);
  return html;
}
