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
  const role = attrs.role || (level === 2 ? Object.keys(GB_SECTION_ROLES).find(key=>key!=='appendix' && GB_SECTION_ROLES[key]===text) : undefined);
  return {text, id, role, nature:attrs.nature, explicit:!!attrs.role};
}
export function gbSectionDiagnostics(headings) {
  const diagnostics=[], seen=new Set();
  let appendix=0, phase=0;
  const order={toc:0,preface:1,introduction:2,appendix:4,bibliography:5,index:6};
  for (const h of headings) {
    let s;
    try { s=gbHeading(h.text,h.level); } catch(e) { diagnostics.push({...h,severity:'warning',code:'gb-section-invalid',message:e.message}); continue; }
    const report=(code,message)=>diagnostics.push({...h,severity:'warning',code,message});
    if (s.nature && s.role!=='appendix') report('gb-nature-without-appendix','nature 需要 role=appendix；当前性质属性不生效。');
    if (s.role==='appendix') {
      appendix++;
      if (!s.nature) report('gb-appendix-nature',`附录 ${String.fromCharCode(64+appendix)} 未指定性质，请设置 nature=normative 或 nature=informative。`);
    } else if (s.role) {
      if (seen.has(s.role)) report('gb-section-duplicate','章节角色重复：'+s.role);
      seen.add(s.role);
      if (s.text!==GB_SECTION_ROLES[s.role]) report('gb-section-title',`章节使用了自定义名称“${s.text}”；GB 模板建议使用“${GB_SECTION_ROLES[s.role]}”。`);
    }
    if (h.level===2) {
      const next=s.role ? order[s.role] : /^附录\s*[A-Z]/.test(s.text)?4:3;
      if(next<phase) report('gb-section-order','章节顺序与 GB 模板推荐的前置、正文、附录及后置顺序不一致。');
      phase=Math.max(phase,next);
    }
  }
  return diagnostics;
}
