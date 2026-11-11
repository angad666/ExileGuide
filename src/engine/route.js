'use strict';
// Route parser: a port of exile-leveling's route DSL (MIT) that emits display tokens.
// Each top-level line becomes a step; "#sub" lines become hints on the previous step.
// A step belongs to the area the player is in while doing it; when the area changes,
// a new "segment" starts. Entering that area (Client.txt) jumps to the segment's first step.
const { Areas, Quests, KillWaypoints } = require('./data');

const DIRS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

function initialState(defines) {
  return {
    currentAreaId: '1_1_1',
    lastTownAreaId: '1_1_town',
    portalAreaId: null,
    defines: new Set(defines),
    warnings: [],
  };
}

// Post-campaign "chapters" (#chapter Name) are pseudo areas: each one is its own route segment, so
// Shift+F1/F2 move between chapters. They are not in the game data, so they're kept here.
const Chapters = {};
const CHAPTER_ACT = 11;

function areaName(id) {
  const a = Areas[id] || Chapters[id];
  return a ? a.name : id;
}

function transition(state, area) {
  if (area.is_town_area) state.lastTownAreaId = area.id;
  state.currentAreaId = area.id;
}

// Returns { tokens, quests: [{questId, offers}] }
function parseFragments(text, state) {
  const tokens = [];
  const quests = [];
  // strip trailing comments (" #Lioneye's Watch")
  const re = /\{(.+?)\}|([^{#]+)|( *#.*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[3] !== undefined) break; // comment: rest of line ignored
    if (m[2] !== undefined) { tokens.push({ k: 'text', v: m[2] }); continue; }
    const p = m[1].split('|');
    const type = p[0];
    switch (type) {
      case 'kill': {
        const wps = KillWaypoints[p[1]];
        tokens.push({ k: 'kill', v: p[1] });
        void wps;
        break;
      }
      case 'arena': tokens.push({ k: 'arena', v: p[1] }); break;
      case 'area': tokens.push({ k: 'area', v: areaName(p[1]), id: p[1] }); break;
      case 'enter': {
        const a = Areas[p[1]];
        if (!a) { state.warnings.push(`unknown area ${p[1]}`); break; }
        transition(state, a);
        tokens.push({ k: 'enter', v: a.name, id: a.id });
        break;
      }
      case 'logout': {
        const town = Areas[state.lastTownAreaId];
        transition(state, town);
        state.portalAreaId = null;
        tokens.push({ k: 'logout', v: town.name, id: town.id });
        break;
      }
      case 'waypoint': {
        if (p.length === 2) {
          const a = Areas[p[1]];
          if (!a) { state.warnings.push(`unknown area ${p[1]}`); break; }
          transition(state, a);
          tokens.push({ k: 'wpuse', v: a.name, id: a.id });
        } else tokens.push({ k: 'wp', v: 'waypoint' });
        break;
      }
      case 'waypoint_get': tokens.push({ k: 'wpget', v: 'Waypoint' }); break;
      case 'portal': {
        const cur = Areas[state.currentAreaId];
        if (p[1] === 'set') {
          state.portalAreaId = cur.id;
          tokens.push({ k: 'portal', v: 'Place a portal' });
        } else {
          if (state.portalAreaId !== cur.id && !cur.is_town_area) state.portalAreaId = cur.id;
          const portalArea = state.portalAreaId ? Areas[state.portalAreaId] : null;
          if (!portalArea) { tokens.push({ k: 'portal', v: 'Portal' }); break; }
          if (cur.id === portalArea.id && cur.parent_town_area_id) {
            transition(state, Areas[cur.parent_town_area_id]);
          } else if (cur.id === portalArea.parent_town_area_id) {
            transition(state, portalArea);
            state.portalAreaId = null;
          }
          tokens.push({ k: 'portal', v: `Portal to ${areaName(state.currentAreaId)}`, id: state.currentAreaId });
        }
        break;
      }
      case 'quest': {
        const q = Quests[p[1]];
        if (!q) { state.warnings.push(`unknown quest ${p[1]}`); break; }
        const offers = p.length > 2 ? p.slice(2) : Object.keys(q.reward_offers);
        quests.push({ questId: q.id, offers });
        tokens.push({ k: 'quest', v: q.name, id: q.id });
        break;
      }
      case 'quest_text': tokens.push({ k: 'qitem', v: p[1] }); break;
      case 'generic': tokens.push({ k: 'generic', v: p[1] }); break;
      case 'reward_quest': tokens.push({ k: 'generic', v: p[1] }); break;
      case 'reward_vendor': tokens.push({ k: 'generic', v: p[1] }); break;
      case 'trial': tokens.push({ k: 'trial', v: 'Labyrinth Trial' }); break;
      case 'ascend': {
        tokens.push({ k: 'ascend', v: `${p[1][0].toUpperCase()}${p[1].slice(1)} Labyrinth` });
        transition(state, Areas[state.lastTownAreaId]);
        break;
      }
      case 'crafting': {
        const a = Areas[p[1] || state.currentAreaId];
        const recipes = a ? a.crafting_recipes : [];
        tokens.push({ k: 'craft', v: 'crafting recipe', recipes });
        break;
      }
      case 'dir': {
        const d = ((parseFloat(p[1]) % 360) + 360) % 360;
        tokens.push({ k: 'dir', v: DIRS[Math.floor(d / 45)] });
        break;
      }
      // search strings keep their "|" alternations
      case 'copy': tokens.push({ k: 'copy', v: p.slice(1).join('|') }); break;
      default: tokens.push({ k: 'text', v: `{${m[1]}}` });
    }
  }
  // collapse whitespace-only text tokens at ends
  while (tokens.length && tokens[0].k === 'text' && !tokens[0].v.trim()) tokens.shift();
  while (tokens.length && tokens[tokens.length - 1].k === 'text' && !tokens[tokens.length - 1].v.trim()) tokens.pop();
  return { tokens, quests };
}

/**
 * Parse route sources into a flat list of steps.
 * @param {string[]} sources  route files (one per act)
 * @param {{leagueStart:boolean, library:boolean, bandit:string}} opts
 */
function parseRoute(sources, opts = {}) {
  const defines = [];
  if (opts.leagueStart !== false) defines.push('LEAGUE_START');
  if (opts.library !== false) defines.push('LIBRARY');
  const bandit = (opts.bandit || 'None').toLowerCase();
  defines.push({ none: 'BANDIT_KILL', kill: 'BANDIT_KILL', alira: 'BANDIT_ALIRA', oak: 'BANDIT_OAK', kraityn: 'BANDIT_KRAITYN' }[bandit] || 'BANDIT_KILL');

  const state = initialState(defines);
  const steps = [];
  const sections = [];
  let sectionName = 'Act 1';
  const cond = [];
  let prev = null;
  let maxLevel = 1;
  let stageHint = null; // "#stage Title": steps from here on show that build stage (if the level allows)

  for (const src of sources) {
    for (const rawLine of src.split(/\r\n|\r|\n/)) {
      if (!rawLine.trim()) continue;
      const line = rawLine.replace(/\t/g, '    ');
      const t = line.trim();
      let m;
      if ((m = /^#section\s*(.*)/.exec(t))) {
        sectionName = m[1] || 'Default';
        sections.push({ name: sectionName, firstStep: steps.length });
        continue;
      }
      if ((m = /^#chapter\s+(.+)/.exec(t))) {
        if (!cond.every(Boolean)) continue;
        const name = m[1].trim();
        const id = `chapter:${name}`;
        Chapters[id] = { id, name, act: CHAPTER_ACT, is_town_area: false, chapter: true };
        state.currentAreaId = id;
        continue;
      }
      if ((m = /^#stage\s+(.+)/.exec(t))) {
        if (cond.every(Boolean)) stageHint = m[1].trim();
        continue;
      }
      if (/^#endif/.test(t)) { cond.pop(); continue; }
      if ((m = /^#ifdef\s+(\S+)/.exec(t))) { cond.push(state.defines.has(m[1])); continue; }
      if ((m = /^#ifndef\s+(\S+)/.exec(t))) { cond.push(!state.defines.has(m[1])); continue; }
      const active = cond.every(Boolean);
      if (!active) continue;

      if ((m = /^#sub\s*(.*)/.exec(t))) {
        if (!prev) continue;
        const { tokens } = parseFragments(m[1], state);
        if (tokens.length) prev.subs.push(tokens);
        continue;
      }
      if (t.startsWith('#')) continue;

      const areaBefore = state.currentAreaId;
      const { tokens, quests } = parseFragments(t, state);
      if (!tokens.length) continue;
      const area = Areas[areaBefore] || Chapters[areaBefore];
      if (area && !area.is_town_area && area.level) maxLevel = Math.max(maxLevel, area.level);
      const step = {
        index: steps.length,
        section: sectionName,
        sectionIndex: Math.max(0, sections.length - 1),
        areaId: areaBefore,
        areaName: area ? area.name : areaBefore,
        isTown: !!(area && area.is_town_area),
        act: area ? area.act : 0,
        progressLevel: maxLevel,
        chapter: !!(area && area.chapter),
        stageHint,
        tokens,
        subs: [],
        quests,
        segment: 0,
        gems: [],
        notes: [],
      };
      steps.push(step);
      prev = step;
    }
  }

  // segments: consecutive steps in the same area
  const segments = [];
  for (const s of steps) {
    const last = segments[segments.length - 1];
    if (!last || last.areaId !== s.areaId) {
      segments.push({ index: segments.length, areaId: s.areaId, firstStep: s.index, lastStep: s.index });
    } else last.lastStep = s.index;
    s.segment = segments.length - 1;
  }

  return { steps, sections, segments, warnings: state.warnings };
}

module.exports = { parseRoute, parseFragments, areaName, Chapters, DIRS };
