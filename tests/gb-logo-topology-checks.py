"""Check the full boundary graph, canonical subcurves and high-resolution containment."""
import json
import math
import sys
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'scripts'))
from gb_logo_topology import boundary_graph, normalize, edge_key, segments, split
import numpy as np
from PIL import Image

m=json.loads((ROOT/'docs/gb-logo-parametric-model.json').read_text())
base=json.loads((ROOT/'docs/gb-logo-parametric-v2-model.json').read_text())
assert normalize(base)==m,'geometry must derive deterministically from preserved v2'
edges,joints=boundary_graph(m)
assert len({edge_key(e['points']) for e in edges})==len(edges)
assert all(math.dist(e['points'][0],e['points'][-1])>.1 for e in edges),'no degenerate edge'
assert any(len(e['owners'])==2 for e in edges),'shared seams detected'
for e in edges:
    expected=m['lineWidth']*(1 if len(e['owners'])>1 else 2)
    assert e['strokeWidth']==expected
for j in joints:
    assert all(math.dist(j['point'],p)<=m['lineWidth']+1e-6 for p in j['polygon']),'no miter-style extrusion'
# Shared diagonal intersections lie exactly on their constraint lines.
for name,value in m['boundaryConstruction']['roots'].items():
    assert 0<value<1,name
facets=[list(segments(d)) for d in m['facets']]
gcurve=facets[0][1];assert abs(sum(gcurve[-1])-477)<1e-6
ginner=facets[4][0][-1];assert abs(sum(ginner)-477)<1e-6
bcap=facets[5][1][-1];assert abs(sum(bcap)-910)<1e-6
# Both counter outlines are reused as exact reverse segments in their stippled faces.
for hole,index in zip(m['counters'],[7,8]):
    h=list(segments(hole))
    for e in h[1:-1]:assert edge_key(e) in {edge_key(q) for q in facets[index]}

def black(name):return np.array(Image.open('/private/tmp/'+name).convert('L'))<128
full=black('gb-logo-parametric-4x.png');S=black('gb-logo-silhouette-4x.png');H=black('gb-logo-holes-4x.png')
assert full.shape==(1896,3792)
raw_outside=int((full&~S).sum())
spad=np.pad(S,1)
guard=np.logical_or.reduce([spad[dy:dy+S.shape[0],dx:dx+S.shape[1]] for dy in range(3) for dx in range(3)])
outside=int((full&~guard).sum());assert outside==0,('outside 1-device-pixel AA guard',outside)
# Erode the hole mask by one device pixel to exclude antialias threshold ambiguity.
hp=np.pad(H,1);inside=H&hp[:-2,1:-1]&hp[2:,1:-1]&hp[1:-1,:-2]&hp[1:-1,2:]
assert not (full&inside).any(),'counter interiors stay transparent'
# Sample nonempty interior junction cores; full connectivity is separately checked for B regression nodes. Ignore the silhouette/holes AA fringe.
sp=np.pad(S,1);safe=S&sp[:-2,1:-1]&sp[2:,1:-1]&sp[1:-1,:-2]&sp[1:-1,2:]&~H
probes=[]
for j in joints:
    x,y=j['point'];xx,yy=np.meshgrid(np.arange(max(0,int(x*4)-3),min(3792,int(x*4)+4)),np.arange(max(0,int(y*4)-3),min(1896,int(y*4)+4)))
    core=((xx+.5-x*4)**2+(yy+.5-y*4)**2)<(m['lineWidth']*.12*4)**2
    selected=core&safe[yy,xx]
    assert full[yy,xx][selected].all(),('junction core slit',j['point'])
    probes.append({'point':j['point'],'sampledInteriorDevicePixels':int(selected.sum())})
connections=[]
for name,vertex,samples in [
    ('B middle',(544,236.10293),[(543,233),(543,239),(547,235)]),
    ('B lower',(544,415.53731),[(543,412.5),(543,418.5),(547,414.5)])]:
    probe=next(p for p in probes if math.dist(p['point'],vertex)<1e-5)
    assert probe['sampledInteriorDevicePixels']>0,('empty regression core',name)
    cx,cy=vertex;x0=max(0,int((cx-10)*4));y0=max(0,int((cy-10)*4))
    tile=full[y0:min(1896,y0+81),x0:min(3792,x0+81)]
    coords=[(int(y*4)-y0,int(x*4)-x0) for x,y in samples]
    assert all(tile[y,x] for y,x in coords),('missing black branch',name)
    seen={coords[0]};stack=[coords[0]]
    while stack:
        y,x=stack.pop()
        for yy,xx in [(y-1,x),(y+1,x),(y,x-1),(y,x+1)]:
            if 0<=yy<tile.shape[0] and 0<=xx<tile.shape[1] and tile[yy,xx] and (yy,xx) not in seen:
                seen.add((yy,xx));stack.append((yy,xx))
    assert all(p in seen for p in coords),('disconnected B branches',name)
    connections.append({'name':name,'branchPoints':samples,'fourConnectedAt4x':True})
before=black('gb-logo-parametric-v2-4x.png')
for box in [(239,175,241,177),(239,297,241,299)]:
    x0,y0,x1,y1=box
    assert before[y0*4:y1*4,x0*4:x1*4].any(),'fixture must expose original spike'
    assert not full[y0*4:y1*4,x0*4:x1*4].any(),'G spike regression'
report={'edges':len(edges),'junctionCount':len(joints),'sharedEdges':sum(len(e['owners'])>1 for e in edges),
        'rawThresholdBoundaryDisagreementsAt4x':raw_outside,'rasterGuardDevicePixels':1,'extrudedPixelsBeyondGuardAt4x':outside,'sampledInteriorCoreWhitePixels':0,'BRegressionConnections':connections,'junctionProbes':probes,'nodesWithInteriorRasterProbe':sum(p['sampledInteriorDevicePixels']>0 for p in probes),
        'edgeGraph':[{'points':e['points'],'owners':sorted(e['owners']),'strokeWidth':e['strokeWidth']} for e in edges],
        'junctions':[{'point':j['point'],'degree':j['edges'],'patch':j['polygon']} for j in joints],
        'limits':'4x raster probes supplement exact clipping and topology checks, not a guarantee for every renderer or physical print.'}
(ROOT/'docs/gb-logo-topology-measurements.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print('PASS:',len(edges),'unique edges;',len(joints),'junctions; all patch vertices bounded; canonical counters; zero beyond-AA-guard pixels and core slits at 4x')
