"""Draw the candidate model as vector PDF on an exact 40 x 20 mm page (ReportLab required)."""
import argparse
import json
from pathlib import Path
import re
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm

ROOT=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--model',type=Path,default=ROOT/'docs/gb-logo-reconstruction-model.json')
parser.add_argument('--output',type=Path,default=ROOT/'output/pdf/gb-logo-candidate-40x20.pdf')
args=parser.parse_args()
m=json.loads(args.model.read_text())
c=canvas.Canvas(str(args.output),pagesize=(40*mm,20*mm),invariant=1)
c.setTitle('GB logo geometric reconstruction candidate')
c.translate(0,20*mm);c.scale(40*mm/948,-20*mm/474)
c.setLineJoin(1)
def path(data):
    result=c.beginPath()
    for d in data:
        tokens=iter(re.findall(r'[MLHVCZ]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?',d))
        x=y=0
        for cmd in tokens:
            if cmd=='M':x,y=float(next(tokens)),float(next(tokens));start=(x,y);result.moveTo(x,y)
            elif cmd=='L':x,y=float(next(tokens)),float(next(tokens));result.lineTo(x,y)
            elif cmd=='H':x=float(next(tokens));result.lineTo(x,y)
            elif cmd=='V':y=float(next(tokens));result.lineTo(x,y)
            elif cmd=='C':
                values=[float(next(tokens)) for _ in range(6)];result.curveTo(*values);x,y=values[-2:]
            elif cmd=='Z':result.close();x,y=start
            else:raise ValueError(f'Unsupported path token: {cmd}')
    return result

def fill(data,color):
    c.setFillColorRGB(color,color,color)
    c.drawPath(path(data),fill=1,stroke=0,fillMode=1)
fill(m['silhouettes'],0)
c.saveState();c.clipPath(path(m['silhouettes']),fill=0,stroke=0,fillMode=1)
fill(m['facets'],1)
c.saveState();c.clipPath(path(m['facets']),fill=0,stroke=0,fillMode=1);c.setFillColorRGB(0,0,0)
for x,y in m['dots']:c.circle(x,y,m['circleRadius'],fill=1,stroke=0)
c.restoreState();c.setStrokeColorRGB(0,0,0)
for d,width in zip(m['facets'],m['facetStrokeWidths']):
    if width:
        c.setLineWidth(width);c.drawPath(path([d]),fill=0,stroke=1)
c.setLineWidth(m['silhouetteStrokeWidth']);c.drawPath(path(m['silhouettes']),fill=0,stroke=1)
c.restoreState();fill(m['counters'],1)
c.showPage();c.save()
print(f'Built exact 40 x 20 mm vector PDF: {args.output}')
