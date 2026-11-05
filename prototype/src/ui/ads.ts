// Реклама Яндекса: за награду (по желанию игрока) и между партиями.
// В Android — нативный модуль YandexAds; в браузере — заглушка, чтобы проверить сценарий.

/** Номера рекламных блоков из кабинета Рекламной сети Яндекса — запасные, если сайт недоступен. */
export const AD_UNITS: { rewarded: string | null; interstitial: string | null } = {
  rewarded: "R-M-20240214-1", // «Бонус 100» — реклама с вознаграждением
  interstitial: null, // межстраничной пока нет — включится с сайта, без обновления игры
};

/** Номера блоков можно поменять на сайте, не выпуская новую версию игры. */
const REMOTE_CONFIG = "https://pitbut.github.io/oligarh-ads.json";
const CACHE_KEY = "oligarh-ads";
const isUnit = (v: unknown): v is string | null => v === null || (typeof v === "string" && /^(R-M-\d+-\d+|demo-[a-z-]+)$/.test(v));

async function loadUnits() {
  try { // сначала то, что сохранили в прошлый раз
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as Partial<typeof AD_UNITS> | null;
    if (c && isUnit(c.rewarded) && isUnit(c.interstitial)) Object.assign(AD_UNITS, c);
  } catch { /* нет кэша */ }
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(REMOTE_CONFIG, { cache: "no-store", signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return;
    const c = (await r.json()) as Partial<typeof AD_UNITS>;
    if (isUnit(c.rewarded) && isUnit(c.interstitial)) {
      AD_UNITS.rewarded = c.rewarded; AD_UNITS.interstitial = c.interstitial;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(AD_UNITS)); } catch { /* приватный режим */ }
    }
  } catch { /* нет интернета — играем с тем, что есть */ }
}

interface NativeAds {
  init(o: { rewardedId?: string; interstitialId?: string }): Promise<void>;
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
  const n = native();
  if (!n) return;
  void loadUnits().then(() => n.init({ rewardedId: AD_UNITS.rewarded ?? undefined, interstitialId: AD_UNITS.interstitial ?? undefined })).catch(() => {});
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
  if (native() && !AD_UNITS.interstitial) return; // блок не подключён
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
