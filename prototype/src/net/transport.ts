// Транспорт между телефонами. Bluetooth — в Android-приложении (нативный плагин),
// «вкладки» — для проверки в браузере: каждая вкладка играет роль отдельного телефона.

export interface Transport {
  /** Отправить одному участнику (хозяин → гость; гость шлёт всегда хозяину: peer = "host"). */
  send(peer: string, data: string): void;
  onData: (peer: string, data: string) => void;
  /** Подключился / отключился участник (у гостя peer = "host"). */
  onPeer: (peer: string, up: boolean) => void;
  close(): void;
  /** Интернет: код комнаты, который хозяин диктует друзьям. */
  code?: string;
  /** Интернет: сообщить серверу, сколько за столом и началась ли игра (началась — стол не виден в списке). */
  meta?(players: number, started: boolean): void;
  /** Интернет, гость: связь восстановилась после обрыва — надо снова представиться хозяину. */
  onResume?: () => void;
  /** Интернет, гость: связь не восстановилась (у самого гостя нет интернета). */
  onFail?: (why: string) => void;
}

export interface FoundTable { id: string; name: string; players?: number }

export interface NetDriver {
  kind: "bluetooth" | "tabs" | "online";
  label: string;
  host(tableName: string): Promise<Transport>;
  /** Поиск столов; возвращает функцию остановки поиска. */
  scan(onFound: (t: FoundTable) => void): Promise<() => void>;
  join(id: string): Promise<Transport>;
}

const rid = () => Math.random().toString(36).slice(2, 10);
const noop = () => {};

/** Транспорт с обработчиками, которые потом заменит сессия. Не литералом: сборщик выбрасывал вызовы «пустых» onPeer. */
function makeTransport(send: Transport["send"], close: Transport["close"]): Transport {
  const t = {} as Transport;
  t.onData = noop;
  t.onPeer = noop;
  t.send = send;
  t.close = close;
  return t;
}

// ---------- Вкладки браузера (BroadcastChannel) ----------

type TabMsg =
  | { k: "ping" }
  | { k: "table"; room: string; name: string }
  | { k: "conn"; room: string; from: string }
  | { k: "accept"; room: string; to: string }
  | { k: "data"; room: string; from: string; to: string; d: string }
  | { k: "hb"; room: string; from: string }
  | { k: "bye"; room: string; from: string };

export class TabsDriver implements NetDriver {
  kind = "tabs" as const;
  label = "Тест во вкладках браузера (Bluetooth — в Android-приложении)";

  async host(tableName: string): Promise<Transport> {
    const ch = new BroadcastChannel("oligarh-net");
    const room = rid();
    const seen = new Map<string, number>();
    const t = makeTransport(
      (peer, d) => ch.postMessage({ k: "data", room, from: "host", to: peer, d } satisfies TabMsg),
      () => { clearInterval(timer); ch.postMessage({ k: "bye", room, from: "host" } satisfies TabMsg); ch.close(); },
    );
    ch.onmessage = (e: MessageEvent<TabMsg>) => {
      const m = e.data;
      if (m.k === "ping") ch.postMessage({ k: "table", room, name: tableName } satisfies TabMsg);
      else if (m.k === "conn" && m.room === room) {
        if (!seen.has(m.from)) { seen.set(m.from, Date.now()); ch.postMessage({ k: "accept", room, to: m.from } satisfies TabMsg); t.onPeer(m.from, true); }
      } else if (m.k === "hb" && m.room === room && seen.has(m.from)) seen.set(m.from, Date.now());
      else if (m.k === "bye" && m.room === room && seen.has(m.from)) { seen.delete(m.from); t.onPeer(m.from, false); }
      else if (m.k === "data" && m.room === room && m.to === "host" && seen.has(m.from)) { seen.set(m.from, Date.now()); t.onData(m.from, m.d); }
    };
    const timer = setInterval(() => { // гость пропал без «bye» (закрыл вкладку, уснул телефон)
      for (const [p, at] of seen) if (Date.now() - at > 7000) { seen.delete(p); t.onPeer(p, false); }
    }, 2000);
    return t;
  }

