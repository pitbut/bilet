import { newProject, newSegment, newFeature } from '../src/catalog.js';
const S = (kind, type, o = {}) => Object.assign(newSegment(kind, type), o);
const F = (type, o = {}) => Object.assign(newFeature(type), o);
export function samples() {
  const a = newProject();
  a.meta.view = 'вид';
  a.outer = [
    S('outer', 'thread', { D: 24, P: 1.5, L: 25, chL: 1.5, features: [F('groove', { kind: 'выход резьбы', at: 'справа' })] }),
    S('outer', 'cyl', { D: 30, L: 40, fit: 'k6', ra: '1,6', features: [F('keyway', { pos: 4, len: 28 })] }),
    S('outer', 'cyl', { D: 40, L: 12, chR: 0 }),
    S('outer', 'spur', { m: 2.5, z: 22, L: 30, chL: 1, chR: 1 }),
    S('outer', 'cyl', { D: 35, L: 22, fit: 'k6', chR: 1, ra: '0,8', features: [F('groove', { kind: 'стопорное кольцо', at: 'по координате', pos: 17 })] }),
    S('outer', 'hex', { S: 27, L: 16, chR: 1 }),
  ];
  a.innerL = [S('inner', 'center', { form: 'B', d: '3,15' })];
  a.innerR = [S('inner', 'ithread', { D: 10, P: 1.5, L: 16 }), S('inner', 'blind', { D: 8.5, L: 20 })];
  const b = JSON.parse(JSON.stringify(a)); b.meta.view = 'разрез';
  const c = JSON.parse(JSON.stringify(a)); c.meta.view = 'полуразрез';
  const d = newProject();
  d.meta.view = 'разрез';
  d.meta.name = 'Вал-шестерня';
  d.outer = [
    S('outer', 'cyl', { D: 50, L: 30, chL: 2, features: [F('faceholes', { n: 6, d: 6.8, pcd: 36, depth: 18, thr: 'M8', side: 'левый' })] }),
    S('outer', 'vpulley', { prof: 'A', n: 3, dp: 125 }),
    S('outer', 'cyl', { D: 45, L: 40, fit: 'js6', features: [F('crosshole', { d: 8, pos: 20, angle: 'вертикально' })] }),
    S('outer', 'spline', { L: 50, chR: 1.5, features: [] }),
    S('outer', 'cone', { D: 36, D2: 30, L: 30 }),
    S('outer', 'square', { S: 22, L: 20 }),
  ];
  d.innerL = [S('inner', 'bore', { D: 20, L: 40, fit: 'H7', ch: 1, features: [F('ikeyway', {}), F('igroove', { pos: 30 })] })];
  const e = newProject();
  e.meta.view = 'полуразрез'; e.meta.name = 'Червяк';
  e.outer = [
    S('outer', 'cyl', { D: 35, L: 30, chL: 1, fit: 'k6' }),
    S('outer', 'cyl', { D: 42, L: 20, fL: 1 }),
    S('outer', 'worm', { m: 4, z1: 2, q: 10, L: 70, chL: 2, chR: 2 }),
    S('outer', 'cyl', { D: 42, L: 20 }),
    S('outer', 'bevel', { m: 3, z: 18, delta: 30, L: 18 }),
    S('outer', 'cyl', { D: 30, L: 40, fit: 'k6', chR: 1, features: [F('keyway', { angle: 'сверху', pos: 6, len: 25 }), F('ringhole', { n: 4, d: 5, pos: 34 })] }),
  ];
  e.innerR = [S('inner', 'igear', { m: 1, z: 20, L: 14 })];
  return { a, b, c, d, e };
}
