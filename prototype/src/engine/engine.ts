// Ядро правил «Олигарха». Без графики: состояние + действия + события для анимации.
import { BOARD, BranchId, CASINO_INDEX, Cell, IndustryId, PORT_INDICES, industryCells } from "./board";

// ---------- Типы ----------

export type Personality = "shark" | "miser" | "gambler" | "trader";
export type Difficulty = "easy" | "normal" | "hard";
/** solo — один человек и боты; hotseat — несколько людей на одном телефоне; network — каждый на своём телефоне. */
export type Mode = "solo" | "hotseat" | "network";
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
  /** Раздать каждому по случайному предприятию на старте (ускоряет партию). */
  startCompanies?: boolean;
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
  /** Ставки в «казино ожидания» за этот круг (пока ходят другие). */
  loungeBets: number;
  /** Сделки с акциями за текущий ход (ограничение для ботов). */
  trades: number;
  /** Идущая раздача блэкджека. */
  bj: Blackjack | null;
  /** Ставка тотализатора на сумму следующего броска. */
  tote: { choice: ToteChoice; amount: number } | null;
  /** Кредиты банка под залог компании или акций. */
  loans: Loan[];
  /** Вклад в банке под процент. */
  deposit: number;
  /** Роскошь: машины, особняк, яхта, картины. */
  lux: LuxItem[];
  /** Временные эффекты: вечеринка, отдых, подарки семье. */
  buffs: Buff[];
  /** Семейная заначка: подарки семье возвращаются, когда совсем туго. */
  stash: number;
  /** Сообщения от банка и биржи (звонки, которые можно посмотреть позже). */
  inbox?: Message[];
}

export type Caller = "bank" | "exchange";
export interface Message { id: number; from: Caller; text: string; round: number; offer?: number; read?: boolean }

export type LuxKind = "car" | "mansion" | "yacht" | "painting";
export type ExpKind = "party" | "vacation" | "gifts";
export interface LuxItem { id: number; kind: LuxKind; value: number; paid: number }
export interface Buff { kind: ExpKind; rounds: number; fame: number }
export type AdKind = "flyers" | "tv";
export interface Ad { kind: AdKind; rounds: number }

/** Кредит: залог — своя компания (company) или свои акции чужой компании (shares). */
export interface Loan { id: number; kind: "company" | "shares"; cell: number; amount: number; due: number }
export interface CoopPart { pid: number; lots: number }

export type ToteChoice = "low" | "seven" | "high";
export interface Blackjack { bet: number; player: number[]; dealer: number[]; lounge: boolean }
export interface Listing { seller: number; lots: number }
/** sell — from продаёт to; bid — from хочет купить у to. whole — выкуп всей компании (price — общая сумма), иначе price — за 10%. */
export interface Offer { id: number; kind: "sell" | "bid"; from: number; to: number; cell: number; lots: number; price: number; whole?: boolean }

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
  /** Доли других игроков: id → число лотов по 10%. */
  holders: Record<number, number>;
  /** Лоты, выставленные на биржу. */
  listings: Listing[];
  /** Спрос на акции: множитель цены (1 — норма). */
  demand: number;
  /** Идущая рекламная кампания. */
  ad: Ad | null;
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
  | { kind: "auction"; cell: number; bids: Record<number, number>; waiting: number[]; bank?: BankSale };

/** Банк продаёт залог просроченного кредита: компанию целиком или акции по 10%. */
export interface BankSale { debtor: number; kind: "company" | "shares"; cell: number; debt: number; lots: number }

export type Phase = "roll" | "decide" | "auction" | "casino" | "casinoExit" | "end" | "gameover";

export interface CasinoData { n?: number; reels?: number[]; player?: number[]; dealer?: number[]; done?: boolean; sum?: number }

export type GameEvent =
  | { type: "dice"; player: number; a: number; b: number }
  | { type: "move"; player: number; path: number[]; teleport?: boolean }
  | { type: "money"; player: number; delta: number; reason: string }
  | { type: "buy"; player: number; cell: number }
  | { type: "buildStart"; player: number; cell: number; level: number }
  | { type: "buildDone"; player: number; cell: number; level: number; fast: boolean }
  | { type: "accident"; player: number; cell: number }
  | { type: "card"; player: number; deck: "news" | "gov"; text: string }
  | { type: "casino"; player: number; game: string; win: number; detail: string; data?: CasinoData }
  | { type: "stock"; text: string; players: number[] }
  | { type: "jackpot"; player: number; amount: number }
  | { type: "market"; title: string }
  | { type: "bankrupt"; player: number; creditor: number | null }
  | { type: "turn"; player: number; round: number }
  | { type: "log"; text: string }
  | { type: "lux"; player: number; kind: LuxKind | ExpKind; text: string }
  | { type: "ad"; player: number; cell: number; kind: AdKind }
  | { type: "call"; player: number; from: Caller; text: string; msg: number; offer?: number }
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
  offers: Offer[];
  nextOfferId: number;
  nextLoanId: number;
  nextLuxId: number;
  nextMsgId?: number;
  /** Своя клетка, на которой игрок стоит в этот ход: строить можно только на ней. */
  landedOwn?: number | null;
  /** В этот ход уже строили (строить — один раз за ход). */
  builtThisTurn?: boolean;
  /** Очередь залогов, которые банк выставляет на аукцион. */
  bankQueue?: BankSale[];
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
  | { t: "bjStart"; amount: number }
  | { t: "bjHit" }
  | { t: "bjStand" }
  | { t: "tote"; choice: ToteChoice; amount: number }
  | { t: "lounge"; game: "roulette" | "slots"; choice?: "red" | "black" | "even" | "odd" | number; amount: number }
  | { t: "loungeBj"; amount: number }
  | { t: "listShares"; cell: number; lots: number }
  | { t: "unlistShares"; cell: number }
  | { t: "buyShares"; cell: number; lots: number }
  | { t: "offerShares"; cell: number; lots: number; to: number; price: number }
  | { t: "bidShares"; cell: number; lots: number; price: number }
  | { t: "buyCoop"; partners: CoopPart[] }
  | { t: "takeLoan"; cell: number; kind: "company" | "shares"; amount: number }
  | { t: "repayLoan"; id: number }
  | { t: "demolish"; cell: number; approve?: number[] }
  | { t: "deposit"; amount: number }
  | { t: "withdraw"; amount: number }
  | { t: "buyLux"; kind: LuxKind }
  | { t: "sellLux"; id: number }
  | { t: "experience"; kind: ExpKind }
  | { t: "advertise"; cell: number; kind: AdKind }
  | { t: "bidCompany"; cell: number; price: number }
  | { t: "acceptOffer"; id: number }
  | { t: "declineOffer"; id: number }
  | { t: "leaveCasino" }
  | { t: "payExit" }
  | { t: "rollDouble" }
  | { t: "stay" }
  | { t: "endTurn" };

export interface Result { ok: boolean; error?: string; info?: string }

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
/** Снос при акционерах: нужно больше половины голосов (6 лотов из 10). */
export const MAJORITY_LOTS = 6;
/** Отработка: аренда на 10% меньше, но пропуск следующего хода. */
export const WORKOFF_DISCOUNT = 0.1;
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
    if (c.price) props[c.index] = { owner: null, level: 0, branch: null, mortgaged: false, invested: 0, construction: null, fastBonus: false, holders: {}, listings: [], demand: 1, ad: null };
  }
  const s: GameState = {
    cfg,
    players: cfg.players.map((p, id) => ({
      ...p, id, money: cfg.startMoney ?? START_MONEY, pos: 0, bankrupt: false, inCasino: false,
      skipNext: false, energy: ENERGY_PER_ROUND, doubles: 0, casinoWinnings: 0, loungeBets: 0, trades: 0, bj: null, tote: null, loans: [],
      deposit: 0, lux: [], buffs: [], stash: 0,
    })),
    props, current: 0, round: 1, phase: "roll", pending: null, casinoBets: 0, lastDice: [1, 1],
    jackpot: 0, market: null, offers: [], nextOfferId: 1, nextLoanId: 1, nextLuxId: 1, rng: cfg.seed ?? Math.floor(Math.random() * 2 ** 31), events: [], winner: null, turnCounter: 0,
  };
  if (cfg.startCompanies) { // по желанию: по случайной клетке каждому — партия быстрее разгоняется
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
  c *= 1 - PUBLIC_BUILD_DISCOUNT * soldLots(s.props[idx]); // деньги инвесторов удешевляют стройку
  if (hasBuff(s, pid, "vacation")) c *= 1 - VACATION_BUILD_DISCOUNT; // отдохнул — свежие идеи, жёсткие переговоры с подрядчиками
  return Math.round(c);
}

