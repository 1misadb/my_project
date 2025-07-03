import ezdxf
import sys

if len(sys.argv) != 2:
    print("Usage: python check_dxf.py file.dxf")
    sys.exit(1)

filename = sys.argv[1]
doc = ezdxf.readfile(filename)
msp = doc.modelspace()

types = {}

for e in msp:
    t = e.dxftype()
    types[t] = types.get(t, 0) + 1

print("DXF Entity Types and Counts:")
for k, v in types.items():
    print(f"{k}: {v}")
