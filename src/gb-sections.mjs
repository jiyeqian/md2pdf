// Section meaning is independent of the visible heading. Shared with the editor.
export const GB_SECTION_ROLES = {toc:'目次',preface:'前言',introduction:'引言',appendix:'附录',bibliography:'参考文献',index:'索引'};
export function gbHeading(text, level = 2) {
  const match = /\s*\{([^{}]*)\}\s*$/.exec(text);
  const attrs = {};
  let id;
  if (match) {
    const tokens = match[1].trim().split(/\s+/);
    for (const token of tokens) {
      if (/^#sec:[\w.-]+$/.test(token)) {
        if (id) throw new Error('章节稳定标识重复');
        id = token.slice(1);
      } else {
        const pair = /^(role|nature)=(\w+)$/.exec(token);
        if (!pair || attrs[pair[1]] !== undefined) throw new Error('章节属性非法或重复：' + token);
        attrs[pair[1]] = pair[2];
      }
    }
    if (attrs.role && !Object.hasOwn(GB_SECTION_ROLES, attrs.role)) throw new Error('未知章节 role：' + attrs.role);
    if (attrs.nature && !['normative','informative'].includes(attrs.nature)) throw new Error('nature 仅支持 normative 或 informative');
    if (attrs.role && level !== 2) throw new Error('章节 role 仅支持二级标题；附录子章节无需重复设置');
    text = text.slice(0, match.index).trim();
  }
  const role = attrs.role;
  return {text, id, role, nature:attrs.nature, explicit:!!attrs.role};
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
    if (s.nature && s.role!=='appendix') report('gb-nature-without-appendix','nature 需要 role=appendix；当前性质属性不生效。');
    if (s.role==='appendix') {
      if (!s.nature) report('gb-appendix-nature',`附录 ${s.appendix} 未指定性质，请设置 nature=normative 或 nature=informative。`);
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
