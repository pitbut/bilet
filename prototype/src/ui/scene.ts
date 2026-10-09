// 3D-поле: клетки с моделями, фишки, кубики, камера.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { BOARD, INDUSTRIES } from "../engine/board";
import { GameState } from "../engine/engine";
import { sfx } from "./sound";

const S = 2.2; // шаг клетки
const LABEL_DEPTH = 1.0;
const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D>>();

/** Модели, встроенные в страницу (base64), — для публикации одним файлом. */
const embedded = (globalThis as unknown as { OLIGARH_MODELS?: Record<string, string> }).OLIGARH_MODELS;

function fetchGltf(id: string) {
  const b64 = embedded?.[id];
  if (!b64) return loader.loadAsync(`models/${id}.glb`);
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return loader.parseAsync(buf.buffer, "");
}

function loadModel(id: string): Promise<THREE.Object3D> {
  if (!cache.has(id)) {
    cache.set(id, fetchGltf(id).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
      });
      return g.scene;
    }));
  }
  return cache.get(id)!.then((o) => o.clone(true));
}

export function cellPos(i: number): { x: number; z: number; ry: number } {
  const e = 5 * S;
  if (i <= 10) return { x: e - i * S, z: e, ry: 0 };
  if (i <= 20) return { x: -e, z: e - (i - 10) * S, ry: -Math.PI / 2 };
  if (i <= 30) return { x: -e + (i - 20) * S, z: -e, ry: Math.PI };
  return { x: e, z: -e + (i - 30) * S, ry: Math.PI / 2 };
}

