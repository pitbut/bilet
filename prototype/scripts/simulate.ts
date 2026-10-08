// Тысячи партий ботов: проверка баланса (см. «Цели баланса для тестов» в дизайн-документе).
import { BOARD, BranchId } from "../src/engine/board";
import { Personality, capital, newGame } from "../src/engine/engine";
import { botStep } from "../src/engine/runner";

const N = Number(process.argv[2] ?? 2000);
const LENGTH = (process.argv[3] ?? "quick") as "quick" | "classic";
const pers: Personality[] = ["shark", "miser", "gambler", "trader"];
const wins: Record<string, number> = {};
const branchWins: Record<BranchId, number> = { rent: 0, income: 0, special: 0 };
const firstMonopolyRounds: number[] = [], rounds: number[] = [];
let jackpots = 0, unfinished = 0;
let casinoIn = 0, casinoOut = 0;

for (let seed = 1; seed <= N; seed++) {
  const s = newGame({
    players: pers.map((p) => ({ name: p, bot: true, personality: p, difficulty: "normal", token: "sedan", color: "#fff" })),
    mode: "solo", length: LENGTH, seed: seed * 7919,
  });
  let firstMono: number | null = null, steps = 0;
  while (s.phase !== "gameover" && steps++ < 100000) {
    botStep(s);
    for (const e of s.events) {
      if (e.type === "jackpot") jackpots++;
      if (e.type === "casino") { casinoIn += 1; casinoOut += e.win; }
    }
    s.events.length = 0;
    if (firstMono === null) {
      const inds = new Set(BOARD.filter((c) => c.industry).map((c) => c.industry!));
      for (const ind of inds) {
        const owners = BOARD.filter((c) => c.industry === ind).map((c) => s.props[c.index].owner);
        if (owners[0] !== null && owners.every((o) => o === owners[0])) firstMono = s.round;
      }
    }
  }
  if (s.phase !== "gameover") { unfinished++; continue; }
  const w = s.players[s.winner!];
  wins[w.personality!] = (wins[w.personality!] ?? 0) + 1;
  const br: Record<BranchId, number> = { rent: 0, income: 0, special: 0 };
  for (const p of Object.values(s.props)) if (p.owner === w.id && p.branch) br[p.branch] += p.level;
  const top = (Object.entries(br) as [BranchId, number][]).sort((a, b) => b[1] - a[1])[0];
  if (top[1] > 0) branchWins[top[0]]++;
  if (firstMono !== null) firstMonopolyRounds.push(firstMono);
  rounds.push(s.round);
  void capital;
}
const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(1);
const done = N - unfinished;
console.log(`Партий: ${N} (${LENGTH}), не закончились: ${unfinished}`);
console.log("Победы по характеру ботов:", Object.fromEntries(Object.entries(wins).map(([k, v]) => [k, `${(100 * v / done).toFixed(1)}%`])));
console.log("Основная ветка победителя:", Object.fromEntries(Object.entries(branchWins).map(([k, v]) => [k, `${(100 * v / done).toFixed(1)}%`])));
console.log(`Первая монополия отрасли — в среднем на раунде ${avg(firstMonopolyRounds)} (бывает в ${(100 * firstMonopolyRounds.length / done).toFixed(0)}% партий)`);
console.log(`Средняя длина: ${avg(rounds)} раундов; джекпот сорван в ${(100 * jackpots / done).toFixed(1)}% партий`);
console.log(`Ставок в казино: ${casinoIn}, средний результат ставки: ${(casinoOut / Math.max(1, casinoIn)).toFixed(1)}`);
