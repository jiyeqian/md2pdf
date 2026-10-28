"""Build the independent GB logo candidate from its recorded Bezier paths and equal-radius dots."""
import argparse
import json
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--model', type=Path, default=ROOT / 'docs/gb-logo-reconstruction-model.json')
parser.add_argument('--output', type=Path, default=ROOT / 'assets/candidates/gb-logo-reconstruction.svg')
args = parser.parse_args()
m = json.loads(args.model.read_text())
ns = 'http://www.w3.org/2000/svg'
ET.register_namespace('', ns)
def node(parent, tag, attributes):
    return ET.SubElement(parent, '{'+ns+'}'+tag, {key:str(value) for key,value in attributes.items()})
def paths(parent, data):
    for d in data:
        node(parent, 'path', {'d':d})
svg = ET.Element('{'+ns+'}svg', {'viewBox':'0 0 948 474','width':'40mm','height':'20mm',
                                'role':'img','aria-label':'GB 标志几何重建候选'})
defs = node(svg, 'defs', {})
paths(node(defs, 'clipPath', {'id':'letters'}), m['silhouettes'])
paths(node(defs, 'clipPath', {'id':'stipple-regions'}), m['facets'])
paths(node(svg, 'g', {'fill':'#000'}), m['silhouettes'])
faces = node(svg, 'g', {'clip-path':'url(#letters)'})
paths(node(faces, 'g', {'fill':'#fff'}), m['facets'])
dots = node(faces, 'g', {'fill':'#000','clip-path':'url(#stipple-regions)'})
for x,y in m['dots']:
    node(dots, 'circle', {'cx':x,'cy':y,'r':m['circleRadius']})
strokes = node(faces, 'g', {'fill':'none','stroke':'#000','stroke-linejoin':'round'})
for d,width in zip(m['facets'],m['facetStrokeWidths']):
    node(strokes, 'path', {'d':d,'stroke-width':width})
paths(node(faces, 'g', {'fill':'none','stroke':'#000','stroke-width':m['silhouetteStrokeWidth'],
                      'stroke-linejoin':'round'}),m['silhouettes'])
paths(node(svg, 'g', {'fill':'#fff'}),m['counters'])
ET.indent(svg, space='  ')
args.output.write_text(ET.tostring(svg, encoding='unicode')+'\n')
print(f'Built {args.output}: {len(m["dots"])} circles, one radius {m["circleRadius"]}')
