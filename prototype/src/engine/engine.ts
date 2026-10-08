// Ядро правил «Олигарха». Без графики: состояние + действия + события для анимации.
import { BOARD, BranchId, CASINO_INDEX, Cell, IndustryId, PORT_INDICES, industryCells } from "./board";

// ---------- Типы ----------

export type Personality = "shark" | "miser" | "gambler" | "trader";
export type Difficulty = "easy" | "normal" | "hard";
export type Mode = "solo" | "hotseat";
export type Length = "quick" | "classic";

export interface PlayerConfig {
  name: string;
  bot: boolean;
  personality?: Personality;
  difficulty?: Difficulty;
  token: string;
  color: string;
}

export interface GameConfig {
  players: PlayerConfig[];
  mode: Mode;
  length: Length;
  seed?: number;
  quickRounds?: number;
  classicRounds?: number;
  startMoney?: number;
}

export interface Player extends PlayerConfig {
  id: number;
  money: number;
  pos: number;
  bankrupt: boolean;
  inCasino: boolean;
  skipNext: boolean;
  energy: number;
  doubles: number;
  casinoWinnings: number;
}

export interface Construction {
  target: number; // строящийся уровень 1..3
  progress: number; // 0..100
  rush: boolean;
  insured: boolean;
  accidentChecked: boolean;
  ticks: number;
  nominalTicks: number;
}

export interface Property {
  owner: number | null;
  level: number; // 0..3 — достроенный уровень
  branch: BranchId | null;
  mortgaged: boolean;
  invested: number;
  construction: Construction | null;
  fastBonus: boolean;
}

export interface MarketEvent {
  title: string;
  rent: Partial<Record<IndustryId | "transport", number>>;
  buildCost?: number;
  slow?: IndustryId[];
  roundsLeft: number;
}

export type Pending =
  | { kind: "buy"; cell: number }
  | { kind: "rent"; cell: number; owner: number; amount: number }
  | { kind: "auction"; cell: number; bids: Record<number, number>; waiting: number[] };

export type Phase = "roll" | "decide" | "auction" | "casino" | "casinoExit" | "end" | "gameover";

export type GameEvent =
  | { type: "dice"; player: number; a: number; b: number }
  | { type: "move"; player: number; path: number[]; teleport?: boolean }
  | { type: "money"; player: number; delta: number; reason: string }
  | { type: "buy"; player: number; cell: number }
  | { type: "buildStart"; player: number; cell: number; level: number }
  | { type: "buildDone"; player: number; cell: number; level: number; fast: boolean }
  | { type: "accident"; player: number; cell: number }
  | { type: "card"; player: number; deck: "news" | "gov"; text: string }
  | { type: "casino"; player: number; game: string; win: number; detail: string }
  | { type: "jackpot"; player: number; amount: number }
  | { type: "market"; title: string }
  | { type: "bankrupt"; player: number; creditor: number | null }
  | { type: "turn"; player: number; round: number }
  | { type: "log"; text: string }
  | { type: "gameover"; winner: number };

export interface GameState {
  cfg: GameConfig;
  players: Player[];
  props: Record<number, Property>;
  current: number;
  round: number;
  phase: Phase;
  pending: Pending | null;
  casinoBets: number;
  lastDice: [number, number];
  jackpot: number;
  market: MarketEvent | null;
  rng: number;
  events: GameEvent[];
  winner: number | null;
  turnCounter: number;
  /** Только для тестов: заранее заданные броски. */
  forcedDice?: [number, number][];
}

export type Action =
  | { t: "roll" }
  | { t: "buy" }
  | { t: "decline" }
  | { t: "bid"; amount: number }
  | { t: "payRent" }
  | { t: "workOff" }
  | { t: "build"; cell: number; branch?: BranchId; rush?: boolean; insure?: boolean }
  | { t: "overtime"; cell: number }
  | { t: "takeover"; cell: number }
  | { t: "tap"; cell: number; n?: number }
  | { t: "mortgage"; cell: number }
  | { t: "unmortgage"; cell: number }
  | { t: "roulette"; choice: "red" | "black" | "even" | "odd" | number; amount: number }
  | { t: "slots"; amount: number }
  | { t: "leaveCasino" }
  | { t: "payExit" }
  | { t: "rollDouble" }
  | { t: "stay" }
  | { t: "endTurn" };

export interface Result { ok: boolean; error?: string }

// ---------- Константы баланса ----------

export const START_MONEY = 1500;
export const PASS_START = 200;
export const LAND_START = 300;
export const ENERGY_PER_ROUND = 60;
export const BUILD_COST = [0.5, 0.75, 1.0];
export const BUILD_ROUNDS = [1, 2, 3];
export const BRANCH_MULT: Record<BranchId, number[]> = { rent: [4, 10, 20], income: [2, 4, 7], special: [3, 6, 12] };
export const INCOME_SHARE = [0.04, 0.08, 0.15];
export const TRANSPORT_RENT = [25, 50, 100, 200];
export const MAX_CONSTRUCTIONS = 3;
export const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const SLOT_SYMBOLS = ["Нефть", "Газ", "Металл", "Лес", "Зерно", "Кремль"];

