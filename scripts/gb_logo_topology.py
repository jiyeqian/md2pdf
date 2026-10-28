"""Canonical Bezier subdivision and a shared boundary graph for the GB logo."""
import math
import re

def segments(data):
    tokens = iter(re.findall(r'[MLHVCZ]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?', data))
    p = start = (0., 0.)
    for cmd in tokens:
        if cmd == 'M':
            p = start = (float(next(tokens)), float(next(tokens)))
        elif cmd in ('L', 'H', 'V'):
            q = ((float(next(tokens)), float(next(tokens))) if cmd == 'L' else
                 (float(next(tokens)), p[1]) if cmd == 'H' else (p[0], float(next(tokens))))
            if math.dist(p, q) > 1e-8: yield (p, q)
            p = q
        elif cmd == 'C':
            v = [float(next(tokens)) for _ in range(6)]
            q = (v[4], v[5]); yield (p, tuple(v[:2]), tuple(v[2:4]), q); p = q
        elif cmd == 'Z':
            if math.dist(p, start) > 1e-8: yield (p, start)
            p = start
        else: raise ValueError(cmd)

def lerp(a, b, t): return tuple((1-t)*x+t*y for x,y in zip(a,b))

def split(c, t):
    a,b,d = (lerp(c[i], c[i+1], t) for i in range(3))
    e,f = lerp(a,b,t),lerp(b,d,t); p = lerp(e,f,t)
    return (c[0],a,e,p),(p,f,d,c[3])

def subcurve(c, lo, hi):
    left = split(c, hi)[0]
    return split(left, lo/hi)[1] if lo else left

def curve_line_root(c, normal, value):
    def f(t):
        p = split(c,t)[0][-1]
        return sum(a*b for a,b in zip(p,normal))-value
    lo,hi = 0.,1.; flo=f(lo)
    if flo*f(hi)>0: raise ValueError('No bracketed curve/line intersection')
    for _ in range(60):
        mid=(lo+hi)/2
        if flo*f(mid)<=0:hi=mid
        else:lo=mid;flo=f(lo)
    return (lo+hi)/2

def number(x): return f'{x:.8f}'.rstrip('0').rstrip('.') or '0'
def point(p): return ' '.join(number(x) for x in p)
def command(edge): return ('L' if len(edge)==2 else 'C')+' '+' '.join(point(p) for p in edge[1:])
def path(edges, close=False):
    return 'M'+point(edges[0][0])+' '+' '.join(command(e) for e in edges)+(' Z' if close else '')

def normalize(m):
    """Derive all changed facet edges from the canonical letter and hole curves."""
    if m.get('schemaVersion') != 2:
        raise ValueError('Normalize from the preserved schemaVersion=2 model')
    # The tiny backward line at the B notch has no intended geometric extent.
    m['silhouettes'][1] = m['silhouettes'][1].replace(
        '917.56616 237.00000 L917.46943 237.00000','917.517795 237.00000')
    gs=list(segments(m['silhouettes'][0]));bs=list(segments(m['silhouettes'][1]))
    ginner=[e for e in gs if len(e)==4][1]
    gouter=[e for e in gs if len(e)==4][-2:]
    tg=curve_line_root(gouter[0],(1,1),477)
    ti=curve_line_root(ginner,(1,1),477)
    tb=curve_line_root([e for e in bs if len(e)==4][0],(1,1),910)
    outer_lower=subcurve(gouter[0],tg,1); inner_lower=subcurve(ginner,ti,1)
    top_outer=tuple(reversed(gouter[1])); lower_outer=tuple(reversed(outer_lower))
    f=list(segments(m['facets'][0])); m['facets'][0]=path([top_outer,lower_outer]+[(lower_outer[-1],f[2][-1])]+f[3:],True)
    gpoint=inner_lower[0];m['facets'][3]='M399 237 V414 L339 353.74370 V297 Z'
    m['facets'][4]='M114.01543 362.98457 L'+point(gpoint)+' '+command(inner_lower)+' H339 L399 414 H239.56494 C192.50156 414.56903 147.35613 396.02015 114.01543 362.98457 Z'
    bcurve=subcurve([e for e in bs if len(e)==4][0],0,tb)
    cap=list(segments(m['facets'][5]));m['facets'][5]=path([cap[0],bcurve,(bcurve[-1],cap[2][-1])]+cap[3:],True)
    # Counter outlines are the only source of the hole boundary: no hidden 2-unit offset.
    hu=list(segments(m['counters'][0]));hl=list(segments(m['counters'][1]))
    mid=list(segments(m['facets'][7])); low=list(segments(m['facets'][8]))
    m['facets'][7]=path(mid[:3]+[(mid[2][-1],hu[3][-1]),tuple(reversed(hu[3])),
                           tuple(reversed(hu[2])),tuple(reversed(hu[1])),(hu[0][-1],mid[0][0])],True)
    m['facets'][8]=path(low[:3]+[(low[2][-1],hl[3][-1]),tuple(reversed(hl[3])),
                           tuple(reversed(hl[2])),tuple(reversed(hl[1])),low[-1]],True)
    m['schemaVersion']=3;m['baselineCommit']='93507af'
    m['boundaryConstruction']={'kind':'shared-edge graph with one-sided face bands and convex junction patches',
                              'width':m['lineWidth'],'lineCap':'butt','clip':'letter silhouette minus transparent counters',
                              'roots':{'G outer diagonal t':tg,'G inner diagonal t':ti,'B cap diagonal t':tb},
                              'outerBandStrokeMultiplier':2,'sharedSeamStrokeMultiplier':1}
    m['selection']['method']='Retain v2 scalar parameters; topology repair is not a new pixel-IoU sweep.'
    return m

