import {gbHeading,HEADING_ATTRIBUTES,decodeHeadingText,GB_SECTION_ROLES} from './gb-sections.mjs';
export const CONTENT_ROLES={abstract:'摘要',keywords:'关键词',bibliography:'参考文献'};
const escape=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
export function parseColophonRow(text) {
 if(!text.trim())return {};
 if(/[\r\n]/.test(text))fail('colophon 请使用单行三格：左格 | 中格 | 右格');
 const cells=[];let cell='',quote=false,closed=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='\\'&&i+1<text.length){cell+=c+text[++i];continue;}
  if(c==='"'&&(quote||!cell.trim())){quote=!quote;closed=!quote;cell+=c;continue;}
  if(c==='|'&&!quote){cells.push(cell);cell='';closed=false;continue;}
  if(closed&&c.trim())fail('colophon 引号后仅允许空白或分隔符');
  cell+=c;
 }
 if(quote)fail('colophon 引号未闭合');cells.push(cell);
 if(cells.length!==3)fail('colophon 需要三格：左格 | 中格 | 右格；字面竖线请写 \\|');
 const result={};
 cells.forEach((raw,i)=>{
  const value=raw.trim();if(!value)return;
  const quoted=/^"((?:\\.|[^"\\])*)"$/.exec(value);
  const content=(quoted?quoted[1]:value).replace(/\\([|"\\])/g,'$1');
  result[['left','center','right'][i]]=content.trim()?content:'';
 });
 return result;
}
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
   else values.colophon=parseColophonRow(text);
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
 const parseHeading=(text,level)=>{try{return gbHeading(text,level,gb?{...GB_SECTION_ROLES,...CONTENT_ROLES}:CONTENT_ROLES);}catch(error){fail(error.message);}};
 for(let i=0;i<heads.length;i++){
  const h=heads[i],heading=decodeHeadingText(h[3].replace(/<[^>]*>/g,''));
  const attributes=HEADING_ATTRIBUTES.exec(heading);
  if(!attributes){if(/\{[^{}]*(?:(?:role|subtitle|nature)=|#sec:)/.test(heading))parseHeading(heading,+h[1]);continue;}
  if(!/(?:role|subtitle|nature)=|#sec:/.test(attributes[1]))continue;
  const s=parseHeading(heading,+h[1]);
  if(!Object.hasOwn(CONTENT_ROLES,s.role)){
   if(gb)continue;
   const suffix=HEADING_ATTRIBUTES.exec(h[3]),attrs=h[2]+(s.subtitle!==undefined?' data-heading-subtitle="'+escape(s.subtitle)+'"':'');
   edits.push({start:h.index,end:h.index+h[0].length,text:'<h'+h[1]+attrs+'>'+h[3].slice(0,suffix.index)+'</h'+h[1]+'>'});continue;
  }
  if(roles.has(s.role))fail('章节角色重复：'+s.role);roles.add(s.role);
  if(gb&&s.role==='bibliography')continue;
  const title=h[3].replace(HEADING_ATTRIBUTES,'');
  const subtitle=s.subtitle!==undefined?' data-heading-subtitle="'+escape(s.subtitle)+'"':'';
  if(s.role==='bibliography'){edits.push({start:h.index,end:h.index+h[0].length,text:'<h2'+h[2]+subtitle+' data-document-role="bibliography">'+title+'</h2>'});continue;}
  const end=heads.slice(i+1).find(n=>+n[1]<=2)?.index ?? html.length;
  let body=html.slice(h.index+h[0].length,end).trim();
  if(s.role==='keywords'&&body){
   const paragraph=/^<p>([\s\S]*)<\/p>$/.exec(body);
   if(!paragraph||/<\/?(?:ul|ol|li|p|pre|blockquote|h[1-6]|table)\b/.test(paragraph[1]))fail('关键词请使用单个普通段落，分隔符由作者填写');
   body=paragraph[1];
  }
  if(s.subtitle)body='<div class="heading-subtitle">'+escape(s.subtitle)+'</div>'+body;
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

export function finalizeHeadingSubtitles(html) {
 return html.replace(/(<h([1-6])[^>]*data-heading-subtitle="([^"]*)"[^>]*>[\s\S]*?<\/h\2>)/g,(_,heading,level,subtitle)=>heading+(subtitle?'<div class="heading-subtitle">'+subtitle+'</div>':''));
}
