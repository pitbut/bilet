"""Простейшая low-poly геометрия и запись в GLB (glTF 2.0) без внешних библиотек, только numpy."""
import json
import struct
from math import cos, sin, pi

import numpy as np


def _rot(axis, a):
    c, s = cos(a), sin(a)
    if axis == "x":
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == "y":
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def _orient(tris, center):
    """Разворачивает треугольники выпуклой фигуры нормалью наружу."""
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    out = tris.mean(axis=1) - center
    flip = (n * out).sum(axis=1) < 0
    tris[flip] = tris[flip][:, [0, 2, 1]]
    return tris


def _quad(a, b, c, d):
    return [(a, b, c), (a, c, d)]


def box_local(sx, sy, sz):
    x, z = sx / 2, sz / 2
    p = [(-x, 0, -z), (x, 0, -z), (x, 0, z), (-x, 0, z),
         (-x, sy, -z), (x, sy, -z), (x, sy, z), (-x, sy, z)]
    f = []
    for a, b, c, d in [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]:
        f += _quad(p[a], p[b], p[c], p[d])
    return _orient(np.array(f, float), np.array([0, sy / 2, 0]))


def cyl_local(r, h, n=12, rt=None):
    rt = r if rt is None else rt
    f = []
    for i in range(n):
        a0, a1 = 2 * pi * i / n, 2 * pi * (i + 1) / n
        b0, b1 = (r * cos(a0), 0, r * sin(a0)), (r * cos(a1), 0, r * sin(a1))
        t0, t1 = (rt * cos(a0), h, rt * sin(a0)), (rt * cos(a1), h, rt * sin(a1))
        if rt > 0:
            f += _quad(b0, b1, t1, t0)
            f.append(((0, h, 0), t0, t1))
        else:
            f.append((b0, b1, (0, h, 0)))
        f.append(((0, 0, 0), b0, b1))
    return _orient(np.array(f, float), np.array([0, h / 2, 0]))


def sphere_local(r, n=10):
    f = []
    rows = n // 2
    for i in range(rows):
        p0, p1 = pi * i / rows - pi / 2, pi * (i + 1) / rows - pi / 2
        for j in range(n):
            a0, a1 = 2 * pi * j / n, 2 * pi * (j + 1) / n
            v = lambda p, a: (r * cos(p) * cos(a), r * sin(p), r * cos(p) * sin(a))
            q = [v(p0, a0), v(p0, a1), v(p1, a1), v(p1, a0)]
            f += _quad(*q)
    t = np.array(f, float)
    area = np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1)
    return _orient(t[area > 1e-9], np.zeros(3))


def prism_local(sx, sy, sz):
    """Двускатная крыша: конёк вдоль X."""
    x, z = sx / 2, sz / 2
    a, b, c = (-x, 0, -z), (-x, 0, z), (-x, sy, 0)
    d, e, g = (x, 0, -z), (x, 0, z), (x, sy, 0)
    f = [(a, b, c), (d, e, g)] + _quad(a, d, g, c) + _quad(b, e, g, c) + _quad(a, d, e, b)
    return _orient(np.array(f, float), np.array([0, sy / 3, 0]))


def _lin(hexcolor):
    h = hexcolor.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb] + [1.0]


class Model:
    def __init__(self, name):
        self.name = name
        self.parts = {}  # (color, metal, glow) -> list of arrays

    def add(self, tris, color, pos=(0, 0, 0), rot=(), metal=0.0, glow=False):
        t = tris.copy()
        for axis, ang in rot:
            t = t @ _rot(axis, ang).T
        t = t + np.array(pos, float)
        self.parts.setdefault((color, metal, glow), []).append(t)

    # удобные обёртки: y — низ фигуры
    def box(self, c, x, y, z, sx, sy, sz, ry=0.0, metal=0.0, glow=False, rot=None):
        self.add(box_local(sx, sy, sz), c, (x, y, z), rot or [("y", ry)], metal, glow)

    def cyl(self, c, x, y, z, r, h, n=12, rt=None, metal=0.0, rot=None, glow=False):
        self.add(cyl_local(r, h, n, rt), c, (x, y, z), rot or [], metal, glow)

    def hcyl(self, c, x, y, z, r, length, ry=0.0, n=12, metal=0.0):
        """Лежачий цилиндр вдоль X (с поворотом ry), (x, y, z) — центр."""
        t = cyl_local(r, length, n) - np.array([0, length / 2, 0])
        self.add(t, c, (x, y, z), [("z", -pi / 2), ("y", ry)], metal)

    def sphere(self, c, x, y, z, r, n=10, metal=0.0, glow=False):
        self.add(sphere_local(r, n), c, (x, y, z), [], metal, glow)

    def roof(self, c, x, y, z, sx, sy, sz, ry=0.0):
        self.add(prism_local(sx, sy, sz), c, (x, y, z), [("y", ry)])

    def save(self, path):
        pos_chunks, prims, mats, views, accs = [], [], [], [], []
        offset = 0
        for i, ((color, metal, glow), arrs) in enumerate(self.parts.items()):
            t = np.concatenate(arrs).astype(np.float32)
            n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
            n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
            pos = t.reshape(-1, 3)
            nor = np.repeat(n, 3, axis=0).astype(np.float32)
            for arr, kind in ((pos, "POSITION"), (nor, "NORMAL")):
                b = arr.tobytes()
                views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(b), "target": 34962})
                acc = {"bufferView": len(views) - 1, "componentType": 5126, "count": len(arr), "type": "VEC3"}
                if kind == "POSITION":
                    acc["min"], acc["max"] = pos.min(0).tolist(), pos.max(0).tolist()
                accs.append(acc)
                pos_chunks.append(b)
                offset += len(b)
            m = {"name": color, "pbrMetallicRoughness": {"baseColorFactor": _lin(color),
                 "metallicFactor": min(metal, 0.3), "roughnessFactor": 0.45 if metal else 0.85}}
            if glow:
                m["emissiveFactor"] = _lin(color)[:3]
            mats.append(m)
            prims.append({"attributes": {"POSITION": len(accs) - 2, "NORMAL": len(accs) - 1}, "material": i})
        blob = b"".join(pos_chunks)
        gltf = {"asset": {"version": "2.0", "generator": "oligarh-lowpoly"}, "scene": 0,
                "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": self.name}],
                "meshes": [{"name": self.name, "primitives": prims}], "materials": mats,
                "buffers": [{"byteLength": len(blob)}], "bufferViews": views, "accessors": accs}
        js = json.dumps(gltf, ensure_ascii=False).encode()
        js += b" " * (-len(js) % 4)
        blob += b"\0" * (-len(blob) % 4)
        total = 12 + 8 + len(js) + 8 + len(blob)
        with open(path, "wb") as fh:
            fh.write(struct.pack("<III", 0x46546C67, 2, total))
            fh.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
            fh.write(struct.pack("<II", len(blob), 0x004E4942) + blob)
        return sum(len(a) for arrs in self.parts.values() for a in arrs)
