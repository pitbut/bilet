// Звуки синтезируются на лету (Web Audio), без файлов — игра остаётся лёгкой.

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let master: GainNode | null = null;
let muted = (() => { try { return localStorage.getItem("oligarh-mute") === "1"; } catch { return false; } })();

/** Звук включается только после первого касания экрана (требование браузеров). */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
}

export function isMuted() { return muted; }
export function setMuted(v: boolean) {
  muted = v;
  try { localStorage.setItem("oligarh-mute", v ? "1" : "0"); } catch { /* приватный режим */ }
  if (master) master.gain.value = v ? 0 : 0.55;
}

function tone(freq: number, dur: number, type: OscillatorType = "sine", vol = 0.3, at = 0, slideTo?: number) {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol = 0.2, at = 0, filter = 2000) {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime + at;
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  src.buffer = buf;
  f.type = "bandpass";
  f.frequency.value = filter;
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

export const sfx = {
  click: () => tone(660, 0.05, "triangle", 0.15),
  dice: () => { for (let k = 0; k < 7; k++) noise(0.04, 0.35 - k * 0.04, k * 0.09 + Math.random() * 0.03, 1800 + Math.random() * 1500); },
  step: () => { tone(180, 0.07, "sine", 0.25); noise(0.03, 0.08, 0, 900); },
  whoosh: () => noise(0.6, 0.12, 0, 600),
  coin: () => { tone(1320, 0.08, "square", 0.08); tone(1760, 0.18, "square", 0.08, 0.07); },
  pay: () => { tone(520, 0.1, "triangle", 0.2); tone(390, 0.18, "triangle", 0.2, 0.09); },
  buy: () => { tone(880, 0.06, "square", 0.08); tone(1100, 0.06, "square", 0.08, 0.06); noise(0.08, 0.15, 0.12, 4000); tone(1650, 0.3, "triangle", 0.12, 0.15); },
  hammer: () => { for (let k = 0; k < 3; k++) { noise(0.05, 0.3, k * 0.16, 700); tone(140, 0.06, "square", 0.15, k * 0.16); } },
  built: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, "triangle", 0.18, i * 0.09)); },
  tap: () => tone(300 + Math.random() * 80, 0.05, "square", 0.06),
  card: () => { noise(0.12, 0.2, 0, 5000); tone(980, 0.08, "sine", 0.08, 0.05); },
  spinTick: () => tone(1500, 0.02, "square", 0.05),
  reelStop: () => { noise(0.05, 0.25, 0, 1200); tone(220, 0.08, "square", 0.08); },
  win: () => { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.18, "square", 0.08, i * 0.08)); },
  lose: () => { tone(330, 0.25, "sawtooth", 0.08, 0, 220); },
  jackpot: () => { for (let r = 0; r < 3; r++) [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, 0.14, "square", 0.08, r * 0.4 + i * 0.07)); },
  bankrupt: () => tone(400, 1.0, "sawtooth", 0.12, 0, 80),
  turn: () => { tone(740, 0.08, "sine", 0.12); tone(988, 0.14, "sine", 0.12, 0.08); },
  alert: () => { tone(880, 0.1, "square", 0.08); tone(880, 0.1, "square", 0.08, 0.15); },
  ring: () => { for (let k = 0; k < 2; k++) { tone(880, 0.35, "sine", 0.16, k * 0.45); tone(1320, 0.35, "sine", 0.1, k * 0.45); } },
  stock: () => { tone(600, 0.06, "triangle", 0.12); tone(900, 0.12, "triangle", 0.12, 0.06); },
};
