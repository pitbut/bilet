// 3D-вид вала (three.js). Ось вала — X.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import pc from 'polygon-clipping';
import { outerPolygon, innerPolygon, rAt } from './geom.js';

const TEETH = new Set(['spur', 'coupling', 'couplingBlind', 'wormwheel', 'sprocket', 'tpulley', 'spline', 'bevel']);

function gearShape(z, ra, rf, kind, holeR, sp) {
  const shape = new THREE.Shape();
  const pts = [];
  if (kind === 'spline' && sp && sp.kind !== 'эвольвентные') {
    const half = sp.b / 2;
    for (let k = 0; k < z; k++) {
      const th = Math.PI / 2 + k * 2 * Math.PI / z;
      const pD = Math.asin(Math.min(half / ra, 1)), pd = Math.asin(Math.min(half / rf, 1));
      const next = th + 2 * Math.PI / z;
      pts.push([rf, th - pd], [ra, th - pD], [ra, th + pD], [rf, th + pd]);
      for (let i = 1; i < 5; i++) pts.push([rf, th + pd + (next - pd - th - pd) * i / 5]);
    }
  } else {
    const step = 2 * Math.PI / z;
    for (let k = 0; k < z; k++) {
      const a = k * step;
      pts.push([rf, a], [rf, a + step * 0.12], [ra, a + step * 0.34], [ra, a + step * 0.52], [rf, a + step * 0.74]);
      pts.push([rf, a + step * 0.9]);
    }
  }
  pts.forEach(([r, a], i) => (i ? shape.lineTo(r * Math.cos(a), r * Math.sin(a)) : shape.moveTo(r * Math.cos(a), r * Math.sin(a))));
  shape.closePath();
  if (holeR > 0.1) { const h = new THREE.Path(); h.absarc(0, 0, holeR, 0, Math.PI * 2, true); shape.holes.push(h); }
  return shape;
}
function polyShape(n, R, a0, holeR) {
  const shape = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const a = a0 + i * 2 * Math.PI / n;
    i ? shape.lineTo(R * Math.cos(a), R * Math.sin(a)) : shape.moveTo(R * Math.cos(a), R * Math.sin(a));
  }
  shape.closePath();
  if (holeR > 0.1) { const h = new THREE.Path(); h.absarc(0, 0, holeR, 0, Math.PI * 2, true); shape.holes.push(h); }
  return shape;
}
// Экструзия формы (в плоскости YZ) вдоль X от x0 до x1
function extrudeX(shape, x0, x1) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, curveSegments: 24 });
  // форма в (u,v) -> (z = -u?, y = v); экструзия по z -> x
  g.rotateY(Math.PI / 2);
  g.translate(x0, 0, 0);
  return g;
}
function prep(geom) {
  let g = geom.index ? geom.toNonIndexed() : geom.clone();
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  // убрать вырожденные треугольники (полюса тела вращения)
  const idx = g.index.array, keep = [];
  const P = g.attributes.position;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    if (a === b || b === c || a === c) continue;
    const ax = P.getX(a), ay = P.getY(a), az = P.getZ(a);
    const ux = P.getX(b) - ax, uy = P.getY(b) - ay, uz = P.getZ(b) - az;
    const vx = P.getX(c) - ax, vy = P.getY(c) - ay, vz = P.getZ(c) - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz < 1e-12) continue;
    keep.push(a, b, c);
  }
  g.setIndex(keep);
  g.computeVertexNormals();
  return g;
}

