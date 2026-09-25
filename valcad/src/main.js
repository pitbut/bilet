import { App as CapApp } from '@capacitor/app';
import {
  OUTER, INNER, FEATURES, OUTER_GROUPS, INNER_GROUPS, OUTER_FEATURES, MATERIALS, TT_TEMPLATES, RA_LIST,
  newSegment, newFeature, newProject, uid,
} from './catalog.js';
import { computeModel, fmt, num, segLength } from './geom.js';
import { buildSheet, sectionList, scaleName } from './drawing.js';
import { deviations, fmtDev } from './standards.js';
import { drawSheet, sheetToImage } from './render/canvas.js';
import { toDXF } from './render/dxf.js';
import { toPDF } from './render/pdf.js';
import * as P from './platform.js';

const $ = s => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};

// ---------------- Состояние ----------------
const st = {
  id: null, project: null, hist: [], fut: [], lastPush: 0,
  tab: 'outer', edit: null, // { list, segId, featId }
  sheet: null, view: null, mode: '2d', viewer: null, cut3d: false, dirty3d: true,
};

function snapshot() { return JSON.stringify(st.project); }
function pushHist(force) {
  const now = Date.now();
  if (!force && now - st.lastPush < 900) return;
  st.hist.push(snapshot()); if (st.hist.length > 80) st.hist.shift();
  st.fut = []; st.lastPush = now;
}
function changed(opts = {}) {
  scheduleBuild();
  scheduleSave();
  st.dirty3d = true;
  if (opts.panel) renderPanel();
  updateTitle();
}
let saveT = null;
function scheduleSave() {
  clearTimeout(saveT);
  saveT = setTimeout(() => P.saveProject(st.id, st.project).catch(e => console.warn(e)), 600);
}
function undo() {
  if (!st.hist.length) return toast('Нечего отменять');
  st.fut.push(snapshot()); st.project = JSON.parse(st.hist.pop()); st.lastPush = 0;
  validateEdit(); changed({ panel: true });
}
function redo() {
  if (!st.fut.length) return;
  st.hist.push(snapshot()); st.project = JSON.parse(st.fut.pop());
  validateEdit(); changed({ panel: true });
}
function validateEdit() {
  if (!st.edit) return;
  const seg = findSeg(st.edit.list, st.edit.segId);
  if (!seg) st.edit = null;
  else if (st.edit.featId && !seg.features.find(f => f.id === st.edit.featId)) st.edit.featId = null;
}
function findSeg(list, id) { return (st.project[list] || []).find(s => s.id === id); }

function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}
function updateTitle() {
  const m = st.project.meta;
  $('#title').textContent = `${m.name || 'Вал'} · ${m.designation || ''}`;
}

// ---------------- Построение и 2D ----------------
let buildT = null;
function scheduleBuild(delay = 90) { clearTimeout(buildT); buildT = setTimeout(build, delay); }
function build() {
  try {
    const hl = st.edit ? st.edit.segId : null;
    st.sheet = buildSheet(st.project, { highlight: hl });
  } catch (e) {
    console.error(e);
    toast('Ошибка построения: ' + e.message, 4000);
    return;
  }
  if (!st.view || st.view.W !== st.sheet.W || st.view.H !== st.sheet.H) fitView();
  draw();
  const w = st.sheet.warnings;
  const wb = $('#warn');
  wb.hidden = !w.length; wb.textContent = '⚠ ' + w.length;
  const m = st.sheet;
  $('#info').textContent = `${m.sheetMode ? m.format + ' · ' : ''}М ${scaleName(m.scale)} · L=${fmt(Math.round(m.geo.Lt * 100) / 100)} · ${fmt(Math.round(m.mass * 100) / 100)} кг`;
  $('#btnView').textContent = { 'вид': 'Вид', 'полуразрез': 'Полуразрез', 'разрез': 'Разрез' }[st.project.meta.view] || 'Вид';
  $('#btnSheet').textContent = st.project.meta.sheetMode === 'деталь' ? 'Деталь' : 'Лист';
  if (st.mode === '3d') update3d();
}
const cv = $('#cv');
function fitView() {
  if (!st.sheet) return;
  const r = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cw = r.width * dpr, ch = r.height * dpr;
  const k = Math.min(cw / st.sheet.W, ch / st.sheet.H) * 0.94;
  st.view = { k, ox: (cw - st.sheet.W * k) / 2, oy: (ch + st.sheet.H * k) / 2, W: st.sheet.W, H: st.sheet.H };
}
function draw() {
  const r = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    if (st.sheet) fitView();
  }
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#5a6472'; ctx.fillRect(0, 0, cv.width, cv.height);
  if (!st.sheet || !st.view) return;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 12 * dpr;
  ctx.fillStyle = '#fff';
  ctx.fillRect(st.view.ox, st.view.oy - st.sheet.H * st.view.k, st.sheet.W * st.view.k, st.sheet.H * st.view.k);
  ctx.restore();
  drawSheet(ctx, st.sheet, st.view, { highlight: true, minPx: 0.7 * dpr });
}
window.addEventListener('resize', () => { fitView(); draw(); });

