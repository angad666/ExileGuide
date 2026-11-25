'use strict';
// Downloads NeverSink's filter at a given strictness (default 5-UBER-STRICT, newest release) straight from
// NeverSink's GitHub repo and saves it as filter/base-<type>.filter (e.g. filter/base-uberstrict.filter).
// Nothing from this PC goes into it: no FilterBlade export, no build block. build-filter.js then writes it
// to the game folder ("Build Loot Filter UberStrict.cmd" does both).
//
//   node tools/build-strict-base.js [--type 5-UBER-STRICT] [--to <tag>] [--out <file>] [--dry]
//
// Optional, off by default: --port carries Tytykiller's FilterBlade changes from filter/base.filter over to it
// (the same three-way merge "Update Loot Filter.cmd" uses; Show/Hide still follows the stricter filter).
//   --extras leveling|all|none (with --port): which of his extra FilterBlade rules to keep. "leveling" (default)
//   keeps Hide rules and Show rules limited to levelling; his other Show rules fire in maps too (all rings and
//   amulets, rare armour, low orbs, 3-4 link colours) and would undo the strictness.
const fs = require('fs');
const path = require('path');
const { parse, port } = require('./update-base-filter');

const ROOT = path.join(__dirname, '..');
const BASE = path.join(ROOT, 'filter', 'base.filter');
const REPO = 'NeverSinkDev/NeverSink-Filter';

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'ExileGuide-filter-updater' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
const raw = (tag, type) => `https://raw.githubusercontent.com/${REPO}/${encodeURIComponent(tag)}/${encodeURIComponent(`NeverSink's filter - ${type}.filter`).replace(/'/g, '%27')}`;
const header = (text, field) => ((text.match(new RegExp(`^# ${field}:\\s*(.+?)\\s*$`, 'm')) || [])[1] || '');
const hides = (text) => parse(text).filter((b) => b.kind === 'rule' && !b.disabled && /^Hide\b/.test(b.lines[0])).length;

function portTytykiller(baseText, theirsText, ours, extras) {
  const levelGated = (b) => b.lines.some((l) => { const m = /(AreaLevel|ItemLevel|DropLevel)\s*(<=|<)\s*(\d+)/.exec(l); return m && +m[3] < 68; });
  const keepExtra = (b) => extras === 'all' || (extras !== 'none' && (/^Hide\b/.test(b.lines[1] || '') || levelGated(b)));
  const blocks = parse(ours);
  const dropped = blocks.filter((b) => b.kind === 'cond' && !keepExtra(b)).length;
  ours = blocks.filter((b) => b.kind !== 'cond' || keepExtra(b)).map((b) => b.lines.join('\n')).join('\n');
  if (dropped) console.log(`  ${dropped} of Tytykiller's extra rules dropped (--extras ${extras})`);
  const { text, report, log } = port(baseText, ours, theirsText);
  console.log(`  ${report.edited} of Tytykiller's edited rules carried over (${report.switchedOff.length} switched off), ${report.conds} extra FilterBlade rules`);
  for (const m of report.moved) console.log('  moved: ' + m);
  if (report.lost.length) console.log(`  edits lost: ${report.lost.join(', ')}`);
  if (log.length) { console.log(`  ${log.length} lines changed by both:`); for (const l of log) console.log('    ' + l.slice(0, 220)); }
  return text;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
  const type = opt('--type', '5-UBER-STRICT').toUpperCase();
  const short = type.replace(/^\d-/, '').replace(/-/g, '').toLowerCase(); // 5-UBER-STRICT -> uberstrict
  const out = opt('--out', path.join(ROOT, 'filter', `base-${short}.filter`));
  const to = opt('--to') || JSON.parse(await get(`https://api.github.com/repos/${REPO}/releases/latest`)).tag_name;

  const url = raw(to, type);
  const theirsText = (await get(url)).replace(/^﻿/, '');
  if (header(theirsText, 'TYPE') !== type) throw new Error(`downloaded ${type} file says type ${header(theirsText, 'TYPE')}`);
  if (header(theirsText, 'VERSION') !== to) throw new Error(`downloaded ${to} file says version ${header(theirsText, 'VERSION')}`);
  console.log(`Downloaded NeverSink ${to} ${type} from ${url}`);

  let text = theirsText;
  if (args.includes('--port')) {
    const ours = fs.readFileSync(BASE, 'utf8');
    const from = header(ours, 'VERSION');
    const fromType = header(ours, 'TYPE');
    if (!from || !fromType) throw new Error('filter/base.filter has no VERSION / TYPE header');
    console.log(`  --port: carrying Tytykiller's changes over from filter/base.filter (NeverSink ${from} ${fromType})`);
    const baseText = await get(raw(from, fromType));
    if (header(baseText, 'VERSION') !== from) throw new Error(`downloaded ${from} file says version ${header(baseText, 'VERSION')}`);
    text = portTytykiller(baseText, theirsText, ours, opt('--extras', 'leveling'));
  }
  console.log(`  ${hides(text)} Hide rules (plain NeverSink ${type}: ${hides(theirsText)})`);
  if (args.includes('--dry')) return;
  fs.writeFileSync(out, text);
  console.log(`Wrote ${path.relative(ROOT, out)}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
