"""Extract the three audited publisher groups; requires pdfplumber, Poppler and project Chrome."""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
NS = {'s': 'http://www.w3.org/2000/svg'}
HREF = '{http://www.w3.org/1999/xlink}href'
SOURCES = [
    ('GB:T 48316—2026.pdf', ['国家市场监督管理总局', '国家标准化管理委员会']),
    ('GB:T 7714—2015.pdf', ['中华人民共和国国家质量监督检验检疫总局', '中国国家标准化管理委员会']),
    ('GB 7718—2025.pdf', ['中华人民共和国国家卫生健康委员会', '国家市场监督管理总局']),
]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--covers', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--manifest', type=Path, required=True)
args = parser.parse_args()
import pdfplumber


def digest(data):
    return hashlib.sha256(data).hexdigest()


def extract(file, names, directory):
    source = args.covers / file
    with pdfplumber.open(source) as pdf:
        page = pdf.pages[0]
        lines = []
        for char in sorted((c for c in page.chars if c['top'] > page.height*.85 and c['text'].strip()), key=lambda c: c['top']):
            row = next((r for r in lines if abs(r[0]['top']-char['top']) < 1.5), None)
            if row is None:
                lines.append([char])
            else:
                row.append(char)
        rows = []
        for line in lines:
            line.sort(key=lambda c: c['x0'])
            if ''.join(c['text'] for c in line) in names:
                rows.append(line)
        if [''.join(c['text'] for c in row) for row in rows] != names:
            raise ValueError(f'Publisher text mismatch: {file}')
        xs = [[c['x0']*25.4/72 for c in row] for row in rows]
    svg = directory / (file.replace('/', '_') + '.svg')
    subprocess.run(['pdftocairo', '-f', '1', '-l', '1', '-svg', str(source), str(svg)], check=True)
    root = ET.parse(svg).getroot()
    definitions = {node.get('id'): node for node in root.findall('.//*[@id]', NS)}
    baselines = defaultdict(list)
    for use in root.findall('.//s:use', NS):
        if use.get(HREF, '').startswith('#glyph') and float(use.get('y', '0')) > 730:
            baselines[float(use.get('y'))].append(use)
    candidates = [(y, line) for y, line in sorted(baselines.items()) if len(line) in {len(n) for n in names}]
    if len(candidates) != 2:
        raise ValueError(f'Ambiguous SVG publisher rows: {file}')
    result = []
    for name, row, (baseline, uses), origins in zip(names, rows, candidates, xs):
        uses.sort(key=lambda u: float(u.get('x')))
        if len(uses) != len(name):
            raise ValueError(f'Glyph count mismatch: {file}')
        glyphs = []
        for char, use in zip(name, uses):
            paths = [p.get('d') for p in definitions[use.get(HREF)[1:]].findall('.//s:path', NS)]
            if not paths:
                raise ValueError(f'Missing outline: {file}, {char}')
            glyphs.append({'char': char, 'paths': paths, 'outlineSha256': digest('\n'.join(paths).encode()),
                           'sourceOriginSvgPt': [float(use.get('x')), baseline]})
        result.append({'name': name, 'glyphs': glyphs, 'originXsMm': origins,
                       'font': sorted(set(c['fontname'] for c in row)), 'fontSizesPt': sorted(set(c['size'] for c in row))})
    return {'file': file, 'sha256': digest(source.read_bytes()), 'page': 1, 'rows': result}


