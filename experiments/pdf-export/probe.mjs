import catalog from './catalog.mjs';
import {renderDocument} from './runtime.mjs';
import {captureOutline,addPdfOutline} from './pdf-outline.mjs';
const status=document.querySelector('#status'),frame=document.querySelector('iframe'),exportButton=document.querySelector('#export');
let snapshot,selected;
// 只收集当前分页布局；不重新实现 Markdown 解析或分页。
function collect(doc,capture) {
  const outline=capture(doc),pages=[];
  for(const page of doc.querySelectorAll('.pagedjs_page')){
    const origin=page.getBoundingClientRect(),text=[],svgs=[],images=[],boxes=[];
    for(const el of page.querySelectorAll('*')){
      if(el.closest('svg'))continue;
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);
      if(!r.width||!r.height||s.visibility==='hidden')continue;
      const rect={x:(r.x-origin.x)*.75,y:(r.y-origin.y)*.75,w:r.width*.75,h:r.height*.75};
      if(s.backgroundColor!=='rgba(0, 0, 0, 0)'&&s.backgroundColor!=='transparent')boxes.push({...rect,color:s.backgroundColor});
      if(el.tagName==='IMG')images.push({...rect,src:el.src});
    }
    const walker=doc.createTreeWalker(page,NodeFilter.SHOW_TEXT);let node;
    while(node=walker.nextNode()){
      if(node.parentElement.closest('svg,style,script,mjx-container,mjx-assistive-mml'))continue;
      const s=getComputedStyle(node.parentElement);if(s.visibility==='hidden'||s.display==='none')continue;
      let offset=0;
      for(const char of node.textContent){
        const range=doc.createRange();range.setStart(node,offset);offset+=char.length;range.setEnd(node,offset);
        const r=range.getBoundingClientRect();if(!char.trim()||!r.width||!r.height)continue;
        text.push({char,x:(r.x-origin.x)*.75,y:(r.y-origin.y+r.height*.82)*.75,size:parseFloat(s.fontSize)*.75,color:s.color});
      }
    }
    for(const svg of page.querySelectorAll('svg')){
      if(svg.parentElement.closest('svg'))continue;
      const r=svg.getBoundingClientRect();if(!r.width||!r.height)continue;
      const clone=svg.cloneNode(true),originals=[svg,...svg.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
      originals.forEach((el,i)=>{const s=getComputedStyle(el);for(const key of ['fill','stroke','stroke-width','font-size','color'])copies[i].style.setProperty(key,s.getPropertyValue(key));copies[i].style.fontFamily='Probe';});
      svgs.push({x:(r.x-origin.x)*.75,y:(r.y-origin.y)*.75,w:r.width*.75,h:r.height*.75,xml:new XMLSerializer().serializeToString(clone),foreignObjects:svg.querySelectorAll('foreignObject').length});
    }
    pages.push({text,svgs,images,boxes});
  }
  return {outline,pages};
}
let requestId;
window.addEventListener('message',event=>{
  if(event.source!==frame.contentWindow||event.data?.id!==requestId)return;
  if(event.data.error){status.textContent=event.data.error;return;}
  snapshot=event.data.snapshot;exportButton.disabled=false;
  status.textContent=`分页完成：${snapshot.pages.length} 页，${snapshot.outline.entries.length} 个标题；SVG 中 foreignObject：${snapshot.pages.reduce((n,p)=>n+p.svgs.reduce((v,s)=>v+s.foreignObjects,0),0)} 个。`;
});
document.querySelector('#prepare').onclick=async()=>{
  exportButton.disabled=true;snapshot=null;selected=document.querySelector('select').value;requestId=crypto.randomUUID();status.textContent='正在使用共用核心排版…';
  try{
    const source=catalog.sources[selected],result=await renderDocument({md:source.md,opts:{type:source.type}},false);
    const bridge=`<script>(()=>{const id=${JSON.stringify(requestId)},start=Date.now();function ready(){if(window.__md2pdfPagedReady===true&&window.__md2pdfMathReady!==false&&window.__md2pdfMermaidReady!==false){try{parent.postMessage({id,snapshot:(${collect.toString()})(document,${captureOutline.toString()})},'*');}catch(e){parent.postMessage({id,error:e.message},'*');}return;}if(Date.now()-start>60000){parent.postMessage({id,error:'分页超时'},'*');return;}setTimeout(ready,100);}ready();})();</script>`;
    frame.srcdoc=result.html.replace('</body>',bridge+'</body>');
  }catch(error){status.textContent=error.stack;}
};
function rgb(value){const n=value.match(/[\d.]+/g)||[0,0,0];return n.slice(0,3).map(Number);}
exportButton.onclick=async()=>{
  if(!snapshot)return;const job=snapshot,kind=selected;exportButton.disabled=true;document.querySelector('#prepare').disabled=true;const begin=performance.now();status.textContent='正在浏览器内绘制并写入大纲…';
  try{
    const data=new Uint8Array(await(await fetch('./probe-font.ttf')).arrayBuffer());let binary='';for(let i=0;i<data.length;i+=32768)binary+=String.fromCharCode(...data.subarray(i,i+32768));
    const first=job.outline.pages[0],pdf=new window.jspdf.jsPDF({unit:'pt',format:[first.width,first.height],orientation:first.width>first.height?'l':'p',compress:true,putOnlyUsedFonts:true});
    pdf.addFileToVFS('Probe.ttf',btoa(binary));pdf.addFont('Probe.ttf','Probe','normal');pdf.setFont('Probe');
    for(let i=0;i<job.pages.length;i++){
      const page=job.pages[i],size=job.outline.pages[i];if(i)pdf.addPage([size.width,size.height],size.width>size.height?'l':'p');
      for(const box of page.boxes){pdf.setFillColor(...rgb(box.color));pdf.rect(box.x,box.y,box.w,box.h,'F');}
      for(const t of page.text){pdf.setFont('Probe');pdf.setFontSize(t.size);pdf.setTextColor(...rgb(t.color));pdf.text(t.char,t.x,t.y);}
      for(const image of page.images){if(/^data:image\/(png|jpeg)/.test(image.src))pdf.addImage(image.src,image.x,image.y,image.w,image.h);}
      for(const svg of page.svgs){const el=new DOMParser().parseFromString(svg.xml,'image/svg+xml').documentElement;await pdf.svg(el,{x:svg.x,y:svg.y,width:svg.w,height:svg.h});}
    }
    const result=await addPdfOutline(pdf.output('arraybuffer'),job.outline);
    const blob=new Blob([result.bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`probe-${kind}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    status.textContent=`已一次下载：${result.pages} 页 · ${result.count} 个书签 · ${(blob.size/1024).toFixed(0)} KB · ${((performance.now()-begin)/1000).toFixed(2)} 秒。\n实验限制：单字体、未完整实现字重／边框／链接与 SVG foreignObject，不能据此认定排版一致。`;
  }catch(error){status.textContent=error.stack;}
  finally{exportButton.disabled=false;document.querySelector('#prepare').disabled=false;}
};
