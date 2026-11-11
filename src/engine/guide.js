'use strict';
// Builds the full guide for a build profile and produces per-position views for the overlay.
const { loadRouteSources, findGem, Quests, Areas } = require('./data');
const { parseRoute } = require('./route');
const { planGems } = require('./gems');

const routeSources = loadRouteSources();

function normalizeBuild(b) {
  const build = { ...b };
  build.stages = (b.stages || []).map((s) => ({ links: [], gear: [], notes: [], ...s }));
  build.stages.sort((a, c) => (a.from ?? 1) - (c.from ?? 1));
  build.steps = b.steps || [];
  build.milestones = b.milestones || [];
  build.extraGems = b.extraGems || [];
  // post-campaign route in the route DSL (lines), appended after Act 10: #section / #chapter / #stage
  build.endgame = Array.isArray(b.endgame) ? b.endgame : (typeof b.endgame === 'string' ? b.endgame.split(/\r?\n/) : []);
  build.gemOverrides = b.gemOverrides || {};
  return build;
}

function buildGuide(rawBuild) {
  const build = normalizeBuild(rawBuild);
  const sources = build.endgame.length ? [...routeSources, build.endgame.join('\n')] : routeSources;
  const route = parseRoute(sources, { leagueStart: build.leagueStart, library: build.library, bandit: build.bandit });
  const plan = planGems(route, build);
  const warnings = [...route.warnings];

  // build-specific notes injected into the route
  for (const n of build.steps) {
    let target = null;
    if (n.quest) target = route.steps.find((s) => s.quests.some((q) => q.questId === n.quest));
    else if (n.area) {
      const occ = n.occurrence || 1;
      const segs = route.segments.filter((g) => g.areaId === n.area);
      const seg = segs[occ - 1] || segs[0];
      if (seg) target = route.steps[n.position === 'end' ? seg.lastStep : seg.firstStep];
    } else if (Number.isFinite(n.level)) {
      target = route.steps.find((s) => s.progressLevel >= n.level && route.segments[s.segment].firstStep === s.index);
    }
    if (target) target.notes.push({ text: n.text, search: n.search || '', kind: n.kind || 'note' });
    else warnings.push(`Build step not placed: ${n.text}`);
  }

  // unknown gem names in the build
  for (const st of build.stages) for (const l of st.links) for (const g of l.gems) {
    if (!findGem(g)) warnings.push(`Unknown gem "${g}" in stage ${st.title}`);
  }

  return { build, route, plan, warnings };
}

/**
 * The automatic stage: by character level, or the route's "#stage" hint at this step when that is later
 * (post-campaign chapters say which gear/links set applies), as long as the level is within 5 of it.
 */
function autoStageIndex(guide, level, stepIndex) {
  const build = guide.build;
  const byLevel = stageIndexForLevel(build, level);
  const step = guide.route.steps[Math.max(0, Math.min(stepIndex ?? 0, guide.route.steps.length - 1))];
  if (!step || !step.stageHint) return byLevel;
  const want = step.stageHint.toLowerCase();
  const hint = build.stages.findIndex((s) => (s.title || '').toLowerCase() === want);
  if (hint < 0) return byLevel;
  if ((build.stages[hint].from ?? 1) > level + 5) return byLevel;
  return (build.stages[hint].from ?? 1) >= (build.stages[byLevel].from ?? 1) ? hint : byLevel;
}

/** Pick the stage for a character level. Ties (same "from") resolve to the first listed. */
function stageIndexForLevel(build, level) {
  let idx = 0;
  for (let i = 0; i < build.stages.length; i++) {
    const s = build.stages[i];
    if ((s.from ?? 1) <= level && (s.from ?? 1) > (build.stages[idx].from ?? 1)) idx = i;
  }
  return idx;
}