// жесты: перетаскивание, щипок, двойной тап, тап — выбор ступени
{
  const ptrs = new Map();
  let start = null, moved = false, lastTap = 0;
  const pos = e => { const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1; return [(e.clientX - r.left) * d, (e.clientY - r.top) * d]; };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, pos(e));
    moved = false;
    start = { view: { ...st.view }, pts: [...ptrs.values()].map(p => [...p]) };
  });
  cv.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId) || !st.view) return;
    ptrs.set(e.pointerId, pos(e));
    const pts = [...ptrs.values()];
    if (pts.length !== start.pts.length) start = { view: { ...st.view }, pts: pts.map(p => [...p]) };
    if (pts.length === 1) {
      const dx = pts[0][0] - start.pts[0][0], dy = pts[0][1] - start.pts[0][1];
      if (Math.hypot(dx, dy) > 6) moved = true;
      if (moved) { st.view.ox = start.view.ox + dx; st.view.oy = start.view.oy + dy; draw(); }
    } else if (pts.length >= 2) {
      moved = true;
      const d0 = Math.hypot(start.pts[0][0] - start.pts[1][0], start.pts[0][1] - start.pts[1][1]);
      const d1 = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      const c0 = [(start.pts[0][0] + start.pts[1][0]) / 2, (start.pts[0][1] + start.pts[1][1]) / 2];
      const c1 = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
      const f = Math.max(0.05, d1 / Math.max(d0, 1));
      const k = Math.min(Math.max(start.view.k * f, 0.2), 200);
      const ff = k / start.view.k;
      st.view.k = k;
      st.view.ox = c1[0] - (c0[0] - start.view.ox) * ff;
      st.view.oy = c1[1] - (c0[1] - start.view.oy) * ff;
      draw();
    }
  });
  const up = e => {
    if (!ptrs.has(e.pointerId)) return;
    const p = ptrs.get(e.pointerId);
    ptrs.delete(e.pointerId);
    if (!moved && ptrs.size === 0) {
      const now = Date.now();
      if (now - lastTap < 300) { fitView(); draw(); lastTap = 0; return; }
      lastTap = now;
      pickAt(p[0], p[1]);
    }
    start = { view: { ...st.view }, pts: [...ptrs.values()].map(q => [...q]) };
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const [x, y] = pos(e);
    const f = Math.exp(-e.deltaY * 0.0015);
    const k = Math.min(Math.max(st.view.k * f, 0.2), 200), ff = k / st.view.k;
    st.view.ox = x - (x - st.view.ox) * ff; st.view.oy = y - (y - st.view.oy) * ff; st.view.k = k; draw();
  }, { passive: false });
}
function pickAt(px, py) {
  if (!st.sheet || !st.view) return;
  const o = st.sheet.origin;
  const mmx = (px - st.view.ox) / st.view.k, mmy = (st.view.oy - py) / st.view.k;
  const x = (mmx - o.ox) / o.s, y = (mmy - o.oy) / o.s;
  const geo = st.sheet.geo;
  if (x < -2 || x > geo.Lt + 2) return;
  const seg = geo.outer.find(q => x >= q.x0 && x <= q.x1);
  if (!seg || Math.abs(y) > Math.max(seg.info.r0, seg.info.r1) + 4 / o.s) return;
  // внутренняя ступень, если попали в полость
  for (const inn of [geo.inner.L, geo.inner.R]) {
    const u = inn.side === 'L' ? x : geo.Lt - x;
    const q = inn.segs.find(z => u >= z.u0 && u <= z.u1);
    if (q && Math.abs(y) < Math.max(q.info.r0, q.info.r1)) {
      const list = inn.side === 'L' ? 'innerL' : 'innerR';
      st.tab = list; openEditor(list, q.seg.id); return;
    }
  }
  st.tab = 'outer'; openEditor('outer', seg.seg.id);
}

// ---------------- 3D ----------------
let v3dMod = null;
async function set3d(on) {
  st.mode = on ? '3d' : '2d';
  document.querySelectorAll('#mode2d3d button').forEach(b => b.classList.toggle('on', b.dataset.m === st.mode));
  $('#cv').hidden = on; $('#v3d').hidden = !on;
  $('#btnCut3d').hidden = !on; $('#btnView').hidden = on; $('#btnSheet').hidden = on;
  if (on) {
    if (!v3dMod) { toast('Загрузка 3D…', 900); v3dMod = await import('./view3d.js'); }
    if (!st.viewer) st.viewer = new v3dMod.Viewer3D($('#v3d'));
    st.viewer.resize();
    st.dirty3d = true; update3d(); st.viewer.start();
  } else if (st.viewer) { st.viewer.stop(); draw(); }
}
let t3 = null;
function update3d() {
  if (!st.viewer || !st.dirty3d) return;
  clearTimeout(t3);
  t3 = setTimeout(() => {
    try { st.viewer.setModel(computeModel(st.project)); st.dirty3d = false; } catch (e) { console.error(e); toast('3D: ' + e.message); }
  }, 250);
}

// ---------------- Панель ----------------
const CAT = { outer: OUTER, innerL: INNER, innerR: INNER };
function renderPanel() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === st.tab));
  const c = $('#content');
  const scroll = c.scrollTop;
  c.innerHTML = '';
  if (['outer', 'innerL', 'innerR'].includes(st.tab)) {
    if (st.edit && st.edit.list === st.tab) {
      if (st.edit.featId) c.append(featureEditor());
      else c.append(segEditor());
    } else c.append(segList(st.tab));
  } else if (st.tab === 'sections') c.append(sectionsTab());
  else if (st.tab === 'sheet') c.append(sheetTab());
  else if (st.tab === 'file') c.append(fileTab());
  c.scrollTop = scroll;
}
document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => {
  st.tab = b.dataset.t;
  if (st.edit && st.edit.list !== st.tab) { st.edit = null; scheduleBuild(0); }
  $('#content').scrollTop = 0;
  renderPanel();
}));

