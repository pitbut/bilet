// Сохранение партии на одном телефоне: после каждого шага, чтобы можно было выйти и продолжить позже.
import { GameState } from "../engine/engine";

const KEY = "oligarh-save";
export interface SavedGame { state: GameState; speed: "normal" | "fast" | "instant"; at: number }

export function saveGame(state: GameState, speed: SavedGame["speed"]) {
  if (state.cfg.mode === "network") return;
  try { localStorage.setItem(KEY, JSON.stringify({ state: { ...state, events: [] }, speed, at: Date.now() } satisfies SavedGame)); } catch { /* нет места или приватный режим */ }
}

export function loadGame(): SavedGame | null {
  try {
    const g = JSON.parse(localStorage.getItem(KEY) ?? "null") as SavedGame | null;
    return g && g.state?.players && g.state.phase !== "gameover" ? g : null;
  } catch { return null; }
}

export function clearSave() { try { localStorage.removeItem(KEY); } catch { /* ничего */ } }
