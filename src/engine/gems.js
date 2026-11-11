'use strict';
// Gem acquisition planner.
// Walks the route in order and decides, at every quest hand-in, which gem to take as the
// free reward and which gems to buy from the vendor. Unlike a pure "buy everything at the
// first chance" plan, gems are bought just in time: when the route's area level is within
// DUE_MARGIN of the level the build first needs them, or at the last vendor that sells them.
// After "Fallen from Grace" (Act 6), Lilly Roth sells every gem in each town, so late gems are
// bought at the first Act 6-10 town where they become due.
const { Gems, Quests, Characters, findGem, gemCost, searchStrings } = require('./data');

const DUE_MARGIN = 3;
const CAMPAIGN_LEVEL_CAP = 70; // stages starting above this are post-campaign
const LILLY_QUEST = 'a6q4';
const LILLY_TOWNS = new Set(['2_6_town', '2_7_town', '2_8_town', '2_9_town', '2_10_town']);

const classOk = (entry, cls) => entry && (entry.classes.length === 0 || entry.classes.includes(cls));

/**
 * Collect the build's required gems from its stages and extra gem list.
 * @returns {Array<{id,name,neededAt,count,order,stage,pin,skip,campaign}>}
 */
function requiredGems(build) {
  const map = new Map();
  let order = 0;
  const add = (nameOrId, stageFrom, count, stageTitle) => {
    const g = findGem(nameOrId);
    if (!g) return;
    // a gem can't be used before its level requirement, whatever the stage says
    const neededAt = Math.max(stageFrom, g.required_level || 1);
    const cur = map.get(g.id);
    if (cur) {
      if (neededAt < cur.neededAt) { cur.neededAt = neededAt; cur.stage = stageTitle; }
      cur.count = Math.max(cur.count, count);
    } else {
      map.set(g.id, { id: g.id, name: g.name, neededAt, count, order: order++, stage: stageTitle, isSupport: g.is_support });
    }
  };

  for (const stage of build.stages || []) {
    const from = Number.isFinite(stage.from) ? stage.from : 999;
    const counts = new Map();
    for (const link of stage.links || []) {
      for (const n of link.gems || []) {
        const g = findGem(n);
        if (!g) continue;
        counts.set(g.id, (counts.get(g.id) || 0) + 1);
      }
    }
    for (const [id, c] of counts) add(id, from, c, stage.title);
  }
  for (const e of build.extraGems || []) add(e.name, e.neededAt || 1, e.count || 1, 'extra');

  const overrides = build.gemOverrides || {};
  const out = [...map.values()];
  for (const r of out) {
    const o = overrides[r.name] || overrides[r.id] || {};
    if (o.neededAt) r.neededAt = o.neededAt;
    if (o.count) r.count = o.count;
    r.pin = o.pin || null;
    r.skip = !!o.skip;
    r.campaign = r.neededAt <= CAMPAIGN_LEVEL_CAP || !!r.pin;
  }
  return out;
}

/**
 * Plan gem acquisition and attach gem actions to route steps.
 * Mutates steps[].gems. Returns the plan.
 */
