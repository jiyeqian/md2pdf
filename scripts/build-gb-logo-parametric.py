"""Generate the normalized GB candidate from piecewise Bezier geometry and affine dot grids."""
import argparse
import sys
sys.dont_write_bytecode = True
import json
import math
import re
from pathlib import Path
import xml.etree.ElementTree as ET

from gb_logo_topology import boundary_graph, path as edge_path

ROOT = Path(__file__).resolve().parent.parent
RECT = 'M0 0 H948 V474 H0 Z'

def grid_points(grid, radius=2.75):
    ox, oy = grid['origin']; ux, uy = grid['u']; vx, vy = grid['v']
    xlo, xhi = grid['xRange']
    det = ux*vy-uy*vx
    if abs(det) < 1e-9:
        raise ValueError('Degenerate dot grid')
    indices = []
    for x in (xlo-radius, xhi+radius):
        for y in (-radius, 474+radius):
            dx, dy = x-ox, y-oy
            indices.append(((vy*dx-vx*dy)/det, (-uy*dx+ux*dy)/det))
    imin = math.floor(min(p[0] for p in indices)); imax = math.ceil(max(p[0] for p in indices))
    jmin = math.floor(min(p[1] for p in indices)); jmax = math.ceil(max(p[1] for p in indices))
    for j in range(jmin, jmax+1):
        for i in range(imin, imax+1):
            x, y = ox+i*ux+j*vx, oy+i*uy+j*vy
            if xlo-radius <= x <= xhi+radius and -radius <= y <= 474+radius:
                yield x, y

def commands(d):
    tokens = iter(re.findall(r'[MLHVCZ]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?', d))
    x = y = 0
    for cmd in tokens:
        if cmd in ('M', 'L'):
            x, y = float(next(tokens)), float(next(tokens)); start = (x, y) if cmd == 'M' else start
            yield cmd, (x, y)
        elif cmd == 'H':
            x = float(next(tokens)); yield 'L', (x, y)
        elif cmd == 'V':
            y = float(next(tokens)); yield 'L', (x, y)
        elif cmd == 'C':
            values = tuple(float(next(tokens)) for _ in range(6)); x, y = values[-2:]; yield cmd, values
        elif cmd == 'Z':
            x, y = start; yield cmd, ()
        else:
            raise ValueError(cmd)

def validate_model(m):
    if m.get('schemaVersion') != 3 or m['canvas'] != [948,474] or m['targetMm'] != [40,20]:
        raise ValueError('Expected normalized GB schema 3 on the canonical 948x474 / 40x20 mm canvas')
    if m['lineWidth'] <= 0 or m['circleRadius'] <= 0:
        raise ValueError('Widths and radii must be positive')

