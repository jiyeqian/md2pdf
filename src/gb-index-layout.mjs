// Serialized after pagination. Only leaders move; keyword and location layout stays intact.
export function finalizeGbIndexLayout() {
  for (const entry of document.querySelectorAll('.pagedjs_pages .gb-index-section .gb-index-entries > li')) {
    const term=entry.querySelector('.gb-index-term'), leader=entry.querySelector('.gb-index-dots'), locations=entry.querySelector('.gb-index-locations');
    if(!term||!leader||!locations)continue;
    leader.style.cssText='position:absolute;left:0;bottom:0;width:0;min-width:0;height:15.72pt;';
    const range=document.createRange();range.selectNodeContents(term);
    const lines=[...range.getClientRects()].filter(r=>r.width&&r.height);
    if(!lines.length)continue;
    const last=lines.at(-1), box=entry.getBoundingClientRect(), target=locations.getBoundingClientRect();
    const scale=entry.closest('.pagedjs_pagebox').getBoundingClientRect().width/(210*96/25.4);
    const start=(last.right-box.left)/scale+3, end=(target.left-box.left)/scale-3;
    leader.style.cssText=`position:absolute;left:${start}px;bottom:0;width:${Math.max(0,end-start)}px;min-width:0;height:15.72pt;`;
  }
}
