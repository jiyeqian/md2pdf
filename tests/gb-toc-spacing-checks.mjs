import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {render} from '../src/render.mjs';
import {Chrome,findChrome} from '../src/chrome.mjs';
const temp=await mkdtemp('/private/tmp/gb-toc-spacing-'),chrome=new Chrome(findChrome(),temp);
try {
 // A shallower contents fixture keeps both figure entries on one physical page.
 const source=(await readFile(new URL('../web/examples/gb.md',import.meta.url),'utf8')).replace('toc: 2','toc: 1');
 const result=await render(source,{type:'gb',pagedHtml:true});
 await chrome.start();
 await writeFile(temp+'/spacing.html',result.pagedHtml);
 await writeFile(temp+'/spacing.pdf',await chrome.print(temp+'/spacing.html',{...result.printOptions,waitPaged:true}));
 const report=execFileSync(process.env.PYTHON||'python3',['-c',`
import json,re,statistics,sys
import pdfplumber
with pdfplumber.open(sys.argv[1]) as d:
 p=d.pages[2]
 chars=[c for c in p.chars if re.fullmatch('[\\u4e00-\\u9fff]',c['text']) and 160<c['top']<770]
 rows=[]
 for c in sorted(chars,key=lambda c:p.height-c['matrix'][5]):
  y=p.height-c['matrix'][5]
  if not rows or y-rows[-1][0]>1: rows.append([y,[]])
  rows[-1][1].append(c)
 groups={'body':[],'figure':[],'table':[]}
 for y,cs in rows:
  text=''.join(c['text'] for c in sorted(cs,key=lambda c:c['x0']))
  kind='figure' if text.startswith('图') else 'table' if text.startswith('表') else 'body'
  groups[kind].append(y)
 out={}
 for kind,ys in groups.items():
  assert len(ys)>=2, (kind,'requires at least two actual PDF rows')
  steps=[round(b-a,4) for a,b in zip(ys,ys[1:])]
  assert all(abs(step-18.34)<0.5 for step in steps),(kind,steps)
  out[kind]={'rows':len(ys),'baseline_steps_pt':steps,'mean_pt':statistics.mean(steps)}
 print(json.dumps(out))
`,temp+'/spacing.pdf'],{encoding:'utf8'});
 const measured=JSON.parse(report);
 assert.deepEqual(Object.keys(measured),['body','figure','table']);
 await writeFile('/private/tmp/gb-toc-spacing-measurements.json',JSON.stringify(measured,null,2)+'\n');
 console.log('PASS: actual PDF body/figure/table baseline spacing; '+report.trim());
}finally{await chrome.stop();await rm(temp,{recursive:true,force:true});}
