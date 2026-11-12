'use strict';
// Run timer with act splits. Pure logic: every method takes `now` (epoch ms), so it can be tested
// without waiting. Real time is wall-clock, so the timer keeps running if the overlay is restarted.
//
// Starts:  entering The Twilight Strand (1_1_1) on a new run, or the pause hotkey while idle.
// Splits:  Brutus (F2 on the Brutus step, or entering Prisoner's Gate), then each act when you
//          enter the next act's first zone. Act 10 ends on F2 at the Kitava step, or when you go from
//          The Feeding Trough to Oriath Docks (or reach Karui Shores).
// Pauses:  the pause hotkey (resumes on the next zone change or the hotkey), and, if enabled,
//          labyrinth time, because the goal times don't include labs, and closing the game (gameClosed:
//          the pause is backdated to when the game was last seen; it resumes on the next zone change).
const { Areas } = require('./data');

const isLab = (id) => /Labyrinth/i.test(id || '');
const ABANDON_MS = 10 * 60 * 1000; // a Strand visit this long after the start, still at the route start, is a new run

/** Split definitions for a parsed route. */
function splitDefs(route) {
  const defs = [];
  const killStep = (re) => route.steps.find((s) => s.tokens.some((t) => t.k === 'kill' && re.test(t.v)));
  const brutus = killStep(/^Brutus, Lord Incarcerator/);
  defs.push({ key: 'brutus', name: 'Brutus', act: 1, bossStep: brutus ? brutus.index : null, areas: ['1_1_8'] });
  // Acts 1-9 end when you enter the next act (some acts continue after their boss, e.g. the
  // Resonator after Malachai), so only the final Kitava kill is split from the route step.
  for (let n = 1; n <= 9; n++) defs.push({ key: `a${n}`, name: `A${n}`, act: n, bossStep: null });
  const kitava = route.steps.filter((s) => s.act === 10 && s.tokens.some((t) => t.k === 'kill' && /^Kitava/.test(t.v))).pop();
  defs.push({ key: 'a10', name: 'A10', act: 10, final: true, bossStep: kitava ? kitava.index : null, bossArea: kitava ? kitava.areaId : '2_10_6' });
  return defs;
}

const emptyRun = () => ({ startedAt: null, pausedAt: null, pauseReason: null, pausedMs: 0, finishedAt: null, splits: {}, char: '' });

class RunTimer {
  constructor(route, saved = {}, opts = {}) {
    this.defs = splitDefs(route);
    this.run = { ...emptyRun(), ...(saved.run || {}) };
    this.history = Array.isArray(saved.history) ? saved.history : [];
    this.opts = { pauseInLab: true, ...opts };
  }

  get started() { return this.run.startedAt !== null; }
  get finished() { return this.run.finishedAt !== null; }
  get paused() { return this.run.pausedAt !== null; }

  elapsed(now) {
    const r = this.run;
    if (r.startedAt === null) return 0;
    const end = r.finishedAt ?? r.pausedAt ?? now;
    return Math.max(0, end - r.startedAt - r.pausedMs);
  }

  /** The next split that hasn't fired yet. */
  current() { return this.defs.find((d) => this.run.splits[d.key] === undefined) || null; }

  start(now, char = '') {
    this.archive();
    this.run = { ...emptyRun(), startedAt: now, char, lastActive: now };
  }

  /** Move the current run into history (if it got anywhere) and clear it. */
  archive() {
    const r = this.run;
    if (r.startedAt !== null && (Object.keys(r.splits).length || r.finishedAt !== null)) {
      this.history.unshift({
        startedAt: r.startedAt, char: r.char, splits: { ...r.splits },
        final: r.finishedAt !== null ? r.splits.a10 ?? null : null,
      });
      this.history = this.history.slice(0, 50);
    }
    this.run = emptyRun();
  }

  reset() { this.archive(); }

  pause(now, reason = 'manual') {
    if (!this.started || this.finished || this.paused) return;
    this.run.pausedAt = now; this.run.pauseReason = reason;
  }

