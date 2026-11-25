'use strict';
// Adds "valuable Tier 1 base" rules to a NeverSink filter, from poe.ninja base prices by item level:
//   - the bases are NeverSink's own Tier 1 crafting list, read from the filter (every $type->crafting->generalgear
//     $tier->t1_<ilvl> rule, also the ones a strictness switches off), so they follow his updates;
//   - a base is shown at an item level when poe.ninja's price for a plain (not influenced) copy at that level is
//     at least --min chaos (default 10) with --listings or more listings (default 10);
//   - i86 copies that are worth clearly more than the best lower copy (--premium x, default 1.5) get a premium
//     style (sound, beam, bigger icon). Lower copies, and i86 copies not worth more, get the standard style.
//   poe.ninja only tracks item levels 82-86, so lower copies are only shown from 82 up.
// Tier 1 = NeverSink's crafting t1_<ilvl> lists and his exotic bases t1 list.
// The rest of the bases are hidden: NeverSink's rules that show an item for its base alone (crafting tiers,
// exotic bases t1-t4 and i84-86) are switched off, so those items fall through to his own hide rules.
// Items shown for their mods (fractured, influenced, unidentified item tier, memory strands, enchanted,
// corrupted, identified mod rules) keep his rules. --keep-rest leaves his base-only rules on.
// The new rules go just before NeverSink's crafting base rules, after his influenced / fractured / exotic-mod
// rules, so those special items keep his styles.
// Unidentified item tier 4-5 gear is limited to his best bases (see bestBaseTiered; --keep-tiered turns that off).
//
//   node tools/base-rules.js --in <filter> --out <filter> [--league <name>] [--min 10] [--listings 10] [--premium 1.5] [--keep-rest] [--keep-tiered] [--dry]
const fs = require('fs');
const path = require('path');