function gemStatus(guide, gemName, stepIndex) {
  const g = findGem(gemName);
  if (!g) return { name: gemName, status: 'unknown' };
  const p = guide.plan.find((x) => x.id === g.id);
  const base = { name: g.name, support: g.is_support, reqLevel: g.required_level, attr: g.primary_attribute };
  if (!p) return { ...base, status: 'unplanned' };
  if (p.skip) return { ...base, status: 'skip' };
  const src = p.sources[0];
  if (!src) return { ...base, status: p.campaign ? 'missing' : 'later' };
  if (src.stepIndex < stepIndex) return { ...base, status: 'owned' };
  if (src.stepIndex === stepIndex) return { ...base, status: 'now', where: `${src.kind === 'take' ? 'Take from' : 'Buy from'} ${src.npc}` };
  return { ...base, status: 'soon', where: `A${src.act} ${src.kind === 'take' ? 'reward' : 'buy'}: ${src.npc}` };
}

function nextZone(route, stepIndex) {
  for (let i = stepIndex; i < route.steps.length; i++) {
    for (const t of route.steps[i].tokens) {
      if (t.k === 'enter' || t.k === 'wpuse' || t.k === 'logout') return { name: t.v, id: t.id, via: t.k, stepIndex: i };
    }
  }
  return null;
}

/** Everything the overlay needs to render at a route position. */
function viewAt(guide, stepIndex, ctx = {}) {
  const { route, build } = guide;
  const steps = route.steps;
  const i = Math.max(0, Math.min(stepIndex, steps.length - 1));
  const step = steps[i];
  const seg = route.segments[step.segment];
  const level = ctx.level || step.progressLevel;
  const autoStage = autoStageIndex(guide, level, i);
  const stageIdx = Number.isInteger(ctx.stageOverride) ? Math.max(0, Math.min(ctx.stageOverride, build.stages.length - 1)) : autoStage;
  const stage = build.stages[stageIdx];
  const prevStage = stageIdx > 0 ? build.stages[stageIdx - 1] : null;
  const nextStage = build.stages.find((s, k) => k > stageIdx && (s.from ?? 0) > (stage?.from ?? 0)) || null;

  const stageView = stage ? {
    index: stageIdx,
    auto: stageIdx === autoStage,
    title: stage.title,
    from: stage.from, to: stage.to,
    tree: stage.tree || '',
    notes: stage.notes || [],
    links: stage.links.map((l) => ({
      label: l.label,
      slot: l.slot || '',
      gems: l.gems.map((g) => gemStatus(guide, g, i)),
      isNew: !!prevStage && !prevStage.links.some((pl) => pl.gems.join('|') === l.gems.join('|')),
    })),
    gear: stage.gear.map((it) => ({
      ...it,
      isNew: !!prevStage && !prevStage.gear.some((p) => p.slot === it.slot && p.name === it.name),
    })),
    next: nextStage ? { title: nextStage.title, from: nextStage.from } : null,
  } : null;

  const milestones = build.milestones
    .filter((m) => (m.level ?? 1) <= level + 2 && (m.until ?? 999) >= level)
    .map((m) => ({ ...m, upcoming: (m.level ?? 1) > level }));

  const sec = route.sections[step.sectionIndex] || { name: step.section };
  return {
    stepIndex: i,
    totalSteps: steps.length,
    section: sec.name,
    sectionIndex: step.sectionIndex,
    sectionCount: route.sections.length,
    area: { id: step.areaId, name: step.areaName, town: step.isTown, level: Areas[step.areaId]?.level, chapter: !!step.chapter },
    segment: { first: seg.firstStep, last: seg.lastStep },
    step,
    segmentSteps: steps.slice(seg.firstStep, seg.lastStep + 1),
    upcoming: steps.slice(i + 1, i + 4),
    nextZone: nextZone(route, i),
    stage: stageView,
    stageCount: build.stages.length,
    milestones,
    level,
  };
}

/** Steps whose gem actions/notes summarize the whole plan (for the settings window). */
function planSummary(guide) {
  return guide.route.steps
    .filter((s) => s.gems.length || s.notes.length)
    .map((s) => ({
      stepIndex: s.index, act: s.act, area: s.areaName,
      quest: s.quests.map((q) => Quests[q.questId]?.name).join(', '),
      gems: s.gems, notes: s.notes,
    }));
}

module.exports = { buildGuide, viewAt, stageIndexForLevel, autoStageIndex, planSummary, normalizeBuild };