function segSummary(seg, list) {
  const t = seg.type, f = v => fmt(num(v));
  const L = list === 'outer' ? segLength(seg, 'outer') : segLength(seg, 'inner');
  switch (t) {
    case 'cyl': case 'bore': return `⌀${f(seg.D)}${seg.fit || ''} × ${fmt(L)}`;
    case 'cone': return `⌀${f(seg.D)} → ⌀${f(seg.D2)} × ${fmt(L)}`;
    case 'hex': return `S${f(seg.S)} × ${fmt(L)}`;
    case 'square': return `□${f(seg.S)} × ${fmt(L)}`;
    case 'thread': case 'ithread': return `M${f(seg.D)}×${f(seg.P)}-${seg.tol || ''} × ${fmt(L)}`;
    case 'spline': case 'ispline': return `${seg.z}×${seg.kind === 'эвольвентные' ? 'm' + f(seg.m) : f(seg.d)}×${f(seg.D)} × ${fmt(L)}`;
    case 'spur': case 'coupling': case 'couplingBlind': case 'igear': return `m${f(seg.m)} z${seg.z} b${f(L)}`;
    case 'bevel': return `me${f(seg.m)} z${seg.z} δ${f(seg.delta)}°`;
    case 'wormwheel': return `m${f(seg.m)} z₂=${seg.z}`;
    case 'worm': return `m${f(seg.m)} z₁=${seg.z1} q=${f(seg.q)}`;
    case 'sprocket': return `t${f(seg.t)} z${seg.z}`;
    case 'vpulley': return `${seg.prof} × ${seg.n} канав., dp ${f(seg.dp)}`;
    case 'tpulley': return `m${f(seg.m)} z${seg.z}`;
    case 'fpulley': return `⌀${f(seg.D)} × ${fmt(L)}`;
    case 'blind': return `⌀${f(seg.D)} × ${f(seg.L)}`;
    case 'center': return `${seg.form}${seg.d} ГОСТ 14034`;
    default: return '';
  }
}

function segList(list) {
  const segs = st.project[list];
  const cat = CAT[list];
  const wrap = h('div');
  if (list !== 'outer') wrap.append(h('div', { class: 'hint' }, list === 'innerL'
    ? 'Внутренний контур строится от ЛЕВОГО торца вглубь вала.'
    : 'Внутренний контур строится от ПРАВОГО торца вглубь вала.'));
  else if (!segs.length) wrap.append(h('div', { class: 'hint' }, 'Соберите вал слева направо: добавьте первую ступень.'));
  const L = h('div', { class: 'list' });
  segs.forEach((seg, i) => {
    const d = cat[seg.type];
    const nf = (seg.features || []).length;
    L.append(h('div', { class: 'item', onclick: () => openEditor(list, seg.id) },
      h('span', { class: 'n' }, String(i + 1)),
      h('span', { class: 'ic' }, d?.icon || '?'),
      h('span', { class: 'lbl' }, h('b', {}, d?.label || seg.type), h('small', {}, segSummary(seg, list) + (nf ? ` · элементов: ${nf}` : ''))),
      h('span', { class: 'acts' },
        h('button', { title: 'Выше', onclick: e => { e.stopPropagation(); move(list, i, -1); } }, '▲'),
        h('button', { title: 'Ниже', onclick: e => { e.stopPropagation(); move(list, i, 1); } }, '▼'),
      )));
  });
  wrap.append(L);
  wrap.append(h('button', { class: 'btn add', onclick: () => pickSegment(list) }, '＋ Добавить ' + (list === 'outer' ? 'ступень' : 'элемент отверстия')));
  if (list === 'outer' && segs.length) {
    const Lt = segs.reduce((a, s) => a + segLength(s, 'outer'), 0);
    wrap.append(h('div', { class: 'hint' }, `Общая длина: ${fmt(Math.round(Lt * 100) / 100)} мм. Нажмите на ступень на чертеже, чтобы её изменить.`));
  }
  return wrap;
}
function move(list, i, d) {
  const a = st.project[list], j = i + d;
  if (j < 0 || j >= a.length) return;
  pushHist(true);
  [a[i], a[j]] = [a[j], a[i]];
  changed({ panel: true });
}
function openEditor(list, segId, featId = null) {
  st.tab = list; st.edit = { list, segId, featId };
  renderPanel(); scheduleBuild(0);
  $('#content').scrollTop = 0;
}
function closeEditor() {
  if (st.edit?.featId) st.edit.featId = null; else st.edit = null;
  renderPanel(); scheduleBuild(0);
}

