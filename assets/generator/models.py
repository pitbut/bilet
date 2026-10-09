"""Low-poly модели «Олигарха». Клетка — квадрат 2×2 (от −1 до 1 по X и Z), Y — вверх."""
from math import atan, atan2, cos, sin, pi, hypot

from mesh import Model

# Палитра
CONCRETE, ASPHALT, DIRT = "#a3a39c", "#4b4c52", "#9c7f5c"
GRASS, DARK_GRASS, SNOW, SAND, STEPPE = "#79b05a", "#4f8a45", "#e9eef2", "#e8d6a6", "#c9bd98"
FIELD, WHEAT, WATER, POOL = "#8a6a3f", "#e3c25a", "#3f86c9", "#5cc6e8"
WHITE, CREAM, BRICK, RED, ORANGE, YELLOW = "#f1f1ec", "#efe4cc", "#ad5a3d", "#cf3a33", "#e57c2a", "#f2c234"
STEEL, DARK_STEEL, BLACK, GOLD, SILVER = "#8f959e", "#575b63", "#2b2c31", "#d9ab2e", "#c4c8cd"
GLASS, GLASS_DARK, WOOD, LOG, ROOF = "#7fb2de", "#2f4f6e", "#a8743f", "#7a5531", "#5e4b42"
GREEN_TREE, TRUNK, PURPLE, PINK, BLUE, TEAL = "#3f8a3c", "#6b4a2b", "#7a4bb8", "#e46aa6", "#2f6fc2", "#2aa198"
NEON, FLAME = "#ff4fd8", "#ff8a1f"

G = 0.08  # высота плиты-основания


def off(x, z, ry, dx, dz):
    """Смещение (dx, dz) в системе объекта, повёрнутого на ry вокруг Y."""
    return x + dx * cos(ry) + dz * sin(ry), z - dx * sin(ry) + dz * cos(ry)


def base(m, c=CONCRETE):
    m.box(c, 0, 0, 0, 1.96, G, 1.96)


def building(m, x, z, w, d, h, c=WHITE, win=GLASS_DARK, roofc=None, y=G):
    m.box(c, x, y, z, w, h, d)
    floors = max(1, int(h / 0.2))
    for k in range(floors):
        wy = y + (k + 0.45) * h / floors
        m.box(win, x, wy, z + d / 2 + 0.004, w * 0.82, 0.06, 0.012)
        m.box(win, x, wy, z - d / 2 - 0.004, w * 0.82, 0.06, 0.012)
        m.box(win, x + w / 2 + 0.004, wy, z, 0.012, 0.06, d * 0.82)
        m.box(win, x - w / 2 - 0.004, wy, z, 0.012, 0.06, d * 0.82)
    m.box(roofc or DARK_STEEL, x, y + h, z, w + 0.02, 0.02, d + 0.02)


def house(m, x, z, w, d, h, c=CREAM, roofc=ROOF, ry=0.0):
    m.box(c, x, G, z, w, h, d, ry=ry)
    m.roof(roofc, x, G + h, z, w + 0.04, h * 0.6, d + 0.04, ry=ry)
    dx, dz = off(x, z, ry, 0, d / 2 + 0.004)
    m.box(WOOD, dx, G, dz, 0.06, h * 0.55, 0.012, ry=ry)


def tree(m, x, z, s=1.0, y=G):
    m.cyl(TRUNK, x, y, z, 0.025 * s, 0.1 * s, 6)
    m.cyl(GREEN_TREE, x, y + 0.08 * s, z, 0.11 * s, 0.3 * s, 7, rt=0)


def palm(m, x, z, s=1.0):
    m.cyl(TRUNK, x, G, z, 0.02 * s, 0.32 * s, 6, rt=0.014 * s)
    for k in range(5):
        a = 2 * pi * k / 5
        m.box(GREEN_TREE, x + 0.07 * s * cos(a), G + 0.3 * s, z - 0.07 * s * sin(a),
              0.16 * s, 0.015, 0.05 * s, rot=[("z", -0.35), ("y", a)])


def car(m, x, z, ry=0.0, c=RED, s=1.0, y=G):
    m.box(c, x, y + 0.02 * s, z, 0.24 * s, 0.055 * s, 0.11 * s, ry=ry)
    cx, cz = off(x, z, ry, -0.015 * s, 0)
    m.box(GLASS_DARK, cx, y + 0.075 * s, cz, 0.12 * s, 0.045 * s, 0.095 * s, ry=ry)
    for dx in (-0.075, 0.075):
        for dz in (-0.055, 0.055):
            wx, wz = off(x, z, ry, dx * s, dz * s)
            m.hcyl(BLACK, wx, y + 0.025 * s, wz, 0.025 * s, 0.022 * s, ry + pi / 2, 8)


def truck(m, x, z, ry=0.0, c=BLUE, load=WHEAT):
    cx, cz = off(x, z, ry, 0.14, 0)
    m.box(c, cx, G + 0.03, cz, 0.1, 0.1, 0.12, ry=ry)
    bx, bz = off(x, z, ry, -0.05, 0)
    m.box(STEEL, bx, G + 0.03, bz, 0.26, 0.08, 0.13, ry=ry)
    m.box(load, bx, G + 0.11, bz, 0.24, 0.03, 0.11, ry=ry)
    for dx in (-0.12, 0.0, 0.14):
        for dz in (-0.06, 0.06):
            wx, wz = off(x, z, ry, dx, dz)
            m.hcyl(BLACK, wx, G + 0.03, wz, 0.03, 0.025, ry + pi / 2, 8)


def tank(m, x, z, r, h, c=WHITE):
    m.cyl(c, x, G, z, r, h, 14)
    m.cyl(c, x, G + h, z, r, r * 0.25, 14, rt=r * 0.15)
    m.box(DARK_STEEL, x, G + h * 0.5, z + r, 0.02, h * 0.5, 0.02)


def chimney(m, x, z, r, h):
    m.cyl(WHITE, x, G, z, r, h * 0.7, 10, rt=r * 0.85)
    m.cyl(RED, x, G + h * 0.7, z, r * 0.85, h * 0.3, 10, rt=r * 0.75)


def flare(m, x, z, h):
    m.cyl(STEEL, x, G, z, 0.018, h, 6, metal=0.6)
    m.cyl(FLAME, x, G + h, z, 0.04, 0.12, 7, rt=0, glow=True)


def crane(m, x, z, h, ry=0.0, c=YELLOW):
    m.box(c, x, G, z, 0.06, h, 0.06)
    jx, jz = off(x, z, ry, 0.16, 0)
    m.box(c, jx, G + h, jz, 0.6, 0.04, 0.05, ry=ry)
    cx, cz = off(x, z, ry, -0.1, 0)
    m.box(CONCRETE, cx, G + h - 0.05, cz, 0.08, 0.06, 0.07, ry=ry)
    hx, hz = off(x, z, ry, 0.38, 0)
    m.box(BLACK, hx, G + h * 0.55, hz, 0.008, h * 0.45, 0.008)


