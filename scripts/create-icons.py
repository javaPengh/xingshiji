from pathlib import Path
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parents[1]
out = root / 'PWA' / 'icons'
out.mkdir(exist_ok=True)
for size in (192, 512, 1024):
    image = Image.new('RGB', (size, size), '#8271df')
    draw = ImageDraw.Draw(image)
    scale = size / 192
    rect = lambda box: tuple(int(x * scale) for x in box)
    draw.pieslice(rect((48, 53, 144, 149)), 0, 180, fill='white')
    draw.line(rect((80, 152, 112, 152)), fill='white', width=max(1, int(7 * scale)))
    for x, top in ((76, 56), (99, 49), (122, 56)):
        points = [(int((x + dx) * scale), int((top + dy) * scale)) for dx, dy in [(0, 0), (-5, 7), (-4, 13), (4, 21), (3, 27), (0, 32)]]
        draw.line(points, fill='#e9e2ff', width=max(1, int(7 * scale)), joint='curve')
    image.save(out / f'icon-{size}.png')
print('Generated original app icons (192/512/1024px).')
