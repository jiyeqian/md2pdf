// 从当前分页结果冻结位置；用户选择与此预览对应的打印 PDF。
export function captureOutline(doc) {
  const pages = [...doc.querySelectorAll('.pagedjs_page')];
  if (!pages.length) throw new Error('请先完成分页预览。');
  const seen = new Set(), entries = [];
  const sizes = pages.map((page, pageIndex) => {
    const rect = page.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) throw new Error('无法读取预览页面尺寸。');
    for (const node of page.querySelectorAll('.pagedjs_page_content h1, .pagedjs_page_content h2, .pagedjs_page_content h3, .pagedjs_page_content h4, .pagedjs_page_content h5, .pagedjs_page_content h6')) {
      const title = node.textContent.replace(/\s+/g, ' ').trim();
      const box = node.getBoundingClientRect();
      const id = node.getAttribute('data-ref') || node.id;
      if (!title || box.height === 0 || (id && seen.has(id))) continue;
      if (id) seen.add(id);
      entries.push({ title, level:Number(node.tagName.slice(1)), pageIndex, top:Math.max(0, Math.min(1, (box.top - rect.top) / rect.height)) });
    }
    return { width:rect.width * 72 / 96, height:rect.height * 72 / 96 };
  });
  return { title:doc.title, pages:sizes, entries };
}

export async function addPdfOutline(bytes, snapshot) {
  if (!snapshot?.entries?.length || !snapshot.pages?.length) throw new Error('打印预览中没有可用的标题大纲。');
  const { PDFDocument, PDFName, PDFHexString } = await import('./vendor/pdf-lib/pdf-lib.mjs');
  let pdf;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata:false }); }
  catch { throw new Error('无法读取 PDF，请选择刚才完整打印保存的未加密 PDF。'); }
  const pages = pdf.getPages();
  if (pages.length !== snapshot.pages.length) throw new Error(`PDF 为 ${pages.length} 页，打印预览为 ${snapshot.pages.length} 页。请选择刚才完整保存的 PDF。`);
  pages.forEach((page, i) => {
    const box = page.getCropBox(), expected = snapshot.pages[i];
    if (page.getRotation().angle % 360 !== 0 || Math.abs(box.width - expected.width) > 2 || Math.abs(box.height - expected.height) > 2) {
      throw new Error(`PDF 第 ${i + 1} 页的方向或纸张尺寸与预览不同。请按预览纸张、100% 缩放保存 PDF。`);
    }
  });
  const context = pdf.context;
  const root = { children:[], ref:context.nextRef() };
  const stack = [root];
  for (const entry of snapshot.entries) {
    if (!Number.isInteger(entry.pageIndex) || !pages[entry.pageIndex] || !Number.isInteger(entry.level) || entry.level < 1 || entry.level > 6 || !Number.isFinite(entry.top) || entry.top < 0 || entry.top > 1) throw new Error('大纲位置无效，请重新打印当前文档。');
    while (stack.length > 1 && stack.at(-1).level >= entry.level) stack.pop();
    const parent = stack.at(-1);
    const node = { ...entry, parent, ref:context.nextRef(), children:[] };
    parent.children.push(node); stack.push(node);
  }
  function write(parent) {
    let count = 0;
    parent.children.forEach((node, i, siblings) => {
      const descendants = write(node);
      const page = pages[node.pageIndex], box = page.getCropBox();
      const data = {
        Title:PDFHexString.fromText(node.title), Parent:parent.ref,
        Dest:context.obj([page.ref, PDFName.of('XYZ'), null, box.y + box.height * (1 - node.top), null]),
      };
      if (i) data.Prev = siblings[i-1].ref;
      if (i + 1 < siblings.length) data.Next = siblings[i+1].ref;
      if (node.children.length) {
        data.First = node.children[0].ref; data.Last = node.children.at(-1).ref; data.Count = descendants;
      }
      context.assign(node.ref, context.obj(data));
      count += descendants + 1;
    });
    return count;
  }
  const count = write(root);
  context.assign(root.ref, context.obj({ Type:'Outlines', First:root.children[0].ref, Last:root.children.at(-1).ref, Count:count }));
  pdf.catalog.set(PDFName.of('Outlines'), root.ref);
  pdf.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  // 不绘制、重排或栅格化任何页面，也不触发表单外观重建。
  return { bytes:await pdf.save({ useObjectStreams:false, updateFieldAppearances:false }), count, pages:pages.length };
}