function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  draw(cv.getContext("2d")!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function wrapText(c: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
  const words = text.split(" ");
  let line = "", lines: string[] = [];
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (c.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  lines.push(line);
  lines = lines.slice(0, 2);
  lines.forEach((l, k) => c.fillText(l, x, y + (k - (lines.length - 1) / 2) * lh));
}

const DICE_TOP: Record<number, [number, number, number]> = {
  1: [0, 0, 0], 6: [Math.PI, 0, 0], 2: [0, 0, Math.PI / 2], 5: [0, 0, -Math.PI / 2], 3: [-Math.PI / 2, 0, 0], 4: [Math.PI / 2, 0, 0],
};

export class BoardScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  cells: THREE.Group[] = [];
  private cellSig: string[] = [];
  private tokens: THREE.Group[] = [];
  private dice: THREE.Object3D[] = [];
  private center!: THREE.Mesh;
  private centerSig = "";
  hopTime = 0.42;
  safeTop = 56;
  safeBottom = 80;
  safeRight = 0;
  private home: { target: THREE.Vector3; pos: THREE.Vector3 } | null = null;
  /** Метка «куда идти»: кольцо на клетке и стрелка над ней. */
  private marker = new THREE.Group();
  /** Кольцо вокруг фишки того, кто бросил. */
  private tokenRing!: THREE.Mesh;
  private ringOwner = -1;
  onCellClick?: (i: number) => void;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color("#cfd8dc");
    this.scene.fog = new THREE.Fog("#cfd8dc", 45, 90);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.camera.position.set(0, 20, 14);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 3);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.42;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 130;
    this.controls.enablePan = true;

    this.scene.add(new THREE.HemisphereLight("#ffffff", "#8a8070", 1.5));
    const sun = new THREE.DirectionalLight("#ffffff", 2.2);
    sun.position.set(12, 25, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 70 });
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const table = new THREE.Mesh(new THREE.BoxGeometry(34, 0.6, 34), new THREE.MeshStandardMaterial({ color: "#6d4c35", roughness: 0.8 }));
    table.position.y = -0.31;
    table.receiveShadow = true;
    this.scene.add(table);
    const board = new THREE.Mesh(new THREE.BoxGeometry(5 * S * 2 + S + LABEL_DEPTH * 2 + 0.4, 0.1, 5 * S * 2 + S + LABEL_DEPTH * 2 + 0.4),
      new THREE.MeshStandardMaterial({ color: "#efe9dc", roughness: 0.9 }));
    board.position.y = -0.05;
    board.receiveShadow = true;
    this.scene.add(board);
    this.center = new THREE.Mesh(new THREE.PlaneGeometry(9 * S - 0.6, 9 * S - 0.6), new THREE.MeshStandardMaterial({ roughness: 0.9 }));
    this.center.rotation.x = -Math.PI / 2;
    this.center.position.y = 0.01;
    this.center.receiveShadow = true;
    this.scene.add(this.center);

    for (let i = 0; i < 40; i++) {
      const g = new THREE.Group();
      const p = cellPos(i);
      g.position.set(p.x, 0, p.z);
      g.rotation.y = p.ry;
      g.userData.cell = i;
      this.scene.add(g);
      this.cells.push(g);
      this.cellSig.push("");
      this.addLabel(g, i);
    }

    this.buildMarker();
    this.bindPointer();
    window.addEventListener("resize", () => this.resize());
    this.resize();
    const loop = () => {
      this.controls.update();
      if (this.marker.visible) {
        const t = performance.now() / 1000;
        this.marker.children[0].scale.setScalar(1 + 0.08 * Math.sin(t * 6));
        this.marker.children[1].position.y = 2.2 + 0.25 * Math.sin(t * 4);
        this.marker.children[1].rotation.y = t * 2;
      }
      if (this.tokenRing.visible && this.ringOwner >= 0) {
        const tp = this.tokens[this.ringOwner].position;
        this.tokenRing.position.set(tp.x, 0.13, tp.z);
      }
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fitView();
  }

  /** Подбирает дистанцию и центр камеры, чтобы поле целиком помещалось между верхней и нижней панелями. */
  fitView() {
    const h = Math.max(1, this.host.clientHeight), w = Math.max(1, this.host.clientWidth);
    const top = 1 - (2 * this.safeTop) / h, bottom = -1 + (2 * this.safeBottom) / h;
    const left = -0.97, right = 0.97 - (2 * this.safeRight) / w;
    const e = 5 * S + 1.1 + LABEL_DEPTH + 0.2;
    const pts = [[-e, 0, e], [e, 0, e], [-e, 1.6, -e], [e, 1.6, -e], [-e, 0, -e], [e, 0, -e]].map((p) => new THREE.Vector3(...p));
    const polar = this.camera.aspect >= 1.2 ? 0.62 : 0.5; // наклон камеры от вертикали
    const dir = new THREE.Vector3(0, Math.cos(polar), Math.sin(polar));
    const target = new THREE.Vector3(0, 0, 0);
    const extent = (dist: number) => {
      this.camera.position.copy(target).addScaledVector(dir, dist);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld();
      let minX = 9, maxX = -9, minY = 9, maxY = -9;
      for (const p of pts) {
        const v = p.clone().project(this.camera);
        if (v.z > 1 || v.z < -1) return { minX: -9, maxX: 9, minY: -9, maxY: 9 }; // точка позади камеры
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      }
      return { minX, maxX, minY, maxY };
    };
    let dist = 30;
    const fitDist = () => {
      let lo = 6, hi = 150;
      for (let k = 0; k < 30; k++) {
        dist = (lo + hi) / 2;
        const r = extent(dist);
        if (r.maxX - r.minX <= right - left && r.maxY - r.minY <= top - bottom) hi = dist; else lo = dist;
      }
      dist = hi;
    };
    for (let pass = 0; pass < 4; pass++) {
      fitDist();
      // центр поля — посередине свободной области: чем больше target.z, тем выше поле на экране
      let lo = -20, hi = 20;
      for (let k = 0; k < 30; k++) {
        target.z = (lo + hi) / 2;
        const r = extent(dist);
        if ((r.maxY + r.minY) / 2 < (top + bottom) / 2) lo = target.z; else hi = target.z;
      }
      // и посередине по горизонтали между левым краем и столбцом карточек
      lo = -20; hi = 20;
      for (let k = 0; k < 30; k++) {
        target.x = (lo + hi) / 2;
        const r = extent(dist);
        if ((r.maxX + r.minX) / 2 > (left + right) / 2) lo = target.x; else hi = target.x;
      }
    }
    fitDist();
    if (this.scene.fog instanceof THREE.Fog) { this.scene.fog.near = dist * 1.4; this.scene.fog.far = dist * 3; }
    extent(dist);
    this.home = { target: target.clone(), pos: this.camera.position.clone() };
    this.controls.target.copy(target);
    this.controls.update();
  }

  private addLabel(g: THREE.Group, i: number) {
    const c = BOARD[i];
    const color = c.industry ? INDUSTRIES[c.industry].color : "#9aa0a6";
    const tex = canvasTexture(256, 128, (x) => {
      x.fillStyle = "#fbf8f1"; x.fillRect(0, 0, 256, 128);
      x.fillStyle = color; x.fillRect(0, 0, 256, 26);
      x.fillStyle = "#222"; x.textAlign = "center"; x.textBaseline = "middle";
      x.font = "600 30px system-ui, sans-serif";
      wrapText(x, c.name, 128, 66, 240, 30);
      if (c.price) { x.font = "500 22px system-ui, sans-serif"; x.fillStyle = "#555"; x.fillText(`${c.price} млн ₽`, 128, 112); }
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(S - 0.1, LABEL_DEPTH - 0.08), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.012, 1.1 + LABEL_DEPTH / 2);
    m.receiveShadow = true;
    g.add(m);
  }

  private bindPointer() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    el.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener("pointerup", (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
      const r = el.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      const hit = ray.intersectObjects(this.cells, true)[0];
      if (!hit) return;
      let o: THREE.Object3D | null = hit.object;
      while (o && o.userData.cell === undefined) o = o.parent;
      if (o) this.onCellClick?.(o.userData.cell);
    });
  }

  /** Обновляет внешний вид клеток по состоянию партии (перестраивает только изменившиеся). */
  async sync(s: GameState) {
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < 40; i++) {
      const p = s.props[i];
      const sig = p ? `${p.owner}|${p.level}|${p.branch}|${p.mortgaged}|${p.construction ? Math.floor(p.construction.progress / 5) : "-"}` : "static";
      if (sig === this.cellSig[i]) continue;
      this.cellSig[i] = sig;
      jobs.push(this.rebuildCell(s, i));
    }
    this.drawCenter(s);
    await Promise.all(jobs);
  }

  private async rebuildCell(s: GameState, i: number) {
    const g = this.cells[i];
    const old = g.getObjectByName("content");
    const content = new THREE.Group();
    content.name = "content";
    const c = BOARD[i], p = s.props[i];
    let modelId: string | null = c.model ?? null;
    if (c.kind === "business") {
      if (p.construction) modelId = "tiles/construction_site";
      else if (p.level > 0 && p.branch) modelId = `industries/${c.industry}/${c.industry}_${p.branch}_${p.level}`;
      else modelId = null;
    }
    if (modelId) {
      const m = await loadModel(modelId);
      content.add(m);
    } else {
      content.add(this.plate(c.kind, c.industry ? INDUSTRIES[c.industry].color : "#9aa0a6", c.kind));
    }
    if (p?.owner !== null && p?.owner !== undefined) {
      const col = s.players[p.owner].color;
      const flag = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6), new THREE.MeshStandardMaterial({ color: "#ddd" }));
      pole.position.y = 0.55;
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.02), new THREE.MeshStandardMaterial({ color: col }));
      cloth.position.set(0.22, 0.95, 0);
      flag.add(pole, cloth);
      flag.position.set(0.85, 0.08, 0.85);
      flag.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
      content.add(flag);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.02, 1.1, 4, 1), new THREE.MeshBasicMaterial({ color: col }));
      ring.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
      ring.scale.setScalar(Math.SQRT2);
      ring.position.y = 0.02;
      content.add(ring);
      if (p.mortgaged) {
        const lock = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.02, 1.9), new THREE.MeshStandardMaterial({ color: "#000", transparent: true, opacity: 0.35 }));
        lock.position.y = 0.12;
        content.add(lock);
      }
    }
    if (p?.construction) content.add(this.progressBar(p.construction.progress, p.construction.target));
    if (old) g.remove(old);
    g.add(content);
  }

  private plate(kind: string, color: string, label: string): THREE.Object3D {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.08, 1.96), new THREE.MeshStandardMaterial({ color: "#e4ddcc", roughness: 0.9 }));
    base.position.y = 0.04;
    base.receiveShadow = true;
    g.add(base);
    const icon = { business: "", news: "?", gov: "★", tax: "₽" }[kind as "business"] ?? label;
    const tex = canvasTexture(256, 256, (x) => {
      x.fillStyle = "#e4ddcc"; x.fillRect(0, 0, 256, 256);
      x.strokeStyle = color; x.lineWidth = 14; x.strokeRect(10, 10, 236, 236);
      x.fillStyle = kind === "business" ? color : "#555";
      x.textAlign = "center"; x.textBaseline = "middle";
      if (kind === "business") { x.globalAlpha = 0.35; x.fillRect(40, 40, 176, 176); x.globalAlpha = 1; x.fillStyle = "#333"; x.font = "600 34px system-ui"; x.fillText("участок", 128, 128); }
      else { x.font = "700 130px system-ui"; x.fillText(icon, 128, 136); }
    });
    const top = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.082;
    top.receiveShadow = true;
    g.add(top);
    return g;
  }

  private progressBar(progress: number, target: number) {
    const tex = canvasTexture(256, 64, (x) => {
      x.fillStyle = "rgba(20,20,20,0.85)"; x.fillRect(0, 0, 256, 64);
      x.fillStyle = "#f2c234"; x.fillRect(6, 30, Math.min(244, 244 * progress / 100), 28);
      x.fillStyle = "#fff"; x.font = "600 22px system-ui"; x.textAlign = "center";
      x.fillText(`Стройка ур. ${target}: ${Math.floor(Math.min(100, progress))}%`, 128, 22);
    });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sp.scale.set(2.0, 0.5, 1);
    sp.position.set(0, 2.1, 0);
    sp.renderOrder = 10;
    return sp;
  }

  private drawCenter(s: GameState) {
    const sig = `${s.round}|${s.jackpot}|${s.market?.title}`;
    if (sig === this.centerSig) return;
    this.centerSig = sig;
    const tex = canvasTexture(1024, 1024, (x) => {
      const gr = x.createRadialGradient(512, 512, 100, 512, 512, 720);
      gr.addColorStop(0, "#f7f1e1"); gr.addColorStop(1, "#d9cfb4");
      x.fillStyle = gr; x.fillRect(0, 0, 1024, 1024);
      x.textAlign = "center"; x.textBaseline = "middle";
      x.fillStyle = "#8b1e1e"; x.font = "800 150px Georgia, serif"; x.fillText("ОЛИГАРХ", 512, 330);
      x.fillStyle = "#444"; x.font = "500 44px system-ui"; x.fillText(`Раунд ${s.round}${s.cfg.length === "quick" ? ` из ${s.cfg.quickRounds ?? 15}` : ""}`, 512, 450);
      x.fillStyle = "#6b4f1d"; x.font = "600 46px system-ui"; x.fillText(`Джекпот казино: ${s.jackpot} млн ₽`, 512, 530);
      if (s.market) {
        x.fillStyle = "#1f4e79"; x.font = "600 38px system-ui";
        wrapText(x, `Рынок: ${s.market.title}`, 512, 640, 900, 46);
      }
    });
    const mat = this.center.material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    mat.map = tex;
    mat.needsUpdate = true;
  }

  // ---------- Фишки ----------

  async setupTokens(s: GameState) {
    for (const pl of s.players) {
      const g = new THREE.Group();
      const m = await loadModel(`tokens/${pl.token}`);
      const box = new THREE.Box3().setFromObject(m);
      const size = box.getSize(new THREE.Vector3());
      const k = 1.0 / Math.max(size.x, size.z, 0.01);
      m.scale.setScalar(k);
      g.add(m);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 20), new THREE.MeshStandardMaterial({ color: pl.color }));
      disc.position.y = 0.03;
      disc.castShadow = true;
      g.add(disc);
      m.position.y = 0.06;
      this.scene.add(g);
      this.tokens.push(g);
      this.placeToken(pl.id, pl.pos, s.players.length);
    }
  }

  private slot(pid: number, cellI: number, n: number) {
    const p = cellPos(cellI);
    const a = (pid / Math.max(1, n)) * Math.PI * 2;
    return new THREE.Vector3(p.x + Math.cos(a) * 0.55, 0.12, p.z + Math.sin(a) * 0.55);
  }

  placeToken(pid: number, cellI: number, n: number) {
    this.tokens[pid].position.copy(this.slot(pid, cellI, n));
    this.tokens[pid].rotation.y = cellPos(cellI).ry;
  }

  hideToken(pid: number) { this.tokens[pid].visible = false; }

  async moveToken(pid: number, path: number[], n: number, teleport = false) {
    const t = this.tokens[pid];
    if (teleport || this.hopTime === 0) {
      if (!teleport || this.hopTime === 0) { this.placeToken(pid, path[path.length - 1], n); return; }
      await this.tween(0.25, (k) => { t.position.y = 0.1 + k * 4; });
      this.placeToken(pid, path[path.length - 1], n);
      await this.tween(0.25, (k) => { t.position.y = 4 - k * 3.9; });
      return;
    }
    for (const c of path) {
      const from = t.position.clone(), to = this.slot(pid, c, n);
      const ry0 = t.rotation.y, ry1 = cellPos(c).ry;
      await this.tween(this.hopTime, (k) => {
        t.position.lerpVectors(from, to, k);
        t.position.y = 0.1 + Math.sin(k * Math.PI) * 0.6;
        t.rotation.y = ry0 + (ry1 - ry0) * k;
      });
    }
  }

  // ---------- Кубики ----------

  async setupDice() {
    for (let k = 0; k < 2; k++) {
      const inner = await loadModel("props/dice");
      inner.position.y = -0.2; // центр кубика — в начале координат, чтобы вращать вокруг центра
      const d = new THREE.Group();
      d.add(inner);
      d.scale.setScalar(2.2);
      d.visible = false;
      this.scene.add(d);
      this.dice.push(d);
    }
  }

  async rollDice(a: number, b: number) {
    if (this.hopTime === 0) return;
    const vals = [a, b];
    const starts = this.dice.map((_, k) => new THREE.Vector3(-3 + k * 1.2, 7, 6));
    const ends = this.dice.map((_, k) => new THREE.Vector3(-1.1 + k * 2.2, 0.44, 0.5 + k * 0.4));
    const spins = this.dice.map(() => new THREE.Euler(Math.random() * 6 + 6, Math.random() * 6, Math.random() * 6 + 4));
    this.dice.forEach((d) => { d.visible = true; });
    sfx.dice();
    // камера опускается к месту падения кубиков
    const diceTarget = new THREE.Vector3(0, 0.6, 1.0);
    const near = this.camera.aspect < 1 ? 13 : 9;
    this.controls.enabled = false;
    void this.flyTo(diceTarget.clone().add(new THREE.Vector3(0, near * 0.75, near * 0.66)), diceTarget, 0.6);
    await this.tween(1.1, (k) => {
      const e = 1 - Math.pow(1 - k, 3);
      this.dice.forEach((d, i) => {
        d.position.lerpVectors(starts[i], ends[i], e);
        d.position.y = ends[i].y + (1 - e) * 7 + Math.abs(Math.sin(e * Math.PI * 2)) * (1 - e) * 1.5;
        const f = DICE_TOP[vals[i]];
        d.rotation.set(f[0] + spins[i].x * (1 - e), f[1] + spins[i].y * (1 - e), f[2] + spins[i].z * (1 - e));
      });
    });
    await this.wait(0.35);
    this.controls.enabled = true;
  }

  hideDice() { this.dice.forEach((d) => { d.visible = false; }); }

  // ---------- Кинокамера ----------

  private buildMarker() {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.78, 1.02, 48), new THREE.MeshBasicMaterial({ color: "#ffd54f", transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.16;
    const pin = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.7, 4), new THREE.MeshStandardMaterial({ color: "#ffd54f", emissive: "#7a5a00" }));
    pin.rotation.x = Math.PI; // остриём вниз
    this.marker.add(ring, pin);
    this.marker.visible = false;
    this.scene.add(this.marker);
    this.tokenRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 40), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    this.tokenRing.rotation.x = -Math.PI / 2;
    this.tokenRing.visible = false;
    this.scene.add(this.tokenRing);
  }

  private showMarker(cellI: number, pid: number, color: string) {
    const p = cellPos(cellI);
    this.marker.position.set(p.x, 0, p.z);
    for (const m of this.marker.children) ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(color);
    this.marker.visible = true;
    (this.tokenRing.material as THREE.MeshBasicMaterial).color.set(color);
    this.ringOwner = pid;
    this.tokenRing.visible = true;
  }

  private hideMarker() { this.marker.visible = false; this.tokenRing.visible = false; this.ringOwner = -1; }

  /** Плавный перелёт камеры (с замедлением в начале и конце). */
  private flyTo(pos: THREE.Vector3, target: THREE.Vector3, sec: number) {
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
    return this.tween(sec, (k) => {
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.camera.position.lerpVectors(p0, pos, e);
      this.controls.target.lerpVectors(t0, target, e);
      this.camera.lookAt(this.controls.target);
    });
  }

  /** Вид сверху на всё поле. */
  private topView() {
    const home = this.home ?? { target: new THREE.Vector3(), pos: new THREE.Vector3(0, 30, 14) };
    const d = home.pos.distanceTo(home.target) * 1.05;
    return { target: home.target.clone(), pos: home.target.clone().add(new THREE.Vector3(0, d * 0.985, d * 0.17)) };
  }

  /** Камера сбоку-сверху (30° к доске) снаружи поля, смотрит на точку p. */
  private followPose(p: THREE.Vector3) {
    const out = new THREE.Vector3(p.x, 0, p.z);
    if (out.lengthSq() < 0.01) out.set(0, 0, 1);
    out.normalize();
    const d = this.camera.aspect < 1 ? 14 : 6.5;
    const el = Math.PI / 6;
    const target = new THREE.Vector3(p.x, 0.4, p.z);
    const pos = target.clone().addScaledVector(out, d * Math.cos(el)).add(new THREE.Vector3(0, d * Math.sin(el), 0));
    return { pos, target };
  }

  /** Ход фишки «с кинематографом»: пауза → вид сверху с меткой → наезд 30° и проводка → отъезд на обзор. */
  /** Крупный план клетки: показать прокачку (стройку или готовое здание), потом вернуться к обзору. */
  async closeUp(cellI: number, hold = 1.8) {
    if (this.hopTime === 0 || !this.home) return;
    const f = this.hopTime / 0.42;
    const p = cellPos(cellI);
    const target = new THREE.Vector3(p.x, 0.5, p.z);
    const out = new THREE.Vector3(p.x, 0, p.z).normalize();
    const d = this.camera.aspect < 1 ? 8 : 4.6;
    const pos = target.clone().addScaledVector(out, d * Math.cos(0.75)).add(new THREE.Vector3(0, d * Math.sin(0.75), 0));
    this.controls.enabled = false;
    try {
      sfx.whoosh();
      await this.flyTo(pos, target, 1.0 * f);
      // медленный облёт вокруг здания
      const a0 = Math.atan2(pos.z - target.z, pos.x - target.x), r = Math.hypot(pos.x - target.x, pos.z - target.z), y = pos.y;
      await this.tween(hold * f, (k) => {
        const a = a0 + (k - 0.5) * 0.7;
        this.camera.position.set(target.x + Math.cos(a) * r, y, target.z + Math.sin(a) * r);
        this.camera.lookAt(target);
      });
      await this.flyTo(this.home.pos, this.home.target, 1.0 * f);
    } finally {
      this.controls.enabled = true;
    }
  }

  async cinematicMove(pid: number, path: number[], n: number, color: string) {
    const t = this.tokens[pid];
    const dest = path[path.length - 1];
    if (this.hopTime === 0) { this.hideDice(); this.placeToken(pid, dest, n); return; }
    const f = this.hopTime / 0.42; // быстрая анимация — всё короче
    this.controls.enabled = false;
    try {
      await this.wait(1.3 * f); // кубики лежат чуть больше секунды
      this.hideDice();
      const top = this.topView();
      this.showMarker(dest, pid, color);
      sfx.whoosh();
      await this.flyTo(top.pos, top.target, 1.3 * f);
      await this.wait(1.5 * f);
      const start = this.followPose(t.position);
      sfx.whoosh();
      await this.flyTo(start.pos, start.target, 1.2 * f);
      const want = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
      for (const c of path) {
        const from = t.position.clone(), to = this.slot(pid, c, n);
        const ry0 = t.rotation.y, ry1 = cellPos(c).ry;
        sfx.step();
        await this.tween(this.hopTime, (k) => {
          t.position.lerpVectors(from, to, k);
          t.position.y = 0.12 + Math.sin(k * Math.PI) * 0.6;
          t.rotation.y = ry0 + (ry1 - ry0) * k;
          const fp = this.followPose(t.position);
          want.pos.copy(fp.pos); want.target.copy(fp.target);
          this.camera.position.lerp(want.pos, 0.12);
          this.controls.target.lerp(want.target, 0.18);
          this.camera.lookAt(this.controls.target);
        });
      }
      await this.wait(0.6 * f);
      this.hideMarker();
      if (this.home) await this.flyTo(this.home.pos, this.home.target, 1.4 * f);
    } finally {
      this.hideMarker();
      this.controls.enabled = true;
    }
  }

  // ---------- Анимация ----------

  tween(sec: number, fn: (k: number) => void): Promise<void> {
    return new Promise((res) => {
      const t0 = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / (sec * 1000));
        fn(k);
        if (k < 1) requestAnimationFrame(step); else res();
      };
      step();
    });
  }

  wait(sec: number) { return new Promise<void>((r) => setTimeout(r, sec * 1000)); }

  /** Возвращает камеру в исходный обзор всего поля. */
  resetView() {
    if (!this.home) return;
    const { target, pos } = this.home;
    const t0 = this.controls.target.clone(), p0 = this.camera.position.clone();
    void this.tween(0.6, (k) => {
      this.controls.target.lerpVectors(t0, target, k);
      this.camera.position.lerpVectors(p0, pos, k);
    });
  }
}
