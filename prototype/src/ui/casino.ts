// Окно казино: рулетка с колесом, слоты с барабанами, блэкджек с картами, тотализатор.
import {
  Action, CasinoData, GameState, LOUNGE_MAX_BETS, RED_NUMBERS, SLOT_SYMBOLS, TOTE_NAME, TOTE_PAY, ToteChoice, act, canLounge, handValue, loungeMax,
} from "../engine/engine";
import { sfx } from "./sound";

type Game = "roulette" | "slots" | "blackjack" | "tote";
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const SLOT_ICON = ["🛢", "🔥", "⚙️", "🌲", "🌾", "🏰"];
const SUITS = ["♠", "♥", "♦", "♣"];
const RANK = (c: number) => (c === 1 ? "A" : c === 11 ? "J" : c === 12 ? "Q" : c === 13 ? "K" : String(c));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}
function btn(label: string, on: () => void, cls = "") {
  const b = el("button", cls, label);
  b.addEventListener("click", (e) => { e.stopPropagation(); on(); });
  return b;
}
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface CasinoHost {
  s: GameState;
  pid: number;
  /** true — «казино ожидания» в чужой ход, false — клетка «Казино» в свой ход. */
  lounge: boolean;
  /** После каждой ставки: отрисовать игру, обработать события. */
  after: () => void;
  close: () => void;
  instant: boolean;
}

export class CasinoView {
  root = el("div", "casino");
  private game: Game = "roulette";
  private stake = 50;
  private busy = false;
  private status = el("div", "cas-status");
  private stage = el("div", "cas-stage");
  private controls = el("div", "cas-controls");
  private result = el("div", "cas-result");
  private wheel!: HTMLCanvasElement;
  private wheelAngle = 0;

  constructor(private h: CasinoHost) {
    const tabs = el("div", "cas-tabs");
    const names: [Game, string][] = [["roulette", "Рулетка"], ["slots", "Слоты"], ["blackjack", "Блэкджек"], ["tote", "Тотализатор"]];
    for (const [g, n] of names) {
      const b = btn(n, () => { if (this.busy || this.h.s.players[this.h.pid].bj) return; sfx.click(); this.game = g; this.render(); }, g === this.game ? "on" : "");
      b.dataset.g = g;
      tabs.append(b);
    }
    this.root.append(el("div", "cas-head", el("div", "cas-title", this.h.lounge ? "Казино, пока ходят другие" : "Казино «Олигарх»"), this.status), tabs, this.stage, this.result, this.controls);
    const pl = this.h.s.players[this.h.pid];
    if (pl.bj) this.game = "blackjack";
    this.stake = Math.min(50, this.max());
    this.render();
  }

  private max() {
    const s = this.h.s, pl = s.players[this.h.pid];
    return this.h.lounge ? loungeMax(s, this.h.pid) : Math.max(10, Math.floor(pl.money * 0.2));
  }

  private betsLeft() {
    const s = this.h.s, pl = s.players[this.h.pid];
    return this.h.lounge ? LOUNGE_MAX_BETS - pl.loungeBets : 3 - s.casinoBets;
  }

  private canBet(): string | null {
    const s = this.h.s, pl = s.players[this.h.pid];
    if (this.h.lounge) return canLounge(s, this.h.pid);
    if (s.phase !== "casino" || s.current !== this.h.pid) return "Казино доступно на клетке «Казино»";
    if (s.casinoBets >= 3) return "Ставки на этот визит закончились";
    if (pl.money < 10) return "Мало денег";
    return null;
  }