const MARKET_EVENTS: Omit<MarketEvent, "roundsLeft">[] = [
  { title: "Нефть дорожает: нефть +30%", rent: { oil: 1.3 } },
  { title: "Холодная зима: газ +40%, туризм −20%", rent: { gas: 1.4, tourism: 0.8 } },
  { title: "Туристический бум: туризм +40%, транспорт +20%", rent: { tourism: 1.4, transport: 1.2 } },
  { title: "Строительная лихорадка: металл и лес +30%, стройки дороже на 10%", rent: { metal: 1.3, forest: 1.3 }, buildCost: 1.1 },
  { title: "Урожайный год: агро +50%", rent: { agro: 1.5 } },
  { title: "Импортозамещение: автопром +40%", rent: { auto: 1.4 } },
  { title: "Высокая ключевая ставка: финансы +50%", rent: { finance: 1.5 } },
  { title: "Экологическая проверка: стройки нефти и газа на 50% медленнее", rent: {}, slow: ["oil", "gas"] },
];

// ---------- Случайность (детерминированная, зерно хранится в состоянии) ----------

function rand(s: GameState): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const randInt = (s: GameState, n: number) => Math.floor(rand(s) * n);

// ---------- Создание партии ----------

export function newGame(cfg: GameConfig): GameState {
  const props: Record<number, Property> = {};
  for (const c of BOARD) {
    if (c.price) props[c.index] = { owner: null, level: 0, branch: null, mortgaged: false, invested: 0, construction: null, fastBonus: false };
  }
  const s: GameState = {
    cfg,
    players: cfg.players.map((p, id) => ({
      ...p, id, money: cfg.startMoney ?? START_MONEY, pos: 0, bankrupt: false, inCasino: false,
      skipNext: false, energy: ENERGY_PER_ROUND, doubles: 0, casinoWinnings: 0,
    })),
    props, current: 0, round: 1, phase: "roll", pending: null, casinoBets: 0, lastDice: [1, 1],
    jackpot: 0, market: null, rng: cfg.seed ?? Math.floor(Math.random() * 2 ** 31), events: [], winner: null, turnCounter: 0,
  };
  if (cfg.length === "quick") { // ускоритель быстрой партии: по случайной клетке каждому
    const free = BOARD.filter((c) => c.kind === "business").map((c) => c.index);
    for (const pl of s.players) {
      const idx = free.splice(randInt(s, free.length), 1)[0];
      s.props[idx].owner = pl.id;
    }
  }
  s.events.push({ type: "turn", player: 0, round: 1 });
  return s;
}

// ---------- Вспомогательные расчёты ----------

const cell = (i: number): Cell => BOARD[i];
const emit = (s: GameState, e: GameEvent) => s.events.push(e);
const log = (s: GameState, text: string) => emit(s, { type: "log", text });
export const active = (s: GameState) => s.players.filter((p) => !p.bankrupt);

export function owns(s: GameState, pid: number, idx: number) {
  return s.props[idx]?.owner === pid;
}

export function ownedCount(s: GameState, pid: number, ind: IndustryId) {
  return industryCells(ind).filter((i) => owns(s, pid, i)).length;
}

export function hasMonopoly(s: GameState, pid: number, ind: IndustryId) {
  return industryCells(ind).every((i) => owns(s, pid, i));
}

function hasSpecial(s: GameState, pid: number, ind: IndustryId) {
  return industryCells(ind).some((i) => owns(s, pid, i) && s.props[i].branch === "special" && s.props[i].level >= 1);
}

const portsOwned = (s: GameState, pid: number) => PORT_INDICES.filter((i) => owns(s, pid, i)).length;

export function buildCost(s: GameState, pid: number, idx: number, level: number): number {
  let c = (cell(idx).price ?? 0) * BUILD_COST[level - 1];
  if (hasSpecial(s, pid, "forest")) c *= 0.85;
  if (s.market?.buildCost) c *= s.market.buildCost;
  return Math.round(c);
}

function speedFor(s: GameState, pid: number, idx: number, rush: boolean) {
  let sp = rush ? 2 : 1;
  if (s.cfg.length === "quick") sp *= 1.25;
  if (hasSpecial(s, pid, "finance")) sp *= 1.2;
  if ([12, 28].some((i) => owns(s, pid, i))) sp *= 1.15;
  const ind = cell(idx).industry;
  if (ind && s.market?.slow?.includes(ind)) sp *= 0.5;
  return sp;
}

function rentAtLevel(s: GameState, idx: number, level: number): number {
  const c = cell(idx), p = s.props[idx];
  const ind = c.industry!;
  let r = c.baseRent!;
  if (level === 0) {
    if (hasMonopoly(s, p.owner!, ind)) r *= 2;
  } else {
    r *= BRANCH_MULT[p.branch!][level - 1];
  }
  if (ind === "oil" && hasSpecial(s, p.owner!, "oil")) {
    const others = industryCells("oil").filter((i) => i !== idx && owns(s, p.owner!, i)).length;
    r *= 1 + 0.25 * others;
  }
  return r;
}

