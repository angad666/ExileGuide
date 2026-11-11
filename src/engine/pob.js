'use strict';
// Path of Building import: decodes a PoB code (or pobb.in / pastebin link) into a build profile.
// Skill sets and item sets become stages; their titles' level numbers become stage levels.
const zlib = require('zlib');
const { findGem, mapGemId, Gems } = require('./data');

function decodePobCode(code) {
  const clean = code.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const buf = Buffer.from(clean, 'base64');
  return zlib.inflateSync(buf).toString('utf8');
}

// Resolve links to raw PoB codes.
async function fetchPobCode(input) {
  const s = input.trim();
  let url = null;
  let m;
  if ((m = /pobb\.in\/(?:u\/[^/]+\/)?([\w-]+)/.exec(s))) url = `https://pobb.in/${m[1]}/raw`;
  else if ((m = /pastebin\.com\/(?:raw\/)?(\w+)/.exec(s))) url = `https://pastebin.com/raw/${m[1]}`;
  else if ((m = /poe\.ninja\/(?:poe1\/)?pob\/(\w+)/.exec(s))) url = `https://poe.ninja/poe1/pob/raw/${m[1]}`;
  if (!url) return s;
  const res = await fetch(url, { headers: { 'User-Agent': 'ExileGuide-overlay' } });
  if (!res.ok) throw new Error(`Could not download ${url} (${res.status})`);
  return (await res.text()).trim();
}

// ---- minimal XML tree parser (PoB XML is simple and well formed) ----
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s) => s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (all, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e] ?? all;
});

function parseXml(xml) {
  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) { top.text += unescape(m[5]); continue; }
    if (!m[2]) continue;
    if (m[1] === '/') { if (stack.length > 1) stack.pop(); continue; }
    const attrs = {};
    const ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = ar.exec(m[3])) !== null) attrs[a[1]] = unescape(a[2] ?? a[3]);
    const node = { tag: m[2], attrs, children: [], text: '' };
    top.children.push(node);
    if (m[4] !== '/') stack.push(node);
  }
  return root;
}
const kids = (n, tag) => n.children.filter((c) => c.tag === tag);
function find(n, tag) {
  for (const c of n.children) {
    if (c.tag === tag) return c;
    const r = find(c, tag);
    if (r) return r;
  }
  return null;
}
function findAll(n, tag, out = []) {
  for (const c of n.children) { if (c.tag === tag) out.push(c); findAll(c, tag, out); }
  return out;
}

const clean = (s) => (s || '').replace(/\^(x[0-9a-fA-F]{6}|[0-9])/g, '').trim();

// "lvl 1-12" -> {from:1,to:12}; "61 Crit Swap" -> {from:61}; "Midgame" -> {}
function parseLevels(title) {
  const t = clean(title);
  let m = /(\d{1,3})\s*(?:-|–|to)\s*(\d{1,3})/.exec(t);
  if (m) return { from: +m[1], to: +m[2] };
  m = /(?:^|\D)(\d{1,3})(?:\D|$)/.exec(t);
  if (m && +m[1] <= 100) return { from: +m[1] };
  return {};
}

const SLOT_ORDER = ['Weapon 1', 'Weapon 2', 'Helmet', 'Body Armour', 'Gloves', 'Boots', 'Amulet', 'Ring 1', 'Ring 2', 'Belt',
  'Flask 1', 'Flask 2', 'Flask 3', 'Flask 4', 'Flask 5'];

function parseItemText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const item = { rarity: 'NORMAL', name: '', base: '', sockets: '', levelReq: null, mods: [], implicits: [] };
  let i = 0;
  const r = /^Rarity:\s*(\w+)/.exec(lines[0] || '');
  if (r) { item.rarity = r[1].toUpperCase(); i = 1; }
  item.name = lines[i++] || '';
  if (item.rarity === 'RARE' || item.rarity === 'UNIQUE' || item.rarity === 'RELIC') {
    if (lines[i] && !/^[\w ]+:/.test(lines[i])) item.base = lines[i++];
  } else item.base = item.name;
  let implicitsLeft = -1;
  for (; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if ((m = /^Sockets:\s*(.+)/.exec(l))) { item.sockets = m[1]; continue; }
    if ((m = /^LevelReq:\s*(\d+)/.exec(l))) { item.levelReq = +m[1]; continue; }
    if ((m = /^Implicits:\s*(\d+)/.exec(l))) { implicitsLeft = +m[1]; continue; }
    if (implicitsLeft < 0) continue; // header properties
    const mod = l.replace(/\{[^}]*\}/g, '').trim();
    if (!mod) continue;
    if (implicitsLeft > 0) { item.implicits.push(mod); implicitsLeft--; } else item.mods.push(mod);
  }
  return item;
}

function socketSummary(s) {
  if (!s) return '';
  const groups = s.split(' ');
  const biggest = Math.max(...groups.map((g) => g.split('-').length));
  const total = s.replace(/[^A-Za-z]/g, '').length;
  return biggest > 1 ? `${total}S ${biggest}L` : `${total}S`;
}

