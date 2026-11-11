'use strict';
// Game data loader. Source: exile-leveling (MIT, github.com/HeartofPhos/exile-leveling), 3.29 data.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'exile-leveling');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));

const Areas = read('areas.json');
const Gems = read('gems.json');
const Quests = read('quests.json');
const Characters = read('characters.json');
const KillWaypoints = read('kill-waypoints.json');
const VaalGemLookup = read('vaal-gem-lookup.json');
const AwakenedGemLookup = read('awakened-gem-lookup.json');

function loadRouteSources() {
  const out = [];
  for (let i = 1; i <= 10; i++) {
    out.push(fs.readFileSync(path.join(DATA_DIR, 'routes', `act-${i}.txt`), 'utf8'));
  }
  return out;
}

// Path of Building uses a few gem ids that differ from the game data (copied from exile-leveling).
const GEM_ID_REMAP = {
  'Metadata/Items/Gems/Smite': 'Metadata/Items/Gems/SkillGemSmite',
  'Metadata/Items/Gems/ConsecratedPath': 'Metadata/Items/Gems/SkillGemConsecratedPath',
  'Metadata/Items/Gems/VaalAncestralWarchief': 'Metadata/Items/Gems/SkillGemVaalAncestralWarchief',
  'Metadata/Items/Gems/HeraldOfAgony': 'Metadata/Items/Gems/SkillGemHeraldOfAgony',
  'Metadata/Items/Gems/HeraldOfPurity': 'Metadata/Items/Gems/SkillGemHeraldOfPurity',
  'Metadata/Items/Gems/ScourgeArrow': 'Metadata/Items/Gems/SkillGemScourgeArrow',
  'Metadata/Items/Gems/RainOfSpores': 'Metadata/Items/Gems/SkillGemToxicRain',
  'Metadata/Items/Gems/SummonRelic': 'Metadata/Items/Gems/SkillGemSummonRelic',
  'Metadata/Items/Gems/SkillGemNewPhaseRun': 'Metadata/Items/Gems/SkillGemPhaseRun',
  'Metadata/Items/Gems/SkillGemNewArcticArmour': 'Metadata/Items/Gems/SkillGemArcticArmour',
};

function mapGemId(gemId) {
  if (GEM_ID_REMAP[gemId]) gemId = GEM_ID_REMAP[gemId];
  if (VaalGemLookup[gemId]) gemId = VaalGemLookup[gemId];
  if (AwakenedGemLookup[gemId]) gemId = AwakenedGemLookup[gemId];
  return gemId;
}

// Name lookup: accepts "Volley Support", "Volley", "volley support", PoB nameSpec, or a full id.
const nameIndex = new Map();
for (const g of Object.values(Gems)) {
  const n = g.name.toLowerCase();
  if (!nameIndex.has(n)) nameIndex.set(n, g.id);
}
function findGem(nameOrId) {
  if (!nameOrId) return null;
  if (Gems[nameOrId]) return Gems[nameOrId];
  if (nameOrId.startsWith('Metadata/')) return Gems[mapGemId(nameOrId)] || null;
  const n = nameOrId.toLowerCase().trim();
  const id = nameIndex.get(n) || nameIndex.get(n + ' support') || nameIndex.get(n.replace(/ support$/, ''));
  return id ? Gems[id] : null;
}

// Gem names a vendor could plausibly list; used to make search strings unique.
const vendorNames = Object.values(Gems)
  .map((g) => g.name.toLowerCase())
  .filter((n) => !n.startsWith('vaal ') && !n.startsWith('awakened ') && !n.includes('royale'));

const searchCache = new Map();
// Shortest readable fragment of the gem name (starting at a word, min 5 chars) that no other
// gem name contains. "Spectral Throw" -> "spectral t", "Frostblink" -> "frost".
function gemSearchTerm(gemName) {
  const name = gemName.toLowerCase();
  if (searchCache.has(name)) return searchCache.get(name);
  const others = vendorNames.filter((n) => n !== name);
  const starts = [0];
  for (let i = 1; i < name.length; i++) if (name[i - 1] === ' ') starts.push(i);
  const shortest = (startList) => {
    for (let len = 5; len < name.length; len++) {
      for (const s of startList) {
        if (s + len > name.length) continue;
        const sub = name.slice(s, s + len);
        if (sub.endsWith(' ')) continue;
        if (!others.some((o) => o.includes(sub))) return sub;
      }
    }
    return name;
  };
  // prefer a prefix ("flesh a") unless another word start is much shorter ("intim" vs "intimidating c")
  const prefix = shortest([0]);
  const any = shortest(starts);
  const best = prefix.length <= any.length + 2 ? prefix : any;
  searchCache.set(name, best);
  return best;
}

// Build quoted PoE search strings (max 50 chars each) from gem names.
function searchStrings(names, maxLen = 50) {
  const terms = names.map(gemSearchTerm);
  const out = [];
  let cur = [];
  for (const t of terms) {
    const candidate = '"' + [...cur, t].join('|') + '"';
    if (candidate.length > maxLen && cur.length) {
      out.push('"' + cur.join('|') + '"');
      cur = [t];
    } else cur.push(t);
  }
  if (cur.length) out.push('"' + cur.join('|') + '"');
  return out;
}

// Vendor price by gem required level (campaign vendor prices). 3.30: Orbs of Chance are gone from
// vendors; gems that start at level 28-33 cost an Alteration, 34-37 an Alchemy (was Chance for both).
function gemCost(gem) {
  const lvl = gem.required_level || 1;
  if (lvl < 8) return 'Wisdom';
  if (lvl < 16) return 'Transmute';
  if (lvl < 34) return 'Alteration';
  return 'Alchemy';
}

const CLASSES = Object.keys(Characters);

module.exports = {
  Areas, Gems, Quests, Characters, KillWaypoints, CLASSES,
  loadRouteSources, mapGemId, findGem, gemSearchTerm, searchStrings, gemCost,
};
