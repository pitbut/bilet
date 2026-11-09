// Реклама Яндекса («Простая монетизация»). Работает только в Android-приложении.
import { Capacitor, registerPlugin } from '@capacitor/core';

const Ads = registerPlugin('YandexAds');

// ID рекламных блоков из кабинета partner.yandex.ru → «Приложения и блоки» (вид R-M-XXXXXXX-N)
export const AD_UNITS = {
  banner: '',
  interstitial: '',
};

const START_DELAY = 3 * 60 * 1000;   // первые 3 минуты после запуска — без межстраничной рекламы
const INTERVAL = 4 * 60 * 1000;      // не чаще одного раза в 4 минуты
const startedAt = Date.now();
let lastShown = 0;
let ready = false;

export async function initAds() {
  if (!Capacitor.isNativePlatform() || (!AD_UNITS.banner && !AD_UNITS.interstitial)) return;
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