export function rentFor(s: GameState, idx: number, diceSum = 7): number {
  const c = cell(idx), p = s.props[idx];
  if (!p || p.owner === null || p.mortgaged) return 0;
  let r: number;
  if (c.kind === "transport") {
    const n = [5, 15, 25, 35].filter((i) => owns(s, p.owner!, i)).length;
    r = TRANSPORT_RENT[n - 1] * (s.market?.rent.transport ?? 1);
  } else if (c.kind === "energy") {
    const both = owns(s, p.owner!, 12) && owns(s, p.owner!, 28);
    r = diceSum * (both ? 10 : 4);
  } else {
    r = p.construction ? rentAtLevel(s, idx, p.level) * 0.5 : rentAtLevel(s, idx, p.level);
    r *= s.market?.rent[c.industry!] ?? 1;
    if (p.fastBonus) r *= 1.2;
  }
  return Math.round(r);
}

export function capital(s: GameState, pid: number): number {
  const pl = s.players[pid];
  if (pl.bankrupt) return 0;
  let v = pl.money;
  for (const [i, p] of Object.entries(s.props)) {
    if (p.owner !== pid) continue;
    v += (cell(+i).price ?? 0) * (p.mortgaged ? 0.5 : 1) + p.invested;
  }
  return Math.round(v);
}

export function canBuild(s: GameState, pid: number, idx: number): { ok: boolean; reason?: string; cost?: number; level?: number } {
  const c = cell(idx), p = s.props[idx];
  if (!p || c.kind !== "business") return { ok: false, reason: "Здесь нельзя строить" };
  if (p.owner !== pid) return { ok: false, reason: "Клетка не ваша" };
  if (p.mortgaged) return { ok: false, reason: "Клетка в залоге" };
  if (p.construction) return { ok: false, reason: "Стройка уже идёт" };
  if (p.level >= 3) return { ok: false, reason: "Максимальный уровень" };
  const level = p.level + 1;
  const running = Object.values(s.props).filter((q) => q.owner === pid && q.construction).length;
  if (running >= MAX_CONSTRUCTIONS) return { ok: false, reason: "Не больше 3 строек одновременно" };
  if (level === 2 && ownedCount(s, pid, c.industry!) < 2) return { ok: false, reason: "Нужно 2 клетки отрасли" };
  if (level === 3 && !hasMonopoly(s, pid, c.industry!)) return { ok: false, reason: "Нужна монополия отрасли" };
  const cost = buildCost(s, pid, idx, level);
  if (s.players[pid].money < cost) return { ok: false, reason: "Не хватает денег", cost, level };
  return { ok: true, cost, level };
}

/** «Слияние»: выкуп последней недостающей клетки отрасли у соперника за двойную цену. */
export function canTakeover(s: GameState, pid: number, idx: number): { ok: boolean; reason?: string; cost?: number } {
  const c = cell(idx), p = s.props[idx];
  if (!p || c.kind !== "business") return { ok: false, reason: "Только для бизнесов" };
  if (p.owner === null || p.owner === pid) return { ok: false, reason: "Клетка не у соперника" };
  if (p.level > 0 || p.construction || p.mortgaged) return { ok: false, reason: "На клетке уже стройка или залог" };
  const others = industryCells(c.industry!).filter((i) => i !== idx);
  if (!others.every((i) => owns(s, pid, i))) return { ok: false, reason: "Нужны все остальные клетки отрасли" };
  const cost = c.price! * 2;
  if (s.players[pid].money < cost) return { ok: false, reason: "Не хватает денег", cost };
  return { ok: true, cost };
}

// ---------- Деньги и банкротство ----------

function give(s: GameState, pid: number, amount: number, reason: string) {
  if (amount === 0) return;
  s.players[pid].money += amount;
  emit(s, { type: "money", player: pid, delta: amount, reason });
}

/** Списывает деньги; при нехватке закладывает имущество, при полной нехватке — банкротство. */
function charge(s: GameState, pid: number, amount: number, creditor: number | null, reason: string): boolean {
  const pl = s.players[pid];
  amount = Math.round(amount);
  if (pl.money < amount) raiseFunds(s, pid, amount);
  if (pl.money >= amount) {
    give(s, pid, -amount, reason);
    if (creditor !== null) give(s, creditor, amount, reason);
    return true;
  }
  bankrupt(s, pid, creditor);
  return false;
}

function raiseFunds(s: GameState, pid: number, need: number) {
  const pl = s.players[pid];
  const mine = Object.entries(s.props).filter(([, p]) => p.owner === pid).map(([i, p]) => ({ i: +i, p }));
  for (const { i, p } of mine) { // отменяем стройки — без возврата
    if (pl.money >= need) return;
    if (p.construction) { p.construction = null; log(s, `${pl.name}: стройка в «${cell(i).name}» остановлена`); }
  }
  for (const { i } of mine.filter((x) => x.p.level === 0 && !x.p.mortgaged)) {
    if (pl.money >= need) return;
    mortgage(s, pid, i);
  }
  for (const { i, p } of mine.sort((a, b) => b.p.level - a.p.level)) {
    while (pl.money < need && p.level > 0) {
      const refund = Math.round(p.invested / p.level / 2);
      p.invested -= Math.round(p.invested / p.level);
      p.level -= 1;
      if (p.level === 0) { p.branch = null; p.invested = 0; }
      give(s, pid, refund, `снос уровня в «${cell(i).name}»`);
    }
    if (pl.money >= need) return;
    if (!p.mortgaged) mortgage(s, pid, i);
  }
}

