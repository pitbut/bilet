import { describe, expect, it } from "vitest";
import { GameConfig, GameState, act, adCost, buildCost, canTakeover, capital, companyValue, fame, handValue, lotPrice, luxCost, newGame, rentFor } from "../src/engine/engine";
import { playOut } from "../src/engine/runner";

const players = (n: number, bot = false): GameConfig["players"] =>
  Array.from({ length: n }, (_, i) => ({
    name: `Игрок ${i + 1}`, bot, personality: (["shark", "miser", "gambler", "trader"] as const)[i % 4],
    difficulty: "normal" as const, token: "sedan", color: "#fff",
  }));

const game = (n = 3, extra: Partial<GameConfig> = {}): GameState =>
  newGame({ players: players(n), mode: "solo", length: "classic", seed: 42, ...extra });

const roll = (s: GameState, a: number, b: number) => {
  s.forcedDice = [[a, b]];
  return act(s, s.current, { t: "roll" });
};

/** Доводит ход до конца без покупок и переходит к следующему игроку. */
const pass = (s: GameState) => {
  if (s.phase === "decide") act(s, s.current, s.pending!.kind === "buy" ? { t: "decline" } : { t: "payRent" });
  if (s.phase === "auction" && s.pending?.kind === "auction") for (const p of [...s.pending.waiting]) act(s, p, { t: "bid", amount: 0 });
  if (s.phase === "casino") act(s, s.current, { t: "leaveCasino" });
  if (s.phase === "roll") { s.players[s.current].pos = 20; roll(s, 1, 2); pass(s); return; }
  act(s, s.current, { t: "endTurn" });
};

describe("ход и покупка", () => {
  it("старт: 1500 у каждого, фаза броска", () => {
    const s = game();
    expect(s.players.map((p) => p.money)).toEqual([1500, 1500, 1500]);
    expect(s.phase).toBe("roll");
  });

  it("проход через Старт даёт 200 и клетку можно купить", () => {
    const s = game();
    s.players[0].pos = 39;
    roll(s, 1, 1);
    expect(s.players[0].pos).toBe(1);
    expect(s.players[0].money).toBe(1700);
    expect(s.pending).toEqual({ kind: "buy", cell: 1 });
    expect(act(s, 0, { t: "buy" }).ok).toBe(true);
    expect(s.props[1].owner).toBe(0);
    expect(s.players[0].money).toBe(1640);
    expect(s.phase).toBe("roll"); // дубль — ещё бросок
  });

  it("чужой игрок платит аренду, монополия удваивает базовую", () => {
    const s = game();
    s.props[1].owner = 1;
    expect(rentFor(s, 1)).toBe(4);
    s.props[3].owner = 1;
    expect(rentFor(s, 1)).toBe(8);
    s.players[0].pos = 39;
    roll(s, 1, 1);
    expect(s.pending).toMatchObject({ kind: "rent", amount: 8 });
    act(s, 0, { t: "payRent" });
    expect(s.players[1].money).toBe(1508);
  });

  it("нельзя ходить за другого игрока", () => {
    const s = game();
    expect(act(s, 1, { t: "roll" }).ok).toBe(false);
  });
});