function pickSegment(list) {
  const groups = list === 'outer' ? OUTER_GROUPS : INNER_GROUPS;
  const cat = CAT[list];
  const body = h('div', { class: 'sheet' }, h('h2', {}, list === 'outer' ? 'Добавить ступень' : 'Добавить элемент отверстия'));
  for (const g of groups) {
    body.append(h('h3', {}, g.name));
    const grid = h('div', { class: 'grid' });
    for (const t of g.items) {
      grid.append(h('button', { class: 'tile', onclick: () => { closeModal(); addSegment(list, t); } }, h('span', { class: 'ic' }, cat[t].icon), cat[t].label));
    }
    body.append(grid);
  }
  openModal(body);
}
function addSegment(list, type) {
  pushHist(true);
  const kind = list === 'outer' ? 'outer' : 'inner';
  const seg = newSegment(kind, type);
  const arr = st.project[list];
  // разумные значения по соседям
  const prev = arr[arr.length - 1];
  if (prev && kind === 'outer' && ['cyl', 'thread', 'fpulley'].includes(type) && prev.D) seg.D = num(prev.D);
  if (!prev && kind === 'inner' && type === 'bore') seg.D = Math.round((st.project.outer[0]?.D || 40) * 0.4);
  if (prev && kind === 'inner' && type === 'blind' && prev.type === 'ithread') seg.D = Math.round((num(prev.D) - num(prev.P)) * 10) / 10;
  arr.push(seg);
  openEditor(list, seg.id);
  changed();
}

// ---- Формы ----
function fieldEl(f, obj, onChange, rerender) {
  const set = v => { pushHist(); obj[f.k] = v; onChange(f); };
  const id = 'f_' + f.k + '_' + Math.random().toString(36).slice(2, 7);
  if (f.type === 'bool') {
    const inp = h('input', { type: 'checkbox', id });
    inp.checked = !!obj[f.k];
    inp.addEventListener('change', () => { set(inp.checked); rerender && rerender(); });
    return h('div', { class: 'fld chk wide' }, h('label', { for: id }, f.label), h('label', { class: 'sw' }, inp, h('span')));
  }
  if (f.type === 'sel' || f.type === 'fit' || f.type === 'ra') {
    const opts = f.type === 'fit' ? f.fits : f.type === 'ra' ? RA_LIST : f.opts;
    const sel = h('select', { id });
    for (const o of opts) sel.append(h('option', { value: o }, o === '' ? '—' : o));
    sel.value = obj[f.k] ?? '';
    const box = h('div', { class: 'fld' }, h('label', { for: id }, f.label), sel);
    let dev = null;
    const upd = () => {
      if (f.type !== 'fit') return;
      const d = num(obj.D ?? obj.S);
      const dv = deviations(sel.value, d);
      if (!dev) { dev = h('span', { class: 'dev' }); box.append(dev); }
      dev.textContent = dv ? `${fmtDev(dv.es)} / ${fmtDev(dv.ei)}` : '';
    };
    sel.addEventListener('change', () => { set(sel.value); upd(); rerender && rerender(); });
    upd();
    return box;
  }
  if (f.type === 'material') {
    const inp = h('input', { type: 'text', id, list: 'mats', value: obj[f.k] ?? '' });
    inp.addEventListener('input', () => set(inp.value));
    const dl = h('datalist', { id: 'mats' }, ...MATERIALS.map(m => h('option', { value: m })));
    return h('div', { class: 'fld wide' }, h('label', { for: id }, f.label), inp, dl);
  }
  const numeric = f.type === 'num' || f.type === 'int';
  const inp = h('input', { type: 'text', id, value: obj[f.k] ?? '', inputmode: numeric ? 'decimal' : 'text', autocomplete: 'off' });
  if (numeric) inp.value = obj[f.k] === '' || obj[f.k] === undefined ? '' : String(obj[f.k]).replace('.', ',');
  inp.addEventListener('focus', () => setTimeout(() => inp.select(), 0));
  inp.addEventListener('input', () => {
    if (numeric) {
      const v = parseFloat(inp.value.replace(',', '.'));
      if (!isFinite(v)) return;
      set(f.type === 'int' ? Math.round(v) : v);
    } else set(inp.value);
  });
  return h('div', { class: 'fld' + (f.wide || f.type === 'text' && f.label.length > 22 ? ' wide' : '') }, h('label', { for: id }, f.label), inp);
}
function form(fields, obj, onChange) {
  const box = h('div', { class: 'form' });
  const render = () => {
    box.innerHTML = '';
    for (const f of fields) {
      if (f.show && !f.show(obj)) continue;
      box.append(fieldEl(f, obj, onChange, render));
    }
  };
  render();
  return box;
}

