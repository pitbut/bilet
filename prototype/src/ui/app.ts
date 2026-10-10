import { CasinoView } from "./casino";
import { isMuted, setMuted, sfx } from "./sound";
// Связка правил, 3D-сцены и интерфейса.
import { BOARD, BRANCH_EFFECTS, BranchId, INDUSTRIES } from "../engine/board";
import {
  Action, GameConfig, GameEvent, GameState, Result, act, active, buildCost, canBuild, canLounge, canTakeover, capital, companyValue, drainEvents, freeLots,
  INCOME_SHARE, PUBLIC_PROTECT_LOTS, coopAnswer, loanLimit, WORKOFF_DISCOUNT, lotPrice, newGame, ownerLots, rentFor, soldLots,
  AD, AdKind, DEPOSIT_RATE, bankSaleValue, demolishAskList, EXPERIENCES, ExpKind, FAME_RENT, LUX, LuxKind, LUX_TAX, EXP_TAX, STASH_MAX, adCost, expCost, fame, luxCost, luxPayback,
  loanRate, loanShare, luxuryTaxCell,
} from "../engine/engine";
import { botStep } from "../engine/runner";
import { BoardScene } from "./scene";
import { ActReply, NetClient, NetHost, NetInfo, migratedTable, nextHostSeat } from "../net/session";
import { pickDriver } from "../net/transport";
import { clearSave, saveGame } from "./save";

export type Speed = "normal" | "fast" | "instant";
const SPEED = { normal: { hop: 0.42, bot: 800 }, fast: { hop: 0.2, bot: 350 }, instant: { hop: 0, bot: 60 } };
const CARDS_W = 230;
const fmt = (n: number) => `${Math.round(n).toLocaleString("ru-RU")}`;
const PERS_NAME = { shark: "Акула", miser: "Скряга", gambler: "Игроман", trader: "Торгаш" };
const BRANCH_TITLE: Record<BranchId, string> = { rent: "Аренда", income: "Доход", special: "Особая" };
const BRANCH_HINT: Record<BranchId, string> = {
  rent: "Аренда ×4 / ×10 / ×20 от базовой",
  income: "Аренда ×2 / ×4 / ×7 и доход 4% / 8% / 15% цены каждый раунд",
  special: "Аренда ×3 / ×6 / ×12 и особый эффект",
};

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v; else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
}

function button(label: string, onClick: () => void, cls = "") {
  const b = h("button", { class: cls }, label);
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return b;
}

export class App {
  s!: GameState;
  scene: BoardScene;
  private ui: HTMLElement;
  private bar = h("div", { class: "bar" });
  private info = h("div", { class: "info" });
  private panel = h("div", { class: "panel" });
  private cards = h("div", { class: "cards" });
  private myBtn = h("button", { class: "mycards" });
  private logBox = h("div", { class: "log" });
  private toasts = h("div", { class: "toasts" });
  private modal = h("div", { class: "modal hidden" });
  private stepping = false;
  private again = false;
  private passedTurn = -1;
  private waitingPass = false;
  private speed: Speed = "normal";
  private logLines: string[] = [];
  private rush = false;
  private fitLater: () => void = () => {};
  private get portrait() { return this.root.clientWidth < this.root.clientHeight; }

  /** Карточка клетки хода — справа (горизонтально) или над панелью (вертикально); кнопка «Мои карточки» — внизу справа. */
  private placeCards() {
    const H = this.root.clientHeight;
    const top = this.bar.getBoundingClientRect().bottom + 6;
    const panelTop = this.panel.getBoundingClientRect().top || H - 80;
    const st = this.cards.style, bs = this.myBtn.style;
    if (this.portrait) {
      Object.assign(st, { top: "auto", left: "8px", right: "8px", width: "auto", bottom: `${H - panelTop + 6}px` });
      Object.assign(bs, { right: "8px", bottom: `${H - panelTop + 6}px` });
      if (this.cards.childElementCount) bs.bottom = `${H - this.cards.getBoundingClientRect().top + 6}px`;
    } else {
      Object.assign(st, { top: `${top}px`, left: "auto", right: "8px", width: `${CARDS_W}px`, bottom: "auto" });
      Object.assign(bs, { right: "8px", bottom: "max(10px, env(safe-area-inset-bottom))" });
      // панель хода не заезжает на кнопку «Мои карточки»
      const room = this.root.clientWidth - (this.myBtn.getBoundingClientRect().width || 170) - 24;
      Object.assign(this.panel.style, { left: "8px", right: "auto", transform: "none", width: `${Math.min(640, room)}px` });
    }
    this.toasts.style.top = `${top}px`;
  }
  private insure = false;
  /** Сетевая партия: хозяин (seat 0) или гость со своим местом. */
  private net: { role: "host"; host: NetHost; seat: number } | { role: "client"; client: NetClient; seat: number } | null = null;
  private remoteQueue: { state: GameState; events: GameEvent[] }[] = [];
  private applying = false;
  private bidding = false;
  dbgEvent = "";

  constructor(private root: HTMLElement, private onExit: () => void) {
    const stage = h("div", { class: "stage" });
    root.append(stage);
    this.scene = new BoardScene(stage);
    this.ui = h("div", { class: "ui" }, this.bar, this.info, this.cards, this.myBtn, this.logBox, this.panel, this.toasts, this.modal);
    this.myBtn.addEventListener("click", () => this.showMyCards());
    root.append(this.ui);
    this.scene.onCellClick = (i) => this.showCell(i);
    (window as unknown as { __oligarh: App }).__oligarh = this; // для отладки и автотестов
    const measure = () => {
      this.placeCards();
      this.scene.safeTop = this.bar.getBoundingClientRect().bottom + 6;
      this.scene.safeBottom = Math.max(70, root.clientHeight - this.panel.getBoundingClientRect().top + 6);
      this.scene.safeRight = 0;
    };
    window.addEventListener("resize", () => { measure(); this.scene.fitView(); });
    this.fitLater = () => { measure(); this.scene.fitView(); };
  }

  async start(cfg: GameConfig, speed: Speed, host?: NetHost) {
    this.speed = speed;
    this.scene.hopTime = SPEED[speed].hop;
    this.s = newGame(cfg);
    if (host) {
      this.wireHost(host);
      host.start(this.s);
    }
    this.panel.replaceChildren(h("div", { class: "hint" }, "Загрузка поля…"));
    await Promise.all([this.scene.setupTokens(this.s), this.scene.setupDice()]);
    await this.scene.sync(this.s);
    this.render();
    this.fitLater();
    void this.step();
  }

  /** Продолжить сохранённую партию (один телефон). */
  async resume(state: GameState, speed: Speed) {
    this.speed = speed;
    this.scene.hopTime = SPEED[speed].hop;
    this.s = state;
    this.panel.replaceChildren(h("div", { class: "hint" }, "Загрузка поля…"));
    await Promise.all([this.scene.setupTokens(this.s), this.scene.setupDice()]);
    for (const p of this.s.players) if (p.bankrupt) this.scene.hideToken(p.id);
    await this.scene.sync(this.s);
    this.render();
    this.fitLater();
    this.toast(`Партия продолжается: раунд ${state.round}`, "good");
    void this.step();
  }

  /** Хозяин стола: действия гостей, отключения и возвращения. */
  private wireHost(host: NetHost) {
    this.net = { role: "host", host, seat: host.seat };
    host.onRequest = (_seat, pid, a) => this.hostRequest(pid, a);
    host.onGuestLost = (seat) => {
      const p = this.s.players[seat];
      p.bot = true; p.personality = p.personality ?? "trader"; p.difficulty = "normal";
      this.toast(`${p.name} отключился — пока за него играет бот`, "warn", 4000);
      host.broadcast(this.s, []);
      void this.step();
    };
    host.onGuestBack = (seat) => {
      this.s.players[seat].bot = false;
      this.toast(`${this.s.players[seat].name} вернулся в игру`, "good");
      void this.step();
    };
  }

  /** Гость: состояние приходит от хозяина, действия уходят хозяину. */
  async startClient(client: NetClient, state: GameState, seat: number, speed: Speed) {
    this.speed = speed;
    this.scene.hopTime = SPEED[speed].hop;
    this.s = state;
    this.attachClient(client, seat);
    this.scene.lagging = () => this.remoteQueue.length > 2; // сильно отстали от хозяина — догоняем без анимаций
    this.panel.replaceChildren(h("div", { class: "hint" }, "Загрузка поля…"));
    await Promise.all([this.scene.setupTokens(this.s), this.scene.setupDice()]);
    await this.scene.sync(this.s);
    this.render();
    this.fitLater();
  }

  private attachClient(client: NetClient, seat: number) {
    this.net = { role: "client", client, seat };
    client.onState = (st, events) => { this.remoteQueue.push({ state: st, events }); void this.applyRemote(); };
    client.onStart = (st) => { this.remoteQueue.push({ state: st, events: [] }); void this.applyRemote(); };
    client.onAsk = (q) => this.askLocal(this.s.players[seat].name, q);
    client.onLost = (why) => this.lost(why);
    client.onHostGone = (info) => void this.hostGone(info);
  }

  /** Хозяин стола вышел: его место занимает гость с наименьшим номером, остальные переподключаются к нему. */
  private async hostGone(info: NetInfo) {
    if (this.net?.role !== "client") return;
    const me = this.net.seat, old = this.net.client;
    old.close();
    const next = nextHostSeat(info);
    if (next === null) { this.lost("Хозяин стола вышел, а других телефонов за столом нет"); return; }
    while (this.applying) await new Promise((r) => setTimeout(r, 100)); // доигрываем полученные ходы
    const s = this.s;
    const newHost = s.players[next];
    const table = migratedTable(info, newHost.name);
    const driver = pickDriver();
    if (next === me) {
      this.toast(`${info.hostName} вышел — теперь вы хозяин стола, игра идёт через ваш телефон`, "card", 5000);
      let tr;
      try { tr = await driver.host(table); } catch (e) { this.lost(`Не удалось открыть стол: ${String(e)}`); return; }
      const guests = [{ seat: info.hostSeat, name: info.hostName }, ...info.guests.filter((g) => g.seat !== me)];
      const host = new NetHost(tr, s.players[me].name, table, { seat: me, state: s, guests });
      for (const g of guests) { // пока не переподключились — за них играет бот
        const p = s.players[g.seat];
        if (!p.bankrupt) { p.bot = true; p.personality = p.personality ?? "trader"; p.difficulty = p.difficulty ?? "normal"; }
      }
      this.scene.lagging = () => false;
      this.wireHost(host);
      this.render();
      void this.step();
      return;
    }
    this.toast(`${info.hostName} вышел — переключаемся на телефон ${newHost.name}…`, "card", 5000);
    const deadline = Date.now() + 45000;
    const tried = new Set<string>();
    while (Date.now() < deadline) {
      let found: string | null = null;
      const stop = await driver.scan((t) => { if (t.name === table && !tried.has(t.id) && !found) found = t.id; }).catch(() => () => {});
      const t0 = Date.now();
      while (!found && Date.now() - t0 < 6000) await new Promise((r) => setTimeout(r, 300));
      stop();
      if (!found) continue;
      tried.add(found);
      try {
        const tr = await driver.join(found);
        const client = new NetClient(tr, s.players[me].name);
        this.attachClient(client, me);
        this.toast(`Подключились к столу ${newHost.name}`, "good");
        return;
      } catch { /* не вышло — ищем ещё */ }
    }
    this.lost(`Не нашли новый стол «${table}». Можно найти его вручную: меню → «Найти стол».`);
  }

