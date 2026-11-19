// Only balanced, attribute-free formatting tags are interpreted in inline text.
export function installSafeInlineHtml(marked) {
  marked.use({ extensions: [{
    name: 'safeInlineHtml', level: 'inline',
    start(source) { return /<(?:strong|em|del)>/i.exec(source)?.index; },
    tokenizer(source) {
      const opening = /^<(strong|em|del)>/i.exec(source);
      if (!opening) return;
      const tags = /<\/?(?:strong|em|del)>/gi; tags.lastIndex = opening[0].length;
      const stack = [opening[1].toLowerCase()]; let match;
      while ((match = tags.exec(source))) {
        const closing = match[0][1] === '/', name = match[0].replace(/[<>/]/g, '').toLowerCase();
        if (!closing) stack.push(name);
        else if (stack.at(-1) !== name) return;
        else stack.pop();
        if (!stack.length) {
          const text = source.slice(opening[0].length, match.index);
          return { type: 'safeInlineHtml', raw: source.slice(0, tags.lastIndex), text, tag: opening[1].toLowerCase(), tokens: this.lexer.inlineTokens(text) };
        }
      }
    },
    renderer(token) { return '<' + token.tag + '>' + this.parser.parseInline(token.tokens) + '</' + token.tag + '>'; },
  }] });
}
