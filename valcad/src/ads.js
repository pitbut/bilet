// Реклама Яндекса («Простая монетизация»). Работает только в Android-приложении.
import { Capacitor, registerPlugin } from '@capacitor/core';

const Ads = registerPlugin('YandexAds');

// Номера рекламных блоков берутся с сайта, чтобы включать и менять их без новой версии в магазине.
// Порядок: сайт → последний сохранённый ответ сайта → запасные значения ниже (null — реклама выключена).
const CONFIG_URL = 'https://pitbut.github.io/valcad-ads.json';
const CACHE_KEY = 'valcad.ads.v1';
const FALLBACK = { banner: null, interstitial: null };
export const AD_UNITS = { ...FALLBACK };

async function loadConfig() {
  const valid = o => o && typeof o === 'object' && ('banner' in o || 'interstitial' in o);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(CONFIG_URL + '?t=' + Math.floor(Date.now() / 3600000), { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (r.ok) {
      const j = await r.json();
      if (valid(j)) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(j)); } catch (e) { /* */ }
        return j;
      }
    }
  } catch (e) { /* нет сети — берём сохранённое */ }
  try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); if (valid(c)) return c; } catch (e) { /* */ }
  return FALLBACK;
}

const START_DELAY = 3 * 60 * 1000;   // первые 3 минуты после запуска — без межстраничной рекламы
const INTERVAL = 4 * 60 * 1000;      // не чаще одного раза в 4 минуты
const startedAt = Date.now();
let lastShown = 0;
let ready = false;

export async function initAds() {
  if (!Capacitor.isNativePlatform()) return;
  const cfg = await loadConfig();
  AD_UNITS.banner = typeof cfg.banner === 'string' && cfg.banner ? cfg.banner : null;
  AD_UNITS.interstitial = typeof cfg.interstitial === 'string' && cfg.interstitial ? cfg.interstitial : null;
  if (!AD_UNITS.banner && !AD_UNITS.interstitial) return; // блоков нет — SDK не запускаем
  try {
    await Ads.addListener('bannerHeight', ({ height }) => {
      document.documentElement.style.setProperty('--ad', (height || 0) + 'px');
      window.dispatchEvent(new Event('resize'));
    });
    await Ads.init();
    ready = true;
    if (AD_UNITS.banner) await Ads.showBanner({ adUnitId: AD_UNITS.banner });
    if (AD_UNITS.interstitial) await Ads.loadInterstitial({ adUnitId: AD_UNITS.interstitial });
  } catch (e) {
    console.warn('ads', e);
  }
}

// Вызывается после экспорта/отправки чертежа
export async function maybeInterstitial() {
  if (!ready || !AD_UNITS.interstitial) return;
  const now = Date.now();
  if (now - startedAt < START_DELAY || now - lastShown < INTERVAL) return;
  try {
    const r = await Ads.showInterstitial();
    if (r && r.shown) lastShown = now;
  } catch (e) { /* нет загруженной рекламы — пропускаем */ }
}
