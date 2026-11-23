"""Génère la grange et les icônes de l'app à partir du logo (web/public/brand/logo.png).
Exécuté automatiquement lors du déploiement (GitHub Actions)."""
from PIL import Image

SRC = "web/public/brand/logo.png"
logo = Image.open(SRC).convert("RGBA")
alpha = logo.getchannel("A")
w, h = logo.size
# La grange occupe le haut du logo (au-dessus du texte)
top = alpha.crop((0, 0, w, int(h * 0.56)))
bbox = top.point(lambda p: 255 if p > 60 else 0).getbbox()
pad = 6
barn = logo.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(w, bbox[2] + pad), min(h, bbox[3] + pad)))
barn.save("web/public/brand/barn.png", optimize=True)

def icon(size, scale, out):
    bg = Image.new("RGB", (size, size), (245, 241, 234))
    bw = int(size * scale)
    bh = int(bw * barn.size[1] / barn.size[0])
    b = barn.resize((bw, bh), Image.LANCZOS)
    bg.paste(b, ((size - bw) // 2, (size - bh) // 2 + int(size * 0.02)), b)
    bg.save(out, optimize=True)

icon(512, 0.80, "web/public/icon-512.png")
icon(192, 0.80, "web/public/icon-192.png")
icon(180, 0.80, "web/public/apple-touch-icon.png")
icon(512, 0.62, "web/public/icon-maskable-512.png")
print("Icônes générées")
