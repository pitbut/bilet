// Прогон хода ботов без графики — для тестов, симуляций и быстрых ходов в UI.
import { botAction } from "./bots";
import { Action, GameState, act } from "./engine";

/** Выполняет одно действие бота; если бот ошибся — завершает его фазу безопасным действием. */
export function botStep(s: GameState): Action {
  if (s.phase === "auction" && s.pending?.kind === "auction") { // люди в симуляции не участвуют — пасуют
    for (const pid of [...s.pending.waiting]) act(s, pid, { t: "bid", amount: 0 });
    return { t: "bid", amount: 0 };
  }
  const a = botAction(s);
  const r = act(s, s.current, a);
  if (r.ok) return a;
  const fallback: Action =
    s.phase === "roll" ? { t: "roll" } : s.phase === "decide"
      ? (s.pending?.kind === "buy" ? { t: "decline" } : { t: "payRent" })
      : s.phase === "casino" ? { t: "leaveCasino" } : s.phase === "casinoExit" ? { t: "stay" } : { t: "endTurn" };
  act(s, s.current, fallback);
  return fallback;
}

/** Играет партию ботов до конца; возвращает число шагов. */
export function playOut(s: GameState, maxSteps = 200000): number {
  let steps = 0;
  while (s.phase !== "gameover" && steps < maxSteps) {
    botStep(s);
    s.events.length = 0;
    steps++;
  }
  return steps;
}
