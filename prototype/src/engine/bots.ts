// Боты с характерами: Акула, Скряга, Игроман, Торгаш.
import { BOARD, BranchId, industryCells } from "./board";
import { Action, GameState, Personality, canBuild, canTakeover, companyValue, freeLots, hasMonopoly, lotPrice, ownedCount, randInt, rentFor } from "./engine";

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
      // отработка: −10% к аренде ценой пропуска хода — выгодна при крупной аренде
      const heavy = pend.amount > pl.money * 0.4 || pend.amount >= 150;
      return { t: heavy && (pers === "miser" || pers === "trader") ? "workOff" : "payRent" };
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
      const st = pl.difficulty === "easy" ? null : stockMove(s, reserve);
      if (st) return st;
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

/** Биржа для бота: при нехватке денег продаёт долю (или предлагает её человеку), при избытке — покупает доходные акции. */
function stockMove(s: GameState, reserve: number): Action | null {
  const pl = s.players[s.current];
  if (pl.trades >= 2) return null;
  const owned = Object.keys(s.props).map(Number).filter((i) => s.props[i].owner === pl.id && freeLots(s, pl.id, i) > 0);
  if (pl.money < reserve * 0.8 && owned.length) {
    const i = owned.sort((a, b) => lotPrice(s, b) - lotPrice(s, a))[0];
    const human = s.players.find((p) => !p.bot && !p.bankrupt);
    if (s.cfg.mode === "solo" && human && randInt(s, 10) < 4 && !s.offers.some((o) => o.from === pl.id)) {
      return { t: "offerShares", cell: i, lots: 1, to: human.id, price: Math.round(lotPrice(s, i) * 1.05) };
    }
    return { t: "listShares", cell: i, lots: 1 };
  }
  // богатый бот иногда сам предлагает человеку выкупить долю или всю компанию, если она закрывает его монополию
  const human = s.players.find((p) => !p.bot && !p.bankrupt);
  if (s.cfg.mode === "solo" && human && pl.money > reserve * 4 && randInt(s, 10) < 2 && !s.offers.some((o) => o.from === pl.id)) {
    const theirs = Object.keys(s.props).map(Number).filter((i) => s.props[i].owner === human.id);
    const key = theirs.find((i) => {
      const ind = BOARD[i].industry;
      return ind && industryCells(ind).filter((j) => j !== i).every((j) => s.props[j].owner === pl.id);
    });
    if (key !== undefined && pl.money > companyValue(s, key) * 2) return { t: "bidCompany", cell: key, price: Math.round(companyValue(s, key) * 1.6) };
    const best = theirs.filter((i) => freeLots(s, human.id, i) > 0).sort((a, b) => rentFor(s, b) - rentFor(s, a))[0];
    if (best !== undefined && rentFor(s, best) > 0) return { t: "bidShares", cell: best, lots: 1, price: Math.round(lotPrice(s, best) * 1.15) };
  }
  if (pl.money > reserve * 3) {
    let best: { i: number; y: number } | null = null;
    for (const [k, p] of Object.entries(s.props)) {
      if (!p.listings.some((l) => l.seller !== pl.id) || p.owner === null) continue;
      const price = lotPrice(s, +k);
      if (pl.money - price < reserve * 2) continue;
      const y = (rentFor(s, +k) + 1) / price; // доходность: аренда за посещение на 10%
      if (!best || y > best.y) best = { i: +k, y };
    }
    if (best && best.y > 0.05) return { t: "buyShares", cell: best.i, lots: 1 };
  }
  return null;
}