def pipe(m, x1, z1, x2, z2, y, r, c=STEEL, legs=True):
    dx, dz = x2 - x1, z2 - z1
    m.hcyl(c, (x1 + x2) / 2, y, (z1 + z2) / 2, r, hypot(dx, dz), atan2(-dz, dx), 10, metal=0.5)
    if legs:
        n = max(2, int(hypot(dx, dz) / 0.35))
        for k in range(n + 1):
            px, pz = x1 + dx * k / n, z1 + dz * k / n
            m.box(DARK_STEEL, px, G, pz, 0.03, y - G - r * 0.5, 0.03)


def pumpjack(m, x, z, ry=0.0, s=1.0):
    m.box(CONCRETE, x, G, z, 0.42 * s, 0.03, 0.16 * s, ry=ry)
    for dz in (-0.04, 0.04):
        px, pz = off(x, z, ry, 0.02 * s, dz * s)
        m.box(DARK_STEEL, px, G + 0.03, pz, 0.03 * s, 0.22 * s, 0.03 * s, ry=ry)
    m.box(DARK_STEEL, x, G + 0.25 * s, z, 0.42 * s, 0.035 * s, 0.045 * s, rot=[("z", 0.12), ("y", ry)])
    hx, hz = off(x, z, ry, 0.2 * s, 0)
    m.box(ORANGE, hx, G + 0.18 * s, hz, 0.06 * s, 0.13 * s, 0.06 * s, ry=ry)
    m.box(BLACK, hx, G + 0.03, hz, 0.008, 0.16 * s, 0.008)
    wx, wz = off(x, z, ry, -0.13 * s, 0)
    m.hcyl(ORANGE, wx, G + 0.1 * s, wz, 0.07 * s, 0.05 * s, ry + pi / 2, 10)
    mx, mz = off(x, z, ry, -0.17 * s, 0)
    m.box(STEEL, mx, G + 0.03, mz, 0.08 * s, 0.06 * s, 0.08 * s, ry=ry)


def derrick(m, x, z, h, c=RED):
    a, b = 0.16, 0.035
    tilt = atan((a - b) / h)
    for sx in (-1, 1):
        for sz in (-1, 1):
            m.box(c, x + sx * a, G, z + sz * a, 0.025, h / cos(tilt), 0.025,
                  rot=[("z", sx * tilt), ("x", -sz * tilt)])
    for f in (0.25, 0.5, 0.75):
        hs = a + (b - a) * f
        y = G + h * f
        m.box(c, x, y, z + hs, hs * 2, 0.015, 0.015)
        m.box(c, x, y, z - hs, hs * 2, 0.015, 0.015)
        m.box(c, x + hs, y, z, 0.015, 0.015, hs * 2)
        m.box(c, x - hs, y, z, 0.015, 0.015, hs * 2)
    m.box(DARK_STEEL, x, G, z, 0.42, 0.05, 0.42)
    m.box(c, x, G + h, z, 0.1, 0.04, 0.1)


def column(m, x, z, r, h, c=SILVER):
    m.cyl(c, x, G, z, r, h, 12, metal=0.4)
    for k in range(1, 4):
        m.cyl(DARK_STEEL, x, G + h * k / 4, z, r + 0.01, 0.015, 12)
    m.sphere(c, x, G + h, z, r, 10, metal=0.4)


def sawtooth_hall(m, x, z, w, d, teeth, c=CREAM):
    h = 0.2
    m.box(c, x, G, z, w, h, d)
    tw = w / teeth
    for k in range(teeth):
        tx = x - w / 2 + tw * (k + 0.5)
        m.roof(DARK_STEEL, tx, G + h, z, d, 0.1, tw, ry=pi / 2)
        m.box(GLASS, tx + tw * 0.25, G + h, z, 0.01, 0.08, d * 0.9)
    m.box(GLASS_DARK, x, G + 0.05, z + d / 2 + 0.004, w * 0.85, 0.08, 0.012)


def logs(m, x, z, n=3, ry=0.0):
    for k in range(n):
        for j in range(n - k):
            lx, lz = off(x, z, ry, 0, (j - (n - k - 1) / 2) * 0.06)
            m.hcyl(LOG, lx, G + 0.03 + k * 0.05, lz, 0.03, 0.4, ry, 8)


def stack(m, x, z, w, d, h, c):
    for k in range(int(h / 0.04)):
        m.box(c, x, G + k * 0.04, z, w, 0.032, d)
        m.box(WOOD, x, G + k * 0.04 + 0.032, z, w * 0.9, 0.008, d * 0.9)


def coil(m, x, z):
    m.hcyl(SILVER, x, G + 0.07, z, 0.07, 0.09, pi / 2, 12, metal=0.7)
    m.hcyl(DARK_STEEL, x, G + 0.07, z, 0.025, 0.092, pi / 2, 8)


def field(m, x, z, w, d, crop=WHEAT):
    m.box(FIELD, x, G, z, w, 0.015, d)
    rows = int(d / 0.08)
    for k in range(rows):
        m.box(crop, x, G + 0.015, z - d / 2 + (k + 0.5) * d / rows, w * 0.95, 0.025, d / rows * 0.55)


def silo(m, x, z, r, h, c=WHITE):
    m.cyl(c, x, G, z, r, h, 12, metal=0.3)
    m.cyl(STEEL, x, G + h, z, r, r * 0.6, 12, rt=0.02, metal=0.5)


def fence_ring(m, w, c=DARK_STEEL):
    for sx, sz, lx, lz in ((0, w, 2 * w, 0.01), (0, -w, 2 * w, 0.01), (w, 0, 0.01, 2 * w), (-w, 0, 0.01, 2 * w)):
        m.box(c, sx, G, sz, lx, 0.06, lz)


# ---------- Отрасли: три ветки × три уровня ----------

def agro_rent(m, L):
    base(m, GRASS)
    field(m, -0.45, 0.45, 0.8, 0.8)
    house(m, 0.45, -0.45, 0.5, 0.36, 0.22, RED, ROOF)
    if L >= 2:
        field(m, 0.45, 0.45, 0.8, 0.8, "#9cc24a")
        silo(m, -0.15, -0.6, 0.11, 0.42)
        car(m, -0.55, -0.3, 0.3, GREEN_TREE, 1.1)
    if L >= 3:
        field(m, -0.45, -0.1, 0.8, 0.25, WHEAT)
        house(m, -0.55, -0.7, 0.4, 0.28, 0.18, WHITE, BLUE)
        silo(m, 0.1, -0.6, 0.11, 0.42)
        truck(m, 0.45, 0.0, 0)