  private updateStatus() {
    const s = this.h.s, pl = s.players[this.h.pid];
    this.status.textContent = `${Math.round(pl.money).toLocaleString("ru-RU")} млн ₽ · ставок осталось ${Math.max(0, this.betsLeft())} · джекпот ${s.jackpot}`;
    this.root.querySelectorAll<HTMLButtonElement>(".cas-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.g === this.game));
  }

  render() {
    this.updateStatus();
    this.stage.replaceChildren();
    this.controls.replaceChildren();
    const pl = this.h.s.players[this.h.pid];
    if (this.game === "roulette") this.renderRoulette();
    if (this.game === "slots") this.renderSlots();
    if (this.game === "blackjack") this.renderBJ(pl.bj ? { player: pl.bj.player, dealer: pl.bj.dealer, done: false } : undefined);
    if (this.game === "tote") this.renderTote();
    if (!pl.bj) this.controls.prepend(this.stakeRow());
    const why = pl.bj ? null : this.canBet();
    if (why && !this.busy) this.result.textContent = why;
  }

  private stakeRow() {
    const max = this.max();
    this.stake = Math.max(10, Math.min(this.stake, max));
    const row = el("div", "cas-stake");
    const val = el("b", "", String(this.stake));
    const chips = [10, 25, 50, 100, 250].filter((c) => c <= max);
    row.append(el("span", "", "Ставка: "), val);
    for (const c of chips) row.append(btn(String(c), () => { this.stake = c; val.textContent = String(c); sfx.click(); }, "chip-btn"));
    row.append(btn(`макс ${max}`, () => { this.stake = max; val.textContent = String(max); sfx.click(); }, "chip-btn"));
    return row;
  }

  /** Выполняет ставку в движке и возвращает данные её события. */
  private bet(a: Action, game: string): { win: number; detail: string; data?: CasinoData } | null {
    const s = this.h.s;
    const n0 = s.events.length;
    const r = act(s, this.h.pid, a);
    if (!r.ok) { this.result.textContent = r.error ?? "Нельзя"; sfx.alert(); return null; }
    const ev = s.events.slice(n0).reverse().find((e) => e.type === "casino" && e.game === game);
    return ev && ev.type === "casino" ? { win: ev.win, detail: ev.detail, data: ev.data } : { win: 0, detail: "" };
  }

  private showWin(win: number, detail: string) {
    this.result.replaceChildren(el("span", win > 0 ? "plus" : win < 0 ? "minus" : "", `${detail} → ${win > 0 ? "+" : ""}${win}`));
    if (win > 0) sfx.win(); else if (win < 0) sfx.lose();
    this.updateStatus();
  }

  // ---------- Рулетка ----------

  private renderRoulette() {
    this.wheel = el("canvas", "wheel") as HTMLCanvasElement;
    this.wheel.width = this.wheel.height = 300;
    this.stage.append(this.wheel);
    this.drawWheel(this.wheelAngle, null);
    const row = el("div", "cas-bets");
    const go = (choice: "red" | "black" | "even" | "odd" | number) => () => void this.spin(choice);
    row.append(btn("Красное ×2", go("red"), "red"), btn("Чёрное ×2", go("black"), "black"), btn("Чёт ×2", go("even")), btn("Нечет ×2", go("odd")), btn("Зеро ×36", go(0), "green"));
    this.controls.append(row);
  }

  private drawWheel(angle: number, hit: number | null, ball = 0) {
    const c = this.wheel.getContext("2d")!;
    const R = 150, n = WHEEL.length, step = (Math.PI * 2) / n;
    c.clearRect(0, 0, 300, 300);
    c.save();
    c.translate(R, R);
    c.fillStyle = "#5b3a1e"; c.beginPath(); c.arc(0, 0, R - 2, 0, Math.PI * 2); c.fill();
    c.rotate(angle);
    for (let i = 0; i < n; i++) {
      const v = WHEEL[i];
      c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, R - 14, i * step - step / 2 - Math.PI / 2, i * step + step / 2 - Math.PI / 2); c.closePath();
      c.fillStyle = v === 0 ? "#1f8a3c" : RED_NUMBERS.has(v) ? "#c62828" : "#1b1b1b";
      if (hit === v) c.fillStyle = "#e8c15a";
      c.fill();
      c.save(); c.rotate(i * step); c.fillStyle = hit === v ? "#222" : "#fff"; c.font = "bold 11px system-ui"; c.textAlign = "center"; c.fillText(String(v), 0, -(R - 26)); c.restore();
    }
    c.fillStyle = "#c9a227"; c.beginPath(); c.arc(0, 0, 46, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#7a5a10"; c.beginPath(); c.arc(0, 0, 14, 0, Math.PI * 2); c.fill();
    c.restore();
    // шарик и указатель сверху
    c.fillStyle = "#fff"; c.beginPath(); c.arc(R, 10 + ball, 7, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#222"; c.lineWidth = 1; c.stroke();
  }

  private async spin(choice: "red" | "black" | "even" | "odd" | number) {
    if (this.busy) return;
    const r = this.bet({ ...(this.h.lounge ? { t: "lounge", game: "roulette", choice } : { t: "roulette", choice }), amount: this.stake } as Action, "Рулетка");
    if (!r) return;
    this.busy = true;
    this.result.textContent = "Ставки сделаны, ставок больше нет…";
    const n = r.data?.n ?? 0;
    const idx = WHEEL.indexOf(n), step = (Math.PI * 2) / WHEEL.length;
    const target = -idx * step; // нужная ячейка — под указателем сверху
    const from = this.wheelAngle;
    const full = Math.PI * 2;
    const delta = (((from - target) % full) + full) % full; // доворот до нужной ячейки
    const end = from - delta - full * (5 + Math.floor(Math.random() * 2));
    const dur = this.h.instant ? 0 : 3200;
    const t0 = performance.now();
    let lastTick = 0;
    await new Promise<void>((res) => {
      const frame = () => {
        const k = dur ? Math.min(1, (performance.now() - t0) / dur) : 1;
        const e = 1 - Math.pow(1 - k, 3);
        const a = from + (end - from) * e;
        const tickIdx = Math.floor(a / step);
        if (tickIdx !== lastTick) { lastTick = tickIdx; if (k < 0.97) sfx.spinTick(); }
        this.drawWheel(a, k >= 1 ? n : null, Math.sin(k * Math.PI) * 6);
        if (k < 1) requestAnimationFrame(frame); else res();
      };
      frame();
    });
    this.wheelAngle = end % (Math.PI * 2);
    this.busy = false;
    this.showWin(r.win, `Выпало ${n}${n === 0 ? " — зеро" : RED_NUMBERS.has(n) ? ", красное" : ", чёрное"}`);
    this.h.after();
  }

  // ---------- Слоты ----------

  private renderSlots() {
    const box = el("div", "reels");
    for (let k = 0; k < 3; k++) box.append(el("div", "reel", SLOT_ICON[(k * 2) % 6]));
    this.stage.append(box, el("div", "muted tiny cas-hint", "Два одинаковых ×1,6 · три ×10 · три 🏰 — джекпот"));
    this.controls.append(el("div", "cas-bets", btn("Крутить", () => void this.pull(), "primary")));
  }

  private async pull() {
    if (this.busy) return;
    const r = this.bet({ ...(this.h.lounge ? { t: "lounge", game: "slots" } : { t: "slots" }), amount: this.stake } as Action, "Слоты");
    if (!r) return;
    this.busy = true;
    const reels = [...this.stage.querySelectorAll<HTMLDivElement>(".reel")];
    const res = r.data?.reels ?? [0, 1, 2];
    const stops = this.h.instant ? [0, 0, 0] : [900, 1500, 2100];
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const stopped = [false, false, false];
      const frame = () => {
        const t = performance.now() - t0;
        reels.forEach((rl, i) => {
          if (stopped[i]) return;
          if (t >= stops[i]) { stopped[i] = true; rl.textContent = SLOT_ICON[res[i]]; rl.classList.add("stop"); sfx.reelStop(); return; }
          rl.textContent = SLOT_ICON[Math.floor(t / 70 + i * 2) % 6];
        });
        if (stopped.every(Boolean)) done(); else requestAnimationFrame(frame);
      };
      reels.forEach((rl) => rl.classList.remove("stop"));
      frame();
    });
    this.busy = false;
    if (res.every((x) => x === 5)) sfx.jackpot();
    this.showWin(r.win, res.map((k) => SLOT_SYMBOLS[k]).join(" · "));
    this.h.after();
  }

