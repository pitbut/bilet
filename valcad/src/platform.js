// Хранение проектов и файлов, «Поделиться». Android (Capacitor) или браузер.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export const native = Capacitor.isNativePlatform();
const DIR = 'ВалCAD';

export function b64FromBytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function b64FromDataURL(url) { return url.slice(url.indexOf(',') + 1); }
export function safeName(s) { return String(s || 'val').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'val'; }

// ---- Проекты ----
const LS_KEY = 'valcad.projects.v1';
function lsIndex() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } }

export async function listProjects() {
  if (native) {
    try {
      await Filesystem.mkdir({ path: 'projects', directory: Directory.Data, recursive: true }).catch(() => {});
      const r = await Filesystem.readdir({ path: 'projects', directory: Directory.Data });
      const out = [];
      for (const f of r.files) {
        const name = typeof f === 'string' ? f : f.name;
        if (!name.endsWith('.json')) continue;
        try {
          const d = await Filesystem.readFile({ path: 'projects/' + name, directory: Directory.Data, encoding: Encoding.UTF8 });
          const p = JSON.parse(d.data);
          out.push({ id: name.replace(/\.json$/, ''), title: p.meta?.designation + ' ' + (p.meta?.name || ''), mtime: p.mtime || 0 });
        } catch (e) { /* skip */ }
      }
      return out.sort((a, b) => b.mtime - a.mtime);
    } catch (e) { return []; }
  }
  const idx = lsIndex();
  return Object.entries(idx).map(([id, p]) => ({ id, title: p.meta?.designation + ' ' + (p.meta?.name || ''), mtime: p.mtime || 0 })).sort((a, b) => b.mtime - a.mtime);
}
export async function saveProject(id, project) {
  project.mtime = Date.now();
  if (native) {
    await Filesystem.writeFile({ path: `projects/${id}.json`, directory: Directory.Data, data: JSON.stringify(project), encoding: Encoding.UTF8, recursive: true });
  } else {
    const idx = lsIndex(); idx[id] = project;
    try { localStorage.setItem(LS_KEY, JSON.stringify(idx)); } catch (e) { /* quota */ }
  }
  try { localStorage.setItem('valcad.last', id); } catch (e) { /* */ }
}
export async function loadProject(id) {
  if (native) {
    const d = await Filesystem.readFile({ path: `projects/${id}.json`, directory: Directory.Data, encoding: Encoding.UTF8 });
    return JSON.parse(d.data);
  }
  return lsIndex()[id] || null;
}
export async function deleteProject(id) {
  if (native) await Filesystem.deleteFile({ path: `projects/${id}.json`, directory: Directory.Data }).catch(() => {});
  else { const idx = lsIndex(); delete idx[id]; localStorage.setItem(LS_KEY, JSON.stringify(idx)); }
}
export function lastProjectId() { try { return localStorage.getItem('valcad.last'); } catch (e) { return null; } }

// ---- Файлы ----
// Сохранить на телефон (Документы/ВалCAD). Возвращает текст с путём.
export async function saveFile(name, b64, mime) {
  if (native) {
    try {
      const r = await Filesystem.writeFile({ path: `${DIR}/${name}`, data: b64, directory: Directory.Documents, recursive: true });
      return { ok: true, where: `Документы/${DIR}/${name}`, uri: r.uri };
    } catch (e) {
      // запасной вариант — внешняя папка приложения
      const r = await Filesystem.writeFile({ path: `${DIR}/${name}`, data: b64, directory: Directory.External, recursive: true });
      return { ok: true, where: `Android/data/…/files/${DIR}/${name}`, uri: r.uri };
    }
  }
  const a = document.createElement('a');
  a.href = `data:${mime};base64,${b64}`; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  return { ok: true, where: 'Загрузки' };
}

export async function shareFile(name, b64, mime, title) {
  if (native) {
    const r = await Filesystem.writeFile({ path: `share/${name}`, data: b64, directory: Directory.Cache, recursive: true });
    await Share.share({ title: title || name, text: title || name, files: [r.uri], dialogTitle: 'Отправить чертёж' });
    return true;
  }
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], name, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: title || name });
    return true;
  }
  await saveFile(name, b64, mime);
  return false;
}