  /** Гость: применяет снимки состояния по очереди и проигрывает их события. */
  private async applyRemote() {
    if (this.applying) return;
    this.applying = true;
    this.stepping = true;
    try {
      while (this.remoteQueue.length) {
        const { state, events } = this.remoteQueue.shift()!;
        this.s = state;
        await this.playEvents(events);
        await this.scene.sync(this.s);
        this.render();
      }
    } finally {
      this.applying = false;
      this.stepping = false;
    }
    const s = this.s;
    this.render();
    if (s.phase === "gameover") { this.showGameOver(); return; }
    if (s.phase === "auction" && s.pending?.kind === "auction" && s.pending.waiting.includes(this.meId) && !this.bidding) {
      this.bidding = true;
      const amount = await this.promptBid(this.meId);
      await this.exec(this.meId, { t: "bid", amount });
      this.bidding = false;
    }
  }

  private lost(why: string) {
    const ov = h("div", { class: "pass" }, h("div", {}, h("h1", {}, "Связь потеряна"), h("p", {}, why), h("p", { class: "muted" }, "Нажмите, чтобы выйти в меню")));
    ov.addEventListener("click", () => this.onExit());
    this.ui.append(ov);
  }

  /** Выполнить действие: у хозяина и в обычной игре — сразу, у гостя — через хозяина. */
  private async exec(pid: number, a: Action): Promise<ActReply> {
    if (this.net?.role === "client") return this.net.client.request(pid, a);
    const n0 = this.s.events.length;
    const r = act(this.s, pid, a);
    return { r, events: this.s.events.slice(n0) };
  }

  /** Хозяин: действие гостя. Для складчины сначала спрашиваем живых партнёров. */
  /** Снос, когда у владельца нет большинства: спрашиваем людей-акционеров. */
  private async withVotes(pid: number, a: Action): Promise<Action> {
    if (a.t !== "demolish") return a;
    const ask = demolishAskList(this.s, a.cell);
    const approve: number[] = [];
    for (const h0 of ask) {
      const ok = await this.askHuman(h0, `${this.s.players[pid].name} хочет снести постройки в «${BOARD[a.cell].name}». Вам вернётся ваша доля половины вложений. Согласны на снос?`);
      if (ok) approve.push(h0);
    }
    return { ...a, approve };
  }

  private async hostRequest(pid: number, a: Action): Promise<ActReply> {
    a = await this.withVotes(pid, a);
    if (a.t === "buyCoop") {
      const declined: string[] = [];
      for (const part of a.partners) {
        const x = this.s.players[part.pid];
        if (x.bot || part.pid === pid) continue;
        const ok = await this.askHuman(part.pid, `${this.s.players[pid].name} зовёт вас в складчину: ${part.lots * 10}% «${BOARD[(this.s.pending as { cell: number }).cell].name}».`);
        if (!ok) declined.push(x.name);
      }
      if (declined.length) return { r: { ok: false, error: `Отказались: ${declined.join(", ")}` }, events: [] };
    }
    const n0 = this.s.events.length;
    const r = act(this.s, pid, a);
    const reply = { r, events: this.s.events.slice(n0) };
    void this.step();
    return reply;
  }

  private get humans() { return this.s.players.filter((p) => !p.bot); }
  /** Люди, которые играют на этом устройстве. */
  private get localHumans() {
    if (this.net) return [this.s.players[this.net.seat]];
    return this.humans;
  }
  private isLocal(pid: number) {
    if (this.net) return pid === this.net.seat && !this.s.players[pid].bot;
    return !this.s.players[pid].bot;
  }
  private get mePlayer() {
    const s = this.s;
    if (this.net) return s.players[this.net.seat];
    if (s.cfg.mode === "solo") return this.humans[0] ?? s.players[0];
    return s.players[this.lastHuman] ?? this.humans[0] ?? s.players[0];
  }

  // ---------- Игровой цикл ----------

  private async step() {
    if (this.net?.role === "client") { this.render(); return; } // гость не ведёт партию
    if (this.stepping) { this.again = true; return; }
    this.stepping = true;
    try {
      do {
        this.again = false;
        const evs = drainEvents(this.s);
        if (this.net?.role === "host") this.net.host.broadcast(this.s, evs);
        await this.playEvents(evs);
        await this.scene.sync(this.s);
        this.render();
        const s = this.s;
        if (!this.net) { if (s.phase === "gameover") clearSave(); else saveGame(s, this.speed); }
        if (s.phase === "gameover") { this.showGameOver(); break; }
        if (s.phase === "auction" && s.pending?.kind === "auction" && s.pending.waiting.length) {
          const pid = s.pending.waiting[0];
          if (!this.isLocal(pid)) break; // ставку сделает гость на своём телефоне
          if (this.localHumans.length > 1) await this.passPhone(s.players[pid].name, "ставка на аукционе");
          const amount = await this.promptBid(pid);
          act(s, pid, { t: "bid", amount });
          this.again = true;
          continue;
        }
        const cur = s.players[s.current];
        if (cur.bot) {
          await this.scene.wait(SPEED[this.speed].bot / 1000);
          botStep(s);
          this.again = true;
        } else if (!this.isLocal(cur.id)) {
          break; // ходит гость — ждём его действие
        } else if (this.localHumans.length > 1 && this.passedTurn !== s.turnCounter) {
          this.passedTurn = s.turnCounter;
          await this.passPhone(cur.name, "ваш ход");
          this.render();
        }
      } while (this.again);
    } finally {
      this.stepping = false;
    }
  }

  private doAction(a: Action) {
    if (this.stepping) return; // идёт анимация — повторные нажатия игнорируем
    this.panel.replaceChildren(h("div", { class: "hint" }, "…")); // пока идёт анимация — без кнопок
    this.cards.replaceChildren();
    void this.exec(this.s.current, a).then(({ r }) => {
      if (!r.ok) { this.toast(r.error ?? "Нельзя", "warn"); this.render(); }
      void this.step();
    });
  }

  /** Выполнить действие и обновить экран (для окон биржи, сделок, стройки). */
  private async run(pid: number, a: Action): Promise<Result> {
    if (this.net?.role !== "client") a = await this.withVotes(pid, a);
    const { r } = await this.exec(pid, a);
    void this.step();
    return r;
  }

  private async playEvents(evs: GameEvent[]) {
    const s = this.s;
    for (const e of evs) {
      this.dbgEvent = e.type;
      switch (e.type) {
        case "dice":
          this.toast(`${s.players[e.player].name}: ${e.a} + ${e.b}${e.a === e.b ? " — дубль!" : ""}`);
          await this.scene.rollDice(e.a, e.b);
          break;
        case "move":
          if (e.teleport) { this.scene.hideDice(); await this.scene.moveToken(e.player, e.path, s.players.length, true); }
          else await this.scene.cinematicMove(e.player, e.path, s.players.length, s.players[e.player].color);
          break;
        case "money": {
          this.flashMoney(e.player, e.delta);
          const inCasino = this.modalView === "casino";
          if (e.player === this.meId && !inCasino && Math.abs(e.delta) >= 1) {
            if (e.delta > 0) sfx.coin(); else sfx.pay();
            if (e.reason.startsWith("дивиденды")) this.toast(`Дивиденды: +${fmt(e.delta)} (${e.reason.replace("дивиденды ", "")})`, "good");
          }
          break;
        }
        case "buy":
          sfx.buy();
          await this.scene.sync(s);
          break;
        case "buildStart":
          sfx.hammer();
          await this.scene.sync(s);
          if (!s.players[e.player].bot && this.speed !== "instant" && !this.modalView) await this.scene.closeUp(e.cell, 1.2);
          break;
        case "buildDone": {
          await this.scene.sync(s);
          const human = !s.players[e.player].bot;
          if (human) sfx.built();
          this.toast(`${s.players[e.player].name}: «${BOARD[e.cell].name}» — уровень ${e.level}${e.fast ? ". Успел! +20% к аренде" : ""}`, e.fast || human ? "good" : "");
          if (human && this.speed !== "instant" && !this.modalView) await this.scene.closeUp(e.cell, 2.2);
          break;
        }
        case "lux": {
          sfx.buy();
          const mine = this.isLocal(e.player) && !s.players[e.player].bot;
          this.toast(e.text, mine ? "good" : "", 3200);
          if (mine && this.modalView === "life") this.closeModal();
          await this.scene.sync(s);
          if (this.speed !== "instant" && !this.modalView) await this.scene.showEstate(e.player, mine ? 2.4 : 1.2);
          break;
        }
        case "ad": {
          const mine = this.isLocal(e.player) && !s.players[e.player].bot;
          this.toast(`${s.players[e.player].name}: «${AD[e.kind].name}» для «${BOARD[e.cell].name}»`, mine ? "good" : "");
          if (mine && this.modalView === "life") this.closeModal();
          await this.scene.sync(s);
          if (mine && this.speed !== "instant" && !this.modalView) await this.scene.closeUp(e.cell, 1.4);
          break;
        }
        case "accident":
          sfx.alert();
          this.toast(`Авария на стройке «${BOARD[e.cell].name}»!`, "warn");
          break;
        case "card":
          sfx.card();
          this.toast(`${e.deck === "news" ? "Новости" : "Госзаказ"}: ${e.text}`, "card", 3500);
          if (this.speed !== "instant") await this.scene.wait(1.6);
          break;
        case "casino":
          if (e.player === this.meId && this.modalView === "casino") break; // результат уже в окне казино
          if (e.data && e.data.done === false) break; // промежуточная раздача блэкджека
          if (e.player === this.meId) { if (e.win > 0) sfx.win(); else if (e.win < 0) sfx.lose(); }
          this.toast(`${s.players[e.player].name} · ${e.game}: ${e.detail} → ${e.win >= 0 ? "+" : ""}${fmt(e.win)}`, e.win > 0 ? "good" : "");
          break;
        case "jackpot":
          sfx.jackpot();
          this.toast(`ДЖЕКПОТ! ${s.players[e.player].name} срывает ${fmt(e.amount)} млн ₽`, "good", 5000);
          break;
        case "stock":
          if (e.players.includes(this.meId) || s.cfg.mode === "hotseat") {
            const toMe = e.text.includes("предлагает") && e.players[1] === this.meId;
            if (toMe) sfx.alert(); else sfx.stock();
            this.toast(toMe ? `${e.text} — откройте «Биржу»` : e.text, toMe ? "card" : "", toMe ? 4500 : 2600);
          }
          if (this.modalView === "exchange") this.showExchange();
          break;
        case "market":
          this.toast(`Рынок: ${e.title}`, "card", 4000);
          break;
        case "bankrupt":
          sfx.bankrupt();
          this.scene.hideToken(e.player);
          this.toast(`${s.players[e.player].name} — банкрот`, "warn", 4000);
          break;
        case "turn":
          if (this.isLocal(e.player)) sfx.turn();
          break;
        case "log":
          this.logLines.push(e.text);
          if (this.logLines.length > 4) this.logLines.shift();
          break;
        case "gameover":
          sfx.win();
          break;
      }
    }
  }

