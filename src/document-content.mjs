import * as YAML from '../vendor/yaml/yaml.mjs';
import {gbHeading} from './gb-sections.mjs';
export const CONTENT_ROLES={abstract:'摘要',keywords:'关键词',bibliography:'参考文献'};
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
export function prepareDocumentContent(source) {
 const lines=source.split('\n'),out=[],values={};let fence=null,depth=0;
 for(let i=0;i<lines.length;i++) {
  const line=lines[i],code=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if(code){if(!fence)fence=code[1];else if(code[1][0]===fence[0]&&code[1].length>=fence.length&&!code[2].trim())fence=null;out.push(line);continue;}
  if(fence){out.push(line);continue;}
  if(/^ {0,3}:::(kicker|colophon)\s+\S/.test(line))fail('kicker/colophon 不接受行内参数，请在块内定义内容或位置');
  const open=/^ {0,3}:::(kicker|colophon)\s*$/.exec(line);
  if(open){
   const name=open[1];if(depth)fail(name+' 必须作为独立内容块');if(Object.hasOwn(values,name))fail(name+' 内容块重复');
   const start=i,body=[];while(++i<lines.length&&!/^ {0,3}:::\s*$/.test(lines[i]))body.push(lines[i]);
   if(i===lines.length)fail(name+' 内容块未闭合');
   const text=body.join('\n').trim();
   if(name==='kicker')values.kicker=text;
   else if(/^(left|center|right)\s*:/m.test(text)){
    const doc=YAML.parseDocument(text,{uniqueKeys:true});if(doc.errors.length)fail('colophon：'+doc.errors[0].message);
    const parts=doc.toJS({maxAliasCount:100});if(!parts||Array.isArray(parts)||typeof parts!=='object')fail('colophon 需要 left、center、right 文字');
    for(const [key,value]of Object.entries(parts))if(!['left','center','right'].includes(key)||typeof value!=='string')fail('colophon 仅支持 left、center、right 字符串；清空请使用 ""');
    values.colophon=parts;
   }else values.colophon={left:text};
   out.push(...Array(i-start+1).fill(''));continue;
  }
  if(/^ {0,3}:::[a-z]/.test(line))depth++;
  else if(/^ {0,3}:::\s*$/.test(line))depth=Math.max(0,depth-1);
  out.push(line);
 }
 return {body:out.join('\n'),...values};
}
export function hasPaperAbstract(source='') {
 let fence=null,found=false;
 for(const line of prepareDocumentContent(source).body.split('\n')){
  const code=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if(code){if(!fence)fence=code[1];else if(code[1][0]===fence[0]&&code[1].length>=fence.length&&!code[2].trim())fence=null;continue;}
  if(fence)continue;
  const h=/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  if(h){found=false;if(h[1].length===2&&/\brole=abstract\b/.test(h[2])){try{found=gbHeading(h[2],2,CONTENT_ROLES).role==='abstract';}catch{}}continue;}
  if(found&&line.trim()&&!/^<!--/.test(line))return true;
 }
 return false;
}
export function prepareContentHeadings(html,gb=false) {
 const heads=[...html.matchAll(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g)],edits=[],roles=new Set();
 for(let i=0;i<heads.length;i++){
  const h=heads[i];if(!/\{[^{}]*\brole=(abstract|keywords|bibliography)\b[^{}]*\}\s*$/.test(h[3]))continue;
  const s=gbHeading(h[3].replace(/<[^>]*>/g,''),+h[1],CONTENT_ROLES);
  if(roles.has(s.role))fail('章节角色重复：'+s.role);roles.add(s.role);
  if(gb&&s.role==='bibliography')continue;
  const title=h[3].replace(/\s*\{[^{}]*\}\s*$/,'');
  if(s.role==='bibliography'){edits.push({start:h.index,end:h.index+h[0].length,text:'<h2'+h[2]+' data-document-role="bibliography">'+title+'</h2>'});continue;}
  const end=heads.slice(i+1).find(n=>+n[1]<=2)?.index ?? html.length;
  let body=html.slice(h.index+h[0].length,end).trim();
  if(s.role==='keywords'&&body){
   if(!/^<ul>\s*(?:<li>[\s\S]*?<\/li>\s*)+<\/ul>$/.test(body))fail('关键词请使用 Markdown 非编号列表');
   body=[...body.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m=>{const text=m[1].replace(/^<p>([\s\S]*?)<\/p>\s*$/,'$1').trim();if(/<\/?(?:ul|ol|li|p|pre|blockquote|h[1-6])\b/.test(text))fail('关键词列表应为单层，每项只含行内内容');return text;}).join('；');
  }
  edits.push({start:h.index,end,text:body?'<div class="'+s.role+'" data-document-role="'+s.role+'"><span class="paper-label">'+title+'</span><div class="summary-content">'+body+'</div></div>\n':''});
 }
 for(const e of edits.sort((a,b)=>b.start-a.start))html=html.slice(0,e.start)+e.text+html.slice(e.end);
 return {html,roles};
}

// Add navigation semantics after chapter numbering, contents and section grouping are complete.
export function finalizeContentNavigation(html) {
 return html.replace(/(<div class="(?:abstract|keywords)" data-document-role="(?:abstract|keywords)">)<span class="paper-label">([\s\S]*?)<\/span><div class="summary-content">/g,
  (_,block,title)=>block+'<h2 class="paper-label summary-heading">'+title+'</h2><div class="summary-content">');
}