function segEditor() {
  const { list, segId } = st.edit;
  const seg = findSeg(list, segId);
  const cat = CAT[list];
  const d = cat[seg.type];
  const arr = st.project[list];
  const idx = arr.indexOf(seg);
  const wrap = h('div');
  wrap.append(h('div', { class: 'edhead' },
    h('button', { class: 'mini', onclick: closeEditor }, '←'),
    h('span', { class: 't' }, `${idx + 1}. ${d.label}`),
    h('button', { class: 'mini', title: 'Копия', onclick: () => { pushHist(true); const c = JSON.parse(JSON.stringify(seg)); c.id = uid(); c.features.forEach(f => (f.id = uid())); arr.splice(idx + 1, 0, c); openEditor(list, c.id); changed(); } }, '⧉'),
    h('button', { class: 'mini del', title: 'Удалить', onclick: () => { pushHist(true); arr.splice(idx, 1); st.edit = null; changed({ panel: true }); } }, '🗑'),
  ));
  wrap.append(form(d.fields, seg, () => changed()));
  const feats = list === 'outer' ? OUTER_FEATURES : ['igroove', 'ikeyway'];
  if (seg.type !== 'center') {
    wrap.append(h('h3', {}, 'Элементы на ступени'));
    const L = h('div', { class: 'list' });
    (seg.features || []).forEach((f, i) => {
      const fd = FEATURES[f.type];
      L.append(h('div', { class: 'item', onclick: () => openEditor(list, seg.id, f.id) },
        h('span', { class: 'n' }, String(i + 1)), h('span', { class: 'ic' }, fd.icon),
        h('span', { class: 'lbl' }, h('b', {}, fd.label), h('small', {}, featSummary(f))),
        h('span', { class: 'acts' }, h('button', { class: 'del', onclick: e => { e.stopPropagation(); pushHist(true); seg.features.splice(i, 1); changed({ panel: true }); } }, '✕'))));
    });
    wrap.append(L);
    const grid = h('div', { class: 'grid', style: 'margin-top:8px' });
    for (const t of feats) grid.append(h('button', { class: 'tile', onclick: () => { pushHist(true); const f = newFeature(t); defaultsForFeature(f, seg, list); seg.features.push(f); openEditor(list, seg.id, f.id); changed(); } }, h('span', { class: 'ic' }, FEATURES[t].icon), '＋ ' + FEATURES[t].label));
    wrap.append(grid);
  }
  wrap.append(h('div', { class: 'row', style: 'margin-top:12px' },
    h('button', { class: 'btn', onclick: () => { if (idx > 0) { move(list, idx, -1); openEditor(list, seg.id); } } }, '▲ Выше'),
    h('button', { class: 'btn', onclick: () => { if (idx < arr.length - 1) { move(list, idx, 1); openEditor(list, seg.id); } } }, '▼ Ниже'),
    h('button', { class: 'btn blue', onclick: () => pickSegment(list) }, '＋ Следующая'),
  ));
  return wrap;
}
function defaultsForFeature(f, seg, list) {
  const L = segLength(seg, list === 'outer' ? 'outer' : 'inner');
  if (f.type === 'keyway') { f.pos = Math.max(2, Math.round(L * 0.1)); f.len = Math.max(8, Math.round(L * 0.75)); }
  if (f.type === 'crosshole' || f.type === 'ringhole') f.pos = Math.round(L / 2);
  if (f.type === 'groove' && seg.type === 'thread') f.kind = 'выход резьбы';
  if (f.type === 'faceholes') { const D = num(seg.D, 40); f.pcd = Math.round(D * 0.7); f.d = Math.max(3, Math.round(D * 0.12)); }
  if (f.type === 'facegroove') { const D = num(seg.D, 40); f.dIn = Math.round(D * 0.5); f.dOut = Math.round(D * 0.7); }
}
function featSummary(f) {
  const v = x => fmt(num(x));
  switch (f.type) {
    case 'groove': return `${f.kind}, ${f.at}` + (num(f.dg) > 0 ? `, ⌀${v(f.dg)}×${v(f.b)}` : ' (ГОСТ)');
    case 'keyway': return `${f.kind}, ${f.angle}` + (f.auto ? ' (ГОСТ 23360)' : `, ${v(f.b)}×${v(f.t)}`) + (f.kind === 'призматическая' ? `, l=${v(f.len)}` : '');
    case 'crosshole': return `${f.thr || '⌀' + v(f.d)}, ${f.angle}, ${f.through ? 'сквозное' : 'глуб. ' + v(f.depth)}`;
    case 'ringhole': return `${f.n} × ⌀${v(f.d)} в ${v(f.pos)} мм`;
    case 'faceholes': return `${f.n} × ${f.thr || '⌀' + v(f.d)} на ⌀${v(f.pcd)}, ${f.side}`;
    case 'facegroove': return `⌀${v(f.dIn)}/⌀${v(f.dOut)} глуб. ${v(f.depth)}`;
    case 'igroove': return `${f.kind} в ${v(f.pos)} мм`;
    case 'ikeyway': return f.auto ? 'по ГОСТ 23360' : `${v(f.b)}×${v(f.t)}`;
    default: return '';
  }
}
function featureEditor() {
  const { list, segId, featId } = st.edit;
  const seg = findSeg(list, segId);
  const f = seg.features.find(q => q.id === featId);
  const fd = FEATURES[f.type];
  const wrap = h('div');
  wrap.append(h('div', { class: 'edhead' },
    h('button', { class: 'mini', onclick: closeEditor }, '←'),
    h('span', { class: 't' }, fd.label),
    h('button', { class: 'mini', title: 'Копия', onclick: () => { pushHist(true); const c = { ...f, id: uid() }; if (c.pos !== undefined) c.pos = num(c.pos) + 10; seg.features.push(c); openEditor(list, seg.id, c.id); changed(); } }, '⧉'),
    h('button', { class: 'mini del', onclick: () => { pushHist(true); seg.features = seg.features.filter(q => q !== f); st.edit.featId = null; changed({ panel: true }); } }, '🗑')));
  wrap.append(h('div', { class: 'hint' }, `На ступени: ${CAT[list][seg.type].label} (${segSummary(seg, list)})`));
  wrap.append(form(fd.fields, f, () => changed()));
  if (f.type === 'keyway' || f.type === 'crosshole' || f.type === 'ringhole') wrap.append(h('div', { class: 'hint' }, 'Сечение через этот элемент строится автоматически (вкладка «Сечения»). На одной ступени можно добавить несколько пазов и отверстий.'));
  return wrap;
}

