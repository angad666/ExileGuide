'use strict';
// Tails Path of Exile's Client.txt and emits events:
//   'area'  {id, level, name?}   from: Generating level 2 area "1_1_2" with seed 123
//   'enter' {name}               from: : You have entered The Coast.
//   'level' {name, cls, level}   from: : Alohaa (Duelist) is now level 2
const fs = require('fs');
const { EventEmitter } = require('events');

const RE_AREA = /Generating level (\d+) area "([^"]+)"/;
const RE_ENTER = /\] : You have entered (.+?)\.\s*$/;
const RE_LEVEL = /\] : (.+?) \((\w+)\) is now level (\d+)/;

function parseLine(line) {
  let m;
  if ((m = RE_AREA.exec(line))) return { type: 'area', id: m[2], level: +m[1] };
  if ((m = RE_LEVEL.exec(line))) return { type: 'level', name: m[1], cls: m[2], level: +m[3] };
  if ((m = RE_ENTER.exec(line))) return { type: 'enter', name: m[1] };
  return null;
}

class LogWatcher extends EventEmitter {
  constructor(file, { interval = 250 } = {}) {
    super();
    this.file = file;
    this.interval = interval;
    this.pos = 0;
    this.timer = null;
    this.partial = '';
    this.ok = false;
  }

  /** Scan the tail of the log for the latest area / level, without moving the route. */
  scanRecent(bytes = 512 * 1024) {
    const result = { area: null, level: null };
    try {
      const st = fs.statSync(this.file);
      const start = Math.max(0, st.size - bytes);
      const fd = fs.openSync(this.file, 'r');
      const buf = Buffer.alloc(st.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      for (const line of buf.toString('utf8').split(/\r?\n/)) {
        const e = parseLine(line);
        if (!e) continue;
        if (e.type === 'area') result.area = e;
        if (e.type === 'level') result.level = e;
      }
    } catch { /* ignore */ }
    return result;
  }

  start() {
    this.stop();
    try {
      this.pos = fs.statSync(this.file).size;
      this.ok = true;
    } catch (err) {
      this.ok = false;
      this.emit('status', { ok: false, error: `Client.txt not found: ${this.file}` });
    }
    this.emit('status', { ok: this.ok, file: this.file });
    this.timer = setInterval(() => this.poll(), this.interval);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  poll() {
    let st;
    try { st = fs.statSync(this.file); } catch {
      if (this.ok) { this.ok = false; this.emit('status', { ok: false, error: `Client.txt not found: ${this.file}` }); }
      return;
    }
    if (!this.ok) { this.ok = true; this.pos = st.size; this.emit('status', { ok: true, file: this.file }); }
    if (st.size < this.pos) this.pos = 0; // log was truncated/deleted
    if (st.size === this.pos) return;
    const len = Math.min(st.size - this.pos, 4 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    let fd;
    try {
      fd = fs.openSync(this.file, 'r');
      fs.readSync(fd, buf, 0, len, this.pos);
    } catch { return; } finally { if (fd !== undefined) fs.closeSync(fd); }
    this.pos += len;
    const text = this.partial + buf.toString('utf8');
    const lines = text.split(/\r?\n/);
    this.partial = lines.pop();
    for (const line of lines) {
      const e = parseLine(line);
      if (e) this.emit(e.type, e);
    }
  }
}

module.exports = { LogWatcher, parseLine };