with tempfile.TemporaryDirectory(prefix='gb-issuers-') as temp:
    directory = Path(temp)
    sources = [extract(file, names, directory) for file, names in SOURCES]
    checks = [extract(file, SOURCES[0][1], directory) for file in ['GB:T 1001.1—2021.pdf', 'GB:T 13000—2025.pdf', 'GB:T 42452—2023.pdf']]
    for sample in checks:
        for row, original in zip(sample['rows'], sources[0]['rows']):
            if [g['outlineSha256'] for g in row['glyphs']] != [g['outlineSha256'] for g in original['glyphs']]:
                raise ValueError(f'Cross-sample outline difference: {sample["file"]}')
    groups = []
    raw = []
    for source in sources:
        span = source['rows'][0]['originXsMm'][-1] - source['rows'][0]['originXsMm'][0]
        group = {'names': [r['name'] for r in source['rows']], 'spanMm': span, 'rows': []}
        for row in source['rows']:
            paths = ['<g class="gb-issuer-ink">']
            for index, glyph in enumerate(row['glyphs']):
                paths.append(f'<g class="gb-issuer-glyph" transform="translate({index*span/(len(row["glyphs"])-1):.12f} 0) scale({25.4/72:.12f})">')
                paths.extend(f'<path d="{d}"/>' for d in glyph['paths'])
                paths.append('</g>')
            paths.append('</g>')
            content = '\n'.join(paths)
            raw.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -20 200 40">{content}</svg>')
            group['rows'].append({'name': row['name'], 'content': content})
        groups.append(group)
    input_file = directory / 'raw.json'
    input_file.write_text(json.dumps(raw))
    # Browser getBBox supplies contour bounds without measuring any substitute font.
    code = '''import {Chrome,findChrome} from %s;
import {readFile,mkdtemp} from 'node:fs/promises';
const c=new Chrome(findChrome(),await mkdtemp('/private/tmp/gb-issuer-bounds-'));
try {await c.start();const tree=await c.send('Page.getFrameTree');
await c.send('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html:'<html lang="zh"><body>'+JSON.parse(await readFile(process.argv[1],'utf8')).join('')+'</body></html>'});
const result=await c.send('Runtime.evaluate',{returnByValue:true,expression:'[...document.querySelectorAll(".gb-issuer-ink")].map(e=>{const b=e.getBBox();return {x:b.x,y:b.y,width:b.width,height:b.height}})'});
if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));console.log(JSON.stringify(result.result.value));
} finally {await c.stop();}''' % json.dumps((ROOT / 'src/chrome.mjs').as_uri())
    bounds = iter(json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code, str(input_file)], text=True)))
    for group in groups:
        for row in group['rows']:
            box = next(bounds)
            row['inkBoundsMm'] = box
            # A shared zero origin avoids fractional SVG placement in printed PDFs;
            # 6.35mm is exactly 24 CSS pixels, avoiding aspect-ratio rounding drift.
            row['svg'] = (f'<svg xmlns="http://www.w3.org/2000/svg" class="gb-issuer-svg" aria-hidden="true" '
                          f'viewBox="0 -5.5 {box["x"]+box["width"]:.12f} 6.35" '
                          f'style="left:0;top:0;width:{box["x"]+box["width"]:.12f}mm;height:6.35mm">'
                          + row.pop('content') + '</svg>')
    asset = json.dumps({'groups': groups}, ensure_ascii=False, indent=2) + '\n'
    manifest = {'method': 'Embedded font outlines via pdftocairo; original glyph size/proportions retained; source glyph origins redistributed to independently measured calibrated spans; 18pt row baseline pitch',
                'layout': {'baselineOffsetMm': 5.5, 'baselinePitchMm': 6.35, 'viewportLeftMm': 0, 'viewportTopMm': 0},
                'extractor': subprocess.run(['pdftocairo', '-v'], capture_output=True, text=True).stderr.splitlines()[0],
                'assetSha256': digest(asset.encode()), 'sources': sources, 'crossChecks': checks,
                'reuseConditions': 'Local project research and acceptance; public redistribution permission not independently established.'}
    for source in manifest['sources'] + manifest['crossChecks']:
        for row in source['rows']:
            for glyph in row['glyphs']:
                del glyph['paths']
    args.output.write_text(asset)
    args.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
print('PASS: three groups extracted; first group verified against three additional samples')
