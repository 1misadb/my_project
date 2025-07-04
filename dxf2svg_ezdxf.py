#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import ezdxf, svgwrite, math, os, sys
from collections import Counter

TARGET_MAX_MM = 3000
USER_SCALE    = 1.0
UNIT_MM = {0:1, 1:25.4, 2:304.8, 3:25.4*12*5280, 4:1, 5:1000, 6:1e6}
err_counter = Counter()

def unit_scale_mm(doc): return UNIT_MM.get(doc.header.get('$INSUNITS',0), 1)
def guess_units(mm):     return 1000 if mm<10 else 25.4 if mm>5000 else 1
def bbox_xy(xs,ys):      return None if not xs or not ys else (min(xs),min(ys),max(xs),max(ys))

def poly_points(e):
    """POLYLINE/LWPOLYLINE"""
    try:
        if hasattr(e, "vertices"):
            verts = e.vertices() if callable(e.vertices) else e.vertices
            return [ (v.dxf.location.x, v.dxf.location.y) for v in verts ]
        if hasattr(e, "get_points"):
            pts = e.get_points() if callable(e.get_points) else e.get_points
            return [ (p[0], p[1]) for p in pts if len(p)>=2 ]
    except Exception as ex:
        err_counter[f"poly_points:{ex}"] += 1
    return []

def spline_points(e, samples=10000):
    """SPLINE all fallback, 2D-only"""
    try:
        if hasattr(e, "approximate") and callable(e.approximate):
            pts = e.approximate(samples)
            return [ (p[0], p[1]) for p in pts if len(p)>=2 ]
    except Exception as ex:
        err_counter[f"spline1:{ex}"] += 1
    try:
        pts = e.construction_tool().approximate(samples)
        return [ (p[0], p[1]) for p in pts if len(p)>=2 ]
    except Exception as ex:
        err_counter[f"spline2:{ex}"] += 1
    try:
        if e.fit_points:
            return [ (p[0], p[1]) for p in e.fit_points if len(p)>=2 ]
    except Exception as ex:
        err_counter[f"spline3:{ex}"] += 1
    try:
        if e.control_points:
            return [ (p[0], p[1]) for p in e.control_points if len(p)>=2 ]
    except Exception as ex:
        err_counter[f"spline4:{ex}"] += 1
    try:
        from ezdxf.math import bspline
        cpts = [tuple(p) for p in e.control_points if len(p)>=2]
        if cpts:
            bs = bspline.BSpline(control_points=cpts, degree=e.dxf.degree, knots=e.knots())
            return [ (pt[0], pt[1]) for pt in [bs.point(t/samples) for t in range(samples+1)] ]
    except Exception as ex:
        err_counter[f"spline5:{ex}"] += 1
    return []

def ent_bbox(e, sf):
    try:
        t = e.dxftype()
        if t == 'LINE':
            s,e1=e.dxf.start,e.dxf.end
            return bbox_xy([s.x*sf,e1.x*sf],[s.y*sf,e1.y*sf])
        if t in ('CIRCLE','ARC'):
            c,r=e.dxf.center,e.dxf.radius*sf
            return c.x*sf-r,c.y*sf-r,c.x*sf+r,c.y*sf+r
        if t in ('LWPOLYLINE','POLYLINE'):
            pts = poly_points(e)
            xs,ys = [x*sf for x,_ in pts],[y*sf for _,y in pts]
            return bbox_xy(xs,ys)
        if t == 'SPLINE':
            pts = spline_points(e, 10000)
            xs,ys = [x*sf for x,_ in pts],[y*sf for _,y in pts]
            return bbox_xy(xs,ys)
    except Exception as ex:
        err_counter[f"bbox:{ex}"] += 1
    return None

