// Сетевая партия: хозяин держит единственную верную копию игры и считает все случайности,
// гости только присылают свои действия и получают состояние после каждого шага.
import { Action, GameEvent, GameState, Result } from "../engine/engine";
import { Transport } from "./transport";

export const PROTOCOL = 1;

export interface LobbySeat { name: string; kind: "host" | "guest" | "bot" }

type ToHost =
  | { t: "hello"; name: string; v: number }
  | { t: "req"; id: number; pid: number; a: Action }
  | { t: "askres"; id: number; yes: boolean };

type ToGuest =
  | { t: "lobby"; seats: LobbySeat[] }
  | { t: "start"; state: GameState; seat: number }
  | { t: "state"; state: GameState; events: GameEvent[] }
  | { t: "res"; id: number; r: Result; events: GameEvent[] }
  | { t: "ask"; id: number; q: string }
  | { t: "full"; why: string };

export interface ActReply { r: Result; events: GameEvent[] }

/** Снимок состояния без очереди событий (события идут отдельно). */
const snapshot = (s: GameState): GameState => ({ ...s, events: [], forcedDice: undefined });

// ---------- Хозяин ----------

interface Guest { peer: string; name: string; seat: number | null; online: boolean }

export class NetHost {
  guests: Guest[] = [];
  started = false;
  onLobby: () => void = () => {};
  /** Действие гостя: хозяин выполняет его в своей копии игры. */
  onRequest: (seat: number, pid: number, a: Action) => Promise<ActReply> = async () => ({ r: { ok: false, error: "Игра не начата" }, events: [] });
  onGuestLost: (seat: number) => void = () => {};
  onGuestBack: (seat: number) => void = () => {};
  private asks = new Map<number, (yes: boolean) => void>();
  private askId = 1;
  private current: GameState | null = null;

  constructor(private tr: Transport, public hostName: string) {
    tr.onPeer = (peer, up) => this.peer(peer, up);
    tr.onData = (peer, data) => {
      let m: ToHost;
      try { m = JSON.parse(data) as ToHost; } catch { return; }
      this.message(peer, m);
    };
  }

  private send(peer: string, m: ToGuest) { this.tr.send(peer, JSON.stringify(m)); }

  seats(): LobbySeat[] {
    return [{ name: this.hostName, kind: "host" }, ...this.guests.filter((g) => g.online || g.seat !== null).map((g) => ({ name: g.name, kind: "guest" as const }))];
  }

  private peer(peer: string, up: boolean) {
    const g = this.guests.find((x) => x.peer === peer);
    if (up || !g) return; // гость сначала присылает «hello»
    g.online = false;
    if (!this.started) this.guests = this.guests.filter((x) => x !== g);
    else if (g.seat !== null) this.onGuestLost(g.seat);
    this.lobby();
  }

  private message(peer: string, m: ToHost) {
    if (m.t === "hello") {
      if (m.v !== PROTOCOL) { this.send(peer, { t: "full", why: "Разные версии игры — обновите приложение" }); return; }
      const back = this.started ? this.guests.find((x) => !x.online && x.name === m.name && x.seat !== null) : undefined;
      if (back) { // вернулся после обрыва связи
        back.peer = peer; back.online = true;
        this.onGuestBack(back.seat!);
        if (this.current) this.send(peer, { t: "start", state: snapshot(this.current), seat: back.seat! });
        return;
      }
      if (this.started) { this.send(peer, { t: "full", why: "Партия уже идёт" }); return; }
      if (this.guests.length >= 5) { this.send(peer, { t: "full", why: "За столом нет мест" }); return; }
      let name = m.name.trim().slice(0, 14) || "Гость";
      if ([this.hostName, ...this.guests.map((x) => x.name)].includes(name)) name = `${name} ${this.guests.length + 2}`;
      this.guests.push({ peer, name, seat: null, online: true });
      this.lobby();
      return;
    }
    const g = this.guests.find((x) => x.peer === peer && x.online);
    if (!g || g.seat === null) return;
    if (m.t === "req") {
      const seat = g.seat;
      void (m.pid === seat ? this.onRequest(seat, m.pid, m.a) : Promise.resolve({ r: { ok: false, error: "Чужой ход" }, events: [] }))
        .then((reply) => this.send(peer, { t: "res", id: m.id, ...reply }));
    } else if (m.t === "askres") {
      this.asks.get(m.id)?.(m.yes);
      this.asks.delete(m.id);
    }
  }

