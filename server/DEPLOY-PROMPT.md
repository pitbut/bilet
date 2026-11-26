# Промпт для чата с доступом к VPS: сервер комнат «Олигарха»

Скопируйте всё, что ниже линии, в чат, который работает с вашим VPS (тот же, где ставили «Клуб знатоков»).

---

На этом VPS уже работает мой сайт и сервер игры «Клуб знатоков» (`game.robutpit.com`). Нужно добавить **маленький отдельный сервис** для моей настольной игры «Олигарх»: сервер комнат на WebSocket. Он ничего не хранит, без базы данных, только пересылает сообщения между телефонами. Домен: `oligarh.robutpit.com`.

## 0. Правила (строго)
- ❌ Не трогать существующий сайт, «Клуб знатоков», их файлы, конфиги nginx, контейнеры, сертификаты и `server_name`.
- ❌ nginx — только `nginx -t` и затем `systemctl reload nginx`. Никогда `restart`/`stop`.
- ❌ Ничего не удалять, что создал не ты. Не обновлять системные пакеты массово (`apt upgrade` — нельзя).
- ✅ Перед изменением nginx: `cp -a /etc/nginx /root/backup-nginx-$(date +%F-%H%M)`.
- ✅ Всё своё — в `/opt/oligarh`, отдельный пользователь `oligarh`, отдельный systemd-сервис, отдельный файл nginx.
- Если что-то пошло не так — откатить из бэкапа, `nginx -t`, `reload`, и сообщить мне.

## 1. Разведка (ничего не меняя)
- `ss -tulpn` — убедись, что порт **8790** свободен (если занят — возьми другой свободный и поменяй его везде ниже).
- `node -v` — нужен Node 18+. Если Node нет или старый — поставь Node 20 LTS так, чтобы не сломать то, что уже работает на Node (если «Клуб знатоков» в Docker — можно ставить системный Node из NodeSource; если он использует системный Node — спроси меня).
- `nginx -T | grep server_name` — убедись, что `oligarh.robutpit.com` ещё нигде не используется.

## 2. DNS
Мне нужно добавить A-запись `oligarh.robutpit.com` → IP этого VPS (так же, как делали `game.robutpit.com`). Скажи точный IP и дождись, пока `dig +short oligarh.robutpit.com` покажет его.

## 3. Установка
```bash
useradd --system --home /opt/oligarh --shell /usr/sbin/nologin oligarh || true
mkdir -p /opt/oligarh && cd /opt/oligarh
# создай /opt/oligarh/relay.mjs с содержимым из раздела «Код» ниже
cat > package.json <<'JSON'
{ "name": "oligarh-rooms", "private": true, "type": "module", "dependencies": { "ws": "^8.18.0" } }
JSON
npm install --omit=dev
chown -R oligarh:oligarh /opt/oligarh
```

systemd-юнит `/etc/systemd/system/oligarh-rooms.service` (если `node` не в `/usr/bin/node` — поправь путь по `which node`):
```ini
[Unit]
Description=Олигарх — сервер комнат (WebSocket)
After=network.target

[Service]
User=oligarh
WorkingDirectory=/opt/oligarh
Environment=PORT=8790 HOST=127.0.0.1
ExecStart=/usr/bin/node /opt/oligarh/relay.mjs
Restart=always
RestartSec=3
MemoryMax=256M
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```
```bash
systemctl daemon-reload && systemctl enable --now oligarh-rooms
curl -s http://127.0.0.1:8790/healthz   # → {"ok":true,...}
```

