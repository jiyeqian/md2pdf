import { renderDocument } from './runtime.mjs';
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
    const ready = new Promise((resolve,reject)=>{
      timer=setTimeout(()=>{cleanup();reject(new Error('排版超时，请缩短文档后重试。'));},65000);
      receive=event=>{
        if(event.source!==frame.contentWindow||event.data?.id!==id)return;
        if(event.data.type==='print-error'){cleanup();reject(new Error(event.data.error));}
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
    const bridge=`<script>(()=>{const id=${JSON.stringify(id)};const send=(type,error,pages)=>parent.postMessage({type,id,error,pages},'*');addEventListener('afterprint',()=>send('print-finished'),{once:true});addEventListener('message',e=>{if(e.source!==parent||e.data?.id!==id||e.data.type!=='print')return;send('print-started');try{focus();print();}catch(error){send('print-error',error.message);}});const start=Date.now();function ready(){if(window.__md2pdfPagedError||window.__md2pdfMermaidError||window.__md2pdfMathError){send('print-error','公式、图表或分页失败，请检查文档。');return;}if(window.__md2pdfPagedReady===true&&window.__md2pdfMathReady!==false&&window.__md2pdfMermaidReady!==false){send('print-ready',undefined,document.querySelectorAll('.pagedjs_page').length);return;}if(Date.now()-start>60000){send('print-error','排版超时，请缩短文档后重试。');return;}setTimeout(ready,100);}ready();})();</script>`;
    frame.srcdoc=result.html.replace('</body>',bridge+'</body>');
    document.body.append(frame);
    await ready;
  } catch(error) {cleanup();throw error;}
}
