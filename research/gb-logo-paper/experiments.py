"""Reproduce paper experiments without changing deployed GB resources.

Usage: python experiments.py prepare --covers PATH; node capture.mjs;
       python experiments.py analyze --covers PATH
Required: numpy, Pillow, pypdf, pdfplumber, reportlab, node/Chrome, pdftoppm.
"""
import argparse, copy, csv, hashlib, importlib.util, json, math, platform, subprocess, sys
from pathlib import Path
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
ROOT=HERE.parent.parent
DATA=HERE/'data'; FIG=HERE/'figures'
sys.path.insert(0,str(ROOT/'scripts'))
import numpy as np
from PIL import Image
from pypdf import PdfReader
import pdfplumber
from gb_logo_topology import boundary_graph

def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
builder=module('builder',ROOT/'scripts/build-gb-logo-parametric.py')
gridlib=module('gridlib',ROOT/'scripts/analyze-gb-logo-grid.py')
NAMES=['GB:T 48316—2026.pdf','GB 48319—2026.pdf','GB:T 48300—2026.pdf','GB:Z 295.2—2026.pdf']
INPUT_FILES=['docs/gb-logo-parametric-model.json','docs/gb-logo-parametric-v2-model.json','docs/gb-logo-reconstruction-model.json','scripts/build-gb-logo-parametric.py','scripts/gb_logo_topology.py','assets/candidates/gb-logo-parametric.svg','assets/candidates/gb-logo-parametric-v2.svg','assets/candidates/gb-logo-reconstruction.svg']

def load(path):return json.loads(path.read_text())
def save(path,obj):path.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
def sha(data):return hashlib.sha256(data).hexdigest()
def sources(covers):
 records=[];masks=[]
 for name in NAMES:
  p=covers/name;reader=PdfReader(p)
  obj=next(v.get_object() for v in reader.pages[0]['/Resources']['/XObject'].values() if v.get_object().get('/Subtype')=='/Image' and v.get_object().get('/Width')==948)
  assert obj['/Height']==474 and obj['/ImageMask'] and list(obj.get('/Decode',[0,1]))==[0,1]
  raw=obj.get_data();mask=~np.array(Image.frombytes('1',(948,474),raw));masks.append(mask)
  records.append({'file':name,'pdfSha256':sha(p.read_bytes()),'decodedStreamSha256':sha(raw),'maskSha256':sha(mask.tobytes()),'blackPixels':int(mask.sum())})
 return records,masks

def prepare(covers):
 DATA.mkdir(exist_ok=True,parents=True);FIG.mkdir(exist_ok=True)
 records,masks=sources(covers);save(DATA/'sources.json',records)
 save(DATA/'inputs-before.json',{name:sha((ROOT/name).read_bytes()) for name in INPUT_FILES})
 Image.fromarray(np.where(masks[0],0,255).astype('uint8')).save(DATA/'reference.png')
 m=load(ROOT/'docs/gb-logo-parametric-model.json');jobs=[];specs=[]
 def job(name,svg,scale=1,background='white'):
  jobs.append({'name':name,'svg':str(svg),'png':str(DATA/(name+'.png')),'scale':scale,'background':background})
 for label,file in [('v1','gb-logo-reconstruction.svg'),('v2','gb-logo-parametric-v2.svg'),('v3','gb-logo-parametric.svg')]:
  job(label,ROOT/'assets/candidates'/file)
 for scale in [2,4]:job(f'v3-{scale}x',ROOT/'assets/candidates/gb-logo-parametric.svg',scale)
 job('v2-4x',ROOT/'assets/candidates/gb-logo-parametric-v2.svg',4)
 for part in ['silhouettes','counters']:
  svg=DATA/(part+'.svg');svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 948 474">'+''.join('<path d="'+d+'"/>' for d in m[part])+'</svg>');job(part+'-4x',svg,4)
 job('v3-cyan',ROOT/'assets/candidates/gb-logo-parametric.svg',1,'#24b8c8')
 for wi in range(9):
  for ri in range(5):
   w=1.5+.25*wi;r=2.5+.125*ri;n=f'sweep-w{w:g}-r{r:g}'
   mm=copy.deepcopy(m);mm.update(lineWidth=w,circleRadius=r)
   svg=DATA/(n+'.svg');builder.build_svg(mm,svg);job(n,svg);specs.append({'name':n,'width':w,'radius':r})
 # Keep scalar/grid geometry fixed: only erase the explicit endpoint patches.
 import xml.etree.ElementTree as ET
 tree=ET.parse(ROOT/'assets/candidates/gb-logo-parametric.svg')
 for parent in tree.iter():
  for child in list(parent):
   if 'data-junction' in child.attrib:parent.remove(child)
 no=DATA/'no-patches.svg';tree.write(no,encoding='unicode');job('no-patches',no,4);job('no-patches-1x',no)
 half=copy.deepcopy(m)
 for g in half['grids']:g['u'][1]=0;g['v'][0]=g['u'][0]/2
 builder.build_svg(half,DATA/'half-shift.svg');job('half-shift',DATA/'half-shift.svg')
 builder.build_pdf(m,DATA/'v3-40x20.pdf')
 save(DATA/'jobs.json',jobs);save(DATA/'sweep-specs.json',specs)
 print(f'Prepared {len(jobs)} jobs, 45 finite-grid parameter combinations')

