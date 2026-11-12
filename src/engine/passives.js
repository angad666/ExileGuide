'use strict';
// Passive tree guidance: turns the build's PoB trees (one per stage) into an ordered list of what to take,
// and checks it against what Client.txt says you allocated ("Successfully allocated passive skill ...").
//
// PoB stores a tree as a set of nodes, not an order, so the order is worked out here: starting from the
// previous stage's tree, take the nearest notable / keystone / jewel socket / mastery first, with the small
// nodes on the way to it, until the stage's tree is complete.

let TREE = null;
const tree = () => (TREE ||= require('../../data/passive-tree.json'));

const PRIORITY = { k: 0, n: 1, j: 2, m: 3 };
const LABS = ['Normal Lab', 'Cruel Lab', 'Merciless Lab', 'Eternal Lab'];

function info(id, masteries) {
  const n = tree().nodes[id];
  const out = { id: +id, name: n.n, type: n.t };
  if (n.s) out.stats = n.s;
  if (n.t === 'm' && masteries && masteries[id] !== undefined) out.effect = tree().masteries[id]?.[masteries[id]] || '';
  return out;
}

/** BFS from `have` through `allowed` nodes; returns {dist, parent} maps. */
function bfs(have, allowed) {
  const T = tree().nodes;
  const dist = new Map();
  const parent = new Map();
  const queue = [];
  for (const id of have) { dist.set(id, 0); queue.push(id); }
  for (let q = 0; q < queue.length; q++) {
    const id = queue[q];
    for (const o of T[id]?.e || []) {
      if (dist.has(o) || !allowed.has(o)) continue;
      dist.set(o, dist.get(id) + 1);
      parent.set(o, id);
      queue.push(o);
    }
  }
  return { dist, parent };
}

/** Order the nodes in `todo` (main tree) starting from the allocated set `base`. */
function orderGoals(base, todo, masteries, startCum) {
  const T = tree().nodes;
  const have = new Set(base);
  const left = new Set(todo);
  const goals = [];
  let cum = startCum;
  while (left.size) {
    const { dist, parent } = bfs(have, left);
    // a mastery can be taken once a notable of its cluster is allocated
    for (const id of left) {
      if (T[id].t !== 'm' || dist.has(id)) continue;
      if ([...have].some((h) => T[h].g === T[id].g && T[h].t === 'n')) { dist.set(id, 1); parent.set(id, null); }
    }
    let best = null;
    for (const id of left) {
      if (!dist.has(id) || PRIORITY[T[id].t] === undefined) continue;
      const d = dist.get(id);
      if (!best || d < best.d || (d === best.d && PRIORITY[T[id].t] < PRIORITY[T[best.id].t])) best = { id, d };
    }
    if (!best) {
      // only small nodes left: the nearest one
      for (const id of left) {
        if (!dist.has(id)) continue;
        const d = dist.get(id);
        if (!best || d < best.d) best = { id, d };
      }
    }
    if (!best) break; // the rest is not connected (cluster jewel nodes)
    const path = [];
    for (let id = best.id; id && !have.has(id); id = parent.get(id)) path.unshift(id);
    for (const id of path) { have.add(id); left.delete(id); }
    cum += path.length;
    const target = path[path.length - 1];
    const travel = path.slice(0, -1);
    if (T[target].t === 's') {
      const prev = goals[goals.length - 1];
      if (prev && prev.type === 'smalls') { prev.ids.push(...path); prev.names.push(...path.map((i) => T[i].n)); prev.cum = cum; continue; }
      goals.push({ type: 'smalls', ids: [...path], names: path.map((i) => T[i].n), cum });
      continue;
    }
    goals.push({ ...info(target, masteries), travel: travel.map((i) => T[i].n), cum });
  }
  return goals;
}

/** The plan for a build: per stage, what to refund and what to take, plus the ascendancy by lab. */
function planTree(build) {
  const T = tree().nodes;
  const stages = build.stages || [];
  const plans = [];
  let prev = null;
  let prevMast = {};
  for (let si = 0; si < stages.length; si++) {
    const p = stages[si].passives;
    if (!p || !p.nodes?.length) { plans.push(null); continue; }
    const main = p.nodes.map(String).filter((id) => T[id] && !T[id].a);
    const cur = new Set(main);
    const start = main.find((id) => T[id].t === 'c');
    const base = new Set(prev ? main.filter((id) => prev.has(id)) : []);
    if (start) base.add(start);
    const masteries = p.masteries || {};
    const refunds = prev ? [...prev].filter((id) => !cur.has(id) && T[id].t !== 'c') : [];
    // the same mastery with a different effect: pick the new one (costs a refund point)
    const swaps = [...base].filter((id) => T[id].t === 'm' && prevMast[id] !== undefined && masteries[id] !== undefined && prevMast[id] !== masteries[id])
      .map((id) => info(id, masteries));
    const startCum = [...base].filter((id) => T[id].t !== 'c').length;
    const goals = orderGoals(base, main.filter((id) => !base.has(id)), masteries, startCum);
    plans.push({
      stage: si, title: stages[si].title, from: stages[si].from,
      points: main.filter((id) => T[id].t !== 'c').length,
      nodes: main,
      refunds: refunds.map((id) => info(id, prevMast)),
      swaps, goals,
      unknown: p.nodes.filter((id) => !T[String(id)]).length, // cluster jewel nodes and nodes not in this tree version
    });
    prev = cur;
    prevMast = masteries;
  }
  return { stages: plans, ascendancy: planAscendancy(build) };
}