  // ---------- Блэкджек ----------

  private cardEl(c: number, i: number, hidden = false) {
    if (hidden) return el("div", "pcard back", "");
    const suit = SUITS[(c * 7 + i * 3) % 4];
    return el("div", `pcard${suit === "♥" || suit === "♦" ? " redc" : ""}`, el("span", "", RANK(c)), el("span", "suit", suit));
  }

  private renderBJ(d?: CasinoData) {
    const dealer = d?.dealer ?? [], player = d?.player ?? [];
    const table = el("div", "bj");
    const dh = el("div", "hand", ...dealer.map((c, i) => this.cardEl(c, i)), ...(d && !d.done ? [this.cardEl(0, 9, true)] : []));
    const ph = el("div", "hand", ...player.map((c, i) => this.cardEl(c, i + 5)));
    table.append(el("div", "hand-label", `Дилер${dealer.length ? ` · ${handValue(dealer)}` : ""}`), dh,
      el("div", "hand-label", `Вы${player.length ? ` · ${handValue(player)}` : ""}`), ph);
    this.stage.append(table);
    const playing = d && !d.done;
    if (playing) {
      this.controls.append(el("div", "cas-bets", btn("Ещё карту", () => void this.bjMove("bjHit"), "primary"), btn("Хватит", () => void this.bjMove("bjStand"))));
    } else {
      this.controls.append(el("div", "cas-bets", btn("Раздать", () => void this.bjDeal(), "primary"), el("div", "muted tiny", "Выигрыш ×2, блэкджек ×2,5, ничья — возврат")));
    }
  }

