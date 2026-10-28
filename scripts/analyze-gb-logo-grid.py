"""Measure complete dots and compare staggered-grid hypotheses in source GB masks."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
NAMES = ['GB:T 48316—2026.pdf', 'GB 48319—2026.pdf', 'GB:T 48300—2026.pdf', 'GB:Z 295.2—2026.pdf']

def complete_dots(mask):
    seen = np.zeros_like(mask)
    points = []
    h, w = mask.shape
    for y, x in np.argwhere(mask):
        if seen[y, x]:
            continue
        stack = [(int(x), int(y))]; seen[y, x] = True; component = []
        while stack:
            xx, yy = stack.pop(); component.append((xx, yy))
            for nx, ny in ((xx-1, yy), (xx+1, yy), (xx, yy-1), (xx, yy+1)):
                if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True; stack.append((nx, ny))
        if 14 <= len(component) <= 40:
            a = np.array(component); lo = a.min(0); hi = a.max(0); size = hi-lo+1
            if 4 <= size.min() and size.max() <= 8:
                # Pixel centers, not integer pixel corner coordinates.
                points.append(a.mean(0)+.5)
    return np.array(points)

def summary(error):
    norm = np.linalg.norm(error, axis=1)
    return {'count': len(norm), 'rmsPixels': float(np.sqrt(np.mean(norm**2))),
            'p95Pixels': float(np.quantile(norm, .95)), 'maxPixels': float(norm.max())}

def fit(points):
    rows = np.rint((points[:, 1]-17)/12.35)
    best = (-1,)
    for pitch in np.arange(12, 12.61, .01):
        for shift in np.arange(5, 8, .02):
            phase = np.mean(np.exp(2j*np.pi*(points[:, 0]-shift*rows)/pitch))
            if abs(phase) > best[0]:
                best = (abs(phase), pitch, shift, np.angle(phase)*pitch/(2*np.pi))
    _, pitch, shift, origin = best
    columns = np.rint((points[:, 0]-shift*rows-origin)/pitch)
    affine = np.array([np.ones(len(points)), columns, rows]).T
    coef = np.linalg.lstsq(affine, points, rcond=None)[0]
    regular = np.array([np.ones(len(points)), columns+.5*rows]).T
    cx = np.linalg.lstsq(regular, points[:, 0], rcond=None)[0]
    cy = np.linalg.lstsq(np.array([np.ones(len(points)), rows]).T, points[:, 1], rcond=None)[0]
    predicted = np.column_stack((regular@cx, cy[0]+cy[1]*rows))
    return {'origin': coef[0].tolist(), 'u': coef[1].tolist(), 'v': coef[2].tolist(),
            'affineResidual': summary(points-affine@coef),
            'halfShiftHorizontalResidual': summary(points-predicted),
            'halfShiftHorizontalParameters': {'origin': [float(cx[0]), float(cy[0])],
                                               'pitch': float(cx[1]), 'rowHeight': float(cy[1])}}, affine

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--covers', type=Path, required=True)
    parser.add_argument('--report', type=Path, default=ROOT/'docs/gb-logo-grid-measurements.json')
    args = parser.parse_args(); records = []
    for name in NAMES:
        source = args.covers/name
        reader = PdfReader(source)
        obj = next(v.get_object() for v in reader.pages[0]['/Resources']['/XObject'].values()
                   if v.get_object().get('/Subtype') == '/Image' and v.get_object().get('/Width') == 948)
        assert obj['/ImageMask'] and obj['/Height'] == 474 and list(obj.get('/Decode', [0, 1])) == [0, 1]
        mask = ~np.array(Image.frombytes('1', (948, 474), obj.get_data()))
        points = complete_dots(mask)
        global_fit, _ = fit(points)
        regions = {}
        for label, selected in [('G', points[:, 0] < 480), ('B', points[:, 0] >= 480)]:
            p = points[selected]; result, design = fit(p)
            # Spatially interleaved holdout: do not report training error as prediction error.
            train = np.arange(len(p)) % 3 != 0
            coeff = np.linalg.lstsq(design[train], p[train], rcond=None)[0]
            result['heldOutResidual'] = summary(p[~train]-design[~train]@coeff)
            u, v = np.array(result['u']), np.array(result['v'])
            result['rowAngleDegrees'] = float(np.degrees(np.arctan2(u[1], u[0])))
            result['adjacentRowShiftOverPitch'] = float(v[0]/u[0])
            result['adjacentRowForwardAngleDegrees'] = float(np.degrees(np.arctan2(v[1], v[0])))
            result['adjacentRowBackwardAngleDegrees'] = float(np.degrees(np.arctan2((v-u)[1], (v-u)[0])))
            result['secondaryDiagonalAnglesDegrees'] = [float(np.degrees(np.arctan2(q[1], q[0]))) for q in [u+2*v, -3*u+2*v]]
            result['rowHeightOverPitch'] = float(v[1]/u[0])
            regions[label] = result
        records.append({'file': name, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                        'decodedMaskSha256': hashlib.sha256(obj.get_data()).hexdigest(),
                        'global': global_fit, 'regions': regions})
    output = {'coordinateSystem': '948 x 474; top-left origin; pixel centers at n+0.5',
              'method': '4-connected isolated ink components, area14..40, bbox4..8; integer grid assignment then least squares',
              'limitations': 'Source masks are nearly identical, not independent design originals; component selection excludes clipped/merged dots.',
              'sources': records}
    args.report.write_text(json.dumps(output, ensure_ascii=False, indent=2)+'\n')
    for k, v in records[0]['regions'].items():
        print(k, json.dumps(v, ensure_ascii=False))

if __name__ == '__main__':
    main()
