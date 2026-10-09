// Транспорт между телефонами. Bluetooth — в Android-приложении (нативный плагин),
// «вкладки» — для проверки в браузере: каждая вкладка играет роль отдельного телефона.

export interface Transport {
  /** Отправить одному участнику (хозяин → гость; гость шлёт всегда хозяину: peer = "host"). */
  send(peer: string, data: string): void;
  onData: (peer: string, data: string) => void;
  /** Подключился / отключился участник (у гостя peer = "host"). */
  onPeer: (peer: string, up: boolean) => void;
  close(): void;
}

export interface FoundTable { id: string; name: string }

export interface NetDriver {
  kind: "bluetooth" | "tabs";
  label: string;
  host(tableName: string): Promise<Transport>;
  /** Поиск столов; возвращает функцию остановки поиска. */
  scan(onFound: (t: FoundTable) => void): Promise<() => void>;
  join(id: string): Promise<Transport>;
}

const rid = () => Math.random().toString(36).slice(2, 10);
const noop = () => {};

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
    const t: Transport = {
      onData: noop, onPeer: noop,
      send: (peer, d) => ch.postMessage({ k: "data", room, from: "host", to: peer, d } satisfies TabMsg),
      close: () => { clearInterval(timer); ch.postMessage({ k: "bye", room, from: "host" } satisfies TabMsg); ch.close(); },
    };
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
      const t: Transport = {
        onData: noop, onPeer: noop,
        send: (_peer, d) => ch.postMessage({ k: "data", room, from: me, to: "host", d } satisfies TabMsg),
        close: () => { clearInterval(hb); ch.postMessage({ k: "bye", room, from: me } satisfies TabMsg); ch.close(); },
      };
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
    const t: Transport = {
      onData: noop, onPeer: noop,
      send: (peer, data) => { void this.bt.send({ peer, data }); },
      close: () => { void this.bt.stop(); for (const l of this.listeners) void l.remove(); this.listeners = []; },
    };
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

export function pickDriver(): NetDriver {
  const bt = nativeBluetooth();
  return bt ? new BluetoothDriver(bt) : new TabsDriver();
}
