import { CasinoView } from "./casino";
import { isMuted, setMuted, sfx } from "./sound";
// Связка правил, 3D-сцены и интерфейса.
import { BOARD, BRANCH_EFFECTS, BranchId, INDUSTRIES } from "../engine/board";
import {
  Action, GameConfig, GameEvent, GameState, act, active, buildCost, canBuild, canLounge, canTakeover, capital, companyValue, drainEvents, freeLots,
  INCOME_SHARE, LOAN_RATE, PUBLIC_PROTECT_LOTS, coopAnswer, loanLimit, WORKOFF_DISCOUNT, lotPrice, newGame, ownerLots, rentFor, soldLots,
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
    const exch = button(`📈 Биржа и банк${offers ? ` · ${offers}` : ""}`, () => this.showExchange(), `small chipbtn${offers ? " hotbtn" : ""}`);
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

  /** Игроки: свои деньги видны, чужие — нет; зато видны все карточки соперников, по ним можно предложить сделку. */
  private showPlayers() {
    const s = this.s, me = this.meId;
    const blocks = s.players.map((p) => {
      const cells = Object.keys(s.props).map(Number).filter((i) => s.props[i].owner === p.id);
      const levels = cells.reduce((a, i) => a + s.props[i].level, 0);
      const head = h("div", { class: `prow${p.id === s.current ? " now" : ""}${p.bankrupt ? " out" : ""}` },
        h("span", { class: "dot", style: `background:${p.color}` }),
        h("div", { class: "pname" }, h("b", {}, p.id === me && p.name !== "Вы" ? `${p.name} (вы)` : p.name), h("div", { class: "muted tiny" },
          p.bankrupt ? "банкрот" : `${p.bot ? `бот · ${PERS_NAME[p.personality ?? "trader"]}` : "человек"} · клеток ${cells.length} · уровней ${levels}${p.inCasino ? " · в казино" : ""}`)),
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
        h("div", { class: "cmeta" }, `аренда ${fmt(rentFor(s, i))}${income ? ` · доход ${fmt(income)}/раунд` : ""}`),
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
    const send = (a: Action) => {
      const r = act(s, me, a);
      if (!r.ok) { sfx.alert(); this.showDeal(i, r.error ?? "Нельзя"); return; }
      if (r.info?.includes("согласен")) sfx.buy(); else sfx.stock();
      void this.step();
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

  private openModal(...kids: (Node | string)[]) {
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
      if (c.kind === "business" && p.level >= 1 && p.branch && !p.construction) {
        const others = (["rent", "income", "special"] as BranchId[]).filter((b) => b !== p.branch).map((b) => `«${INDUSTRIES[c.industry!].branches[b]}»`).join(" и ");
        item.append(h("div", { class: "branchlock" },
          h("span", {}, `Ветка выбрана: «${INDUSTRIES[c.industry!].branches[p.branch]}». ${others} закрыты — у здания одна ветка. Сменить можно, снеся постройки: вернётся ${fmt(p.invested / 2)}.`),
          button("Снести", () => { const r = act(s, me.id, { t: "demolish", cell: i }); if (!r.ok) this.toast(r.error ?? "Нельзя", "warn"); else sfx.hammer(); void this.step(); this.showBuild(); }, "small ghost")));
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
        const yes = x.bot ? coopAnswer(s, part.pid, cellI, part.lots) : await this.askHuman(part.pid, `${pl.name} зовёт вас в складчину: ${part.lots * 10}% «${c.name}» за ${fmt(Math.ceil(price * part.lots / 10))}. Вы будете получать ${part.lots * 10}% аренды и дохода.`);
        if (!yes) declined.push(x.name);
      }
      if (declined.length) {
        sfx.alert();
        parts = parts.filter((x) => !declined.includes(s.players[x.pid].name));
        this.showCoop(cellI, `Отказались: ${declined.join(", ")}. Измените доли или позовите других.`);
        return;
      }
      const r = act(s, me, { t: "buyCoop", partners: parts });
      if (!r.ok) { sfx.alert(); this.showCoop(cellI, r.error ?? "Не получилось"); return; }
      this.closeModal();
      void this.step();
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
    if (this.humans.length > 1) await this.passPhone(x.name, "вопрос о сделке");
    return new Promise((res) => {
      const done = (v: boolean) => { this.closeModal(); res(v); };
      this.openModal(h("h2", {}, x.name), h("div", {}, question),
        h("div", { class: "row" }, button("Согласен", () => done(true), "primary"), button("Нет", () => done(false))));
      this.modal.querySelector(".close")!.addEventListener("click", () => res(false));
    });
  }

  /** Банк: кредиты под залог своих компаний или акций. */
  private bankSection(me: number, myTurn: boolean, run: (a: Action) => void): Node[] {
    const s = this.s, pl = s.players[me];
    const out: Node[] = [h("h3", {}, "🏦 Банк: кредит под залог")];
    out.push(h("div", { class: "muted tiny" }, `До 60% стоимости залога. Проценты ${LOAN_RATE * 100}% от суммы каждый ваш ход. Срок — 5 раундов: не вернули — банк забирает залог. Компания в залоге продолжает приносить аренду.`));
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
    const myTurn = s.current === me && (s.phase === "roll" || s.phase === "end");
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
        "Выгода продажи акций: деньги сразу без залога; за каждые 10% у акционеров аренда +5%, стройка −5% и быстрее на 10%; с 20% у акционеров компанию нельзя отнять «Слиянием».",
        "Чужие деньги не видны, а карточки соперников — видны («👥 Игроки»): тапните по любой, чтобы предложить выкуп или купить акции.",
        "Отработка аренды: платите на 10% меньше, но пропускаете следующий ход.",
        "Не хватает на покупку — «Купить в складчину»: позовите кого хотите и раздайте до 40% долей, они заплатят свою часть.",
        "Банк («Биржа и банк»): кредит до 60% стоимости залога — своей компании или акций; 5% за ход, через 5 раундов не вернули — залог у банка.",
        "У здания одна ветка развития: выбрали — остальные закрыты. Сменить можно, снеся постройки (вернётся 50% вложений).",
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