def key_point(p): return tuple(round(v,7) for v in p)
def edge_key(e):
    k=tuple(key_point(p) for p in e)
    return min(k,tuple(reversed(k)))

def hull(points):
    ps=sorted(set(key_point(p) for p in points))
    if len(ps)<3:return []
    def cross(o,a,b):return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    def half(seq):
        result=[]
        for p in seq:
            while len(result)>1 and cross(result[-2],result[-1],p)<=1e-10:result.pop()
            result.append(p)
        return result
    return half(ps)[:-1]+half(reversed(ps))[:-1]

def boundary_graph(m):
    raw=[(index,e) for index,d in enumerate(m['facets']) for e in segments(d)]
    vertices=set(key_point(e[0]) for _,e in raw)|set(key_point(e[-1]) for _,e in raw)
    graph={}
    for owner,e in raw:
        pieces=[e]
        if len(e)==2:
            a,b=e;dx,dy=b[0]-a[0],b[1]-a[1];den=dx*dx+dy*dy
            cuts=[(0,a),(1,b)]
            for q in vertices:
                t=((q[0]-a[0])*dx+(q[1]-a[1])*dy)/den
                if 1e-7<t<1-1e-7 and abs((q[0]-a[0])*dy-(q[1]-a[1])*dx)/math.sqrt(den)<1e-6:
                    cuts.append((t,lerp(a,b,t)))
            cuts=sorted(cuts);pieces=[(cuts[i][1],cuts[i+1][1]) for i in range(len(cuts)-1)]
        for piece in pieces:
            k=edge_key(piece)
            if k not in graph:graph[k]={'points':piece,'owners':set()}
            graph[k]['owners'].add(owner)
    joints={}
    for e in graph.values():
        pts=e['points'];w=m['lineWidth']*(1 if len(e['owners'])>1 else 2);e['strokeWidth']=w
        for vertex,adjacent in [(pts[0],pts[1]),(pts[-1],pts[-2])]:
            dx,dy=adjacent[0]-vertex[0],adjacent[1]-vertex[1];length=math.hypot(dx,dy)
            if length<1e-8:raise ValueError('Degenerate edge tangent')
            n=(-dy/length*w/2,dx/length*w/2);k=key_point(vertex)
            joint=joints.setdefault(k,{'point':vertex,'edges':0,'normals':[]})
            joint['edges']+=1
            joint['normals'] += [(vertex[0]+n[0],vertex[1]+n[1]),(vertex[0]-n[0],vertex[1]-n[1])]
    for j in joints.values():j['polygon']=hull(j.pop('normals'))
    return list(graph.values()),list(joints.values())

if __name__ == '__main__':
    import argparse,json
    from pathlib import Path
    root=Path(__file__).resolve().parent.parent
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline',type=Path,default=root/'docs/gb-logo-parametric-v2-model.json')
    parser.add_argument('--model',type=Path,default=root/'docs/gb-logo-parametric-model.json')
    args=parser.parse_args();m=normalize(json.loads(args.baseline.read_text()))
    args.model.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
    edges,joints=boundary_graph(m)
    print(f'Canonical topology: {len(edges)} unique edges, {len(joints)} junctions')