function planGems(route, build) {
  const cls = build.class;
  const { steps, segments } = route;
  const req = requiredGems(build);
  const owned = new Map(); // id -> count
  const acquired = new Map(); // id -> [{stepIndex, kind, npc}]
  const note = (id, entry) => {
    if (!acquired.has(id)) acquired.set(id, []);
    acquired.get(id).push(entry);
  };
  const have = (r) => owned.get(r.id) || 0;
  const need = (r) => r.count - have(r);

  // starting gems
  const ch = Characters[cls];
  if (ch) {
    for (const id of [ch.start_gem_id, ch.chest_gem_id]) {
      const r = req.find((x) => x.id === id);
      owned.set(id, (owned.get(id) || 0) + 1);
      if (r) note(id, { stepIndex: -1, kind: 'start', npc: id === ch.start_gem_id ? 'equipped at start' : 'first chest on Twilight Strand' });
    }
  }

  // vendor opportunities per gem: ordered step indexes where a vendor sells it to this class
  const vendorSteps = new Map();
  for (const s of steps) {
    for (const q of s.quests) {
      const quest = Quests[q.questId];
      for (const o of q.offers) {
        const offer = quest.reward_offers[o];
        if (!offer) continue;
        for (const [gid, v] of Object.entries(offer.vendor)) {
          if (!classOk(v, cls)) continue;
          if (!vendorSteps.has(gid)) vendorSteps.set(gid, []);
          const arr = vendorSteps.get(gid);
          if (arr[arr.length - 1] !== s.index) arr.push(s.index);
        }
      }
    }
  }
  // Would waiting for the next vendor that sells this gem make it late?
  const nextChanceTooLate = (r, stepIndex) => {
    const next = (vendorSteps.get(r.id) || []).find((i) => i > stepIndex);
    if (next === undefined) return true;
    return steps[next].progressLevel > r.neededAt;
  };

  let lillyStep = null;
  const active = req.filter((r) => !r.skip && r.campaign);
  const isDue = (r, lvl) => r.neededAt <= lvl + DUE_MARGIN;

  const pushBuy = (step, npc, r, copies, why) => {
    let block = step.gems.find((b) => b.kind === 'buy' && b.npc === npc);
    if (!block) { block = { kind: 'buy', npc, gems: [] }; step.gems.push(block); }
    const g = Gems[r.id];
    block.gems.push({ id: r.id, name: r.name, cost: gemCost(g), copies, why, neededAt: r.neededAt });
    owned.set(r.id, have(r) + copies);
    note(r.id, { stepIndex: step.index, kind: 'buy', npc, copies });
  };

  for (const step of steps) {
    // quest hand-ins
    for (const q of step.quests) {
      const quest = Quests[q.questId];
      // pass 1: free quest rewards (one pick per offer); pass 2: vendor buys
      for (const offerId of q.offers) {
        const offer = quest.reward_offers[offerId];
        if (!offer) continue;
        const cands = active.filter((r) => need(r) > 0 && classOk(offer.quest[r.id], cls) && (!r.pin || r.pin === q.questId));
        if (cands.length) {
          cands.sort((a, b) =>
            (isDue(a, step.progressLevel) ? 0 : 1) - (isDue(b, step.progressLevel) ? 0 : 1) ||
            (b.pin === q.questId) - (a.pin === q.questId) ||
            a.neededAt - b.neededAt || a.order - b.order);
          const r = cands[0];
          step.gems.push({ kind: 'take', npc: offer.quest_npc, quest: quest.name, gems: [{ id: r.id, name: r.name, neededAt: r.neededAt }] });
          owned.set(r.id, have(r) + 1);
          note(r.id, { stepIndex: step.index, kind: 'take', npc: offer.quest_npc });
        }
      }
      for (const offerId of q.offers) {
        const offer = quest.reward_offers[offerId];
        if (!offer) continue;
        for (const r of active) {
          if (need(r) <= 0) continue;
          const v = offer.vendor[r.id];
          if (!classOk(v, cls)) continue;
          if (r.pin && r.pin !== q.questId) continue;
          const due = isDue(r, step.progressLevel) || r.pin === q.questId;
          // From Fallen from Grace on, Lilly sells it in every town, so never buy early there.
          const lillyLater = (q.questId === LILLY_QUEST || lillyStep !== null) && lillySells(r.id, cls);
          const early = !due && !lillyLater && nextChanceTooLate(r, step.index);
          if (due || early) pushBuy(step, v.npc, r, need(r), due ? 'due' : 'next vendor is too late');
        }
      }
      if (q.questId === LILLY_QUEST) lillyStep = step.index;
    }
    // Lilly Roth in Act 6-10 towns: buy late gems just in time (first step of a town visit)
    if (lillyStep !== null && step.index > lillyStep && LILLY_TOWNS.has(step.areaId) &&
        segments[step.segment].firstStep === step.index) {
      for (const r of active) {
        if (need(r) <= 0 || !isDue(r, step.progressLevel)) continue;
        if (!lillySells(r.id, cls)) continue;
        pushBuy(step, 'Lilly Roth', r, need(r), 'due');
      }
    }
  }

  // Anything still missing at the end of the campaign
  const lastTown = [...steps].reverse().find((s) => LILLY_TOWNS.has(s.areaId));
  for (const r of active) {
    if (need(r) <= 0 || !lastTown || !lillySells(r.id, cls)) continue;
    pushBuy(lastTown, 'Lilly Roth', r, need(r), 'before maps');
  }

  // search strings per buy block
  for (const s of steps) {
    for (const b of s.gems) {
      if (b.kind === 'buy') b.search = searchStrings(b.gems.map((g) => g.name));
    }
  }

  const plan = req.map((r) => {
    const acq = acquired.get(r.id) || [];
    return {
      id: r.id, name: r.name, neededAt: r.neededAt, stage: r.stage, count: r.count,
      skip: r.skip, campaign: r.campaign, isSupport: r.isSupport,
      sources: acq.map((a) => ({ ...a, act: a.stepIndex >= 0 ? steps[a.stepIndex].act : 1, area: a.stepIndex >= 0 ? steps[a.stepIndex].areaName : 'start' })),
      firstStep: acq.length ? acq[0].stepIndex : null,
      missing: r.campaign && !r.skip && (owned.get(r.id) || 0) < r.count,
    };
  });
  return plan;
}

let lillyCache = null;
function lillySells(id, cls) {
  if (!lillyCache) lillyCache = Quests[LILLY_QUEST].reward_offers[LILLY_QUEST].vendor;
  return classOk(lillyCache[id], cls);
}

module.exports = { planGems, requiredGems, DUE_MARGIN, CAMPAIGN_LEVEL_CAP };
