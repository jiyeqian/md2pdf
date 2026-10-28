"""Verify the equation-generated SVG/PDF and record fixed-canvas differences from source masks."""
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
args=parser.parse_args()

def black(p): return np.array(Image.open(p).convert('L'))<128

def iou(a,b): return float((a&b).sum()/(a|b).sum())
svg=black('/private/tmp/gb-logo-parametric.png'); assert svg.shape==(474,948)
background=np.array(Image.open('/private/tmp/gb-logo-parametric-background.png').convert('RGB'))
for x,y in [(700,148),(700,328),(470,100)]:
    assert tuple(background[y,x])==(36,184,200),f'true transparent negative space at {x},{y}'
records=[]
for name in ['GB:T 48316—2026.pdf','GB 48319—2026.pdf','GB:T 48300—2026.pdf','GB:Z 295.2—2026.pdf']:
    source=args.covers/name; reader=PdfReader(source)
    obj=next(v.get_object() for v in reader.pages[0]['/Resources']['/XObject'].values()
             if v.get_object().get('/Subtype')=='/Image' and v.get_object().get('/Width')==948)
    assert obj['/ImageMask'] and list(obj.get('/Decode',[0,1]))==[0,1]
    reference=~np.array(Image.frombytes('1',(948,474),obj.get_data()))
    if not records: primary=reference
    records.append({'file':name,'pdfSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
                    'decodedMaskSha256':hashlib.sha256(obj.get_data()).hexdigest(),
                    'svgIoU':iou(svg,reference),'missingBlackPixels':int((reference&~svg).sum()),
                    'extraBlackPixels':int((svg&~reference).sum()),
                    'coverageDifferencePercentagePoints':float((svg.mean()-reference.mean())*100)})
file=ROOT/'output/pdf/gb-logo-parametric-40x20.pdf'
with pdfplumber.open(file) as pdf:
    assert len(pdf.pages)==1
    page=pdf.pages[0]; assert not page.images and not page.chars
    size=[page.width*25.4/72,page.height*25.4/72]
    assert max(abs(size[0]-40),abs(size[1]-20))<.0001
    for obj in page.curves:
        assert obj.get('non_stroking_color') in (0,(0,0,0),[0,0,0]),'PDF contains black ink only'
    vector_count=len(page.curves)
for scale in [1,4]:
    subprocess.run(['pdftoppm','-scale-to-x',str(948*scale),'-scale-to-y',str(474*scale),
                    '-singlefile','-png',str(file),f'/private/tmp/gb-parametric-pdf-{scale}'],check=True)
svg_hi=black('/private/tmp/gb-logo-parametric-4x.png')
pdf_hi=black('/private/tmp/gb-parametric-pdf-4.png')
parity=iou(svg_hi,pdf_hi); assert parity>.99,parity
baseline=json.loads((ROOT/'docs/gb-logo-reconstruction-measurements.json').read_text())
report={'status':'User-approved v3 deployed to GB template; reconstruction remains below v1 SVG IoU>=0.97 target',
        'sources':records,'baselineSvgIoU':baseline['sources'][0]['pixelIoU'],
        'pdf':{'sizeMm':size,'vectorObjects':vector_count,'images':0,'textCharacters':0,
               'svgPdfIoU4x':parity,'pdfSourceIoU1x':iou(black('/private/tmp/gb-parametric-pdf-1.png'),primary)},
        'sha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in
                  [ROOT/'assets/candidates/gb-logo-parametric.svg',ROOT/'docs/gb-logo-parametric-model.json',file]}}
(ROOT/'docs/gb-logo-parametric-measurements.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
assert all(r['svgIoU']>.90 for r in records),'regression guard only, not v1 acceptance'
print(json.dumps(report['sources'][0],ensure_ascii=False));print('PASS: true transparent counters, pure-vector exact-size PDF, SVG/PDF parity',parity)
