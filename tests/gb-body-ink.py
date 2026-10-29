"""Measure actual PDF ink, using browser Range boxes only to locate crops."""
import argparse
import io
import json
from pathlib import Path
import re
import subprocess
import sys

from PIL import Image

HERE = Path(__file__).resolve().parent
ledger = json.loads((HERE / 'fixtures/gb-body-ledger.json').read_text())
rules, engineering = ledger['normative'], ledger['engineering']
dpi, threshold = engineering['dpi'], engineering['threshold']
scale = dpi / 25.4


def pdf_page_size(pdf, page):
    info = subprocess.check_output(['pdfinfo', '-f', str(page), '-l', str(page), str(pdf)], text=True)
    match = re.search(r'Page\s+(?:\d+\s+)?size:\s*([\d.]+)\s+x\s+([\d.]+)\s+pts', info)
    if not match:
        raise ValueError(f'{pdf} page {page}: no page size in pdfinfo')
    return [float(match.group(i)) * 25.4 / 72 for i in (1, 2)]


def raster(pdf, page):
    data = subprocess.check_output(['pdftoppm', '-f', str(page), '-l', str(page), '-r', str(dpi),
                                    '-singlefile', '-png', str(pdf)])
    return Image.open(io.BytesIO(data)).convert('L')


def measure(image, box, role):
    margin = engineering['crop_margin']
    left = max(0, round((box['left'] - margin) * scale))
    top = max(0, round((box['top'] - margin) * scale))
    right = min(image.width, round((box['right'] + margin) * scale))
    bottom = min(image.height, round((box['bottom'] + margin) * scale))
    bounds = image.crop((left, top, right, bottom)).point(lambda p: 255 if p < threshold else 0).getbbox()
    if not bounds:
        raise ValueError(f'{role}: no ink in crop {box}')
    x0, y0, x1, y1 = bounds
    if x0 == 0 or y0 == 0 or x1 == right-left or y1 == bottom-top:
        raise ValueError(f'{role}: ink touches crop boundary {bounds}, cannot establish full extent')
    return {'left': (left+x0)/scale, 'top': (top+y0)/scale,
            'right': (left+x1)/scale, 'bottom': (top+y1)/scale}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', nargs='?', default='/private/tmp/md2pdf-gb-body')
    parser.add_argument('--runtime', choices=['cli','node','static'], help='Measure a single supplied runtime instead of all three')
    args = parser.parse_args()
    directory = Path(args.directory)
    state = json.loads((directory / 'states.json').read_text())
    output = {'parameters': engineering, 'runtimes': {}, 'limitations': [
        'Range boxes locate crops; visual inspection and source/PDF identity remain necessary.',
        'Page area bounds come from the browser layout; header, footer and title coordinates come from PDF raster ink.',
    ]}
    failures = []
    expected_runtimes = {args.runtime} if args.runtime else {'cli', 'node', 'static'}
    if len(state) != len(expected_runtimes) or {item['runtime'] for item in state} != expected_runtimes:
        raise ValueError('states.json must contain each requested runtime exactly once')
    for runtime in state:
        name = runtime['runtime']
        if runtime.get('error') or runtime.get('audit', {}).get('problems'):
            raise ValueError(f'{name}: source browser state contains errors')
        pages = []
        output['runtimes'][name] = pages
        pdf = directory / f'{name}.pdf'
        for page in runtime['states']:
            num, boxes = page['page'], page['boxes']
            data = {'page': num, 'label': page['label'], 'kind': page['kind'], 'right': page['right'], 'checks': []}
            pages.append(data)
            def check(key, actual, target, tolerance):
                passed = abs(actual-target) <= tolerance
                data['checks'].append({'name': key, 'actual': round(actual, 3), 'target': target,
                                       'tolerance': tolerance, 'pass': passed})
                if not passed:
                    failures.append(f'{name} page {num} {key}: {actual:.3f}, expected {target} ± {tolerance} mm')
            width, height = pdf_page_size(pdf, num)
            check('paper_width', width, rules['paper']['width'], rules['paper']['tolerance'])
            check('paper_height', height, rules['paper']['height'], rules['paper']['tolerance'])
            if not page['label']:
                continue
            area = page['area']
            expected_left = rules['page_area']['odd_left'] if page['right'] else rules['page_area']['even_left']
            expected_right_margin = rules['page_area']['odd_right'] if page['right'] else rules['page_area']['even_right']
            check('area_left', area['left'], expected_left, engineering['position_tolerance'])
            check('area_right_margin', width-area['right'], expected_right_margin, engineering['position_tolerance'])
            check('area_width', area['right']-area['left'], rules['page_area']['width'], engineering['position_tolerance'])
            image = raster(pdf, num)
            ink = {role: measure(image, box, f'{name} page {num} {role}') for role, box in boxes.items() if box is not None}
            data['ink'] = ink
            tol = engineering['position_tolerance']
            header, footer = ink['header'], ink['footer']
            check('header_top', header['top'], rules['header']['top'], tol)
            check('header_outer', header['right'] if page['right'] else header['left'],
                  rules['header']['odd_right_coordinate'] if page['right'] else rules['header']['even_left_coordinate'], tol)
            check('footer_bottom', footer['bottom'], rules['footer']['bottom_coordinate'], tol)
            check('footer_outer_distance', width-footer['right'] if page['right'] else footer['left'], rules['footer']['outer_distance'], tol)
            if page['kind']:
                title, first = ink['title'], ink['first']
                check('header_to_title', title['top']-header['bottom'], rules['independent_title']['header_gap'], tol)
                check('title_to_first', first['top']-title['bottom'], rules['first_content_gap'][page['kind']], tol)
    output['failures'] = failures
    json.dump(output, sys.stdout, ensure_ascii=False, indent=2)
    print()
    return bool(failures)


if __name__ == '__main__':
    sys.exit(main())
