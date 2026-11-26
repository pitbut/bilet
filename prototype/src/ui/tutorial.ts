// Обучение в первой партии: рука показывает, куда нажать, подсказка объясняет зачем.
import { GameState } from "../engine/engine";

const KEY = "oligarh-tutorial-done";

export const tutorialDone = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return true; } };
const markDone = () => { try { localStorage.setItem(KEY, "1"); } catch { /* приватный режим */ } };

interface Step {
  /** Куда показывает рука. */
  target: () => HTMLElement | null;
  text: (s: GameState) => string;
  /** Шаг закончится сам, когда игрок сделает нужное. Нет — кнопка «Понятно». */
  until?: (s: GameState, start: GameState) => boolean;
  /** Шаг ждёт, пока на экране появится цель (например, карточка покупки). */
  wait?: boolean;
}

const q = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);
const byText = (sel: string, text: string) => [...document.querySelectorAll<HTMLElement>(sel)].find((n) => n.textContent?.includes(text)) ?? null;

export class Tutorial {
  private steps: Step[];
  private k = 0;
  private start!: GameState;
  private timer = 0;
  private hand = document.createElement("div");
  private bubble = document.createElement("div");
  private shown: HTMLElement | null = null;

  constructor(private host: HTMLElement, private get: () => GameState, private me: () => number) {
    const myTurn = (s: GameState) => s.current === this.me();
    this.steps = [
      { target: () => q(".chip.me"), text: () => "Это вы: наличные деньги и капитал. Деньги соперников скрыты — видно только их компании." },
      { target: () => byText(".panel button", "Бросить"), wait: true, text: () => "Ваш ход. Нажмите «Бросить кубики» — фишка пойдёт по полю.", until: (s, st) => s.turnCounter !== st.turnCounter || s.phase !== "roll" || !myTurn(s) },
      {
        target: () => q(".ccard.here.act"), wait: true,
        text: (s) => s.pending?.kind === "rent"
          ? "Вы на чужой компании — нужно заплатить аренду. Тапните по карточке. Не хватает денег — остаток станет долгом."
          : "Свободная компания! Тапните по карточке — купить. Не хватает денег — «Найти деньги» или «Купить в складчину».",
        until: (s) => s.phase !== "decide",
      },
      { target: () => q(".mycards"), text: () => "Здесь все ваши компании. Пока ходят соперники, тапайте по стройкам — они строятся быстрее." },
      { target: () => byText(".panel button", "Стройки"), wait: true, text: () => "«Стройки и сделки»: строить можно на своей компании, на которой вы стоите, — один раз за ход. Каждая ветка — свой доход." },
      { target: () => byText(".bar button", "Биржа"), text: () => "Биржа и банк: акции, вклад под процент, кредиты. Здесь же бонус +100 млн за просмотр рекламы." },
      { target: () => byText(".bar button", "Жизнь"), text: () => "Жизнь олигарха: особняк, яхта, отдых и реклама компаний. Статус поднимает доход." },
      { target: () => byText(".bar button", "Игроки"), text: () => "Соперники и их компании. Нажмите на любую — увидите акционеров и сможете предложить сделку." },
      { target: () => byText(".panel button", "Завершить"), wait: true, text: () => "Всё сделали — «Завершить ход». Пока ходят соперники, можно играть в казино и тапать по стройкам.", until: (s) => !myTurn(s) },
    ];
    this.hand.className = "tut-hand";
    this.hand.textContent = "👆";
    this.bubble.className = "tut-bubble";
  }

  run() {
    this.host.append(this.hand, this.bubble);
    this.k = 0;
    this.begin();
    this.timer = window.setInterval(() => this.tick(), 250);
  }

  private begin() {
    this.start = structuredClone(this.get());
    this.shown = null;
  }

  private finish() {
    clearInterval(this.timer);
    this.hand.remove();
    this.bubble.remove();
    markDone();
  }

  private next() {
    this.k++;
    if (this.k >= this.steps.length) {
      this.bubble.replaceChildren(Object.assign(document.createElement("b"), { textContent: "Удачи, олигарх! 🎩" }), Object.assign(document.createElement("div"), { className: "muted tiny", textContent: "Обучение можно пройти снова: меню ☰ → «Обучение»." }));
      this.hand.style.display = "none";
      setTimeout(() => this.finish(), 3500);
      clearInterval(this.timer);
      return;
    }
    this.begin();
  }

  private tick() {
    const st = this.steps[this.k], s = this.get();
    if (st.until && st.until(s, this.start)) { this.next(); return; }
    const el = st.target();
    const visible = el && el.offsetParent !== null && !document.querySelector(".modal:not(.hidden), .call, .pass");
    if (!visible) {
      this.hand.style.display = "none";
      this.bubble.style.display = st.wait ? "none" : this.bubble.style.display;
      if (!st.wait && !el) this.next(); // цели нет на экране совсем — пропускаем подсказку
      return;
    }
    this.hand.style.display = "";
    this.bubble.style.display = "";
    const r = el.getBoundingClientRect(), hr = this.host.getBoundingClientRect();
    const x = r.left - hr.left + Math.min(r.width / 2, 60), y = r.bottom - hr.top;
    const below = y + 190 < hr.height;
    this.hand.style.left = `${x - 18}px`;
    this.hand.style.top = below ? `${y - 6}px` : `${r.top - hr.top - 52}px`;
    this.hand.classList.toggle("up", !below);
    if (this.shown !== el) {
      this.shown = el;
      const done = h("button", "primary", "Понятно");
      done.onclick = () => this.next();
      const skip = h("button", "ghost small", "Пропустить обучение");
      skip.onclick = () => this.finish();
      this.bubble.replaceChildren(h("div", "", st.text(s)), h("div", "row", ...(st.until ? [] : [done]), skip));
    }
    const bw = Math.min(320, hr.width - 24);
    this.bubble.style.width = `${bw}px`;
    this.bubble.style.left = `${Math.max(12, Math.min(hr.width - bw - 12, x - bw / 2))}px`;
    if (below) { this.bubble.style.top = `${y + 52}px`; this.bubble.style.bottom = ""; }
    else { this.bubble.style.top = ""; this.bubble.style.bottom = `${hr.height - r.top + 58}px`; }
  }
}

function h(tag: string, cls: string, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}