describe("стройка на время", () => {
  const withOil = () => {
    const s = game(3);
    for (const i of [31, 32, 34]) s.props[i].owner = 0;
    return s;
  };

  it("уровень 1 стоит 50% цены и строится за раунд чужих ходов", () => {
    const s = withOil();
    expect(act(s, 0, { t: "build", cell: 31, branch: "rent" }).ok).toBe(true);
    expect(s.players[0].money).toBe(1350);
    expect(s.props[31].construction?.target).toBe(1);
    expect(rentFor(s, 31)).toBe(Math.round(26 * 2 * 0.5)); // монополия ×2, во время стройки — 50%
    pass(s); // ход игрока 0 сам стройку не двигает
    expect(s.props[31].construction?.progress).toBe(0);
    pass(s);
    expect(s.props[31].construction?.progress).toBeCloseTo(50);
    pass(s);
    expect(s.props[31].level).toBe(1);
    expect(s.props[31].construction).toBeNull();
    expect(rentFor(s, 31)).toBe(26 * 4);
  });

  it("тапы во время чужого хода ускоряют стройку и дают бонус «Успел!»", () => {
    const s = withOil();
    act(s, 0, { t: "build", cell: 31, branch: "rent" });
    expect(act(s, 0, { t: "tap", cell: 31 }).ok).toBe(false); // свой ход
    pass(s);
    expect(act(s, 0, { t: "tap", cell: 31, n: 60 }).ok).toBe(true);
    expect(s.players[0].energy).toBe(0);
    expect(act(s, 0, { t: "tap", cell: 31 }).ok).toBe(false); // бригада устала
    pass(s); // +50% → 110%
    expect(s.props[31].level).toBe(1);
    expect(s.props[31].fastBonus).toBe(true);
    expect(rentFor(s, 31)).toBe(Math.round(26 * 4 * 1.2));
  });

  it("уровень 2 требует двух клеток отрасли, уровень 3 — монополии", () => {
    const s = game();
    s.props[31].owner = 0;
    s.props[31].level = 1;
    s.props[31].branch = "rent";
    expect(act(s, 0, { t: "build", cell: 31 }).error).toMatch(/2 клетки/);
    s.props[32].owner = 0;
    s.props[31].level = 2;
    expect(act(s, 0, { t: "build", cell: 31 }).error).toMatch(/монополия/);
  });

  it("на одном телефоне тапов нет", () => {
    const s = game(3, { mode: "hotseat" });
    s.props[31].owner = 0;
    act(s, 0, { t: "build", cell: 31, branch: "income" });
    pass(s);
    expect(act(s, 0, { t: "tap", cell: 31 }).ok).toBe(false);
  });

  it("ветка «Доход» платит владельцу в начале его хода", () => {
    const s = game(2);
    s.props[39].owner = 0;
    s.props[39].level = 1;
    s.props[39].branch = "income";
    pass(s);
    const before = s.players[0].money;
    pass(s);
    expect(s.players[0].money).toBe(before + 16); // 4% от 400
  });
});

describe("аукцион и слияние", () => {
  it("отказ от покупки запускает аукцион, побеждает старшая ставка", () => {
    const s = game(3);
    s.players[0].pos = 20;
    roll(s, 1, 2); // Калининград, 220
    act(s, 0, { t: "decline" });
    expect(s.phase).toBe("auction");
    expect(act(s, 1, { t: "bid", amount: 150 }).ok).toBe(true);
    expect(act(s, 2, { t: "bid", amount: 180 }).ok).toBe(true);
    expect(s.phase).toBe("auction");
    act(s, 0, { t: "bid", amount: 0 });
    expect(s.props[23].owner).toBe(2);
    expect(s.players[2].money).toBe(1320);
    expect(s.phase).toBe("end");
  });

  it("слияние: выкуп последней клетки отрасли за двойную цену", () => {
    const s = game(2);
    s.props[37].owner = 0;
    s.props[39].owner = 1;
    expect(act(s, 0, { t: "takeover", cell: 39 }).ok).toBe(true);
    expect(s.props[39].owner).toBe(0);
    expect(s.players[0].money).toBe(700);
    expect(s.players[1].money).toBe(2300);
  });

  it("быстрая партия раздаёт по клетке каждому", () => {
    const s = newGame({ players: players(4), mode: "solo", length: "quick", seed: 5 });
    for (const p of s.players) expect(Object.values(s.props).filter((q) => q.owner === p.id).length).toBe(1);
  });
});

