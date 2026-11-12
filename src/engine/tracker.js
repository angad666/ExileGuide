'use strict';
// Route position tracker: reacts to area changes and level ups from Client.txt.
const { Areas } = require('./data');

const LOOKAHEAD_SEGMENTS = 8;
// quest work: a boss, a quest item to pick up or use, a hand-in, a trial, or a gem reward/purchase
const QUEST_TOKENS = new Set(['kill', 'quest', 'quest_text', 'trial']);
const isQuestStep = (s) => s.gems.length > 0 || s.tokens.some((t) => QUEST_TOKENS.has(t.k));

class Tracker {
  constructor(guide, saved = {}, opts = {}) {
    this.opts = { autoReset: true, ...opts };
    this.setGuide(guide);
    this.stepIndex = saved.stepIndex || 0;
    this.level = saved.level || 1;
    this.charName = saved.charName || '';
    this.stageOverride = Number.isInteger(saved.stageOverride) ? saved.stageOverride : null;
    this.currentArea = saved.currentArea || null;
    // route segments that an auto-jump went past while they still had quest work (kills, hand-ins, trials,
    // gem rewards). Entering one of their zones later takes the route back there ("detour"), and
    // `returnTo` remembers where to pick up again.
    this.skipped = Array.isArray(saved.skipped) ? saved.skipped.filter(Number.isInteger) : [];
    this.returnTo = Number.isInteger(saved.returnTo) ? saved.returnTo : null;
    this.visited = Array.isArray(saved.visited) ? saved.visited : []; // non-town zones entered this run
    this.townNotes = []; // step indexes of skipped hand-ins to do in the town you just entered
    this.clamp();
  }

  /** Does this segment hold something you can't simply walk past (boss, quest hand-in, trial, gem reward)? */
  hasQuestWork(segIndex) {
    const seg = this.route.segments[segIndex];
    if (!seg) return false;
    for (let i = seg.firstStep; i <= seg.lastStep; i++) {
      const s = this.route.steps[i];
      if (isQuestStep(s)) return true;
    }
    return false;
  }

  /** Skipped segments of the current act with quest work, oldest first: [{segment, area, steps}] */
  missed() {
    const sec = this.route.steps[this.stepIndex].sectionIndex;
    return this.skipped
      .filter((k) => this.route.steps[this.route.segments[k].firstStep].sectionIndex === sec)
      .sort((a, b) => a - b)
      .map((k) => {
        const seg = this.route.segments[k];
        const steps = this.route.steps.slice(seg.firstStep, seg.lastStep + 1)
          .filter(isQuestStep);
        return { segment: k, areaId: seg.areaId, steps };
      });
  }

  goToSegment(k) {
    this.stepIndex = this.route.segments[k].firstStep;
    this.skipped = this.skipped.filter((x) => x !== k);
  }

  setGuide(guide) {
    this.guide = guide;
    this.route = guide.route;
    this.clamp();
  }

  clamp() {
    if (!this.route) return;
    const n = this.route.steps.length;
    if (!Number.isInteger(this.stepIndex) || this.stepIndex < 0) this.stepIndex = 0;
    if (this.stepIndex >= n) this.stepIndex = n - 1;
  }

  get segmentIndex() { return this.route.steps[this.stepIndex].segment; }

  /** Area entered (from "Generating level N area"). Returns true if the position moved. */
  onArea(areaId) {
    this.currentArea = areaId;
    if (areaId === '1_1_1' && this.opts.autoReset && this.stepIndex > 3) {
      this.reset();
      this.visited = [areaId];
      return true;
    }
    const isTown = !!(Areas[areaId] && Areas[areaId].is_town_area);
    const moved = this.move(areaId, isTown);
    if (!isTown && !this.visited.includes(areaId)) this.visited.push(areaId);

    // skipped town hand-ins: you are in that town now, so show them here and count them as done, unless
    // a skipped boss/zone before them in this act is still open (then the detour brings you back later)
    this.townNotes = [];
    if (isTown) {
      const segs = this.route.segments;
      const sec = (k) => this.route.steps[segs[k].firstStep].sectionIndex;
      const here = this.route.steps[this.stepIndex].sectionIndex;
      const open = this.skipped.filter((k) => sec(k) === here && !this.isTownSeg(k));
      const due = this.skipped.filter((k) => sec(k) === here && segs[k].areaId === areaId && !open.some((o) => o < k));
      if (due.length) {
        this.townNotes = this.missed().filter((m) => due.includes(m.segment)).flatMap((m) => m.steps.map((s) => s.index));
        this.skipped = this.skipped.filter((k) => !due.includes(k));
      }
    }
    return moved;
  }

