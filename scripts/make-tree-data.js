'use strict';
// Builds data/passive-tree.json from GGG's passive tree export
// (https://github.com/grindinggear/skilltree-export, data.json of a tag such as 3.30.0).
// usage: node scripts/make-tree-data.js <path to data.json> <version label>
const fs = require('fs');
const path = require('path');

const [src, version] = process.argv.slice(2);
if (!src) { console.error('usage: make-tree-data.js <data.json> <version>'); process.exit(1); }
const d = JSON.parse(fs.readFileSync(src, 'utf8'));

// type: c class start, k keystone, n notable, m mastery, j jewel socket, s small,
//       A ascendancy start, N ascendancy notable, a ascendancy small
function typeOf(n) {
  if (n.ascendancyName) return n.isAscendancyStart ? 'A' : n.isNotable ? 'N' : 'a';
  if (n.classStartIndex !== undefined) return 'c';
  if (n.isKeystone) return 'k';
  if (n.isNotable) return 'n';
  if (n.isMastery) return 'm';
  if (n.isJewelSocket) return 'j';
  return 's';
}

// '[DamageFaster|Faster]' -> 'Faster', '[Onslaught]' -> 'Onslaught', one line per stat
const statText = (stats) => stats.join('\n').replace(/\[(?:[^\]|]+\|)?([^\]]+)\]/g, '$1').split(/\n/).join(' / ');

const nodes = {};
const masteries = {};
for (const [id, n] of Object.entries(d.nodes)) {
  if (id === 'root' || !n.name) continue;
  const t = typeOf(n);
  const rec = { n: n.name, t, g: n.group ?? null, e: [] };
  if (n.ascendancyName) rec.a = n.ascendancyName;
  if (t === 'c') rec.cls = n.classStartIndex;
  if ('knN'.includes(t) && n.stats) rec.s = statText(n.stats);
  nodes[id] = rec;
  if (t === 'm' && n.masteryEffects) {
    masteries[id] = Object.fromEntries(n.masteryEffects.map((x) => [x.effect, statText(x.stats)]));
  }
}
// edges: both directions, never between the main tree and an ascendancy, never through a class start
// into another class's area (class starts only link to their own neighbours, which is what the export has)
for (const [id, n] of Object.entries(d.nodes)) {
  if (!nodes[id]) continue;
  for (const o of [...(n.out || []), ...(n.in || [])]) {
    if (!nodes[o] || o === id) continue;
    if (!!nodes[id].a !== !!nodes[o].a) continue;
    if (nodes[id].t === 'm' || nodes[o].t === 'm') continue;
    if (!nodes[id].e.includes(o)) nodes[id].e.push(o);
    if (!nodes[o].e.includes(id)) nodes[o].e.push(id);
  }
}
const out = { version: version || 'unknown', source: 'grindinggear/skilltree-export', nodes, masteries };
const file = path.join(__dirname, '..', 'data', 'passive-tree.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log(`${Object.keys(nodes).length} nodes, ${Object.keys(masteries).length} masteries -> ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