  // ---------- Отрисовка ----------

  private renderTopBar() {
    const s = this.s;
    // вверху — только «я»: в одиночной игре это человек, на одном телефоне — тот, чей сейчас ход (или последний ходивший человек)
    const cur = s.players[s.current];
    if (!cur.bot && !this.net) this.lastHuman = cur.id;
    const me = this.mePlayer;
    const chip = h("div", { class: `chip me${me.bankrupt ? " out" : ""}`, "data-pid": String(me.id) },
      h("span", { class: "dot", style: `background:${me.color}` }),
      h("span", { class: "name" }, me.name),
      h("span", { class: "money" }, `${fmt(me.money)} млн ₽`),
      h("span", { class: "muted cap" }, `капитал ${fmt(capital(s, me.id))}`));
    const others = button("👥 Игроки", () => this.showPlayers(), "small chipbtn");
    const turn = cur.id !== me.id ? h("div", { class: "chip turnchip" }, h("span", { class: "dot", style: `background:${cur.color}` }), `Ходит ${cur.name}`) : "";
    const offers = s.offers.filter((o) => o.to === me.id).length;
    const exch = button(`📈 Биржа и банк${offers ? ` · ${offers}` : ""}`, () => this.showExchange(), `small chipbtn${offers ? " hotbtn" : ""}`);
    const lounge = s.cfg.mode !== "hotseat" && s.current !== me.id && !me.bankrupt && s.phase !== "gameover"
      ? button("🎰 Казино", () => this.openCasino(true), `small chipbtn${canLounge(s, me.id) ? " dim" : ""} casbtn`) : "";
    const life = button(`💎 Жизнь${fame(s, me.id) ? ` ★${fame(s, me.id)}` : ""}`, () => this.showLife(), "small chipbtn");
    this.bar.replaceChildren(chip, others, exch, life, lounge, turn);
  }

  private render() {
    const s = this.s;
    this.renderTopBar();
    this.info.replaceChildren(
      h("div", {}, `Раунд ${s.round}${s.cfg.length === "quick" ? `/${s.cfg.quickRounds ?? 15}` : ""}`),
      button("⌖", () => this.scene.resetView(), "small"),
      button("☰", () => this.showMenu(), "small"),
    );
    this.logBox.replaceChildren(...this.logLines.map((l) => h("div", {}, l)));
    this.renderCards();
    this.renderMyBtn();
    this.renderPanel();
    this.placeCards();
  }

  private lastHuman = 0;
  private get meId() { return this.mePlayer.id; }
  private get modalView() { return this.modal.classList.contains("hidden") ? "" : this.modal.dataset.view ?? ""; }

  /** Игроки: свои деньги видны, чужие — нет; зато видны все карточки соперников, по ним можно предложить сделку. */
  private showPlayers() {
    const s = this.s, me = this.meId;
    const blocks = s.players.map((p) => {
      const cells = Object.keys(s.props).map(Number).filter((i) => s.props[i].owner === p.id);
      const levels = cells.reduce((a, i) => a + s.props[i].level, 0);
      const head = h("div", { class: `prow${p.id === s.current ? " now" : ""}${p.bankrupt ? " out" : ""}` },
        h("span", { class: "dot", style: `background:${p.color}` }),
        h("div", { class: "pname" }, h("b", {}, p.id === me && p.name !== "Вы" ? `${p.name} (вы)` : p.name), h("div", { class: "muted tiny" },
          p.bankrupt ? "банкрот" : `${p.bot ? `бот · ${PERS_NAME[p.personality ?? "trader"]}` : "человек"} · клеток ${cells.length} · уровней ${levels}${p.inCasino ? " · в казино" : ""}`),
          p.bankrupt || (!p.lux.length && !p.buffs.length) ? "" : h("div", { class: "tiny lux-line" },
            `★${fame(s, p.id)} · ${[...p.lux.map((l) => LUX[l.kind].name), ...p.buffs.map((b) => EXPERIENCES[b.kind].name.toLowerCase())].join(", ")}`)),
        h("div", { class: "pmoney" }, p.id === me ? h("b", {}, `${fmt(p.money)} млн ₽`) : h("span", { class: "muted tiny" }, "деньги скрыты")));
      const grid = p.id === me || p.bankrupt ? "" : h("div", { class: "cardgrid small" }, ...cells.map((i) => this.rivalCard(i)));
      return h("div", { class: "pblock" }, head, grid);
    });
    this.openModal(h("h2", {}, "Игроки"),
      h("div", { class: "muted" }, "Чужие деньги не видны. Тапните по карточке соперника — можно предложить выкупить компанию или купить у владельца акции."),
      h("div", { class: "plist" }, ...blocks));
    this.modal.dataset.view = "players";
  }

  /** Карточка чужой клетки: уровень, аренда, доход, доля на бирже. */
  private rivalCard(i: number) {
    const s = this.s, c = BOARD[i], p = s.props[i];
    const income = p.branch === "income" && p.level ? Math.round((c.price ?? 0) * INCOME_SHARE[p.level - 1]) : 0;
    const el = h("div", { class: "ccard mini rival" },
      h("div", { class: "band", style: `background:${c.industry ? INDUSTRIES[c.industry].color : "#8a9199"}` }),
      h("div", { class: "cbody" },
        h("div", { class: "crow" }, h("b", {}, c.name), h("span", { class: "muted" }, p.construction ? `стройка → ${p.construction.target}` : p.level ? `ур. ${p.level}` : p.mortgaged ? "залог" : "участок")),
        h("div", { class: "cmeta" }, p.branch && c.industry ? INDUSTRIES[c.industry].branches[p.branch] : c.industry ? INDUSTRIES[c.industry].name : "транспорт / энергия"),
        h("div", { class: "cmeta" }, `аренда ${fmt(rentFor(s, i))}${income ? ` · доход ${fmt(income)}/раунд` : ""}${p.ad ? ` · 📣 ${AD[p.ad.kind].name.toLowerCase()}` : ""}`),
        h("div", { class: "cmeta" }, soldLots(p) ? `у акционеров ${soldLots(p) * 10}% · 10% = ${fmt(lotPrice(s, i))}` : `акции не продавались · 10% = ${fmt(lotPrice(s, i))}`)));
    el.addEventListener("click", () => { sfx.click(); this.showDeal(i); });
    return el;
  }

  /** Сделка по чужой компании: выкупить целиком или купить акции у владельца. */
  private showDeal(i: number, reply = "") {
    const s = this.s, c = BOARD[i], p = s.props[i], me = this.meId, pl = s.players[me];
    if (p.owner === null || p.owner === me) { this.showCell(i); return; }
    const owner = s.players[p.owner];
    const myTurn = s.current === me && (s.phase === "roll" || s.phase === "end");
    const value = Math.round(companyValue(s, i) * ownerLots(p) / 10);
    const send = async (a: Action) => {
      const r = await this.run(me, a);
      if (!r.ok) { sfx.alert(); this.showDeal(i, r.error ?? "Нельзя"); return; }
      if (r.info?.includes("согласен")) sfx.buy(); else sfx.stock();
      this.renderTopBar();
      this.showDeal(i, r.info ?? "Готово");
    };
    const whole = Object.assign(h("input", { type: "number", min: "1", step: "10", class: "price wide", id: "deal-whole" }), { value: String(Math.round(value * 1.3 / 10) * 10) });
    const free = freeLots(s, p.owner, i);
    const lots = h("select", { class: "who", id: "deal-lots" }, ...Array.from({ length: free }, (_, k) => Object.assign(h("option", { value: String(k + 1) }, `${(k + 1) * 10}%`))));
    const per = Object.assign(h("input", { type: "number", min: "1", step: "1", class: "price", id: "deal-per" }), { value: String(Math.round(lotPrice(s, i) * 1.1)) });
    const dis = myTurn ? "primary" : "primary disabled";
    this.openModal(
      h("h2", {}, `«${c.name}» — ${owner.name}`),
      h("div", { class: "muted" }, `${p.level ? `Уровень ${p.level}` : "Без построек"} · аренда сейчас ${fmt(rentFor(s, i))} · стоимость доли владельца по бирже ≈ ${fmt(value)}`),
      reply ? h("div", { class: `deal-reply${reply.includes("согласен") ? " good" : ""}` }, reply) : "",
      h("h3", {}, "Выкупить компанию целиком"),
      h("div", { class: "muted tiny" }, `Компания станет вашей вместе с постройками${soldLots(p) ? `; акционеры (${soldLots(p) * 10}%) останутся при своих долях` : ""}. Свою монополию бот отдаёт очень дорого.`),
      h("div", { class: "row offerbox" }, whole, h("span", { class: "muted" }, "млн ₽"),
        button("Предложить выкуп", () => send({ t: "bidCompany", cell: i, price: Number(whole.value) }), dis)),
      h("h3", {}, "Купить акции у владельца"),
      free ? h("div", { class: "muted tiny" }, `С каждой аренды и дохода здесь вы будете получать свою долю. Владелец может продать до ${free * 10}%.`)
        : h("div", { class: "muted tiny" }, "Владелец уже продал всё, что можно (оставляет себе 60%). Ищите эти акции на «Бирже»."),
      free ? h("div", { class: "row offerbox" }, lots, h("span", { class: "muted" }, "по"), per, h("span", { class: "muted" }, "за 10%"),
        button("Предложить", () => send({ t: "bidShares", cell: i, lots: Number((lots as HTMLSelectElement).value), price: Number(per.value) }), dis)) : "",
      myTurn ? "" : h("div", { class: "hint" }, "Предлагать сделки можно в свой ход — до броска или в конце хода."),
      h("div", { class: "muted tiny" }, `У вас ${fmt(pl.money)} млн ₽.`),
    );
    this.modal.dataset.view = "deal";
  }