  async scan(onFound: (t: FoundTable) => void) {
    const ch = new BroadcastChannel("oligarh-net");
    ch.onmessage = (e: MessageEvent<TabMsg>) => { if (e.data.k === "table") onFound({ id: e.data.room, name: e.data.name }); };
    const ping = () => ch.postMessage({ k: "ping" } satisfies TabMsg);
    ping();
    const timer = setInterval(ping, 1500);
    return () => { clearInterval(timer); ch.close(); };
  }

  join(room: string): Promise<Transport> {
    const ch = new BroadcastChannel("oligarh-net");
    const me = rid();
    let lastHost = Date.now();
    return new Promise((resolve, reject) => {
      const t = makeTransport(
        (_peer, d) => ch.postMessage({ k: "data", room, from: me, to: "host", d } satisfies TabMsg),
        () => { clearInterval(hb); ch.postMessage({ k: "bye", room, from: me } satisfies TabMsg); ch.close(); },
      );
      const fail = setTimeout(() => reject(new Error("Стол не отвечает")), 5000);
      ch.onmessage = (e: MessageEvent<TabMsg>) => {
        const m = e.data;
        if (m.k === "accept" && m.room === room && m.to === me) { clearTimeout(fail); lastHost = Date.now(); resolve(t); t.onPeer("host", true); }
        else if (m.k === "data" && m.room === room && m.to === me) { lastHost = Date.now(); t.onData("host", m.d); }
        else if (m.k === "table" && m.room === room) lastHost = Date.now();
        else if (m.k === "bye" && m.room === room && m.from === "host") t.onPeer("host", false);
      };
      const hb = setInterval(() => {
        ch.postMessage({ k: "hb", room, from: me } satisfies TabMsg);
        ch.postMessage({ k: "ping" } satisfies TabMsg);
        if (Date.now() - lastHost > 8000) t.onPeer("host", false);
      }, 2000);
      ch.postMessage({ k: "conn", room, from: me } satisfies TabMsg);
      window.addEventListener("pagehide", () => t.close());
    });
  }
}

// ---------- Bluetooth (Android, плагин OligarhBluetooth на Kotlin) ----------

interface Listener { remove: () => Promise<void> }
interface BtPlugin {
  startServer(o: { name: string }): Promise<void>;
  scan(): Promise<void>;
  stopScan(): Promise<void>;
  connect(o: { address: string }): Promise<void>;
  send(o: { peer: string; data: string }): Promise<void>;
  stop(): Promise<void>;
  addListener(ev: "found", cb: (e: { address: string; name: string }) => void): Promise<Listener>;
  addListener(ev: "peer", cb: (e: { peer: string; up: boolean }) => void): Promise<Listener>;
  addListener(ev: "data", cb: (e: { peer: string; data: string }) => void): Promise<Listener>;
}

export function nativeBluetooth(): BtPlugin | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown>; isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return (cap.Plugins?.OligarhBluetooth as BtPlugin | undefined) ?? null;
}

export class BluetoothDriver implements NetDriver {
  kind = "bluetooth" as const;
  label = "Bluetooth";
  private listeners: Listener[] = [];
  constructor(private bt: BtPlugin) {}

  private async wire(): Promise<Transport> {
    const t = makeTransport(
      (peer, data) => { void this.bt.send({ peer, data }); },
      () => { void this.bt.stop(); for (const l of this.listeners) void l.remove(); this.listeners = []; },
    );
    this.listeners.push(await this.bt.addListener("peer", (e) => t.onPeer(e.peer, e.up)));
    this.listeners.push(await this.bt.addListener("data", (e) => t.onData(e.peer, e.data)));
    return t;
  }

  async host(tableName: string) {
    const t = await this.wire();
    await this.bt.startServer({ name: tableName });
    return t;
  }

  async scan(onFound: (t: FoundTable) => void) {
    const l = await this.bt.addListener("found", (e) => onFound({ id: e.address, name: e.name }));
    await this.bt.scan();
    return () => { void this.bt.stopScan(); void l.remove(); };
  }

  async join(address: string) {
    const t = await this.wire();
    await this.bt.connect({ address });
    return t;
  }
}

// ---------- Интернет (сервер комнат, см. server/relay.mjs) ----------

const CONFIG_URL = "https://pitbut.github.io/oligarh-config.json";
const DEFAULT_RELAY = "wss://oligarh.robutpit.com";
let relayUrl: Promise<string> | null = null;

