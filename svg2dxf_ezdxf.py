import ezdxf
import sys
import svgpathtools
import xml.etree.ElementTree as ET
import math

from svgpathtools import Line, Arc, CubicBezier, QuadraticBezier

def svg_to_dxf(svg_file, dxf_file):
    print(f"🔄 Converting {svg_file} → {dxf_file}")

    doc = ezdxf.new()
    msp = doc.modelspace()

    tree = ET.parse(svg_file)
    root = tree.getroot()
    ns = {'svg': 'http://www.w3.org/2000/svg'}

    # Линии
    for line in root.findall('.//svg:line', ns):
        x1 = float(line.attrib['x1'])
        y1 = float(line.attrib['y1'])
        x2 = float(line.attrib['x2'])
        y2 = float(line.attrib['y2'])
        msp.add_line((x1, -y1), (x2, -y2))

    # Полилинии и полигоны
    for poly in root.findall('.//svg:polyline', ns) + root.findall('.//svg:polygon', ns):
        points = poly.attrib['points'].strip().split()
        pts = []
        for p in points:
            x, y = map(float, p.split(','))
            pts.append((x, -y))
        if poly.tag.endswith('polygon'):
            pts.append(pts[0])  # замыкаем
        msp.add_lwpolyline(pts, close=poly.tag.endswith('polygon'))

    # Круги
    for circle in root.findall('.//svg:circle', ns):
        cx = float(circle.attrib['cx'])
        cy = float(circle.attrib['cy'])
        r = float(circle.attrib['r'])
        msp.add_circle((cx, -cy), r)

    # Обработка путей через svgpathtools
    paths, _ = svgpathtools.svg2paths(svg_file)
    for path in paths:
        for segment in path:
            if isinstance(segment, Line):
                start = segment.start
                end = segment.end
                msp.add_line((start.real, -start.imag), (end.real, -end.imag))

            elif isinstance(segment, Arc):
                # Discretize Arc into polyline segments
                num_points = 20
                pts = []
                for t in [i/num_points for i in range(num_points+1)]:
                    p = segment.point(t)
                    pts.append((p.real, -p.imag))
                msp.add_lwpolyline(pts)

            elif isinstance(segment, CubicBezier):
                num_points = 50
                pts = []
                for t in [i/num_points for i in range(num_points+1)]:
                    p = segment.point(t)
                    pts.append((p.real, -p.imag))
                msp.add_lwpolyline(pts)

            elif isinstance(segment, QuadraticBezier):
                num_points = 30
                pts = []
                for t in [i/num_points for i in range(num_points+1)]:
                    p = segment.point(t)
                    pts.append((p.real, -p.imag))
                msp.add_lwpolyline(pts)

            else:
                print(f"⚠️ Unsupported segment type: {type(segment)}")

    doc.saveas(dxf_file)
    print(f"✅ Saved: {dxf_file}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python svg2dxf_ezdxf.py input.svg output.dxf")
        sys.exit(1)
    svg_to_dxf(sys.argv[1], sys.argv[2])
