// Звонки от банка и биржи: входящий вызов → видеозвонок, сотрудник озвучивает сообщение.
import { Caller } from "../engine/engine";
import { sfx } from "./sound";

export const CALLERS: Record<Caller, { name: string; org: string; suit: string; hair: string; bg: [string, string]; woman: boolean }> = {
  bank: { name: "Ирина Соколова", org: "Банк «Олигарх» · менеджер по кредитам", suit: "#1f3a5f", hair: "#3b2416", bg: ["#d9c9a3", "#a8916a"], woman: true },
  exchange: { name: "Аркадий Биржевой", org: "Московская биржа · брокер", suit: "#2b2f36", hair: "#6b6f75", bg: ["#0f2a1f", "#0a1912"], woman: false },
  lawyer: { name: "Олег Законов", org: "Юридическая служба · юрист компании", suit: "#3a3a3a", hair: "#1e1e1e", bg: ["#e8e2d4", "#b9ad94"], woman: false },
  union: { name: "Николай Рабочев", org: "Профсоюз предприятия · председатель", suit: "#5a4632", hair: "#8a8a8a", bg: ["#7d8a96", "#4b5660"], woman: false },
  emergency: { name: "Светлана Спасова", org: "Диспетчерская ЧС · дежурная", suit: "#e0662a", hair: "#c79a5b", bg: ["#2c3e50", "#1a252f"], woman: true },
};

// ---------- Голос: нативный синтез в Android, Web Speech в браузере ----------

interface NativeTts { speak(o: { text: string; lang: string; rate: number; pitch: number }): Promise<void>; stop(): Promise<void> }
function nativeTts(): NativeTts | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown>; isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return (cap.Plugins?.TextToSpeech as NativeTts | undefined) ?? null;
}

let speaking: { stop: () => void } | null = null;

/** Озвучить текст; промис завершается, когда речь закончилась или её прервали. */
export function speak(text: string, woman: boolean): Promise<void> {
  stopSpeech();
  const native = nativeTts();
  if (native) {
    let stopped = false;
    speaking = { stop: () => { stopped = true; void native.stop(); } };
    return native.speak({ text, lang: "ru-RU", rate: 1.05, pitch: woman ? 1.15 : 0.9 }).catch(() => (stopped ? undefined : fallbackWait(text)));
  }
  const synth = window.speechSynthesis;
  if (synth && typeof SpeechSynthesisUtterance !== "undefined") {
    return new Promise((res) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ru-RU";
      u.rate = 1.05;
      u.pitch = woman ? 1.15 : 0.85;
      const ru = synth.getVoices().filter((v) => v.lang.startsWith("ru"));
      if (ru.length) u.voice = ru.find((v) => /female|жен|irina|milena|anna/i.test(v.name) === woman) ?? ru[0];
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(guard); res(); } };
      u.onend = finish; u.onerror = finish;
      const guard = setTimeout(finish, 2000 + text.length * 90); // если голоса нет — не зависаем
      speaking = { stop: () => { synth.cancel(); finish(); } };
      synth.speak(u);
    });
  }
  return fallbackWait(text);
}

/** Без синтеза речи — просто время на чтение субтитров. */
function fallbackWait(text: string): Promise<void> {
  return new Promise((res) => {
    const t = setTimeout(res, 1500 + text.length * 55);
    speaking = { stop: () => { clearTimeout(t); res(); } };
  });
}

export function stopSpeech() { speaking?.stop(); speaking = null; }

// ---------- Сотрудник на видео (рисуем сами) ----------