describe("казино и банкротство", () => {
  it("Загул отправляет в казино, на следующем ходу можно остаться", () => {
    const s = game(2);
    s.players[0].pos = 27;
    roll(s, 1, 2);
    expect(s.players[0].pos).toBe(10);
    expect(s.phase).toBe("casino");
    expect(act(s, 0, { t: "roulette", choice: "red", amount: 1000 }).ok).toBe(false); // лимит 20%
    expect(act(s, 0, { t: "roulette", choice: "red", amount: 100 }).ok).toBe(true);
    act(s, 0, { t: "leaveCasino" });
    act(s, 0, { t: "endTurn" });
    pass(s);
    expect(s.phase).toBe("casinoExit");
    act(s, 0, { t: "stay" });
    expect(s.phase).toBe("end");
  });

  it("банкрот отдаёт имущество кредитору, игра заканчивается", () => {
    const s = game(2);
    s.props[39].owner = 1;
    s.props[39].level = 3;
    s.props[39].branch = "rent";
    s.props[1].owner = 0;
    s.players[0].money = 100;
    s.players[0].pos = 37;
    roll(s, 1, 1);
    act(s, 0, { t: "payRent" });
    expect(s.players[0].bankrupt).toBe(true);
    expect(s.props[1].owner).toBe(1);
    expect(s.phase).toBe("gameover");
    expect(s.winner).toBe(1);
  });
});

describe("партии ботов", () => {
  it("200 быстрых партий доходят до конца без ошибок", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = newGame({ players: players(2 + (seed % 5), true), mode: "solo", length: "quick", seed });
      playOut(s);
      expect(s.phase).toBe("gameover");
      expect(s.winner).not.toBeNull();
      for (const p of s.players) expect(p.money).toBeGreaterThanOrEqual(0);
      expect(capital(s, s.winner!)).toBeGreaterThan(0);
    }
  });
});

describe("биржа", () => {
  const own = () => {
    const s = game(3);
    s.props[39].owner = 0; // Москва, 400
    return s;
  };

  it("владелец выставляет до 40%, покупатель платит владельцу, цена растёт", () => {
    const s = own();
    const price0 = lotPrice(s, 39);
    expect(price0).toBe(40);
    expect(act(s, 0, { t: "listShares", cell: 39, lots: 5 }).ok).toBe(false); // оставить 60%
    expect(act(s, 0, { t: "listShares", cell: 39, lots: 2 }).ok).toBe(true);
    pass(s);
    const m0 = s.players[0].money, m1 = s.players[1].money;
    const p1 = lotPrice(s, 39);
    expect(act(s, 1, { t: "buyShares", cell: 39, lots: 1 }).ok).toBe(true);
    expect(s.props[39].holders[1]).toBe(1);
    expect(s.players[1].money).toBe(m1 - p1);
    expect(s.players[0].money).toBe(m0 + p1);
    expect(lotPrice(s, 39)).toBeGreaterThan(p1);
  });

  it("аренда делится между владельцем и акционерами", () => {
    const s = own();
    s.props[39].holders = { 1: 3 }; // 30% у второго игрока
    s.players[2].money = 1500;
    s.current = 2;
    s.players[2].pos = 37;
    roll(s, 1, 1);
    const rent = (s.pending as { amount: number }).amount;
    const o0 = s.players[0].money, h1 = s.players[1].money;
    act(s, 2, { t: "payRent" });
    expect(s.players[1].money - h1).toBe(Math.round(rent * 0.3));
    expect(s.players[0].money - o0).toBe(rent - Math.round(rent * 0.3));
  });

  it("прямое предложение человеку: принять — лот и деньги переходят", () => {
    const s = own();
    expect(act(s, 0, { t: "offerShares", cell: 39, lots: 1, to: 1, price: 50 }).ok).toBe(true);
    expect(s.offers.length).toBe(1);
    const id = s.offers[0].id;
    expect(act(s, 2, { t: "acceptOffer", id }).ok).toBe(false); // не тому
    expect(act(s, 1, { t: "acceptOffer", id }).ok).toBe(true);
    expect(s.props[39].holders[1]).toBe(1);
    expect(s.players[1].money).toBe(1450);
  });

  it("стоимость компании зависит от спроса, капитал учитывает доли", () => {
    const s = own();
    const v0 = companyValue(s, 39);
    s.props[39].holders = { 1: 2 };
    expect(capital(s, 0)).toBe(1500 + Math.round(v0 * 0.8));
    s.props[39].demand = 1.5;
    expect(companyValue(s, 39)).toBe(Math.round(v0 * 1.5));
  });
});