function speedFor(s: GameState, pid: number, idx: number, rush: boolean) {
  let sp = rush ? 2 : 1;
  if (s.cfg.length === "quick") sp *= 1.25;
  if (hasSpecial(s, pid, "finance")) sp *= 1.2;
  if ([12, 28].some((i) => owns(s, pid, i))) sp *= 1.15;
  const ind = cell(idx).industry;
  if (ind && s.market?.slow?.includes(ind)) sp *= 0.5;
  sp *= 1 + PUBLIC_BUILD_SPEED * soldLots(s.props[idx]);
  if (hasLux(s, pid, "car")) sp *= 1 + CAR_SPEED; // хозяин успевает объехать все стройки
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

export function rentFor(s: GameState, idx: number, diceSum = 7, withAd = true): number {
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
  r *= 1 + PUBLIC_RENT_BONUS * soldLots(p); // публичная компания известнее — аренда выше
  r *= 1 + FAME_RENT * fame(s, p.owner); // статус владельца: к нему идут охотнее
  if (withAd && p.ad) r *= 1 + AD[p.ad.kind].rent;
  return Math.round(r);
}

export function capital(s: GameState, pid: number): number {
  const pl = s.players[pid];
  if (pl.bankrupt) return 0;
  let v = pl.money;
  for (const [i, p] of Object.entries(s.props)) {
    if (p.owner === pid) v += companyValue(s, +i) * ownerLots(p) / 10;
    else if (p.holders[pid]) v += p.holders[pid] * lotPrice(s, +i);
  }
  v -= pl.loans.reduce((a, l) => a + l.amount, 0);
  v += pl.deposit + pl.stash + pl.lux.reduce((a, l) => a + l.value, 0); // заначка семьи — тоже капитал
  return Math.round(v);
}

// ---------- Биржа ----------

export const LOTS = 10; // компания делится на 10 лотов по 10%
/** Выгоды публичной компании за каждые 10% у акционеров. */
export const PUBLIC_RENT_BONUS = 0.05;
export const PUBLIC_BUILD_DISCOUNT = 0.05;
export const PUBLIC_BUILD_SPEED = 0.1;
/** С 20% у акционеров компанию нельзя забрать «Слиянием». */
export const PUBLIC_PROTECT_LOTS = 2;
export const OWNER_MIN_LOTS = 6; // владелец всегда держит не меньше 60%

/** Стоимость компании: цена клетки и вложения × спрос на акции × рыночное событие. */
export function companyValue(s: GameState, idx: number): number {
  const c = cell(idx), p = s.props[idx];
  const mk = c.kind === "transport" ? s.market?.rent.transport ?? 1 : c.industry ? s.market?.rent[c.industry] ?? 1 : 1;
  const base = (c.price ?? 0) * (p.mortgaged ? 0.5 : 1) + p.invested;
  return Math.round(base * p.demand * Math.sqrt(mk));
}
export const lotPrice = (s: GameState, idx: number) => Math.max(1, Math.round(companyValue(s, idx) / LOTS));
export const soldLots = (p: Property) => Object.values(p.holders).reduce((a, b) => a + b, 0);
export const ownerLots = (p: Property) => LOTS - soldLots(p);
const listedBy = (p: Property, pid: number) => p.listings.filter((l) => l.seller === pid).reduce((a, l) => a + l.lots, 0);

/** Сколько лотов игрок может продать или предложить. */
export function freeLots(s: GameState, pid: number, idx: number): number {
  const p = s.props[idx];
  if (!p || p.owner === null) return 0;
  if (p.owner === pid) return Math.max(0, ownerLots(p) - OWNER_MIN_LOTS - listedBy(p, pid));
  if (s.players[pid].loans.some((l) => l.kind === "shares" && l.cell === idx)) return 0; // акции в залоге
  return Math.max(0, (p.holders[pid] ?? 0) - listedBy(p, pid));
}

/** Акции продаются у бизнесов, транспорта и энергетики, у которых есть владелец. */
export const tradable = (s: GameState, idx: number) => !!s.props[idx] && s.props[idx].owner !== null;

function clampDemand(p: Property) { p.demand = Math.min(3, Math.max(0.4, p.demand)); }

/** Передаёт один лот от продавца покупателю (владелец как продавец — выпуск новой доли). */
function moveLot(p: Property, from: number, to: number) {
  if (from !== p.owner) { p.holders[from] -= 1; if (p.holders[from] <= 0) delete p.holders[from]; }
  if (to !== p.owner) p.holders[to] = (p.holders[to] ?? 0) + 1;
}

/** Делит деньги, только что полученные владельцем, между акционерами по долям. */
function shareOut(s: GameState, idx: number, amount: number, what: string) {
  const p = s.props[idx];
  if (p.owner === null || amount <= 0) return;
  for (const [h, lots] of Object.entries(p.holders)) {
    const hid = +h;
    if (s.players[hid].bankrupt) continue;
    const part = Math.round((amount * lots) / LOTS);
    if (part <= 0) continue;
    give(s, p.owner, -part, `дивиденды «${cell(idx).name}»`);
    give(s, hid, part, `дивиденды «${cell(idx).name}» (${lots * 10}%)`);
  }
  void what;
}

/** Звонок человеку от банка или биржи: сообщение ложится во «Входящие». Ботам не звонят. */
function call(s: GameState, pid: number, from: Caller, text: string, offer?: number) {
  const pl = s.players[pid];
  if (!pl || pl.bot || pl.bankrupt) return;
  const id = s.nextMsgId = (s.nextMsgId ?? 1) + 1;
  pl.inbox = [...(pl.inbox ?? []), { id, from, text, round: s.round, offer }].slice(-40);
  emit(s, { type: "call", player: pid, from, text, msg: id, offer });
}

function stockEvent(s: GameState, text: string, players: number[]) {
  emit(s, { type: "stock", text, players });
  log(s, text);
}

/** Смена владельца компании: доля нового владельца, если была, сливается с его основной. */
function transferCompany(s: GameState, idx: number, to: number | null) {
  const p = s.props[idx];
  p.listings = p.listings.filter((l) => l.seller !== p.owner);
  p.owner = to;
  if (to === null) { p.holders = {}; p.listings = []; p.demand = 1; return; }
  if (p.holders[to]) { p.listings = p.listings.filter((l) => l.seller !== to); delete p.holders[to]; }
  s.offers = s.offers.filter((o) => o.cell !== idx);
}

function buyLots(s: GameState, buyer: number, idx: number, lots: number): number {
  const p = s.props[idx];
  let bought = 0;
  while (bought < lots) {
    const l = p.listings.find((x) => x.seller !== buyer);
    if (!l) break;
    const price = lotPrice(s, idx);
    if (s.players[buyer].money < price) break;
    give(s, buyer, -price, `акции «${cell(idx).name}»`);
    give(s, l.seller, price, `продажа акций «${cell(idx).name}»`);
    moveLot(p, l.seller, buyer);
    l.lots -= 1;
    if (l.lots <= 0) p.listings.splice(p.listings.indexOf(l), 1);
    p.demand *= 1.06;
    clampDemand(p);
    bought++;
  }
  return bought;
}

/** Исполняет прямую сделку: покупатель платит продавцу, лоты (или вся компания) переходят. */
function executeOffer(s: GameState, o: Offer): boolean {
  const p = s.props[o.cell];
  const seller = o.kind === "sell" ? o.from : o.to, buyer = o.kind === "sell" ? o.to : o.from;
  const name = cell(o.cell).name;
  if (o.whole) {
    if (p.owner !== seller || s.players[buyer].money < o.price) return false;
    if (s.players[seller].loans.some((l) => l.kind === "company" && l.cell === o.cell)) return false; // компания в залоге у банка
    give(s, buyer, -o.price, `выкуп «${name}»`);
    give(s, seller, o.price, `продажа «${name}»`);
    transferCompany(s, o.cell, buyer);
    p.demand = Math.min(3, p.demand * 1.05);
    emit(s, { type: "buy", player: buyer, cell: o.cell });
    stockEvent(s, `${s.players[buyer].name} выкупает «${name}» у ${s.players[seller].name} за ${o.price}`, [seller, buyer]);
    return true;
  }
  if (freeLots(s, seller, o.cell) < o.lots || s.players[buyer].money < o.price * o.lots) return false;
  give(s, buyer, -o.price * o.lots, `акции «${name}»`);
  give(s, seller, o.price * o.lots, `продажа акций «${name}»`);
  for (let k = 0; k < o.lots; k++) moveLot(p, seller, buyer);
  p.demand *= Math.pow(1.04, o.lots);
  clampDemand(p);
  stockEvent(s, `${s.players[buyer].name} покупает у ${s.players[seller].name} ${o.lots * 10}% «${name}» за ${o.price * o.lots}`, [seller, buyer]);
  return true;
}

/** Сколько бот-владелец хочет за компанию целиком (сумма) или за 10% (цена лота). */
export function botAsk(s: GameState, owner: number, idx: number, whole: boolean, buyer: number): number | null {
  const pl = s.players[owner], p = s.props[idx], c = cell(idx);
  const greed = { shark: 1.3, miser: 1.15, gambler: 1.0, trader: 1.1 }[pl.personality ?? "trader"];
  const poor = pl.money < 250 ? 0.85 : 1;
  if (!whole) return freeLots(s, owner, idx) > 0 ? Math.round(lotPrice(s, idx) * (greed - 0.05) * poor * dealFactor(s, buyer)) : null;
  let ask = companyValue(s, idx) * ownerLots(p) / LOTS + rentFor(s, idx) * 4;
  if (c.industry && hasMonopoly(s, owner, c.industry)) ask *= 2.2; // свою монополию просто так не отдаст
  if (c.industry && industryCells(c.industry).filter((i) => i !== idx).every((i) => owns(s, buyer, i))) ask *= 1.6; // покупателю она нужна для монополии
  return Math.round(ask * greed * poor * dealFactor(s, buyer));
}

// ---------- Банк: кредиты под залог ----------

export const LOAN_SHARE = 0.6; // кредит — до 60% стоимости залога
export const LOAN_RATE = 0.05; // проценты за каждый свой ход
export const LOAN_ROUNDS = 5; // срок, потом банк забирает залог

/** Сколько банк даст под залог (0 — нельзя). */
export function loanLimit(s: GameState, pid: number, idx: number, kind: "company" | "shares"): number {
  const p = s.props[idx], pl = s.players[pid];
  if (!p || p.owner === null) return 0;
  if (pl.loans.some((l) => l.cell === idx && l.kind === kind)) return 0;
  if (kind === "company") {
    if (p.owner !== pid || p.mortgaged) return 0;
    return Math.floor(companyValue(s, idx) * ownerLots(p) / LOTS * loanShare(s, pid));
  }
  const lots = (p.holders[pid] ?? 0) - listedBy(p, pid);
  return lots > 0 ? Math.floor(lots * lotPrice(s, idx) * loanShare(s, pid)) : 0;
}

/** Проценты и просрочка: вызывается в начале хода игрока. */
function serviceLoans(s: GameState, pid: number) {
  const pl = s.players[pid];
  for (const l of [...pl.loans]) {
    if (pl.bankrupt) return;
    const name = cell(l.cell).name;
    if (s.round > l.due) { // срок вышел — банк выставляет залог на аукцион
      pl.loans = pl.loans.filter((x) => x !== l);
      const p = s.props[l.cell];
      const lots = l.kind === "shares" ? p.holders[pid] ?? 0 : 1;
      if ((l.kind === "company" && p.owner === pid) || (l.kind === "shares" && lots > 0)) {
        p.listings = p.listings.filter((x) => x.seller !== pid);
        (s.bankQueue ??= []).push({ debtor: pid, kind: l.kind, cell: l.cell, debt: l.amount, lots });
        stockEvent(s, `Кредит ${pl.name} не погашен — банк выставляет на аукцион ${l.kind === "company" ? `«${name}» целиком` : `акции «${name}» по 10%`}`, [pid]);
        call(s, pid, "bank", `К сожалению, срок кредита ${l.amount} миллионов истёк. Банк выставляет на аукцион ${l.kind === "company" ? `вашу компанию «${name}» целиком` : `ваши акции «${name}» по десять процентов`}. Всё, что выручим сверх долга, вернём вам.`);
      }
      continue;
    }
    if (s.round === l.due) {
      log(s, `${pl.name}: кредит под «${name}» нужно вернуть в этом раунде, иначе залог уйдёт с аукциона`);
      call(s, pid, "bank", `Напоминаю: кредит ${l.amount} миллионов под залог ${l.kind === "company" ? `компании «${name}»` : `акций «${name}»`} нужно вернуть в этом раунде. Иначе банк будет вынужден выставить залог на аукцион.`);
    }
    charge(s, pid, Math.max(1, Math.ceil(l.amount * loanRate(s, pid))), null, `проценты по кредиту «${name}»`);
  }
}

// ---------- Вклад, роскошь, реклама ----------

/** Вклад: проценты за каждый свой ход. Ниже кредита (5%) — банк зарабатывает на разнице. */
export const DEPOSIT_RATE = 0.02;
/** Налог на роскошь при покупке вещей и за вечеринку/отдых. Подарки семье налогом не облагаются. */
export const LUX_TAX = 0.15;
export const EXP_TAX = 0.1;
/** Каждая звезда статуса — +3% к аренде и доходу всех ваших компаний. */
export const FAME_RENT = 0.03;
export const FAME_CAP = 25;
export const CAR_SPEED = 0.1;
export const VACATION_BUILD_DISCOUNT = 0.25;
export const VACATION_ENERGY = 30;
export const YACHT_UPKEEP = 25;
export const STASH_MAX = 600;

export interface LuxSpec { name: string; price: number; fame: number; max: number; perk: string }
export const LUX: Record<LuxKind, LuxSpec> = {
  car: { name: "Спорткар", price: 350, fame: 3, max: 1, perk: "Стройки идут на 10% быстрее — успеваете объехать все объекты. Дешевеет на 5% за круг (не ниже половины цены)." },
  mansion: { name: "Особняк на Рублёвке", price: 900, fame: 6, max: 1, perk: "Банк доверяет: кредит до 75% залога под 4% вместо 60% под 5%. Дорожает на 1,5% за круг." },
  yacht: { name: "Яхта", price: 1600, fame: 10, max: 1, perk: "Вечеринка на яхте даёт вдвое больше статуса. Содержание 25 за ход, дешевеет на 3% за круг (не ниже 60% цены)." },
  painting: { name: "Картина", price: 400, fame: 2, max: 3, perk: "Вложение: цена каждый круг меняется от −15% до +25%. Можно перепродать дороже." },
};
export interface ExpSpec { name: string; price: number; fame: number; rounds: number; perk: string }
export const EXPERIENCES: Record<ExpKind, ExpSpec> = {
  party: { name: "Вечеринка", price: 200, fame: 4, rounds: 3, perk: "Связи: 3 хода боты уступают в сделках 10%, охотнее идут в складчину; спрос на ваши акции +5%." },
  vacation: { name: "Отдых на море", price: 200, fame: 3, rounds: 3, perk: "3 хода стройки дешевле на 25% и бригада +30 энергии. Выгодно перед дорогой стройкой." },
  gifts: { name: "Подарки жене и детям", price: 150, fame: 2, rounds: 3, perk: "Семья — тыл: сумма уходит в семейную заначку (до 600): она считается в капитале и выручит, если не хватит на платёж." },
};

export interface AdSpec { name: string; costK: number; min: number; rounds: number; rent: number; sales: number; demand: number; text: string }
export const AD: Record<AdKind, AdSpec> = {
  flyers: { name: "Листовки и радио", costK: 1, min: 20, rounds: 3, rent: 0.3, sales: 0.35, demand: 1.0, text: "3 хода: аренда +30%, продажи — 35% аренды каждый ваш ход" },
  tv: { name: "Реклама на ТВ", costK: 3, min: 60, rounds: 5, rent: 0.5, sales: 0.6, demand: 1.15, text: "5 ходов: аренда +50%, продажи — 60% аренды каждый ваш ход, акции +15%" },
};

export const hasLux = (s: GameState, pid: number | null, k: LuxKind) => pid !== null && !!s.players[pid]?.lux.some((l) => l.kind === k);
export const hasBuff = (s: GameState, pid: number | null, k: ExpKind) => pid !== null && !!s.players[pid]?.buffs.some((b) => b.kind === k);

/** Статус (звёзды): вещи — пока владеете, вечеринка/отдых/подарки — несколько ходов. */
export function fame(s: GameState, pid: number | null): number {
  if (pid === null) return 0;
  const pl = s.players[pid];
  if (!pl || pl.bankrupt) return 0;
  const f = pl.lux.reduce((a, l) => a + LUX[l.kind].fame, 0) + pl.buffs.reduce((a, b) => a + b.fame, 0);
  return Math.min(FAME_CAP, f);
}

/** Во сколько раз дешевле для этого игрока сделки с ботами: статус и связи с вечеринки. */
export function dealFactor(s: GameState, pid: number): number {
  return (1 - 0.005 * fame(s, pid)) * (hasBuff(s, pid, "party") ? 0.9 : 1);
}

export const loanShare = (s: GameState, pid: number) => (hasLux(s, pid, "mansion") ? 0.75 : LOAN_SHARE);
export const loanRate = (s: GameState, pid: number) => (hasLux(s, pid, "mansion") ? 0.04 : LOAN_RATE);
export const luxValue = (s: GameState, pid: number) => s.players[pid].lux.reduce((a, l) => a + l.value, 0);
export const luxuryTaxCell = (s: GameState, pid: number) => 75 + Math.round(luxValue(s, pid) * 0.05);
export const luxCost = (k: LuxKind) => Math.round(LUX[k].price * (1 + LUX_TAX));
export const expCost = (k: ExpKind) => Math.round(EXPERIENCES[k].price * (k === "gifts" ? 1 : 1 + EXP_TAX));

export function adCost(s: GameState, pid: number, idx: number, kind: AdKind): number {
  const running = Object.values(s.props).filter((p) => p.owner === pid && p.ad).length;
  const spec = AD[kind];
  return Math.round(Math.max(spec.min, rentFor(s, idx, 7, false) * spec.costK) * (1 + 0.15 * running));
}

export const roundsLeft = (s: GameState) => Math.max(0, (s.cfg.length === "quick" ? s.cfg.quickRounds ?? 15 : s.cfg.classicRounds ?? 50) - s.round + 1);

/** Примерный доход компаний игрока за круг: аренда (с частотой попаданий соперников), доход веток, продажи от рекламы. */
export function companyIncome(s: GameState, pid: number): number {
  const visit = Math.max(1, active(s).length - 1) * 0.028;
  let v = 0;
  for (const [i, p] of Object.entries(s.props)) {
    if (p.owner !== pid || p.mortgaged) continue;
    const c = cell(+i);
    v += rentFor(s, +i) * visit;
    if (p.branch === "income" && p.level) v += (c.price ?? 0) * INCOME_SHARE[p.level - 1];
    if (p.ad) v += rentFor(s, +i, 7, false) * AD[p.ad.kind].sales;
  }
  return v / (1 + FAME_RENT * fame(s, pid));
}

/** За сколько кругов вещь окупится статусом (с учётом перепродажи). null — не окупится до конца партии. */
export function luxPayback(s: GameState, pid: number, k: LuxKind): number | null {
  const now = fame(s, pid), add = Math.min(FAME_CAP, now + LUX[k].fame) - now;
  const gain = FAME_RENT * add * companyIncome(s, pid) - (k === "yacht" ? YACHT_UPKEEP : 0);
  const resale = LUX[k].price * (k === "mansion" ? 1 : k === "painting" ? 1 : k === "yacht" ? 0.7 : 0.6);
  if (gain <= 0) return null;
  const r = Math.ceil((luxCost(k) - resale) / gain);
  return r <= roundsLeft(s) ? r : null;
}

/** Начало своего хода: проценты по вкладу, яхта, реклама и временные эффекты. */
function serviceLife(s: GameState, pid: number) {
  const pl = s.players[pid];
  if (pl.deposit > 0) {
    const k = Math.floor(pl.deposit * DEPOSIT_RATE);
    if (k > 0) give(s, pid, k, "проценты по вкладу");
  }
  if (hasLux(s, pid, "yacht") && !charge(s, pid, YACHT_UPKEEP, null, "содержание яхты")) return;
  if (hasBuff(s, pid, "vacation")) pl.energy += VACATION_ENERGY;
  for (const b of pl.buffs) b.rounds -= 1;
  pl.buffs = pl.buffs.filter((b) => b.rounds > 0);
  for (const [i, p] of Object.entries(s.props)) {
    if (p.owner !== pid || !p.ad) continue;
    if (!p.mortgaged) {
      const sales = Math.round(rentFor(s, +i, 7, false) * AD[p.ad.kind].sales);
      if (sales > 0) { give(s, pid, sales, `продажи «${cell(+i).name}» (реклама)`); shareOut(s, +i, sales, "продажи"); }
    }
    p.ad.rounds -= 1;
    if (p.ad.rounds <= 0) p.ad = null;
  }
}

/** Новый круг: машины и яхты дешевеют, особняк дорожает, картины — как повезёт. */
function updateLuxValues(s: GameState) {
  for (const pl of s.players) {
    for (const it of pl.lux) {
      if (it.kind === "car") it.value = Math.max(Math.round(it.paid * 0.5), Math.round(it.value * 0.95));
      else if (it.kind === "yacht") it.value = Math.max(Math.round(it.paid * 0.6), Math.round(it.value * 0.97));
      else if (it.kind === "mansion") it.value = Math.round(it.value * 1.015);
      else it.value = Math.max(50, Math.round(it.value * (0.85 + rand(s) * 0.4)));
    }
  }
}

// ---------- Снос при акционерах ----------

/** Голоса за снос: доля владельца + боты-акционеры (согласны, пока здание не максимальное) + люди из approve. */
export function demolishVote(s: GameState, idx: number, approve: number[]): { yes: number; against: number[] } {
  const p = s.props[idx];
  let yes = ownerLots(p);
  const against: number[] = [];
  if (yes >= MAJORITY_LOTS) return { yes, against };
  for (const [h, lots] of Object.entries(p.holders)) {
    const hid = +h;
    const agree = s.players[hid].bot ? p.level < 3 : approve.includes(hid);
    if (agree) yes += lots; else against.push(hid);
  }
  return { yes, against };
}

/** Люди-акционеры, которых нужно спросить о сносе (пусто — владелец решает сам). */
export function demolishAskList(s: GameState, idx: number): number[] {
  const p = s.props[idx];
  if (ownerLots(p) >= MAJORITY_LOTS) return [];
  return Object.keys(p.holders).map(Number).filter((h) => !s.players[h].bot && !s.players[h].bankrupt);
}

// ---------- Складчина ----------

/** Согласится ли бот войти в долю при покупке клетки. */
export function coopAnswer(s: GameState, pid: number, idx: number, lots: number): boolean {
  const pl = s.players[pid];
  const share = Math.ceil((cell(idx).price ?? 0) * lots / LOTS);
  const reserve = { shark: 150, miser: 450, gambler: 150, trader: 250 }[pl.personality ?? "trader"] * dealFactor(s, s.current);
  return !pl.bankrupt && pl.money - share >= reserve;
}

export function canBuild(s: GameState, pid: number, idx: number): { ok: boolean; reason?: string; cost?: number; level?: number } {
  const c = cell(idx), p = s.props[idx];
  if (!p || c.kind !== "business") return { ok: false, reason: "Здесь нельзя строить" };
  if (p.owner !== pid) return { ok: false, reason: "Клетка не ваша" };
  if (p.mortgaged) return { ok: false, reason: "Клетка в залоге" };
  if (p.construction) return { ok: false, reason: "Стройка уже идёт" };
  if (p.level >= 3) return { ok: false, reason: "Максимальный уровень" };
  if (s.current !== pid || s.landedOwn !== idx) return { ok: false, reason: "Строить можно только там, где стоите" };
  if (s.builtThisTurn) return { ok: false, reason: "Строить — один раз за ход" };
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
  if (soldLots(p) >= PUBLIC_PROTECT_LOTS) return { ok: false, reason: "Публичная компания: акционеры (20%+) против слияния" };
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
  if (pl.deposit > 0) { // сначала снимаем вклад
    const k = Math.min(pl.deposit, need - pl.money);
    pl.deposit -= k;
    give(s, pid, k, "снятие со вклада");
  }
  if (pl.money < need && pl.stash > 0) { // семья выручает
    const k = Math.min(pl.stash, need - pl.money);
    pl.stash -= k;
    give(s, pid, k, "семья выручила");
    log(s, `${pl.name}: семья выручает — ${k} из заначки`);
  }
  // срочная продажа роскоши: дешёвое — первым, за 70% цены
  for (const it of [...pl.lux].sort((a, b) => a.value - b.value)) {
    if (pl.money >= need) return;
    pl.lux = pl.lux.filter((x) => x !== it);
    give(s, pid, Math.round(it.value * 0.7), `срочная продажа: ${LUX[it.kind].name}`);
  }
  if (pl.money >= need) return;
  const mine = Object.entries(s.props).filter(([, p]) => p.owner === pid).map(([i, p]) => ({ i: +i, p }));
  for (const { i, p } of mine) { // отменяем стройки — без возврата
    if (pl.money >= need) return;
    if (p.construction) { p.construction = null; log(s, `${pl.name}: стройка в «${cell(i).name}» остановлена`); }
  }
  // срочная продажа чужих акций: компания выкупает их за 80% цены
  for (const [i, p] of Object.entries(s.props)) {
    while (pl.money < need && (p.holders[pid] ?? 0) > 0) {
      give(s, pid, Math.round(lotPrice(s, +i) * 0.8), `срочная продажа акций «${cell(+i).name}»`);
      p.holders[pid] -= 1;
      if (p.holders[pid] <= 0) delete p.holders[pid];
      p.listings = p.listings.filter((l) => l.seller !== pid || (p.holders[pid] ?? 0) >= l.lots);
      p.demand *= 0.95; clampDemand(p);
    }
    if (pl.money >= need) return;
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
  s.offers = s.offers.filter((o) => o.from !== pid && o.to !== pid);
  pl.loans = [];
  pl.lux = []; pl.buffs = []; pl.deposit = 0; pl.stash = 0;
  for (const [i, p] of Object.entries(s.props)) {
    p.listings = p.listings.filter((l) => l.seller !== pid);
    const held = p.holders[pid];
    if (held) { // акции банкрота уходят кредитору (или возвращаются компании)
      delete p.holders[pid];
      if (creditor !== null && creditor !== p.owner) p.holders[creditor] = (p.holders[creditor] ?? 0) + held;
    }
    if (p.owner !== pid) continue;
    p.construction = null;
    if (creditor !== null) transferCompany(s, +i, creditor);
    else { transferCompany(s, +i, null); Object.assign(p, { level: 0, branch: null, mortgaged: false, invested: 0, fastBonus: false, ad: null }); }
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
  s.landedOwn = null;
  s.builtThisTurn = false;
  s.casinoBets = 0;
  emit(s, { type: "turn", player: pl.id, round: s.round });
  serviceLoans(s, pl.id);
  if (pl.bankrupt) return;
  if (s.bankQueue?.length) { nextBankSale(s); return; } // сначала банк продаёт залоги, потом ход продолжается
  continueTurn(s);
}

/** Вторая половина начала хода: вклад, роскошь, доходы, пропуск хода. */
function continueTurn(s: GameState) {
  const pl = s.players[s.current];
  if (pl.bankrupt) return;
  serviceLife(s, pl.id);
  if (pl.bankrupt) return;
  pl.loungeBets = 0;
  pl.trades = 0;
  // Доход веток «Доход», экспорта зерна и СПГ — с дивидендами акционерам.
  for (const [i, p] of Object.entries(s.props)) {
    if (p.owner !== pl.id || p.mortgaged || p.level === 0) continue;
    const c = cell(+i);
    let income = 0;
    if (p.branch === "income") income += (c.price ?? 0) * INCOME_SHARE[p.level - 1] * (s.market?.rent[c.industry!] ?? 1);
    if (p.branch === "special" && c.industry === "agro") income += 20 * portsOwned(s, pl.id) * p.level;
    if (p.branch === "special" && c.industry === "gas") income += (c.price ?? 0) * 0.08 * (portsOwned(s, pl.id) ? 2 : 1);
    income = Math.round(income * (1 + FAME_RENT * fame(s, pl.id)));
    if (income > 0) { give(s, pl.id, income, `доход «${c.name}»`); shareOut(s, +i, income, "доход"); }
  }
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
      for (const p of Object.values(s.props)) { // непроданные лоты давят цену, без сделок спрос возвращается к норме
        if (p.listings.length) p.demand *= 0.97; else p.demand += (1 - p.demand) * 0.08;
        clampDemand(p);
      }
      updateLuxValues(s);
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
    p.demand = Math.min(3, p.demand * 1.1); // новый уровень — акции дорожают
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
      if (p.owner === pid) s.landedOwn = c.index;
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
      const amount = c.tax === "luxury" ? luxuryTaxCell(s, pid) : Math.min(200, Math.round(capital(s, pid) * 0.1));
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

/** Ставка бота на аукционе банка: часть оценки, по характеру. */
function botBankBid(s: GameState, pid: number, value: number): number {
  const pl = s.players[pid];
  const k = { shark: 0.85, miser: 0.6, gambler: 0.8, trader: 0.75 }[pl.personality ?? "trader"];
  const reserve = { shark: 100, miser: 400, gambler: 150, trader: 250 }[pl.personality ?? "trader"];
  const bid = Math.floor(Math.min(value * k, pl.money - reserve / 2) / 10) * 10;
  return bid >= 10 ? bid : 0;
}

/** Оценка лота банковского аукциона. */
export function bankSaleValue(s: GameState, b: BankSale): number {
  const p = s.props[b.cell];
  return b.kind === "company" ? Math.round(companyValue(s, b.cell) * ownerLots(p) / LOTS) : lotPrice(s, b.cell);
}

/** Следующий лот банка: компания целиком или очередные 10% акций. */
function nextBankSale(s: GameState) {
  while (s.bankQueue?.length) {
    const b = s.bankQueue[0];
    const p = s.props[b.cell];
    const valid = !s.players[b.debtor].bankrupt && b.debt > 0 && (b.kind === "company" ? p.owner === b.debtor : b.lots > 0 && (p.holders[b.debtor] ?? 0) > 0);
    if (!valid) { s.bankQueue.shift(); continue; }
    const value = bankSaleValue(s, b);
    const bids: Record<number, number> = {};
    const waiting: number[] = [];
    for (const x of active(s)) {
      if (x.id === b.debtor) continue; // должник в своём аукционе не участвует
      if (x.bot) bids[x.id] = botBankBid(s, x.id, value); else waiting.push(x.id);
    }
    s.pending = { kind: "auction", cell: b.cell, bids, waiting, bank: { ...b } };
    s.phase = "auction";
    log(s, `Аукцион банка: ${b.kind === "company" ? `«${cell(b.cell).name}» целиком` : `10% акций «${cell(b.cell).name}»`} — оценка ${value}`);
    if (!waiting.length) resolveAuction(s);
    return;
  }
  s.pending = null;
  continueTurn(s);
}

function resolveBankSale(s: GameState, b: BankSale, best: number | null, amount: number) {
  const q = s.bankQueue![0], p = s.props[b.cell], name = cell(b.cell).name, debtor = s.players[b.debtor];
  if (best !== null) {
    give(s, best, -amount, `аукцион банка «${name}»`);
    const toBank = Math.min(amount, q.debt);
    q.debt -= toBank;
    if (amount > toBank) give(s, b.debtor, amount - toBank, `остаток от продажи залога «${name}»`);
    if (b.kind === "company") {
      transferCompany(s, b.cell, best);
      emit(s, { type: "buy", player: best, cell: b.cell });
    } else moveLot(p, b.debtor, best);
    stockEvent(s, `${s.players[best].name} покупает у банка ${b.kind === "company" ? `«${name}»` : `10% «${name}»`} за ${amount}${amount > toBank ? ` — ${debtor.name} получает остаток ${amount - toBank}` : ""}`, [best, b.debtor]);
  } else if (b.kind === "company") { // никто не купил — компания остаётся банку
    transferCompany(s, b.cell, null);
    Object.assign(p, { level: 0, branch: null, mortgaged: false, invested: 0, fastBonus: false, construction: null, ad: null });
    emit(s, { type: "buy", player: b.debtor, cell: b.cell });
    stockEvent(s, `Покупателей нет — «${name}» остаётся банку`, [b.debtor]);
    q.debt = 0;
  } else { // лот никто не взял — банк гасит его у компании
    p.holders[b.debtor] -= 1;
    if (p.holders[b.debtor] <= 0) delete p.holders[b.debtor];
    q.debt -= Math.min(q.debt, lotPrice(s, b.cell));
  }
  q.lots -= 1;
  if (b.kind === "company" || q.debt <= 0 || q.lots <= 0) s.bankQueue!.shift(); // долг закрыт — остальные акции остаются у должника
  nextBankSale(s);
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
  if (pend.bank) { resolveBankSale(s, pend.bank, best, best !== null ? pend.bids[best] : 0); return; }
  if (best !== null) {
    const amount = pend.bids[best];
    give(s, best, -amount, `аукцион «${cell(pend.cell).name}»`);
    s.props[pend.cell].owner = best;
    if (best === s.current && s.players[best].pos === pend.cell) s.landedOwn = pend.cell;
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

export const TOTE_PAY: Record<ToteChoice, number> = { low: 2.3, seven: 5.6, high: 2.3 };
export const TOTE_NAME: Record<ToteChoice, string> = { low: "2–6", seven: "ровно 7", high: "8–12" };
export const LOUNGE_MAX_BETS = 3;

/** Тотализатор: ставки всех игроков на сумму этого броска. */
function resolveTotes(s: GameState, sum: number) {
  for (const pl of s.players) {
    if (!pl.tote || pl.bankrupt) continue;
    const { choice, amount } = pl.tote;
    const hit = choice === "low" ? sum <= 6 : choice === "seven" ? sum === 7 : sum >= 8;
    const win = hit ? Math.round(amount * TOTE_PAY[choice]) : 0;
    pl.tote = null;
    pl.money += win;
    pl.casinoWinnings += win - amount;
    if (!win) s.jackpot += Math.round(amount * 0.1);
    emit(s, { type: "casino", player: pl.id, game: "Тотализатор", win: win - amount, detail: `выпало ${sum}, ставка «${TOTE_NAME[choice]}»`, data: { sum } });
    if (win) emit(s, { type: "money", player: pl.id, delta: win, reason: "тотализатор" });
  }
}

export function loungeMax(s: GameState, pid: number) { return Math.max(10, Math.floor(s.players[pid].money * 0.1)); }

/** Можно ли сейчас играть в «казино ожидания»: одиночная игра, ход соперника. */
export function canLounge(s: GameState, pid: number): string | null {
  const pl = s.players[pid];
  if (s.cfg.mode === "hotseat") return "На одном телефоне казино ожидания нет";
  if (pid === s.current) return "Во время своего хода — только на клетке «Казино»";
  if (pl.loungeBets >= LOUNGE_MAX_BETS) return "Ставки на этот круг закончились";
  if (pl.money < 20) return "Мало денег";
  return null;
}

const cardValue = (c: number) => Math.min(10, c);
export function handValue(cards: number[]) {
  let v = cards.reduce((a, c) => a + (c === 1 ? 11 : cardValue(c)), 0);
  let aces = cards.filter((c) => c === 1).length;
  while (v > 21 && aces > 0) { v -= 10; aces--; }
  return v;
}
const drawCardBJ = (s: GameState) => 1 + randInt(s, 13);

function finishBJ(s: GameState, pid: number) {
  const pl = s.players[pid], bj = pl.bj!;
  const pv = handValue(bj.player);
  if (pv <= 21) while (handValue(bj.dealer) < 17) bj.dealer.push(drawCardBJ(s));
  const dv = handValue(bj.dealer);
  const natural = pv === 21 && bj.player.length === 2;
  let payout = 0, text: string;
  if (pv > 21) text = `перебор ${pv}`;
  else if (natural && !(dv === 21 && bj.dealer.length === 2)) { payout = bj.bet * 2.5; text = "блэкджек!"; }
  else if (dv > 21 || pv > dv) { payout = bj.bet * 2; text = `${pv} против ${dv}`; }
  else if (pv === dv) { payout = bj.bet; text = `ничья ${pv}`; }
  else text = `${pv} против ${dv}`;
  payout = Math.round(payout);
  pl.money += payout;
  pl.casinoWinnings += payout - bj.bet;
  if (!payout) s.jackpot += Math.round(bj.bet * 0.1);
  emit(s, { type: "casino", player: pid, game: "Блэкджек", win: payout - bj.bet, detail: text, data: { player: [...bj.player], dealer: [...bj.dealer], done: true } });
  if (payout) emit(s, { type: "money", player: pid, delta: payout, reason: "блэкджек" });
  pl.bj = null;
}

function startBJ(s: GameState, pid: number, amount: number, lounge: boolean) {
  const pl = s.players[pid];
  pl.money -= amount;
  emit(s, { type: "money", player: pid, delta: -amount, reason: "ставка в блэкджек" });
  pl.bj = { bet: amount, player: [drawCardBJ(s), drawCardBJ(s)], dealer: [drawCardBJ(s)], lounge };
  if (handValue(pl.bj.player) === 21) finishBJ(s, pid);
  else emit(s, { type: "casino", player: pid, game: "Блэкджек", win: 0, detail: "раздача", data: { player: [...pl.bj.player], dealer: [...pl.bj.dealer], done: false } });
}

function spinRoulette(s: GameState, pid: number, amount: number, choice: "red" | "black" | "even" | "odd" | number) {
  const n = randInt(s, 37);
  const red = RED_NUMBERS.has(n);
  let payout = 0;
  if (typeof choice === "number") payout = n === choice ? amount * 36 : 0;
  else if (n !== 0) {
    const hit = (choice === "red" && red) || (choice === "black" && !red) || (choice === "even" && n % 2 === 0) || (choice === "odd" && n % 2 === 1);
    payout = hit ? amount * 2 : 0;
  }
  settleBet(s, pid, amount, payout, "Рулетка", `выпало ${n}${n === 0 ? " (зеро)" : red ? " красное" : " чёрное"}`, { n });
}

function spinSlots(s: GameState, pid: number, amount: number) {
  const pl = s.players[pid];
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
  settleBet(s, pid, amount, payout, "Слоты", r.map((k) => SLOT_SYMBOLS[k]).join(" · "), { reels: r });
}

function maxBet(s: GameState, pid: number) {
  return Math.max(10, Math.floor(s.players[pid].money * 0.2));
}

function settleBet(s: GameState, pid: number, amount: number, payout: number, game: string, detail: string, data?: CasinoData) {
  const pl = s.players[pid];
  pl.money -= amount;
  const win = Math.round(payout);
  pl.money += win;
  pl.casinoWinnings += win - amount;
  if (win === 0) s.jackpot += Math.round(amount * 0.1);
  emit(s, { type: "casino", player: pid, game, win: win - amount, detail, data });
  emit(s, { type: "money", player: pid, delta: win - amount, reason: game });
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
  if (a.t === "bjHit" || a.t === "bjStand") {
    if (!pl.bj) return { ok: false, error: "Раздачи нет" };
    if (a.t === "bjHit") {
      pl.bj.player.push(drawCardBJ(s));
      if (handValue(pl.bj.player) >= 21) finishBJ(s, pid);
      else emit(s, { type: "casino", player: pid, game: "Блэкджек", win: 0, detail: "ещё карта", data: { player: [...pl.bj.player], dealer: [...pl.bj.dealer], done: false } });
    } else finishBJ(s, pid);
    return { ok: true };
  }
  if (a.t === "lounge" || a.t === "loungeBj" || (a.t === "tote" && !mine)) {
    const why = canLounge(s, pid);
    if (why) return { ok: false, error: why };
    if (pl.bj) return { ok: false, error: "Сначала доиграйте раздачу" };
    const amount = Math.round(a.amount);
    const max = loungeMax(s, pid);
    if (amount < 10 || amount > max || amount > pl.money) return { ok: false, error: `Ставка от 10 до ${max}` };
    if (a.t === "tote" && pl.tote) return { ok: false, error: "Ставка тотализатора уже сделана" };
    pl.loungeBets += 1;
    if (a.t === "loungeBj") startBJ(s, pid, amount, true);
    else if (a.t === "tote") { pl.money -= amount; pl.tote = { choice: a.choice, amount }; emit(s, { type: "money", player: pid, delta: -amount, reason: "тотализатор" }); }
    else if (a.game === "roulette") spinRoulette(s, pid, amount, a.choice ?? "red");
    else spinSlots(s, pid, amount);
    return { ok: true };
  }
  if (a.t === "acceptOffer" || a.t === "declineOffer") {
    const o = s.offers.find((x) => x.id === a.id && x.to === pid);
    if (!o) return { ok: false, error: "Предложение уже неактуально" };
    s.offers = s.offers.filter((x) => x !== o);
    if (a.t === "declineOffer") { stockEvent(s, `${pl.name} отклоняет предложение по «${cell(o.cell).name}»`, [o.from, pid]); return { ok: true }; }
    return executeOffer(s, o) ? { ok: true } : { ok: false, error: "Сделка не прошла: нет денег или лотов" };
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
  // на аукционе участник может срочно добыть деньги: снять со вклада, взять кредит, заложить клетку, продать роскошь
  const bidder = s.phase === "auction" && s.pending?.kind === "auction" && s.pending.waiting.includes(pid);
  const raisingMoney = a.t === "withdraw" || a.t === "takeLoan" || a.t === "mortgage" || a.t === "sellLux";
  if (!mine && !(bidder && raisingMoney)) return { ok: false, error: "Сейчас не ваш ход" };

  switch (a.t) {
    case "roll": {
      if (s.phase !== "roll") return { ok: false, error: "Сейчас нельзя бросать" };
      const [d1, d2] = s.forcedDice?.shift() ?? [1 + randInt(s, 6), 1 + randInt(s, 6)];
      s.lastDice = [d1, d2];
      s.landedOwn = null;
      emit(s, { type: "dice", player: pid, a: d1, b: d2 });
      resolveTotes(s, d1 + d2);
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
      s.landedOwn = idx; // купил — стоит на своей клетке, можно сразу строить
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
        if (charge(s, pid, amount, owner, `аренда «${cell(idx).name}»`)) shareOut(s, idx, amount, "аренда");
        p.fastBonus = false;
        log(s, `${pl.name} платит аренду ${amount} → ${s.players[owner].name}`);
      } else {
        const part = Math.round(amount * (1 - WORKOFF_DISCOUNT));
        if (charge(s, pid, part, owner, `аренда со скидкой «${cell(idx).name}»`)) shareOut(s, idx, part, "аренда");
        if (p.construction) addProgress(s, idx, 20);
        pl.skipNext = true;
        log(s, `${pl.name} отрабатывает: платит ${part} вместо ${amount} и пропустит ход`);
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
      s.builtThisTurn = true;
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
      transferCompany(s, a.cell, pid);
      emit(s, { type: "buy", player: pid, cell: a.cell });
      log(s, `${pl.name} выкупает «${cell(a.cell).name}» у ${s.players[prev].name} за ${chk.cost} — монополия!`);
      return { ok: true };
    }
    case "buyCoop": {
      if (s.pending?.kind !== "buy") return { ok: false, error: "Складчина — при покупке свободной клетки" };
      const idx = s.pending.cell, c = cell(idx), price = c.price!;
      const parts = a.partners.filter((x) => x.lots > 0);
      const total = parts.reduce((t, x) => t + x.lots, 0);
      if (!parts.length) return { ok: false, error: "Выберите хотя бы одного партнёра" };
      if (total > LOTS - OWNER_MIN_LOTS) return { ok: false, error: "Партнёрам — не больше 40%" };
      if (new Set(parts.map((x) => x.pid)).size !== parts.length || parts.some((x) => x.pid === pid || !s.players[x.pid] || s.players[x.pid].bankrupt)) return { ok: false, error: "Неверный список партнёров" };
      const shareOf = (x: CoopPart) => Math.ceil(price * x.lots / LOTS);
      const poor = parts.find((x) => s.players[x.pid].money < shareOf(x));
      if (poor) return { ok: false, error: `${s.players[poor.pid].name}: не хватает денег на свою долю` };
      const declined = parts.filter((x) => s.players[x.pid].bot && !coopAnswer(s, x.pid, idx, x.lots));
      if (declined.length) return { ok: false, error: `Отказ: ${declined.map((x) => s.players[x.pid].name).join(", ")}`, info: "declined" };
      const mine = price - parts.reduce((t, x) => t + shareOf(x), 0);
      if (pl.money < mine) return { ok: false, error: `Ваша часть ${mine} — не хватает денег` };
      give(s, pid, -mine, `покупка «${c.name}» в складчину`);
      const p = s.props[idx];
      p.owner = pid;
      s.landedOwn = idx;
      for (const x of parts) { give(s, x.pid, -shareOf(x), `доля в «${c.name}»`); p.holders[x.pid] = x.lots; }
      emit(s, { type: "buy", player: pid, cell: idx });
      stockEvent(s, `${pl.name} покупает «${c.name}» в складчину: ${parts.map((x) => `${s.players[x.pid].name} ${x.lots * 10}%`).join(", ")}`, [pid, ...parts.map((x) => x.pid)]);
      afterLanding(s, pid);
      return { ok: true };
    }
    case "takeLoan": case "repayLoan": case "demolish": {
      if (s.phase !== "roll" && s.phase !== "end" && !((s.phase === "decide" || bidder) && a.t !== "demolish")) return { ok: false, error: "Банк — до броска или в конце хода" };
      if (a.t === "repayLoan") {
        const l = pl.loans.find((x) => x.id === a.id);
        if (!l) return { ok: false, error: "Кредита нет" };
        if (pl.money < l.amount) return { ok: false, error: `Нужно ${l.amount}` };
        give(s, pid, -l.amount, `погашение кредита «${cell(l.cell).name}»`);
        pl.loans = pl.loans.filter((x) => x !== l);
        stockEvent(s, `${pl.name} гасит кредит под «${cell(l.cell).name}»`, [pid]);
        return { ok: true };
      }
      if (a.t === "demolish") {
        const p = s.props[a.cell];
        if (!p || p.owner !== pid || p.level === 0 || p.construction) return { ok: false, error: "Сносить нечего" };
        const vote = demolishVote(s, a.cell, a.approve ?? []);
        if (vote.yes < MAJORITY_LOTS) return { ok: false, error: `Снос не одобрен: «за» ${vote.yes * 10}%, нужно больше 50%. Против: ${vote.against.map((x) => s.players[x].name).join(", ")}` };
        const refund = Math.round(p.invested / 2);
        give(s, pid, refund, `снос построек «${cell(a.cell).name}»`);
        shareOut(s, a.cell, refund, "снос"); // акционерам — их доля возврата
        Object.assign(p, { level: 0, branch: null, invested: 0, fastBonus: false });
        log(s, `${pl.name} сносит постройки в «${cell(a.cell).name}» (возврат ${refund}${soldLots(p) ? " — поделён по долям" : ""}) — можно строить заново`);
        return { ok: true };
      }
      const lim = loanLimit(s, pid, a.cell, a.kind);
      const amount = Math.round(a.amount);
      if (!lim) return { ok: false, error: "Под это банк не даёт" };
      if (amount < 10 || amount > lim) return { ok: false, error: `Кредит от 10 до ${lim}` };
      const l: Loan = { id: s.nextLoanId++, kind: a.kind, cell: a.cell, amount, due: s.round + LOAN_ROUNDS };
      pl.loans.push(l);
      give(s, pid, amount, `кредит под «${cell(a.cell).name}»`);
      stockEvent(s, `${pl.name} берёт в банке ${amount} под залог ${a.kind === "company" ? `«${cell(a.cell).name}»` : `акций «${cell(a.cell).name}»`} до ${l.due}-го раунда`, [pid]);
      return { ok: true };
    }
    case "deposit": case "withdraw": case "buyLux": case "sellLux": case "experience": case "advertise": {
      const raising = (a.t === "withdraw" || a.t === "sellLux") && (s.phase === "decide" || bidder); // снять деньги можно и когда не хватает на покупку или ставку
      if (s.phase !== "roll" && s.phase !== "end" && !raising) return { ok: false, error: "До броска или в конце хода" };
      if (a.t === "deposit" || a.t === "withdraw") {
        const amount = Math.round(a.amount);
        const max = a.t === "deposit" ? pl.money : pl.deposit;
        if (amount < 1 || amount > max) return { ok: false, error: `Можно от 1 до ${max}` };
        if (a.t === "deposit") { pl.money -= amount; pl.deposit += amount; emit(s, { type: "money", player: pid, delta: -amount, reason: "вклад в банк" }); }
        else { pl.deposit -= amount; give(s, pid, amount, "снятие со вклада"); }
        return { ok: true };
      }
      if (a.t === "buyLux") {
        const spec = LUX[a.kind];
        if (!spec) return { ok: false, error: "Нет такого" };
        if (pl.lux.filter((l) => l.kind === a.kind).length >= spec.max) return { ok: false, error: spec.max > 1 ? `Не больше ${spec.max}` : "Уже есть" };
        const cost = luxCost(a.kind), tax = cost - spec.price;
        if (pl.money < cost) return { ok: false, error: `Нужно ${cost} (с налогом на роскошь ${tax})` };
        give(s, pid, -spec.price, spec.name);
        give(s, pid, -tax, "налог на роскошь");
        s.jackpot += Math.round(tax * 0.1);
        pl.lux.push({ id: s.nextLuxId++, kind: a.kind, value: spec.price, paid: spec.price });
        const text = `${pl.name} покупает: ${spec.name} (статус +${spec.fame}★)`;
        emit(s, { type: "lux", player: pid, kind: a.kind, text });
        log(s, text);
        return { ok: true };
      }
      if (a.t === "sellLux") {
        const it = pl.lux.find((l) => l.id === a.id);
        if (!it) return { ok: false, error: "Нет такой вещи" };
        pl.lux = pl.lux.filter((l) => l !== it);
        give(s, pid, it.value, `продажа: ${LUX[it.kind].name}`);
        log(s, `${pl.name} продаёт: ${LUX[it.kind].name} за ${it.value}`);
        return { ok: true };
      }
      if (a.t === "experience") {
        const spec = EXPERIENCES[a.kind];
        if (!spec) return { ok: false, error: "Нет такого" };
        if (hasBuff(s, pid, a.kind)) return { ok: false, error: "Уже действует — подождите, пока закончится" };
        const cost = expCost(a.kind), tax = cost - spec.price;
        if (pl.money < cost) return { ok: false, error: `Нужно ${cost}` };
        give(s, pid, -spec.price, spec.name);
        if (tax > 0) { give(s, pid, -tax, "налог на роскошь"); s.jackpot += Math.round(tax * 0.1); }
        const onYacht = a.kind === "party" && hasLux(s, pid, "yacht");
        pl.buffs.push({ kind: a.kind, rounds: spec.rounds, fame: spec.fame * (onYacht ? 2 : 1) });
        if (a.kind === "party") for (const p of Object.values(s.props)) if (p.owner === pid) { p.demand *= 1.05; clampDemand(p); }
        if (a.kind === "gifts") pl.stash = Math.min(STASH_MAX, pl.stash + spec.price);
        const text = a.kind === "party" ? `${pl.name} устраивает вечеринку${onYacht ? " на яхте" : ""}` : a.kind === "vacation" ? `${pl.name} уезжает на море` : `${pl.name} дарит подарки жене и детям`;
        emit(s, { type: "lux", player: pid, kind: a.kind, text });
        log(s, text);
        return { ok: true };
      }
      const p = s.props[a.cell];
      if (!p || p.owner !== pid) return { ok: false, error: "Реклама — только своей компании" };
      if (p.mortgaged) return { ok: false, error: "Компания в залоге" };
      if (p.ad) return { ok: false, error: "Реклама уже идёт" };
      const spec = AD[a.kind];
      if (!spec) return { ok: false, error: "Нет такой рекламы" };
      const cost = adCost(s, pid, a.cell, a.kind);
      if (pl.money < cost) return { ok: false, error: `Нужно ${cost}` };
      give(s, pid, -cost, `реклама «${cell(a.cell).name}»`);
      p.ad = { kind: a.kind, rounds: spec.rounds };
      p.demand *= spec.demand; clampDemand(p);
      emit(s, { type: "ad", player: pid, cell: a.cell, kind: a.kind });
      log(s, `${pl.name} запускает «${spec.name}» для «${cell(a.cell).name}»`);
      return { ok: true };
    }
    case "bidShares": case "bidCompany": {
      if (s.phase !== "roll" && s.phase !== "end") return { ok: false, error: "Предложения — до броска или в конце хода" };
      const p = s.props[a.cell];
      if (!p || p.owner === null || p.owner === pid) return { ok: false, error: "Это не чужая компания" };
      const owner = s.players[p.owner], name = cell(a.cell).name;
      const whole = a.t === "bidCompany";
      const lots = whole ? 0 : Math.max(1, Math.round(a.lots));
      const price = Math.max(1, Math.round(a.price));
      const total = whole ? price : price * lots;
      if (pl.money < total) return { ok: false, error: "Не хватает денег на такое предложение" };
      if (!whole && freeLots(s, p.owner, a.cell) < lots) return { ok: false, error: `Владелец может продать не больше ${freeLots(s, p.owner, a.cell) * 10}%` };
      if (s.offers.some((o) => o.from === pid && o.cell === a.cell && o.kind === "bid")) return { ok: false, error: "Предложение уже отправлено" };
      const o: Offer = { id: s.nextOfferId++, kind: "bid", from: pid, to: p.owner, cell: a.cell, lots, price, whole };
      pl.trades++;
      const what = whole ? `«${name}» целиком за ${total}` : `${lots * 10}% «${name}» за ${total}`;
      if (owner.bot) {
        const ask = botAsk(s, p.owner, a.cell, whole, pid);
        const askTotal = ask === null ? null : whole ? ask : ask * lots;
        if (askTotal !== null && total >= askTotal) { executeOffer(s, o); return { ok: true, info: `${owner.name} согласен!` }; }
        const info = askTotal === null ? `${owner.name} не продаёт` : `${owner.name} отказывается — хочет не меньше ${askTotal}`;
        stockEvent(s, `${pl.name} предлагает ${owner.name} ${what} — ${info.replace(`${owner.name} `, "")}`, [pid, p.owner]);
        return { ok: true, info };
      }
      s.offers.push(o);
      stockEvent(s, `${pl.name} хочет купить у ${owner.name} ${what}`, [pid, p.owner]);
      call(s, p.owner, "exchange", `${pl.name} хочет купить у вас ${what.replace(/«/g, "«").replace(" за ", " и предлагает ")} миллионов. Цена на бирже сейчас — ${whole ? Math.round(companyValue(s, a.cell) * ownerLots(p) / LOTS) : lotPrice(s, a.cell) * lots} миллионов. Принять предложение?`, o.id);
      return { ok: true, info: `Предложение отправлено ${owner.name}` };
    }
    case "listShares": case "unlistShares": case "buyShares": case "offerShares": {
      if (s.phase !== "roll" && s.phase !== "end" && s.phase !== "decide") return { ok: false, error: "Биржа — до броска или в конце хода" };
      if (!tradable(s, a.cell)) return { ok: false, error: "У компании нет владельца" };
      const p = s.props[a.cell], name = cell(a.cell).name;
      if (a.t === "unlistShares") {
        p.listings = p.listings.filter((l) => l.seller !== pid);
        return { ok: true };
      }
      if (a.t === "buyShares") {
        if (pl.trades >= 6) return { ok: false, error: "Хватит сделок на этот ход" };
        const n = buyLots(s, pid, a.cell, Math.max(1, a.lots));
        if (!n) return { ok: false, error: "Нет лотов в продаже или не хватает денег" };
        pl.trades++;
        stockEvent(s, `${pl.name} покупает ${n * 10}% «${name}»`, [pid]);
        return { ok: true };
      }
      const lots = Math.max(1, Math.round(a.lots));
      if (lots > freeLots(s, pid, a.cell)) return { ok: false, error: p.owner === pid ? "Владелец держит не меньше 60%" : "У вас нет столько свободных акций" };
      if (a.t === "listShares") {
        const l = p.listings.find((x) => x.seller === pid);
        if (l) l.lots += lots; else p.listings.push({ seller: pid, lots });
        pl.trades++;
        p.demand *= Math.pow(0.97, lots);
        clampDemand(p);
        stockEvent(s, `${pl.name} выставляет ${lots * 10}% «${name}» на биржу по ${lotPrice(s, a.cell)} за 10%`, [pid]);
        return { ok: true };
      }
      const to = s.players[a.to];
      if (!to || to.bankrupt || a.to === pid) return { ok: false, error: "Некому предложить" };
      const price = Math.max(1, Math.round(a.price));
      const o: Offer = { id: s.nextOfferId++, kind: "sell", from: pid, to: a.to, cell: a.cell, lots, price };
      pl.trades++;
      if (to.bot) {
        const fair = lotPrice(s, a.cell);
        const ok = price <= fair * 1.15 / dealFactor(s, pid) && to.money - price * lots >= 250;
        if (!ok) { stockEvent(s, `${to.name} отказывается: ${lots * 10}% «${name}» за ${price * lots} — дорого`, [pid, a.to]); return { ok: true }; }
        executeOffer(s, o);
        return { ok: true };
      }
      s.offers.push(o);
      stockEvent(s, `${pl.name} предлагает ${to.name} ${lots * 10}% «${name}» за ${price * lots}`, [pid, a.to]);
      call(s, a.to, "exchange", `${pl.name} предлагает вам ${lots * 10} процентов компании «${name}» за ${price * lots} миллионов. На бирже такая доля стоит ${lotPrice(s, a.cell) * lots}. Аренда компании сейчас ${rentFor(s, a.cell)}, ваша доля дивидендов — ${lots * 10} процентов. Берёте?`, o.id);
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
      if (pl.loans.some((l) => l.kind === "company" && l.cell === a.cell)) return { ok: false, error: "Компания уже в залоге по кредиту" };
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
    case "roulette": case "slots": case "bjStart": case "tote": {
      if (s.phase !== "casino") return { ok: false, error: "Вы не в казино" };
      if (pl.bj) return { ok: false, error: "Сначала доиграйте раздачу" };
      if (s.casinoBets >= 3) return { ok: false, error: "Не больше 3 ставок" };
      const amount = Math.round(a.amount);
      if (amount < 10 || amount > maxBet(s, pid) || amount > pl.money) return { ok: false, error: `Ставка от 10 до ${maxBet(s, pid)}` };
      if (a.t === "tote" && pl.tote) return { ok: false, error: "Ставка тотализатора уже сделана" };
      s.casinoBets += 1;
      if (a.t === "roulette") spinRoulette(s, pid, amount, a.choice);
      else if (a.t === "slots") spinSlots(s, pid, amount);
      else if (a.t === "bjStart") startBJ(s, pid, amount, false);
      else { pl.money -= amount; pl.tote = { choice: a.choice, amount }; emit(s, { type: "money", player: pid, delta: -amount, reason: "тотализатор" }); log(s, `${pl.name} ставит ${amount} на «${TOTE_NAME[a.choice]}»`); }
      return { ok: true };
    }
    case "leaveCasino":
      if (s.phase !== "casino") return { ok: false, error: "Вы не в казино" };
      if (pl.bj && !pl.bj.lounge) finishBJ(s, pid);
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
      resolveTotes(s, d1 + d2);
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