def agro_income(m, L):
    base(m, CONCRETE)
    n = (2, 4, 6)[L - 1]
    for k in range(n):
        silo(m, -0.6 + (k % 3) * 0.3, -0.15 + (k // 3) * 0.32, 0.14, 0.5 + 0.1 * L)
    building(m, 0.55, 0.0, 0.3, 0.3, 0.35 + 0.25 * L, WHITE)
    if L >= 2:
        truck(m, 0.0, 0.62, 0)
    if L >= 3:
        pipe(m, 0.4, -0.1, -0.6, -0.1, G + 0.75, 0.03, STEEL, legs=False)


def agro_special(m, L):
    base(m, CONCRETE)
    m.box(WATER, 0, 0, -0.75, 1.96, G + 0.005, 0.46)
    for k in range(3 + L):
        m.box(WHEAT, -0.6 + (k % 3) * 0.14, G + (k // 3) * 0.07, 0.4, 0.12, 0.07, 0.18)
    truck(m, 0.3, 0.55, 0)
    if L >= 2:
        building(m, 0.45, -0.1, 0.6, 0.35, 0.28, CREAM)
        m.box(STEEL, -0.2, G + 0.2, -0.25, 0.7, 0.03, 0.08, rot=[("z", 0.4)])
    if L >= 3:
        m.box(BRICK, 0.1, G - 0.02, -0.75, 0.9, 0.08, 0.3)
        m.box(WHEAT, 0.1, G + 0.06, -0.75, 0.75, 0.05, 0.22)


def forest_rent(m, L):
    base(m, DARK_GRASS)
    for x, z in ((-0.7, 0.7), (-0.4, 0.75), (0.7, 0.7), (0.75, 0.35)):
        tree(m, x, z, 1.1)
    logs(m, -0.45, 0.25, 3, 0.2)
    if L == 1:
        house(m, 0.3, -0.3, 0.6, 0.4, 0.2, WOOD, ROOF)
    else:
        building(m, 0.25, -0.3, 0.9, 0.55, 0.3, CREAM)
        chimney(m, 0.6, -0.75, 0.06, 0.55 + 0.15 * L)
        logs(m, 0.3, 0.4, 3, 0)
    if L >= 3:
        tank(m, -0.6, -0.55, 0.15, 0.3)
        chimney(m, 0.85, -0.55, 0.05, 0.6)
        tank(m, -0.25, -0.75, 0.1, 0.25)


def forest_income(m, L):
    base(m, DARK_GRASS)
    house(m, -0.3, -0.3, 0.75, 0.5, 0.24, BRICK, ROOF)
    tree(m, 0.75, 0.75)
    tree(m, -0.8, 0.8)
    stack(m, 0.55, -0.55, 0.3, 0.3, 0.16, WOOD)
    if L >= 2:
        house(m, 0.45, 0.25, 0.5, 0.4, 0.2, CREAM, DARK_STEEL)
        truck(m, -0.35, 0.45, 0, BLUE, WOOD)
    if L >= 3:
        building(m, -0.45, 0.8, 0.6, 0.25, 0.22, WHITE, GLASS)
        stack(m, 0.85, -0.1, 0.2, 0.25, 0.2, WOOD)


def forest_special(m, L):
    base(m, DIRT)
    for k in range(2 + L):
        stack(m, -0.65 + k * 0.32, 0.55, 0.26, 0.4, 0.12 + 0.04 * k, WOOD)
    for k in range(L + 1):
        m.box(BRICK, -0.6 + k * 0.3, G, -0.1, 0.22, 0.14, 0.22)
    if L >= 2:
        crane(m, 0.55, -0.35, 0.8, pi * 0.75)
    if L >= 3:
        silo(m, -0.45, -0.6, 0.15, 0.5, SILVER)
        truck(m, 0.0, -0.65, 0, ORANGE, CONCRETE)


def metal_rent(m, L):
    base(m, "#7d7d78")
    building(m, -0.35, 0.35, 0.9, 0.6, 0.35, BRICK, GLASS_DARK)
    chimney(m, -0.75, -0.2, 0.07, 0.75)
    if L >= 2:
        m.cyl(DARK_STEEL, 0.45, G, -0.35, 0.22, 0.45, 12, rt=0.16, metal=0.5)
        m.cyl(RED, 0.45, G + 0.45, -0.35, 0.12, 0.25, 10, rt=0.07)
        chimney(m, -0.45, -0.35, 0.07, 0.85)
    if L >= 3:
        m.cyl(DARK_STEEL, 0.55, G, 0.4, 0.18, 0.4, 12, rt=0.13, metal=0.5)
        chimney(m, -0.15, -0.6, 0.07, 0.95)
        m.box(STEEL, 0.05, G + 0.3, -0.35, 0.5, 0.04, 0.08, rot=[("z", -0.35)])


def metal_income(m, L):
    base(m, "#7d7d78")
    length = (0.9, 1.3, 1.7)[L - 1]
    m.box(STEEL, 0, G, -0.35, length, 0.32, 0.55)
    m.roof(DARK_STEEL, 0, G + 0.32, -0.35, length, 0.12, 0.6)
    for k in range(L * 2):
        coil(m, -0.6 + k * 0.22, 0.45)
    if L >= 3:
        m.box(STEEL, 0, G, 0.8, 1.6, 0.18, 0.25)


def metal_special(m, L):
    base(m, CONCRETE)
    for k in range(L + 1):
        for j in range(3):
            m.box("#6d7178", -0.5 + k * 0.35, G + j * 0.05, -0.1 + j * 0.01, 0.28, 0.04, 0.5, metal=0.6)
    gw = (0.9, 1.3, 1.6)[L - 1]
    for sx in (-gw / 2, gw / 2):
        m.box(YELLOW, sx, G, 0.55, 0.06, 0.6, 0.06)
    m.box(YELLOW, 0, G + 0.6, 0.55, gw + 0.1, 0.07, 0.1)
    m.box(DARK_STEEL, 0.1, G + 0.45, 0.55, 0.12, 0.1, 0.12)
    if L >= 3:
        for sx in (-0.7, 0.7):
            m.box(YELLOW, sx, G, -0.7, 0.06, 0.5, 0.06)
        m.box(YELLOW, 0, G + 0.5, -0.7, 1.5, 0.07, 0.1)


def auto_rent(m, L):
    base(m, ASPHALT)
    sawtooth_hall(m, -0.1, -0.3, (0.8, 1.2, 1.5)[L - 1], 0.7, (2, 4, 5)[L - 1])
    for k in range(L * 2):
        car(m, -0.7 + k * 0.28, 0.55, pi / 2, (RED, WHITE, BLUE, BLACK, SILVER, YELLOW)[k])
    if L >= 3:
        chimney(m, 0.8, -0.75, 0.05, 0.5)
        m.box(STEEL, 0.0, G, 0.25, 1.6, 0.03, 0.12)


def auto_income(m, L):
    base(m, ASPHALT)
    building(m, -0.3, -0.45, 0.9, 0.5, 0.3, GLASS, GLASS_DARK, WHITE)
    cols = (RED, WHITE, BLUE, BLACK, SILVER, YELLOW, ORANGE, GREEN_TREE)
    for k in range(2 + 2 * L):
        car(m, -0.7 + (k % 4) * 0.35, 0.25 + (k // 4) * 0.35, pi / 2, cols[k])
    if L >= 2:
        m.box(WHITE, 0.75, G, -0.6, 0.06, 0.7, 0.06)
        m.box(RED, 0.75, G + 0.55, -0.6, 0.2, 0.25, 0.04, glow=True)
    if L >= 3:
        building(m, 0.65, 0.05, 0.4, 0.35, 0.25, GLASS, GLASS_DARK, WHITE)


def auto_special(m, L):
    base(m, GRASS)
    n, a, b = 24, 0.78, 0.6
    for k in range(n):
        t0, t1 = 2 * pi * k / n, 2 * pi * (k + 1) / n
        x0, z0, x1, z1 = a * cos(t0), b * sin(t0), a * cos(t1), b * sin(t1)
        m.box(ASPHALT, (x0 + x1) / 2, G, (z0 + z1) / 2, hypot(x1 - x0, z1 - z0) + 0.02, 0.012, 0.16,
              ry=atan2(-(z1 - z0), x1 - x0))
    car(m, a, 0, pi / 2, RED)
    if L >= 2:
        car(m, -a, 0.05, -pi / 2, YELLOW)
        for k in range(3):
            m.box(WHITE, 0, G + k * 0.05, 0.05 - k * 0.06, 0.7, 0.05, 0.08)
    if L >= 3:
        car(m, 0.1, -b, pi, BLUE)
        building(m, 0.0, -0.2, 0.2, 0.2, 0.5, WHITE, GLASS_DARK, RED)


def tour_rent(m, L):
    base(m, SAND)
    h = (0.35, 0.75, 0.85)[L - 1]
    building(m, -0.35, -0.35, 0.6, 0.45, h, WHITE, GLASS)
    palm(m, 0.75, 0.75)
    if L >= 2:
        m.box(WHITE, 0.4, G, 0.35, 0.7, 0.03, 0.5)
        m.box(POOL, 0.4, G + 0.03, 0.35, 0.6, 0.01, 0.4)
        palm(m, -0.75, 0.7)
    if L >= 3:
        building(m, 0.45, -0.45, 0.45, 0.4, 1.1, CREAM, GLASS)
        palm(m, -0.2, 0.8)
        palm(m, 0.85, 0.0)


def tour_income(m, L):
    base(m, GRASS)
    house(m, -0.4, -0.45, 0.7, 0.35, 0.22, CREAM, "#3f7fa8")
    tree(m, 0.75, -0.75)
    tree(m, -0.8, 0.75)
    if L >= 2:
        house(m, 0.45, 0.2, 0.55, 0.35, 0.22, CREAM, "#3f7fa8", pi / 2)
        tree(m, 0.0, 0.7)
    if L >= 3:
        m.cyl(WHITE, -0.3, G, 0.35, 0.18, 0.05, 14)
        m.cyl(POOL, -0.3, G + 0.05, 0.35, 0.15, 0.005, 14)
        m.cyl(WHITE, -0.3, G, 0.35, 0.025, 0.18, 6)
        house(m, 0.4, -0.6, 0.45, 0.3, 0.2, CREAM, "#3f7fa8")


def tour_special(m, L):
    base(m, SAND)
    m.box(WHITE, 0.25, G, 0.3, 1.2, 0.03, 0.9)
    m.box(POOL, 0.25, G + 0.03, 0.3, 1.1, 0.01, 0.8)
    m.box(ORANGE, -0.65, G, -0.55, 0.25, 0.7, 0.25)
    colors = (RED, YELLOW, BLUE)
    for k in range(L):
        ex, ez = 0.05 + k * 0.3, 0.05
        sx, sz = -0.55, -0.45 + k * 0.05
        dx, dz = ex - sx, ez - sz
        ln = hypot(dx, dz)
        pitch = atan((0.62) / ln)
        m.box(colors[k], (sx + ex) / 2, G + 0.37 - 0.05 * k, (sz + ez) / 2, ln / cos(pitch), 0.025, 0.07,
              rot=[("z", -pitch), ("y", atan2(-dz, dx))])
    palm(m, 0.85, -0.6)
    if L >= 3:
        palm(m, -0.8, 0.7)


def gas_rent(m, L):
    base(m, SNOW)
    for k in range(L * 2 - (1 if L == 1 else 0)):
        x, z = -0.6 + (k % 3) * 0.35, 0.45 - (k // 3) * 0.4
        m.box(CONCRETE, x, G, z, 0.16, 0.02, 0.16)
        m.cyl(BLUE, x, G, z, 0.025, 0.22, 8)
        m.hcyl(BLUE, x, G + 0.14, z, 0.02, 0.14, 0, 8)
        m.cyl(RED, x, G + 0.22, z, 0.035, 0.02, 8)
    if L >= 2:
        m.hcyl(WHITE, 0.4, G + 0.12, -0.35, 0.1, 0.5, 0.0, 12)
        pipe(m, -0.6, 0.05, 0.15, -0.35, G + 0.1, 0.025, BLUE)
    if L >= 3:
        building(m, 0.45, 0.4, 0.4, 0.4, 0.25, WHITE)
        flare(m, -0.7, -0.6, 0.75)


def gas_income(m, L):
    base(m, SNOW)
    for k in range(L):
        z = -0.6 + k * 0.18
        pipe(m, -0.95, z, 0.95, z, G + 0.16, 0.05, YELLOW)
    building(m, 0.3, 0.45, 0.6, 0.4, 0.25, BLUE)
    if L >= 2:
        for x in (-0.55, -0.3):
            m.cyl(WHITE, x, G, 0.45, 0.07, 0.35, 10)
    if L >= 3:
        building(m, -0.55, 0.8, 0.5, 0.25, 0.2, WHITE)
        m.box(DARK_STEEL, 0.75, G, 0.0, 0.04, 0.6, 0.04)


def gas_special(m, L):
    base(m, SNOW)
    for k in range(L):
        x = -0.55 + k * 0.5
        m.sphere(WHITE, x, G + 0.32, 0.35, 0.24, 14, metal=0.2)
        for dx, dz in ((-0.15, -0.15), (0.15, -0.15), (-0.15, 0.15), (0.15, 0.15)):
            m.box(DARK_STEEL, x + dx, G, 0.35 + dz, 0.025, 0.25, 0.025)
    building(m, 0.45, -0.5, 0.6, 0.4, 0.25, WHITE)
    if L >= 2:
        flare(m, -0.75, -0.55, 0.9)
    if L >= 3:
        column(m, -0.25, -0.5, 0.07, 0.75)
        column(m, -0.05, -0.65, 0.06, 0.6)


def oil_rent(m, L):
    base(m, STEPPE)
    if L == 1:
        derrick(m, 0, -0.1, 1.0)
        m.box(STEEL, 0.55, G, 0.5, 0.35, 0.18, 0.25)
    else:
        spots = ((-0.4, -0.45), (0.4, 0.45), (0.4, -0.45), (-0.4, 0.45))[: (2, 4)[L - 2]]
        for x, z in spots:
            pumpjack(m, x, z, 0.0, 1.1)
    if L >= 3:
        tank(m, 0.0, 0.0, 0.14, 0.25, WHITE)


def oil_income(m, L):
    base(m, CONCRETE)
    column(m, -0.3, -0.3, 0.09, 0.8)
    for k in range(L + 1):
        tank(m, 0.55, -0.65 + k * 0.42, 0.18, 0.22)
    if L >= 2:
        column(m, -0.05, -0.45, 0.07, 0.65)
        column(m, -0.55, -0.55, 0.06, 0.55)
        flare(m, -0.75, 0.7, 0.85)
        pipe(m, -0.3, -0.1, 0.4, -0.1, G + 0.25, 0.02)
    if L >= 3:
        building(m, -0.25, 0.45, 0.6, 0.35, 0.25, WHITE)
        tank(m, 0.15, 0.55, 0.15, 0.2)


def oil_special(m, L):
    base(m, STEPPE)
    pipe(m, -0.98, 0.0, 0.98, 0.0, G + 0.16, 0.08, "#5a6b4f")
    m.box(YELLOW, 0.0, G, 0.0, 0.18, 0.28, 0.18)
    m.cyl(RED, 0.0, G + 0.28, 0.0, 0.06, 0.03, 10)
    if L >= 2:
        building(m, 0.45, 0.55, 0.55, 0.35, 0.22, WHITE)
        pipe(m, 0.3, 0.0, 0.3, 0.35, G + 0.1, 0.03)
    if L >= 3:
        for x in (-0.65, -0.25):
            tank(m, x, -0.55, 0.17, 0.25)
        tank(m, 0.4, -0.55, 0.17, 0.25)


def fin_rent(m, L):
    base(m, "#bdbdb6")
    h = (0.55, 1.1, 1.65)[L - 1]
    building(m, 0, 0, 0.7, 0.7, h, GLASS, GLASS_DARK)
    building(m, 0, 0, 0.5, 0.5, 0.15, GLASS, GLASS_DARK, y=G + h + 0.02)
    if L >= 2:
        building(m, -0.65, 0.65, 0.4, 0.4, 0.4, WHITE)
    if L >= 3:
        m.cyl(SILVER, 0, G + h + 0.19, 0, 0.03, 0.4, 6, rt=0.0, metal=0.8)
        tree(m, 0.7, 0.7)


def fin_income(m, L):
    base(m, "#bdbdb6")
    w = (0.9, 1.3, 1.4)[L - 1]
    m.box(CREAM, 0, G, -0.15, w + 0.15, 0.06, 0.8)
    m.box(CREAM, 0, G + 0.06, -0.3, w, 0.4, 0.45)
    ncol = int(w / 0.15)
    for k in range(ncol):
        m.cyl(WHITE, -w / 2 + 0.08 + k * (w - 0.16) / (ncol - 1), G + 0.06, 0.02, 0.03, 0.36, 8)
    m.box(CREAM, 0, G + 0.42, -0.15, w + 0.05, 0.04, 0.4)
    m.roof(CREAM, 0, G + 0.46, -0.15, w + 0.05, 0.15, 0.4)
    if L >= 2:
        m.sphere(GOLD, 0, G + 0.62, -0.3, 0.12, 12, metal=0.8)
    if L >= 3:
        building(m, 0, -0.75, 0.6, 0.3, 0.9, GLASS, GLASS_DARK)


def fin_special(m, L):
    base(m, "#bdbdb6")
    building(m, -0.35, -0.3, 0.6, 0.6, 0.3, GLASS_DARK, TEAL, WHITE)
    m.cyl(SILVER, -0.35, G + 0.32, -0.3, 0.015, 0.35, 6, metal=0.8)
    if L >= 2:
        building(m, 0.4, 0.15, 0.45, 0.45, 0.5, GLASS, GLASS_DARK, WHITE)
        m.sphere(WHITE, 0.55, G + 0.62, 0.3, 0.08, 10)
    if L >= 3:
        for k in range(3):
            m.box("#1f3550", -0.6 + k * 0.28, G + 0.05, 0.6, 0.24, 0.015, 0.3, rot=[("x", 0.4)], metal=0.5)
        building(m, 0.45, -0.55, 0.45, 0.35, 0.9, GLASS, GLASS_DARK, WHITE)


# ---------- Прочие клетки ----------

def construction_site(m):
    base(m, DIRT)
    fence_ring(m, 0.9, YELLOW)
    for k in range(4):
        y = G + k * 0.18
        for sx in (-0.4, 0.4):
            for sz in (-0.3, 0.3):
                m.box(STEEL, sx, G, sz, 0.02, 0.7, 0.02)
        m.box(WOOD, 0, y + 0.16, 0, 0.84, 0.015, 0.64)
    crane(m, 0.6, 0.55, 1.1, pi)
    stack(m, -0.65, 0.6, 0.25, 0.2, 0.12, BRICK)


def transsib(m):
    base(m, GRASS)
    m.box(DIRT, 0, G, 0.1, 1.96, 0.02, 0.4)
    for k in range(14):
        m.box(WOOD, -0.9 + k * 0.138, G + 0.02, 0.1, 0.04, 0.015, 0.3)
    for z in (0.02, 0.18):
        m.box(SILVER, 0, G + 0.035, z, 1.96, 0.02, 0.02, metal=0.8)
    m.box(RED, 0.15, G + 0.08, 0.1, 0.8, 0.22, 0.26)
    m.box(GLASS_DARK, 0.5, G + 0.2, 0.1, 0.1, 0.07, 0.27)
    m.box(DARK_STEEL, 0.15, G + 0.3, 0.1, 0.7, 0.03, 0.2)
    for x in (-0.15, 0.0, 0.3, 0.45):
        m.hcyl(BLACK, x, G + 0.08, 0.1, 0.045, 0.28, pi / 2, 10)
    house(m, -0.4, -0.55, 0.8, 0.35, 0.25, "#d9c58a", "#3b6b3b")


def port(m, accent):
    base(m, CONCRETE)
    m.box(WATER, 0, 0, -0.55, 1.96, G - 0.02, 0.86)
    m.box(BLACK, 0.1, G - 0.06, -0.55, 1.3, 0.14, 0.36)
    m.box(WHITE, 0.55, G + 0.08, -0.55, 0.22, 0.2, 0.3)
    for k in range(5):
        m.box((RED, BLUE, accent, GREEN_TREE, ORANGE)[k], -0.35 + k * 0.17, G + 0.08, -0.55, 0.15, 0.1, 0.28)
    for sx in (-0.25, 0.25):
        for sz in (0.05, 0.3):
            m.box(accent, sx, G, sz, 0.05, 0.75, 0.05)
    m.box(accent, 0, G + 0.75, 0.0, 0.6, 0.06, 1.0)
    for k in range(6):
        m.box((RED, BLUE, YELLOW, GREEN_TREE, ORANGE, WHITE)[k], -0.75 + (k % 3) * 0.2, G + (k // 3) * 0.1,
              0.6, 0.18, 0.1, 0.35)


def airport(m):
    base(m, GRASS)
    m.box(ASPHALT, 0, G, 0.45, 1.96, 0.01, 0.4)
    for k in range(7):
        m.box(WHITE, -0.8 + k * 0.27, G + 0.01, 0.45, 0.12, 0.004, 0.03)
    building(m, -0.25, -0.5, 1.1, 0.4, 0.22, GLASS, GLASS_DARK, WHITE)
    m.box(WHITE, 0.7, G, -0.6, 0.12, 0.6, 0.12)
    m.box(GLASS_DARK, 0.7, G + 0.6, -0.6, 0.2, 0.1, 0.2)
    m.hcyl(WHITE, 0.0, G + 0.14, 0.45, 0.06, 0.9, 0, 12)
    m.cyl(WHITE, 0.45, G + 0.14, 0.45, 0.06, 0.12, 12, rt=0.01, rot=[("z", -pi / 2)])
    m.box(WHITE, 0.05, G + 0.12, 0.45, 0.2, 0.02, 0.9)
    m.box(BLUE, -0.4, G + 0.15, 0.45, 0.12, 0.2, 0.02)
    m.box(WHITE, -0.4, G + 0.16, 0.45, 0.1, 0.015, 0.3)


def hydro(m):
    base(m, GRASS)
    m.box(WATER, 0, 0, -0.55, 1.96, G + 0.25, 0.86)
    m.box(WATER, 0, 0, 0.7, 0.7, G + 0.005, 0.56)
    m.box(CONCRETE, 0, G, 0.0, 1.96, 0.45, 0.3)
    for k in range(4):
        m.box("#bfe3f5", -0.45 + k * 0.3, G, 0.16, 0.16, 0.3, 0.04)
    building(m, 0.65, 0.45, 0.45, 0.3, 0.2, WHITE)
    for x in (-0.75, -0.75):
        m.box(DARK_STEEL, x, G, 0.55, 0.04, 0.7, 0.04)
        m.box(DARK_STEEL, x, G + 0.6, 0.55, 0.3, 0.03, 0.03)


def nuclear(m):
    base(m, GRASS)
    for x in (-0.5, 0.05):
        m.cyl("#d6d6d0", x, G, -0.35, 0.32, 0.4, 16, rt=0.2)
        m.cyl("#d6d6d0", x, G + 0.4, -0.35, 0.2, 0.22, 16, rt=0.25)
        for k in range(3):
            m.sphere(WHITE, x + 0.04 * k, G + 0.72 + k * 0.1, -0.35, 0.14 + 0.03 * k, 8)
    m.cyl(WHITE, 0.6, G, 0.4, 0.22, 0.3, 14)
    m.sphere(WHITE, 0.6, G + 0.3, 0.4, 0.22, 14)
    building(m, -0.25, 0.5, 0.7, 0.4, 0.25, CREAM)


def corner_start(m):
    base(m, "#3f9b4e")
    for sx in (-0.6, 0.6):
        m.box(WHITE, sx, G, 0, 0.14, 0.75, 0.14)
    m.box(RED, 0, G + 0.75, 0, 1.36, 0.16, 0.16)
    m.box(WHITE, 0.0, G, 0.6, 0.18, 0.012, 0.5)
    m.cyl(WHITE, 0.0, G, 0.28, 0.2, 0.012, 3, rot=[("y", pi / 2)])
    m.box(SILVER, -0.75, G, -0.7, 0.03, 0.8, 0.03, metal=0.8)
    m.box(RED, -0.6, G + 0.6, -0.7, 0.28, 0.18, 0.01)


def corner_casino(m):
    base(m, "#3a1d4f")
    building(m, 0, -0.25, 1.2, 0.8, 0.5, PURPLE, GOLD, GOLD)
    m.box(NEON, 0, G + 0.5, 0.155, 1.2, 0.05, 0.02, glow=True)
    m.box(NEON, 0, G + 0.02, 0.155, 1.2, 0.03, 0.02, glow=True)
    m.cyl(GOLD, 0, G + 0.52, -0.25, 0.3, 0.05, 20, metal=0.8)
    for k in range(12):
        a = 2 * pi * k / 12
        m.box(RED if k % 2 else BLACK, 0.22 * cos(a), G + 0.57, -0.25 - 0.22 * sin(a), 0.1, 0.012, 0.06, ry=a)
    for x, s in ((-0.6, 0.22), (0.55, 0.18)):
        m.box(WHITE, x, G, 0.55, s, s, s, ry=0.4)
    m.box(RED, 0, G, 0.55, 0.3, 0.005, 0.6)


def corner_forum(m):
    base(m, "#bdbdb6")
    building(m, 0, -0.35, 1.3, 0.6, 0.35, GLASS, GLASS_DARK, WHITE)
    flags = (WHITE, BLUE, RED, YELLOW, GREEN_TREE, ORANGE)
    for k, c in enumerate(flags):
        x = -0.75 + k * 0.3
        m.box(SILVER, x, G, 0.5, 0.025, 0.75, 0.025, metal=0.8)
        m.box(c, x + 0.1, G + 0.6, 0.5, 0.18, 0.12, 0.01)
    m.box(RED, 0, G, 0.15, 0.35, 0.005, 0.6)


def corner_zagul(m):
    base(m, ASPHALT)
    building(m, 0, -0.45, 1.2, 0.6, 0.4, BLACK, PINK, PINK)
    m.box(NEON, 0, G + 0.45, -0.14, 0.8, 0.12, 0.02, glow=True)
    m.box(WHITE, 0.0, G + 0.02, 0.45, 0.85, 0.08, 0.17)
    m.box(GLASS_DARK, 0.0, G + 0.1, 0.45, 0.6, 0.05, 0.15)
    for x in (-0.3, -0.15, 0.2, 0.3):
        m.hcyl(BLACK, x, G + 0.03, 0.45, 0.03, 0.19, pi / 2, 8)
    m.box(RED, 0, G, 0.05, 0.25, 0.005, 0.4)
    for x in (-0.2, 0.2):
        m.cyl(GOLD, x, G, 0.05, 0.015, 0.15, 6, metal=0.8)


# ---------- Фишки и кубик (без основания) ----------

def token_sedan(m):
    car(m, 0, 0, 0, BLACK, 2.2, y=0)


def token_helicopter(m):
    m.sphere(BLUE, 0, 0.2, 0, 0.14, 12)
    m.box(BLUE, -0.25, 0.2, 0, 0.3, 0.05, 0.05)
    m.box(BLUE, -0.4, 0.2, 0, 0.04, 0.12, 0.02)
    m.box(DARK_STEEL, 0, 0.34, 0, 0.7, 0.01, 0.05, ry=0.6)
    m.box(DARK_STEEL, 0, 0.34, 0, 0.7, 0.01, 0.05, ry=-0.9)
    for z in (-0.1, 0.1):
        m.box(DARK_STEEL, 0, 0.0, z, 0.35, 0.02, 0.02)


def token_yacht(m):
    m.box(WHITE, 0, 0, 0, 0.6, 0.1, 0.2)
    m.box(WHITE, 0.3, 0, 0, 0.14, 0.1, 0.14, ry=pi / 4)
    m.box(WHITE, -0.05, 0.1, 0, 0.3, 0.08, 0.15)
    m.box(GLASS_DARK, 0.02, 0.12, 0, 0.18, 0.04, 0.155)
    m.box(BLUE, 0, 0.0, 0, 0.62, 0.03, 0.205)


def token_safe(m):
    m.box(DARK_STEEL, 0, 0, 0, 0.32, 0.36, 0.3, metal=0.6)
    m.cyl(SILVER, 0, 0.18, 0.15, 0.06, 0.02, 12, rot=[("x", pi / 2)], metal=0.8)
    m.box(GOLD, 0.11, 0.12, 0.155, 0.03, 0.12, 0.01, metal=0.8)


def token_derrick(m):
    m.box(DARK_STEEL, 0, 0, 0, 0.3, 0.03, 0.3)
    mm = Model("tmp")
    derrick(mm, 0, 0, 0.6)
    for key, arrs in mm.parts.items():
        for a in arrs:
            m.parts.setdefault(key, []).append(a * 0.55 - [0, G * 0.55 - 0.03, 0])


def token_goldbar(m):
    m.box(GOLD, 0, 0, 0, 0.36, 0.1, 0.16, metal=0.9)
    m.box(GOLD, 0, 0.1, 0, 0.3, 0.03, 0.12, metal=0.9)


def dice(m):
    s = 0.4
    m.box(WHITE, 0, 0, 0, s, s, s)
    h, o = s / 2, s / 4
    faces = {  # грань: (нормаль, оси грани u, v)
        1: ((0, 1, 0), (1, 0, 0), (0, 0, 1)), 6: ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
        2: ((1, 0, 0), (0, 1, 0), (0, 0, 1)), 5: ((-1, 0, 0), (0, 1, 0), (0, 0, 1)),
        3: ((0, 0, 1), (1, 0, 0), (0, 1, 0)), 4: ((0, 0, -1), (1, 0, 0), (0, 1, 0)),
    }
    layout = {1: [(0, 0)], 2: [(-1, -1), (1, 1)], 3: [(-1, -1), (0, 0), (1, 1)],
              4: [(-1, -1), (1, -1), (-1, 1), (1, 1)], 5: [(-1, -1), (1, -1), (0, 0), (-1, 1), (1, 1)],
              6: [(-1, -1), (-1, 0), (-1, 1), (1, -1), (1, 0), (1, 1)]}
    for num, (n, u, v) in faces.items():
        for a, b in layout[num]:
            p = [h * n[i] * 0.93 + o * (a * u[i] + b * v[i]) for i in range(3)]
            m.sphere(RED if num == 1 else BLACK, p[0], p[1] + h, p[2], 0.04, 8)


# ---------- Роскошь (без основания, стоят на участке игрока) ----------

def lux_mansion(m):
    m.box(GRASS, 0, 0, 0, 1.9, 0.03, 1.9)
    # главный корпус и два крыла
    m.box(CREAM, 0, 0.03, -0.3, 0.9, 0.45, 0.55)
    m.roof(ROOF, 0, 0.48, -0.3, 0.96, 0.22, 0.6)
    for sx in (-0.65, 0.65):
        m.box(CREAM, sx, 0.03, -0.35, 0.45, 0.32, 0.45)
        m.roof(ROOF, sx, 0.35, -0.35, 0.5, 0.16, 0.5)
        for k in (-0.1, 0.1):
            m.box(GLASS_DARK, sx + k, 0.15, -0.12, 0.08, 0.12, 0.012)
    # портик с колоннами
    m.box(WHITE, 0, 0.03, 0.02, 0.6, 0.04, 0.14)
    for x in (-0.24, -0.08, 0.08, 0.24):
        m.cyl(WHITE, x, 0.07, 0.06, 0.025, 0.36, 8)
    m.roof(WHITE, 0, 0.43, 0.05, 0.62, 0.12, 0.16)
    m.box(WOOD, 0, 0.03, -0.02, 0.12, 0.2, 0.012)
    for k in range(2):
        for x in (-0.3, 0.3):
            m.box(GLASS_DARK, x, 0.12 + k * 0.18, -0.02, 0.09, 0.1, 0.012)
    # бассейн, дорожка, ёлки
    m.box(WHITE, 0.45, 0.03, 0.55, 0.62, 0.025, 0.42)
    m.box(POOL, 0.45, 0.04, 0.55, 0.54, 0.02, 0.34, glow=False)
    m.box(SAND, -0.25, 0.03, 0.55, 0.12, 0.01, 0.75)
    for x, z in ((-0.8, 0.75), (-0.8, 0.35), (0.85, -0.85), (-0.85, -0.85)):
        tree(m, x, z, 1.3, y=0.03)
    for x in (-0.9, 0.9):
        m.box(WHITE, x, 0.03, 0.0, 0.04, 0.12, 1.8)
    m.box(GOLD, -0.25, 0.03, 0.93, 0.3, 0.16, 0.03, metal=0.8)


def lux_car(m):
    s = 3.2
    m.box(RED, 0, 0.03 * s, 0, 0.27 * s, 0.04 * s, 0.12 * s, metal=0.4)
    m.box(RED, 0.02 * s, 0.07 * s, 0, 0.1 * s, 0.03 * s, 0.1 * s, metal=0.4)
    m.box(GLASS_DARK, 0.02 * s, 0.07 * s, 0, 0.11 * s, 0.028 * s, 0.104 * s, rot=[("z", 0.25)])
    m.box(BLACK, -0.125 * s, 0.075 * s, 0, 0.02 * s, 0.01 * s, 0.13 * s)
    for z in (-0.04, 0.04):
        m.box(BLACK, -0.12 * s, 0.07 * s, z * s, 0.01 * s, 0.01 * s, 0.01 * s)
    for dx in (-0.085, 0.085):
        for dz in (-0.06, 0.06):
            m.hcyl(BLACK, dx * s, 0.028 * s, dz * s, 0.028 * s, 0.025 * s, pi / 2, 10)
            m.hcyl(SILVER, dx * s, 0.028 * s, (dz * 1.22) * s, 0.016 * s, 0.004 * s, pi / 2, 8, metal=0.9)
    for z in (-0.04, 0.04):
        m.box(YELLOW, 0.136 * s, 0.05 * s, z * s, 0.004 * s, 0.012 * s, 0.025 * s, glow=True)


def lux_yacht(m):
    m.box(WATER, 0, 0, 0, 1.95, 0.02, 1.0)
    hull_l = 1.5
    m.box(WHITE, -0.05, 0.02, 0, hull_l, 0.16, 0.38)
    m.box(WHITE, hull_l / 2 - 0.05, 0.02, 0, 0.27, 0.16, 0.27, ry=pi / 4)
    m.box(BLUE, 0.05, 0.02, 0, hull_l + 0.2, 0.04, 0.39)
    m.box(WOOD, -0.05, 0.18, 0, hull_l - 0.1, 0.01, 0.34)
    m.box(WHITE, -0.15, 0.19, 0, 0.8, 0.14, 0.3)
    m.box(GLASS_DARK, -0.15, 0.23, 0, 0.82, 0.06, 0.305)
    m.box(WHITE, -0.25, 0.33, 0, 0.5, 0.12, 0.26)
    m.box(GLASS_DARK, -0.15, 0.36, 0, 0.32, 0.05, 0.265)
    m.box(WHITE, -0.3, 0.45, 0, 0.22, 0.05, 0.2)
    m.cyl(SILVER, -0.3, 0.5, 0, 0.012, 0.25, 6, metal=0.8)
    m.box(RED, -0.27, 0.68, 0, 0.06, 0.04, 0.005)
    m.box(POOL, -0.65, 0.185, 0, 0.18, 0.012, 0.2)
    m.box(DARK_STEEL, 0.32, 0.36, 0, 0.12, 0.02, 0.12)
    m.cyl(SILVER, 0.32, 0.38, 0, 0.1, 0.005, 12)


def lux_painting(m):
    # мольберт с картиной в золотой раме
    for x in (-0.25, 0.25):
        m.box(WOOD, x, 0, 0, 0.04, 1.05, 0.04, rot=[("z", -0.12 if x > 0 else 0.12)])
    m.box(WOOD, 0, 0, -0.25, 0.04, 1.0, 0.04, rot=[("x", -0.3)])
    m.box(WOOD, 0, 0.3, 0.02, 0.6, 0.04, 0.08)
    m.box(GOLD, 0, 0.34, 0.03, 0.66, 0.6, 0.04, metal=0.8)
    m.box(CREAM, 0, 0.38, 0.055, 0.56, 0.52, 0.01)
    m.box(BLUE, 0, 0.62, 0.062, 0.56, 0.28, 0.005)
    m.box(YELLOW, 0.13, 0.75, 0.066, 0.1, 0.1, 0.005, glow=True)
    m.box(DARK_GRASS, 0, 0.38, 0.064, 0.56, 0.18, 0.005)
    m.box(ROOF, -0.12, 0.5, 0.066, 0.18, 0.14, 0.005)
    m.box(RED, -0.12, 0.62, 0.068, 0.2, 0.04, 0.005)


def lux_party(m):
    m.box(DARK_GRASS, 0, 0, 0, 1.6, 0.02, 1.6)
    m.box(WHITE, 0, 0.02, 0, 1.0, 0.3, 0.8)
    m.roof(WHITE, 0, 0.32, 0, 1.06, 0.3, 0.86)
    m.box(GOLD, 0, 0.32, 0.43, 1.06, 0.03, 0.01, glow=True)
    for k, c in enumerate((RED, YELLOW, BLUE, PINK, NEON)):
        x = -0.6 + k * 0.3
        m.cyl(SILVER, x, 0.02, 0.65, 0.004, 0.55, 4)
        m.sphere(c, x, 0.62, 0.65, 0.07, 10)
    for x in (-0.25, 0.25):
        m.cyl(WHITE, x, 0.02, 0.6, 0.08, 0.12, 10)
        m.cyl(GOLD, x, 0.14, 0.6, 0.02, 0.06, 6, metal=0.8)
    for k in range(10):
        a = 2 * pi * k / 10
        m.sphere(YELLOW if k % 2 else NEON, 0.55 * cos(a), 0.95 + 0.08 * sin(3 * a), 0.55 * sin(a), 0.03, 6, glow=True)


def lux_vacation(m):
    m.box(WATER, 0, 0, 0, 1.9, 0.02, 1.9)
    m.cyl(SAND, 0, 0.0, 0, 0.75, 0.06, 16)
    palm(m, -0.25, -0.2, 2.2)
    palm(m, 0.3, -0.35, 1.7)
    for x in (-0.1, 0.25):
        m.box(WHITE, x, 0.06, 0.3, 0.14, 0.03, 0.34, rot=[("x", 0.0)])
        m.box(WHITE, x, 0.08, 0.17, 0.14, 0.12, 0.03, rot=[("x", -0.5)])
    m.cyl(SILVER, 0.08, 0.06, 0.15, 0.01, 0.35, 4)
    m.cyl(RED, 0.08, 0.38, 0.15, 0.25, 0.08, 10, rt=0.01)


def lux_gifts(m):
    for x, z, s, c, rib in ((-0.2, 0.0, 0.45, RED, GOLD), (0.28, 0.1, 0.32, BLUE, WHITE), (0.05, -0.32, 0.26, PINK, GOLD), (0.05, 0.0, 0.22, PURPLE, GOLD)):
        y = 0.45 if c == PURPLE else 0
        m.box(c, x, y, z, s, s, s)
        m.box(rib, x, y, z, s + 0.01, s + 0.01, 0.05)
        m.box(rib, x, y, z, 0.05, s + 0.01, s + 0.01)
        m.sphere(rib, x, y + s + 0.03, z, 0.05, 8)


def lux_billboard(m):
    for x in (-0.3, 0.3):
        m.box(DARK_STEEL, x, 0, 0, 0.05, 0.75, 0.05, metal=0.5)
    m.box(DARK_STEEL, 0, 0.7, -0.02, 1.0, 0.5, 0.04, metal=0.5)
    m.box(YELLOW, 0, 0.72, 0.0, 0.95, 0.46, 0.012, glow=True)
    m.box(RED, 0, 0.88, 0.008, 0.8, 0.1, 0.01)
    m.box(BLACK, 0, 0.76, 0.008, 0.6, 0.06, 0.01)


INDUSTRIES = [
    ("agro", "Агро", ("Ферма → Агрохолдинг", "Элеватор", "Экспорт зерна"), (agro_rent, agro_income, agro_special)),
    ("forest", "Лес и бумага", ("Лесопилка → ЦБК", "Мебельная фабрика", "Стройматериалы"),
     (forest_rent, forest_income, forest_special)),
    ("metal", "Металлургия", ("Литейный цех → Меткомбинат", "Прокатный стан", "Поставщик стали"),
     (metal_rent, metal_income, metal_special)),
    ("auto", "Автопром", ("Автозавод → Конвейер", "Дилерская сеть", "Тест-драйв"), (auto_rent, auto_income, auto_special)),
    ("tourism", "Туризм", ("Отель → Курорт", "Санаторий", "Аквапарк"), (tour_rent, tour_income, tour_special)),
    ("gas", "Газ", ("Скважина → Газовый промысел", "Газопровод", "СПГ-завод"), (gas_rent, gas_income, gas_special)),
    ("oil", "Нефть", ("Буровая → Нефтекачалка", "НПЗ", "Нефтепровод"), (oil_rent, oil_income, oil_special)),
    ("finance", "Финансы и IT", ("Бизнес-центр → Небоскрёб", "Банк", "IT-хаб"), (fin_rent, fin_income, fin_special)),
]
BRANCH_IDS = ("rent", "income", "special")

OTHERS = [
    ("tiles", "construction_site", "Стройплощадка", construction_site),
    ("tiles", "transsib", "Транссиб", transsib),
    ("tiles", "port_novorossiysk", "Порт Новороссийск", lambda m: port(m, RED)),
    ("tiles", "port_vladivostok", "Порт Владивосток", lambda m: port(m, BLUE)),
    ("tiles", "airport_sheremetyevo", "Аэропорт Шереметьево", airport),
    ("tiles", "hydro", "ГЭС на Енисее", hydro),
    ("tiles", "nuclear", "АЭС", nuclear),
    ("corners", "start", "Старт", corner_start),
    ("corners", "casino", "Казино", corner_casino),
    ("corners", "forum", "Экономический форум", corner_forum),
    ("corners", "zagul", "Загул", corner_zagul),
    ("tokens", "sedan", "Чёрный седан", token_sedan),
    ("tokens", "helicopter", "Вертолёт", token_helicopter),
    ("tokens", "yacht", "Яхта", token_yacht),
    ("tokens", "safe", "Сейф", token_safe),
    ("tokens", "derrick", "Нефтяная вышка", token_derrick),
    ("tokens", "goldbar", "Золотой слиток", token_goldbar),
    ("props", "dice", "Кубик", dice),
    ("lux", "mansion", "Особняк", lux_mansion),
    ("lux", "car", "Спорткар", lux_car),
    ("lux", "yacht", "Яхта", lux_yacht),
    ("lux", "painting", "Картина", lux_painting),
    ("lux", "party", "Вечеринка", lux_party),
    ("lux", "vacation", "Отдых", lux_vacation),
    ("lux", "gifts", "Подарки", lux_gifts),
    ("lux", "billboard", "Рекламный щит", lux_billboard),
]