// ---- Сечения ----
function sectionsTab() {
  const p = st.project;
  const wrap = h('div');
  wrap.append(form([{ k: 'autoSections', label: 'Сечения по пазам, шлицам, граням и отверстиям — автоматически', type: 'bool' }], p.meta, () => changed({ panel: true })));
  if (p.meta.autoSections === undefined) p.meta.autoSections = true;
  const geo = computeModel(p);
  const secs = sectionList(p, geo);
  wrap.append(h('h3', {}, 'Сечения на чертеже'));
  const L = h('div', { class: 'list' });
  const letters = 'АБВГДЕЖИКЛМНПРСТУФЦШЭЮЯ';
  secs.forEach((s, i) => {
    L.append(h('div', { class: 'item' }, h('span', { class: 'n' }, letters[i % letters.length]),
      h('span', { class: 'lbl' }, h('b', {}, `${letters[i % letters.length]}–${letters[i % letters.length]}`), h('small', {}, `x = ${fmt(Math.round(s.x * 10) / 10)} мм от левого торца` + (s.auto ? ' · авто' : '')))));
  });
  if (!secs.length) L.append(h('div', { class: 'hint' }, 'Сечений нет.'));
  wrap.append(L);
  wrap.append(h('h3', {}, 'Свои сечения'));
  const M = h('div', { class: 'list' });
  (p.sections || []).forEach((s, i) => {
    M.append(h('div', { class: 'item' }, form([{ k: 'x', label: 'Положение от левого торца, мм', type: 'num' }], s, () => changed()),
      h('button', { class: 'mini del', onclick: () => { pushHist(true); p.sections.splice(i, 1); changed({ panel: true }); } }, '✕')));
  });
  wrap.append(M);
  wrap.append(h('button', { class: 'btn add', onclick: () => { pushHist(true); (p.sections ||= []).push({ id: uid(), x: Math.round(geo.Lt / 2) }); changed({ panel: true }); } }, '＋ Добавить сечение'));
  return wrap;
}

// ---- Чертёж (оформление) ----
const META_FIELDS = [
  { k: 'designation', label: 'Обозначение', type: 'text', wide: true },
  { k: 'name', label: 'Наименование', type: 'text', wide: true },
  { k: 'material', label: 'Материал', type: 'material' },
  { k: 'view', label: 'Изображение', type: 'sel', opts: ['вид', 'полуразрез', 'разрез'] },
  { k: 'sheetMode', label: 'Показывать', type: 'sel', opts: ['лист', 'деталь'] },
  { k: 'format', label: 'Формат', type: 'sel', opts: ['авто', 'A4', 'A3', 'A2', 'A1'] },
  { k: 'scale', label: 'Масштаб', type: 'sel', opts: ['авто', '5:1', '4:1', '2,5:1', '2:1', '1:1', '1:2', '1:2,5', '1:4', '1:5', '1:10', '1:20'] },
  { k: 'dims', label: 'Размеры длин', type: 'sel', opts: ['цепь', 'от базы'] },
  { k: 'closing', label: 'Без размера (цепь)', type: 'sel', opts: ['последняя', 'первая', 'нет'] },
  { k: 'raGeneral', label: 'Шероховатость остальных', type: 'ra' },
  { k: 'mass', label: 'Масса, кг (пусто = авто)', type: 'text' },
  { k: 'litera', label: 'Литера', type: 'text' },
  { k: 'org', label: 'Организация', type: 'text' },
  { k: 'developer', label: 'Разработал', type: 'text' },
  { k: 'checker', label: 'Проверил', type: 'text' },
  { k: 'tcontrol', label: 'Т.контр.', type: 'text' },
  { k: 'ncontrol', label: 'Н.контр.', type: 'text' },
  { k: 'approved', label: 'Утвердил', type: 'text' },
];
function sheetTab() {
  const m = st.project.meta;
  const wrap = h('div');
  wrap.append(form(META_FIELDS, m, () => changed()));
  wrap.append(h('h3', {}, 'Технические требования'));
  const L = h('div', { class: 'list' });
  (m.tt || []).forEach((t, i) => {
    const ta = h('textarea', { rows: 2 }); ta.value = t;
    ta.addEventListener('input', () => { pushHist(); m.tt[i] = ta.value; changed(); });
    L.append(h('div', { class: 'item' }, h('span', { class: 'n' }, String(i + 1)), h('div', { class: 'fld', style: 'flex:1' }, ta),
      h('span', { class: 'acts', style: 'flex-direction:column' },
        h('button', { onclick: () => { if (i > 0) { pushHist(true); [m.tt[i - 1], m.tt[i]] = [m.tt[i], m.tt[i - 1]]; changed({ panel: true }); } } }, '▲'),
        h('button', { class: 'del', onclick: () => { pushHist(true); m.tt.splice(i, 1); changed({ panel: true }); } }, '✕'))));
  });
  wrap.append(L);
  wrap.append(h('button', { class: 'btn add', onclick: () => { pushHist(true); (m.tt ||= []).push(''); changed({ panel: true }); } }, '＋ Пункт'));
  wrap.append(h('div', { class: 'hint' }, 'Быстро добавить:'));
  wrap.append(h('div', { class: 'chips' }, ...TT_TEMPLATES.map(t => h('button', { class: 'chip', onclick: () => { pushHist(true); (m.tt ||= []).push(t); changed({ panel: true }); } }, t.length > 42 ? t.slice(0, 40) + '…' : t))));
  return wrap;
}