def black(path):return np.array(Image.open(path).convert('L'))<128

def score(a,b):
 inter=int((a&b).sum());union=int((a|b).sum())
 return {'iou':inter/union,'xorPixels':int((a!=b).sum()),'missingBlack':int((a&~b).sum()),'extraBlack':int((b&~a).sum()),'coverageDifferencePP':float((b.mean()-a.mean())*100)}

def normstats(errors):
 d=np.linalg.norm(errors,axis=1)
 return {'n':len(d),'rmsPx':float(np.sqrt(np.mean(d*d))),'p95Px':float(np.quantile(d,.95)),'maxPx':float(d.max())}

def grids(mask):
 pts=gridlib.complete_dots(mask)
 _,design=gridlib.fit(pts)
 # Every hypothesis uses the same globally inferred integer i,j labels.
 groups=(pts[:,0]>=480).astype(float)
 one=np.ones(len(pts));i=design[:,1];j=design[:,2]
 X=np.column_stack([one,i,j]);Xs=np.column_stack([one,groups,i,j])
 Xtwo=np.column_stack([one,groups,i*(1-groups),j*(1-groups),i*groups,j*groups])
 # Separate affine fits recover each region's globally assigned integer phase.
 # Shared labels make the independent/shared basis comparison nested and fair.
 def fitpredict(kind,train):
  if kind=='half-shift':
   Xx=np.column_stack([one,groups,(i+.5*j)*(1-groups),(i+.5*j)*groups])
   Xy=np.column_stack([one,groups,j*(1-groups),j*groups])
   x=Xx@np.linalg.lstsq(Xx[train],pts[train,0],rcond=None)[0]
   y=Xy@np.linalg.lstsq(Xy[train],pts[train,1],rcond=None)[0]
   return np.column_stack([x,y])
  xx={'global-affine':X,'shared-basis':Xs,'two-affine':Xtwo}[kind]
  return xx@np.linalg.lstsq(xx[train],pts[train],rcond=None)[0]
 records=[];residuals={};rng=np.random.default_rng(20261029)
 # Identical split permutations for every hypothesis.
 splits=[rng.permutation(len(pts))[:int(len(pts)*2/3)] for _ in range(30)]
 for kind,k in [('global-affine',6),('shared-basis',8),('two-affine',12),('half-shift',8)]:
  pred=fitpredict(kind,np.arange(len(pts)));error=pts-pred;residuals[kind]=np.linalg.norm(error,axis=1)
  random=[]
  for tr in splits:
   held=np.setdiff1d(np.arange(len(pts)),tr);e=pts-fitpredict(kind,tr);random.append(normstats(e[held])['rmsPx'])
  blocked=[]
  # Four contiguous horizontal y-bands; integer labels remain conditional.
  bins=np.digitize(pts[:,1],np.quantile(pts[:,1],[.25,.5,.75]))
  for q in range(4):
   tr=np.where(bins!=q)[0];te=np.where(bins==q)[0]
   e=pts-fitpredict(kind,tr);blocked.append(normstats(e[te])['rmsPx'])
  records.append({'model':kind,'scalarParameters':k,'fit':normstats(error),'randomConditionalRmsMeanPx':float(np.mean(random)),'randomConditionalRmsSDPx':float(np.std(random,ddof=1)),'blockedConditionalRmsMeanPx':float(np.mean(blocked)),'blockedConditionalRmsMaxPx':max(blocked)})
 rows=[]
 for label,selected in [('G',pts[:,0]<480),('B',pts[:,0]>=480)]:
  fit,_=gridlib.fit(pts[selected]);rows.append({'region':label,**fit})
 save(DATA/'dot-centers.json',pts.tolist())
 return records,residuals,rows

