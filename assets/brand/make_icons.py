"""Иконка и заставка «Олигарха»: золотая монета с буквой «О» и короной на бордовом фоне.
Запуск: python3 make_icons.py <путь к android/app/src/main/res> <папка для 512px иконки>"""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
BG1, BG2 = (139, 30, 30), (60, 10, 14)
GOLD, GOLD_D, GOLD_L = (232, 193, 90), (168, 122, 34), (255, 233, 150)


def radial(size, c1, c2):
    img = Image.new("RGB", (size, size), c2)
    d = ImageDraw.Draw(img)
    for k in range(size // 2, 0, -1):
        t = k / (size / 2)
        col = tuple(int(c1[i] * (1 - t) + c2[i] * t) for i in range(3))
        d.ellipse([size / 2 - k * 1.3, size / 2 - k * 1.3 - size * 0.08, size / 2 + k * 1.3, size / 2 + k * 1.3 - size * 0.08], fill=col)
    return img


def coin(size, scale=1.0):
    """Монета на прозрачном фоне, занимает scale от размера."""
    S = size * 4  # рисуем крупно, потом сглаживаем
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = S * 0.36 * scale
    cx, cy = S / 2, S * 0.54
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([cx - r, cy - r + S * 0.03, cx + r, cy + r + S * 0.03], fill=(0, 0, 0, 120))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(S * 0.02)))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GOLD_D)
    d.ellipse([cx - r * 0.93, cy - r * 0.93, cx + r * 0.93, cy + r * 0.93], fill=GOLD)
    d.ellipse([cx - r * 0.8, cy - r * 0.8, cx + r * 0.8, cy + r * 0.8], outline=GOLD_D, width=int(r * 0.04))
    f = ImageFont.truetype(SERIF, int(r * 1.25))
    d.text((cx, cy + r * 0.04), "О", font=f, fill=(120, 20, 24), anchor="mm")
    d.text((cx - r * 0.02, cy), "О", font=f, fill=(150, 28, 32), anchor="mm")
    # корона над монетой
    cw, ch = r * 0.95, r * 0.42
    top = cy - r - ch * 0.55
    pts = [(cx - cw / 2, top + ch), (cx - cw / 2, top + ch * 0.25), (cx - cw / 4, top + ch * 0.6), (cx, top),
           (cx + cw / 4, top + ch * 0.6), (cx + cw / 2, top + ch * 0.25), (cx + cw / 2, top + ch)]
    d.polygon(pts, fill=GOLD_L, outline=GOLD_D)
    for x, y in ((cx - cw / 2, top + ch * 0.25), (cx, top), (cx + cw / 2, top + ch * 0.25)):
        d.ellipse([x - r * 0.06, y - r * 0.06, x + r * 0.06, y + r * 0.06], fill=(200, 40, 50))
    # блик
    hl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(hl).ellipse([cx - r * 0.7, cy - r * 0.85, cx + r * 0.1, cy - r * 0.2], fill=(255, 255, 255, 28))
    img.alpha_composite(hl.filter(ImageFilter.GaussianBlur(S * 0.02)))
    return img.resize((size, size), Image.LANCZOS)


def full_icon(size, round_mask=False):
    bg = radial(size, BG1, BG2).convert("RGBA")
    bg.alpha_composite(coin(size, 1.0))
    mask = Image.new("L", (size * 4, size * 4), 0)
    md = ImageDraw.Draw(mask)
    if round_mask:
        md.ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
    else:
        md.rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1], radius=size * 4 * 0.22, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(bg, (0, 0), mask.resize((size, size), Image.LANCZOS))
    return out


def main(res, store):
    dens = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
    for name, k in dens.items():
        d = os.path.join(res, f"mipmap-{name}")
        full_icon(int(48 * k)).save(os.path.join(d, "ic_launcher.png"))
        full_icon(int(48 * k), True).save(os.path.join(d, "ic_launcher_round.png"))
        fg = Image.new("RGBA", (int(108 * k), int(108 * k)), (0, 0, 0, 0))
        c = coin(int(72 * k), 1.0)  # безопасная зона адаптивной иконки — 72 из 108
        fg.alpha_composite(c, (int(18 * k), int(18 * k)))
        fg.save(os.path.join(d, "ic_launcher_foreground.png"))
    with open(os.path.join(res, "values", "ic_launcher_background.xml"), "w") as fh:
        fh.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#7A1A1C</color>\n</resources>\n')
    # заставка: бордовый фон, монета и надпись
    for folder in os.listdir(res):
        p = os.path.join(res, folder, "splash.png")
        if not os.path.exists(p):
            continue
        w, h = Image.open(p).size
        m = max(w, h)
        img = radial(m, BG1, BG2).crop(((m - w) // 2, (m - h) // 2, (m - w) // 2 + w, (m - h) // 2 + h)).convert("RGBA")
        s = int(min(w, h) * 0.38)
        img.alpha_composite(coin(s), ((w - s) // 2, int(h * 0.5 - s * 0.75)))
        dr = ImageDraw.Draw(img)
        f = ImageFont.truetype(SERIF, max(12, int(min(w, h) * 0.09)))
        dr.text((w / 2, h * 0.5 + s * 0.42), "ОЛИГАРХ", font=f, fill=GOLD, anchor="mm")
        img.convert("RGB").save(p)
    os.makedirs(store, exist_ok=True)
    full_icon(512).save(os.path.join(store, "icon-512.png"))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