describe("казино", () => {
  it("блэкджек: подсчёт очков с тузами", () => {
    expect(handValue([1, 13])).toBe(21);
    expect(handValue([1, 1, 9])).toBe(21);
    expect(handValue([10, 9, 5])).toBe(24);
  });

  it("казино ожидания: только в чужой ход, не больше 3 ставок и 10% денег", () => {
    const s = game(3);
    expect(act(s, 0, { t: "lounge", game: "slots", amount: 50 }).ok).toBe(false); // свой ход
    pass(s);
    expect(act(s, 0, { t: "lounge", game: "slots", amount: 500 }).ok).toBe(false); // > 10%
    for (let k = 0; k < 3; k++) expect(act(s, 0, { t: "lounge", game: "roulette", choice: "red", amount: 10 }).ok).toBe(true);
    expect(act(s, 0, { t: "lounge", game: "slots", amount: 10 }).ok).toBe(false);
  });

  it("тотализатор срабатывает на ближайшем броске", () => {
    const s = game(2);
    pass(s); // ходит игрок 1
    const m = s.players[0].money;
    expect(act(s, 0, { t: "tote", choice: "seven", amount: 100 }).ok).toBe(true);
    s.players[1].pos = 20;
    roll(s, 3, 4);
    expect(s.players[0].money).toBe(m - 100 + 560);
    expect(s.players[0].tote).toBeNull();
  });

  it("блэкджек в ожидании: ставка списывается, раздача доигрывается", () => {
    const s = game(2);
    pass(s);
    expect(act(s, 0, { t: "loungeBj", amount: 100 }).ok).toBe(true);
    let guard = 0;
    while (s.players[0].bj && guard++ < 10) act(s, 0, { t: "bjStand" });
    expect(s.players[0].bj).toBeNull();
    expect(s.events.some((e) => e.type === "casino" && e.game === "Блэкджек" && e.data?.done)).toBe(true);
  });
});

describe("отработка, сделки с чужими компаниями, выгоды акций", () => {
  const withBots = () => newGame({ players: [
    { name: "Я", bot: false, token: "", color: "" },
    { name: "Акула", bot: true, personality: "shark", difficulty: "normal", token: "", color: "" },
    { name: "Скряга", bot: true, personality: "miser", difficulty: "normal", token: "", color: "" },
  ], mode: "solo", length: "classic", seed: 7 });

  it("отработка: платишь 90% аренды и пропускаешь ход", () => {
    const s = game(2);
    s.props[39].owner = 1; s.props[39].level = 1; s.props[39].branch = "rent";
    s.players[0].pos = 37;
    roll(s, 1, 1);
    const rent = (s.pending as { amount: number }).amount;
    const o = s.players[1].money;
    act(s, 0, { t: "workOff" });
    expect(s.players[1].money - o).toBe(Math.round(rent * 0.9));
    expect(s.players[0].skipNext).toBe(true);
  });

  it("предложение боту купить акции: мало — отказ с ценой, достаточно — сделка", () => {
    const s = withBots();
    s.props[39].owner = 1;
    const low = act(s, 0, { t: "bidShares", cell: 39, lots: 1, price: 20 });
    expect(low.ok).toBe(true);
    expect(low.info).toMatch(/не меньше (\d+)/);
    const ask = Number(low.info!.match(/не меньше (\d+)/)![1]);
    s.players[0].trades = 0;
    const ok = act(s, 0, { t: "bidShares", cell: 39, lots: 1, price: ask });
    expect(ok.info).toMatch(/согласен/);
    expect(s.props[39].holders[0]).toBe(1);
  });

  it("выкуп компании целиком у бота за достаточную сумму", () => {
    const s = withBots();
    s.props[21].owner = 2; // Сочи у Скряги
    const r1 = act(s, 0, { t: "bidCompany", cell: 21, price: 100 });
    const ask = Number(r1.info!.match(/не меньше (\d+)/)![1]);
    expect(ask).toBeGreaterThan(220);
    s.players[0].trades = 0;
    act(s, 0, { t: "bidCompany", cell: 21, price: ask });
    expect(s.props[21].owner).toBe(0);
  });

  it("публичная компания: аренда выше, стройка дешевле, слияние запрещено", () => {
    const s = game(2);
    s.props[37].owner = 0; s.props[39].owner = 1;
    const rent0 = rentFor(s, 39), cost0 = buildCost(s, 1, 39, 1);
    expect(canTakeover(s, 0, 39).ok).toBe(true);
    s.props[39].holders = { 0: 2 };
    expect(rentFor(s, 39)).toBe(Math.round(rent0 * 1.1));
    expect(buildCost(s, 1, 39, 1)).toBe(Math.round(cost0 * 0.9));
    expect(canTakeover(s, 0, 39).ok).toBe(false);
    void capital; void companyValue; void lotPrice;
  });
});

