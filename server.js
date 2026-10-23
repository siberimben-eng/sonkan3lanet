// Crimson Circuit — bağımlılıksız oda sunucusu (Node 18+). index.html'i de sunar.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000, MAXP = 16, MAXMSG = 64 * 1024, MAXPRES = 8192;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const rooms = new Map(), clients = new Set();

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/health') { res.writeHead(200); return res.end('ok'); }
  if (url === '/' || url === '/index.html') {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(html);
    } catch (e) { res.writeHead(500); return res.end('index.html bulunamadı'); }
  }
  res.writeHead(404); res.end('not found');
});

function frame(payload, op) {
  const len = payload.length; let h;
  if (len < 126) h = Buffer.from([128 | op, len]);
  else if (len < 65536) { h = Buffer.alloc(4); h[0] = 128 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
  else { h = Buffer.alloc(10); h[0] = 128 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([h, payload]);
}
class Client {
  constructor(sock) {
    this.sock = sock; this.buf = Buffer.alloc(0); this.alive = true; this.room = null; this.id = null; this.p = {}; this.frag = [];
    this.win = Date.now(); this.count = 0;
    sock.on('data', d => { this.buf = Buffer.concat([this.buf, d]); if (this.buf.length > MAXMSG * 2) return sock.destroy(); this.parse(); });
    sock.on('close', () => this.leave()); sock.on('error', () => sock.destroy());
    clients.add(this);
  }
  parse() {
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const fin = !!(b[0] & 128), op = b[0] & 15, masked = !!(b[1] & 128); let len = b[1] & 127, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > MAXMSG) return this.sock.destroy();
      const need = off + (masked ? 4 : 0) + len; if (b.length < need) return;
      let payload = Buffer.from(b.subarray(off + (masked ? 4 : 0), need));
      if (masked) { const m = b.subarray(off, off + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
      this.buf = b.subarray(need);
      if (op === 8) { this.sock.end(); return; }
      if (op === 9) { this.raw(frame(payload, 10)); continue; }
      if (op === 10) { this.alive = true; continue; }
      if (op === 1 || op === 0) {
        if (op === 1) this.frag = [payload]; else this.frag.push(payload);
        if (fin) { const s = Buffer.concat(this.frag).toString('utf8'); this.frag = []; this.msg(s); }
      }
    }
  }
  raw(buf) { if (this.sock.destroyed || this.sock.writableLength > 512 * 1024) return; this.sock.write(buf); }
  json(o) { this.raw(frame(Buffer.from(JSON.stringify(o)), 1)); }
  msg(s) {
    const now = Date.now(); if (now - this.win > 1000) { this.win = now; this.count = 0; } if (++this.count > 200) return;
    let m; try { m = JSON.parse(s); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join') {
      if (this.room) return;
      const name = String(m.room || '').toLowerCase();
      if (!/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(name)) return this.json({ t: 'err', code: 'invalid_argument', message: 'oda adı geçersiz' });
      let r = rooms.get(name); if (!r) { r = new Map(); rooms.set(name, r); }
      if (r.size >= MAXP) return this.json({ t: 'err', code: 'limit_reached', message: 'oda dolu (en fazla ' + MAXP + ' oyuncu)' });
      this.id = 'p' + crypto.randomBytes(5).toString('hex'); this.room = name;
      const list = [...r.values()].map(x => ({ peer: x.id, p: x.p }));
      r.set(this.id, this); this.json({ t: 'welcome', peer: this.id, peers: list });
      bcast(r, this, { t: 'j', peer: this.id });
    } else if (m.t === 'pres' && this.room) {
      const p = m.p; if (!p || typeof p !== 'object') return;
      const np = Object.assign({}, this.p);
      for (const k of Object.keys(p)) { if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue; if (p[k] === null) delete np[k]; else np[k] = p[k]; }
      if (JSON.stringify(np).length > MAXPRES) return;
      this.p = np; bcast(rooms.get(this.room), this, { t: 'u', peer: this.id, p });
    }
  }
  leave() {
    clients.delete(this); if (!this.room) return;
    const r = rooms.get(this.room); this.room = null; if (!r) return;
    r.delete(this.id); bcast(r, this, { t: 'l', peer: this.id }); if (!r.size) rooms.delete([...rooms].find(([, v]) => v === r)?.[0]);
  }
}
function bcast(r, from, obj) { if (!r) return; const f = frame(Buffer.from(JSON.stringify(obj)), 1); for (const c of r.values()) if (c !== from) c.raw(f); }

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') return socket.destroy();
  const acc = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  socket.setNoDelay(true); new Client(socket);
});
setInterval(() => { for (const c of clients) { if (!c.alive) { c.sock.destroy(); continue; } c.alive = false; c.raw(frame(Buffer.alloc(0), 9)); } }, 20000);
server.listen(PORT, () => console.log('Crimson Circuit sunucusu: http://localhost:' + PORT));