const UA = { 'User-Agent': 'ExileGuide-filter-economy' };
const STANDARD = ['SetFontSize 40', 'SetTextColor 255 255 255 255', 'SetBorderColor 200 200 0 255', 'SetBackgroundColor 60 60 0 230', 'MinimapIcon 2 Yellow Diamond'];
const PREMIUM = ['SetFontSize 45', 'SetTextColor 0 0 0 255', 'SetBorderColor 0 0 0 255', 'SetBackgroundColor 220 220 0 255', 'PlayAlertSound 3 300', 'PlayEffect Yellow', 'MinimapIcon 1 Yellow Diamond'];

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
  const inp = opt('--in');
  const out = opt('--out', inp);
  if (!inp) throw new Error('--in <filter> is required');
  const league = opt('--league') || await require('./economy-update').currentLeague();
  const MIN = +opt('--min', 10);
  const LISTINGS = +opt('--listings', 10);
  const PREM = +opt('--premium', 1.5);

  const lines = fs.readFileSync(inp, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
  // NeverSink's Tier 1 base lists: crafting t1_<ilvl> and exotic bases t1
  const t1 = new Set();
  let firstCraft = -1;
  const isT1 = (h) => /\$type->crafting->generalgear\s+\$tier->t1_\d+/.test(h) || /\$type->exoticbases\s+\$tier->t1\b/.test(h);
  // NeverSink's rules that show an item for its base alone (no mod / fracture / item-tier condition):
  // switched off unless --keep-rest, so bases that fail the price test fall through to his hide rules
  const baseOnly = (h) => /\$type->crafting->generalgear\s+\$tier->/.test(h) || /\$type->exoticbases\s+\$tier->(t\d|v8\d|stygian86)\b/.test(h);
  const switchedOff = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^#?(Show|Hide)\b/.test(lines[i])) continue;
    if (/\$type->crafting->generalgear\s+\$tier->/.test(lines[i]) && firstCraft < 0) firstCraft = i;
    if (isT1(lines[i])) {
      for (let j = i + 1; j < lines.length && lines[j].trim() !== ''; j++) {
        if (/^#?\s*BaseType\s*==/.test(lines[j])) for (const m of lines[j].matchAll(/"([^"]+)"/g)) t1.add(m[1]);
      }
    }
    if (baseOnly(lines[i]) && /^Show\b/.test(lines[i]) && !args.includes('--keep-rest')) {
      switchedOff.push((lines[i].match(/\$type->\S+\s+\$tier->\S+/) || [lines[i]])[0]);
      for (let j = i; j < lines.length && lines[j].trim() !== ''; j++) lines[j] = '#' + lines[j];
    }
  }
  if (!t1.size || firstCraft < 0) throw new Error("no NeverSink Tier 1 base rules found in the filter");
  if (switchedOff.length) console.log(`Switched off ${switchedOff.length} of NeverSink's base-only rules (the rest of the bases are hidden): ${switchedOff.join(', ')}`);
  if (!args.includes('--keep-tiered')) bestBaseTiered(lines);

  const url = `https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(league)}&type=BaseType`;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const price = new Map(); // base -> Map(ilvl -> chaos), plain copies with enough listings
  for (const l of (await r.json()).lines || []) {
    if (!t1.has(l.name) || l.variant || (l.listingCount || 0) < LISTINGS) continue;
    if (!price.has(l.name)) price.set(l.name, new Map());
    price.get(l.name).set(l.levelRequired, l.chaosValue);
  }

  const premium = []; // i86 worth more than lower copies
  const std86 = []; // i86 worth it, not clearly more
  const lower = new Map(); // from-ilvl -> bases (shown at from..85)
  const report = [];
  for (const b of [...t1].sort()) {
    const raw = price.get(b) || new Map();
    // a level poe.ninja has no listings for takes the nearest lower tracked level's price (a higher item level is
    // never worth less); levels below the lowest tracked one take that one's price
    const p = new Map();
    if (raw.size) {
      const tracked = [...raw.keys()].sort((x, y) => x - y);
      let last = raw.get(tracked[0]);
      for (let L = 82; L <= 86; L++) { if (raw.has(L)) last = raw.get(L); p.set(L, last); }
    }
    const p86 = p.get(86);
    // lowest level L such that every tracked level from L to 85 is worth MIN
    let from = null;
    for (let L = 85; L >= 82; L--) {
      if (!p.has(L)) continue;
      if (p.get(L) >= MIN) from = L; else break;
    }
    const bestLower = Math.max(0, ...[82, 83, 84, 85].filter((L) => p.has(L)).map((L) => p.get(L)));
    const fmt = [...raw].sort((a, c) => a[0] - c[0]).map(([L, c]) => `i${L} ${c}c`).join(', ') || 'no poe.ninja data';
    if (p86 != null && p86 >= MIN) {
      if (p86 >= PREM * bestLower) { premium.push(b); report.push(`PREMIUM i86  ${b}  (${fmt})`); } else { std86.push(b); report.push(`i86          ${b}  (${fmt})`); }
    }
    if (from != null) {
      if (!lower.has(from)) lower.set(from, []);
      lower.get(from).push(b);
      report.push(`${from === 82 ? 'any-85     ' : `i${from}-85      `} ${b}  (${fmt})`);
    }
    if ((p86 == null || p86 < MIN) && from == null) report.push(`hidden       ${b}  (${fmt})`);
  }

  const q = (list) => list.map((n) => `"${n}"`).join(' ');
  const stamp = new Date().toISOString().slice(0, 10);
  const rule = (name, conds, style) => [`Show # $type->valuablebases $tier->${name}`, '\tMirrored False', '\tCorrupted False', ...conds.map((c) => '\t' + c), ...style.map((s) => '\t' + s), ''];
  const block = [
    '#===============================================================================================================',
    `# VALUABLE TIER 1 BASES: NeverSink's Tier 1 crafting bases worth ${MIN}c+ on poe.ninja ${league} (${stamp}), by item level.`,
    `# Yellow on black = worth ${MIN}c+. Black on yellow + sound + beam = i86 copy worth ${PREM}x+ its lower copies.`,
    '# Made by ExileGuide tools/base-rules.js; run "Build Loot Filter UberStrict.cmd" again to refresh.',
    '#===============================================================================================================',
  ];
  if (premium.length) block.push(...rule('i86premium', ['ItemLevel >= 86', 'Rarity Normal Magic Rare', `BaseType == ${q(premium)}`], PREMIUM));
  if (std86.length) block.push(...rule('i86', ['ItemLevel >= 86', 'Rarity Normal Magic Rare', `BaseType == ${q(std86)}`], STANDARD));
  for (const [from, list] of [...lower].sort((a, c) => a[0] - c[0])) {
    // from 82 = every tracked level qualifies: no lower item-level bound (poe.ninja tracks nothing below 82)
    block.push(...rule(from === 82 ? 'anyto85' : `i${from}to85`, [...(from === 82 ? [] : [`ItemLevel >= ${from}`]), 'ItemLevel <= 85','Rarity Normal Magic Rare', `BaseType == ${q(list.sort())}`], STANDARD));
  }
  lines.splice(firstCraft, 0, ...block);

  const at = lines.findIndex((l) => /^#\s*BUILDNOTES:/.test(l));
  const n = premium.length + std86.length + [...lower.values()].reduce((s, l) => s + l.length, 0);
  lines.splice(at < 0 ? 0 : at + 1, 0, `# BASES:    ${n} valuable Tier 1 base rules (${MIN}c+, poe.ninja ${league} ${stamp}; ExileGuide tools/base-rules.js)`);
  console.log(`NeverSink Tier 1 bases: ${t1.size}; ${premium.length} i86 premium, ${std86.length} i86 standard, ${[...lower.values()].flat().length} below i86`);
  for (const l of report) console.log('  ' + l);
  const rep = opt('--report');
  if (rep) fs.writeFileSync(rep, [`poe.ninja ${league} ${stamp}, min ${MIN}c, ${LISTINGS}+ listings, premium ${PREM}x`, ...report, ''].join('\n'));
  if (args.includes('--dry')) return;
  fs.writeFileSync(out, lines.join('\r\n'));
  console.log(`Wrote ${path.relative(process.cwd(), out)}`);
}

// Unidentified item tier 4-5 gear (the in-game "Tier N" on unidentified items) only shows on the best bases:
// NeverSink's rank 1 bases (his t5r1 / t4r1 list) and, for exotic bases, his exotic bases t1 list.
//   - t5r1, t4r1 stay on;
//   - t5r2, t4r2 (second-rank bases; t4r2 is "tier >= 4", so it would show tier 5 too) and any5 (any base) are
//     switched off;
//   - exoticstiered (tier 5 on any exotic base) keeps only the exotic t1 bases.
// Fractured / veiled tiered items and jewels / flasks / heist gear (no base ranking) keep his rules.
// --keep-tiered leaves all of this as NeverSink has it.
function bestBaseTiered(lines) {
  const header = (re) => lines.findIndex((l) => /^#?(Show|Hide)\b/.test(l) && re.test(l));
  const off = [];
  for (const tier of ['t5r2', 't4r2', 'any5']) {
    const i = header(new RegExp(`\\$type->gear->tiered\\s+\\$tier->${tier}\\b`));
    if (i < 0) throw new Error(`NeverSink's tiered gear rule ${tier} not found; check the filter or run with --keep-tiered`);
    if (!/^Show\b/.test(lines[i])) continue;
    for (let j = i; j < lines.length && lines[j].trim() !== ''; j++) lines[j] = '#' + lines[j];
    off.push(tier);
  }
  const bases = (re) => {
    const i = header(re);
    if (i < 0) return null;
    for (let j = i + 1; j < lines.length && lines[j].trim() !== ''; j++) if (/^#?\s*BaseType\s*==/.test(lines[j])) return { i, j, list: [...lines[j].matchAll(/"([^"]+)"/g)].map((m) => m[1]) };
    return null;
  };
  const r1 = bases(/\$type->gear->tiered\s+\$tier->t5r1\b/);
  const ex1 = bases(/\$type->exoticbases\s+\$tier->t1\b/);
  const ext = bases(/\$type->exoticbases\s+\$tier->exoticstiered\b/);
  if (!r1 || !ex1 || !ext) throw new Error("NeverSink's best-base (t5r1, exotic t1) or exotic tiered rule not found; run with --keep-tiered");
  const best = new Set(ex1.list);
  const keep = ext.list.filter((b) => best.has(b));
  lines[ext.j] = lines[ext.j].replace(/BaseType\s*==.*/, `BaseType == ${keep.map((n) => `"${n}"`).join(' ')}`);
  console.log(`Unidentified tier 4-5 gear only on the best bases: ${r1.list.length} rank 1 bases, ${keep.length} of ${ext.list.length} exotic bases; switched off ${off.join(', ') || 'nothing (already off)'}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