function mortgage(s: GameState, pid: number, idx: number) {
  const p = s.props[idx];
  p.mortgaged = true;
  give(s, pid, Math.round((cell(idx).price ?? 0) * 0.5), `залог «${cell(idx).name}»`);
}

function bankrupt(s: GameState, pid: number, creditor: number | null) {
  const pl = s.players[pid];
  if (creditor !== null && pl.money > 0) give(s, creditor, pl.money, `имущество ${pl.name}`);
  pl.money = 0;
  pl.bankrupt = true;
  for (const p of Object.values(s.props)) {
    if (p.owner !== pid) continue;
    p.construction = null;
    if (creditor !== null) p.owner = creditor;
    else Object.assign(p, { owner: null, level: 0, branch: null, mortgaged: false, invested: 0, fastBonus: false });
  }
  emit(s, { type: "bankrupt", player: pid, creditor });
  log(s, `${pl.name} — банкрот`);
  if (active(s).length <= 1) finish(s);
  else if (pid === s.current) { s.pending = null; nextTurn(s); }
}

function finish(s: GameState) {
  const alive = active(s);
  const winner = alive.reduce((a, b) => (capital(s, b.id) > capital(s, a.id) ? b : a), alive[0]);
  s.winner = winner.id;
  s.phase = "gameover";
  emit(s, { type: "gameover", winner: winner.id });
}

// ---------- Ход ----------

function startTurn(s: GameState) {
  const pl = s.players[s.current];
  pl.energy = ENERGY_PER_ROUND;
  pl.doubles = 0;
  s.pending = null;
  s.casinoBets = 0;
  emit(s, { type: "turn", player: pl.id, round: s.round });
  // Доход веток «Доход», экспорта зерна и СПГ.
  let income = 0;
  for (const [i, p] of Object.entries(s.props)) {
    if (p.owner !== pl.id || p.mortgaged || p.level === 0) continue;
    const c = cell(+i);
    if (p.branch === "income") income += (c.price ?? 0) * INCOME_SHARE[p.level - 1] * (s.market?.rent[c.industry!] ?? 1);
    if (p.branch === "special" && c.industry === "agro") income += 20 * portsOwned(s, pl.id) * p.level;
    if (p.branch === "special" && c.industry === "gas") income += (c.price ?? 0) * 0.08 * (portsOwned(s, pl.id) ? 2 : 1);
  }
  if (income > 0) give(s, pl.id, Math.round(income), "доход предприятий");
  if (pl.skipNext) {
    pl.skipNext = false;
    log(s, `${pl.name} пропускает ход`);
    s.phase = "end";
    return;
  }
  s.phase = pl.inCasino ? "casinoExit" : "roll";
}

function nextTurn(s: GameState) {
  const n = s.players.length;
  let next = s.current;
  let wrapped = false;
  do {
    next = (next + 1) % n;
    if (next <= s.current && !wrapped) { // новый круг
      wrapped = true;
      s.round += 1;
      if (s.market) { s.market.roundsLeft -= 1; if (s.market.roundsLeft <= 0) s.market = null; }
      if (s.round % 3 === 0 && !s.market) {
        const ev = MARKET_EVENTS[randInt(s, MARKET_EVENTS.length)];
        s.market = { ...ev, roundsLeft: 3 };
        emit(s, { type: "market", title: ev.title });
      }
      const limit = s.cfg.length === "quick" ? s.cfg.quickRounds ?? 15 : s.cfg.classicRounds ?? 50;
      if (s.round > limit) { finish(s); return; }
    }
  } while (s.players[next].bankrupt);
  s.current = next;
  s.turnCounter += 1;
  startTurn(s);
}

function advanceConstructions(s: GameState, endedBy: number) {
  const opponents = active(s).length - 1;
  if (opponents <= 0) return;
  // Боты тратят энергию бригады на свои стройки, пока ходят другие.
  for (const pl of active(s)) {
    if (!pl.bot || pl.id === endedBy || s.cfg.mode === "hotseat") continue;
    const perTurn = { easy: 0, normal: 15, hard: 25 }[pl.difficulty ?? "normal"];
    const sites = Object.entries(s.props).filter(([, p]) => p.owner === pl.id && p.construction);
    for (const [i] of sites) {
      const n = Math.min(pl.energy, Math.ceil(perTurn / sites.length));
      if (n > 0) tap(s, pl.id, +i, n);
    }
  }
  for (const [i, p] of Object.entries(s.props)) {
    if (!p.construction || p.owner === endedBy) continue;
    const c = p.construction;
    c.ticks += 1;
    const step = (100 * speedFor(s, p.owner!, +i, false)) / (BUILD_ROUNDS[c.target - 1] * opponents);
    addProgress(s, +i, step * (c.rush ? 2 : 1));
  }
}