export function buildMeshes(geo, opts = {}) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb9bec7, metalness: 0.55, roughness: 0.38, side: THREE.DoubleSide, clippingPlanes: opts.clip || [], clipShadows: true });
  const toothMat = new THREE.MeshStandardMaterial({ color: 0xc9b98f, metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide, clippingPlanes: opts.clip || [] });
  const Lt = geo.Lt;
  // Профиль вращения: вместо зубчатых/гранёных — внутренняя окружность
  const rev = geo.vis.map(p => ({ ...p }));
  const special = geo.outer.filter(o => TEETH.has(o.seg.type) || o.seg.type === 'hex' || o.seg.type === 'square');
  for (const o of special) {
    let rIn;
    if (o.seg.type === 'hex') rIn = o.info.S / 2 * 0.995;
    else if (o.seg.type === 'square') rIn = o.info.S / 2 * 0.995;
    else rIn = Math.min(o.info.rb0, o.info.rb1) * 0.995;
    for (const p of rev) if (p.x > o.x0 - 1e-6 && p.x < o.x1 + 1e-6) p.r = Math.min(p.r, rIn);
  }
  // область (верхняя половина) = наружный минус внутренние
  let region = [[outerPolygon(rev)]];
  for (const inn of [geo.inner.L, geo.inner.R]) {
    const ip = innerPolygon(inn);
    if (ip) try { region = pc.difference(region, [ip]); } catch (e) { /* */ }
  }
  for (const g of geo.facegrooves) {
    const x2 = g.xf + g.dir * g.depth, e = g.xf - g.dir;
    try { region = pc.difference(region, [[[Math.min(e, x2), g.rIn], [Math.max(e, x2), g.rIn], [Math.max(e, x2), g.rOut], [Math.min(e, x2), g.rOut]]]); } catch (e2) { /* */ }
  }
  try { region = pc.intersection(region, [[[-10, 0], [Lt + 10, 0], [Lt + 10, geo.Rmax + 10], [-10, geo.Rmax + 10]]]); } catch (e) { /* */ }
  const parts = [];
  for (const poly of region) {
    let ring = poly[0].slice();
    if (!ring || ring.length < 3) continue;
    const a0 = ring[0], aN = ring[ring.length - 1];
    if (Math.abs(a0[0] - aN[0]) < 1e-9 && Math.abs(a0[1] - aN[1]) < 1e-9) ring.pop();
    // обход по часовой в (x, r): по наружной поверхности x растёт -> нормали лейта наружу
    let area = 0;
    for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; area += p[0] * q[1] - q[0] * p[1]; }
    if (area > 0) ring.reverse();
    // если контур касается оси — разомкнуть по ребру на оси (профиль от оси до оси)
    const n = ring.length;
    let cut = -1;
    for (let i = 0; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n];
      if (Math.abs(p[1]) < 1e-7 && Math.abs(q[1]) < 1e-7) { cut = i; break; }
    }
    if (cut >= 0) ring = [...ring.slice(cut + 1), ...ring.slice(0, cut + 1)];
    else ring.push(ring[0]);
    const pts = ring.map(([x, y]) => new THREE.Vector2(Math.max(y, 0), x));
    const lathe = new THREE.LatheGeometry(pts, 72);
    lathe.rotateZ(-Math.PI / 2);
    parts.push({ geom: lathe, mat });
  }
  // Зубчатые и гранёные ступени
  const holeAt = x => {
    let r = 0;
    for (const inn of [geo.inner.L, geo.inner.R]) {
      const u = inn.side === 'L' ? x : Lt - x;
      if (u >= 0 && u <= inn.cylDepth) r = Math.max(r, rAt(inn.pts, u));
    }
    return r;
  };
  for (const o of special) {
    const { seg, info, x0, x1 } = o;
    const hr = Math.max(holeAt(x0 + 0.01), holeAt(x1 - 0.01), holeAt((x0 + x1) / 2));
    let shape;
    if (seg.type === 'hex') shape = polyShape(6, info.Rc, seg.orient === 'ребро' ? 0 : Math.PI / 2, hr);
    else if (seg.type === 'square') shape = polyShape(4, info.S / Math.SQRT2, Math.PI / 4, hr);
    else if (seg.type === 'bevel') {
      // конус с зубьями: экструзия с масштабом
      const z = Math.max(6, Math.round(+seg.z || 20));
      const shp = gearShape(z, info.r0 > info.r1 ? info.r0 : info.r1, info.rb0 > info.rb1 ? info.rb0 : info.rb1, 'gear', 0);
      const g = extrudeX(shp, x0, x1);
      const pos = g.attributes.position;
      const big = info.bevel.big, k = info.bevel.k;
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getX(i) - x0) / (x1 - x0);
        const sc = big ? 1 - (1 - k) * t : k + (1 - k) * t;
        pos.setY(i, pos.getY(i) * sc); pos.setZ(i, pos.getZ(i) * sc);
      }
      g.computeVertexNormals();
      parts.push({ geom: g, mat: toothMat });
      continue;
    } else {
      const z = seg.type === 'sprocket' || seg.type === 'spline' ? Math.round(+seg.z || 10) : Math.round(+seg.z || 20);
      shape = gearShape(Math.max(4, z), info.r0, info.rb0, seg.type === 'spline' ? 'spline' : 'gear', hr, info.spline);
    }
    parts.push({ geom: extrudeX(shape, x0, x1), mat: seg.type === 'hex' || seg.type === 'square' ? mat : toothMat, seg });
  }
  // Червяк — витки как кольца по винтовой
  for (const o of geo.outer.filter(q => q.seg.type === 'worm')) {
    const { info, x0, x1, seg } = o;
    const m = +seg.m || 2, pz = Math.PI * m * (+seg.z1 || 1);
    const pts = [];
    const turns = (x1 - x0) / pz;
    const N = Math.max(40, Math.round(turns * 48));
    for (let i = 0; i <= N; i++) pts.push(new THREE.Vector3(x0 + (x1 - x0) * i / N, 0, 0));
    const shape = new THREE.Shape();
    const h = info.r0 - info.rb0, w = Math.PI * m / 2;
    shape.moveTo(-w * 0.7, 0); shape.lineTo(-w * 0.3, h); shape.lineTo(w * 0.3, h); shape.lineTo(w * 0.7, 0); shape.closePath();
    const g = new THREE.BufferGeometry();
    const verts = [];
    const prof = [[-w * 0.7, 0], [-w * 0.3, h], [w * 0.3, h], [w * 0.7, 0]];
    for (let i = 0; i < N; i++) {
      const tA = i / N, tB = (i + 1) / N;
      const xa = x0 + (x1 - x0) * tA, xb = x0 + (x1 - x0) * tB;
      const aa = (xa - x0) / pz * 2 * Math.PI, ab = (xb - x0) / pz * 2 * Math.PI;
      for (let j = 0; j < prof.length - 1; j++) {
        const P = (x, a, pr) => [Math.min(Math.max(x + pr[0], x0), x1), (info.rb0 + pr[1]) * Math.cos(a), (info.rb0 + pr[1]) * Math.sin(a)];
        const p1 = P(xa, aa, prof[j]), p2 = P(xa, aa, prof[j + 1]), p3 = P(xb, ab, prof[j + 1]), p4 = P(xb, ab, prof[j]);
        verts.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p4);
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.computeVertexNormals();
    parts.push({ geom: g, mat: toothMat, noCSG: true });
  }

  // Вырезы (CSG)
  const cutters = [];
  for (const k of geo.keyways) {
    const ang = { 'сверху': Math.PI / 2, 'снизу': -Math.PI / 2, 'к зрителю': 0, 'от зрителя': Math.PI }[k.angle] ?? 0;
    let g;
    if (k.kind === 'сегментная') {
      const rc = k.r - k.t + k.dseg / 2;
      g = new THREE.CylinderGeometry(k.dseg / 2, k.dseg / 2, k.b, 40); // ось Y
      g.rotateX(Math.PI / 2); // ось Z: диск в плоскости XY
      g.translate((k.x1 + k.x2) / 2, rc, 0);
      g.rotateX(Math.PI / 2 - ang);
    } else {
      const shape = new THREE.Shape();
      const L = k.len, b = k.b / 2, rr = Math.min(b, L / 2);
      shape.moveTo(rr, -b); shape.lineTo(L - rr, -b); shape.absarc(L - rr, 0, rr, -Math.PI / 2, Math.PI / 2, false);
      shape.lineTo(rr, b); shape.absarc(rr, 0, rr, Math.PI / 2, 3 * Math.PI / 2, false);
      g = new THREE.ExtrudeGeometry(shape, { depth: k.t + 20, bevelEnabled: false, curveSegments: 16 });
      // форма в XY (x вдоль вала, y — ширина), экструзия по Z (радиально)
      g.rotateX(-Math.PI / 2); // экструзия по +Y, ширина по Z
      g.translate(k.x1, k.r - k.t, 0);
      g.rotateX(Math.PI / 2 - ang);
    }
    cutters.push({ g, x0: k.x1, x1: k.x2 });
  }
  for (const h of geo.crossholes) {
    const len = h.through ? geo.Rmax * 3 : h.depth + 20;
    const g = new THREE.CylinderGeometry(h.d / 2, h.d / 2, len, 32);
    if (!h.through) g.translate(0, h.r - h.depth + len / 2, 0);
    if (h.angle !== 'вертикально') g.rotateX(Math.PI / 2);
    g.translate(h.x, 0, 0);
    cutters.push({ g, x0: h.x - h.d, x1: h.x + h.d });
  }
  for (const h of geo.ringholes) {
    for (let i = 0; i < h.n; i++) {
      const a = (h.a0 + i * 360 / h.n) * Math.PI / 180;
      const inner = h.depth > 0 ? h.r - h.depth : 0;
      const len = h.r - inner + 10;
      const g = new THREE.CylinderGeometry(h.d / 2, h.d / 2, len, 24);
      g.translate(0, inner + len / 2, 0);
      g.rotateX(Math.PI / 2 - a); // +Y -> направление a (от +Z к +Y)
      g.translate(h.x, 0, 0);
      cutters.push({ g, x0: h.x - h.d, x1: h.x + h.d });
    }
  }
  for (const h of geo.faceholes) {
    for (let i = 0; i < h.n; i++) {
      const a = (h.a0 + i * 360 / h.n) * Math.PI / 180;
      const g = new THREE.CylinderGeometry(h.d / 2, h.d / 2, h.depth + 2, 24);
      g.rotateZ(Math.PI / 2);
      g.translate(h.xf + h.dir * (h.depth / 2 - 1), h.pcd / 2 * Math.sin(a), h.pcd / 2 * Math.cos(a));
      cutters.push({ g, x0: Math.min(h.xf, h.xf + h.dir * h.depth), x1: Math.max(h.xf, h.xf + h.dir * h.depth) });
    }
  }
  for (const inn of [geo.inner.L, geo.inner.R]) for (const k of inn.keyways) {
    const a = inn.map(k.u0), b = inn.map(k.u1);
    const xa = Math.min(a, b) - (inn.side === 'L' ? 1 : 0), xb = Math.max(a, b) + (inn.side === 'R' ? 1 : 0);
    const g = new THREE.BoxGeometry(xb - xa, k.t + 1, k.b);
    g.translate((xa + xb) / 2, (k.r + k.t) - (k.t + 1) / 2, 0);
    if (k.angle === 'снизу') g.rotateX(Math.PI);
    cutters.push({ g, x0: xa, x1: xb });
  }

  const ev = new Evaluator();
  ev.attributes = ['position', 'normal'];
  ev.useGroups = false;
  for (const p of parts) {
    let geom = p.geom;
    if (!p.noCSG && cutters.length) {
      geom.computeBoundingBox();
      const bb = geom.boundingBox;
      const mine = cutters.filter(c => c.x1 >= bb.min.x - 0.5 && c.x0 <= bb.max.x + 0.5);
      if (mine.length) {
        try {
          let brush = new Brush(prep(geom));
          brush.updateMatrixWorld();
          for (const c of mine) {
            const cb = new Brush(prep(c.g.clone()));
            cb.updateMatrixWorld();
            brush = ev.evaluate(brush, cb, SUBTRACTION);
          }
          geom = brush.geometry;
        } catch (e) {
          console.warn('CSG', e);
        }
      }
    }
    geom.computeVertexNormals();
    const mesh = new THREE.Mesh(geom, p.mat);
    group.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geom, 35), new THREE.LineBasicMaterial({ color: 0x333a44, clippingPlanes: opts.clip || [] }));
    group.add(edges);
  }
  group.position.x = -Lt / 2;
  return group;
}

