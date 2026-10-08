import { describe, expect, it } from "vitest";
import { GameConfig, GameState, act, capital, newGame, rentFor } from "../src/engine/engine";
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