function addProgress(s: GameState, idx: number, amount: number) {
  const p = s.props[idx];
  const c = p.construction;
  if (!c) return;
  const before = c.progress;
  c.progress += amount;
  if (c.rush && !c.accidentChecked && before < 50 && c.progress >= 50) {
    c.accidentChecked = true;
    if (!c.insured && rand(s) < 0.2) {
      c.progress -= 50;
      emit(s, { type: "accident", player: p.owner!, cell: idx });
      log(s, `Авария на стройке «${cell(idx).name}»! Прогресс −50%`);
    }
  }
  if (c.progress >= 99.999) {
    p.level = c.target;
    p.construction = null;
    const fast = c.ticks < c.nominalTicks;
    p.fastBonus = fast;
    emit(s, { type: "buildDone", player: p.owner!, cell: idx, level: p.level, fast });
    log(s, `«${cell(idx).name}»: построен уровень ${p.level}${fast ? " — успел! +20% к первой аренде" : ""}`);
  }
}

function tap(s: GameState, pid: number, idx: number, n: number) {
  const pl = s.players[pid];
  const k = Math.min(n, pl.energy);
  if (k <= 0) return 0;
  pl.energy -= k;
  addProgress(s, idx, k);
  return k;
}

function moveBy(s: GameState, pid: number, steps: number) {
  const pl = s.players[pid];
  const path: number[] = [];
  for (let k = 1; k <= steps; k++) {
    const nxt = (pl.pos + k) % 40;
    path.push(nxt);
    if (nxt === 0 && k < steps) give(s, pid, PASS_START, "круг через Старт");
  }
  pl.pos = (pl.pos + steps) % 40;
  emit(s, { type: "move", player: pid, path });
}

function teleport(s: GameState, pid: number, to: number, passStart: boolean) {
  const pl = s.players[pid];
  if (passStart && to < pl.pos && to !== 0) give(s, pid, PASS_START, "круг через Старт");
  pl.pos = to;
  emit(s, { type: "move", player: pid, path: [to], teleport: true });
}

function sendToCasino(s: GameState, pid: number) {
  const pl = s.players[pid];
  teleport(s, pid, CASINO_INDEX, false);
  pl.inCasino = true;
  pl.doubles = 0;
  s.casinoBets = 0;
  s.phase = "casino";
  log(s, `${pl.name} отправляется в казино`);
}

function land(s: GameState, pid: number, diceSum: number) {
  const pl = s.players[pid];
  const c = cell(pl.pos);
  const p = s.props[c.index];
  switch (c.kind) {
    case "start":
      give(s, pid, LAND_START, "остановка на Старте");
      break;
    case "business": case "transport": case "energy":
      if (p.owner === null) {
        s.pending = { kind: "buy", cell: c.index };
        s.phase = "decide";
        return;
      }
      if (p.owner !== pid && !p.mortgaged && !s.players[p.owner].bankrupt) {
        const amount = rentFor(s, c.index, diceSum);
        if (amount > 0) {
          s.pending = { kind: "rent", cell: c.index, owner: p.owner, amount };
          s.phase = "decide";
          return;
        }
      }
      break;
    case "news": case "gov":
      drawCard(s, pid, c.kind);
      if (s.phase === "casino" || pl.bankrupt) return;
      if (pl.pos !== c.index) { land(s, pid, diceSum); return; }
      break;
    case "tax": {
      const amount = c.tax === "luxury" ? 100 : Math.min(200, Math.round(capital(s, pid) * 0.1));
      if (charge(s, pid, amount, null, c.name)) s.jackpot += Math.round(amount * 0.1);
      break;
    }
    case "casino":
      sendToCasino(s, pid);
      return;
    case "forum":
      give(s, pid, 100, "Экономический форум");
      break;
    case "zagul":
      sendToCasino(s, pid);
      return;
  }
  afterLanding(s, pid);
}

function afterLanding(s: GameState, pid: number) {
  if (s.phase === "gameover" || s.players[pid].bankrupt) return;
  s.pending = null;
  const [a, b] = s.lastDice;
  s.phase = a === b && !s.players[pid].inCasino ? "roll" : "end";
}

// ---------- Аукцион ----------

/** Ставка бота на аукционе: дороже, если клетка двигает его к монополии. */
export function botBid(s: GameState, pid: number, idx: number): number {
  const pl = s.players[pid], c = cell(idx);
  const reserve = { shark: 100, miser: 400, gambler: 150, trader: 250 }[pl.personality ?? "trader"];
  let k = { shark: 0.9, miser: 0.5, gambler: 0.8, trader: 0.7 }[pl.personality ?? "trader"];
  if (c.industry && ownedCount(s, pid, c.industry) > 0) k += 0.4;
  if (c.kind === "transport" && [5, 15, 25, 35].some((i) => owns(s, pid, i))) k += 0.3;
  const bid = Math.min(Math.round((c.price ?? 0) * k), pl.money - reserve / 2);
  return bid >= 10 ? Math.round(bid) : 0;
}

function startAuction(s: GameState, idx: number) {
  const bids: Record<number, number> = {};
  const waiting: number[] = [];
  for (const p of active(s)) {
    if (p.bot) bids[p.id] = botBid(s, p.id, idx);
    else waiting.push(p.id);
  }
  s.pending = { kind: "auction", cell: idx, bids, waiting };
  s.phase = "auction";
  log(s, `Аукцион: «${cell(idx).name}» (цена ${cell(idx).price})`);
  if (!waiting.length) resolveAuction(s);
}

