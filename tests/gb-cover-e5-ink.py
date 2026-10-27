"""Measure dark pixels within independently located PDF element regions."""
import json
import sys
from PIL import Image

image = Image.open(sys.argv[1]).convert('L')
state = json.load(open(sys.argv[2]))
sx = sy = 600 / 25.4
ink = {'page': {'left': 0, 'top': 0, 'right': state['paperMm'][0], 'bottom': state['paperMm'][1]}}
for role, box in state['boxes'].items():
    if box is None:
        ink[role] = None
        continue
    # Isolate the element, retaining side bearings but not adjacent text (min gap 3mm).
    margin = 0.7
    vertical_margin = 0.2 if 'rule' in role else margin
    left = max(0, round((box['left'] - margin) * sx))
    top = max(0, round((box['top'] - vertical_margin) * sy))
    right = min(image.width, round((box['right'] + margin) * sx))
    bottom = min(image.height, round((box['bottom'] + vertical_margin) * sy))
    if role in ('issued', 'implementation'):
        bottom = min(bottom, round((state['boxes']['date-rule']['top'] - 0.25) * sy))
    bounds = image.crop((left, top, right, bottom)).point(lambda p: 255 if p < 128 else 0).getbbox()
    if bounds is None:
        raise ValueError(f'No PDF ink for {role}: {box}')
    x0, y0, x1, y1 = bounds
    if x0 == 0 or y0 == 0 or x1 == right-left or y1 == bottom-top:
        raise ValueError(f'Untrusted clipped ink for {role}: {bounds}')
    ink[role] = {'left': (left+x0)/sx, 'top': (top+y0)/sy,
                 'right': (left+x1)/sx, 'bottom': (top+y1)/sy,
                 'centerX': (2*left+x0+x1)/2/sx}
json.dump(ink, sys.stdout, ensure_ascii=False)
