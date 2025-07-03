#!/usr/bin/env python3
# Считает длину реза и количество проколов в DXF
import ezdxf, sys, math, json

def dist(p0, p1):
    return math.hypot(p1[0]-p0[0], p1[1]-p0[1])

def main(fname):
    doc = ezdxf.readfile(fname)
    msp = doc.modelspace()

    length = 0
    holes  = 0

    for e in msp:
        t = e.dxftype()

        if t == 'LINE':
            length += dist(e.dxf.start, e.dxf.end)
            holes  += 1

        elif t == 'ARC':
            a = abs(math.radians(e.dxf.end_angle - e.dxf.start_angle))
            length += e.dxf.radius * a
            holes  += 1

        elif t == 'CIRCLE':
            length += 2*math.pi*e.dxf.radius
            holes  += 1

        elif t in ('LWPOLYLINE', 'POLYLINE'):
            pts = list(e.get_points())
            for i in range(len(pts)-1):
                length += dist(pts[i], pts[i+1])
            if e.closed:
                length += dist(pts[-1], pts[0])
            holes += 1

        elif t == 'SPLINE':
            try:
                pts = list(e.construction_tool().approximate(1000))
                for i in range(len(pts)-1):
                    length += dist(pts[i], pts[i+1])
                holes += 1
            except Exception as ex:
                print(f"SPLINE error: {ex}", file=sys.stderr)

    print(json.dumps({"totalLength": round(length,2), "piercings": holes}))

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: python parse_dxf.py file.dxf"}))
    else:
        main(sys.argv[1])
