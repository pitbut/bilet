// Связка правил, 3D-сцены и интерфейса.
import { BOARD, BRANCH_EFFECTS, BranchId, INDUSTRIES } from "../engine/board";
import {
  Action, GameConfig, GameEvent, GameState, act, active, buildCost, canBuild, canTakeover, capital, drainEvents, newGame, rentFor,
} from "../engine/engine";
import { botStep } from "../engine/runner";
import { BoardScene } from "./scene";

export type Speed = "normal" | "fast" | "instant";
const SPEED = { normal: { hop: 0.32, bot: 750 }, fast: { hop: 0.14, bot: 300 }, instant: { hop: 0, bot: 60 } };
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
  private sites = h("div", { class: "sites" });
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
  private insure = false;

  constructor(root: HTMLElement, private onExit: () => void) {
    const stage = h("div", { class: "stage" });
    root.append(stage);
    this.scene = new BoardScene(stage);
    this.ui = h("div", { class: "ui" }, this.bar, this.info, this.sites, this.logBox, this.panel, this.toasts, this.modal);
    root.append(this.ui);
    this.scene.onCellClick = (i) => this.showCell(i);
    const measure = () => {
      this.scene.safeTop = this.bar.getBoundingClientRect().bottom + 6;
      this.scene.safeBottom = Math.max(70, root.clientHeight - this.panel.getBoundingClientRect().top + 6);
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
    const r = act(this.s, this.s.current, a);
    if (!r.ok) this.toast(r.error ?? "Нельзя", "warn");
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
          await this.scene.moveToken(e.player, e.path, s.players.length, e.teleport);
          this.scene.hideDice();
          break;
        case "money":
          this.flashMoney(e.player, e.delta);
          break;
        case "buy":
          await this.scene.sync(s);
          break;
        case "buildDone":
          await this.scene.sync(s);
          this.toast(`${s.players[e.player].name}: «${BOARD[e.cell].name}» — уровень ${e.level}${e.fast ? ". Успел! +20% к аренде" : ""}`, e.fast ? "good" : "");
          break;
        case "accident":
          this.toast(`Авария на стройке «${BOARD[e.cell].name}»!`, "warn");
          break;
        case "card":
          this.toast(`${e.deck === "news" ? "Новости" : "Госзаказ"}: ${e.text}`, "card", 3500);
          if (this.speed !== "instant") await this.scene.wait(1.2);
          break;
        case "casino":
          this.toast(`${s.players[e.player].name} · ${e.game}: ${e.detail} → ${e.win >= 0 ? "+" : ""}${fmt(e.win)}`, e.win > 0 ? "good" : "");
          break;
        case "jackpot":
          this.toast(`ДЖЕКПОТ! ${s.players[e.player].name} срывает ${fmt(e.amount)} млн ₽`, "good", 5000);
          break;
        case "market":
          this.toast(`Рынок: ${e.title}`, "card", 4000);
          break;
        case "bankrupt":
          this.scene.hideToken(e.player);
          this.toast(`${s.players[e.player].name} — банкрот`, "warn", 4000);
          break;
        case "turn":
          break;
        case "log":
          this.logLines.push(e.text);
          if (this.logLines.length > 4) this.logLines.shift();
          break;
        case "buildStart": case "gameover":
          break;
      }
    }
  }

  // ---------- Отрисовка ----------

  private render() {
    const s = this.s;
    this.bar.replaceChildren(...s.players.map((p) => h("div", {
      class: `chip${p.id === s.current ? " current" : ""}${p.bankrupt ? " out" : ""}`, "data-pid": String(p.id),
    },
      h("span", { class: "dot", style: `background:${p.color}` }),
      h("span", { class: "name" }, p.bot ? `${p.name} 🤖` : p.name),
      h("span", { class: "money" }, `${fmt(p.money)}`),
    )));
    this.info.replaceChildren(
      h("div", {}, `Раунд ${s.round}${s.cfg.length === "quick" ? `/${s.cfg.quickRounds ?? 15}` : ""}`),
      button("⌖", () => this.scene.resetView(), "small"),
      button("☰", () => this.showMenu(), "small"),
    );
    this.logBox.replaceChildren(...this.logLines.map((l) => h("div", {}, l)));
    this.renderSites();
    this.renderPanel();
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
        if (pend.kind === "buy") {
          title.append(h("div", { class: "sub" }, `«${c.name}» свободна. ${c.industry ? INDUSTRIES[c.industry].name + " · " : ""}базовая аренда ${c.baseRent ?? "по кубикам"}`));
          row.append(
            button(`Купить за ${c.price}`, () => this.doAction({ t: "buy" }), cur.money >= c.price! ? "primary" : "disabled"),
            button("На аукцион", () => this.doAction({ t: "decline" })),
          );
        } else if (pend.kind === "rent") {
          title.append(h("div", { class: "sub" }, `Аренда «${c.name}» → ${s.players[pend.owner].name}: ${fmt(pend.amount)} млн ₽`));
          row.append(
            button(`Заплатить ${fmt(pend.amount)}`, () => this.doAction({ t: "payRent" }), "primary"),
            button("Отработать (пропуск хода)", () => this.doAction({ t: "workOff" })),
          );
        }
        break;
      }
      case "casino":
        title.append(h("div", { class: "sub" }, `Казино · ставок осталось ${3 - s.casinoBets} · джекпот ${fmt(s.jackpot)}`));
        row.append(button("🎡 Рулетка", () => this.showCasino("roulette"), "primary"), button("🎰 Слоты", () => this.showCasino("slots")), button("Уйти", () => this.doAction({ t: "leaveCasino" })));
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

  /** Стройки игрока-человека с кнопками тапа (во время чужих ходов). */
  private renderSites() {
    const s = this.s;
    const me = this.soloHuman;
    if (!me || me.bankrupt) { this.sites.replaceChildren(); return; }
    const mine = Object.entries(s.props).filter(([, p]) => p.owner === me.id && p.construction);
    if (!mine.length) { this.sites.replaceChildren(); return; }
    const canTap = s.current !== me.id && s.phase !== "gameover";
    this.sites.replaceChildren(
      h("div", { class: "sites-head" }, canTap ? `Бригада: ${me.energy} тапов` : "Стройки (тапать — в чужой ход)"),
      ...mine.map(([i, p]) => {
        const c = p.construction!;
        const bar = h("div", { class: "prog" }, h("div", { style: `width:${Math.min(100, c.progress)}%` }));
        const el = h("div", { class: `site${canTap && me.energy > 0 ? " tappable" : ""}` },
          h("div", { class: "site-name" }, `${BOARD[+i].name} → ур. ${c.target}`), bar,
          h("div", { class: "site-pct" }, `${Math.floor(Math.min(100, c.progress))}%`));
        if (canTap) {
          el.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            const r = act(s, me.id, { t: "tap", cell: +i });
            if (!r.ok) return;
            el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop");
            const done = s.props[+i].construction === null;
            if (done) void this.step(); else this.renderSites();
            void this.scene.sync(s);
          });
        }
        return el;
      }),
    );
  }

  // ---------- Окна ----------

  private openModal(...kids: Node[]) {
    this.modal.replaceChildren(h("div", { class: "sheet" }, button("✕", () => this.closeModal(), "close"), ...kids));
    this.modal.classList.remove("hidden");
  }

  private closeModal() { this.modal.classList.add("hidden"); this.modal.replaceChildren(); }

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

  private showCasino(game: "roulette" | "slots") {
    const s = this.s, me = s.players[s.current];
    const max = Math.max(10, Math.floor(me.money * 0.2));
    const range = Object.assign(h("input", { type: "range", min: "10", max: String(max), step: "10" }), { value: String(Math.min(max, 50)) });
    const val = h("b", {}, range.value);
    range.addEventListener("input", () => { val.textContent = range.value; });
    const bet = (a: Action) => { this.closeModal(); this.doAction(a); };
    const amt = () => Number(range.value);
    const choices = game === "roulette"
      ? h("div", { class: "row" },
        button("Красное ×2", () => bet({ t: "roulette", choice: "red", amount: amt() }), "red"),
        button("Чёрное ×2", () => bet({ t: "roulette", choice: "black", amount: amt() }), "black"),
        button("Чёт ×2", () => bet({ t: "roulette", choice: "even", amount: amt() })),
        button("Нечет ×2", () => bet({ t: "roulette", choice: "odd", amount: amt() })),
        button("Зеро ×36", () => bet({ t: "roulette", choice: 0, amount: amt() })))
      : h("div", { class: "row" }, button("Крутить", () => bet({ t: "slots", amount: amt() }), "primary"),
        h("div", { class: "muted tiny" }, "Два одинаковых ×1,6 · три ×10 · три «Кремля» — джекпот"));
    this.openModal(h("h2", {}, game === "roulette" ? "Рулетка" : "Слоты"),
      h("div", {}, "Ставка: ", val, ` (до ${max})`), range, choices);
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
        "Казино вместо тюрьмы: пропуск хода, но можно сделать до 3 ставок.",
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