  /** Окно «Мои карточки»: все клетки игрока; по стройкам тапают в чужой ход прямо здесь. */
  private showMyCards() {
    const s = this.s;
    const me = this.mePlayer;
    const mine = Object.entries(s.props).filter(([, p]) => p.owner === me.id).map(([i]) => +i)
      .sort((a, b) => Number(!!s.props[b].construction) - Number(!!s.props[a].construction) || a - b);
    const canTap = s.cfg.mode !== "hotseat" && s.current !== me.id && s.phase !== "gameover";
    const grid = h("div", { class: "cardgrid" }, ...mine.map((i) => this.ownedCard(me.id, i, canTap)));
    const building = mine.some((i) => s.props[i].construction);
    const head = building
      ? (canTap ? `Бригада: ${me.energy} тапов в этом раунде — тапайте по стройкам` : s.cfg.mode !== "hotseat" ? "Тапать по стройкам можно, пока ходят соперники" : "На одном телефоне стройки идут сами, по ходам соперников")
      : "Стройки запускаются в «Стройки и сделки»";
    const keep = this.modal.dataset.view === "mycards" ? this.modal.querySelector(".sheet")?.scrollTop ?? 0 : 0;
    this.openModal(h("h2", {}, `Мои карточки · ${mine.length}`), h("div", { class: "muted" }, head),
      mine.length ? grid : h("div", { class: "hint" }, "У вас пока нет клеток — покупайте, когда встанете на свободную."));
    this.modal.dataset.view = "mycards";
    const sheet = this.modal.querySelector(".sheet");
    if (sheet) sheet.scrollTop = keep;
  }

  private renderMyBtn() {
    const s = this.s;
    const me = this.mePlayer;
    const mine = Object.values(s.props).filter((p) => p.owner === me.id);
    const sites = mine.filter((p) => p.construction).length;
    const tapNow = sites > 0 && s.cfg.mode !== "hotseat" && s.current !== me.id && me.energy > 0 && s.phase !== "gameover";
    this.myBtn.className = `mycards${tapNow ? " hot" : ""}`;
    this.myBtn.replaceChildren(`🃏 Мои карточки · ${mine.length}`, ...(tapNow ? [h("span", { class: "badge" }, "тапай!")] : []));
    if (this.modal.dataset.view === "mycards" && !this.modal.classList.contains("hidden")) this.showMyCards();
  }

  private renderPanel() {
    const s = this.s, cur = s.players[s.current];
    const p = this.panel;
    if (s.phase === "gameover") { p.replaceChildren(); return; }
    if (!this.isLocal(cur.id) || this.waitingPass || this.stepping && s.phase === "auction") {
      p.replaceChildren(h("div", { class: "hint" }, !this.isLocal(cur.id) ? `Ходит ${cur.name}…` : ""));
      return;
    }
    const title = h("div", { class: "turn" }, h("span", { class: "dot", style: `background:${cur.color}` }), `Ход: ${cur.name} · ${fmt(cur.money)} млн ₽`);
    const row = h("div", { class: "row" });
    switch (s.phase) {
      case "roll":
        row.append(button("🎲 Бросить кубики", () => this.doAction({ t: "roll" }), "primary"), button("🏗 Стройки и сделки", () => this.showBuild()));
        break;
      case "decide": {
        const pend = s.pending!;
        const c = BOARD[pend.cell];
        const where = this.portrait ? "ниже" : "справа";
        title.append(h("div", { class: "sub" }, pend.kind === "buy"
          ? `«${c.name}» свободна — тапните по карточке ${where}, чтобы купить`
          : `Аренда «${c.name}» — тапните по карточке ${where}, чтобы заплатить`));
        break;
      }
      case "casino":
        title.append(h("div", { class: "sub" }, `Казино · ставок осталось ${3 - s.casinoBets} · джекпот ${fmt(s.jackpot)}`));
        row.append(button("🎰 Играть в казино", () => this.openCasino(false), "primary"), button("Уйти", () => this.doAction({ t: "leaveCasino" })));
        break;
      case "casinoExit":
        title.append(h("div", { class: "sub" }, "Вы в казино: ход пропускается"));
        row.append(
          button("Заплатить 50 и ходить", () => this.doAction({ t: "payExit" }), "primary"),
          button("Бросить на дубль", () => this.doAction({ t: "rollDouble" })),
          button("Остаться", () => this.doAction({ t: "stay" })),
        );
        break;
      case "end":
        row.append(button("🏗 Стройки и сделки", () => this.showBuild()), button("Завершить ход ➜", () => this.doAction({ t: "endTurn" }), "primary"));
        break;
    }
    p.replaceChildren(title, row);
  }

  /** Столбец карточек справа: клетка, где стоит игрок (по ней тапают, чтобы купить или заплатить), и клетки игрока со стройками. */
  private renderCards() {
    const s = this.s, cur = s.players[s.current], pend = s.pending;
    const deciding = this.isLocal(cur.id) && !this.waitingPass && s.phase === "decide" && pend && (pend.kind === "buy" || pend.kind === "rent");
    // встал на свою компанию — карточка с прокачкой на месте
    const onsite = this.isLocal(cur.id) && !this.waitingPass && (s.phase === "roll" || s.phase === "end") && s.landedOwn === cur.pos && BOARD[cur.pos].kind === "business";
    this.cards.replaceChildren(...(deciding || onsite ? [this.hereCard()] : []));
  }

  private cardShell(i: number, cls: string) {
    const c = BOARD[i];
    const color = c.industry ? INDUSTRIES[c.industry].color : "#8a9199";
    return h("div", { class: `ccard ${cls}` }, h("div", { class: "band", style: `background:${color}` }));
  }

  private hereCard() {
    const s = this.s, cur = s.players[s.current], c = BOARD[cur.pos], p = s.props[cur.pos];
    const pend = s.pending;
    const human = this.isLocal(cur.id);
    const deciding = human && s.phase === "decide" && pend && (pend.kind === "buy" || pend.kind === "rent") && pend.cell === cur.pos;
    const el = this.cardShell(cur.pos, `here${deciding ? " act" : ""}`);
    const body = h("div", { class: "cbody" },
      h("div", { class: "eyebrow" }, human ? (s.cfg.mode !== "hotseat" ? "Вы здесь" : `${cur.name} здесь`) : `${cur.name} здесь`),
      h("div", { class: "cname" }, c.name));
    if (c.industry) body.append(h("div", { class: "cmeta" }, `${INDUSTRIES[c.industry].name} · цена ${c.price}`));
    else if (c.price) body.append(h("div", { class: "cmeta" }, `Цена ${c.price}`));
    if (p?.owner !== null && p?.owner !== undefined) {
      body.append(h("div", { class: "cmeta" }, h("span", { class: "dot", style: `background:${s.players[p.owner].color}` }),
        ` ${s.players[p.owner].name}${p.level ? ` · ур. ${p.level}` : ""} · аренда ${fmt(rentFor(s, cur.pos))}`));
    }
    el.append(body);
    const onsite = human && s.landedOwn === cur.pos && (s.phase === "roll" || s.phase === "end") && c.kind === "business" && p?.owner === cur.id;
    if (onsite) {
      const chk = canBuild(s, cur.id, cur.pos);
      body.append(h("div", { class: "cmeta" }, s.builtThisTurn ? "В этот ход уже строили" : "Вы на своей компании — здесь можно строить (один раз за ход)"),
        button(chk.ok || chk.reason === "Не хватает денег" ? `🏗 Прокачать здесь${chk.cost ? ` — ${fmt(chk.cost)}` : ""}` : `🏗 ${chk.reason}`, () => this.showBuild(cur.pos), "small"));
    }
    if (deciding && pend) {
      if (pend.kind === "buy") {
        const can = cur.money >= c.price!;
        body.append(h("div", { class: "tapzone" }, can ? `Тапните — купить за ${c.price}` : `Не хватает: нужно ${c.price}`));
        if (can) el.addEventListener("click", () => this.doAction({ t: "buy" }));
        else body.append(button("💰 Найти деньги: вклад, кредит, залог", () => this.showFinance(c.price! - cur.money), "small"));
        if (s.players.filter((x) => !x.bankrupt).length > 1) body.append(button("🤝 Купить в складчину", () => this.showCoop(pend.cell), "small ghost"));
        body.append(button("На аукцион", () => this.doAction({ t: "decline" }), "small ghost"));
      } else {
        body.append(h("div", { class: "tapzone" }, `Тапните — заплатить ${fmt(pend.amount)} → ${s.players[pend.owner].name}`));
        el.addEventListener("click", () => this.doAction({ t: "payRent" }));
        body.append(button(`Отработать: заплатить ${fmt(pend.amount * (1 - WORKOFF_DISCOUNT))} и пропустить ход`, () => this.doAction({ t: "workOff" }), "small ghost"));
      }
    }
    return el;
  }

