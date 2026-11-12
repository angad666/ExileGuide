'use strict';
// Run: npm test   (plain Node, no test framework)
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { loadRouteSources, gemSearchTerm, findGem, Quests } = require('../src/engine/data');
const { parseRoute } = require('../src/engine/route');
const { buildGuide, viewAt, stageIndexForLevel } = require('../src/engine/guide');
const { decodePobCode, pobXmlToBuild, parseLevels } = require('../src/engine/pob');
const { Tracker } = require('../src/engine/tracker');
const { parseLine } = require('../src/engine/logwatcher');
const { RunTimer, parseTime } = require('../src/engine/timer');

const FIX = path.join(__dirname, 'fixtures');
let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.stack.split('\n').slice(0, 3).join('\n       ')}`); process.exitCode = 1; }
};

const sources = loadRouteSources();
const pobXml = decodePobCode(fs.readFileSync(path.join(FIX, 'alohaa-static-strike.pob.txt'), 'utf8'));
const imported = pobXmlToBuild(pobXml, { name: 'Alohaa test' });
const defaultBuild = require('../builds/static-strike-slayer.json');

console.log('route');
test('parses all ten acts without warnings', () => {
  const r = parseRoute(sources, { bandit: 'Alira' });
  assert.strictEqual(r.sections.length, 10);
  assert.deepStrictEqual(r.warnings, []);
  assert.ok(r.steps.length > 400, `steps ${r.steps.length}`);
  assert.strictEqual(r.steps[0].areaId, '1_1_1');
});
test('bandit choice changes the Act 2 route', () => {
  const kill = parseRoute(sources, { bandit: 'None' });
  const alira = parseRoute(sources, { bandit: 'Alira' });
  const txt = (r) => r.steps.map((s) => s.tokens.map((t) => t.v).join('')).join('\n');
  assert.ok(/Help Alira Darktongue/.test(txt(alira)));
  assert.ok(!/Help Alira Darktongue/.test(txt(kill)));
});
test('league start toggles trials', () => {
  const ls = parseRoute(sources, { leagueStart: true });
  const no = parseRoute(sources, { leagueStart: false });
  const trials = (r) => r.steps.filter((s) => s.tokens.some((t) => t.k === 'trial')).length;
  assert.ok(trials(ls) >= 6);
  assert.strictEqual(trials(no), 0);
});
test('every step after an area change starts a segment in that area', () => {
  const r = parseRoute(sources, {});
  for (const seg of r.segments) assert.strictEqual(r.steps[seg.firstStep].areaId, seg.areaId);
  assert.strictEqual(r.segments[1].areaId, '1_1_town');
});

console.log('pob import');
test('reads class, ascendancy, bandit, stages', () => {
  assert.strictEqual(imported.class, 'Duelist');
  assert.strictEqual(imported.ascendancy, 'Slayer');
  assert.strictEqual(imported.bandit, 'Alira');
  assert.deepStrictEqual(imported.stages.slice(0, 3).map((s) => [s.title, s.from, s.to]), [['lvl 1-12', 1, 12], ['12-28', 12, 28], ['28-60', 28, 60]]);
  assert.deepStrictEqual(imported.importWarnings, []);
});
test('maps PoB gem ids to game gem names', () => {
  const main = imported.stages[0].links[0];
  assert.deepStrictEqual(main.gems, ['Spectral Throw', 'Volley Support', 'Chance to Bleed Support']);
});
test('reads gear per stage with item names and mods', () => {
  const weapon = imported.stages[1].gear.find((g) => g.slot === 'Weapon');
  assert.strictEqual(weapon.name, 'Serrated Double Axe');
  assert.ok(weapon.mods.some((m) => /increased Physical Damage/.test(m)));
  const rare = imported.stages[2].gear.find((g) => g.slot === 'Weapon');
  assert.strictEqual(rare.rarity, 'rare');
  assert.strictEqual(rare.name, 'Karui Chopper');
});
test('level parsing from titles', () => {
  assert.deepStrictEqual(parseLevels('lvl 1-12'), { from: 1, to: 12 });
  assert.deepStrictEqual(parseLevels('61 Crit Swap'), { from: 61 });
  assert.deepStrictEqual(parseLevels('Midgame'), {});
  assert.deepStrictEqual(parseLevels('Level 28 to 40'), { from: 28, to: 40 });
});

console.log('gem plan');
const guide = buildGuide(defaultBuild);
const stepOf = (questId) => guide.route.steps.find((s) => s.quests.some((q) => q.questId === questId));
const action = (questId, kind) => stepOf(questId).gems.filter((g) => g.kind === kind).flatMap((g) => g.gems.map((x) => x.name));
test('default build has no warnings or missing gems', () => {
  assert.deepStrictEqual(guide.warnings, []);
  assert.deepStrictEqual(guide.plan.filter((p) => p.missing).map((p) => p.name), []);
});
test('Mercy Mission: take Volley, buy Ruthless (Nessa stops selling it after)', () => {
  assert.ok(action('a1q5', 'take').includes('Volley Support'));
  assert.ok(action('a1q5', 'buy').includes('Ruthless Support'));
});
test('Static Strike is bought before Merveil', () => {
  assert.ok(action('a1q3', 'buy').includes('Static Strike'));
});
test('Hatred is the free Lost in Love reward; Fortify, Ambush, Trinity pinned to Lilly in Act 6', () => {
  assert.ok(action('a3q1', 'take').includes('Hatred'));
  for (const name of ['Fortify Support', 'Ambush', 'Trinity Support']) {
    const p = guide.plan.find((x) => x.name === name);
    assert.strictEqual(p.sources[0].npc, 'Lilly Roth', name);
    assert.strictEqual(p.sources[0].act, 6, name);
  }
});
test('level 61+ gems are bought from Lilly late in the campaign, not in Act 1-3', () => {
  for (const name of ['Lifetap Support', 'Flesh and Stone', 'Second Wind Support']) {
    const p = guide.plan.find((x) => x.name === name);
    assert.ok(p.sources.length, name);
    assert.strictEqual(p.sources[0].npc, 'Lilly Roth', name);
    assert.ok(p.sources[0].act >= 8, `${name} act ${p.sources[0].act}`);
  }
});
test('every gem in the campaign stages is acquired by the time its stage starts', () => {
  for (const p of guide.plan.filter((x) => x.campaign && !x.skip)) {
    const src = p.sources[0];
    assert.ok(src, p.name);
    if (src.stepIndex < 0 || p.neededAt <= 8) continue; // level 1-8 gems: first vendor/quest available
    const lvl = guide.route.steps[src.stepIndex].progressLevel;
    // on time, or at the very first quest/vendor that offers it to this class
    const firstOffer = guide.route.steps.find((st) => st.quests.some((q) => q.offers.some((o) => {
      const offer = Quests[q.questId].reward_offers[o];
      const ok = (e) => e && (e.classes.length === 0 || e.classes.includes('Duelist'));
      return offer && (ok(offer.quest[p.id]) || ok(offer.vendor[p.id]));
    })));
    assert.ok(lvl <= p.neededAt + 1 || firstOffer.index === src.stepIndex, `${p.name} needed ${p.neededAt}, acquired at route level ${lvl}`);
  }
});
test('gem overrides: skip and pin', () => {
  const b = structuredClone(defaultBuild);
  b.gemOverrides = { 'Blood Rage': { skip: true }, Haste: { pin: 'a3q12' } };
  const g = buildGuide(b);
  assert.ok(g.plan.find((p) => p.name === 'Blood Rage').skip);
  const haste = g.plan.find((p) => p.name === 'Haste');
  assert.strictEqual(g.route.steps[haste.sources[0].stepIndex].quests[0].questId, 'a3q12');
});
test('search strings are short, quoted and readable', () => {
  assert.strictEqual(gemSearchTerm('Spectral Throw'), 'spectral t');
  assert.strictEqual(gemSearchTerm('Ruthless Support'), 'ruthl');
  const s = guide.route.steps.flatMap((x) => x.gems).find((g) => g.kind === 'buy' && g.gems.length >= 2);
  for (const str of s.search) { assert.ok(str.length <= 50); assert.ok(/^".*"$/.test(str)); }
});
test('findGem accepts names with or without "Support"', () => {
  assert.strictEqual(findGem('Volley').name, 'Volley Support');
  assert.strictEqual(findGem('volley support').name, 'Volley Support');
  assert.strictEqual(findGem('Nonexistent Gem'), null);
});

console.log('stages and views');
test('stage chosen by level', () => {
  const b = guide.build;
  assert.strictEqual(b.stages[stageIndexForLevel(b, 5)].title, 'lvl 1-11');
  assert.strictEqual(b.stages[stageIndexForLevel(b, 12)].title, '12-17');
  assert.strictEqual(b.stages[stageIndexForLevel(b, 20)].title, '18-28');
  assert.strictEqual(b.stages[stageIndexForLevel(b, 63)].title, '61 Crit Swap');
});
test('view marks gems owned / coming', () => {
  const merveilQuest = stepOf('a1q3').index;
  const before = viewAt(guide, merveilQuest - 1, { level: 12 });
  const ss = before.stage.links.flatMap((l) => l.gems).find((g) => g.name === 'Static Strike');
  assert.strictEqual(ss.status, 'soon');
  const after = viewAt(guide, merveilQuest + 1, { level: 12 });
  assert.strictEqual(after.stage.links.flatMap((l) => l.gems).find((g) => g.name === 'Static Strike').status, 'owned');
});

console.log('log + tracker');
test('parses Client.txt lines', () => {
  assert.deepStrictEqual(parseLine('2026/11/08 08:34:29 173775218 1186a8a3 [DEBUG Client 35536] Generating level 3 area "1_1_2a" with seed 4260891328'), { type: 'area', id: '1_1_2a', level: 3 });
  assert.deepStrictEqual(parseLine('2023/04/08 18:26:33 2298312 cffb071e [INFO Client 23048] : bobs (Duelist) is now level 2'), { type: 'level', name: 'bobs', cls: 'Duelist', level: 2 });
  assert.deepStrictEqual(parseLine('x [INFO Client 1] : You have entered The Coast.'), { type: 'enter', name: 'The Coast' });
  assert.strictEqual(parseLine('x [INFO Client 1] : Trade accepted.'), null);
});
test('replaying a real run follows the route into Act 2+', () => {
  const t = new Tracker(guide, {});
  const lines = fs.readFileSync(path.join(FIX, 'client-run-sample.txt'), 'utf8').split(/\r?\n/);
  let last = 0;
  let backwards = 0;
  for (const line of lines) {
    const e = parseLine(line);
    if (!e) continue;
    if (e.type === 'area') t.onArea(e.id);
    if (e.type === 'level') t.onLevel(e);
    if (t.stepIndex < last) backwards++;
    last = t.stepIndex;
  }
  const step = guide.route.steps[t.stepIndex];
  assert.ok(step.act >= 2, `ended in act ${step.act} at ${step.areaName}`);
  assert.strictEqual(backwards, 0, 'zone changes never move the guide backwards');
  console.log(`       (replay ended at step ${t.stepIndex + 1}: ${step.section}, ${step.areaName}, level ${t.level})`);
});
test('unplanned town visits do not skip ahead', () => {
  const t = new Tracker(guide, {});
  t.onArea('1_1_town');
  const s1 = t.stepIndex;
  t.onArea('1_1_2'); // Coast
  const coast = t.stepIndex;
  assert.ok(coast > s1);
  t.onArea('1_1_town'); // extra town trip (not next in route)
  assert.strictEqual(t.stepIndex, coast);
  t.onArea('1_1_3'); // Mud Flats: next zone
  assert.strictEqual(guide.route.steps[t.stepIndex].areaId, '1_1_3');
});
test('Twilight Strand restarts the route', () => {
  const t = new Tracker(guide, { stepIndex: 100, level: 20 });
  t.onArea('1_1_1');
  assert.strictEqual(t.stepIndex, 0);
  assert.strictEqual(t.level, 1);
});

// ---------------- run timer ----------------
const MIN = 60000;
test('timer: parses goal times', () => {
  assert.strictEqual(parseTime('0:34'), 34 * MIN);
  assert.strictEqual(parseTime('0:11:30'), 11.5 * MIN);
  assert.strictEqual(parseTime('7:00'), 420 * MIN);
});
test('timer: starts in the Strand, splits Brutus by F2 and acts by zone, pauses in the lab', () => {
  const rt = new RunTimer(guide.route, {});
  assert.strictEqual(rt.started, false);
  assert.ok(rt.onArea('1_1_1', 0, { prevStepIndex: 0 }).started);
  rt.onArea('1_1_2', 1 * MIN, {});
  const brutusStep = rt.defs.find((d) => d.key === 'brutus').bossStep;
  assert.ok(brutusStep > 0);
  assert.strictEqual(rt.onStepDone(brutusStep, 12 * MIN).key, 'brutus');
  assert.strictEqual(rt.onArea('1_1_8', 13 * MIN, {}).split, undefined, 'Prisoner\'s Gate does not split Brutus twice');
  assert.strictEqual(rt.onArea('1_2_1', 30 * MIN, {}).split.key, 'a1', 'Southern Forest ends act 1');
  assert.strictEqual(rt.onArea('1_2_town', 31 * MIN, {}).split, undefined, 'act 2 town does not split again');
  // lab time is not counted
  rt.onArea('1_Labyrinth_boss_3', 60 * MIN, {});
  assert.ok(rt.paused);
  rt.onArea('1_3_town', 75 * MIN, {});
  assert.ok(!rt.paused);
  assert.strictEqual(rt.elapsed(80 * MIN), 65 * MIN);
  // manual pause resumes on the next zone
  rt.toggle(80 * MIN);
  assert.strictEqual(rt.elapsed(90 * MIN), 65 * MIN);
  rt.onArea('1_3_1', 90 * MIN, {});
  assert.strictEqual(rt.elapsed(91 * MIN), 66 * MIN);
});
test('timer: finishes at Kitava, undo, and a new Strand starts a new run', () => {
  const rt = new RunTimer(guide.route, {});
  rt.onArea('1_1_1', 0, { prevStepIndex: 0 });
  const k = rt.defs.find((d) => d.final);
  rt.onArea('2_10_town', 100 * MIN, { prevArea: '2_10_1' });
  assert.ok(!rt.finished, 'an ordinary Act 10 town visit does not finish');
  rt.onStepDone(k.bossStep, 200 * MIN);
  assert.ok(rt.finished);
  assert.strictEqual(rt.elapsed(500 * MIN), 200 * MIN);
  assert.strictEqual(rt.toggle(210 * MIN), 'resumed');
  assert.ok(!rt.finished);
  rt.onArea('2_10_town', 215 * MIN, { prevArea: k.bossArea });
  assert.ok(rt.finished);
  assert.strictEqual(rt.run.splits.a10, 205 * MIN);
  // new character
  rt.onArea('1_1_1', 300 * MIN, { prevStepIndex: 480 });
  assert.strictEqual(rt.elapsed(301 * MIN), 1 * MIN);
  assert.strictEqual(rt.history.length, 1);
  assert.strictEqual(rt.pb().final, 205 * MIN);
});
test('timer: dying in the Strand does not restart the run', () => {
  const rt = new RunTimer(guide.route, {});
  rt.onArea('1_1_1', 0, { prevStepIndex: 0 });
  rt.onArea('1_1_1', 2 * MIN, { prevStepIndex: 1 });
  assert.strictEqual(rt.elapsed(3 * MIN), 3 * MIN);
});
test('timer: closing the game pauses as of the last sighting, the next zone resumes', () => {
  const rt = new RunTimer(guide.route, {});
  rt.onArea('1_1_1', 0, { prevStepIndex: 0 });
  rt.onArea('1_1_2', 20 * MIN, { prevStepIndex: 1 });
  // game last seen at 30 min, noticed at 31 min
  assert.strictEqual(rt.gameClosed(30 * MIN, 31 * MIN), true);
  assert.strictEqual(rt.run.pauseReason, 'closed');
  assert.strictEqual(rt.elapsed(600 * MIN), 30 * MIN);
  assert.strictEqual(rt.gameClosed(40 * MIN, 41 * MIN), false); // already paused
  // next day: log in, first zone resumes
  rt.onArea('1_1_3', 1000 * MIN, { prevStepIndex: 2 });
  assert.strictEqual(rt.paused, false);
  assert.strictEqual(rt.elapsed(1005 * MIN), 35 * MIN);
  // a last-seen time before the last zone change is clamped to it
  rt.gameClosed(10 * MIN, 1010 * MIN);
  assert.strictEqual(rt.elapsed(2000 * MIN), 30 * MIN);
  // a saved run without lastActive (older timer.json) falls back to the start time
  const old = new RunTimer(guide.route, { run: { startedAt: 0, pausedAt: null, pausedMs: 0, finishedAt: null, splits: {} } });
  old.gameClosed(5 * MIN, 6 * MIN);
  assert.strictEqual(old.elapsed(99 * MIN), 5 * MIN);
});
test('timer: replay of a real Client.txt run splits every act in order', () => {
  const t = new Tracker(guide, {});
  const rt = new RunTimer(guide.route, {});
  const lines = fs.readFileSync(path.join(FIX, 'client-run-sample.txt'), 'utf8').split(/\r?\n/);
  const order = [];
  for (const line of lines) {
    const e = parseLine(line);
    if (!e || e.type !== 'area') continue;
    const m = /^(\d{4})\/(\d\d)\/(\d\d) (\d\d):(\d\d):(\d\d)/.exec(line);
    const now = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    const prevStepIndex = t.stepIndex, prevArea = t.currentArea;
    t.onArea(e.id);
    const r = rt.onArea(e.id, now, { prevStepIndex, prevArea });
    if (r.split) order.push(`${r.split.name} ${Math.round(r.split.t / 60000)}m`);
  }
  assert.ok(order.length >= 2, order.join(', '));
  assert.ok(order[0].startsWith('Brutus'), order.join(', '));
  const t1 = Object.values(rt.run.splits);
  for (let i = 1; i < t1.length; i++) assert.ok(t1[i] >= t1[i - 1]);
  console.log(`       (splits: ${order.join(', ')})`);
});

console.log('post-campaign route');
test('endgame chapters follow Act 10, each chapter is its own segment', () => {
  const steps = guide.route.steps;
  const eg = steps.filter((s) => s.chapter);
  assert.ok(eg.length > 20, `endgame steps ${eg.length}`);
  assert.ok(eg[0].index > steps.filter((s) => s.act === 10).pop().index);
  const chapters = [...new Set(eg.map((s) => s.areaName))];
  assert.ok(chapters.some((c) => /Eldritch/.test(c)) && chapters.some((c) => /Maven/.test(c)), chapters.join(', '));
  assert.strictEqual(new Set(eg.map((s) => s.segment)).size, chapters.length);
  assert.deepStrictEqual(guide.warnings, []);
});
test('copy strings keep their | alternations', () => {
  const copies = guide.route.steps.flatMap((s) => [s.tokens, ...s.subs]).flat().filter((t) => t.k === 'copy');
  assert.ok(copies.some((t) => t.v === `"^Emperor's|^Dictator's|^Tyrannical|^Merciless"`), copies.map((t) => t.v).join(' '));
});
test('the endgame chapter picks the gear stage (#stage), the level can only move it later', () => {
  const { autoStageIndex } = require('../src/engine/guide');
  const at = (chapter, level) => {
    const s = guide.route.steps.find((x) => x.areaName.startsWith(chapter));
    return guide.build.stages[autoStageIndex(guide, level, s.index)].title;
  };
  assert.strictEqual(at('Red maps', 86), 'Endgame Red Maps');
  assert.strictEqual(at('Yellow maps', 76), 'Midgame');
  assert.strictEqual(at('Red maps', 70), '61-Early Maps'); // red-map gear is out of reach at 70: stage by level
  assert.strictEqual(at('After Kitava', 69), '61-Early Maps');
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
