import { renderDocument } from './runtime.mjs';
import { captureOutline, addPdfOutline } from './pdf-outline.mjs';
export async function exportPdf(body) {
  const dialog = document.createElement('dialog');
  dialog.className = 'template-confirm offline-pdf-dialog';
  dialog.innerHTML = '<h2>导出 PDF</h2><p>① 将下方文档完整打印保存为 PDF（使用文档纸张、100% 缩放，关闭浏览器附加页眉页脚）。② 选择刚保存的 PDF，补全可点击的大纲。</p><p role="status">正在准备本地排版…</p><iframe title="PDF 打印文档" sandbox="allow-scripts allow-modals"></iframe><div class="template-confirm-actions"><button type="button" class="template-confirm-cancel">关闭</button><button type="button" class="primary" data-print disabled>① 打印／另存为 PDF</button><button type="button" class="primary" data-outline disabled>② 选择 PDF 并补全大纲…</button><input type="file" accept=".pdf,application/pdf" hidden></div>';
  const status = dialog.querySelector('[role=status]'), frame = dialog.querySelector('iframe');
  const print = dialog.querySelector('[data-print]'), outline = dialog.querySelector('[data-outline]'), input = dialog.querySelector('input');
  const nonce = crypto.randomUUID();
  let snapshot, busy = false, outlineAllowed = true;
  function receive(event) {
    if (event.source !== frame.contentWindow || event.data?.id !== nonce) return;
    if (event.data.type === 'offline-pdf-error') {status.textContent=event.data.error; return;}
    if (event.data.type !== 'offline-pdf-ready') return;
    snapshot=event.data.snapshot;
    print.disabled=false; outline.disabled=!outlineAllowed || !snapshot.entries.length;
    status.textContent=`本地排版完成 · ${snapshot.pages.length} 页。${outlineAllowed ? '' : '当前文档已关闭 PDF 大纲。'}`;
  }
  window.addEventListener('message',receive);
  dialog.addEventListener('close',()=>{window.removeEventListener('message',receive);dialog.remove();},{once:true});
  dialog.querySelector('.template-confirm-cancel').addEventListener('click',()=>dialog.close());
  print.addEventListener('click',()=>frame.contentWindow.postMessage({type:'offline-pdf-print',id:nonce},'*'));
  outline.addEventListener('click',()=>{if(!busy){input.value='';input.click();}});
  input.addEventListener('change',async()=>{
    const file=input.files[0];if(!file || !snapshot || busy)return;
    busy=true;outline.disabled=true;status.textContent='正在本地补全 PDF 大纲…';
    try {
      const result=await addPdfOutline(await file.arrayBuffer(),snapshot);
      const name=file.name.replace(/\.pdf$/i,'')+'-含大纲.pdf';
      const blob=new File([result.bytes],name,{type:'application/pdf'});
      if(window.mdAppShell?.offerFile(blob)){dialog.close();return;}
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),10000);
      status.textContent=`已下载 · ${result.pages} 页 · ${result.count} 个大纲书签。`;
    } catch(error){status.textContent=error.message;}
    finally {busy=false;outline.disabled=false;}
  });
  document.body.append(dialog);dialog.showModal();
  try {
    const result=await renderDocument(body,false);outlineAllowed=result.outline!==false;
    if(!dialog.isConnected)return;
    const bridge=`<script>(()=>{const id=${JSON.stringify(nonce)};addEventListener('message',e=>{if(e.source===parent&&e.data?.id===id&&e.data.type==='offline-pdf-print')print();});const start=Date.now();function ready(){if(window.__md2pdfPagedError||window.__md2pdfMermaidError){parent.postMessage({type:'offline-pdf-error',id,error:'图表或分页失败，请检查文档。'},'*');return;}if(window.__md2pdfPagedReady===true&&window.__md2pdfMathReady!==false&&window.__md2pdfMermaidReady!==false){try{parent.postMessage({type:'offline-pdf-ready',id,snapshot:(${captureOutline.toString()})(document)},'*');}catch(error){parent.postMessage({type:'offline-pdf-error',id,error:error.message},'*');}return;}if(Date.now()-start>60000){parent.postMessage({type:'offline-pdf-error',id,error:'排版超时，请缩短文档后重试。'},'*');return;}setTimeout(ready,100);}ready();})();</script>`;
    frame.srcdoc=result.html.replace('</body>',bridge+'</body>');
  } catch(error){status.textContent=error.message;}
}
