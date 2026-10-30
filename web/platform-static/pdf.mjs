import { withGbFontFallback } from './src/gb-fonts.mjs';
import { renderDocument } from './runtime.mjs';
import { documentDownloadName, sanitizeDownloadFileName } from './editor-files.mjs';
let active;

export async function exportPdf(body) {
  if (active) throw new Error('打印窗口正在打开，请先完成或取消当前打印。');
  const frame = document.createElement('iframe');
  frame.title = 'PDF 打印文档';
  frame.className = 'static-print-frame';
  frame.setAttribute('aria-hidden','true');
  frame.setAttribute('sandbox','allow-scripts allow-modals');
  const id = crypto.randomUUID();
  const job = {frame}; active = job;
  let timer, receive;
  function cleanup() {
    clearTimeout(timer);
    window.removeEventListener('message',receive);
    frame.remove();
    if(active===job)active=null;
  }
  try {
    const result = await renderDocument(body,false);
    const suggested = sanitizeDownloadFileName(body.filename, 'pdf') || documentDownloadName(body.md, new Date(), 'pdf', result.type);
    const printTitle = suggested.replace(/\.pdf$/i, '').replace(/&/g, '&amp;');
    const ready = new Promise((resolve,reject)=>{
      timer=setTimeout(()=>{cleanup();reject(new Error('排版超时，请缩短文档后重试。'));},65000);
      receive=event=>{
        if(event.source!==frame.contentWindow||event.data?.id!==id)return;
        if(event.data.type==='print-error'){cleanup();reject(Object.assign(new Error(event.data.error), event.data.fonts ? {code:'FONT_MISSING',fonts:event.data.fonts} : {}));}
        if(event.data.type==='print-ready'){
          clearTimeout(timer);
          frame.dataset.pages=String(event.data.pages || '');
          frame.contentWindow.postMessage({type:'print',id},'*');
        }
        if(event.data.type==='print-started')resolve();
        if(event.data.type==='print-finished')cleanup();
      };
      window.addEventListener('message',receive);
    });
    // 保持与预览相同的文档隔离；只允许当前任务触发打印，不开放同源访问。
    const bridge=`<script>(()=>{const id=${JSON.stringify(id)};const send=(type,error,pages)=>parent.postMessage({type,id,error,pages,fonts:window.__md2pdfFontError?.fonts},'*');addEventListener('afterprint',()=>send('print-finished'),{once:true});addEventListener('message',e=>{if(e.source!==parent||e.data?.id!==id||e.data.type!=='print')return;send('print-started');try{focus();print();}catch(error){send('print-error',error.message);}});const start=Date.now();function ready(){if(!window.__md2pdfAllowFontFallback&&['GB_FONT_MISSING','FONT_MISSING'].includes(window.__md2pdfFontError?.code)){send('print-error','未能加载字体：'+window.__md2pdfFontError.fonts.join('、')+'。');return;}if(window.__md2pdfPagedError||window.__md2pdfMermaidError||window.__md2pdfMathError){send('print-error','公式、图表或分页失败，请检查文档。');return;}if(window.__md2pdfPagedReady===true&&window.__md2pdfMathReady!==false&&window.__md2pdfMermaidReady!==false){send('print-ready',undefined,document.querySelectorAll('.pagedjs_page').length);return;}if(Date.now()-start>60000){send('print-error','排版超时，请缩短文档后重试。');return;}setTimeout(ready,100);}ready();})();</script>`;
    frame.srcdoc=(body.allowFontFallback ? withGbFontFallback(result.html) : result.html).replace(/<title>[\s\S]*?<\/title>/, () => '<title>'+printTitle+'</title>').replace('</body>',bridge+'</body>');
    document.body.append(frame);
    await ready;
  } catch(error) {cleanup();throw error;}
}