def convert(infile, outfile, sf=None):
    try:
        doc = ezdxf.readfile(infile)
    except Exception as ex:
        print("❌ DXF read error:", ex); return

    sf = sf or unit_scale_mm(doc)*USER_SCALE
    msp = doc.modelspace()
    ents = list(msp)

    final_ents = []
    for e in ents:
        if e.dxftype() == 'INSERT':
            try:
                final_ents.extend(e.explode())
            except Exception as ex:
                err_counter[f"explode:{ex}"] += 1
        else:
            final_ents.append(e)

    minx=miny=float('inf'); maxx=maxy=-float('inf')
    for e in final_ents:
        b = ent_bbox(e, sf)
        if b:
            minx, miny = min(minx,b[0]), min(miny,b[1])
            maxx, maxy = max(maxx,b[2]), max(maxy,b[3])

    if minx==float('inf'):
        print("⚠️  no drawable entities:", os.path.basename(infile)); return

    big = max(maxx-minx, maxy-miny)
    print(f"🔍 {os.path.basename(infile)} raw bbox: {big:.4f} mm")

    if doc.header.get('$INSUNITS',0)==0:
        k = guess_units(big)
        if k!=1:
            print(f"🔧 units guess ×{k}")
            return convert(infile, outfile, sf=sf*k)

    if big > TARGET_MAX_MM:
        k = TARGET_MAX_MM/big
        sf *= k; minx*=k; miny*=k; maxx*=k; maxy*=k
        print(f"🔧 normalise ×{k:.3f}")

    w,h = maxx-minx, maxy-miny
    print(f"✅ {os.path.basename(infile)} → {os.path.basename(outfile)} ({w:.1f}×{h:.1f} mm)")

    dwg = svgwrite.Drawing(outfile, profile='tiny', size=(f"{w:.3f}mm",f"{h:.3f}mm"))
    dwg.viewbox(minx,-maxy,w,h)

    for e in final_ents:
        t=e.dxftype()
        try:
            if t=='LINE':
                s,e1=e.dxf.start,e.dxf.end
                dwg.add(dwg.line((s.x*sf,-s.y*sf),(e1.x*sf,-e1.y*sf),stroke='black'))
            elif t=='CIRCLE':
                c,r=e.dxf.center,e.dxf.radius*sf
                dwg.add(dwg.circle((c.x*sf,-c.y*sf),r,stroke='black',fill='none'))
            elif t=='ARC':
                c,r=e.dxf.center,e.dxf.radius*sf
                sa,ea=map(math.radians,(e.dxf.start_angle,e.dxf.end_angle))
                sx,sy=c.x*sf+r*math.cos(sa), c.y*sf+r*math.sin(sa)
                ex,ey=c.x*sf+r*math.cos(ea), c.y*sf+r*math.sin(ea)
                laf=1 if (e.dxf.end_angle-e.dxf.start_angle)%360>180 else 0
                dwg.add(dwg.path(d=f"M {sx} {-sy} A {r} {r} 0 {laf} 0 {ex} {-ey}",
                                 stroke='black',fill='none'))
            elif t in ('LWPOLYLINE','POLYLINE'):
                pts=[(x*sf,-y*sf) for x,y in poly_points(e)]
                if pts:
                    node = dwg.polygon if getattr(e,'is_closed',False) or getattr(e,'closed',False) else dwg.polyline
                    dwg.add(node(pts,stroke='black',fill='none'))
            elif t=='SPLINE':
                pts=[(x*sf,-y*sf) for x,y in spline_points(e,10000)]
                if pts:
                    dwg.add(dwg.polyline(pts,stroke='black',fill='none'))
        except Exception as ex:
            err_counter[f"draw:{ex}"] += 1

    dwg.save()

if __name__=="__main__":
    if len(sys.argv)==3:
        convert(sys.argv[1],sys.argv[2])
    elif len(sys.argv)==2:
        folder=sys.argv[1]
        for f in os.listdir(folder):
            if f.lower().endswith('.dxf'):
                convert(os.path.join(folder,f),
                        os.path.join(folder,f[:-4]+'.svg'))
        print("\n⛳ error summary:")
        for k,v in err_counter.items():
            print(f" {k} : {v}")
    else:
        print("Usage:\n  python dxf2svg_ezdxf.py file.dxf file.svg\n  python dxf2svg_ezdxf.py folder/")
