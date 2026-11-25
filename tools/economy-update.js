'use strict';
// Re-tiers a NeverSink filter by today's poe.ninja prices, PROMOTION ONLY:
//   - tier thresholds come from NeverSink's own tiers: a tier's threshold is the median current price of the
//     items he put in it, so the scale stays his;
//   - an item moves up to the highest tier whose threshold its price reaches, if that is also at least 1.5x
//     its current tier's median (no churn on borderline items) and the price is reliable (trade volume or
//     listings). Items in hidden tiers (Hide, or a switched-off Show) can move up into shown tiers this way;
//   - nothing is ever moved down or hidden, so a wrong price can't hide a valuable drop.
// Stackable sections are priced from poe.ninja's exchange (currency, fragments, div cards, oils, fossils, ...).
// Unique sections are priced per base type from the stash API, by the CHEAPEST unique on that base
// (Foulborn and linked variants left out): a base only moves when every unique on it is worth it.
//
//   node tools/economy-update.js --in <filter> --out <filter> [--league <name>] [--report <file>] [--dry]
// Default league: poe.ninja's current challenge league.
const fs = require('fs');
const path = require('path');

const NINJA = 'https://poe.ninja/poe1/api/economy';
const UA = { 'User-Agent': 'ExileGuide-filter-economy' };
const EXCHANGE = ['Currency', 'Fragment', 'DivinationCard', 'Scarab', 'Essence', 'Oil', 'Fossil', 'Omen', 'Tattoo',
  'AllflameEmber', 'Artifact', 'DeliriumOrb', 'Astrolabe', 'Resonator', 'Wombgift', 'Incubator'];
const UNIQUES = ['UniqueWeapon', 'UniqueArmour', 'UniqueAccessory', 'UniqueFlask', 'UniqueJewel'];

// sections ($type) re-tiered, and which price source they use
const STACK_SECTIONS = ['currency', 'currency->deliriumorbs', 'currency->fossil', 'currency->oil', 'currency->essence',
  'currency->trial->omen', 'currency->trial->tattoo', 'currency->ducats', 'fragments', 'divination', 'runesgrafts',
  'exotic->wombgifts', 'artefact->misc'];
const UNIQUE_SECTIONS = ['uniques'];
const MIN_VOLUME = 100; // exchange: chaos traded per day
const MIN_LISTINGS = 10; // stash: listings per unique
const STEP = 1.5;
const MIN_UNHIDE = 5; // chaos: an item in a hidden tier is only shown if it is worth at least this
const NOT_VALUE_TIER = /boss/; // tiers that group by source (boss drops), not by price

