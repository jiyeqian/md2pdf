"""Reproduce the audited fixed banner from the exact source PDFs in its manifest."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--covers', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
manifest = json.loads((ROOT / 'docs/gb-cover-banner-manifest.json').read_text())
ns = {'s': 'http://www.w3.org/2000/svg'}
href = '{http://www.w3.org/1999/xlink}href'
selected = None
with tempfile.TemporaryDirectory(prefix='gb-banner-') as temp:
    for index, source in enumerate(manifest['sources']):
        pdf = args.covers / source['file']
        if hashlib.sha256(pdf.read_bytes()).hexdigest() != source['sha256']:
            raise ValueError(f'Source hash mismatch: {pdf}')
        svg = Path(temp) / f'{index}.svg'
        subprocess.run(['pdftocairo', '-f', '1', '-l', '1', '-svg', str(pdf), str(svg)], check=True)
        root = ET.parse(svg).getroot()
        definitions = {node.get('id'): node for node in root.findall('.//*[@id]', ns)}
        uses = [node for node in root.findall('.//s:use', ns)
                if node.get(href, '').startswith('#glyph') and 110 < float(node.get('y', '0')) < 160]
        if len(uses) != len(source['glyphs']):
            raise ValueError(f'Unexpected banner glyph count: {pdf}')
        glyphs = []
        for use, expected in zip(uses, source['glyphs']):
            paths = [path.get('d') for path in definitions[use.get(href)[1:]].findall('.//s:path', ns)]
            if hashlib.sha256('\n'.join(paths).encode()).hexdigest() != expected['outlineSha256']:
                raise ValueError(f'Outline mismatch: {pdf}, {expected["char"]}')
            origin = [float(use.get('x')), float(use.get('y'))]
            if origin != expected['originPt']:
                raise ValueError(f'Origin mismatch: {pdf}, {expected["char"]}')
            glyphs.append((paths, origin))
        if index == 0:
            selected = glyphs

box = manifest['sourceInkBoundsPt']
scale = manifest['glyphScale']
spacing = manifest['addedOriginSpacingPt']
width = manifest['targetMm']['width'] * 72 / 25.4
height = manifest['targetMm']['height'] * 72 / 25.4
lines = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.9f} {height:.9f}" class="gb-cover-banner" aria-hidden="true">']
for index, (paths, origin) in enumerate(selected):
    for path in paths:
        lines.append(f'<path transform="translate({index*spacing:.9f} 0) scale({scale:.12f}) translate({origin[0]-box["x"]:.9f} {origin[1]-box["y"]:.9f})" d="{path}"/>')
lines.append('</svg>')
result = '\n'.join(lines) + '\n'
if hashlib.sha256(result.encode()).hexdigest() != manifest['assetSha256']:
    raise ValueError('Generated asset hash mismatch; inspect tool/version differences before accepting changes')
args.output.write_text(result)
print('PASS: all five sources verified; banner SVG reproduced with identical SHA-256')
