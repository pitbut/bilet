// Боты с характерами: Акула, Скряга, Игроман, Торгаш.
import { BOARD, BranchId, industryCells } from "./board";
import { Action, GameState, Personality, canBuild, canTakeover, hasMonopoly, ownedCount, randInt } from "./engine";

const RESERVE: Record<Personality, number> = { shark: 100, miser: 400, gambler: 150, trader: 250 };
const BRANCH: Record<Personality, BranchId> = { shark: "rent", miser: "income", gambler: "special", trader: "rent" };

/** Следующее действие бота, чей сейчас ход. */
export function botAction(s: GameState): Action {
  const pl = s.players[s.current];
  const pers = pl.personality ?? "trader";
  const reserve = RESERVE[pers] * (pl.difficulty === "easy" ? 0.5 : 1);

  switch (s.phase) {
    case "decide": {
      const pend = s.pending!;
      if (pend.kind === "buy") {
        const c = BOARD[pend.cell];
        const price = c.price!;
        const completes = c.industry && ownedCount(s, pl.id, c.industry) === industryCells(c.industry).length - 1;
        const buy = pl.money >= price && (pl.money - price >= reserve || (completes && pl.difficulty !== "easy"));
        return { t: buy ? "buy" : "decline" };
      }
      if (pend.kind !== "rent") return { t: "endTurn" };
      const heavy = pend.amount > pl.money * 0.5;
      return { t: heavy && (pers === "miser" || pl.money < pend.amount) ? "workOff" : "payRent" };
    }
    case "casino": {
      const wants = pers === "gambler" ? 3 : pers === "miser" ? 0 : 1;
      if (s.casinoBets >= wants || pl.money < 100) return { t: "leaveCasino" };
      const amount = Math.max(10, Math.floor(pl.money * (pers === "gambler" ? 0.15 : 0.05)));
      return randInt(s, 2) ? { t: "roulette", choice: randInt(s, 2) ? "red" : "black", amount } : { t: "slots", amount };
    }
    case "casinoExit":
      if (pl.money > 400 && pers !== "miser") return { t: "payExit" };
      return { t: "rollDouble" };
    case "roll": case "end": {
      if (pl.difficulty !== "easy") {
        for (const c of BOARD) {
          const t = canTakeover(s, pl.id, c.index);
          if (t.ok && pl.money - t.cost! >= reserve) return { t: "takeover", cell: c.index };
        }
      }
      const b = pickBuild(s, reserve, BRANCH[pers]);
      if (b) return b;
      if (s.phase === "end") {
        const mort = Object.entries(s.props).find(([i, p]) =>
          p.owner === pl.id && p.mortgaged && pl.money - BOARD[+i].price! * 0.6 > reserve * 2);
        if (mort) return { t: "unmortgage", cell: +mort[0] };
      }
      return { t: s.phase === "roll" ? "roll" : "endTurn" };
    }
  }
  return { t: "endTurn" };
}

function pickBuild(s: GameState, reserve: number, branch: BranchId): Action | null {
  const pl = s.players[s.current];
  const options: { cell: number; cost: number; score: number }[] = [];
  for (const [i, p] of Object.entries(s.props)) {
    if (p.owner !== pl.id) continue;
    const chk = canBuild(s, pl.id, +i);
    if (!chk.ok || pl.money - chk.cost! < reserve * 1.2) continue;
    const ind = BOARD[+i].industry!;
    const score = (hasMonopoly(s, pl.id, ind) ? 2 : 1) * BOARD[+i].price! - chk.level! * 10;
    options.push({ cell: +i, cost: chk.cost!, score });
  }
  if (!options.length) return null;
  options.sort((a, b) => b.score - a.score);
  const pers = pl.personality ?? "trader";
  const pick = options[0];
  const br = pers === "trader" ? (["rent", "income", "special"] as BranchId[])[randInt(s, 3)] : branch;
  return {
    t: "build", cell: pick.cell, branch: br,
    rush: pers === "gambler", insure: pers === "miser" && pl.money - pick.cost * 1.1 > reserve,
  };
}