function resolveAuction(s: GameState) {
  const pend = s.pending;
  if (pend?.kind !== "auction") return;
  const order = active(s).map((p) => p.id).sort((a, b) => ((a - s.current + 99) % 99) - ((b - s.current + 99) % 99));
  let best: number | null = null;
  for (const pid of order) {
    const b = pend.bids[pid] ?? 0;
    if (b >= 10 && b <= s.players[pid].money && (best === null || b > pend.bids[best])) best = pid;
  }
  if (best !== null) {
    const amount = pend.bids[best];
    give(s, best, -amount, `аукцион «${cell(pend.cell).name}»`);
    s.props[pend.cell].owner = best;
    emit(s, { type: "buy", player: best, cell: pend.cell });
    log(s, `${s.players[best].name} выигрывает аукцион за ${amount}`);
  } else log(s, "На аукционе ставок нет");
  afterLanding(s, s.current);
}

// ---------- Карточки ----------

type CardFx = (s: GameState, pid: number) => void;
const NEWS: [string, CardFx][] = [
  ["Олигарх потерял яхту в Монако — платите 50", (s, p) => charge(s, p, 50, null, "яхта")],
  ["Ваш завод показали по телевизору — +100", (s, p) => give(s, p, 100, "реклама")],
  ["Срочная командировка во Владивосток", (s, p) => teleport(s, p, 35, true)],
  ["День рождения — каждый игрок дарит вам 20", (s, p) => {
    for (const o of active(s)) if (o.id !== p) charge(s, o.id, 20, p, "подарок");
  }],
  ["Ревизия — 25 за каждый построенный уровень", (s, p) => {
    const lv = Object.values(s.props).filter((q) => q.owner === p).reduce((a, q) => a + q.level, 0);
    if (lv) charge(s, p, 25 * lv, null, "ревизия");
  }],
  ["Загулял в столице — отправляйтесь в казино", (s, p) => sendToCasino(s, p)],
  ["Дивиденды по акциям — +150", (s, p) => give(s, p, 150, "дивиденды")],
  ["Штраф за парковку лимузина — 30", (s, p) => charge(s, p, 30, null, "штраф")],
  ["Деловой визит в Москву", (s, p) => teleport(s, p, 39, true)],
  ["Прогулка на Старт", (s, p) => { teleport(s, p, 0, false); give(s, p, PASS_START, "Старт"); }],
];
const GOV: [string, CardFx][] = [
  ["Госконтракт на поставки — +200", (s, p) => give(s, p, 200, "госконтракт")],
  ["Налоговый вычет — +50", (s, p) => give(s, p, 50, "вычет")],
  ["Субсидия на стройку: +50% прогресса вашей стройке", (s, p) => {
    const site = Object.entries(s.props).find(([, q]) => q.owner === p && q.construction);
    if (site) addProgress(s, +site[0], 50); else give(s, p, 50, "субсидия");
  }],
  ["Грант Фонда развития — +100", (s, p) => give(s, p, 100, "грант")],
  ["Сбор на благотворительность — 50", (s, p) => charge(s, p, 50, null, "благотворительность")],
  ["Бригада гастарбайтеров: +30 энергии бригады", (s, p) => { s.players[p].energy += 30; }],
  ["Выигрыш в лотерею — +75", (s, p) => give(s, p, 75, "лотерея")],
  ["Аудит — 40", (s, p) => charge(s, p, 40, null, "аудит")],
];

function drawCard(s: GameState, pid: number, deck: "news" | "gov") {
  const list = deck === "news" ? NEWS : GOV;
  const [text, fx] = list[randInt(s, list.length)];
  emit(s, { type: "card", player: pid, deck, text });
  log(s, `${deck === "news" ? "Новости" : "Госзаказ"}: ${text}`);
  fx(s, pid);
}

// ---------- Казино ----------

function maxBet(s: GameState, pid: number) {
  return Math.max(10, Math.floor(s.players[pid].money * 0.2));
}

function settleBet(s: GameState, pid: number, amount: number, payout: number, game: string, detail: string) {
  const pl = s.players[pid];
  pl.money -= amount;
  const win = Math.round(payout);
  pl.money += win;
  pl.casinoWinnings += win - amount;
  if (win === 0) s.jackpot += Math.round(amount * 0.1);
  emit(s, { type: "casino", player: pid, game, win: win - amount, detail });
  emit(s, { type: "money", player: pid, delta: win - amount, reason: game });
  s.casinoBets += 1;
}

// ---------- Действия ----------

