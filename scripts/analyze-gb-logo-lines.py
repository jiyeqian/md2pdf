"""Measure selected thin-stroke profiles; requires the reference raster from candidate metrics."""
import numpy as np,json
from PIL import Image
import argparse
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--reference',type=Path,default=Path('/private/tmp/gb-logo-reference.png'))
parser.add_argument('--report',type=Path,default=Path(__file__).resolve().parent.parent/'docs/gb-logo-line-measurements.json')
args=parser.parse_args()
m=np.array(Image.open(args.reference).convert('L'))<128

def width(p,n):
 t=np.arange(-6,6.01,.1);xy=np.floor(np.array(p)[None,:]+t[:,None]*np.array(n)[None,:]).astype(int);good=(xy[:,0]>=0)&(xy[:,0]<948)&(xy[:,1]>=0)&(xy[:,1]<474);b=np.zeros(len(t),bool);b[good]=m[xy[good,1],xy[good,0]]
 runs=[];k=0
 while k<len(t):
  if not b[k]: k+=1;continue
  end=k+1
  while end<len(t) and b[end]:end+=1
  if t[k]<2 and t[end-1]>-2 and k>0 and end<len(t):runs.append((abs((t[k]+t[end-1])/2),(end-k)*.1))
  k=end
 return min(runs)[1] if runs else None
sets={
'B left stem straight':[((487.5,y),(1,0)) for y in np.arange(70,430,3)],
'G upper inner straight':[((x,178.5),(0,1)) for x in np.arange(255,390,3)],
'G diagonal seam':[((x,x-64),(-2**-.5,2**-.5)) for x in np.arange(250,290,1)],
'G outer curve':[]}
cx,cy,rx,ry=245.00649,237.24666,244.61825,237.35239
for theta in np.linspace(3.4,4.4,70):
 p=(cx+rx*np.cos(theta),cy+ry*np.sin(theta));n=np.array([np.cos(theta)/rx,np.sin(theta)/ry]);n/=np.linalg.norm(n);sets['G outer curve'].append((p,n))
out={}
for label,samples in sets.items():
 values=[v for p,n in samples if (v:=width(p,n)) is not None and 1<=v<=5]
 out[label]={'acceptedSections':len(values),'medianPixels':float(np.median(values)),'p10Pixels':float(np.quantile(values,.1)),'p90Pixels':float(np.quantile(values,.9))}
print(out)
args.report.write_text(json.dumps({'method':'Nearest-pixel normal profiles in original 948x474 stencil; retain isolated runs width1..5px; not original design stroke specification.','profiles':out},indent=2)+'\n')