/** Convert PoB XML into a build profile. */
function pobXmlToBuild(xml, opts = {}) {
  const doc = parseXml(xml);
  const buildEl = find(doc, 'Build');
  if (!buildEl) throw new Error('Not a Path of Building export (no <Build> element).');
  const cls = buildEl.attrs.className;
  const asc = buildEl.attrs.ascendClassName && buildEl.attrs.ascendClassName !== 'None' ? buildEl.attrs.ascendClassName : '';
  const bandit = buildEl.attrs.bandit || 'None';

  // ---- skills ----
  const skillsEl = find(doc, 'Skills');
  let skillSets = skillsEl ? kids(skillsEl, 'SkillSet') : [];
  if (!skillSets.length && skillsEl) skillSets = [{ attrs: { title: 'Default' }, children: skillsEl.children }];
  const stageMap = new Map(); // title -> stage
  const stages = [];
  const getStage = (title) => {
    const t = clean(title) || 'Default';
    if (!stageMap.has(t)) {
      const st = { title: t, ...parseLevels(t), tree: '', links: [], gear: [], notes: [] };
      stageMap.set(t, st);
      stages.push(st);
    }
    return stageMap.get(t);
  };

  const unknownGems = new Set();
  for (const set of skillSets) {
    const stage = getStage(set.attrs.title);
    for (const sk of kids(set, 'Skill')) {
      if (sk.attrs.enabled === 'false') continue;
      const actives = [];
      const supports = [];
      for (const gEl of kids(sk, 'Gem')) {
        if (gEl.attrs.enabled === 'false') continue;
        const gid = gEl.attrs.gemId ? mapGemId(gEl.attrs.gemId) : null;
        const g = (gid && Gems[gid]) || findGem(gEl.attrs.nameSpec);
        if (!g) { if (gEl.attrs.nameSpec) unknownGems.add(gEl.attrs.nameSpec); continue; }
        (g.is_support ? supports : actives).push(g.name);
      }
      if (!actives.length && !supports.length) continue;
      const label = clean(sk.attrs.label) || (actives[0] || supports[0]);
      const slot = sk.attrs.slot || '';
      stage.links.push({ label, gems: [...actives, ...supports], slot });
    }
  }

  // ---- items ----
  const itemsEl = find(doc, 'Items');
  const items = new Map();
  if (itemsEl) {
    for (const it of kids(itemsEl, 'Item')) items.set(it.attrs.id, parseItemText(it.text));
    let itemSets = kids(itemsEl, 'ItemSet');
    if (!itemSets.length) itemSets = [{ attrs: { title: stages[0]?.title || 'Default' }, children: kids(itemsEl, 'Slot') }];
    for (const set of itemSets) {
      const stage = getStage(set.attrs.title);
      const slots = kids(set, 'Slot').filter((s) => s.attrs.itemId && s.attrs.itemId !== '0' && SLOT_ORDER.includes(s.attrs.name));
      slots.sort((a, b) => SLOT_ORDER.indexOf(a.attrs.name) - SLOT_ORDER.indexOf(b.attrs.name));
      for (const s of slots) {
        const it = items.get(s.attrs.itemId);
        if (!it) continue;
        const slotName = { 'Weapon 1': 'Weapon', 'Weapon 2': 'Offhand', 'Ring 1': 'Ring', 'Flask 1': 'Flask 1' }[s.attrs.name] || s.attrs.name;
        stage.gear.push({
          slot: slotName,
          rarity: it.rarity.toLowerCase(),
          name: /^new item$/i.test(it.name) || !it.name ? it.base : it.name,
          base: it.base,
          sockets: socketSummary(it.sockets),
          levelReq: it.levelReq,
          mods: it.mods.slice(0, 6),
        });
      }
    }
  }

  // ---- trees ----
  const treeEl = find(doc, 'Tree');
  if (treeEl) {
    for (const spec of kids(treeEl, 'Spec')) {
      const t = clean(spec.attrs.title) || 'Default';
      const st = stageMap.get(t);
      if (st) st.tree = t;
    }
  }

  // stages without levels: place after the last levelled stage
  let lastFrom = 1;
  for (const st of stages) {
    if (Number.isFinite(st.from)) lastFrom = st.from;
    else st.from = Math.max(lastFrom + 1, 71);
  }
  // keep stages in ascending level order (stable)
  stages.sort((a, b) => a.from - b.from);
  for (let i = 0; i < stages.length; i++) {
    if (!Number.isFinite(stages[i].to)) {
      const next = stages.slice(i + 1).find((s) => s.from > stages[i].from);
      stages[i].to = next ? next.from - 1 : 100;
    }
  }

  const notesEl = find(doc, 'Notes');
  return {
    schema: 1,
    name: opts.name || `${asc || cls} (imported)`,
    class: cls,
    ascendancy: asc,
    bandit: bandit === 'None' ? 'None' : bandit,
    leagueStart: true,
    library: true,
    pantheon: [buildEl.attrs.pantheonMajorGod, buildEl.attrs.pantheonMinorGod].filter((x) => x && x !== 'None').join(' + '),
    source: { pob: opts.source || '' },
    stages,
    extraGems: [],
    gemOverrides: {},
    steps: [],
    milestones: [],
    pobNotes: notesEl ? clean(notesEl.text).slice(0, 4000) : '',
    importWarnings: unknownGems.size ? [`Unknown gems skipped: ${[...unknownGems].join(', ')}`] : [],
  };
}

async function importPob(input, opts = {}) {
  const code = await fetchPobCode(input);
  const xml = code.trim().startsWith('<') ? code : decodePobCode(code);
  return pobXmlToBuild(xml, { source: /^https?:/.test(input.trim()) ? input.trim() : '', ...opts });
}

module.exports = { importPob, decodePobCode, pobXmlToBuild, parseXml, parseItemText, parseLevels, fetchPobCode, findAll };