## 4. nginx (отдельный файл) и SSL
`/etc/nginx/sites-available/oligarh.conf` + симлинк в `sites-enabled` (или `conf.d/oligarh.conf`, смотря как устроен этот сервер):
```nginx
# /etc/nginx/sites-available/oligarh.conf — отдельный файл, существующие не трогаем.
map $http_upgrade $oligarh_conn { default upgrade; "" close; }

server {
    listen 80;
    listen [::]:80;
    server_name oligarh.robutpit.com;

    location / {
        proxy_pass http://127.0.0.1:8790;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $oligarh_conn;
        proxy_set_header Host $host;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
# HTTPS добавит certbot --nginx -d oligarh.robutpit.com (только для этого домена).
```
Затем `nginx -t` → `systemctl reload nginx` → SSL тем же инструментом, что и у остальных доменов, **только для нового домена**: `certbot --nginx -d oligarh.robutpit.com`. Если `map $http_upgrade ...` с таким именем уже есть — переименуй переменную.

## 5. Проверка
- `curl -s https://oligarh.robutpit.com/healthz` → `{"ok":true,...}`
- WebSocket: `cd /opt/oligarh && node -e "const W=require('ws');const w=new W('wss://oligarh.robutpit.com');w.on('open',()=>w.send(JSON.stringify({op:'host',name:'test'})));w.on('message',m=>{console.log(String(m));process.exit(0)})"` → `{"op":"hosted","room":"1234",...}`
- Сайт и «Клуб знатоков» открываются как раньше (`curl -I https://game.robutpit.com/healthz` и главная сайта).

## 6. Отчёт
Что сделано, какие файлы созданы/изменены вне `/opt/oligarh` (с путями бэкапов), как откатить (скрипт `/opt/oligarh/uninstall.sh`, удаляющий только созданное тобой: сервис, файл nginx, симлинк, сертификат `oligarh.robutpit.com`, папку `/opt/oligarh`), как смотреть логи (`journalctl -u oligarh-rooms -f`) и сколько памяти занимает сервис.