  private async bjDeal() {
    if (this.busy) return;
    const r = this.bet({ ...(this.h.lounge ? { t: "loungeBj" } : { t: "bjStart" }), amount: this.stake } as Action, "Блэкджек");
    if (!r) return;
    sfx.card();
    this.stage.replaceChildren(); this.controls.replaceChildren();
    this.renderBJ(r.data);
    this.updateStatus();
    if (r.data?.done) this.showWin(r.win, r.detail); else this.result.textContent = "Ваш ход: ещё карту или хватит?";
    this.h.after();
  }

  private async bjMove(t: "bjHit" | "bjStand") {
    if (this.busy) return;
    const r = this.bet({ t }, "Блэкджек");
    if (!r) return;
    sfx.card();
    this.stage.replaceChildren(); this.controls.replaceChildren();
    this.renderBJ(r.data);
    if (r.data?.done) {
      if (!this.h.instant) await wait(350);
      this.showWin(r.win, r.detail);
    } else this.result.textContent = `У вас ${handValue(r.data?.player ?? [])}`;
    this.h.after();
  }

  // ---------- Тотализатор ----------

  private renderTote() {
    const pl = this.h.s.players[this.h.pid];
    this.stage.append(el("div", "tote",
      el("div", "tote-title", "Ставка на сумму следующего броска кубиков — чей бы он ни был"),
      pl.tote ? el("div", "tote-cur", `Ваша ставка: ${pl.tote.amount} на «${TOTE_NAME[pl.tote.choice]}» — ждём бросок`) : ""));
    const row = el("div", "cas-bets");
    for (const c of ["low", "seven", "high"] as ToteChoice[]) {
      row.append(btn(`${TOTE_NAME[c]} ×${String(TOTE_PAY[c]).replace(".", ",")}`, () => {
        const r = this.bet({ t: "tote", choice: c, amount: this.stake }, "Тотализатор");
        if (r !== null) { sfx.coin(); this.result.textContent = `Ставка ${this.stake} на «${TOTE_NAME[c]}» принята`; this.render(); this.h.after(); }
      }, c === "seven" ? "primary" : ""));
    }
    this.controls.append(row);
  }
}