/** Адрес сервера берём с сайта: его можно поменять без обновления приложения. */
export function relay(): Promise<string> {
  if (!relayUrl) relayUrl = (async () => {
    try { const o = localStorage.getItem("oligarh-relay"); if (o) return o; } catch { /* нет хранилища */ }
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(CONFIG_URL, { cache: "no-store", signal: ctl.signal });
      clearTimeout(t);
      const j = await r.json() as { relay?: string };
      if (j.relay) { try { localStorage.setItem("oligarh-relay-cache", j.relay); } catch { /* */ } return j.relay; }
    } catch { /* нет сети или сайта — берём сохранённый */ }
    try { const c = localStorage.getItem("oligarh-relay-cache"); if (c) return c; } catch { /* */ }
    return DEFAULT_RELAY;
  })();
  return relayUrl;
}

type RelayMsg =
  | { op: "hosted"; room: string; key: string; peers?: number[] }
  | { op: "joined"; room: string; name: string }
  | { op: "rooms"; rooms: { room: string; name: string; players: number; started: boolean }[] }
  | { op: "error"; text: string }
  | { op: "peer"; peer: number; up: boolean }
  | { op: "data"; peer?: number; d: string }
  | { op: "closed" }
  | { op: "pong" };

async function openSocket(): Promise<WebSocket> {
  const url = await relay();
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
    const t = setTimeout(() => { ws.close(); reject(new Error("Сервер не отвечает. Проверьте интернет.")); }, 8000);
    ws.onopen = () => { clearTimeout(t); resolve(ws); };
    ws.onerror = () => { clearTimeout(t); reject(new Error("Нет связи с сервером. Проверьте интернет.")); };
  });
}

const wsSend = (ws: WebSocket, m: object) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

/** Ждём первый ответ нужного вида (или ошибку). */
function reply<T extends RelayMsg["op"]>(ws: WebSocket, op: T): Promise<Extract<RelayMsg, { op: T }>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Сервер не отвечает")), 8000);
    const on = (e: MessageEvent) => {
      const m = JSON.parse(String(e.data)) as RelayMsg;
      if (m.op === op || m.op === "error") {
        clearTimeout(t);
        ws.removeEventListener("message", on);
        if (m.op === "error") reject(new Error(m.text)); else resolve(m as Extract<RelayMsg, { op: T }>);
      }
    };
    ws.addEventListener("message", on);
  });
}