  resume(now) {
    if (!this.paused) return;
    this.run.pausedMs += now - this.run.pausedAt;
    this.run.pausedAt = null; this.run.pauseReason = null;
    this.run.lastActive = now;
  }

  /**
   * The game was closed. Pause as of `at` (when the game was last seen running), but never before the
   * last thing the timer saw (zone change, split, resume) and never in the future. Returns true if it paused.
   */
  gameClosed(at, now) {
    if (!this.started || this.finished || this.paused) return false;
    const floor = this.run.lastActive ?? this.run.startedAt;
    this.pause(Math.round(Math.min(now, Math.max(floor, at ?? floor))), 'closed');
    return true;
  }

  /** Pause hotkey: idle -> start, running -> pause, paused -> resume, finished -> undo the finish. */
  toggle(now) {
    if (!this.started) { this.start(now); return 'started'; }
    if (this.finished) {
      // undo an accidental finish: continue as if the final split hadn't happened
      this.run.pausedMs += now - this.run.finishedAt;
      this.run.finishedAt = null;
      delete this.run.splits.a10;
      return 'resumed';
    }
    if (this.paused) { this.resume(now); return 'resumed'; }
    this.pause(now, 'manual');
    return 'paused';
  }

  split(key, now) {
    if (!this.started || this.finished || this.run.splits[key] !== undefined) return null;
    const def = this.defs.find((d) => d.key === key);
    if (!def) return null;
    if (this.paused) this.resume(now);
    this.run.splits[key] = this.elapsed(now);
    if (def.final) this.run.finishedAt = now;
    return { ...def, t: this.run.splits[key] };
  }

  /** Called before F2 moves past `stepIndex`. Returns the split that fired, if any. */
  onStepDone(stepIndex, now) {
    const def = this.defs.find((d) => d.bossStep === stepIndex && this.run.splits[d.key] === undefined);
    return def ? this.split(def.key, now) : null;
  }

  /**
   * Called on every zone change. ctx.prevStepIndex is the route position and ctx.prevArea the
   * zone before this one. Returns {started?, split?}.
   */
  onArea(id, now, ctx = {}) {
    const out = {};
    if (id === '1_1_1') {
      const abandoned = this.started && now - this.run.startedAt > ABANDON_MS && (ctx.prevStepIndex ?? 0) <= 3 && !Object.keys(this.run.splits).length;
      if (!this.started || this.finished || (ctx.prevStepIndex ?? 0) > 3 || abandoned) {
        this.start(now, ctx.char || '');
        out.started = true;
        return out;
      }
    }
    if (!this.started || this.finished) return out;
    this.run.lastActive = now;

    // labyrinth pause
    if (isLab(id)) {
      if (this.opts.pauseInLab && !this.paused) this.pause(now, 'lab');
      return out;
    }
    if (this.paused) this.resume(now); // leaving the lab, or zoning after a manual pause

    const area = Areas[id];
    for (const d of this.defs) {
      if (this.run.splits[d.key] !== undefined) continue;
      let hit = false;
      if (d.areas) hit = d.areas.includes(id);
      else if (d.final) hit = id === '2_11_endgame_town' || (id === '2_10_town' && ctx.prevArea === d.bossArea);
      else hit = !!area && area.act === d.act + 1;
      if (hit) { out.split = this.split(d.key, now); break; }
    }
    return out;
  }

  /** Best finished run, or null. */
  pb() {
    const done = this.history.filter((h) => h.final !== null && h.final !== undefined);
    return done.length ? done.reduce((a, b) => (b.final < a.final ? b : a)) : null;
  }

  save() { return { run: this.run, history: this.history }; }
}

/** "1:16" or "0:11:30" or "7h" style goal strings -> ms. Plain numbers are minutes. */
function parseTime(s) {
  if (typeof s === 'number') return s * 60000;
  const parts = String(s).trim().split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return (parts[0] * 3600 + parts[1] * 60) * 1000; // h:mm
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000; // h:mm:ss
  return null;
}

module.exports = { RunTimer, splitDefs, parseTime, isLab };