function drawPerson(c: CanvasRenderingContext2D, w: number, h: number, who: Caller, t: number, mouth: number, blink: boolean) {
  const p = CALLERS[who];
  // фон: банк — колонны и сейф, биржа — графики котировок
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, p.bg[0]); g.addColorStop(1, p.bg[1]);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  if (who === "bank") {
    c.fillStyle = "rgba(255,255,255,.35)";
    for (let k = 0; k < 4; k++) c.fillRect(w * (0.08 + k * 0.26), h * 0.08, w * 0.07, h * 0.7);
    c.fillStyle = "#8b6b2e"; c.font = `700 ${Math.round(h * 0.06)}px Georgia, serif`; c.textAlign = "center";
    c.fillText("БАНК «ОЛИГАРХ»", w / 2, h * 0.17);
  } else if (who === "lawyer") { // книжные полки
    for (let r = 0; r < 4; r++) {
      c.fillStyle = "#7a5531"; c.fillRect(0, h * (0.12 + r * 0.2), w, h * 0.015);
      for (let k = 0; k < 30; k++) { c.fillStyle = ["#8b1e1e", "#1f3a5f", "#2e7d32", "#6b4f1d"][(k + r) % 4]; c.fillRect(w * (k / 30), h * (0.135 + r * 0.2), w / 34, h * 0.13); }
    }
  } else if (who === "union") { // цех и плакат
    c.fillStyle = "rgba(0,0,0,.25)";
    for (let k = 0; k < 5; k++) c.fillRect(w * (0.05 + k * 0.2), h * 0.25, w * 0.12, h * 0.6);
    c.fillStyle = "#c0392b"; c.fillRect(w * 0.08, h * 0.08, w * 0.84, h * 0.12);
    c.fillStyle = "#fff"; c.font = `800 ${Math.round(h * 0.06)}px system-ui`; c.textAlign = "center";
    c.fillText("ДОСТОЙНУЮ ЗАРПЛАТУ!", w / 2, h * 0.165);
  } else if (who === "emergency") { // мигалка
    const on = Math.sin(t * 8) > 0;
    c.fillStyle = on ? "rgba(255,40,40,.35)" : "rgba(40,120,255,.3)";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#fff"; c.font = `800 ${Math.round(h * 0.06)}px system-ui`; c.textAlign = "center";
    c.fillText("ДИСПЕТЧЕРСКАЯ ЧС", w / 2, h * 0.17);
  } else {
    c.lineWidth = Math.max(2, w / 300);
    for (let k = 0; k < 3; k++) {
      c.strokeStyle = k === 1 ? "#e05353" : "#3fd17a";
      c.beginPath();
      for (let x = 0; x <= w; x += w / 40) {
        const y = h * (0.2 + k * 0.17) + Math.sin(x / w * 9 + t * 0.6 + k * 2) * h * 0.04 + Math.sin(x / w * 23 + k) * h * 0.015;
        if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    c.fillStyle = "#3fd17a"; c.font = `600 ${Math.round(h * 0.045)}px monospace`; c.textAlign = "left";
    const tick = "НЕФТЬ +2.1%  ГАЗ −0.8%  МЕТАЛЛ +1.4%  ФИНАНСЫ +0.6%  ";
    c.fillText(tick + tick, -((t * 60) % (w * 1.2)), h * 0.17);
  }
  // в альбомной ориентации лицо выше — субтитры внизу его не закрывают
  const wide = w > h * 1.2;
  const cx = w / 2 + Math.sin(t * 0.9) * w * 0.006, cy = h * (wide ? 0.4 : 0.45) + Math.sin(t * 1.3) * h * 0.004;
  const r = Math.min(w, h) * (wide ? 0.15 : 0.17);
  // плечи и пиджак
  c.fillStyle = p.suit;
  c.beginPath(); c.moveTo(cx - r * 2.3, h); c.quadraticCurveTo(cx - r * 2.1, cy + r * 1.35, cx - r * 0.5, cy + r * 1.1);
  c.lineTo(cx + r * 0.5, cy + r * 1.1); c.quadraticCurveTo(cx + r * 2.1, cy + r * 1.35, cx + r * 2.3, h); c.fill();
  c.fillStyle = "#f4f4f4"; // рубашка
  c.beginPath(); c.moveTo(cx - r * 0.45, cy + r * 1.1); c.lineTo(cx, cy + r * 2.1); c.lineTo(cx + r * 0.45, cy + r * 1.1); c.fill();
  if (!p.woman) { c.fillStyle = "#a0262b"; c.beginPath(); c.moveTo(cx - r * 0.1, cy + r * 1.15); c.lineTo(cx + r * 0.1, cy + r * 1.15); c.lineTo(cx + r * 0.16, cy + r * 1.9); c.lineTo(cx, cy + r * 2.05); c.lineTo(cx - r * 0.16, cy + r * 1.9); c.fill(); }
  else { c.fillStyle = "#d9ab2e"; c.beginPath(); c.arc(cx - r * 0.9, cy + r * 1.45, r * 0.08, 0, 7); c.fill(); }
  // шея и голова
  c.fillStyle = "#e8b896"; c.fillRect(cx - r * 0.3, cy + r * 0.6, r * 0.6, r * 0.6);
  if (p.woman) { c.fillStyle = p.hair; c.beginPath(); c.ellipse(cx, cy - r * 0.05, r * 1.12, r * 1.25, 0, 0, 7); c.fill(); }
  c.fillStyle = "#f0c3a2"; c.beginPath(); c.ellipse(cx, cy, r * 0.88, r * 1.05, 0, 0, 7); c.fill();
  c.fillStyle = p.hair; // волосы
  c.beginPath();
  if (p.woman) { c.ellipse(cx, cy - r * 0.75, r * 0.95, r * 0.45, 0, Math.PI, 0); c.fill(); c.beginPath(); c.arc(cx, cy - r * 1.25, r * 0.35, 0, 7); }
  else { c.ellipse(cx, cy - r * 0.78, r * 0.9, r * 0.38, 0, Math.PI, 0); c.rect(cx - r * 0.9, cy - r * 0.8, r * 0.14, r * 0.5); c.rect(cx + r * 0.76, cy - r * 0.8, r * 0.14, r * 0.5); }
  c.fill();
  // глаза (моргают), брови
  const ey = cy - r * 0.15;
  for (const s of [-1, 1]) {
    c.fillStyle = "#fff"; c.beginPath(); c.ellipse(cx + s * r * 0.35, ey, r * 0.16, blink ? r * 0.02 : r * 0.1, 0, 0, 7); c.fill();
    if (!blink) { c.fillStyle = "#3a2a1e"; c.beginPath(); c.arc(cx + s * r * 0.35, ey, r * 0.065, 0, 7); c.fill(); }
    c.strokeStyle = p.hair; c.lineWidth = r * 0.06; c.beginPath(); c.moveTo(cx + s * r * 0.2, ey - r * 0.25); c.quadraticCurveTo(cx + s * r * 0.36, ey - r * 0.3, cx + s * r * 0.5, ey - r * 0.2); c.stroke();
  }
  if (!p.woman) { // очки брокера
    c.strokeStyle = "#222"; c.lineWidth = r * 0.035;
    for (const s of [-1, 1]) { c.beginPath(); c.ellipse(cx + s * r * 0.35, ey, r * 0.22, r * 0.17, 0, 0, 7); c.stroke(); }
    c.beginPath(); c.moveTo(cx - r * 0.13, ey); c.lineTo(cx + r * 0.13, ey); c.stroke();
  }
  c.strokeStyle = "#c98f6e"; c.lineWidth = r * 0.05; c.beginPath(); c.moveTo(cx, ey + r * 0.05); c.lineTo(cx - r * 0.06, cy + r * 0.25); c.lineTo(cx + r * 0.04, cy + r * 0.28); c.stroke();
  // рот: открывается, пока говорит
  const mh = r * (0.04 + mouth * 0.2);
  c.fillStyle = p.woman ? "#b8404f" : "#8a3b36";
  c.beginPath(); c.ellipse(cx, cy + r * 0.52, r * 0.25, mh, 0, 0, 7); c.fill();
  if (mouth > 0.2) { c.fillStyle = "#4a1414"; c.beginPath(); c.ellipse(cx, cy + r * 0.53, r * 0.18, mh * 0.6, 0, 0, 7); c.fill(); }
}

/** Маленький портрет для экрана входящего вызова. */
export function callerPortrait(who: Caller, size = 120): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size * 2;
  cv.className = "callavatar";
  drawPerson(cv.getContext("2d")!, cv.width, cv.height, who, 0, 0, false);
  return cv;
}