export function act(s: GameState, pid: number, a: Action): Result {
  if (s.phase === "gameover") return { ok: false, error: "Игра окончена" };
  const pl = s.players[pid];
  if (!pl || pl.bankrupt) return { ok: false, error: "Игрок выбыл" };
  const mine = pid === s.current;

  if (a.t === "bid") {
    const pend = s.pending;
    if (s.phase !== "auction" || pend?.kind !== "auction" || !pend.waiting.includes(pid)) return { ok: false, error: "Сейчас нет вашей ставки" };
    const amount = Math.max(0, Math.round(a.amount));
    if (amount > pl.money) return { ok: false, error: "Ставка больше ваших денег" };
    pend.bids[pid] = amount;
    pend.waiting = pend.waiting.filter((x) => x !== pid);
    if (!pend.waiting.length) resolveAuction(s);
    return { ok: true };
  }
  if (a.t === "tap") {
    if (mine) return { ok: false, error: "Тапать можно только во время чужого хода" };
    if (s.cfg.mode === "hotseat") return { ok: false, error: "На одном телефоне тапов нет" };
    const p = s.props[a.cell];
    if (!p || p.owner !== pid || !p.construction) return { ok: false, error: "Здесь нет вашей стройки" };
    if (pl.energy <= 0) return { ok: false, error: "Бригада устала" };
    tap(s, pid, a.cell, a.n ?? 1);
    return { ok: true };
  }
  if (!mine) return { ok: false, error: "Сейчас не ваш ход" };

  switch (a.t) {
    case "roll": {
      if (s.phase !== "roll") return { ok: false, error: "Сейчас нельзя бросать" };
      const [d1, d2] = s.forcedDice?.shift() ?? [1 + randInt(s, 6), 1 + randInt(s, 6)];
      s.lastDice = [d1, d2];
      emit(s, { type: "dice", player: pid, a: d1, b: d2 });
      if (d1 === d2) {
        pl.doubles += 1;
        if (pl.doubles >= 3) { log(s, `${pl.name}: третий дубль подряд`); sendToCasino(s, pid); return { ok: true }; }
      }
      moveBy(s, pid, d1 + d2);
      land(s, pid, d1 + d2);
      return { ok: true };
    }
    case "buy": {
      if (s.pending?.kind !== "buy") return { ok: false, error: "Нечего покупать" };
      const idx = s.pending.cell, price = cell(idx).price!;
      if (pl.money < price) return { ok: false, error: "Не хватает денег" };
      give(s, pid, -price, `покупка «${cell(idx).name}»`);
      s.props[idx].owner = pid;
      emit(s, { type: "buy", player: pid, cell: idx });
      log(s, `${pl.name} покупает «${cell(idx).name}» за ${price}`);
      afterLanding(s, pid);
      return { ok: true };
    }
    case "decline":
      if (s.pending?.kind !== "buy") return { ok: false, error: "Нечего отклонять" };
      startAuction(s, s.pending.cell);
      return { ok: true };
    case "payRent": case "workOff": {
      if (s.pending?.kind !== "rent") return { ok: false, error: "Аренды нет" };
      const { cell: idx, owner, amount } = s.pending;
      const p = s.props[idx];
      if (a.t === "payRent") {
        charge(s, pid, amount, owner, `аренда «${cell(idx).name}»`);
        p.fastBonus = false;
        log(s, `${pl.name} платит аренду ${amount} → ${s.players[owner].name}`);
      } else {
        give(s, owner, Math.round(amount * 0.3), `отработка в «${cell(idx).name}»`);
        if (p.construction) addProgress(s, idx, 20);
        pl.skipNext = true;
        log(s, `${pl.name} отрабатывает аренду и пропустит ход`);
      }
      if (cell(idx).industry === "tourism" && p.branch === "special" && p.level >= 1 && !pl.bankrupt) {
        pl.skipNext = true;
        log(s, `${pl.name} застрял в аквапарке и пропустит ход`);
      }
      afterLanding(s, pid);
      return { ok: true };
    }
    case "build": {
      if (s.phase !== "roll" && s.phase !== "end") return { ok: false, error: "Строить можно до броска или в конце хода" };
      const chk = canBuild(s, pid, a.cell);
      if (!chk.ok) return { ok: false, error: chk.reason };
      const p = s.props[a.cell];
      if (chk.level === 1) {
        if (!a.branch) return { ok: false, error: "Выберите ветку" };
        p.branch = a.branch;
      }
      const cost = chk.cost!;
      const extra = a.insure ? Math.round(cost * 0.1) : 0;
      if (pl.money < cost + extra) return { ok: false, error: "Не хватает денег на страховку" };
      give(s, pid, -(cost + extra), `стройка «${cell(a.cell).name}»`);
      p.invested += cost;
      for (const o of active(s)) {
        if (o.id !== pid && hasSpecial(s, o.id, "metal")) give(s, o.id, Math.round(cost * 0.05), "поставка стали");
      }
      const opp = Math.max(1, active(s).length - 1);
      const nominal = Math.ceil((BUILD_ROUNDS[chk.level! - 1] * opp) / (a.rush ? 2 : 1));
      p.construction = { target: chk.level!, progress: 0, rush: !!a.rush, insured: !!a.insure, accidentChecked: false, ticks: 0, nominalTicks: nominal };
      emit(s, { type: "buildStart", player: pid, cell: a.cell, level: chk.level! });
      log(s, `${pl.name} начинает стройку уровня ${chk.level} в «${cell(a.cell).name}» за ${cost}`);
      return { ok: true };
    }
    case "takeover": {
      if (s.phase !== "roll" && s.phase !== "end") return { ok: false, error: "Слияние — до броска или в конце хода" };
      const chk = canTakeover(s, pid, a.cell);
      if (!chk.ok) return { ok: false, error: chk.reason };
      const prev = s.props[a.cell].owner!;
      give(s, pid, -chk.cost!, `слияние «${cell(a.cell).name}»`);
      give(s, prev, chk.cost!, `продажа «${cell(a.cell).name}»`);
      s.props[a.cell].owner = pid;
      emit(s, { type: "buy", player: pid, cell: a.cell });
      log(s, `${pl.name} выкупает «${cell(a.cell).name}» у ${s.players[prev].name} за ${chk.cost} — монополия!`);
      return { ok: true };
    }
    case "overtime": {
      const p = s.props[a.cell];
      if (!p || p.owner !== pid || !p.construction) return { ok: false, error: "Здесь нет вашей стройки" };
      const cost = Math.round(buildCost(s, pid, a.cell, p.construction.target) * 0.1);
      if (pl.money < cost) return { ok: false, error: "Не хватает денег" };
      give(s, pid, -cost, "сверхурочные");
      addProgress(s, a.cell, 25);
      return { ok: true };
    }
    case "mortgage": {
      const p = s.props[a.cell];
      if (!p || p.owner !== pid || p.mortgaged) return { ok: false, error: "Нельзя заложить" };
      if (p.level > 0 || p.construction) return { ok: false, error: "Сначала снесите постройки" };
      mortgage(s, pid, a.cell);
      return { ok: true };
    }
    case "unmortgage": {
      const p = s.props[a.cell];
      if (!p || p.owner !== pid || !p.mortgaged) return { ok: false, error: "Клетка не в залоге" };
      const cost = Math.round((cell(a.cell).price ?? 0) * 0.6);
      if (pl.money < cost) return { ok: false, error: "Не хватает денег" };
      give(s, pid, -cost, `выкуп «${cell(a.cell).name}»`);
      p.mortgaged = false;
      return { ok: true };
    }
    case "roulette": case "slots": {
      if (s.phase !== "casino") return { ok: false, error: "Вы не в казино" };
      if (s.casinoBets >= 3) return { ok: false, error: "Не больше 3 ставок" };
      const amount = Math.round(a.amount);
      if (amount < 10 || amount > maxBet(s, pid) || amount > pl.money) return { ok: false, error: `Ставка от 10 до ${maxBet(s, pid)}` };
      if (a.t === "roulette") {
        const n = randInt(s, 37);
        const red = RED_NUMBERS.has(n);
        let payout = 0;
        if (typeof a.choice === "number") payout = n === a.choice ? amount * 36 : 0;
        else if (n !== 0) {
          const hit = (a.choice === "red" && red) || (a.choice === "black" && !red) ||
            (a.choice === "even" && n % 2 === 0) || (a.choice === "odd" && n % 2 === 1);
          payout = hit ? amount * 2 : 0;
        }
        settleBet(s, pid, amount, payout, "Рулетка", `Выпало ${n}${n === 0 ? " (зеро)" : red ? " красное" : " чёрное"}`);
      } else {
        const r = [randInt(s, 6), randInt(s, 6), randInt(s, 6)];
        let payout = 0;
        if (r[0] === r[1] && r[1] === r[2]) {
          if (r[0] === 5) {
            payout = amount * 10 + s.jackpot;
            emit(s, { type: "jackpot", player: pid, amount: s.jackpot });
            log(s, `ДЖЕКПОТ! ${pl.name} срывает ${s.jackpot}`);
            s.jackpot = 0;
          } else payout = amount * 10;
        } else if (r[0] === r[1] || r[1] === r[2] || r[0] === r[2]) payout = amount * 1.6;
        settleBet(s, pid, amount, payout, "Слоты", r.map((k) => SLOT_SYMBOLS[k]).join(" · "));
      }
      return { ok: true };
    }
    case "leaveCasino":
      if (s.phase !== "casino") return { ok: false, error: "Вы не в казино" };
      s.phase = "end";
      return { ok: true };
    case "payExit": case "rollDouble": case "stay": {
      if (s.phase !== "casinoExit") return { ok: false, error: "Сейчас не выход из казино" };
      if (a.t === "stay") { pl.inCasino = false; log(s, `${pl.name} отдыхает в казино`); s.phase = "end"; return { ok: true }; }
      if (a.t === "payExit") {
        if (pl.money < 50) return { ok: false, error: "Не хватает 50" };
        give(s, pid, -50, "выход из казино");
        pl.inCasino = false;
        s.phase = "roll";
        return { ok: true };
      }
      const [d1, d2] = s.forcedDice?.shift() ?? [1 + randInt(s, 6), 1 + randInt(s, 6)];
      s.lastDice = [d1, d2];
      emit(s, { type: "dice", player: pid, a: d1, b: d2 });
      pl.inCasino = false;
      if (d1 === d2) {
        s.lastDice = [d1, d2 + 0.5] as [number, number]; // дубль из казино не даёт второго броска
        moveBy(s, pid, d1 + d2);
        land(s, pid, d1 + d2);
      } else {
        log(s, `${pl.name} не выбросил дубль`);
        s.phase = "end";
      }
      return { ok: true };
    }
    case "endTurn": {
      if (s.phase !== "end") return { ok: false, error: "Сначала завершите действие" };
      advanceConstructions(s, pid);
      nextTurn(s);
      return { ok: true };
    }
  }
  return { ok: false, error: "Неизвестное действие" };
}

export function drainEvents(s: GameState): GameEvent[] {
  const ev = s.events;
  s.events = [];
  return ev;
}
