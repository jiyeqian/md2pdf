// Single delimiters are deliberately separate from GFM's ~~deletion~~.
const escape = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function scriptToken(source, delimiter) {
  if(!source.startsWith(delimiter)||source[1]===delimiter)return;
  const match=(delimiter==='^'?/^\^((?:\\.|[^\s^\\])+?)\^(?!\^)/:/^~((?:\\.|[^\s~\\])+?)~(?!~)/).exec(source);
  if(!match)return;
  return {raw:match[0],text:match[1].replace(/\\([\s^~\\])/g,'$1')};
}
export const scriptExtensions=['^','~'].map(delimiter=>({
  name:delimiter==='^'?'mdSuperscript':'mdSubscript',level:'inline',
  start(source) {
    for(let i=0;i<source.length;i++)if(source[i]===delimiter&&source[i-1]!==delimiter&&scriptToken(source.slice(i),delimiter))return i;
  },
  tokenizer(source) {
    const token=scriptToken(source,delimiter);
    if(token)return {type:delimiter==='^'?'mdSuperscript':'mdSubscript',...token};
  },
  renderer(token) {const tag=delimiter==='^'?'sup':'sub';return '<'+tag+' class="md-'+(tag==='sup'?'superscript':'subscript')+'">'+escape(token.text)+'</'+tag+'>';},
}));

// Labels support scripts, not arbitrary HTML, links or nested active content.
export function renderScriptLabel(value) {
  let output='';
  for(let i=0;i<value.length;) {
    if(value[i]==='\\'&&/[\^~\\]/.test(value[i+1]||'')){output+=escape(value[i+1]);i+=2;continue;}
    const delimiter=value[i],token=/[\^~]/.test(delimiter)&&value[i-1]!==delimiter?scriptToken(value.slice(i),delimiter):null;
    if(token){const tag=delimiter==='^'?'sup':'sub';output+='<'+tag+' class="md-'+(tag==='sup'?'superscript':'subscript')+'">'+escape(token.text)+'</'+tag+'>';i+=token.raw.length;}
    else output+=escape(value[i++]);
  }
  return output;
}

export function installInlineScripts(marked) {
  marked.use({extensions:scriptExtensions,tokenizer:{
    // Marked also accepts single ~ for deletion; reserve that form for subscript.
    del(source) { if(source.startsWith('~~'))return false; },
  }});
}