  private ownedCard(pid: number, i: number, canTap: boolean) {
    const s = this.s, c = BOARD[i], p = s.props[i];
    const me = s.players[pid];
    const site = p.construction;
    const tappable = !!site && canTap && me.energy > 0;
    const el = this.cardShell(i, `mini${tappable ? " tappable" : ""}${s.players[s.current].pos === i && s.current !== pid ? " visited" : ""}`);
    const status = site ? `стройка → ур. ${site.target}` : p.mortgaged ? "в залоге" : p.level ? `ур. ${p.level}` : "участок";
    const body = h("div", { class: "cbody" },
      h("div", { class: "crow" }, h("b", {}, c.name), h("span", { class: "muted" }, status)),
      h("div", { class: "cmeta" }, `аренда ${fmt(rentFor(s, i))}${p.ad ? ` · 📣 ещё ${p.ad.rounds} х.` : ""}`));
    if (site) {
      body.append(h("div", { class: "prog" }, h("div", { style: `width:${Math.min(100, site.progress)}%` })),
        h("div", { class: "cmeta" }, tappable ? `${Math.floor(Math.min(100, site.progress))}% · тапайте!` : `${Math.floor(Math.min(100, site.progress))}%`));
    }
    el.append(body);
    if (tappable) {
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const local = this.net?.role !== "client";
        if (local) { const r = act(s, pid, { t: "tap", cell: i }); if (!r.ok) return; }
        else { // у гостя: показываем сразу, хозяин пересчитает
          const p0 = s.props[i];
          if (!p0.construction || s.players[pid].energy <= 0) return;
          s.players[pid].energy -= 1; p0.construction.progress = Math.min(100, p0.construction.progress + 1);
          void this.exec(pid, { t: "tap", cell: i });
        }
        const done = s.props[i].construction === null;
        if (done) { void this.step(); this.showMyCards(); return; }
        this.showMyCards();
        const fresh = [...this.modal.querySelectorAll(".ccard.mini")].find((n) => n.getAttribute("data-cell") === String(i));
        fresh?.classList.add("pop");
        this.renderMyBtn();
        void this.scene.sync(s);
      });
    } else {
      el.addEventListener("click", () => this.showCell(i));
    }
    el.setAttribute("data-cell", String(i));
    return el;
  }

  // ---------- Окна ----------

  private openModal(...kids: (Node | string)[]) {
    delete this.modal.dataset.view;
    this.modal.replaceChildren(h("div", { class: "sheet" }, button("✕", () => this.closeModal(), "close"), ...kids));
    this.modal.classList.remove("hidden");
  }

  private closeModal() { this.modal.classList.add("hidden"); this.modal.replaceChildren(); delete this.modal.dataset.view; }

  private showBuild(focus?: number) {
    const s = this.s, me = s.players[s.current];
    focus ??= s.landedOwn ?? undefined;
    const opts = h("div", { class: "row" });
    const rush = h("label", {}, Object.assign(h("input", { type: "checkbox" }), { checked: this.rush }), " Штурмовая (вдвое быстрее, 20% риск аварии)");
    const ins = h("label", {}, Object.assign(h("input", { type: "checkbox" }), { checked: this.insure }), " Страховка (+10%)");
    rush.querySelector("input")!.addEventListener("change", (e) => { this.rush = (e.target as HTMLInputElement).checked; });
    ins.querySelector("input")!.addEventListener("change", (e) => { this.insure = (e.target as HTMLInputElement).checked; });
    opts.append(rush, ins);
    const list = h("div", { class: "list" });
    const owned = Object.entries(s.props).filter(([, p]) => p.owner === me.id).map(([i]) => +i)
      .sort((a, b) => Number(b === focus) - Number(a === focus));
    if (!owned.length) list.append(h("div", { class: "hint" }, "У вас пока нет клеток."));
    for (const i of owned) {
      const c = BOARD[i], p = s.props[i];
      const item = h("div", { class: `item${i === focus ? " focus" : ""}` });
      if (s.landedOwn === i) item.append(h("div", { class: "tiny up" }, "Вы здесь — можно строить"));
      const status = p.construction ? `стройка ур. ${p.construction.target}: ${Math.floor(p.construction.progress)}%`
        : p.level ? `ур. ${p.level} · ${BRANCH_TITLE[p.branch!]}` : p.mortgaged ? "в залоге" : "участок";
      item.append(h("div", { class: "item-head" },
        h("span", { class: "dot", style: `background:${c.industry ? INDUSTRIES[c.industry].color : "#999"}` }),
        h("b", {}, c.name), h("span", { class: "muted" }, ` · ${status} · аренда ${fmt(rentFor(s, i))}`)));
      const acts = h("div", { class: "row" });
      if (c.kind === "business" && !p.construction && !p.mortgaged && p.level < 3) {
        const chk = canBuild(s, me.id, i);
        const lvl = p.level + 1;
        if (!chk.ok && chk.reason !== "Не хватает денег") acts.append(h("span", { class: "muted" }, chk.reason ?? ""));
        else if (lvl === 1) {
          for (const br of ["rent", "income", "special"] as BranchId[]) {
            const title = `${INDUSTRIES[c.industry!].branches[br]} — ${fmt(buildCost(s, me.id, i, 1))}`;
            const btn = button(title, () => { this.closeModal(); this.doAction({ t: "build", cell: i, branch: br, rush: this.rush, insure: this.insure }); }, chk.ok ? "" : "disabled");
            btn.title = br === "special" ? BRANCH_EFFECTS[c.industry!] : BRANCH_HINT[br];
            acts.append(h("div", { class: "branch" }, btn, h("div", { class: "muted tiny" }, br === "special" ? BRANCH_EFFECTS[c.industry!] : BRANCH_HINT[br])));
          }
        } else {
          acts.append(button(`Строить ур. ${lvl} — ${fmt(chk.cost ?? buildCost(s, me.id, i, lvl))}`,
            () => { this.closeModal(); this.doAction({ t: "build", cell: i, rush: this.rush, insure: this.insure }); }, chk.ok ? "" : "disabled"));
        }
      }
      if (c.kind === "business" && p.level >= 1 && p.branch && !p.construction) {
        const others = (["rent", "income", "special"] as BranchId[]).filter((b) => b !== p.branch).map((b) => `«${INDUSTRIES[c.industry!].branches[b]}»`).join(" и ");
        item.append(h("div", { class: "branchlock" },
          h("span", {}, `Ветка выбрана: «${INDUSTRIES[c.industry!].branches[p.branch]}». ${others} закрыты — у здания одна ветка. Сменить можно, снеся постройки: вернётся ${fmt(p.invested / 2)}${soldLots(p) ? ", поделим по долям с акционерами" : ""}${demolishAskList(s, i).length ? "; у вас меньше половины — нужно согласие акционеров" : ""}. После сноса сразу можно строить заново.`),
          button("Снести", () => { void this.run(me.id, { t: "demolish", cell: i }).then((r) => { if (!r.ok) this.toast(r.error ?? "Нельзя", "warn"); else { sfx.hammer(); this.toast(`«${c.name}» снесено — выберите, что строить`, "good"); } this.showBuild(i); }); }, "small ghost")));
      }
      if (p.construction) {
        const cost = Math.round(buildCost(s, me.id, i, p.construction.target) * 0.1);
        acts.append(button(`Сверхурочные +25% — ${fmt(cost)}`, () => { this.doAction({ t: "overtime", cell: i }); this.showBuild(); }));
      }
      if (!p.mortgaged && p.level === 0 && !p.construction) acts.append(button(`Заложить +${fmt(c.price! / 2)}`, () => { this.doAction({ t: "mortgage", cell: i }); this.showBuild(); }, "ghost"));
      if (p.mortgaged) acts.append(button(`Выкупить −${fmt(c.price! * 0.6)}`, () => { this.doAction({ t: "unmortgage", cell: i }); this.showBuild(); }, "ghost"));
      item.append(acts);
      list.append(item);
    }
    const take = BOARD.filter((c) => canTakeover(s, me.id, c.index).cost !== undefined);
    if (take.length) {
      list.append(h("h3", {}, "Слияние — выкуп последней клетки отрасли"));
      for (const c of take) {
        const t = canTakeover(s, me.id, c.index);
        list.append(h("div", { class: "item" }, h("b", {}, c.name), ` у ${s.players[s.props[c.index].owner!].name} `,
          button(`Выкупить за ${fmt(t.cost!)}`, () => { this.closeModal(); this.doAction({ t: "takeover", cell: c.index }); }, t.ok ? "" : "disabled")));
      }
    }
    this.openModal(h("h2", {}, "Стройки и сделки"), h("div", { class: "muted" }, `Деньги: ${fmt(me.money)} млн ₽ · строить можно только на клетке, где вы стоите (или которую только что купили), один раз за ход`), opts, list);
  }

  /** Казино: lounge = играть, пока ходят другие; иначе — визит на клетку «Казино». */
  private openCasino(lounge: boolean) {
    sfx.click();
    const app = this;
    const pid = lounge ? this.meId : this.s.current;
    const view = new CasinoView({
      get s() { return app.s; },
      act: (a) => this.exec(pid, a),
      pid, lounge, instant: this.speed === "instant",
      after: () => { this.renderTopBar(); void this.step(); },
      close: () => this.closeModal(),
    });
    this.openModal(view.root);
    this.modal.dataset.view = "casino";
  }

  /** Складчина: игрок сам выбирает, кого позвать и какие доли (по 10%, всего до 40%). */
  private showCoop(cellI: number, note = "") {
    const s = this.s, me = s.current, pl = s.players[me], c = BOARD[cellI], price = c.price!;
    const others = s.players.filter((x) => x.id !== me && !x.bankrupt);
    const sel: Record<number, HTMLSelectElement> = {};
    const mineEl = h("b", {});
    const update = () => {
      const parts = others.reduce((t, x) => t + Math.ceil(price * Number(sel[x.id].value) / 10), 0);
      const lots = others.reduce((t, x) => t + Number(sel[x.id].value), 0);
      mineEl.textContent = lots > 4 ? "партнёрам не больше 40%" : `${fmt(price - parts)} (у вас ${fmt(pl.money)})`;
    };
    const rows = others.map((x) => {
      sel[x.id] = h("select", { class: "who", id: `coop-${x.id}` }, ...[0, 1, 2, 3, 4].map((n) => h("option", { value: String(n) }, n ? `${n * 10}% — ${fmt(Math.ceil(price * n / 10))}` : "не звать"))) as HTMLSelectElement;
      sel[x.id].addEventListener("change", update);
      return h("div", { class: "prow" }, h("span", { class: "dot", style: `background:${x.color}` }), h("div", { class: "pname" }, h("b", {}, x.name), h("div", { class: "muted tiny" }, x.bot ? `бот · ${PERS_NAME[x.personality ?? "trader"]}` : "человек")), sel[x.id]);
    });
    const go = async () => {
      let parts = others.map((x) => ({ pid: x.id, lots: Number(sel[x.id].value) })).filter((x) => x.lots > 0);
      if (!parts.length) { this.showCoop(cellI, "Выберите хотя бы одного партнёра"); return; }
      const declined: string[] = [];
      for (const part of parts) {
        const x = s.players[part.pid];
        const yes = x.bot ? coopAnswer(s, part.pid, cellI, part.lots) : this.net?.role === "client" ? true : await this.askHuman(part.pid, `${pl.name} зовёт вас в складчину: ${part.lots * 10}% «${c.name}» за ${fmt(Math.ceil(price * part.lots / 10))}. Вы будете получать ${part.lots * 10}% аренды и дохода.`);
        if (!yes) declined.push(x.name);
      }
      if (declined.length) {
        sfx.alert();
        parts = parts.filter((x) => !declined.includes(s.players[x.pid].name));
        this.showCoop(cellI, `Отказались: ${declined.join(", ")}. Измените доли или позовите других.`);
        return;
      }
      const r = await this.run(me, { t: "buyCoop", partners: parts });
      if (!r.ok) { sfx.alert(); this.showCoop(cellI, r.error ?? "Не получилось"); return; }
      this.closeModal();
    };
    this.openModal(h("h2", {}, `«${c.name}» в складчину`),
      h("div", { class: "muted" }, `Цена ${fmt(price)}. Партнёры платят свою часть и получают акции (до 40% на всех) — им будет идти их доля аренды. Клетка — ваша, вы управляете стройкой.`),
      note ? h("div", { class: "deal-reply" }, note) : "",
      h("div", { class: "plist" }, ...rows),
      h("div", {}, "Ваша часть: ", mineEl),
      h("div", { class: "row" }, button("Предложить", () => void go(), "primary"), button("Назад", () => this.closeModal(), "ghost")));
    update();
  }

  /** Вопрос другому человеку (на одном телефоне — через «Передайте телефон»). */
  private async askHuman(pid: number, question: string): Promise<boolean> {
    const s = this.s, x = s.players[pid];
    if (this.net?.role === "host" && pid !== this.net.seat) return this.net.host.ask(pid, question);
    if (this.localHumans.length > 1) await this.passPhone(x.name, "вопрос о сделке");
    return this.askLocal(x.name, question);
  }

  private askLocal(name: string, question: string): Promise<boolean> {
    return new Promise((res) => {
      const x = { name };
      const done = (v: boolean) => { this.closeModal(); res(v); };
      this.openModal(h("h2", {}, x.name), h("div", {}, question),
        h("div", { class: "row" }, button("Согласен", () => done(true), "primary"), button("Нет", () => done(false))));
      this.modal.querySelector(".close")!.addEventListener("click", () => res(false));
    });
  }

  /** «Где взять деньги» прямо во время покупки: снять со вклада, кредит, заложить клетку, продать роскошь. */
  private showFinance(need: number) {
    const s = this.s, me = s.current, pl = s.players[me];
    const run = (a: Action) => {
      void this.run(me, a).then((r) => {
        if (!r.ok) { this.toast(r.error ?? "Нельзя", "warn"); sfx.alert(); } else sfx.coin();
        this.render();
        const p = s.pending;
        const lack = p?.kind === "buy" ? (BOARD[p.cell].price ?? 0) - s.players[me].money : 0;
        if (lack > 0) this.showFinance(lack); else { this.closeModal(); this.toast("Денег хватает — тапните по карточке, чтобы купить", "good"); }
      });
    };
    const sec: Node[] = [];
    if (pl.deposit > 0) sec.push(h("div", { class: "item" }, h("b", {}, `На вкладе ${fmt(pl.deposit)}`),
      h("div", { class: "row" }, button(`Снять ${fmt(Math.min(pl.deposit, need))}`, () => run({ t: "withdraw", amount: Math.min(pl.deposit, need) }), "primary"),
        pl.deposit > need ? button(`Снять всё`, () => run({ t: "withdraw", amount: pl.deposit }), "ghost") : "")));
    const mort = Object.keys(s.props).map(Number).filter((i) => s.props[i].owner === me && !s.props[i].mortgaged && s.props[i].level === 0 && !s.props[i].construction && !pl.loans.some((l) => l.cell === i && l.kind === "company"));
    if (mort.length) {
      sec.push(h("h3", {}, "Заложить клетку (половина цены, выкуп — 60%)"));
      for (const i of mort) sec.push(h("div", { class: "item" }, h("b", {}, BOARD[i].name), " ", button(`Заложить +${fmt(BOARD[i].price! / 2)}`, () => run({ t: "mortgage", cell: i }))));
    }
    for (const it of pl.lux) sec.push(h("div", { class: "item" }, h("b", {}, LUX[it.kind].name), " ", button(`Продать +${fmt(it.value)}`, () => run({ t: "sellLux", id: it.id }), "ghost")));
    sec.push(...this.bankSection(me, true, run).slice(3)); // только кредиты
    this.openModal(h("h2", {}, `Не хватает ${fmt(need)} млн ₽`), h("div", { class: "muted" }, `У вас ${fmt(pl.money)}. Наберите недостающее — и покупайте.`), ...sec);
    this.modal.dataset.view = "finance";
  }

  /** Банк: кредиты под залог своих компаний или акций. */
  private bankSection(me: number, myTurn: boolean, run: (a: Action) => void): Node[] {
    const s = this.s, pl = s.players[me];
    const out: Node[] = [h("h3", {}, "🏦 Банк: вклад под процент")];
    out.push(h("div", { class: "muted tiny" }, `${DEPOSIT_RATE * 100}% от вклада каждый ваш ход. Снять можно в любой свой ход; если не хватит на платёж — банк сам снимет со вклада. Вклад считается в капитале. Выгодно, когда деньги лежат без дела: соперник не отнимет, казино не проиграете.`));
    const depIn = Object.assign(h("input", { type: "number", class: "price", min: "1", step: "50", id: "dep-amount" }), { value: String(Math.max(0, Math.floor(pl.money / 2 / 50) * 50)) });
    out.push(h("div", { class: "item" },
      h("div", {}, h("b", {}, `На вкладе ${fmt(pl.deposit)}`), h("span", { class: "muted" }, pl.deposit ? ` · следующий ход +${fmt(Math.floor(pl.deposit * DEPOSIT_RATE))}` : "")),
      h("div", { class: "row offerbox" }, depIn,
        button("Положить", () => run({ t: "deposit", amount: Number(depIn.value) }), myTurn ? "primary" : "disabled"),
        button("Снять", () => run({ t: "withdraw", amount: Math.min(pl.deposit, Number(depIn.value)) }), myTurn && pl.deposit ? "" : "disabled"),
        pl.deposit ? button("Снять всё", () => run({ t: "withdraw", amount: pl.deposit }), myTurn ? "ghost" : "ghost disabled") : "")));
    out.push(h("h3", {}, "🏦 Банк: кредит под залог"));
    out.push(h("div", { class: "muted tiny" }, `До ${Math.round(loanShare(s, me) * 100)}% стоимости залога. Проценты ${Math.round(loanRate(s, me) * 100)}% от суммы каждый ваш ход${pl.lux.some((l) => l.kind === "mansion") ? " (особняк: банк вам доверяет)" : ""}. Срок — 5 раундов: не вернули — банк продаёт залог с аукциона (компанию целиком, акции — по 10%), остаток сверх долга — вам. Компания в залоге продолжает приносить аренду.`));
    for (const l of pl.loans) {
      out.push(h("div", { class: "item offer" },
        h("div", {}, h("b", {}, `Кредит ${fmt(l.amount)}`), ` под ${l.kind === "company" ? `«${BOARD[l.cell].name}»` : `акции «${BOARD[l.cell].name}»`} · вернуть до ${l.due}-го раунда (сейчас ${s.round})`),
        h("div", { class: "row" }, button(`Погасить ${fmt(l.amount)}`, () => run({ t: "repayLoan", id: l.id }), myTurn && pl.money >= l.amount ? "primary" : "disabled"))));
    }
    const options: { cell: number; kind: "company" | "shares"; lim: number }[] = [];
    for (const k of Object.keys(s.props).map(Number)) {
      for (const kind of ["company", "shares"] as const) {
        const lim = loanLimit(s, me, k, kind);
        if (lim >= 10) options.push({ cell: k, kind, lim });
      }
    }
    if (!options.length && !pl.loans.length) out.push(h("div", { class: "hint" }, "Нечего заложить: нужны свои компании (не в ипотечном залоге) или акции."));
    for (const o of options) {
      const amt = Object.assign(h("input", { type: "number", class: "price", min: "10", step: "10", id: `loan-${o.kind}-${o.cell}` }), { value: String(o.lim) });
      out.push(h("div", { class: "item" },
        h("div", {}, h("b", {}, o.kind === "company" ? `«${BOARD[o.cell].name}»` : `Акции «${BOARD[o.cell].name}»`), h("span", { class: "muted" }, ` · можно до ${fmt(o.lim)}`)),
        h("div", { class: "row offerbox" }, amt, button("Взять кредит", () => run({ t: "takeLoan", cell: o.cell, kind: o.kind, amount: Number(amt.value) }), myTurn ? "" : "disabled"))));
    }
    return out;
  }

  /** Биржа: предложения, свои компании, свои акции и рынок. */
  private showExchange() {
    const s = this.s, me = this.meId, pl = s.players[me];
    const myTurn = s.current === me && (s.phase === "roll" || s.phase === "end" || s.phase === "decide");
    const run = (a: Action, by = me) => {
      void this.run(by, a).then((r) => {
        if (!r.ok) { this.toast(r.error ?? "Нельзя", "warn"); sfx.alert(); } else sfx.stock();
        this.showExchange();
        this.renderTopBar();
      });
    };
    const keep = this.modalView === "exchange" ? this.modal.querySelector(".sheet")?.scrollTop ?? 0 : 0;
    const trend = (i: number) => {
      const d = s.props[i].demand;
      return d > 1.03 ? h("span", { class: "up" }, ` ▲${Math.round((d - 1) * 100)}%`) : d < 0.97 ? h("span", { class: "down" }, ` ▼${Math.round((1 - d) * 100)}%`) : "";
    };
    const sections: Node[] = [];

    const offers = s.offers.filter((o) => o.to === me);
    if (offers.length) {
      sections.push(h("h3", {}, "Вам предлагают"));
      for (const o of offers) {
        const total = o.whole ? o.price : o.price * o.lots;
        const title = o.kind === "sell"
          ? [h("b", {}, `${o.lots * 10}% «${BOARD[o.cell].name}»`), ` — ${s.players[o.from].name} продаёт вам за ${fmt(total)}`]
          : [h("b", {}, o.whole ? `«${BOARD[o.cell].name}» целиком` : `${o.lots * 10}% «${BOARD[o.cell].name}»`), ` — ${s.players[o.from].name} хочет купить у вас за ${fmt(total)}`];
        const hint = o.kind === "sell"
          ? `На бирже 10% стоит ${fmt(lotPrice(s, o.cell))} · аренда сейчас ${fmt(rentFor(s, o.cell))}, ваша доля дивидендов ${o.lots * 10}%`
          : o.whole ? `Ваша доля по бирже ≈ ${fmt(companyValue(s, o.cell) * ownerLots(s.props[o.cell]) / 10)} · аренда ${fmt(rentFor(s, o.cell))}`
            : `На бирже 10% стоит ${fmt(lotPrice(s, o.cell))}. Продажа доли: деньги сразу, аренда +5% и стройка −5% за каждые 10% у акционеров`;
        sections.push(h("div", { class: "item offer" },
          h("div", {}, ...title),
          h("div", { class: "muted tiny" }, hint),
          h("div", { class: "row" }, button("Принять", () => run({ t: "acceptOffer", id: o.id }), "primary"), button("Отказать", () => run({ t: "declineOffer", id: o.id })))));
      }
    }

    const mine = Object.keys(s.props).map(Number).filter((i) => s.props[i].owner === me);
    sections.push(h("h3", {}, "Мои компании"));
    if (!mine.length) sections.push(h("div", { class: "hint" }, "Пока нет компаний."));
    for (const i of mine) {
      const p = s.props[i];
      const listed = p.listings.filter((l) => l.seller === me).reduce((a, l) => a + l.lots, 0);
      const holders = Object.entries(p.holders).map(([id, n]) => `${s.players[+id].name} ${n * 10}%`).join(", ");
      const row = h("div", { class: "row" });
      if (freeLots(s, me, i) > 0) {
        row.append(button(`Выставить 10% за ${fmt(lotPrice(s, i))}`, () => run({ t: "listShares", cell: i, lots: 1 }), myTurn ? "" : "disabled"));
        const sel = h("select", { class: "who" }, ...s.players.filter((x) => x.id !== me && !x.bankrupt).map((x) => Object.assign(h("option", { value: String(x.id) }, x.name))));
        const price = Object.assign(h("input", { type: "number", class: "price", min: "1", step: "1" }), { value: String(Math.round(lotPrice(s, i) * 1.05)) });
        row.append(h("span", { class: "offerbox" }, sel, price, button("Предложить 10%", () => run({ t: "offerShares", cell: i, lots: 1, to: Number((sel as HTMLSelectElement).value), price: Number(price.value) }), myTurn ? "" : "disabled")));
      }
      if (listed) row.append(button(`Снять с продажи (${listed * 10}%)`, () => run({ t: "unlistShares", cell: i }), myTurn ? "ghost" : "ghost disabled"));
      sections.push(h("div", { class: "item" },
        h("div", { class: "item-head" }, h("b", {}, BOARD[i].name), h("span", { class: "muted" }, ` · у вас ${ownerLots(p) * 10}% · компания ${fmt(companyValue(s, i))}`), trend(i)),
        h("div", { class: "muted tiny" }, soldLots(p) ? `Акционеры: ${holders}. Они получают свою долю аренды и дохода.` : "Акционеров нет — вся аренда ваша. Можно продать до 40%."),
        row));
    }

    const held = Object.keys(s.props).map(Number).filter((i) => (s.props[i].holders[me] ?? 0) > 0);
    if (held.length) {
      sections.push(h("h3", {}, "Мои акции"));
      for (const i of held) {
        const p = s.props[i], n = p.holders[me];
        const listed = p.listings.filter((l) => l.seller === me).reduce((a, l) => a + l.lots, 0);
        const row = h("div", { class: "row" });
        if (freeLots(s, me, i) > 0) row.append(button(`Продать 10% за ${fmt(lotPrice(s, i))}`, () => run({ t: "listShares", cell: i, lots: 1 }), myTurn ? "" : "disabled"));
        if (listed) row.append(button(`Снять с продажи (${listed * 10}%)`, () => run({ t: "unlistShares", cell: i }), myTurn ? "ghost" : "ghost disabled"));
        sections.push(h("div", { class: "item" },
          h("div", { class: "item-head" }, h("b", {}, `${BOARD[i].name} · ${n * 10}%`), h("span", { class: "muted" }, ` · владелец ${s.players[p.owner!].name} · 10% = ${fmt(lotPrice(s, i))}`), trend(i)),
          h("div", { class: "muted tiny" }, `С каждой аренды здесь вы получаете ${n * 10}%: сейчас это ${fmt(rentFor(s, i) * n / 10)}`), row));
      }
    }

    sections.push(...this.bankSection(me, myTurn, run));

    const market = Object.keys(s.props).map(Number).filter((i) => s.props[i].listings.some((l) => l.seller !== me));
    sections.push(h("h3", {}, "Биржа"));
    if (!market.length) sections.push(h("div", { class: "hint" }, "Сейчас никто не продаёт акции."));
    for (const i of market) {
      const p = s.props[i];
      const lots = p.listings.filter((l) => l.seller !== me).reduce((a, l) => a + l.lots, 0);
      const sellers = [...new Set(p.listings.filter((l) => l.seller !== me).map((l) => s.players[l.seller].name))].join(", ");
      const per10 = rentFor(s, i) / 10;
      sections.push(h("div", { class: "item" },
        h("div", { class: "item-head" }, h("b", {}, BOARD[i].name), h("span", { class: "muted" }, ` · в продаже ${lots * 10}% · продаёт ${sellers}`), trend(i)),
        h("div", { class: "muted tiny" }, `Владелец ${s.players[p.owner!].name} · аренда ${fmt(rentFor(s, i))} → на 10% приходится ${fmt(per10)} с каждого гостя`),
        h("div", { class: "row" }, button(`Купить 10% за ${fmt(lotPrice(s, i))}`, () => run({ t: "buyShares", cell: i, lots: 1 }), myTurn && pl.money >= lotPrice(s, i) ? "primary" : "disabled"))));
    }

    this.openModal(h("h2", {}, "Биржа и банк"),
      h("div", { class: "muted" }, myTurn
        ? "Цена растёт, когда акции покупают, и падает, когда их много в продаже. От цены зависит стоимость компании и ваш капитал."
        : "Покупать и выставлять акции можно в свой ход — до броска или в конце хода. Принять предложение можно в любой момент."),
      h("div", { class: "perks" }, h("b", {}, "Зачем продавать акции: "),
        "деньги сразу, без залога; за каждые 10% у акционеров — аренда +5%, стройка дешевле на 5% и быстрее на 10%; ",
        `с ${PUBLIC_PROTECT_LOTS * 10}% у акционеров компанию нельзя отнять «Слиянием»; каждый новый уровень поднимает цену акций на 10%.`),
      ...sections);
    this.modal.dataset.view = "exchange";
    const sheet = this.modal.querySelector(".sheet");
    if (sheet) sheet.scrollTop = keep;
  }

  /** «Жизнь»: роскошь (статус), отдых и семья, реклама своих компаний. */
  private showLife() {
    const s = this.s, me = this.meId, pl = s.players[me];
    const myTurn = s.current === me && (s.phase === "roll" || s.phase === "end");
    const run = (a: Action) => {
      void this.run(me, a).then((r) => {
        if (!r.ok) { this.toast(r.error ?? "Нельзя", "warn"); sfx.alert(); }
        if (this.modalView === "life" || !r.ok) this.showLife();
        this.renderTopBar();
      });
    };
    const keep = this.modalView === "life" ? this.modal.querySelector(".sheet")?.scrollTop ?? 0 : 0;
    const f = fame(s, me);
    const sec: Node[] = [];
    sec.push(h("div", { class: "perks" }, h("b", {}, `Статус ★${f}`), ` — +${Math.round(f * FAME_RENT * 100)}% к аренде и доходу всех ваших компаний. `,
      "Каждая звезда даёт +3%. Звёзды дают вещи (пока они ваши) и вечеринки, отдых, подарки (на 3 хода). Со статусом боты уступают в сделках и охотнее идут в складчину. ",
      `Всё купленное стоит на вашем участке в центре поля — соперники видят. Налог на роскошь: ${LUX_TAX * 100}% с вещей, ${EXP_TAX * 100}% с вечеринки и отдыха; на клетке «Налог на роскошь» — ${fmt(luxuryTaxCell(s, me))} (75 + 5% стоимости вещей).`));

    sec.push(h("h3", {}, "💎 Роскошь"));
    if (pl.lux.length) {
      for (const it of pl.lux) {
        const d = it.value - it.paid;
        sec.push(h("div", { class: "item" },
          h("div", { class: "item-head" }, h("b", {}, LUX[it.kind].name), h("span", { class: "muted" }, ` · ★${LUX[it.kind].fame} · стоит сейчас ${fmt(it.value)}`),
            d ? h("span", { class: d > 0 ? "up" : "down" }, ` ${d > 0 ? "▲" : "▼"}${fmt(Math.abs(d))}`) : ""),
          button(`Продать за ${fmt(it.value)}`, () => run({ t: "sellLux", id: it.id }), myTurn ? "small ghost" : "small ghost disabled")));
      }
    }
    for (const k of Object.keys(LUX) as LuxKind[]) {
      const spec = LUX[k], cost = luxCost(k);
      if (pl.lux.filter((l) => l.kind === k).length >= spec.max) continue;
      const pay = luxPayback(s, me, k);
      sec.push(h("div", { class: "item" },
        h("div", { class: "item-head" }, h("b", {}, spec.name), h("span", { class: "muted" }, ` · ★${spec.fame} · ${fmt(spec.price)} + налог ${fmt(cost - spec.price)}`)),
        h("div", { class: "muted tiny" }, spec.perk),
        h("div", { class: `tiny ${pay ? "up" : "muted"}` }, pay ? `При ваших доходах окупится статусом примерно за ${pay} кр. (с учётом перепродажи)` : "Пока не окупится: мало доходных компаний или партия скоро кончится. Берите для удовольствия или позже."),
        h("div", { class: "row" }, button(`Купить за ${fmt(cost)}`, () => run({ t: "buyLux", kind: k }), myTurn && pl.money >= cost ? "primary" : "disabled"))));
    }

    sec.push(h("h3", {}, "🌴 Отдых и семья"));
    for (const k of Object.keys(EXPERIENCES) as ExpKind[]) {
      const spec = EXPERIENCES[k], cost = expCost(k), on = pl.buffs.find((b) => b.kind === k);
      const extra = k === "party" && pl.lux.some((l) => l.kind === "yacht") ? " На яхте — ★8!" : "";
      sec.push(h("div", { class: "item" },
        h("div", { class: "item-head" }, h("b", {}, spec.name), h("span", { class: "muted" }, ` · ★${spec.fame} на ${spec.rounds} хода · ${fmt(cost)}${k === "gifts" ? " без налога" : " с налогом"}`)),
        h("div", { class: "muted tiny" }, spec.perk + extra),
        k === "gifts" ? h("div", { class: "tiny muted" }, `Семейная заначка: ${fmt(pl.stash)} из ${STASH_MAX}`) : "",
        on ? h("div", { class: "tiny up" }, `Действует ещё ${on.rounds} х.`)
          : h("div", { class: "row" }, button(`${k === "party" ? "Устроить" : k === "vacation" ? "Поехать" : "Подарить"} за ${fmt(cost)}`, () => run({ t: "experience", kind: k }), myTurn && pl.money >= cost ? "primary" : "disabled"))));
    }

    sec.push(h("h3", {}, "📣 Реклама своих компаний"));
    sec.push(h("div", { class: "muted tiny" }, `${AD.flyers.name}: ${AD.flyers.text}. ${AD.tv.name}: ${AD.tv.text}. Продажи — деньги каждый ваш ход, даже если к вам никто не зашёл; акционеры получают свою долю. Чем доходнее компания, тем выгоднее реклама; каждая следующая кампания одновременно дороже на 15%.`));
    const mine = Object.keys(s.props).map(Number).filter((i) => s.props[i].owner === me).sort((a, b) => rentFor(s, b, 7, false) - rentFor(s, a, 7, false));
    if (!mine.length) sec.push(h("div", { class: "hint" }, "Рекламировать пока нечего — купите компанию."));
    for (const i of mine) {
      const p = s.props[i];
      const r = rentFor(s, i, 7, false);
      const row = h("div", { class: "row" });
      if (p.ad) row.append(h("span", { class: "tiny up" }, `${AD[p.ad.kind].name}: ещё ${p.ad.rounds} х.`));
      else if (p.mortgaged) row.append(h("span", { class: "tiny muted" }, "в залоге"));
      else for (const k of Object.keys(AD) as AdKind[]) {
        const c = adCost(s, me, i, k);
        const back = Math.round(r * AD[k].sales * AD[k].rounds);
        row.append(button(`${AD[k].name} · ${fmt(c)} (продажи ≈ ${fmt(back)})`, () => run({ t: "advertise", cell: i, kind: k }), myTurn && pl.money >= c ? "" : "disabled"));
      }
      sec.push(h("div", { class: "item" }, h("div", { class: "item-head" }, h("b", {}, BOARD[i].name), h("span", { class: "muted" }, ` · аренда ${fmt(r)}`)), row));
    }

    this.openModal(h("h2", {}, "Жизнь олигарха"),
      h("div", { class: "muted" }, myTurn ? `У вас ${fmt(pl.money)} млн ₽ · на вкладе ${fmt(pl.deposit)}` : "Покупать и запускать рекламу можно в свой ход — до броска или в конце хода."),
      ...sec);
    this.modal.dataset.view = "life";
    const sheet = this.modal.querySelector(".sheet");
    if (sheet) sheet.scrollTop = keep;
  }

  private promptBid(pid: number): Promise<number> {
    const s = this.s, pl = s.players[pid], pend = s.pending;
    if (pend?.kind !== "auction") return Promise.resolve(0);
    const c = BOARD[pend.cell];
    return new Promise((res) => {
      const max = pl.money;
      const bank = pend.bank;
      const value = bank ? bankSaleValue(s, bank) : c.price!;
      const range = Object.assign(h("input", { type: "range", min: "0", max: String(max), step: "10" }), { value: String(Math.min(max, Math.round(value * 0.6 / 10) * 10)) });
      const val = h("b", {}, range.value);
      range.addEventListener("input", () => { val.textContent = range.value; });
      const done = (n: number) => { this.closeModal(); res(n); };
      this.openModal(h("h2", {}, bank ? `Аукцион банка: ${bank.kind === "company" ? `«${c.name}» целиком` : `10% акций «${c.name}»`}` : `Аукцион: ${c.name}`),
        h("div", { class: "muted" }, bank
          ? `${s.players[bank.debtor].name} не вернул кредит — банк продаёт залог${bank.kind === "company" ? " вместе с постройками" : ""}. Оценка ${fmt(value)}, у вас ${fmt(max)}. Ваша тайная ставка.`
          : `${pl.name}, ваша тайная ставка. Цена клетки ${c.price}, у вас ${fmt(max)}.`),
        h("div", {}, "Ставка: ", val), range,
        h("div", { class: "row" }, button("Поставить", () => done(Number(range.value)), "primary"), button("Пас", () => done(0))));
      this.modal.querySelector(".close")!.addEventListener("click", () => res(0));
    });
  }

  private passPhone(name: string, why: string): Promise<void> {
    this.waitingPass = true;
    this.renderPanel();
    return new Promise((res) => {
      const ov = h("div", { class: "pass" }, h("div", {}, h("h1", {}, name), h("p", {}, `Передайте телефон: ${why}`), h("p", { class: "muted" }, "Нажмите, когда телефон у вас")));
      ov.addEventListener("click", () => { ov.remove(); this.waitingPass = false; res(); });
      this.ui.append(ov);
    });
  }

  private showCell(i: number) {
    const s = this.s, c = BOARD[i], p = s.props[i];
    const rows: Node[] = [h("h2", {}, c.name)];
    if (c.industry) rows.push(h("div", { class: "muted" }, `${INDUSTRIES[c.industry].name} · цена ${c.price} · базовая аренда ${c.baseRent}`));
    if (p) {
      rows.push(h("div", {}, `Владелец: ${p.owner === null ? "нет" : s.players[p.owner].name}${p.mortgaged ? " (в залоге)" : ""}`));
      if (c.kind === "business") {
        rows.push(h("div", {}, `Уровень: ${p.level}${p.branch ? ` · ветка «${INDUSTRIES[c.industry!].branches[p.branch]}»` : ""}`));
        if (p.construction) rows.push(h("div", {}, `Стройка ур. ${p.construction.target}: ${Math.floor(p.construction.progress)}%`));
        if (p.branch === "special") rows.push(h("div", { class: "muted" }, BRANCH_EFFECTS[c.industry!]));
      }
      if (p.owner !== null) rows.push(h("div", {}, `Аренда сейчас: ${fmt(rentFor(s, i))} млн ₽`));
      if (p.owner !== null && p.owner !== this.meId) rows.push(h("div", { class: "row" }, button("🤝 Предложить сделку", () => this.showDeal(i), "primary")));
    } else {
      const d: Record<string, string> = {
        start: "+200 за круг, +300 за остановку", news: "Карточка новостей", gov: "Карточка госзаказа",
        tax: c.tax === "luxury" ? "Налог 100" : "10% капитала, но не больше 200", casino: "Пропуск хода и до 3 ставок",
        forum: "+100", zagul: "Отправляет в казино",
      };
      rows.push(h("div", {}, d[c.kind] ?? ""));
    }
    this.openModal(...rows);
  }

  private showMenu() {
    const sp = (v: Speed, t: string) => button(t, () => { this.speed = v; this.scene.hopTime = SPEED[v].hop; this.closeModal(); }, this.speed === v ? "primary" : "");
    this.openModal(h("h2", {}, "Меню"),
      h("div", {}, "Скорость анимации"), h("div", { class: "row" }, sp("normal", "Обычная"), sp("fast", "Быстрая"), sp("instant", "Мгновенно")),
      h("div", { class: "row" }, button(isMuted() ? "🔇 Звук выключен" : "🔊 Звук включён", () => { setMuted(!isMuted()); this.showMenu(); })),
      this.net ? "" : h("div", { class: "muted tiny" }, "Партия сохраняется сама после каждого хода. Выйдите — и в меню будет «Продолжить партию»."),
      h("div", { class: "row" }, button("Правила", () => this.showRules()), button(this.net ? "Выйти в меню" : "Сохранить и выйти", () => { if (!this.net && this.s.phase !== "gameover") saveGame(this.s, this.speed); this.closeModal(); this.onExit(); }, "ghost")));
  }

  private showRules() {
    this.openModal(h("h2", {}, "Коротко о правилах"), h("ul", {},
      ...[
        "Бросайте кубики, покупайте города. Отказались — клетка уходит на аукцион.",
        "Стройка идёт, пока ходят соперники. Уровень 1 — за раунд, 2 — за два, 3 — за три.",
        "В чужой ход тапайте по своим стройкам: 60 тапов за раунд, каждый +1%. Успели раньше срока — +20% к первой аренде.",
        "Уровень 2 — нужны 2 клетки отрасли, уровень 3 — вся отрасль. Не хватает одной — «Слияние» за двойную цену.",
        "Ветки: «Аренда» — дорого гостям, «Доход» — деньги каждый раунд, «Особая» — уникальный эффект.",
        "Казино вместо тюрьмы: пропуск хода, но можно сделать до 3 ставок — рулетка, слоты, блэкджек, тотализатор.",
        "Не хочется смотреть, как ходят боты? Кнопка «🎰 Казино» вверху: до 3 ставок за круг, не больше 10% денег.",
        "Биржа: продайте до 40% своей компании — акционеры получают свою долю каждой аренды и дохода. Цена акций растёт от покупок и падает от продаж, от неё зависит стоимость компании.",
        "Выгода продажи акций: деньги сразу без залога; за каждые 10% у акционеров аренда +5%, стройка −5% и быстрее на 10%; с 20% у акционеров компанию нельзя отнять «Слиянием».",
        "Чужие деньги не видны, а карточки соперников — видны («👥 Игроки»): тапните по любой, чтобы предложить выкуп или купить акции.",
        "Отработка аренды: платите на 10% меньше, но пропускаете следующий ход.",
        "Не хватает на покупку — «Купить в складчину»: позовите кого хотите и раздайте до 40% долей, они заплатят свою часть.",
        "Банк («Биржа и банк»): кредит до 60% стоимости залога — своей компании или акций; 5% за ход, срок 5 раундов.",
        "У здания одна ветка развития: выбрали — остальные закрыты. Сменить можно, снеся постройки: вернётся 50% вложений, поделённых по долям с акционерами, и сразу можно строить другое.",
        "Снести здание без спроса может владелец с большинством (больше 50%). Если у владельца меньше — нужно согласие акционеров, чтобы «за» было больше 50%.",
        "Строить можно только на своей клетке, где вы стоите (или которую только что купили), и один раз за ход — кнопка «Прокачать здесь» на карточке.",
        "Не хватает на покупку — «💰 Найти деньги» на карточке: снять со вклада, взять кредит, заложить клетку, продать роскошь.",
        "Не вернули кредит — банк выставляет залог на аукцион: компанию целиком (с постройками), акции — по 10%, пока не покроет долг. Что выручено сверх долга — ваше.",
        "Партия на одном телефоне сохраняется после каждого хода: в меню — «Продолжить партию» или новая игра.",
        "Игра по Bluetooth: если телефон хозяина стола вышел, хозяином становится следующий телефон, остальные переподключаются сами, а за ушедшего играет бот, пока он не вернётся через «Найти стол».",
        "Вклад в банке: 2% за каждый ваш ход, снять можно в любой свой ход, при нехватке на платёж банк снимет сам.",
        "«💎 Жизнь»: спорткар, особняк, яхта, картины дают статус ★ — каждая звезда +3% к аренде и доходу всех ваших компаний. Налог на роскошь 15%. Вещи стоят на вашем участке в центре поля и считаются в капитале.",
        "Вечеринка (связи в сделках), отдых (стройки −25%), подарки семье (заначка выручит при нехватке денег) — статус на 3 хода.",
        "Реклама компании: аренда выше и «продажи» каждый ваш ход — деньги, даже если к вам никто не зашёл.",
      ].map((t) => h("li", {}, t))));
  }

  private showGameOver() {
    const s = this.s;
    const ranking = [...s.players].sort((a, b) => capital(s, b.id) - capital(s, a.id));
    this.openModal(h("h2", {}, `Победа: ${s.players[s.winner!].name}!`),
      h("ol", {}, ...ranking.map((p) => h("li", {}, `${p.name}${p.bankrupt ? " (банкрот)" : ""} — капитал ${fmt(capital(s, p.id))} млн ₽`))),
      h("div", { class: "row" }, button("Новая игра", () => { this.closeModal(); this.onExit(); }, "primary")));
    void active;
  }

  // ---------- Мелочи ----------

  toast(text: string, kind = "", ms = 2600) {
    const t = h("div", { class: `toast ${kind}` }, text);
    this.toasts.append(t);
    while (this.toasts.children.length > 3) this.toasts.firstChild!.remove();
    setTimeout(() => t.remove(), ms);
  }

  private flashMoney(pid: number, delta: number) {
    const chip = this.bar.querySelector(`[data-pid="${pid}"]`);
    if (!chip) return;
    const f = h("span", { class: `float ${delta >= 0 ? "plus" : "minus"}` }, `${delta >= 0 ? "+" : ""}${fmt(delta)}`);
    chip.append(f);
    setTimeout(() => f.remove(), 1400);
  }
}

export const PERSONALITY_NAMES = PERS_NAME;
