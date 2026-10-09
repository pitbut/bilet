import { CasinoView } from "./casino";
import { isMuted, setMuted, sfx } from "./sound";
// Связка правил, 3D-сцены и интерфейса.
import { BOARD, BRANCH_EFFECTS, BranchId, INDUSTRIES } from "../engine/board";
import {
  Action, GameConfig, GameEvent, GameState, act, active, buildCost, canBuild, canLounge, canTakeover, capital, companyValue, drainEvents, freeLots,
  lotPrice, newGame, ownerLots, rentFor, soldLots,
} from "../engine/engine";
import { botStep } from "../engine/runner";
import { BoardScene } from "./scene";

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

  constructor(private root: HTMLElement, private onExit: () => void) {
    const stage = h("div", { class: "stage" });
    root.append(stage);
    this.scene = new BoardScene(stage);
    this.ui = h("div", { class: "ui" }, this.bar, this.info, this.cards, this.myBtn, this.logBox, this.panel, this.toasts, this.modal);
    this.myBtn.addEventListener("click", () => this.showMyCards());
    root.append(this.ui);
    this.scene.onCellClick = (i) => this.showCell(i);
    const measure = () => {
      this.placeCards();
      this.scene.safeTop = this.bar.getBoundingClientRect().bottom + 6;
      this.scene.safeBottom = Math.max(70, root.clientHeight - this.panel.getBoundingClientRect().top + 6);
      this.scene.safeRight = 0;
    };
    window.addEventListener("resize", () => { measure(); this.scene.fitView(); });
    this.fitLater = () => { measure(); this.scene.fitView(); };
  }

  async start(cfg: GameConfig, speed: Speed) {
    this.speed = speed;
    this.scene.hopTime = SPEED[speed].hop;
    this.s = newGame(cfg);
    this.panel.replaceChildren(h("div", { class: "hint" }, "Загрузка поля…"));
    await Promise.all([this.scene.setupTokens(this.s), this.scene.setupDice()]);
    await this.scene.sync(this.s);
    this.render();
    this.fitLater();
    void this.step();
  }

  private get humans() { return this.s.players.filter((p) => !p.bot); }
  private get soloHuman() { return this.s.cfg.mode === "solo" ? this.humans[0] : undefined; }

  // ---------- Игровой цикл ----------

  private async step() {
    if (this.stepping) { this.again = true; return; }
    this.stepping = true;
    try {
      do {
        this.again = false;
        await this.playEvents(drainEvents(this.s));
        await this.scene.sync(this.s);
        this.render();
        const s = this.s;
        if (s.phase === "gameover") { this.showGameOver(); break; }
        if (s.phase === "auction" && s.pending?.kind === "auction" && s.pending.waiting.length) {
          const pid = s.pending.waiting[0];
          if (this.humans.length > 1) await this.passPhone(s.players[pid].name, "ставка на аукционе");
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
        } else if (this.humans.length > 1 && this.passedTurn !== s.turnCounter) {
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
    const r = act(this.s, this.s.current, a);
    if (!r.ok) this.toast(r.error ?? "Нельзя", "warn");
    else { this.panel.replaceChildren(h("div", { class: "hint" }, "…")); this.cards.replaceChildren(); } // пока идёт анимация — без кнопок
    void this.step();
  }

  private async playEvents(evs: GameEvent[]) {
    const s = this.s;
    for (const e of evs) {
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
          if (!s.players[e.player].bot) sfx.turn();
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
    if (!cur.bot) this.lastHuman = cur.id;
    const me = this.soloHuman ?? s.players[this.lastHuman] ?? this.humans[0];
    const chip = h("div", { class: `chip me${me.bankrupt ? " out" : ""}`, "data-pid": String(me.id) },
      h("span", { class: "dot", style: `background:${me.color}` }),
      h("span", { class: "name" }, me.name),
      h("span", { class: "money" }, `${fmt(me.money)} млн ₽`),
      h("span", { class: "muted cap" }, `капитал ${fmt(capital(s, me.id))}`));
    const others = button("👥 Игроки", () => this.showPlayers(), "small chipbtn");
    const turn = cur.id !== me.id ? h("div", { class: "chip turnchip" }, h("span", { class: "dot", style: `background:${cur.color}` }), `Ходит ${cur.name}`) : "";
    const offers = s.offers.filter((o) => o.to === me.id).length;
    const exch = button(`📈 Биржа${offers ? ` · ${offers}` : ""}`, () => this.showExchange(), `small chipbtn${offers ? " hotbtn" : ""}`);
    const lounge = s.cfg.mode === "solo" && s.current !== me.id && !me.bankrupt && s.phase !== "gameover"
      ? button("🎰 Казино", () => this.openCasino(true), `small chipbtn${canLounge(s, me.id) ? " dim" : ""} casbtn`) : "";
    this.bar.replaceChildren(chip, others, exch, lounge, turn);
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
  private get meId() { return (this.soloHuman ?? this.s.players[this.lastHuman] ?? this.humans[0]).id; }
  private get modalView() { return this.modal.classList.contains("hidden") ? "" : this.modal.dataset.view ?? ""; }

  private showPlayers() {
    const s = this.s;
    const rows = [...s.players].sort((a, b) => capital(s, b.id) - capital(s, a.id)).map((p) => {
      const cells = Object.values(s.props).filter((q) => q.owner === p.id);
      const levels = cells.reduce((a, q) => a + q.level, 0);
      return h("div", { class: `prow${p.id === s.current ? " now" : ""}${p.bankrupt ? " out" : ""}` },
        h("span", { class: "dot", style: `background:${p.color}` }),
        h("div", { class: "pname" }, h("b", {}, p.name), h("div", { class: "muted tiny" },
          p.bankrupt ? "банкрот" : `${p.bot ? `бот · ${PERS_NAME[p.personality ?? "trader"]}` : "человек"} · клеток ${cells.length} · уровней ${levels}${p.inCasino ? " · в казино" : ""}`)),
        h("div", { class: "pmoney" }, h("b", {}, fmt(p.money)), h("div", { class: "muted tiny" }, `капитал ${fmt(capital(s, p.id))}`)));
    });
    this.openModal(h("h2", {}, "Игроки"), h("div", { class: "muted" }, "Деньги и капитал в млн ₽, по убыванию капитала"), h("div", { class: "plist" }, ...rows));
  }

  /** Окно «Мои карточки»: все клетки игрока; по стройкам тапают в чужой ход прямо здесь. */
  private showMyCards() {
    const s = this.s;
    const me = this.soloHuman ?? s.players[this.lastHuman] ?? this.humans[0];
    const mine = Object.entries(s.props).filter(([, p]) => p.owner === me.id).map(([i]) => +i)
      .sort((a, b) => Number(!!s.props[b].construction) - Number(!!s.props[a].construction) || a - b);
    const canTap = s.cfg.mode === "solo" && s.current !== me.id && s.phase !== "gameover";
    const grid = h("div", { class: "cardgrid" }, ...mine.map((i) => this.ownedCard(me.id, i, canTap)));
    const building = mine.some((i) => s.props[i].construction);
    const head = building
      ? (canTap ? `Бригада: ${me.energy} тапов в этом раунде — тапайте по стройкам` : s.cfg.mode === "solo" ? "Тапать по стройкам можно, пока ходят соперники" : "На одном телефоне стройки идут сами, по ходам соперников")
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
    const me = this.soloHuman ?? s.players[this.lastHuman] ?? this.humans[0];
    const mine = Object.values(s.props).filter((p) => p.owner === me.id);
    const sites = mine.filter((p) => p.construction).length;
    const tapNow = sites > 0 && s.cfg.mode === "solo" && s.current !== me.id && me.energy > 0 && s.phase !== "gameover";
    this.myBtn.className = `mycards${tapNow ? " hot" : ""}`;
    this.myBtn.replaceChildren(`🃏 Мои карточки · ${mine.length}`, ...(tapNow ? [h("span", { class: "badge" }, "тапай!")] : []));
    if (this.modal.dataset.view === "mycards" && !this.modal.classList.contains("hidden")) this.showMyCards();
  }

  private renderPanel() {
    const s = this.s, cur = s.players[s.current];
    const p = this.panel;
    if (s.phase === "gameover") { p.replaceChildren(); return; }
    if (cur.bot || this.waitingPass || this.stepping && s.phase === "auction") {
      p.replaceChildren(h("div", { class: "hint" }, cur.bot ? `Ходит ${cur.name}…` : ""));
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
    const deciding = !cur.bot && !this.waitingPass && s.phase === "decide" && pend && (pend.kind === "buy" || pend.kind === "rent");
    this.cards.replaceChildren(...(deciding ? [this.hereCard()] : []));
  }

  private cardShell(i: number, cls: string) {
    const c = BOARD[i];
    const color = c.industry ? INDUSTRIES[c.industry].color : "#8a9199";
    return h("div", { class: `ccard ${cls}` }, h("div", { class: "band", style: `background:${color}` }));
  }

  private hereCard() {
    const s = this.s, cur = s.players[s.current], c = BOARD[cur.pos], p = s.props[cur.pos];
    const pend = s.pending;
    const human = !cur.bot;
    const deciding = human && s.phase === "decide" && pend && (pend.kind === "buy" || pend.kind === "rent") && pend.cell === cur.pos;
    const el = this.cardShell(cur.pos, `here${deciding ? " act" : ""}`);
    const body = h("div", { class: "cbody" },
      h("div", { class: "eyebrow" }, human ? (s.cfg.mode === "solo" ? "Вы здесь" : `${cur.name} здесь`) : `${cur.name} здесь`),
      h("div", { class: "cname" }, c.name));
    if (c.industry) body.append(h("div", { class: "cmeta" }, `${INDUSTRIES[c.industry].name} · цена ${c.price}`));
    else if (c.price) body.append(h("div", { class: "cmeta" }, `Цена ${c.price}`));
    if (p?.owner !== null && p?.owner !== undefined) {
      body.append(h("div", { class: "cmeta" }, h("span", { class: "dot", style: `background:${s.players[p.owner].color}` }),
        ` ${s.players[p.owner].name}${p.level ? ` · ур. ${p.level}` : ""} · аренда ${fmt(rentFor(s, cur.pos))}`));
    }
    el.append(body);
    if (deciding && pend) {
      if (pend.kind === "buy") {
        const can = cur.money >= c.price!;
        body.append(h("div", { class: "tapzone" }, can ? `Тапните — купить за ${c.price}` : `Не хватает: нужно ${c.price}`));
        if (can) el.addEventListener("click", () => this.doAction({ t: "buy" }));
        body.append(button("На аукцион", () => this.doAction({ t: "decline" }), "small ghost"));
      } else {
        body.append(h("div", { class: "tapzone" }, `Тапните — заплатить ${fmt(pend.amount)} → ${s.players[pend.owner].name}`));
        el.addEventListener("click", () => this.doAction({ t: "payRent" }));
        body.append(button("Отработать (пропуск хода)", () => this.doAction({ t: "workOff" }), "small ghost"));
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
      h("div", { class: "cmeta" }, `аренда ${fmt(rentFor(s, i))}`));
    if (site) {
      body.append(h("div", { class: "prog" }, h("div", { style: `width:${Math.min(100, site.progress)}%` })),
        h("div", { class: "cmeta" }, tappable ? `${Math.floor(Math.min(100, site.progress))}% · тапайте!` : `${Math.floor(Math.min(100, site.progress))}%`));
    }
    el.append(body);
    if (tappable) {
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const r = act(s, pid, { t: "tap", cell: i });
        if (!r.ok) return;
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

  private openModal(...kids: Node[]) {
    delete this.modal.dataset.view;
    this.modal.replaceChildren(h("div", { class: "sheet" }, button("✕", () => this.closeModal(), "close"), ...kids));
    this.modal.classList.remove("hidden");
  }

  private closeModal() { this.modal.classList.add("hidden"); this.modal.replaceChildren(); delete this.modal.dataset.view; }

  private showBuild() {
    const s = this.s, me = s.players[s.current];
    const opts = h("div", { class: "row" });
    const rush = h("label", {}, Object.assign(h("input", { type: "checkbox" }), { checked: this.rush }), " Штурмовая (вдвое быстрее, 20% риск аварии)");
    const ins = h("label", {}, Object.assign(h("input", { type: "checkbox" }), { checked: this.insure }), " Страховка (+10%)");
    rush.querySelector("input")!.addEventListener("change", (e) => { this.rush = (e.target as HTMLInputElement).checked; });
    ins.querySelector("input")!.addEventListener("change", (e) => { this.insure = (e.target as HTMLInputElement).checked; });
    opts.append(rush, ins);
    const list = h("div", { class: "list" });
    const owned = Object.entries(s.props).filter(([, p]) => p.owner === me.id).map(([i]) => +i);
    if (!owned.length) list.append(h("div", { class: "hint" }, "У вас пока нет клеток."));
    for (const i of owned) {
      const c = BOARD[i], p = s.props[i];
      const item = h("div", { class: "item" });
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
    this.openModal(h("h2", {}, "Стройки и сделки"), h("div", { class: "muted" }, `Деньги: ${fmt(me.money)} млн ₽ · строить можно до броска и в конце хода`), opts, list);
  }

  /** Казино: lounge = играть, пока ходят другие; иначе — визит на клетку «Казино». */
  private openCasino(lounge: boolean) {
    sfx.click();
    const view = new CasinoView({
      s: this.s, pid: lounge ? this.meId : this.s.current, lounge, instant: this.speed === "instant",
      after: () => { this.renderTopBar(); void this.step(); },
      close: () => this.closeModal(),
    });
    this.openModal(view.root);
    this.modal.dataset.view = "casino";
  }

  /** Биржа: предложения, свои компании, свои акции и рынок. */
  private showExchange() {
    const s = this.s, me = this.meId, pl = s.players[me];
    const myTurn = s.current === me && (s.phase === "roll" || s.phase === "end") && !this.stepping;
    const run = (a: Action, by = me) => {
      const r = act(s, by, a);
      if (!r.ok) { this.toast(r.error ?? "Нельзя", "warn"); sfx.alert(); } else sfx.stock();
      this.showExchange();
      this.renderTopBar();
      void this.step();
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
        sections.push(h("div", { class: "item offer" },
          h("div", {}, h("b", {}, `${o.lots * 10}% «${BOARD[o.cell].name}»`), ` от ${s.players[o.from].name} за ${fmt(o.price * o.lots)}`),
          h("div", { class: "muted tiny" }, `На бирже 10% стоит ${fmt(lotPrice(s, o.cell))} · аренда сейчас ${fmt(rentFor(s, o.cell))}, ваша доля дивидендов ${o.lots * 10}%`),
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

    this.openModal(h("h2", {}, "Биржа"),
      h("div", { class: "muted" }, myTurn
        ? "Цена растёт, когда акции покупают, и падает, когда их много в продаже. От цены зависит стоимость компании и ваш капитал."
        : "Покупать и выставлять акции можно в свой ход — до броска или в конце хода. Принять предложение можно в любой момент."),
      ...sections);
    this.modal.dataset.view = "exchange";
    const sheet = this.modal.querySelector(".sheet");
    if (sheet) sheet.scrollTop = keep;
  }

  private promptBid(pid: number): Promise<number> {
    const s = this.s, pl = s.players[pid], pend = s.pending;
    if (pend?.kind !== "auction") return Promise.resolve(0);
    const c = BOARD[pend.cell];
    return new Promise((res) => {
      const max = pl.money;
      const range = Object.assign(h("input", { type: "range", min: "0", max: String(max), step: "10" }), { value: String(Math.min(max, Math.round(c.price! * 0.6 / 10) * 10)) });
      const val = h("b", {}, range.value);
      range.addEventListener("input", () => { val.textContent = range.value; });
      const done = (n: number) => { this.closeModal(); res(n); };
      this.openModal(h("h2", {}, `Аукцион: ${c.name}`),
        h("div", { class: "muted" }, `${pl.name}, ваша тайная ставка. Цена клетки ${c.price}, у вас ${fmt(max)}.`),
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
      h("div", { class: "row" }, button("Правила", () => this.showRules()), button("Выйти в меню", () => { this.closeModal(); this.onExit(); }, "ghost")));
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
