// Реклама Яндекса: за награду (по желанию игрока) и между партиями.
// В Android — нативный модуль YandexAds; в браузере — заглушка, чтобы проверить сценарий.

/** Номера рекламных блоков из кабинета Рекламной сети Яндекса. Пока — тестовые блоки Яндекса. */
export const AD_UNITS = {
  rewarded: "demo-rewarded-yandex",
  interstitial: "demo-interstitial-yandex",
};

interface NativeAds {
  init(o: { rewardedId: string; interstitialId: string }): Promise<void>;
  isReady(): Promise<{ rewarded: boolean; interstitial: boolean }>;
  showRewarded(): Promise<{ rewarded: boolean }>;
  showInterstitial(): Promise<void>;
}

function native(): NativeAds | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown>; isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return (cap.Plugins?.YandexAds as NativeAds | undefined) ?? null;
}

let started = false;
export function initAds() {
  if (started) return;
  started = true;
  void native()?.init({ rewardedId: AD_UNITS.rewarded, interstitialId: AD_UNITS.interstitial }).catch(() => {});
}

/** Показать рекламу за награду. true — досмотрели до конца, награду можно выдать. */
export async function showRewarded(): Promise<boolean> {
  const n = native();
  if (n) {
    try { return (await n.showRewarded()).rewarded; } catch { return false; }
  }
  return browserStub("Реклама за награду", 5);
}

let lastInterstitial = 0;
/** Межстраничная реклама — не чаще раза в 3 минуты. */
export async function showInterstitial(): Promise<void> {
  if (Date.now() - lastInterstitial < 180000) return;
  lastInterstitial = Date.now();
  const n = native();
  if (n) { try { await n.showInterstitial(); } catch { /* не загрузилась — не страшно */ } return; }
  await browserStub("Реклама", 3);
}

/** Заглушка для браузера: экран «рекламы» с отсчётом. */
function browserStub(title: string, sec: number): Promise<boolean> {
  return new Promise((res) => {
    const ov = document.createElement("div");
    ov.className = "adstub";
    const box = document.createElement("div");
    const t = document.createElement("b");
    t.textContent = title;
    const note = document.createElement("div");
    note.className = "muted";
    note.textContent = "Здесь будет реклама Яндекса (в приложении для Android)";
    const cnt = document.createElement("div");
    cnt.className = "adcount";
    const close = document.createElement("button");
    close.textContent = "Закрыть";
    close.style.visibility = "hidden";
    box.append(t, note, cnt, close);
    ov.append(box);
    document.body.append(ov);
    let left = sec;
    const tick = () => {
      cnt.textContent = left > 0 ? `${left}` : "✓";
      if (left <= 0) { close.style.visibility = "visible"; clearInterval(timer); }
      left--;
    };
    const timer = setInterval(tick, 1000);
    tick();
    close.onclick = () => { ov.remove(); res(true); };
    const skip = document.createElement("button");
    skip.className = "ghost";
    skip.textContent = "Пропустить";
    skip.onclick = () => { clearInterval(timer); ov.remove(); res(false); };
    box.append(skip);
  });
}