// ---- Файл ----
function fileTab() {
  const wrap = h('div');
  wrap.append(h('h3', {}, 'Отправить (Telegram, почта…)'));
  wrap.append(h('div', { class: 'exp' }, ...['JPG', 'PDF', 'DXF', 'PNG'].map(f => h('button', { class: 'btn blue', onclick: () => exportAs(f, 'share') }, f))));
  wrap.append(h('h3', {}, 'Сохранить на телефон'));
  wrap.append(h('div', { class: 'exp' }, ...['JPG', 'PDF', 'DXF', 'PNG'].map(f => h('button', { class: 'btn', onclick: () => exportAs(f, 'save') }, f))));
  wrap.append(h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { class: 'btn', onclick: () => export3d() }, '3D-снимок PNG')));
  wrap.append(h('div', { class: 'hint' }, 'Файлы сохраняются в папку «Документы/ВалCAD». DXF — в натуральную величину (1:1), открывается в КОМПАС, AutoCAD, nanoCAD.'));
  wrap.append(h('h3', {}, 'Проект'));
  wrap.append(h('div', { class: 'row' },
    h('button', { class: 'btn primary', onclick: newVal }, '＋ Новый вал'),
    h('button', { class: 'btn', onclick: duplicate }, '⧉ Копия')));
  wrap.append(h('div', { class: 'row', style: 'margin-top:8px' },
    h('button', { class: 'btn', onclick: () => exportAs('VAL', 'share') }, 'Отправить проект'),
    h('button', { class: 'btn', onclick: importVal }, 'Открыть файл…')));
  wrap.append(h('h3', {}, 'Мои валы'));
  const L = h('div');
  wrap.append(L);
  P.listProjects().then(list => {
    if (!list.length) L.append(h('div', { class: 'hint' }, 'Пока пусто.'));
    for (const it of list) {
      L.append(h('div', { class: 'proj' },
        h('div', { class: 'lbl' }, it.title, h('small', {}, new Date(it.mtime).toLocaleString('ru-RU') + (it.id === st.id ? ' · открыт' : ''))),
        h('button', { class: 'mini', onclick: () => openProject(it.id) }, '📂'),
        it.id !== st.id ? h('button', { class: 'mini del', onclick: async () => { if (confirm('Удалить проект?')) { await P.deleteProject(it.id); renderPanel(); } } }, '🗑') : null));
    }
  });
  wrap.append(h('div', { class: 'hint', style: 'margin-top:18px' }, 'ВалCAD 1.0 · чертежи валов по ЕСКД'));
  return wrap;
}

async function exportAs(kind, how) {
  if (!st.sheet) build();
  const m = st.project.meta;
  const base = P.safeName(`${m.designation || 'val'}_${m.name || ''}`);
  try {
    toast('Готовлю файл…', 1200);
    let b64, mime, name;
    const sheet = buildSheet(st.project, {});
    if (kind === 'JPG') { b64 = P.b64FromDataURL(sheetToImage(sheet, 200, 'image/jpeg')); mime = 'image/jpeg'; name = base + '.jpg'; }
    else if (kind === 'PNG') { b64 = P.b64FromDataURL(sheetToImage(sheet, 200, 'image/png')); mime = 'image/png'; name = base + '.png'; }
    else if (kind === 'PDF') { b64 = P.b64FromBytes(new Uint8Array(await toPDF(sheet))); mime = 'application/pdf'; name = base + '.pdf'; }
    else if (kind === 'DXF') { b64 = P.b64FromBytes(toDXF(sheet)); mime = 'application/dxf'; name = base + '.dxf'; }
    else if (kind === 'VAL') { b64 = P.b64FromBytes(new TextEncoder().encode(JSON.stringify(st.project))); mime = 'application/json'; name = base + '.val'; }
    if (how === 'share') await P.shareFile(name, b64, mime, `${m.name} ${m.designation}`);
    else { const r = await P.saveFile(name, b64, mime); toast('Сохранено: ' + r.where, 3500); }
  } catch (e) {
    if (String(e?.message || e).match(/cancel/i)) return;
    console.error(e); toast('Не удалось: ' + (e.message || e), 4000);
  }
}
async function export3d() {
  if (st.mode !== '3d') { await set3d(true); await new Promise(r => setTimeout(r, 900)); }
  const url = st.viewer.snapshot();
  const m = st.project.meta;
  const name = P.safeName(`${m.designation}_${m.name}_3D`) + '.png';
  try { await P.shareFile(name, P.b64FromDataURL(url), 'image/png', m.name); } catch (e) { if (!String(e.message).match(/cancel/i)) toast('Не удалось: ' + e.message); }
}
function importVal() {
  const inp = h('input', { type: 'file', accept: '.val,.json,application/json,*/*' });
  inp.addEventListener('change', async () => {
    const f = inp.files[0]; if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      if (!p.outer || !p.meta) throw new Error('это не файл проекта');
      normalize(p);
      st.id = uid(); st.project = p; st.hist = []; st.fut = []; st.edit = null;
      await P.saveProject(st.id, p);
      st.tab = 'outer'; changed({ panel: true }); toast('Проект открыт');
    } catch (e) { toast('Ошибка: ' + e.message, 3500); }
  });
  inp.click();
}
async function newVal() {
  await P.saveProject(st.id, st.project);
  st.id = uid(); st.project = newProject(); st.hist = []; st.fut = []; st.edit = null; st.tab = 'outer';
  st.view = null; changed({ panel: true }); toast('Новый вал');
}
async function duplicate() {
  await P.saveProject(st.id, st.project);
  st.id = uid(); st.project = JSON.parse(JSON.stringify(st.project)); st.project.meta.name += ' (копия)';
  changed({ panel: true }); toast('Создана копия');
}
async function openProject(id) {
  await P.saveProject(st.id, st.project);
  const p = await P.loadProject(id);
  if (!p) return toast('Не найден');
  normalize(p);
  st.id = id; st.project = p; st.hist = []; st.fut = []; st.edit = null; st.tab = 'outer'; st.view = null;
  changed({ panel: true });
}
function normalize(p) {
  p.meta ||= {}; p.outer ||= []; p.innerL ||= []; p.innerR ||= []; p.sections ||= [];
  const d = newProject().meta;
  for (const k of Object.keys(d)) if (p.meta[k] === undefined) p.meta[k] = d[k];
  if (p.meta.autoSections === undefined) p.meta.autoSections = true;
  for (const l of ['outer', 'innerL', 'innerR']) for (const s of p[l]) s.features ||= [];
}

