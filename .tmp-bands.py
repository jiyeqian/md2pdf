from PIL import Image
import glob
im = Image.open(sorted(glob.glob("/tmp/mycov*.png"))[0]).convert("L")
W, H = im.size
px = im.load()
S = 150/72.0
rows = [sum(1 for x in range(W) if px[x, y] < 128) for y in range(H)]
bands = []; inb = False
for y, c in enumerate(rows):
    if c > 0 and not inb: start = y; inb = True
    elif c == 0 and inb: bands.append((start, y)); inb = False
if inb: bands.append((start, H))
for (a, b) in bands:
    if b - a < 1 or a/S < 240: continue
    xs = [x for y in range(a, b) for x in range(W) if px[x, y] < 128]
    print("y %.1f-%.1f h=%dpx ink=%d x %.0f-%.0f" % (a/S, b/S, b-a, len(xs), min(xs)/S, max(xs)/S))