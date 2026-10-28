"""Compare the source, preserved v2 and repaired boundary graph, covering every graph node."""
import json
from pathlib import Path
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
ROOT=Path(__file__).resolve().parent.parent
m=json.loads((ROOT/'docs/gb-logo-parametric-model.json').read_text())
r=json.loads((ROOT/'docs/gb-logo-parametric-measurements.json').read_text())
t=json.loads((ROOT/'docs/gb-logo-topology-measurements.json').read_text())
v2=json.loads((ROOT/'docs/gb-logo-parametric-v2-measurements.json').read_text())
c=canvas.Canvas(str(ROOT/'output/pdf/gb-logo-parametric-comparison.pdf'),pagesize=(297*mm,210*mm),invariant=1)
c.setTitle('GB logo: complete boundary graph repair and inspection')
c.setFont('Helvetica-Bold',16);c.drawString(10*mm,195*mm,'GB logo: canonical curves and complete junction repair')
files=['/private/tmp/gb-logo-reference.png','/private/tmp/gb-logo-parametric-v2-4x.png','/private/tmp/gb-logo-parametric-4x.png']
for x,label,file in zip([10,106,202],['Source: GB/T 48316-2026','Preserved v2: closed-face miters','V3: shared edges and bounded joints'],files):
 c.setFont('Helvetica',10);c.drawString(x*mm,182*mm,label)
 c.drawImage(file,x*mm,132*mm,width=85*mm,height=42.5*mm)
c.setFont('Helvetica',10)
for k,line in enumerate([
 f'{t["edges"]} unique edges; {t["junctionCount"]} junctions; {t["sharedEdges"]} shared seams. Every junction is shown on the following pages.',
 f'Fixed-canvas SVG/source IoU: v1 {r["baselineSvgIoU"]*100:.3f}%; v2 {v2["sources"][0]["svgIoU"]*100:.3f}%; v3 {r["sources"][0]["svgIoU"]*100:.3f}%.',
 f'Unified visible band width: {m["lineWidth"]*40/948:.6f} mm. Same dot grids and radius as v2. Production logo unchanged.',
 f'No miter joins; all ink clipped to canonical letters. Raster containment uses a 1-device-pixel AA guard at 4x.'
]):c.drawString(10*mm,(120-k*6)*mm,line)
c.drawImage('/private/tmp/gb-logo-parametric-background.png',10*mm,16*mm,width=150*mm,height=75*mm)
c.setFont('Helvetica',10)
for k,line in enumerate(['Transparent background / counters verified.', 'Canonical letter and hole curves reused.', 'Shared straight edges split and deduplicated.', 'Junction polygon radius is bounded by w.',f'SVG/PDF 4x IoU: {r["pdf"]["svgPdfIoU4x"]*100:.3f}%.', 'V3 still falls below the v1 >=97% source target.']):c.drawString(170*mm,(83-k*9)*mm,line)
c.showPage()
before=Image.open(files[1]);after=Image.open(files[2]);nodes=t['junctions']
for offset in range(0,len(nodes),12):
 c.setFont('Helvetica-Bold',14);c.drawString(10*mm,197*mm,f'All junctions {offset+1}-{min(offset+12,len(nodes))}: v2 (left), v3 (right)')
 for local,j in enumerate(nodes[offset:offset+12]):
  col=local%3;row=local//3;x=10+col*96;y=185-row*44
  px,py=j['point'];c.setFont('Helvetica',8);c.drawString(x*mm,y*mm,f'#{offset+local+1}  ({px:.3f}, {py:.3f})  degree {j["degree"]}')
  for n,img in enumerate([before,after]):
   scale=img.width/948;box=(px-14,py-14,px+14,py+14)
   # Pad outside the canvas white rather than introducing PIL's black crop border.
   padded=Image.new('RGB',(img.width+128,img.height+128),'white');padded.paste(img,(64,64))
   crop=padded.crop(tuple(round(v*scale+64) for v in box))
   file=Path(f'/private/tmp/gb-logo-topology-node-{offset+local+1}-{n}.png');crop.save(file)
   c.drawImage(str(file),(x+n*40)*mm,(y-38)*mm,width=36*mm,height=36*mm)
 c.showPage()
c.save()
print(f'Built full-image comparison: 1 overview + {(len(nodes)+11)//12} junction pages')