// ---------- Окно звонка ----------

export interface CallOptions {
  from: Caller;
  playerName: string;
  playerColor: string;
  text: string;
  /** Сразу разговор, без звонка (повтор из «Входящих»). */
  noRing?: boolean;
  /** Есть предложение — в звонке кнопки «Принять / Отказать». */
  offer?: { accept: () => Promise<string | null>; decline: () => Promise<void> };
  /** Варианты решения (неприятности компании). */
  choices?: { label: string; hint?: string; run: () => Promise<void> }[];
  /** Время на решение в секундах — потом звонок заканчивается сам. */
  timeLimit?: number;
}

/** Результат: answered — выслушал до конца; dropped — прервал; declined/missed — не ответил (сообщение во «Входящих»). */
export type CallResult = "answered" | "dropped" | "declined" | "missed" | "accepted" | "rejected" | "chosen" | "timeout";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

export function showCall(host: HTMLElement, o: CallOptions): Promise<CallResult> {
  const who = CALLERS[o.from];
  const root = el("div", "call");
  host.append(root);
  let ringTimer = 0;
  const vibrate = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* нет вибро */ } };
  return new Promise((resolve) => {
    let finished = false;
    let countdown = 0;
    const finish = (r: CallResult) => {
      if (finished) return;
      finished = true;
      clearInterval(countdown);
      clearInterval(ringTimer);
      vibrate(0);
      stopSpeech();
      cancelAnimationFrame(raf);
      root.classList.add("out");
      setTimeout(() => root.remove(), 250);
      resolve(r);
    };
    let raf = 0;
    const tStart = performance.now();
    const left = () => (o.timeLimit ? Math.max(0, Math.ceil(o.timeLimit - (performance.now() - tStart) / 1000)) : null);
    if (o.timeLimit) countdown = window.setInterval(() => {
      for (const n of root.querySelectorAll(".calltimer")) n.textContent = `⏱ ${left()} с на решение`;
      if (left() === 0) { clearInterval(countdown); finish("timeout"); }
    }, 250);

    // 1) входящий вызов
    const ringing = () => {
      root.replaceChildren();
      const box = el("div", "ring");
      box.append(el("div", "ringlabel", "Входящий видеозвонок"), callerPortrait(o.from), el("div", "ringname", who.name), el("div", "ringorg", who.org));
      const btns = el("div", "ringbtns");
      const no = el("button", "callbtn decline", "✆");
      const yes = el("button", "callbtn accept", "✆");
      no.title = "Отклонить"; yes.title = "Ответить";
      const cap = (b: HTMLElement, t: string) => { const w = el("div", "capbtn"); w.append(b, el("div", "", t)); return w; };
      btns.append(cap(no, "Отклонить"), cap(yes, "Ответить"));
      no.onclick = () => finish("declined");
      yes.onclick = () => talk();
      box.append(btns, el("div", "ringhint", o.choices ? "Не ответите вовремя — решение примут без вас (по умолчанию «ничего не делать»)" : "Отклоните — сообщение останется во «📨 Входящих»"));
      if (o.timeLimit) box.append(el("div", "calltimer", `⏱ ${left()} с на решение`));
      root.append(box);
      const ring = () => { sfx.ring(); vibrate([400, 200, 400]); };
      ring();
      ringTimer = window.setInterval(ring, 2200);
      if (!o.timeLimit) setTimeout(() => { if (!talking) finish("missed"); }, 20000);
    };

    // 2) разговор
    let talking = false;
    const talk = () => {
      talking = true;
      clearInterval(ringTimer);
      vibrate(0);
      root.replaceChildren();
      const video = el("div", "video");
      const cv = document.createElement("canvas");
      cv.className = "videocv";
      const top = el("div", "videotop");
      const timer = el("span", "", "00:00");
      top.append(el("b", "", who.name), el("span", "muted", ` · ${who.org.split(" · ")[0]} · `), timer);
      if (o.timeLimit) top.append(el("span", "calltimer", ` ⏱ ${left()} с`));
      const self = el("div", "selfcam");
      self.style.background = o.playerColor;
      self.textContent = o.playerName.slice(0, 1).toUpperCase();
      const subs = el("div", "subs");
      const said = el("span", "said"), rest = el("span", "", o.text);
      subs.append(said, rest);
      const btns = el("div", "videobtns");
      const end = el("button", "callbtn decline small", "✆");
      end.title = "Завершить";
      const endWrap = el("div", "capbtn"); endWrap.append(end, el("div", "", "Завершить"));
      end.onclick = () => finish(spoken ? "answered" : "dropped");
      if (o.choices) {
        const box = el("div", "callchoices");
        for (const ch of o.choices) {
          const b = el("button", "choice");
          b.append(el("b", "", ch.label), ...(ch.hint ? [el("small", "", ch.hint)] : []));
          b.onclick = async () => { stopSpeech(); await ch.run(); finish("chosen"); };
          box.append(b);
        }
        video.append(box);
        btns.append(endWrap);
      } else if (o.offer) {
        const acc = el("button", "primary", "Принять");
        const rej = el("button", "", "Отказать");
        acc.onclick = async () => { stopSpeech(); const err = await o.offer!.accept(); if (err) { subs.textContent = err; setTimeout(() => finish("answered"), 1800); } else finish("accepted"); };
        rej.onclick = async () => { await o.offer!.decline(); finish("rejected"); };
        btns.append(rej, endWrap, acc);
      } else btns.append(endWrap);
      video.append(cv, top, self, subs, btns);
      root.append(video);
      const ctx = cv.getContext("2d")!;
      const t0 = performance.now();
      let spoken = false, mouthOn = true, nextBlink = 1.5;
      const words = o.text.split(" ");
      const greet = 1.2 + 0.33 * `${o.playerName} ${who.name} ${who.org.split(" · ")[0]}`.split(" ").length; // приветствие перед текстом
      const frame = () => {
        const w = cv.clientWidth, h = cv.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
        const t = (performance.now() - t0) / 1000;
        const blink = t > nextBlink && t < nextBlink + 0.12;
        if (t > nextBlink + 0.12) nextBlink = t + 2 + Math.random() * 2.5;
        const mouth = mouthOn ? Math.abs(Math.sin(t * 13)) * (0.55 + 0.45 * Math.sin(t * 3.1)) : 0;
        drawPerson(ctx, cv.width, cv.height, o.from, t, mouth, blink);
        const sec = Math.floor(t);
        timer.textContent = `00:${String(sec).padStart(2, "0")}`.slice(-5);
        if (mouthOn) { // субтитры «догоняют» речь
          const k = Math.max(0, Math.min(words.length, Math.floor((t - greet) / 0.36)));
          said.textContent = words.slice(0, k).join(" ") + (k ? " " : "");
          rest.textContent = words.slice(k).join(" ");
        }
        raf = requestAnimationFrame(frame);
      };
      frame();
      const minTime = (greet + words.length * 0.36) * 1000; // без голоса — даём дочитать субтитры
      void speak(`Здравствуйте, ${o.playerName}! ${who.name}, ${who.org.split(" · ")[0]}. ${o.text}`, who.woman).then(async () => {
        const left = minTime - (performance.now() - t0);
        if (left > 0 && !finished) await new Promise((r) => setTimeout(r, left));
        if (finished) return;
        spoken = true; mouthOn = false;
        said.textContent = o.text; rest.textContent = "";
        if (!o.offer && !o.choices) setTimeout(() => finish("answered"), 2500);
      });
    };
    if (o.noRing) talk(); else ringing();
  });
}
