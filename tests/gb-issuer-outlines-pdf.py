"""Check actual PDF publisher glyph origins from painted vector contour starts (pdfplumber required)."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--pdf-dir', type=Path, default=Path('/private/tmp/md2pdf-gb-cover-e5'))
parser.add_argument('--report', type=Path, required=True)
args = parser.parse_args()
assets = json.loads((ROOT / 'assets/gb-issuer-outlines.json').read_text())
expected = json.loads((ROOT / 'tests/fixtures/gb-issuer-groups.json').read_text())
ns = {'s': 'http://www.w3.org/2000/svg'}
unit = 25.4/72
reports = []
for case, group, target in zip(['example', 'issuer-0', 'issuer-1'], assets['groups'], expected['groups']):
    assert group['names'] == target['names']
    for runtime in ['cli', 'node', 'static']:
        file = args.pdf_dir / f'{case}-{runtime}-1.pdf'
        with pdfplumber.open(file) as pdf:
            page = pdf.pages[0]
            # iter_layout_objects preserves paint order across curves and rectangles.
            shapes = [obj for obj in page.iter_layout_objects(page.layout._objs)
                      if obj['object_type'] in ['curve', 'rect'] and obj['top']*unit > 260]
            assert shapes and all(obj['fill'] for obj in shapes)
            assert not [obj for obj in page.images if obj['bottom']*unit > 260], 'Publisher region must be vector'
            starts = iter(shapes)
            rows = []
            for row in group['rows']:
                svg = ET.fromstring(row['svg'])
                origins = []
                baselines = []
                for glyph in svg.findall('.//s:g[@class="gb-issuer-glyph"]', ns):
                    inferred = []
                    for path in glyph.findall('./s:path', ns):
                        for contour in re.split(r'\bM\s+', path.get('d'))[1:]:
                            if not re.search(r'\b[LC]\b', contour):
                                continue  # Ignore non-painted trailing move commands.
                            x, y = map(float, contour.split()[:2])
                            actual = next(starts)['path'][0]
                            assert actual[0] == 'm'
                            inferred.append([(actual[1][0]-x)*unit, (actual[1][1]-y)*unit])
                    assert inferred
                    origin, baseline = inferred[0]
                    # Every contour in the glyph must imply the same origin.
                    assert all(abs(x-origin) < .03 and abs(y-baseline) < .03 for x, y in inferred)
                    origins.append(origin)
                    baselines.append(baseline)
                pitch = target['spanMm']/(len(origins)-1)
                assert all(abs(x-origins[0]-index*pitch) < expected['toleranceMm'] for index, x in enumerate(origins))
                assert max(baselines)-min(baselines) < .03
                rows.append({'name': row['name'], 'originXsMm': origins, 'baselineMm': baselines[0],
                             'spanMm': origins[-1]-origins[0]})
            assert next(starts, None) is None, 'Unexpected extra paint in publisher region'
            assert abs(rows[0]['originXsMm'][0]-rows[1]['originXsMm'][0]) < expected['toleranceMm'], (case, runtime, rows)
            assert abs(rows[0]['originXsMm'][-1]-rows[1]['originXsMm'][-1]) < expected['toleranceMm']
            assert abs(rows[1]['baselineMm']-rows[0]['baselineMm']-6.35) < .03
            reports.append({'case': case, 'runtime': runtime, 'source': target['source'],
                            'pdfSha256': hashlib.sha256(file.read_bytes()).hexdigest(),
                            'paintedContourCount': len(shapes), 'publisherRasterImageCount': 0,
                            'expectedSpanMm': target['spanMm'], 'rows': rows})
args.report.write_text(json.dumps({'measurement': 'Actual PDF painted contour starts minus original source contour offsets, no DOM or hidden text positions',
                                  'engineeringToleranceMm': expected['toleranceMm'], 'reports': reports}, ensure_ascii=False, indent=2)+'\n')
print('PASS: three groups × three runtimes; actual PDF vector glyph origins, 18pt baseline pitch, no raster publishers')
