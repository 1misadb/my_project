#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
shift_svg_bbox.py
 ─────────────────
Сдвигает ВСЁ содержимое SVG в +X +Y, так чтобы левый верхний угол bbox
становился (0,0). Обновляет viewBox и width/height (учитывает «mm»,
«px» и др.). Также конвертирует <line> и <circle> в <path>.

Использование:
    python shift_svg_bbox.py in.svg out.svg
"""

import sys, os, math, re, xml.etree.ElementTree as ET

NS = {'svg': 'http://www.w3.org/2000/svg'}
ET.register_namespace('', NS['svg'])  # без лишних префиксов

num_re  = re.compile(r'[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?')
unit_re = re.compile(r'^([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)([a-z%]*)$', re.I)

def num_unit(s: str):
    m = unit_re.match(s.strip())
    return (float(m.group(1)), m.group(2) or '') if m else (0.0, '')

def floats_in(txt: str):
    return [float(x) for x in num_re.findall(txt)]

def bbox_points(path_d: str):
    nums = floats_in(path_d)
    xs, ys = nums[::2], nums[1::2]
    return xs, ys

def convert_to_path(root: ET.Element):
    """
    Собирает все <line> и <circle> в один <path>, удаляя их исходные элементы.
    """
    d = ""
    for el in list(root):
        tag = el.tag.split('}')[-1]
        if tag == 'line':
            x1,y1 = el.attrib.get('x1'), el.attrib.get('y1')
            x2,y2 = el.attrib.get('x2'), el.attrib.get('y2')
            d += f"M {x1} {y1} L {x2} {y2} "
            root.remove(el)
        elif tag == 'circle':
            cx = float(el.attrib.get('cx',0))
            cy = float(el.attrib.get('cy',0))
            r  = float(el.attrib.get('r',0))
            d += f"M {cx-r} {cy} A {r} {r} 0 1 0 {cx+r} {cy} A {r} {r} 0 1 0 {cx-r} {cy} "
            root.remove(el)
    if d:
        path = ET.Element('{%s}path' % NS['svg'], {'d': d, 'fill': 'none', 'stroke': 'black'})
        root.append(path)

def svg_min_xy(root: ET.Element):
    minx = miny = math.inf
    for el in root.iter():
        tag = el.tag.split('}')[-1]
        if tag == 'path' and 'd' in el.attrib:
            xs, ys = bbox_points(el.attrib['d'])
        elif tag in ('polyline', 'polygon') and 'points' in el.attrib:
            pts = [tuple(map(float, p.split(',')))
                   for p in el.attrib['points'].replace(';', ' ').split()]
            xs, ys = zip(*pts) if pts else ([], [])
        elif tag in ('circle', 'ellipse', 'line'):
            xs = [float(el.attrib.get(a, math.inf)) for a in ('cx', 'x1', 'x2')]
            ys = [float(el.attrib.get(a, math.inf)) for a in ('cy', 'y1', 'y2')]
        else:
            continue
        if xs: minx = min(minx, *xs)
        if ys: miny = min(miny, *ys)
    return minx, miny

def shift_to_positive(src: str, dst: str):
    tree = ET.parse(src)
    root = tree.getroot()

    convert_to_path(root)  # << добавлено здесь

    minx, miny = svg_min_xy(root)
    if minx == math.inf:
        tree.write(dst)
        return

    dx = -minx if minx < 0 else 0
    dy = -miny if miny < 0 else 0
    if dx == 0 and dy == 0:
        print('Already positive:', os.path.basename(src))
        if src != dst:
            tree.write(dst)
        return

    print(f"Shift {os.path.basename(src)} by +{dx:.3f}, +{dy:.3f}")

    g = ET.Element('{%s}g' % NS['svg'])
    g.set('transform', f'translate({dx} {dy})')
    for ch in list(root):
        root.remove(ch)
        g.append(ch)
    root.append(g)

    vb = floats_in(root.attrib.get('viewBox', ''))
    if len(vb) == 4:
        root.attrib['viewBox'] = f"0 0 {vb[2]+dx:g} {vb[3]+dy:g}"
    else:
        w = num_unit(root.attrib.get('width', '0'))[0]
        h = num_unit(root.attrib.get('height','0'))[0]
        root.attrib['viewBox'] = f"0 0 {w+dx:g} {h+dy:g}"

    if 'width' in root.attrib:
        v, u = num_unit(root.attrib['width'])
        root.attrib['width'] = f"{v+dx:g}{u}"
    if 'height' in root.attrib:
        v, u = num_unit(root.attrib['height'])
        root.attrib['height'] = f"{v+dy:g}{u}"

    tree.write(dst)

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage:  python shift_svg_bbox.py  in.svg  out.svg")
        sys.exit(1)
    shift_to_positive(sys.argv[1], sys.argv[2])
