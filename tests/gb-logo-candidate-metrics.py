"""Compare the independent GB reconstruction to 2026 source masks; requires numpy, Pillow, pypdf, pdfplumber."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
import numpy as np
from PIL import Image
from pypdf import PdfReader
import pdfplumber
ROOT=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--covers',type=Path,required=True)
parser.add_argument('--candidate-png',type=Path,default=Path('/private/tmp/gb-logo-candidate.png'))
parser.add_argument('--report',type=Path,default=ROOT/'docs/gb-logo-reconstruction-measurements.json')
args=parser.parse_args()
def sha(data):return hashlib.sha256(data).hexdigest()
def silhouette(a):
    h,w=a.shape;outside=np.zeros_like(a);stack=[]
    for x in range(w):
        for y in [0,h-1]:
            if not a[y,x] and not outside[y,x]:outside[y,x]=True;stack.append((x,y))
    for y in range(h):
        for x in [0,w-1]:
            if not a[y,x] and not outside[y,x]:outside[y,x]=True;stack.append((x,y))
    while stack:
        x,y=stack.pop()
        for xx,yy in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
            if 0<=xx<w and 0<=yy<h and not a[yy,xx] and not outside[yy,xx]:outside[yy,xx]=True;stack.append((xx,yy))
    return ~outside

def edge(a):
    p=np.pad(a,1);er=a&p[1:-1,:-2]&p[1:-1,2:]&p[:-2,1:-1]&p[2:,1:-1]
    return np.argwhere(a&~er)
def distance(a,b):
    return np.concatenate([np.sqrt(((a[i:i+128,None,:]-b[None,:,:])**2).sum(2).min(1)) for i in range(0,len(a),128)])
model=json.loads((ROOT/'docs/gb-logo-reconstruction-model.json').read_text())
candidate=np.array(Image.open(args.candidate_png).convert('L'))<128
assert candidate.shape==(474,948)
records=[]
for name in ['GB:T 48316—2026.pdf','GB 48319—2026.pdf','GB:T 48300—2026.pdf','GB:Z 295.2—2026.pdf']:
    file=args.covers/name;reader=PdfReader(file)
    key,obj=next((str(k),v.get_object()) for k,v in reader.pages[0]['/Resources']['/XObject'].items() if v.get_object().get('/Subtype')=='/Image')
    assert obj['/Width']==948 and obj['/Height']==474 and obj['/ImageMask'] and obj['/BitsPerComponent']==1
    assert list(obj.get('/Decode',[0,1]))==[0,1]
    reference=~np.array(Image.frombytes('1',(948,474),obj.get_data()))
    if name.startswith('GB:T 48316'):
        primary_reference=reference.copy()
        Image.fromarray(np.where(reference,0,255).astype(np.uint8)).save('/private/tmp/gb-logo-reference.png')
    A=edge(silhouette(reference));B=edge(silhouette(candidate));ds=np.r_[distance(A,B),distance(B,A)]
    iou=float(np.sum(reference&candidate)/np.sum(reference|candidate));coverage=float((candidate.mean()-reference.mean())*100)
    record={'file':name,'page':1,'pdfSha256':sha(file.read_bytes()),'object':key,'decodedStreamSha256':sha(obj.get_data()),
            'visibleBlackMaskSha256':sha(reference.tobytes()),'pixelIoU':iou,'xorPixels':int(np.sum(reference!=candidate)),
            'blackCoverageDifferencePercentagePoints':coverage,'outerSilhouetteEdgeP95Pixels':float(np.quantile(ds,.95)),
            'outerSilhouetteEdgeMaxPixels':float(ds.max())}
    target=model['acceptanceTargets']
    record['pass']=iou>=target['pixelIoUMin'] and abs(coverage)<=target['blackCoverageDifferenceMaxPercentagePoints'] and record['outerSilhouetteEdgeP95Pixels']<=target['outerEdgeP95MaxPixels']
    records.append(record)
with pdfplumber.open(ROOT/'output/pdf/gb-logo-candidate-40x20.pdf') as pdf:
    assert len(pdf.pages)==1
    page=pdf.pages[0];assert not page.images and not page.chars,'standalone candidate must be vector without fonts'
    assert abs(page.width*25.4/72-40)<.0001 and abs(page.height*25.4/72-20)<.0001
    pdf_audit={'paperMm':[page.width*25.4/72,page.height*25.4/72],'images':0,'textCharacters':0,'vectorObjects':len(page.curves)+len(page.rects),
               'sha256':sha((ROOT/'output/pdf/gb-logo-candidate-40x20.pdf').read_bytes())}
for factor in [1,4]:
    prefix=f'/private/tmp/gb-logo-native-pdf-{factor}'
    subprocess.run(['pdftoppm','-f','1','-singlefile','-scale-to-x',str(948*factor),'-scale-to-y',str(474*factor),'-png',str(ROOT/'output/pdf/gb-logo-candidate-40x20.pdf'),prefix],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    raster=np.array(Image.open(prefix+'.png').convert('L'))<128
    svgmask=candidate if factor==1 else np.array(Image.open('/private/tmp/gb-logo-candidate-4x.png').convert('L'))<128
    pdf_audit[f'rasterVsSvgIoU_{factor}x']=float(np.sum(raster&svgmask)/np.sum(raster|svgmask))
    if factor==1:
        pdf_audit['rasterVsPrimarySampleIoU']=float(np.sum(raster&primary_reference)/np.sum(raster|primary_reference))
assert pdf_audit['rasterVsSvgIoU_4x']>.99,'independent SVG/PDF geometry must agree at high resolution'
report={'kind':'independent reconstructed candidate, not extracted native vector and not production replacement',
        'svgSha256':sha((ROOT/'assets/candidates/gb-logo-reconstruction.svg').read_bytes()),
        'modelSha256':sha((ROOT/'docs/gb-logo-reconstruction-model.json').read_bytes()),
        'productionLogoSha256':sha((ROOT/'assets/gb-logo.svg').read_bytes()),
        'rasterMaskSha256':sha(candidate.tobytes()),'circleCount':len(model['dots']),'circleDiameterMm':model['circleRadius']*2*40/948,
        'pixelSizeMm':40/948,'threshold':128,'alignment':'fixed 948x474 canvas; no image registration or post-hoc scale/translation fit',
        'targetScope':'SVG rendered by recorded Chrome at 948x474, threshold 128; PDF has a separate physical geometry and high-resolution cross-renderer check',
        'targets':model['acceptanceTargets'],'browser':json.loads(Path('/private/tmp/gb-logo-browser.json').read_text())['browser'],
        'sources':records,'nativePdf':pdf_audit}
args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
assert all(r['pass'] for r in records),records
print('PASS: four sample masks; fixed-canvas IoU, black coverage and outer silhouette distances; native-size vector-only PDF')
