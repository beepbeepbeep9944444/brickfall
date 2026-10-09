// Minimal WebSocket server (RFC 6455) on top of node:http, so the project stays dependency-free.
// Text messages only (we send JSON), fragmented messages are reassembled, pings keep idle
// connections alive, and oversized messages or slow readers are disconnected.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 16 * 1024;
const MAX_BUFFERED = 1024 * 1024; // a client this far behind is dropped
const PING_MS = 20000;

export class WsConnection extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.open = true;
    this.buf = Buffer.alloc(0);
    this.parts = [];
    this.alive = true;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
    this.pinger = setInterval(() => {
      if (!this.alive) { this.terminate(); return; }
      this.alive = false;
      this.frame(0x9, Buffer.alloc(0));
    }, PING_MS);
  }

  /** Send a string (or anything JSON-serialisable). */
  send(data) {
    if (!this.open) return;
    if (this.socket.writableLength > MAX_BUFFERED) { this.terminate(); return; }
    this.frame(0x1, Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)));
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    const r = Buffer.from(reason).subarray(0, 120), body = Buffer.alloc(2 + r.length);
    body.writeUInt16BE(code, 0);
    r.copy(body, 2);
    this.frame(0x8, body);
    this.socket.end();
    this.finish(code);
  }

  terminate() {
    this.socket.destroy();
    this.finish(1006);
  }

  finish(code = 1006) {
    if (!this.open) return;
    this.open = false;
    clearInterval(this.pinger);
    this.emit('close', code);
  }

  frame(opcode, payload) {
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    head[0] = 0x80 | opcode;
    this.socket.write(Buffer.concat([head, payload]));
  }

  onData(chunk) {
    this.alive = true;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, opcode = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; const big = b.readBigUInt64BE(2); if (big > BigInt(MAX_MESSAGE)) { this.close(1009, 'too big'); return; } len = Number(big); off = 10; }
      if (!masked) { this.close(1002, 'unmasked frame'); return; } // clients must mask
      if (len > MAX_MESSAGE) { this.close(1009, 'too big'); return; }
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4), payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);

      if (opcode === 0x8) { this.close(1000); return; }
      if (opcode === 0x9) { this.frame(0xA, payload); continue; }
      if (opcode === 0xA) continue;
      if (opcode !== 0x0 && opcode !== 0x1 && opcode !== 0x2) { this.close(1002, 'bad opcode'); return; }
      this.parts.push(payload);
      if (this.parts.reduce((n, p) => n + p.length, 0) > MAX_MESSAGE) { this.close(1009, 'too big'); return; }
      if (fin) {
        const text = Buffer.concat(this.parts).toString('utf8');
        this.parts = [];
        this.emit('message', text);
      }
      if (!this.open) return;
    }
  }
}

/**
 * Accept a WebSocket upgrade. Returns the connection, or null after rejecting the request
 * (bad handshake). `allow(req)` decides whether the request may connect (origin checks etc.).
 */
export function acceptUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (req.method !== 'GET' || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  return new WsConnection(socket, req);
}

/** Refuse an upgrade with a plain HTTP status. */
export function rejectUpgrade(socket, status, text) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
