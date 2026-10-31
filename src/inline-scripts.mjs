// Braces make script boundaries explicit and keep deletion syntax independent.
const escape = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function scriptToken(source, delimiter) {
  const match=(delimiter==='^'?/^\^\{((?:\\[^\r\n]|[^{}\\\r\n])+)\}/:/^_\{((?:\\[^\r\n]|[^{}\\\r\n])+)\}/).exec(source);
  if(!match||!match[1].trim())return;
  return {raw:match[0],text:match[1].replace(/\\([{}^_\\])/g,'$1')};
}
export const scriptExtensions=['^','_'].map(delimiter=>({
  name:delimiter==='^'?'mdSuperscript':'mdSubscript',level:'inline',
  start(source) { const index=source.indexOf(delimiter+'{');return index<0?undefined:index; },
  tokenizer(source) {
    const token=scriptToken(source,delimiter);
    if(token)return {type:delimiter==='^'?'mdSuperscript':'mdSubscript',...token};
    // An incomplete subscript must not open emphasis across a later valid one.
    if(source.startsWith(delimiter+'{'))return {type:'text',raw:delimiter,text:delimiter};
  },
  renderer(token) {const tag=delimiter==='^'?'sup':'sub';return '<'+tag+' class="md-'+(tag==='sup'?'superscript':'subscript')+'">'+escape(token.text)+'</'+tag+'>';},
}));

// Labels support scripts, not arbitrary HTML, links or nested active content.
export function renderScriptLabel(value) {
  let output='';
  for(let i=0;i<value.length;) {
    if(value[i]==='\\'&&/[{}^_\\]/.test(value[i+1]||'')){output+=escape(value[i+1]);i+=2;continue;}
    const delimiter=value[i],token=/[\^_]/.test(delimiter)?scriptToken(value.slice(i),delimiter):null;
    if(token){const tag=delimiter==='^'?'sup':'sub';output+='<'+tag+' class="md-'+(tag==='sup'?'superscript':'subscript')+'">'+escape(token.text)+'</'+tag+'>';i+=token.raw.length;}
    else output+=escape(value[i++]);
  }
  return output;
}

export function installInlineScripts(marked) {
  marked.use({extensions:scriptExtensions,tokenizer:{
    // Only ~~...~~ is deletion; the retired ~subscript~ form stays literal.
    del(source) { if(source.startsWith('~~'))return false; },
  }});
}