def analyze(covers):
 records,masks=sources(covers);ref=masks[0]
 assert records==load(DATA/'sources.json'),'Source cover changed after prepare'
 assert load(DATA/'inputs-before.json')=={name:sha((ROOT/name).read_bytes()) for name in INPUT_FILES},'Source model/generator changed after prepare'
 versions=[]
 for v in ['v1','v2','v3']:
  a=black(DATA/(v+'.png'));versions.append({'version':v,**score(ref,a),'perSource':[score(s,a) for s in masks]})
 sweep=[];best=0
 for spec in load(DATA/'sweep-specs.json'):
  s=score(ref,black(DATA/(spec['name']+'.png')));best=max(best,s['iou']);sweep.append({**spec,**s,'cumulativeBestIoU':best})
 winner=max(sweep,key=lambda s:s['iou']);m=load(ROOT/'docs/gb-logo-parametric-model.json')
 mm=copy.deepcopy(m);mm.update(lineWidth=winner['width'],circleRadius=winner['radius'])
 mm['boundaryConstruction']['width']=winner['width']
 mm['selection']={'method':'2026-10-29 v3 finite 45-candidate w/r sweep, fixed geometry and grid, native Chrome raster IoU',
                  'width':winner['width'],'radius':winner['radius'],'iou':winner['iou'],'deployed':False,
                  'limitations':'Best only within the recorded grid and renderer; coverage bias increases; not a global optimum or original design recovery.'}
 save(DATA/'experimental-best-model.json',mm)
 ablations=[{'variant':'v3',**score(ref,black(DATA/'v3.png'))},{'variant':'without-junction-patches',**score(ref,black(DATA/'no-patches-1x.png'))},{'variant':'strict-half-shift-fixed-phase',**score(ref,black(DATA/'half-shift.png'))}]
 scales=[]
 for scale in [1,2,4]:
  prefix=DATA/f'pdf-{scale}x'
  subprocess.run(['pdftoppm','-singlefile','-scale-to-x',str(948*scale),'-scale-to-y',str(474*scale),'-png',str(DATA/'v3-40x20.pdf'),str(prefix)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  svg=black(DATA/('v3.png' if scale==1 else f'v3-{scale}x.png'));pdf=black(prefix.with_suffix('.png'))
  scales.append({'scale':scale,**score(svg,pdf)})
 gridrec,residuals,regions=grids(ref)
 thresholds={str(t):{v:score(ref,np.array(Image.open(DATA/(v+'.png')).convert('L'))<t) for v in ['v1','v2','v3']} for t in [96,128,160]}
 direct_patch_difference={str(s):score(black(DATA/('v3.png' if s==1 else 'v3-4x.png')),black(DATA/('no-patches-1x.png' if s==1 else 'no-patches.png'))) for s in [1,4]}
 full=black(DATA/'v3-4x.png');silhouette=black(DATA/'silhouettes-4x.png');holes=black(DATA/'counters-4x.png');pad=np.pad(silhouette,1)
 guard=np.logical_or.reduce([pad[dy:dy+full.shape[0],dx:dx+full.shape[1]] for dy in range(3) for dx in range(3)])
 hp=np.pad(holes,1);inside=holes&hp[:-2,1:-1]&hp[2:,1:-1]&hp[1:-1,:-2]&hp[1:-1,2:]
 rasterTopology={'rawOutsideSilhouette':int((full&~silhouette).sum()),'outsideOneDevicePixelGuard':int((full&~guard).sum()),'blackInsideErodedHoles':int((full&inside).sum())}
 assert rasterTopology['outsideOneDevicePixelGuard']==0 and rasterTopology['blackInsideErodedHoles']==0
 sourcepair=[]
 for a in range(4):
  for b in range(a+1,4):sourcepair.append({'a':NAMES[a],'b':NAMES[b],**score(masks[a],masks[b])})
 edges,joints=boundary_graph(m)
 with pdfplumber.open(DATA/'v3-40x20.pdf') as pdf:
  page=pdf.pages[0];pdfaudit={'sizeMm':[page.width*25.4/72,page.height*25.4/72],'images':len(page.images),'chars':len(page.chars),'curves':len(page.curves)}
 cyan=np.array(Image.open(DATA/'v3-cyan.png').convert('RGB'))
 transparency={f'{x},{y}':cyan[y,x].tolist() for x,y in [(700,148),(700,328),(470,100)]}
 assert all(v==[36,184,200] for v in transparency.values())
 inputs=INPUT_FILES
 result={'protocol':{'canvas':[948,474],'blackThreshold':128,'alignment':'fixed native canvas, no registration','sweep':'45 combinations, ordered width then radius; finite grid, no gradient training','gridEvaluation':'Integer row/column labels inferred globally; all holdouts are conditional on those labels. Random holdout 30 repeats, fixed seed20261029, train2/3; blocked four horizontal quartile bands.','python':platform.python_version(),'numpy':np.__version__,'browser':load(DATA/'browser.json'),'sourceScope':'four nearly identical masks, no independent design test set'},'thresholdSensitivity':thresholds,'patchDirectDifference':direct_patch_difference,'rasterTopology':rasterTopology,'sources':records,'sourcePairs':sourcepair,'uniqueDecodedStreams':len(set(r['decodedStreamSha256'] for r in records)),'versions':versions,'sweep':sweep,'best':winner,'ablations':ablations,'gridModels':gridrec,'regionFits':regions,'scaleParity':scales,'pdfAudit':pdfaudit,'transparencyProbes':transparency,'topology':{'uniqueEdges':len(edges),'nodes':len(joints),'patchMaxRadius':max(math.dist(j['point'],q) for j in joints for q in j['polygon'])},'inputSha256':{name:sha((ROOT/name).read_bytes()) for name in inputs}}
 assert max(s['iou'] for s in sweep)==winner['iou']
 assert abs(versions[2]['iou']-0.9299161848660049)<1e-12
 assert len(sweep)==45 and len(gridrec)==4 and gridrec[0]['fit']['n']==842
 assert pdfaudit['images']==0 and pdfaudit['chars']==0
 assert len(edges)==49 and len(joints)==41
 result['validation']={'finiteSweepCount':45,'reproducedV3HistoricalIoU':True,'pureVectorLogoPdf':True,'sourceDesignIndependent':False,'sourceModelsUnchangedDuringAnalysis':load(DATA/'inputs-before.json')==result['inputSha256']}
 save(DATA/'results.json',result)
 save(DATA/'manifest.json',{'sourceInputs':result['inputSha256'],'sourceCovers':records,'outputs':{str(p.relative_to(HERE)):sha(p.read_bytes()) for p in [DATA/'results.json',DATA/'dot-centers.json',DATA/'experimental-best-model.json']},'generatorSha256':sha(Path(__file__).read_bytes()),'captureSha256':sha((HERE/'capture.mjs').read_bytes())})
 with (DATA/'parameter-sweep.csv').open('w') as f:
  w=csv.DictWriter(f,fieldnames=sweep[0].keys(),lineterminator='\n');w.writeheader();w.writerows(sweep)
 figures(result,residuals)
 manifest=load(DATA/'manifest.json');manifest['outputs'].update({str(p.relative_to(HERE)):sha(p.read_bytes()) for p in [DATA/'parameter-sweep.csv',*sorted(FIG.glob('*.png'))]});save(DATA/'manifest.json',manifest)
 print(json.dumps({k:result[k] for k in ['versions','best','ablations','gridModels','scaleParity']},ensure_ascii=False,indent=2))

# Vector charts rendered with ReportLab and Poppler: no screenshot annotation.
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
COLORS={'blue':(.12,.30,.47),'gold':(.70,.39,.12),'teal':(.0,.48,.45),'red':(.73,.18,.16),'gray':(.48,.50,.53)}

def figures(result,residuals):
 def start(name,w=720,h=400):
  p=DATA/(name+'.pdf');c=canvas.Canvas(str(p),pagesize=(w,h),invariant=1);return c,p
 def end(c,p):
  c.showPage();c.save();subprocess.run(['pdftoppm','-singlefile','-r','180','-png',str(p),str(FIG/p.stem)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 def label(c,x,y,t,size=10,color=(.1,.1,.1)):
  c.setFillColorRGB(*color);c.setFont('Helvetica',size+2);c.drawString(x,y,str(t))
 def axis(c,x,y,w,h,xlim,ylim,xticks,yticks,xlabel,ylabel):
  c.setStrokeColorRGB(.2,.2,.2);c.setLineWidth(.7);c.line(x,y,x+w,y);c.line(x,y,x,y+h)
  def xy(a,b):return x+(a-xlim[0])/(xlim[1]-xlim[0])*w,y+(b-ylim[0])/(ylim[1]-ylim[0])*h
  for v in xticks:
   xx,_=xy(v,ylim[0]);c.line(xx,y,xx,y-3);label(c,xx-6,y-15,f'{v:g}',8)
  for v in yticks:
   _,yy=xy(xlim[0],v);c.setStrokeColorRGB(.87,.88,.89);c.line(x,yy,x+w,yy);label(c,x-31,yy-3,f'{v:g}',8)
  label(c,x+w/2-35,y-48,xlabel,9);label(c,x,y+h+13,ylabel,9)
  return xy
 def line(c,xy,points,color,width=1.7):
  c.setStrokeColorRGB(*color);c.setLineWidth(width);p=c.beginPath()
  for k,(a,b) in enumerate(points):
   xx,yy=xy(a,b);p.moveTo(xx,yy) if k==0 else p.lineTo(xx,yy)
  c.drawPath(p)
 # Full visual comparison.
 c,p=start('fig01-reconstruction',720,445)
 for k,(name,title) in enumerate([('reference','(a) Source mask'),('v1','(b) v1: measured centers'),('v2','(c) v2: regularized model'),('v3','(d) v3: shared boundaries')]):
  x=25+(k%2)*355;y=238-(k//2)*212
  c.drawImage(str(DATA/(name+'.png')),x,y,width=330,height=165);label(c,x,y-17,title,11)
 end(c,p)
 # Detail and difference maps.
 c,p=start('fig02-junctions',720,440)
 boxes=[(225,161,315,310),(514,210,575,265),(810,35,885,110)]
 for j,box in enumerate(boxes):
  for i,name in enumerate(['v2','v3']):
   img=Image.open(DATA/(name+'-4x.png')).crop(tuple(v*4 for v in box)).convert('RGB')
   x=35+j*235;y=235-i*190;c.drawImage(ImageReader(img),x,y,width=200,height=155,preserveAspectRatio=True,anchor='c');label(c,x,y-15,f'{name}: detail {j+1}',10)
 end(c,p)
 # Parameter heatmap and radius profiles.
 c,p=start('fig03-parameter-search',720,365)
 widths=sorted(set(s['width'] for s in result['sweep']));radii=sorted(set(s['radius'] for s in result['sweep']));vals={ (s['width'],s['radius']):s['iou']*100 for s in result['sweep']};lo=min(vals.values());hi=max(vals.values())
 label(c,42,335,'(a) Finite-grid IoU (%)',12)
 for iy,w in enumerate(widths):
  for ix,r in enumerate(radii):
   v=vals[(w,r)];q=(v-lo)/(hi-lo);c.setFillColorRGB(.94-.80*q,.96-.49*q,.98-.30*q);c.rect(48+ix*48,56+iy*27,48,27,fill=1,stroke=0);label(c,53+ix*48,65+iy*27,f'{v:.2f}',8,(1,1,1) if q>.6 else (.1,.1,.1))
 for ix,r in enumerate(radii):label(c,55+ix*48,39,f'{r:g}',9)
 for iy,w in enumerate(widths):label(c,19,66+iy*27,f'{w:g}',9)
 label(c,105,18,'Circle radius r (px)',10);label(c,20,310,'w (px)',9)
 xy=axis(c,390,60,295,240,(2.5,3),(91.5,93.5),radii,[91.5,92,92.5,93,93.5],'Circle radius r (px)','(b) IoU (%)')
 for k,w in enumerate([1.5,2.5,3.5]):
  color=[COLORS['blue'],COLORS['gold'],COLORS['teal']][k];line(c,xy,[(r,vals[(w,r)]) for r in radii],color);label(c,420+k*85,337,f'w={w:g}',9,color)
 end(c,p)
 # Conditional error model comparisons and ECDF.
 c,p=start('fig04-grid-models',720,365)
 models=result['gridModels'];x0,y0=58,65;maxy=6
 xy=axis(c,x0,y0,285,235,(0,4),(0,maxy),[],[0,1,2,3,4,5,6],'Models (parameter count)','(a) Center RMS error (px)')
 legends=[('fit','rmsPx',COLORS['blue']),('random','randomConditionalRmsMeanPx',COLORS['gold']),('blocked','blockedConditionalRmsMeanPx',COLORS['teal'])]
 for i,m in enumerate(models):
  for j,(_,key,color) in enumerate(legends):
   value=m['fit'][key] if j==0 else m[key];xx,yy=xy(i+.16+j*.21,0);_,top=xy(0,value);c.setFillColorRGB(*color);c.rect(xx,yy,12,top-yy,fill=1,stroke=0)
   if j==1:
    sd=m['randomConditionalRmsSDPx'];_,low=xy(0,value-sd);_,high=xy(0,value+sd);c.setStrokeColorRGB(.1,.1,.1);c.setLineWidth(.8);c.line(xx+6,low,xx+6,high);c.line(xx+3,low,xx+9,low);c.line(xx+3,high,xx+9,high)
  for row,t in enumerate([m['model'].replace('-',' '),f"({m['scalarParameters']})"]):label(c,x0+i*71,y0-16-row*11,t,7)
 for k,(text,_,color) in enumerate(legends):label(c,65+k*95,342,text,9,color)
 xy=axis(c,405,65,280,235,(0,8),(0,1),[0,2,4,6,8],[0,.25,.5,.75,1],'Center residual (px)','(b) Empirical cumulative probability')
 for k,m in enumerate(models):
  e=np.sort(residuals[m['model']]);line(c,xy,list(zip(e,np.arange(1,len(e)+1)/len(e))),[COLORS['gray'],COLORS['gold'],COLORS['blue'],COLORS['red']][k]);label(c,555,140-k*13,m['model'],8,[COLORS['gray'],COLORS['gold'],COLORS['blue'],COLORS['red']][k])
 end(c,p)
 # Search convergence and cross-renderer scale parity.
 c,p=start('fig05-search-and-parity',720,340)
 ss=result['sweep'];xy=axis(c,55,60,285,225,(1,45),(92.2,93.3),[1,10,20,30,45],[92.2,92.4,92.6,92.8,93,93.2],'Evaluations (width-major order)','(a) Best observed IoU (%)')
 line(c,xy,[(i+1,s['cumulativeBestIoU']*100) for i,s in enumerate(ss)],COLORS['blue'])
 par=result['scaleParity'];xy=axis(c,405,60,275,225,(1,4),(97.5,100),[1,2,4],[97.5,98,98.5,99,99.5,100],'Raster scale factor','(b) SVG / PDF IoU (%)')
 line(c,xy,[(s['scale'],s['iou']*100) for s in par],COLORS['teal'])
 for s in par:
  x,y=xy(s['scale'],s['iou']*100);c.setFillColorRGB(*COLORS['teal']);c.circle(x,y,3,fill=1,stroke=0);label(c,x+4,y+5,f"{s['iou']*100:.3f}",8)
 end(c,p)
 # Source differences at native scale: exact extra and missing ink.
 c,p=start('fig06-difference',720,460)
 ref=black(DATA/'reference.png')
 for k,name in enumerate(['v1','v2','v3']):
  a=black(DATA/(name+'.png'));img=np.full((*a.shape,3),255,dtype=np.uint8);img[ref&a]=[30,36,45];img[ref&~a]=[37,107,163];img[a&~ref]=[195,63,44]
  x=25+(k%2)*355;y=250-(k//2)*215
  c.drawImage(ImageReader(Image.fromarray(img)),x,y,width=330,height=165);label(c,x,y-17,f'{name}: blue missing / red extra',10)
 c.drawImage(str(DATA/'v3-cyan.png'),380,35,width=330,height=165);label(c,380,18,'v3: true transparent counters on cyan',10)
 end(c,p)

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('phase',choices=['prepare','analyze']);parser.add_argument('--covers',type=Path,required=True);args=parser.parse_args()
 (prepare if args.phase=='prepare' else analyze)(args.covers)