// ---- Модальное окно ----
function openModal(el) {
  const m = $('#modal'); m.innerHTML = ''; m.append(el); m.hidden = false;
  m.onclick = e => { if (e.target === m) closeModal(); };
}
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }

// ---- Кнопки ----
$('#btnUndo').onclick = undo;
$('#btnRedo').onclick = redo;
$('#btnFit').onclick = () => { if (st.mode === '3d') st.viewer?.fit(); else { fitView(); draw(); } };
$('#btnView').onclick = () => {
  const order = ['вид', 'полуразрез', 'разрез'];
  const m = st.project.meta; pushHist(true);
  m.view = order[(order.indexOf(m.view) + 1) % order.length]; changed({ panel: st.tab === 'sheet' });
};
$('#btnSheet').onclick = () => {
  const m = st.project.meta; pushHist(true);
  m.sheetMode = m.sheetMode === 'деталь' ? 'лист' : 'деталь'; st.view = null; changed({ panel: st.tab === 'sheet' });
};
$('#btnCut3d').onclick = () => { st.cut3d = !st.cut3d; $('#btnCut3d').classList.toggle('on', st.cut3d); st.viewer?.setCut(st.cut3d); };
$('#btnBig').onclick = () => { $('#viewport').classList.toggle('big'); setTimeout(() => { if (st.mode === '3d') st.viewer?.resize(); else { fitView(); draw(); } }, 230); };
document.querySelectorAll('#mode2d3d button').forEach(b => b.addEventListener('click', () => set3d(b.dataset.m === '3d')));
$('#btnShare').onclick = () => {
  const body = h('div', { class: 'sheet' }, h('h2', {}, 'Отправить чертёж'),
    h('div', { class: 'hint' }, 'Выберите формат, затем Telegram в списке приложений.'),
    h('div', { class: 'exp' }, ...['JPG', 'PDF', 'DXF', 'PNG'].map(f => h('button', { class: 'btn blue', onclick: () => { closeModal(); exportAs(f, 'share'); } }, f))),
    h('h3', {}, 'Сохранить на телефон'),
    h('div', { class: 'exp' }, ...['JPG', 'PDF', 'DXF', 'PNG'].map(f => h('button', { class: 'btn', onclick: () => { closeModal(); exportAs(f, 'save'); } }, f))));
  openModal(body);
};
$('#warn').onclick = () => {
  const w = st.sheet?.warnings || [];
  openModal(h('div', { class: 'sheet' }, h('h2', {}, 'Предупреждения'), h('ul', { class: 'warnlist' }, ...w.map(x => h('li', {}, x)))));
};
CapApp.addListener('backButton', () => {
  if (!$('#modal').hidden) return closeModal();
  if ($('#viewport').classList.contains('big')) return $('#btnBig').click();
  if (st.edit) return closeEditor();
  if (st.tab !== 'outer') { st.tab = 'outer'; return renderPanel(); }
  CapApp.minimizeApp();
}).catch(() => {});
CapApp.addListener('pause', () => P.saveProject(st.id, st.project)).catch(() => {});

// ---------------- Старт ----------------
(async function init() {
  const last = P.lastProjectId();
  let p = null;
  if (last) try { p = await P.loadProject(last); } catch (e) { p = null; }
  if (p) { normalize(p); st.id = last; st.project = p; }
  else { st.id = uid(); st.project = newProject(); normalize(st.project); }
  updateTitle();
  renderPanel();
  try { await document.fonts.load('italic 20px GOSTF'); } catch (e) { /* */ }
  build();
})();
