'use strict';
// Route position tracker: reacts to area changes and level ups from Client.txt.
const { Areas } = require('./data');

const LOOKAHEAD_SEGMENTS = 8;

class Tracker {
  constructor(guide, saved = {}, opts = {}) {
    this.opts = { autoReset: true, ...opts };
    this.setGuide(guide);
    this.stepIndex = saved.stepIndex || 0;
    this.level = saved.level || 1;
    this.charName = saved.charName || '';
    this.stageOverride = Number.isInteger(saved.stageOverride) ? saved.stageOverride : null;
    this.currentArea = saved.currentArea || null;
    this.clamp();
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
    const segs = this.route.segments;
    const cur = this.segmentIndex;

    if (areaId === '1_1_1' && this.opts.autoReset && this.stepIndex > 3) {
      this.reset();
      return true;
    }
    if (segs[cur].areaId === areaId) return false;

    const area = Areas[areaId];
    const isTown = area && area.is_town_area;
    const limit = isTown ? 1 : LOOKAHEAD_SEGMENTS;
    for (let k = cur + 1; k <= Math.min(segs.length - 1, cur + limit); k++) {
      if (segs[k].areaId === areaId) {
        this.stepIndex = segs[k].firstStep;
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

  next() { if (this.stepIndex < this.route.steps.length - 1) this.stepIndex++; }
  prev() { if (this.stepIndex > 0) this.stepIndex--; }
  nextSegment() {
    const segs = this.route.segments;
    const k = Math.min(segs.length - 1, this.segmentIndex + 1);
    this.stepIndex = segs[k].firstStep;
  }
  prevSegment() {
    const segs = this.route.segments;
    const k = Math.max(0, this.segmentIndex - 1);
    this.stepIndex = segs[k].firstStep;
  }
  jump(i) { this.stepIndex = i; this.clamp(); }
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
  }

  save() {
    return {
      stepIndex: this.stepIndex, level: this.level, charName: this.charName,
      stageOverride: this.stageOverride, currentArea: this.currentArea,
    };
  }
}

module.exports = { Tracker };