/** Держим соединение живым (мобильные сети рвут молчащие сокеты) и замечаем обрыв. */
function keepAlive(ws: WebSocket, lost: () => void) {
  let last = Date.now();
  ws.addEventListener("message", () => { last = Date.now(); });
  const timer = setInterval(() => {
    wsSend(ws, { op: "ping" });
    if (Date.now() - last > 25000) ws.close();
  }, 8000);
  ws.addEventListener("close", () => { clearInterval(timer); lost(); });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Сколько пытаемся вернуться в комнату после обрыва (сервер ждёт хозяина 30 с). */
const RETRY_MS = 25000;

export class OnlineDriver implements NetDriver {
  kind = "online" as const;
  label = "Интернет";

  async host(tableName: string): Promise<Transport> {
    let ws = await openSocket();
    wsSend(ws, { op: "host", name: tableName });
    const { room, key } = await reply(ws, "hosted");
    const peers = new Set<string>();
    let closing = false, meta: [number, boolean] = [1, false];
    const t = makeTransport(
      (peer, d) => wsSend(ws, { op: "to", peer: Number(peer), d }),
      () => { closing = true; wsSend(ws, { op: "bye" }); ws.close(); },
    );
    t.code = room;
    t.meta = (players, started) => { meta = [players, started]; wsSend(ws, { op: "meta", players, started }); };
    const wire = (sock: WebSocket) => {
      sock.addEventListener("message", (e) => {
        const m = JSON.parse(String(e.data)) as RelayMsg;
        if (m.op === "peer") { const p = String(m.peer); if (m.up) peers.add(p); else peers.delete(p); t.onPeer(p, m.up); }
        else if (m.op === "data" && m.peer !== undefined) t.onData(String(m.peer), m.d);
      });
      keepAlive(sock, () => { if (!closing && sock === ws) void resume(); });
    };
    // Обрыв у хозяина: возвращаемся в ту же комнату, гости ничего не заметят.
    const resume = async () => {
      const until = Date.now() + RETRY_MS;
      while (!closing && Date.now() < until) {
        try {
          const sock = await openSocket();
          wsSend(sock, { op: "rehost", room, key });
          const r = await reply(sock, "hosted");
          ws = sock;
          wire(sock);
          wsSend(sock, { op: "meta", players: meta[0], started: meta[1] });
          const now = new Set((r.peers ?? []).map(String));
          for (const p of [...peers]) if (!now.has(p)) { peers.delete(p); t.onPeer(p, false); }
          for (const p of now) if (!peers.has(p)) { peers.add(p); t.onPeer(p, true); }
          return;
        } catch (e) {
          if (e instanceof Error && e.message === "Комната уже закрыта") break;
          await sleep(2000);
        }
      }
      // Не вернулись: для гостей хозяин ушёл (у них сработает передача стола).
      for (const p of [...peers]) { peers.delete(p); t.onPeer(p, false); }
    };
    wire(ws);
    return t;
  }

  async scan(onFound: (t: FoundTable) => void) {
    let stopped = false;
    const ws = await openSocket();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(String(e.data)) as RelayMsg;
      if (m.op === "rooms") for (const r of m.rooms) onFound({ id: r.room, name: r.name, players: r.players });
    });
    const poll = () => wsSend(ws, { op: "list" });
    poll();
    const timer = setInterval(poll, 2000);
    return () => { if (stopped) return; stopped = true; clearInterval(timer); ws.close(); };
  }

  async join(room: string): Promise<Transport> {
    let ws = await openSocket();
    wsSend(ws, { op: "join", room });
    await reply(ws, "joined");
    let closing = false, gone = false;
    const hostGone = () => { if (!gone && !closing) { gone = true; t.onPeer("host", false); } };
    const t = makeTransport(
      (_peer, d) => wsSend(ws, { op: "to", d }),
      () => { closing = true; wsSend(ws, { op: "bye" }); ws.close(); },
    );
    t.code = room;
    const wire = (sock: WebSocket) => {
      sock.addEventListener("message", (e) => {
        const m = JSON.parse(String(e.data)) as RelayMsg;
        if (m.op === "data") t.onData("host", m.d);
        else if (m.op === "closed") { gone = true; closing = true; t.onPeer("host", false); }
      });
      keepAlive(sock, () => { if (!closing && sock === ws) void resume(); });
    };
    // Обрыв у гостя: входим в комнату заново, хозяин узнает нас по имени.
    const resume = async () => {
      const until = Date.now() + RETRY_MS;
      let reached = false;
      while (!closing && Date.now() < until) {
        let sock: WebSocket;
        try { sock = await openSocket(); } catch { await sleep(2000); continue; }
        reached = true;
        try {
          wsSend(sock, { op: "join", room });
          await reply(sock, "joined");
        } catch { sock.close(); hostGone(); return; } // комнаты нет — хозяин действительно ушёл
        ws = sock;
        wire(sock);
        t.onResume?.();
        return;
      }
      if (closing) return;
      if (!reached && t.onFail) { closing = true; t.onFail("Пропал интернет. Когда связь вернётся, войдите в комнату " + room + " снова — вас вернут на ваше место."); }
      else hostGone();
    };
    wire(ws);
    setTimeout(() => t.onPeer("host", true), 0);
    return t;
  }
}

let driver: NetDriver | null = null;
let online: OnlineDriver | null = null;
/** Ближняя связь: Bluetooth в Android, вкладки — в браузере. */
export function localDriver(): NetDriver {
  if (!driver) { const bt = nativeBluetooth(); driver = bt ? new BluetoothDriver(bt) : new TabsDriver(); }
  return driver;
}
export function onlineDriver(): OnlineDriver { return online ??= new OnlineDriver(); }

let current: NetDriver | null = null;
/** Связь, которой идёт текущая партия (нужна при передаче стола другому игроку). */
export function pickDriver(): NetDriver { return current ?? localDriver(); }
export function useDriver(d: NetDriver) { current = d; }
