import "./style.css";
import { GameConfig, Personality } from "./engine/engine";
import { App, PERSONALITY_NAMES, Speed } from "./ui/app";
import { unlockAudio } from "./ui/sound";

window.addEventListener("pointerdown", unlockAudio);

const COLORS = ["#e53935", "#1e88e5", "#43a047", "#fdd835", "#8e24aa", "#fb8c00"];
const TOKENS = ["sedan", "helicopter", "yacht", "safe", "derrick", "goldbar"];
const PERS: Personality[] = ["shark", "miser", "gambler", "trader"];
const BOT_NAMES = ["Борис", "Семён", "Гена", "Тимур", "Олег"];

const root = document.getElementById("app")!;

interface Setup { mode: "solo" | "hotseat"; length: "quick" | "classic"; humans: string[]; bots: number; difficulty: "easy" | "normal" | "hard"; speed: Speed }
const saved = (() => { try { return JSON.parse(localStorage.getItem("oligarh-setup") ?? "null") as Setup | null; } catch { return null; } })();
const setup: Setup = saved ?? { mode: "solo", length: "quick", humans: ["Вы"], bots: 3, difficulty: "normal", speed: "normal" };

function seg<T extends string>(value: T, options: [T, string][], onChange: (v: T) => void) {
  const el = document.createElement("div");
  el.className = "seg";
  for (const [v, label] of options) {
    const b = document.createElement("button");
    b.textContent = label;
    if (v === value) b.className = "on";
    b.onclick = () => { onChange(v); renderSetup(); };
    el.append(b);
  }
  return el;
}

function field(label: string, ...kids: Node[]) {
  const d = document.createElement("div");
  d.className = "field";
  const l = document.createElement("div");
  l.className = "label";
  l.textContent = label;
  d.append(l, ...kids);
  return d;
}

function renderSetup() {
  root.replaceChildren();
  const box = document.createElement("div");
  box.className = "setup";
  const title = document.createElement("h1");
  title.textContent = "ОЛИГАРХ";
  const sub = document.createElement("p");
  sub.className = "muted";
  sub.textContent = "Прототип · стройки на время, казино, российские города";
  box.append(title, sub);

  if (setup.mode === "solo") setup.humans = setup.humans.slice(0, 1);
  if (setup.mode === "hotseat" && setup.humans.length < 2) setup.humans = [setup.humans[0] ?? "Игрок 1", "Игрок 2"];
  const maxBots = 6 - setup.humans.length;
  const minBots = setup.mode === "solo" ? 1 : 0;
  setup.bots = Math.max(minBots, Math.min(maxBots, setup.bots));

  box.append(field("Режим", seg(setup.mode, [["solo", "Один против ботов"], ["hotseat", "Несколько на одном телефоне"]], (v) => { setup.mode = v; })));
  box.append(field("Длина партии", seg(setup.length, [["quick", "Быстрая · 15 раундов"], ["classic", "Классика"]], (v) => { setup.length = v; })));

  const names = document.createElement("div");
  names.className = "names";
  setup.humans.forEach((n, i) => {
    const inp = document.createElement("input");
    inp.value = n;
    inp.maxLength = 14;
    inp.oninput = () => { setup.humans[i] = inp.value || `Игрок ${i + 1}`; };
    names.append(inp);
  });
  if (setup.mode === "hotseat") {
    const add = document.createElement("button");
    add.textContent = "+";
    add.disabled = setup.humans.length >= 6;
    add.onclick = () => { setup.humans.push(`Игрок ${setup.humans.length + 1}`); renderSetup(); };
    const rem = document.createElement("button");
    rem.textContent = "−";
    rem.disabled = setup.humans.length <= 2;
    rem.onclick = () => { setup.humans.pop(); renderSetup(); };
    names.append(rem, add);
  }
  box.append(field(setup.mode === "solo" ? "Ваше имя" : "Игроки", names));

  const botOpts: [string, string][] = [];
  for (let k = minBots; k <= maxBots; k++) botOpts.push([String(k), String(k)]);
  box.append(field("Боты", seg(String(setup.bots), botOpts, (v) => { setup.bots = Number(v); })));
  box.append(field("Сложность ботов", seg(setup.difficulty, [["easy", "Новичок"], ["normal", "Бизнесмен"], ["hard", "Олигарх"]], (v) => { setup.difficulty = v; })));
  box.append(field("Анимация", seg(setup.speed, [["normal", "Обычная"], ["fast", "Быстрая"], ["instant", "Мгновенно"]], (v) => { setup.speed = v; })));

  const go = document.createElement("button");
  go.className = "primary big";
  go.textContent = "Начать игру";
  go.onclick = startGame;
  box.append(go);
  root.append(box);
}

function startGame() {
  try { localStorage.setItem("oligarh-setup", JSON.stringify(setup)); } catch { /* приватный режим */ }
  const players: GameConfig["players"] = [];
  setup.humans.forEach((name) => players.push({ name, bot: false, token: "", color: "" }));
  for (let k = 0; k < setup.bots; k++) {
    const pers = PERS[k % PERS.length];
    players.push({ name: `${PERSONALITY_NAMES[pers]} ${BOT_NAMES[k]}`, bot: true, personality: pers, difficulty: setup.difficulty, token: "", color: "" });
  }
  players.forEach((p, i) => { p.token = TOKENS[i]; p.color = COLORS[i]; });
  root.replaceChildren();
  const app = new App(root, () => { location.reload(); });
  void app.start({ players, mode: setup.mode, length: setup.length }, setup.speed);
}

renderSetup();