describe("складчина, кредиты, снос", () => {
  const mixed = () => newGame({ players: [
    { name: "Я", bot: false, token: "", color: "" },
    { name: "Акула", bot: true, personality: "shark", difficulty: "normal", token: "", color: "" },
    { name: "Скряга", bot: true, personality: "miser", difficulty: "normal", token: "", color: "" },
  ], mode: "solo", length: "classic", seed: 3 });

  it("покупка в складчину: партнёры платят свои доли и становятся акционерами", () => {
    const s = mixed();
    s.players[0].money = 250;
    s.players[0].pos = 37;
    roll(s, 1, 1); // Москва, 400
    expect(s.pending).toMatchObject({ kind: "buy", cell: 39 });
    expect(act(s, 0, { t: "buy" }).ok).toBe(false);
    const r = act(s, 0, { t: "buyCoop", partners: [{ pid: 1, lots: 3 }, { pid: 2, lots: 1 }] });
    expect(r.ok).toBe(true);
    expect(s.props[39].owner).toBe(0);
    expect(s.props[39].holders).toEqual({ 1: 3, 2: 1 });
    expect(s.players[0].money).toBe(250 - 240); // партнёры заплатили 120 + 40
  });

  it("бот без денег отказывается войти в долю", () => {
    const s = mixed();
    s.players[2].money = 100;
    s.players[0].pos = 37;
    roll(s, 1, 1);
    const r = act(s, 0, { t: "buyCoop", partners: [{ pid: 2, lots: 2 }] });
    expect(r.ok).toBe(false);
  });

  it("кредит под залог компании: деньги сразу, проценты каждый ход, просрочка — банк забирает", () => {
    const s = game(2);
    s.props[39].owner = 0;
    const lim = act(s, 0, { t: "takeLoan", cell: 39, kind: "company", amount: 10000 });
    expect(lim.ok).toBe(false);
    expect(act(s, 0, { t: "takeLoan", cell: 39, kind: "company", amount: 200 }).ok).toBe(true);
    expect(s.players[0].money).toBe(1700);
    pass(s); pass(s);
    expect(s.players[0].money).toBe(1700 - 10); // 5% за ход
    s.players[0].loans[0].due = 0;
    pass(s); pass(s);
    expect(s.props[39].owner).toBeNull();
    expect(s.players[0].loans.length).toBe(0);
  });

  it("снос построек возвращает половину вложений и даёт выбрать другую ветку", () => {
    const s = game(2);
    s.props[39].owner = 0; s.props[39].level = 1; s.props[39].branch = "rent"; s.props[39].invested = 200;
    expect(act(s, 0, { t: "demolish", cell: 39 }).ok).toBe(true);
    expect(s.players[0].money).toBe(1600);
    expect(s.props[39].branch).toBeNull();
    expect(act(s, 0, { t: "build", cell: 39, branch: "income" }).ok).toBe(true);
  });
});