function planAscendancy(build) {
  const T = tree().nodes;
  const firstStage = new Map();
  (build.stages || []).forEach((s, si) => {
    for (const id of s.passives?.nodes || []) {
      const k = String(id);
      if (T[k]?.a && !firstStage.has(k)) firstStage.set(k, si);
    }
  });
  const all = new Set(firstStage.keys());
  const start = [...all].find((id) => T[id].t === 'A');
  if (!start) return [];
  const order = (build.ascendancyOrder || []).map((n) => n.toLowerCase());
  const rank = (id) => { const i = order.indexOf(T[id].n.toLowerCase()); return i < 0 ? 99 : i; };
  const notables = [...all].filter((id) => T[id].t === 'N')
    .sort((a, b) => rank(a) - rank(b) || firstStage.get(a) - firstStage.get(b) || +a - +b);
  const have = new Set([start]);
  const points = [];
  const take = (target) => {
    const { parent } = bfs(have, all);
    const path = [];
    for (let id = target; id && !have.has(id); id = parent.get(id)) path.unshift(id);
    for (const id of path) { have.add(id); points.push(id); }
  };
  for (const id of notables) take(id);
  for (const id of all) if (!have.has(id)) take(id);
  const labs = [];
  for (let i = 0; i < points.length; i += 2) {
    labs.push({ lab: LABS[labs.length] || `Lab ${labs.length + 1}`, nodes: points.slice(i, i + 2).map((id) => info(id)) });
  }
  return labs;
}

/**
 * What the Tree panel shows.
 * state: { taken: {name: count}, asc: {name: count}, quest: n } from Client.txt (tracker.passives)
 */
function treeView(plan, stageIndex, state, ctx = {}) {
  if (!plan || !plan.stages.some(Boolean)) return null;
  const level = ctx.level || 1;
  const taken = state?.taken || {};
  const allocated = Object.values(taken).reduce((a, b) => a + b, 0);
  const tracked = allocated > 0;
  const quest = state?.quest || 0;
  const available = level - 1 + quest;

  // goals of every stage up to the current one, minus what a later stage (up to this one) refunds
  const upto = plan.stages.filter((p) => p && p.stage <= stageIndex);
  const cur = upto[upto.length - 1] || plan.stages.find(Boolean);
  const inTree = new Set(cur.nodes);
  let goals = upto.flatMap((p) => p.goals.map((g) => {
    if (g.type !== 'smalls' || g.ids.every((i) => inTree.has(i))) return { ...g, stage: p.stage };
    const ids = g.ids.filter((i) => inTree.has(i)); // small nodes a later stage refunds
    return ids.length ? { ...g, ids, names: ids.map((i) => tree().nodes[i].n), stage: p.stage } : null;
  })).filter((g) => g && (g.type === 'smalls' || inTree.has(String(g.id))));
  // a node refunded and taken again later only counts once (the later one)
  goals = goals.filter((g, i) => g.type === 'smalls' || !goals.slice(i + 1).some((x) => x.id === g.id));
  const curPoints = cur.points;

  const used = {};
  const isDone = (g) => {
    if (!tracked) return g.cum <= available;
    if (g.type === 'smalls') return allocated >= g.cum || allocated >= curPoints;
    const have = (taken[g.name] || 0) > (used[g.name] || 0);
    if (have) used[g.name] = (used[g.name] || 0) + 1;
    return have;
  };
  const marked = goals.map((g) => ({ ...g, done: isDone(g) }));
  const next = marked.filter((g) => !g.done);

  // refunds of the current stage that are still allocated
  const stillTaken = (r) => (taken[r.name] || 0) > 0;
  const refunds = tracked ? cur.refunds.filter((r) => r.type !== 's' && stillTaken(r)) : (next.length && next[0].stage === cur.stage && marked.filter((g) => g.stage === cur.stage && g.done).length === 0 ? cur.refunds.filter((r) => r.type !== 's') : []);
  const refundSmalls = refunds.length ? cur.refunds.filter((r) => r.type === 's').length : 0;

  // when this stage's tree is complete, preview the next stage
  const nextPlan = !next.length ? plan.stages.find((p) => p && p.stage > cur.stage) : null;

  // ascendancy: labs done from the ascendancy points you allocated, otherwise from the route position
  const ascPoints = Object.values(state?.asc || {}).reduce((a, b) => a + b, 0);
  const labsDone = ascPoints > 0 ? Math.floor(ascPoints / 2) : (ctx.labsPassed || 0);
  const nextLab = plan.ascendancy[labsDone] || null;

  return {
    title: cur.title,
    stage: cur.stage,
    points: { allocated: tracked ? allocated : null, available, quest, target: curPoints, spare: tracked ? available - allocated : null },
    tracked,
    next: next.slice(0, ctx.max || 4),
    remaining: next.length,
    refunds, refundSmalls,
    swaps: tracked || refunds.length ? cur.swaps : [],
    nextStage: nextPlan ? { title: nextPlan.title, from: nextPlan.from, refunds: nextPlan.refunds.filter((r) => r.type !== 's').length + nextPlan.refunds.filter((r) => r.type === 's').length, goals: nextPlan.goals.slice(0, 3) } : null,
    lab: nextLab ? { ...nextLab, index: labsDone } : null,
    labsTotal: plan.ascendancy.length,
    unknown: cur.unknown,
  };
}

module.exports = { planTree, treeView, tree, LABS };
