import argparse,subprocess,tempfile
import pdfplumber,json,hashlib
from pathlib import Path
import xml.etree.ElementTree as E
parser=argparse.ArgumentParser(description='Extract the reviewed equation glyph subset from GB/T 47036—2026; requires pdfplumber and pdftocairo.')
parser.add_argument('source',type=Path)
parser.add_argument('output',type=Path)
args=parser.parse_args()
source=args.source.expanduser()
expected='c9f56e58570832caf2c0d38755e34ede5837cc90f44039c30c131973eb70e93f'
if hashlib.sha256(source.read_bytes()).hexdigest()!=expected:
 parser.error('Reference PDF differs from the reviewed source; inspect its encodings and coordinates before updating this extractor.')
args.output.mkdir(parents=True,exist_ok=True)
tmp=tempfile.TemporaryDirectory(prefix='gb-equation-extract-')
work=Path(tmp.name)
for page in [14,17,19,37]:
 subprocess.run(['pdftocairo','-f',str(page),'-l',str(page),'-svg',str(source),str(work/('p'+str(page)+'.svg'))],check=True)

ns={'s':'http://www.w3.org/2000/svg'}
bank={};positions={}
# Confirmed from the visible numeric tags and appendix A/B labels.
mapping={'/':'0','"':'1','#':'2','$':'3','%':'4','&':'5','’':'6','(':'7','*':'8','+':'9',')':'A',',':'B'}
with pdfplumber.open(source) as d:
 for pageNo in [14,17,37]:
  root=E.parse(work/('p'+str(pageNo)+'.svg')).getroot()
  uses=[u for u in root.findall('.//s:use',ns) if u.get('x') and u.get('y')]
  for c in d.pages[pageNo-1].chars:
   if 'DlFont2' not in c['fontname'] or c['text'] not in mapping or abs(c['size']-9.703504)>.05 or c['x0']<490:continue
   targetX=c['x0']*.998859;targetY=(d.pages[pageNo-1].height-c['matrix'][5])*.998859+.47
   near=min(uses,key=lambda u:(float(u.get('x'))-targetX)**2+(float(u.get('y'))-targetY)**2)
   if abs(float(near.get('x'))-targetX)>.15 or abs(float(near.get('y'))-targetY)>.3:continue
   key=near.get('{http://www.w3.org/1999/xlink}href')[1:]
   paths=root.findall('.//s:g[@id="'+key+'"]/s:path',ns)
   if not paths:continue
   actual=mapping[c['text']]
   glyph={'paths':[p.get('d') for p in paths]}
   if actual not in bank:bank[actual]=glyph;positions[actual]={'physical_page':pageNo,'svg_glyph':key,'pdf_encoding':c['text']}
 # C and D use their own embedded subsets; identify by their first tag on the page.
 for pageNo,letter in [(19,'C'),(37,'D')]:
  root=E.parse(work/('p'+str(pageNo)+'.svg')).getroot();uses=[u for u in root.findall('.//s:use',ns) if u.get('x') and u.get('y')]
  page=d.pages[pageNo-1];cs=page.chars
  candidates=[c for c in cs if 490<c['x0']<514 and 'DlFont2' in c['fontname'] and c['text'] not in mapping]
  c=next(c for c in candidates if c['text']==('0' if letter=='C' else '1'))
  targetX=c['x0']*.998859;targetY=(page.height-c['matrix'][5])*.998859+.47
  near=min(uses,key=lambda u:(float(u.get('x'))-targetX)**2+(float(u.get('y'))-targetY)**2)
  key=near.get('{http://www.w3.org/1999/xlink}href')[1:]
  bank[letter]={'paths':[p.get('d') for p in root.findall('.//s:g[@id="'+key+'"]/s:path',ns)]}
  positions[letter]={'physical_page':pageNo,'svg_glyph':key,'pdf_encoding':c['text']}
root=E.parse(work/'p14.svg').getroot()
for out,key in [('open','glyph-3-0'),('close','glyph-3-1'),('ellipsis','glyph-3-5'),('decimal','glyph-11-3')]:
 bank[out]={'paths':[p.get('d') for p in root.findall('.//s:g[@id="'+key+'"]/s:path',ns)]}
required=set('0123456789ABCD')|{'open','close','decimal','ellipsis'}
assert required==set(bank) and all(v['paths'] for v in bank.values()),'Incomplete glyph bank'
asset={'source':'GB/T 47036—2026','units':'pt','glyphs':bank}
manifest={'file':str(source),'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'positions':positions}
for name,data in [('gb-equation-glyphs.json',asset),('gb-equation-glyphs-manifest.json',manifest)]:
 (args.output/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
tmp.cleanup()
print('Extracted reviewed glyphs: '+', '.join(sorted(bank)))