def build_svg(m, output):
    validate_model(m)
    ns = 'http://www.w3.org/2000/svg'; ET.register_namespace('', ns)
    def node(parent, tag, **attrs):
        return ET.SubElement(parent, '{'+ns+'}'+tag, {k.replace('_', '-'): str(v) for k, v in attrs.items()})
    def paths(parent, data):
        for d in data: node(parent, 'path', d=d)
    svg = ET.Element('{'+ns+'}svg', {'viewBox':'0 0 948 474', 'width':'40mm', 'height':'20mm',
                                  'role':'img', 'aria-label':'GB 参数化几何候选'})
    defs = node(svg, 'defs')
    paths(node(defs, 'clipPath', id='letters'), m['silhouettes'])
    paths(node(defs, 'clipPath', id='faces'), m['facets'])
    for index, d in enumerate(m['facets']):
        node(node(defs, 'clipPath', id=f'outside-face-{index}'), 'path', d=RECT+' '+d, clip_rule='evenodd')
    node(node(defs, 'clipPath', id='outside-counters'), 'path', d=RECT+' '+' '.join(m['counters']), clip_rule='evenodd')
    ink = node(node(svg, 'g', fill='#000', clip_path='url(#outside-counters)'), 'g', clip_path='url(#letters)')
    letter = node(ink, 'g')
    base = node(letter, 'g')
    for index in range(len(m['facets'])):
        base = node(base, 'g', clip_path=f'url(#outside-face-{index})')
    paths(base, m['silhouettes'])
    dots = node(letter, 'g', clip_path='url(#faces)')
    for grid in m['grids']:
        group = node(dots, 'g', **{'data-grid':grid['name']})
        for x, y in grid_points(grid, m['circleRadius']):
            node(group, 'circle', cx=f'{x:.6f}', cy=f'{y:.6f}', r=m['circleRadius'])
    edges, joints = boundary_graph(m)
    bands = node(ink, 'g', **{'data-layer':'boundary-bands'})
    strokes = node(bands, 'g', fill='none', stroke='#000', stroke_linecap='butt', stroke_linejoin='bevel')
    for width in sorted({e['strokeWidth'] for e in edges}):
        data=' '.join(edge_path([e['points']]) for e in edges if e['strokeWidth']==width)
        node(strokes, 'path', d=data, stroke_width=width)
    for joint in joints:
        ps = joint['polygon']
        if len(ps)>2:
            node(bands, 'path', d='M'+' L'.join(' '.join(f'{v:.8f}' for v in p) for p in ps)+' Z',
                 **{'data-junction':','.join(str(v) for v in joint['point'])})
    ET.indent(svg, space='  '); output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(ET.tostring(svg, encoding='unicode')+'\n')

def build_pdf(m, output):
    validate_model(m)
    from reportlab.pdfgen import canvas
    from reportlab.lib.units import mm
    output.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(output), pagesize=(40*mm, 20*mm), invariant=1)
    c.setTitle('GB parametric geometric candidate')
    c.translate(0, 20*mm); c.scale(40*mm/948, -20*mm/474)
    def path(data):
        p = c.beginPath()
        for d in data:
            for cmd, v in commands(d):
                if cmd == 'M': p.moveTo(*v)
                elif cmd == 'L': p.lineTo(*v)
                elif cmd == 'C': p.curveTo(*v)
                elif cmd == 'Z': p.close()
        return p
    c.clipPath(path([RECT]+m['counters']), fill=0, stroke=0, fillMode=0)
    c.clipPath(path(m['silhouettes']), fill=0, stroke=0, fillMode=1)
    c.setFillColorRGB(0, 0, 0); c.saveState()
    for d in m['facets']: c.clipPath(path([RECT, d]), fill=0, stroke=0, fillMode=0)
    c.drawPath(path(m['silhouettes']), fill=1, stroke=0, fillMode=1); c.restoreState()
    c.saveState(); c.clipPath(path(m['facets']), fill=0, stroke=0, fillMode=1)
    for grid in m['grids']:
        for x, y in grid_points(grid, m['circleRadius']): c.circle(x, y, m['circleRadius'], fill=1, stroke=0)
    c.restoreState()
    edges, joints = boundary_graph(m)
    c.setStrokeColorRGB(0, 0, 0); c.setLineCap(0); c.setLineJoin(2)
    for width in sorted({e['strokeWidth'] for e in edges}):
        c.setLineWidth(width)
        c.drawPath(path([edge_path([e['points']]) for e in edges if e['strokeWidth']==width]), fill=0, stroke=1)
    for joint in joints:
        ps = joint['polygon']
        if len(ps)>2:
            d='M'+' L'.join(' '.join(f'{v:.8f}' for v in p) for p in ps)+' Z'
            c.drawPath(path([d]),fill=1,stroke=0)
    c.showPage(); c.save()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, default=ROOT/'docs/gb-logo-parametric-model.json')
    parser.add_argument('--svg', type=Path, default=ROOT/'assets/candidates/gb-logo-parametric.svg')
    parser.add_argument('--pdf', type=Path)
    args = parser.parse_args(); model = json.loads(args.model.read_text())
    build_svg(model, args.svg)
    if args.pdf: build_pdf(model, args.pdf)
    print(f'Built {args.svg}; uniform visible band width {model["lineWidth"]} (centered strokes w / 2w); {len(model["grids"])} affine grids')
