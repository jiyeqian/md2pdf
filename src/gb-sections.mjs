// Section meaning is independent of the visible heading. Shared with the editor.
export const GB_SECTION_ROLES = {toc:'目次',preface:'前言',introduction:'引言',appendix:'附录',bibliography:'参考文献',index:'索引'};
export const HEADING_ATTRIBUTES = /\s*\{((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^{}"'])*)\}\s*$/;
export const decodeHeadingText = text => text.replace(/&#(?:x([\da-f]+)|(\d+));/gi,(_,hex,dec)=>String.fromCodePoint(Math.min(0x10ffff,parseInt(hex||dec,hex?16:10)))).replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
export function protectHeadingAttributes(source) {
  let marker='MD2PDFHEADINGATTR';while(source.includes(marker))marker+='X';
  const attributes=[];let fence=null;
  const body=source.split('\n').map(line=>{
    const boundary=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if(boundary){if(!fence)fence=boundary[1];else if(boundary[1][0]===fence[0]&&boundary[1].length>=fence.length&&!boundary[2].trim())fence=null;return line;}
    if(fence||!/^ {0,3}#{1,6}\s/.test(line))return line;
    const match=HEADING_ATTRIBUTES.exec(line);if(!match||!/(?:role|subtitle|nature)=|#sec:/.test(match[1]))return line;
    const space=/^\s*/.exec(match[0])[0];attributes.push(match[0].slice(space.length));return line.slice(0,match.index)+space+marker+(attributes.length-1)+'END';
  }).join('\n');
  return {body,restore:html=>html.replace(new RegExp(marker+'(\\d+)END','g'),(_,i)=>attributes[+i].replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'))};
}
export function gbHeading(text, level = 2, roles = GB_SECTION_ROLES) {
  const match = HEADING_ATTRIBUTES.exec(text);
  if(!match&&/\{[^{}]*(?:(?:role|subtitle|nature)=|#sec:)/.test(text))throw new Error('章节属性未闭合或引号格式错误');
  const attrs = {};
  let id;
  if (match) {
    let rest=match[1].trim();
    while(rest) {
      const stable=/^#(sec:[\w.-]+)(?=\s|$)/.exec(rest);
      if(stable){if(id)throw new Error('章节稳定标识重复');id=stable[1];rest=rest.slice(stable[0].length).trim();continue;}
      const pair=/^(role|subtitle)=(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s"']+))(?=\s|$)/.exec(rest);
      if(!pair||Object.hasOwn(attrs,pair[1]))throw new Error('章节属性非法、已移除或重复：'+rest);
      attrs[pair[1]]=(pair[2]??pair[3]??pair[4]).replace(/\\(["'\\])/g,'$1');
      rest=rest.slice(pair[0].length).trim();
    }
    if (attrs.role !== undefined && !Object.hasOwn(roles, attrs.role)) throw new Error('未知章节 role：' + attrs.role);
    if (attrs.role && level !== 2) throw new Error('章节 role 仅支持二级标题；附录子章节无需重复设置');
    text = text.slice(0, match.index).trim();
  }
  const role = attrs.role;
  return {text, id, role, subtitle:attrs.subtitle, explicit:!!attrs.role};
}
export function gbSectionCatalog(headings) {
  const counters=[0,0,0,0,0];
  let appendixCount=0, appendix;
  return headings.map(h=>{
    let section;
    try { section={...h,...gbHeading(h.text,h.level)}; }
    catch(error) { return {...h,error:error.message}; }
    const level=h.level-2;
    if(level<0 || level>4) return section;
    if(level===0) {
      appendix=section.role==='appendix' ? String.fromCharCode(65+appendixCount++) : undefined;
      counters.fill(0,1);
      if(appendixCount>26) return {...section,error:'附录数量超过 A–Z'};
    }
    section.appendix=appendix;
    if(section.role==='appendix') section.number='附录'+appendix;
    else if(!section.role) {
      counters[level]++;
      counters.fill(0,level+1);
      section.number=appendix ? appendix+'.'+counters.slice(1,level+1).join('.') : counters.slice(0,level+1).join('.');
    }
    return section;
  });
}
export function gbSectionDiagnostics(headings, options={}, sections=gbSectionCatalog(headings)) {
  const diagnostics=[], seen=new Set();
  let phase=0;
  const order={toc:0,preface:1,introduction:2,appendix:4,bibliography:5,index:6};
  for (const s of sections) {
    const report=(code,message)=>diagnostics.push({...s,severity:'warning',code,message});
    if(s.error) { report('gb-section-invalid',s.error); continue; }
    if (s.role==='appendix') {
      if (!s.subtitle) report('gb-appendix-subtitle',`附录 ${s.appendix} 未指定性质副标题，请设置 subtitle="（规范性）" 或 subtitle="（资料性）"。`);
      else if(!['（规范性）','（资料性）'].includes(s.subtitle))report('gb-appendix-subtitle',`附录 ${s.appendix} 的副标题“${s.subtitle}”不符合 GB 模板的性质标注要求；保留作者文字，请核对。`);
    } else if (s.role) {
      if (seen.has(s.role)) report('gb-section-duplicate','章节角色重复：'+s.role);
      seen.add(s.role);
      if (s.text!==GB_SECTION_ROLES[s.role]) report('gb-section-title',`章节使用了自定义名称“${s.text}”；GB 模板建议使用“${GB_SECTION_ROLES[s.role]}”。`);
    }
    if (s.level===2) {
      const next=s.role ? order[s.role] : 3;
      if(next<phase) report('gb-section-order','章节顺序与 GB 模板推荐的前置、正文、附录及后置顺序不一致。');
      phase=Math.max(phase,next);
    }
  }
  const missing=(role,line,message)=>{
    if(!sections.some(s=>s.role===role)) diagnostics.push({line:line||1,severity:'warning',code:'gb-missing-'+role,message});
  };
  if(options.tocEnabled) missing('toc',options.tocLine,'已开启目次，但未声明 role=toc；目次未生成。');
  if(options.referenceLine) missing('bibliography',options.referenceLine,'存在文献引用，但未声明 role=bibliography；文献列表未生成。');
  return diagnostics;
}