async function getJson(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// the current softcore trade league, from GGG's public trade league list (first PC league that isn't
// Standard / Hardcore / Ruthless / SSF)
async function currentLeague() {
  const r = await fetch('https://www.pathofexile.com/api/trade/data/leagues', { headers: UA });
  if (!r.ok) throw new Error(`league list: ${r.status}; pass --league`);
  const l = ((await r.json()).result || []).find((x) => x.realm === 'pc' && !/^(standard|hardcore|ruthless)$|hardcore|ruthless|\bhc\b|ssf/i.test(x.id));
  if (!l) throw new Error('could not find the current league; pass --league');
  return l.id;
}
module.exports = { currentLeague };

async function prices(league) {
  const stack = new Map(); // name -> { chaos, volume }
  const q = (t, kind) => `${NINJA}/${kind}/current/${kind === 'exchange' ? 'overview' : 'item/overview'}?league=${encodeURIComponent(league)}&type=${t}`;
  const ex = await Promise.all(EXCHANGE.map((t) => getJson(q(t, 'exchange')).catch(() => ({ lines: [], items: [] }))));
  for (const d of ex) {
    const name = new Map((d.items || []).map((i) => [i.id, i.name]));
    for (const l of d.lines || []) {
      const n = name.get(l.id);
      if (n && l.primaryValue != null) stack.set(n, { chaos: l.primaryValue, volume: l.volumePrimaryValue || 0 });
    }
  }
  const bases = new Map(); // base type -> [{ name, chaos, listings }]
  const st = await Promise.all(UNIQUES.map((t) => getJson(q(t, 'stash')).catch(() => ({ lines: [] }))));
  for (const d of st) {
    for (const l of d.lines || []) {
      if (!l.baseType || /^Foulborn /.test(l.name) || l.links || /relic/i.test(l.detailsId || '')) continue;
      if (!bases.has(l.baseType)) bases.set(l.baseType, []);
      bases.get(l.baseType).push({ name: l.name, chaos: l.chaosValue, listings: l.listingCount || 0 });
    }
  }
  return { stack, bases };
}

// ---------- filter parsing ----------
function rules(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#?)(Show|Hide|Minimal)\b.*\$type->(\S+)\s+\$tier->(\S+)/.exec(lines[i]);
    if (!m) continue;
    const r = { start: i, off: m[1] === '#', show: m[2] !== 'Hide' && m[1] !== '#', type: m[3], tier: m[4], body: [] };
    let j = i + 1;
    for (; j < lines.length && lines[j].trim() !== ''; j++) r.body.push(j);
    r.end = j;
    r.cond = r.body.map((k) => lines[k].replace(/^#/, '').trim());
    const bt = r.body.find((k) => /^#?\s*BaseType\s*==/.test(lines[k]));
    r.btLine = bt;
    r.names = bt == null ? [] : [...lines[bt].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    out.push(r);
  }
  return out;
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };

function retier(lines, section, priceOf, log) {
  // tier ladder: this section's rules named t<digit>..., no StackSize / extra conditions that split the tier
  const ladder = rules(lines).filter((r) => r.type === section && /^t\d/.test(r.tier) && !NOT_VALUE_TIER.test(r.tier) && r.btLine != null
    && !r.cond.some((c) => /^(StackSize|AreaLevel|ItemLevel|Replica|Foulborn|Corrupted|Mirrored|Identified)\b/.test(c)));
  if (ladder.length < 2) return 0;
  const count = new Map();
  for (const r of ladder) for (const n of r.names) count.set(n, (count.get(n) || 0) + 1);
  const med = ladder.map((r) => {
    const p = r.names.filter((n) => count.get(n) === 1).map(priceOf).filter((x) => x != null);
    return p.length >= 3 ? median(p) : NaN;
  });
  const moves = [];
  ladder.forEach((r, ci) => {
    for (const n of r.names) {
      if (count.get(n) !== 1) continue;
      const p = priceOf(n);
      if (p == null || (!r.show && p < MIN_UNHIDE)) continue;
      let to = -1;
      for (let k = 0; k < ci; k++) if (ladder[k].show && !Number.isNaN(med[k]) && p >= med[k]) { to = k; break; }
      if (to < 0) continue;
      const cur = Number.isNaN(med[ci]) ? 0 : med[ci];
      if (r.show && p < cur * STEP) continue;
      moves.push({ n, from: ci, to, p });
    }
  });
  for (const m of moves) {
    const from = ladder[m.from];
    const to = ladder[m.to];
    from.names = from.names.filter((x) => x !== m.n);
    to.names.push(m.n);
    log.push(`${section}: ${m.n} ${from.tier}${from.show ? '' : ' (hidden)'} -> ${to.tier}  (${m.p.toFixed(1)}c, ${to.tier} median ${med[m.to].toFixed(1)}c)`);
  }
  for (const r of ladder) {
    const pre = (lines[r.btLine].match(/^(#?\s*)/) || ['', ''])[1];
    if (r.names.length) lines[r.btLine] = `${pre}BaseType == ${[...r.names].sort().map((n) => `"${n}"`).join(' ')}`;
    else for (let k = r.start; k < r.end; k++) if (!lines[k].startsWith('#')) lines[k] = '#' + lines[k];
  }
  return moves.length;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
  const inp = opt('--in');
  const out = opt('--out', inp);
  if (!inp) throw new Error('--in <filter> is required');
  const league = opt('--league') || await currentLeague();
  const { stack, bases } = await prices(league);
  console.log(`poe.ninja ${league}: ${stack.size} stackable prices, ${bases.size} unique base types`);

  const stackPrice = (n) => { const s = stack.get(n); return s && s.volume >= MIN_VOLUME ? s.chaos : null; };
  const uniquePrice = (b) => {
    const u = bases.get(b);
    if (!u || !u.length || u.some((x) => x.listings < MIN_LISTINGS)) return null;
    return Math.min(...u.map((x) => x.chaos));
  };

  const text = fs.readFileSync(inp, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  const log = [];
  let total = 0;
  for (const s of STACK_SECTIONS) total += retier(lines, s, stackPrice, log);
  for (const s of UNIQUE_SECTIONS) total += retier(lines, s, uniquePrice, log);

  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const at = lines.findIndex((l) => /^#\s*BUILDNOTES:/.test(l));
  lines.splice(at < 0 ? 0 : at + 1, 0, `# ECONOMY:  ${total} items promoted by poe.ninja ${league} prices on ${stamp} UTC (ExileGuide tools/economy-update.js; promotion only)`);
  console.log(`  ${total} items promoted (nothing moved down):`);
  for (const l of log) console.log('    ' + l);
  const report = opt('--report');
  if (report) fs.writeFileSync(report, [`poe.ninja ${league}, ${stamp} UTC, ${total} promotions`, ...log, ''].join('\n'));
  if (args.includes('--dry')) return;
  fs.writeFileSync(out, lines.join('\r\n'));
  console.log(`Wrote ${path.relative(process.cwd(), out)}`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