export class Viewer3D {
  constructor(el) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(0x1d2430);
    el.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.4));
    const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(300, 500, 400); this.scene.add(dl);
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.8); dl2.position.set(-400, -200, -300); this.scene.add(dl2);
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    this.cut = false;
    this.group = null;
    this._raf = null;
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }
  resize() {
    const w = this.el.clientWidth || 300, h = this.el.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  setModel(geo) {
    if (this.group) { this.scene.remove(this.group); this.group.traverse(o => { o.geometry?.dispose?.(); }); }
    this.geo = geo;
    this.group = buildMeshes(geo, { clip: this.cut ? [this.clipPlane] : [] });
    this.scene.add(this.group);
    if (!this._fitted) this.fit();
  }
  setCut(on) { this.cut = on; if (this.geo) this.setModel(this.geo); }
  fit() {
    if (!this.geo) return;
    const L = Math.max(this.geo.Lt, this.geo.Rmax * 2);
    const d = L * 1.9;
    this.camera.position.set(d * 0.25, d * 0.35, d * 0.9);
    this.controls.target.set(0, 0, 0);
    this.camera.near = L / 100; this.camera.far = L * 50; this.camera.updateProjectionMatrix();
    this.controls.update();
    this._fitted = true;
  }
  start() {
    const loop = () => { this._raf = requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); };
    if (!this._raf) loop();
  }
  stop() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }
  snapshot() { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }
}
