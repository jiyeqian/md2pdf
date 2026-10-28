"""Build a visual comparison of the preserved baseline, normalized equations and source mask."""
import json
from pathlib import Path
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
ROOT=Path(__file__).resolve().parent.parent
m=json.loads((ROOT/'docs/gb-logo-parametric-model.json').read_text())
r=json.loads((ROOT/'docs/gb-logo-parametric-measurements.json').read_text())
c=canvas.Canvas(str(ROOT/'output/pdf/gb-logo-parametric-comparison.pdf'),pagesize=(297*mm,210*mm),invariant=1)
c.setTitle('GB logo: source, preserved v1 and equation-driven v2')
c.setFont('Helvetica-Bold',16);c.drawString(10*mm,195*mm,'GB logo: source / preserved v1 / parametric v2')
files=['/private/tmp/gb-logo-reference.png','/private/tmp/gb-logo-candidate-4x.png','/private/tmp/gb-logo-parametric-4x.png']
for x,label,file in zip([10,106,202],['Source: GB/T 48316-2026','Preserved v1: individual dot positions','V2: two affine dot grids'],files):
 c.setFont('Helvetica',10);c.drawString(x*mm,182*mm,label)
 c.drawImage(file,x*mm,132*mm,width=85*mm,height=42.5*mm)
c.setFont('Helvetica',10)
for k,line in enumerate([
 'V2 is an independent normalized candidate; the production logo is unchanged.',
 f'Fixed-canvas binary IoU: v1 {r["baselineSvgIoU"]*100:.3f}%; v2 {r["sources"][0]["svgIoU"]*100:.3f}%. V2 does not meet the v1 >=97% target.',
 f'Uniform centered stroke: {m["lineWidth"]*40/948:.6f} mm. Dot diameter: {2*m["circleRadius"]*40/948:.6f} mm.',
 'The grid is regular affine, but source measurements do not support exact half-pitch staggering; secondary diagonals are near 45/135 degrees.'
]):c.drawString(10*mm,(120-k*6)*mm,line)
c.drawImage('/private/tmp/gb-logo-parametric-background.png',10*mm,16*mm,width=150*mm,height=75*mm)
c.setFont('Helvetica',10)
for k,line in enumerate(['Colored-background transparency check:', 'Both B counters show the background.', 'No white paint or bitmap in the logo SVG/PDF.',f'SVG/PDF 4x IoU: {r["pdf"]["svgPdfIoU4x"]*100:.3f}%.', 'Exact-size standalone PDF: 40 x 20 mm.', 'Pixel error is not a standards compliance score.']):c.drawString(170*mm,(83-k*9)*mm,line)
c.showPage();c.setFont('Helvetica-Bold',15);c.drawString(10*mm,195*mm,'Shared junctions: source (left) and v2 (right)')
source=Image.open(files[0]);candidate=Image.open(files[2])
for k,j in enumerate(m['junctions']):
 col=k%3;row=k//3;x=10+col*96;y=175-row*57
 c.setFont('Helvetica',9);c.drawString(x*mm,y*mm,j['name'])
 px,py=j['point'];box=(round(px-24),round(py-24),round(px+24),round(py+24))
 for n,img in enumerate([source,candidate]):
  scale=img.width/948;crop=img.crop(tuple(round(t*scale) for t in box));file=Path(f'/private/tmp/gb-parametric-junction-{k}-{n}.png');crop.save(file)
  c.drawImage(str(file),(x+n*43)*mm,(y-44)*mm,width=40*mm,height=40*mm)
 c.setStrokeColorRGB(.7,.7,.7);c.rect(x*mm,(y-44)*mm,83*mm,40*mm,stroke=1,fill=0)
c.showPage();c.save()
print('Built output/pdf/gb-logo-parametric-comparison.pdf')