describe("вклад, роскошь, реклама", () => {
  it("вклад: 2% за каждый свой ход, снять можно в любой свой ход, выручает при платеже", () => {
    const s = game(2);
    expect(act(s, 0, { t: "deposit", amount: 1000 }).ok).toBe(true);
    expect(s.players[0].money).toBe(500);
    expect(capital(s, 0)).toBe(1500);
    pass(s); pass(s);
    expect(s.players[0].money).toBe(520);
    expect(act(s, 0, { t: "withdraw", amount: 300 }).ok).toBe(true);
    expect(s.players[0].deposit).toBe(700);
    s.players[0].money = 0;
    s.players[0].pos = 37;
    roll(s, 1, 0); // «Налог на роскошь» — платим со вклада
    expect(s.players[0].bankrupt).toBe(false);
    expect(s.players[0].deposit).toBe(700 - 75);
  });

  it("роскошь: налог при покупке, статус поднимает аренду, вещь считается в капитале и продаётся", () => {
    const s = game(2);
    s.props[39].owner = 0;
    const rent0 = rentFor(s, 39);
    expect(act(s, 0, { t: "buyLux", kind: "car" }).ok).toBe(true);
    expect(s.players[0].money).toBe(1500 - luxCost("car"));
    expect(luxCost("car")).toBeGreaterThan(350);
    expect(fame(s, 0)).toBe(3);
    expect(rentFor(s, 39)).toBe(Math.round(rent0 * 1.09));
    expect(act(s, 0, { t: "buyLux", kind: "car" }).ok).toBe(false);
    const it0 = s.players[0].lux[0];
    expect(capital(s, 0)).toBe(1500 - luxCost("car") + 350 + Math.round(companyValue(s, 39)));
    expect(act(s, 0, { t: "sellLux", id: it0.id }).ok).toBe(true);
    expect(s.players[0].money).toBe(1500 - luxCost("car") + 350);
    expect(fame(s, 0)).toBe(0);
  });

  it("вечеринка на яхте даёт вдвое больше статуса, через 3 хода эффект проходит", () => {
    const s = game(2, { startMoney: 5000 });
    act(s, 0, { t: "buyLux", kind: "yacht" });
    expect(act(s, 0, { t: "experience", kind: "party" }).ok).toBe(true);
    expect(fame(s, 0)).toBe(10 + 8);
    expect(act(s, 0, { t: "experience", kind: "party" }).ok).toBe(false);
    for (let k = 0; k < 6; k++) pass(s);
    expect(fame(s, 0)).toBe(10);
  });

  it("подарки семье: заначка выручает, когда не хватает на платёж", () => {
    const s = game(2);
    expect(act(s, 0, { t: "experience", kind: "gifts" }).ok).toBe(true);
    expect(s.players[0].stash).toBe(150);
    expect(capital(s, 0)).toBe(1500);
    s.players[0].money = 10;
    s.players[0].pos = 37;
    roll(s, 1, 0);
    expect(s.players[0].bankrupt).toBe(false);
    expect(s.players[0].stash).toBe(150 - 65);
  });

  it("реклама: аренда выше, продажи каждый свой ход, по окончании эффект снимается", () => {
    const s = game(2);
    s.props[39].owner = 0;
    const rent0 = rentFor(s, 39);
    const cost = adCost(s, 0, 39, "flyers");
    expect(act(s, 0, { t: "advertise", cell: 39, kind: "flyers" }).ok).toBe(true);
    expect(s.players[0].money).toBe(1500 - cost);
    expect(rentFor(s, 39)).toBe(Math.round(rent0 * 1.3));
    expect(act(s, 0, { t: "advertise", cell: 39, kind: "tv" }).ok).toBe(false);
    pass(s); pass(s);
    expect(s.players[0].money).toBe(1500 - cost + Math.round(rent0 * 0.35));
    for (let k = 0; k < 4; k++) pass(s);
    expect(s.props[39].ad).toBeNull();
  });
});
