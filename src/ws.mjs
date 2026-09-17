/**
 * 极简 WebSocket 客户端（RFC 6455），仅在 Node < 22（无全局 WebSocket）时启用。
 * 只实现 md2pdf 需要的部分：ws:// 明文连接、文本帧收发、分片合并、ping/pong、关闭。
 */

import net from 'node:net';
import crypto from 'node:crypto';

const CRLF2 = '\r\n\r\n';

export class MiniWebSocket {
  constructor(url) {
    const u = new URL(url);
    this.url = url;
    this.readyState = 0; // CONNECTING
    this._listeners = new Map();
    this._buf = Buffer.alloc(0);
    this._frags = [];
    this._fragOpcode = 0;
    this._handshakeDone = false;

    this.socket = net.connect({ host: u.hostname, port: Number(u.port) || 80 });
    this.socket.setNoDelay(true);

    this.socket.on('connect', () => {
      const key = crypto.randomBytes(16).toString('base64');
      this.socket.write(
        `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
        `Host: ${u.host}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n\r\n`
      );
    });

    this.socket.on('data', d => {
      this._buf = Buffer.concat([this._buf, d]);
      try { this._drain(); } catch (e) { this._emit('error', e); }
    });
    this.socket.on('error', e => this._emit('error', e));
    this.socket.on('close', () => { this.readyState = 3; this._emit('close', {}); });
  }

  /* --- 事件（同时支持 on* 与 addEventListener） --- */
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    if (this._listeners.has(type)) this._listeners.get(type).delete(fn);
  }
  _emit(type, ev) {
    const handler = this['on' + type];
    if (typeof handler === 'function') handler.call(this, ev);
    const set = this._listeners.get(type);
    if (set) for (const fn of [...set]) fn.call(this, ev);
  }

  /* --- 收发 --- */
  send(data) {
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x81; // FIN + text frame

    const mask = crypto.randomBytes(4);
    header[1] |= 0x80; // MASK
    const masked = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];

    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  close() {
    if (this.readyState === 3) return;
    try { this.socket.write(Buffer.from([0x88, 0x00])); } catch {}
    try { this.socket.end(); } catch {}
  }

  /* --- 解析 --- */
  _drain() {
    if (!this._handshakeDone) {
      const idx = this._buf.indexOf(CRLF2);
      if (idx === -1) return;
      const head = this._buf.subarray(0, idx).toString('latin1');
      this._buf = this._buf.subarray(idx + 4);
      if (!/^HTTP\/1\.1\s+101\b/.test(head)) {
        throw new Error('WebSocket 握手失败：' + head.split('\r\n')[0]);
      }
      this._handshakeDone = true;
      this.readyState = 1; // OPEN
      this._emit('open', {});
    }

    for (;;) {
      const buf = this._buf;
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2)); off = 10;
      }
      if (buf.length < off + len) return;
      const payload = buf.subarray(off, off + len);
      this._buf = buf.subarray(off + len);

      if (opcode === 0x8) { this.close(); return; }
      if (opcode === 0x9) { // ping → pong
        const pong = Buffer.concat([Buffer.from([0x8a, payload.length]), payload]);
        try { this.socket.write(pong); } catch {}
        continue;
      }
      if (opcode === 0xa) continue; // pong，忽略

      if (opcode === 0x0) this._frags.push(payload);
      else { this._frags = [payload]; this._fragOpcode = opcode; }

      if (fin) {
        const all = Buffer.concat(this._frags);
        this._frags = [];
        const data = this._fragOpcode === 0x2 ? all : all.toString('utf8');
        this._emit('message', { data });
      }
    }
  }
}
