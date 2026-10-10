import "./style.css";
import { GameConfig, Personality } from "./engine/engine";
import { App, PERSONALITY_NAMES, Speed } from "./ui/app";
import { unlockAudio } from "./ui/sound";
import { NetClient, NetHost } from "./net/session";
import { FoundTable, pickDriver } from "./net/transport";
import { clearSave, loadGame } from "./ui/save";

window.addEventListener("pointerdown", unlockAudio);

const COLORS = ["#e53935", "#1e88e5", "#43a047", "#fdd835", "#8e24aa", "#fb8c00"];
const TOKENS = ["sedan", "helicopter", "yacht", "safe", "derrick", "goldbar"];
const PERS: Personality[] = ["shark", "miser", "gambler", "trader"];
const BOT_NAMES = ["Борис", "Семён", "Гена", "Тимур", "Олег"];

const root = document.getElementById("app")!;

interface Setup { mode: "solo" | "hotseat" | "network"; length: "quick" | "classic"; humans: string[]; bots: number; difficulty: "easy" | "normal" | "hard"; speed: Speed; startCompanies?: boolean }
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

function modeField() {
  return field("Режим", seg(setup.mode, [["solo", "Один против ботов"], ["hotseat", "Несколько на одном телефоне"], ["network", "Несколько телефонов"]], (v) => { setup.mode = v; }));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
function btn(text: string, on: () => void, cls = "") { const b = el("button", cls, text); b.onclick = on; return b; }
function save() { try { localStorage.setItem("oligarh-setup", JSON.stringify(setup)); } catch { /* приватный режим */ } }

const driver = pickDriver();

/** Сетевая игра: имя и кнопки «Создать стол» / «Найти стол». */
function renderNetworkSetup(box: HTMLElement) {
  box.append(modeField());
  const name = el("input");
  name.value = setup.humans[0] ?? "Игрок";
  name.maxLength = 14;
  name.oninput = () => { setup.humans[0] = name.value || "Игрок"; };
  const names = el("div", "names"); names.append(name);
  box.append(field("Ваше имя", names));
  box.append(field("Анимация на этом телефоне", seg(setup.speed, [["normal", "Обычная"], ["fast", "Быстрая"], ["instant", "Мгновенно"]], (v) => { setup.speed = v; })));
  box.append(field("Связь", el("div", "netlabel", driver.kind === "bluetooth"
    ? "Bluetooth: телефоны рядом, интернет не нужен. Один создаёт стол, остальные его находят."
    : driver.label + ". Откройте игру в нескольких вкладках: в одной создайте стол, в других найдите его.")));
  const row = el("div", "netbtns");
  row.append(btn("Создать стол", () => { save(); void hostLobby(); }, "primary big"), btn("Найти стол", () => { save(); void findTables(); }, "big ghostlight"));
  box.append(row);
  root.append(box);
}

function screen(titleText: string, subText = "") {
  root.replaceChildren();
  const box = el("div", "setup");
  box.append(el("h1", "", "ОЛИГАРХ"), el("p", "muted", titleText));
  if (subText) box.append(el("p", "muted small", subText));
  root.append(box);
  return box;
}

function seatList(seats: { name: string; kind: string }[]) {
  const list = el("div", "seats");
  for (const st of seats) list.append(el("div", `seat ${st.kind}`, `${st.kind === "host" ? "👑 " : st.kind === "bot" ? "🤖 " : "📱 "}${st.name}`));
  return list;
}

/** Хозяин стола: ждём гостей, выбираем ботов и длину, начинаем. */
async function hostLobby() {
  const myName = setup.humans[0] ?? "Хозяин";
  let tr;
  try { tr = await driver.host(`Стол ${myName}`); } catch (e) { const b = screen("Не удалось создать стол", String(e)); b.append(btn("Назад", () => renderSetup(), "big ghostlight")); return; }
  const host = new NetHost(tr, myName, `Стол ${myName}`);
  const draw = () => {
    const box = screen(`Ваш стол: «Стол ${myName}»`, driver.kind === "bluetooth" ? "Пусть остальные нажмут «Найти стол» — телефон виден по Bluetooth." : "В другой вкладке выберите «Несколько телефонов» → «Найти стол».");
    const humans = host.seats();
    const maxBots = 6 - humans.length;
    setup.bots = Math.min(setup.bots, maxBots);
    const bots: { name: string; kind: string }[] = Array.from({ length: setup.bots }, (_, k) => ({ name: `${PERSONALITY_NAMES[PERS[k % 4]]} ${BOT_NAMES[k]}`, kind: "bot" }));
    box.append(field(`За столом (${humans.length + setup.bots} из 6)`, seatList([...humans, ...bots])));
    const opts: [string, string][] = [];
    for (let k = 0; k <= maxBots; k++) opts.push([String(k), String(k)]);
    box.append(field("Боты", seg2(String(setup.bots), opts, (v) => { setup.bots = Number(v); draw(); })));
    box.append(field("Длина партии", seg2(setup.length, [["quick", "Быстрая · 15 раундов"], ["classic", "Классика"]], (v) => { setup.length = v; draw(); })));
    box.append(startField(() => draw()));
    box.append(field("Анимация на этом телефоне", seg2(setup.speed, [["normal", "Обычная"], ["fast", "Быстрая"], ["instant", "Мгновенно"]], (v) => { setup.speed = v; draw(); })));
    const go = btn(humans.length + setup.bots >= 2 ? "Начать игру" : "Нужен хотя бы один соперник", () => startHost(host), "primary big");
    go.disabled = humans.length + setup.bots < 2;
    box.append(go, btn("Закрыть стол", () => { host.close(); renderSetup(); }, "big ghostlight"));
  };
  host.onLobby = draw;
  draw();
}

function seg2<T extends string>(value: T, options: [T, string][], onChange: (v: T) => void) {
  const e = el("div", "seg");
  for (const [v, label] of options) { const b = btn(label, () => onChange(v), v === value ? "on" : ""); e.append(b); }
  return e;
}

function startHost(host: NetHost) {
  save();
  const players: GameConfig["players"] = host.assignSeats().map((name) => ({ name, bot: false, token: "", color: "" }));
  for (let k = 0; k < setup.bots && players.length < 6; k++) {
    const pers = PERS[k % PERS.length];
    players.push({ name: `${PERSONALITY_NAMES[pers]} ${BOT_NAMES[k]}`, bot: true, personality: pers, difficulty: setup.difficulty, token: "", color: "" });
  }
  players.forEach((p, i) => { p.token = TOKENS[i]; p.color = COLORS[i]; });
  root.replaceChildren();
  const app = new App(root, () => { host.close(); location.reload(); });
  void app.start({ players, mode: "network", length: setup.length, startCompanies: !!setup.startCompanies }, setup.speed, host);
}

/** Гость: ищем столы рядом. */
async function findTables() {
  const box = screen("Ищем столы рядом…", driver.kind === "bluetooth" ? "Включите Bluetooth. Хозяин стола должен нажать «Создать стол»." : "Столы из других вкладок появятся здесь.");
  const list = el("div", "tables");
  box.append(list, btn("Назад", () => { stop(); renderSetup(); }, "big ghostlight"));
  const found = new Map<string, FoundTable>();
  let stop = () => {};
  try {
    stop = await driver.scan((t) => {
      if (found.has(t.id)) return;
      found.set(t.id, t);
      list.append(btn(`🎲 ${t.name}`, () => { stop(); void join(t); }, "big tablebtn"));
    });
  } catch (e) { box.append(el("p", "muted", `Поиск не удался: ${String(e)}`)); }
}

async function join(t: FoundTable) {
  const box = screen(`Подключаемся к «${t.name}»…`);
  let tr;
  try { tr = await driver.join(t.id); } catch (e) { box.append(el("p", "muted", `Не удалось подключиться: ${String(e)}`), btn("Назад", () => renderSetup(), "big ghostlight")); return; }
  const client = new NetClient(tr, setup.humans[0] ?? "Гость");
  const wait = () => {
    const b = screen(`Вы за столом «${t.name}»`, "Ждём, пока хозяин начнёт игру…");
    b.append(field("За столом", seatList(client.seats)), btn("Выйти", () => { client.close(); renderSetup(); }, "big ghostlight"));
  };
  client.onLobby = wait;
  client.onLost = (why) => { const b = screen("Отключено", why); b.append(btn("В меню", () => renderSetup(), "primary big")); };
  client.onStart = (state, seat) => {
    root.replaceChildren();
    const app = new App(root, () => { client.close(); location.reload(); });
    void app.startClient(client, state, seat, setup.speed);
  };
  wait();
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

  const savedGame = loadGame();
  if (savedGame) {
    const g = savedGame.state;
    const card = el("div", "savecard");
    const when = new Date(savedGame.at).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    card.append(el("b", "", "Сохранённая партия"),
      el("div", "muted small", `${g.cfg.mode === "hotseat" ? "На одном телефоне" : "Против ботов"} · раунд ${g.round} · ${g.players.map((p) => p.name).join(", ")} · ${when}`));
    const row = el("div", "netbtns");
    row.append(btn("Продолжить партию", () => {
      root.replaceChildren();
      const app = new App(root, () => { location.reload(); });
      void app.resume(g, savedGame.speed);
    }, "primary big"), btn("Удалить", () => { if (confirm("Удалить сохранённую партию?")) { clearSave(); renderSetup(); } }, "big ghostlight"));
    card.append(row);
    box.append(card);
  }

  if (setup.mode !== "hotseat") setup.humans = setup.humans.slice(0, 1);
  if (setup.mode === "hotseat" && setup.humans.length < 2) setup.humans = [setup.humans[0] ?? "Игрок 1", "Игрок 2"];
  const maxBots = 6 - setup.humans.length;
  const minBots = setup.mode === "solo" ? 1 : 0;
  if (setup.mode === "network") { renderNetworkSetup(box); return; }
  setup.bots = Math.max(minBots, Math.min(maxBots, setup.bots));

  box.append(modeField());
  box.append(field("Длина партии", seg(setup.length, [["quick", "Быстрая · 15 раундов"], ["classic", "Классика"]], (v) => { setup.length = v; })));
  box.append(startField(() => renderSetup()));

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

/** Стартовые предприятия: по умолчанию все начинают с пустыми руками. */
function startField(redraw: () => void) {
  const f = field("Стартовое предприятие", seg2(setup.startCompanies ? "yes" : "no", [["no", "Нет — всё покупаем сами"], ["yes", "По одному каждому"]], (v) => { setup.startCompanies = v === "yes"; redraw(); }));
  f.append(el("div", "muted small", "«По одному каждому» — на старте всем достаётся случайная компания, партия быстрее разгоняется."));
  return f;
}

function startGame() {
  if (loadGame() && !confirm("Новая игра заменит сохранённую партию. Начать?")) return;
  clearSave();
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
  void app.start({ players, mode: setup.mode, length: setup.length, startCompanies: !!setup.startCompanies }, setup.speed);
}

renderSetup();