  isTownSeg(k) {
    const a = Areas[this.route.segments[k].areaId];
    return !!(a && a.is_town_area);
  }

  move(areaId, isTown) {
    const segs = this.route.segments;
    const cur = this.segmentIndex;
    if (segs[cur].areaId === areaId) return false;
    const limit = isTown ? 1 : LOOKAHEAD_SEGMENTS;

    if (this.returnTo !== null) {
      // on a detour through skipped quest work: next skipped segment, or back to where you left the route
      const back = this.route.steps[Math.min(this.returnTo, this.route.steps.length - 1)].segment;
      // (the route's very next zone also counts: Crypt Level 1 > Level 2 > town)
      for (let k = cur + 1; k < back && k <= cur + limit; k++) {
        if (segs[k].areaId === areaId && (this.skipped.includes(k) || k === cur + 1)) { this.goToSegment(k); return true; }
      }
      for (let k = back; k <= Math.min(segs.length - 1, back + limit); k++) {
        if (segs[k].areaId === areaId) {
          this.stepIndex = k === back ? this.returnTo : segs[k].firstStep;
          this.returnTo = null;
          return true;
        }
      }
      return false;
    }

    for (let k = cur + 1; k <= Math.min(segs.length - 1, cur + limit); k++) {
      if (segs[k].areaId === areaId) {
        // you went ahead of the route: remember skipped quest work so it isn't taken as done. A zone you
        // were already in this run counts as done (you did its part on an earlier visit).
        for (let j = cur + 1; j < k; j++) {
          if (this.skipped.includes(j) || !this.hasQuestWork(j)) continue;
          if (this.isTownSeg(j) || !this.visited.includes(segs[j].areaId)) this.skipped.push(j);
        }
        this.stepIndex = segs[k].firstStep;
        return true;
      }
    }

    // a zone you skipped earlier in this act: go back to that part of the route (towns are too ambiguous)
    if (!isTown) {
      const sec = this.route.steps[this.stepIndex].sectionIndex;
      const k = this.skipped
        .filter((j) => j < cur && segs[j].areaId === areaId && this.route.steps[segs[j].firstStep].sectionIndex === sec)
        .sort((a, b) => a - b)[0];
      if (k !== undefined) {
        this.returnTo = this.stepIndex;
        this.goToSegment(k);
        return true;
      }
    }
    return false;
  }

  onLevel(e) {
    const prevAuto = this.autoStage();
    if (e.name !== this.charName) this.charName = e.name;
    this.level = e.level;
    // a manual stage choice is dropped once the level moves into a new automatic stage
    if (this.stageOverride !== null && this.autoStage() !== prevAuto) this.stageOverride = null;
  }

  autoStage() {
    const { autoStageIndex } = require('./guide');
    return autoStageIndex(this.guide, this.level, this.stepIndex);
  }

  // hotkey moves: landing on a skipped part takes it off the list; reaching the detour's return point ends the detour
  manualMoved() {
    this.skipped = this.skipped.filter((k) => k !== this.segmentIndex);
    if (this.returnTo !== null && this.stepIndex >= this.returnTo) this.returnTo = null;
    this.townNotes = [];
  }
  next() { if (this.stepIndex < this.route.steps.length - 1) this.stepIndex++; this.manualMoved(); }
  prev() { if (this.stepIndex > 0) this.stepIndex--; this.manualMoved(); }
  nextSegment() {
    const segs = this.route.segments;
    const k = Math.min(segs.length - 1, this.segmentIndex + 1);
    this.stepIndex = segs[k].firstStep;
    this.manualMoved();
  }
  prevSegment() {
    const segs = this.route.segments;
    const k = Math.max(0, this.segmentIndex - 1);
    this.stepIndex = segs[k].firstStep;
    this.manualMoved();
  }
  jump(i) { this.stepIndex = i; this.clamp(); this.manualMoved(); }
  cycleStage(dir) {
    const n = this.guide.build.stages.length;
    if (!n) return;
    const cur = this.stageOverride ?? this.autoStage();
    this.stageOverride = (cur + dir + n) % n;
    if (this.stageOverride === this.autoStage()) this.stageOverride = null;
  }
  reset() {
    this.stepIndex = 0;
    this.level = 1;
    this.stageOverride = null;
    this.skipped = [];
    this.returnTo = null;
    this.visited = [];
    this.townNotes = [];
  }

  save() {
    return {
      stepIndex: this.stepIndex, level: this.level, charName: this.charName,
      stageOverride: this.stageOverride, currentArea: this.currentArea,
      skipped: this.skipped, returnTo: this.returnTo, visited: this.visited,
    };
  }
}

module.exports = { Tracker };