## Код: /opt/oligarh/relay.mjs
```js
// Сервер комнат «Олигарха». Игру ведёт телефон хозяина стола (как и по Bluetooth),
// сервер только пересылает сообщения между ним и гостями. Ничего не хранит на диске.
//
// Протокол (JSON по WebSocket):
//   клиент → сервер: {op:"host", name}            создать комнату → {op:"hosted", room, key}
//                    {op:"rehost", room, key}     хозяин вернулся после обрыва → {op:"hosted", room, key, peers}
//                    {op:"list"}                  → {op:"rooms", rooms:[{room,name,players,started}]}
//                    {op:"join", room}            → {op:"joined", room, name} | {op:"error", text}
//                    {op:"meta", players, started} (хозяин) — обновить описание комнаты
//                    {op:"to", peer, d}           (хозяин) — сообщение гостю
//                    {op:"to", d}                 (гость)  — сообщение хозяину
//   сервер → хозяин: {op:"peer", peer, up}        гость вошёл / вышел
//                    {op:"data", peer, d}
//   сервер → гость:  {op:"data", d}
//                    {op:"closed"}                хозяин ушёл (стол закрыт)
// Если хозяин пропал, комната ждёт его GRACE мс (мобильный интернет рвётся) и только потом закрывается.
import { WebSocketServer } from "ws";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 8790);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_ROOMS = 2000, MAX_GUESTS = 7, MAX_MSG = 512 * 1024, GRACE = Number(process.env.GRACE || 30000);

/** @type {Map<string, {room:string, key:string, name:string, host:any, guests:Map<number, any>, next:number, players:number, started:boolean, timer:any}>} */
const rooms = new Map();

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

function newCode() {
  for (let i = 0; i < 100; i++) {
    const c = String(1000 + Math.floor(Math.random() * 9000));
    if (!rooms.has(c)) return c;
  }
  return null;
}

function leave(ws) {
  const r = ws.room && rooms.get(ws.room);
  if (!r) return;
  if (ws.isHost) {
    if (r.host !== ws) { ws.room = null; return; }
    r.host = null;
    const close = () => {
      if (rooms.get(r.room) !== r || r.host) return;
      rooms.delete(r.room);
      for (const g of r.guests.values()) { send(g, { op: "closed" }); g.room = null; }
    };
    if (ws.bye) close(); else r.timer = setTimeout(close, GRACE);
  } else if (r.guests.get(ws.peer) === ws) {
    r.guests.delete(ws.peer);
    if (r.host) send(r.host, { op: "peer", peer: ws.peer, up: false });
  }
  ws.room = null;
}

// Обычный HTTP: /healthz для проверки, всё остальное — WebSocket.
const http = createServer((req, res) => {
  if (req.url === "/healthz" || req.url === "/oligarh/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: wss.clients.size }));
  } else { res.writeHead(426, { "content-type": "text/plain; charset=utf-8" }); res.end("Олигарх: здесь только WebSocket"); }
});
const wss = new WebSocketServer({ server: http, maxPayload: MAX_MSG });
http.listen(PORT, HOST);

const debug = process.env.DEBUG ? (...a) => console.log(new Date().toISOString(), ...a) : () => {};

wss.on("connection", (ws) => {
  debug("connect", wss.clients.size);
  ws.alive = true;
  ws.on("pong", () => { ws.alive = true; });
  ws.on("close", () => { debug("close", ws.room, ws.isHost ? "host" : "guest"); leave(ws); });
  ws.on("error", () => leave(ws));
  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (!m || typeof m.op !== "string") return;
    const r = ws.room ? rooms.get(ws.room) : null;
    switch (m.op) {
      case "host": {
        leave(ws);
        const code = rooms.size < MAX_ROOMS ? newCode() : null;
        if (!code) return send(ws, { op: "error", text: "Сервер переполнен, попробуйте позже" });
        const name = String(m.name ?? "Стол").slice(0, 40);
        const key = randomBytes(12).toString("hex");
        rooms.set(code, { room: code, key, name, host: ws, guests: new Map(), next: 1, players: 1, started: false, timer: null });
        ws.room = code; ws.isHost = true;
        return send(ws, { op: "hosted", room: code, key });
      }
      case "rehost": {
        const t = rooms.get(String(m.room ?? ""));
        if (!t || t.key !== m.key) return send(ws, { op: "error", text: "Комната уже закрыта" });
        if (t.host && t.host !== ws) { t.host.room = null; t.host.terminate(); }
        clearTimeout(t.timer);
        debug("rehost", t.room);
        t.host = ws; ws.room = t.room; ws.isHost = true;
        return send(ws, { op: "hosted", room: t.room, key: t.key, peers: [...t.guests.keys()] });
      }
      case "bye":
        ws.bye = true;
        leave(ws);
        return;
      case "list":
        return send(ws, { op: "rooms", rooms: [...rooms.values()].filter((x) => !x.started && x.host).slice(0, 50).map((x) => ({ room: x.room, name: x.name, players: x.players, started: x.started })) });
      case "join": {
        leave(ws);
        const t = rooms.get(String(m.room ?? "").trim());
        if (!t) return send(ws, { op: "error", text: "Комната не найдена — проверьте код" });
        if (t.guests.size >= MAX_GUESTS) return send(ws, { op: "error", text: "Стол заполнен" });
        const peer = t.next++;
        t.guests.set(peer, ws);
        ws.room = t.room; ws.isHost = false; ws.peer = peer;
        send(ws, { op: "joined", room: t.room, name: t.name });
        if (t.host) send(t.host, { op: "peer", peer, up: true });
        return;
      }
      case "meta":
        if (r && ws.isHost) { r.players = Number(m.players) || r.players; r.started = !!m.started; }
        return;
      case "to":
        if (!r) return;
        if (ws.isHost) { const g = r.guests.get(Number(m.peer)); if (g) send(g, { op: "data", d: m.d }); }
        else if (r.host) send(r.host, { op: "data", peer: ws.peer, d: m.d });
        return;
      case "ping":
        return send(ws, { op: "pong" });
    }
  });
});

// Обрывы связи без закрытия сокета (телефон ушёл в метро) — проверяем раз в 20 с.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 20000);

console.log(`Олигарх: сервер комнат на ws://${HOST}:${PORT}`);
```