  lobby() {
    const seats = this.seats();
    for (const g of this.guests) if (g.online) this.send(g.peer, { t: "lobby", seats });
    this.onLobby();
  }

  /** Раздаёт места (хозяин — 0, гости — 1..n) и шлёт всем начальное состояние. */
  assignSeats(): string[] {
    const names = [this.hostName];
    for (const g of this.guests.filter((x) => x.online)) { g.seat = names.length; names.push(g.name); }
    this.guests = this.guests.filter((x) => x.seat !== null);
    return names;
  }

  start(state: GameState) {
    this.started = true;
    this.current = state;
    for (const g of this.guests) if (g.online && g.seat !== null) this.send(g.peer, { t: "start", state: snapshot(state), seat: g.seat });
  }

  broadcast(state: GameState, events: GameEvent[]) {
    this.current = state;
    const m: ToGuest = { t: "state", state: snapshot(state), events };
    const data = JSON.stringify(m);
    for (const g of this.guests) if (g.online) this.tr.send(g.peer, data);
  }

  isRemote(seat: number) { return this.guests.some((g) => g.seat === seat); }
  isOnline(seat: number) { return this.guests.some((g) => g.seat === seat && g.online); }

  ask(seat: number, q: string): Promise<boolean> {
    const g = this.guests.find((x) => x.seat === seat && x.online);
    if (!g) return Promise.resolve(false);
    const id = this.askId++;
    this.send(g.peer, { t: "ask", id, q });
    return new Promise((res) => {
      this.asks.set(id, res);
      setTimeout(() => { if (this.asks.has(id)) { this.asks.delete(id); res(false); } }, 30000);
    });
  }

  close() { this.tr.close(); }
}

// ---------- Гость ----------

export class NetClient {
  seat: number | null = null;
  seats: LobbySeat[] = [];
  onLobby: () => void = () => {};
  onStart: (state: GameState, seat: number) => void = () => {};
  onState: (state: GameState, events: GameEvent[]) => void = () => {};
  onAsk: (q: string) => Promise<boolean> = async () => false;
  onLost: (why: string) => void = () => {};
  private reqs = new Map<number, (r: ActReply) => void>();
  private reqId = 1;

  constructor(private tr: Transport, public name: string) {
    tr.onPeer = (_p, up) => { if (!up) this.onLost("Связь с хозяином стола потеряна"); };
    tr.onData = (_p, data) => {
      let m: ToGuest;
      try { m = JSON.parse(data) as ToGuest; } catch { return; }
      this.message(m);
    };
    this.send({ t: "hello", name, v: PROTOCOL });
  }

  private send(m: ToHost) { this.tr.send("host", JSON.stringify(m)); }

  private message(m: ToGuest) {
    if (m.t === "lobby") { this.seats = m.seats; this.onLobby(); }
    else if (m.t === "start") { this.seat = m.seat; this.onStart(m.state, m.seat); }
    else if (m.t === "state") this.onState(m.state, m.events);
    else if (m.t === "res") { this.reqs.get(m.id)?.({ r: m.r, events: m.events }); this.reqs.delete(m.id); }
    else if (m.t === "ask") void this.onAsk(m.q).then((yes) => this.send({ t: "askres", id: m.id, yes }));
    else if (m.t === "full") this.onLost(m.why);
  }

  request(pid: number, a: Action): Promise<ActReply> {
    const id = this.reqId++;
    this.send({ t: "req", id, pid, a });
    return new Promise((res) => {
      this.reqs.set(id, res);
      setTimeout(() => { if (this.reqs.has(id)) { this.reqs.delete(id); res({ r: { ok: false, error: "Хозяин стола не отвечает" }, events: [] }); } }, 10000);
    });
  }

  close() { this.tr.close(); }
}
