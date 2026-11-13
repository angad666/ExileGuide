'use strict';
// Moves filter/base.filter (a FilterBlade export of NeverSink's filter, with Tytykiller's changes) to a newer
// NeverSink version without FilterBlade:
//   1. downloads the plain NeverSink filter the export was made from (same version + strictness),
//   2. works out the export's changes against it (rules switched off, edited lines, FilterBlade's extra
//      "Conditional Entry" rules),
//   3. downloads the newer NeverSink version and applies those changes to it (a three-way merge per rule).
// Where NeverSink and the export both changed the same line, NeverSink's item lists win for uniques
// (economy tiering) and otherwise the export's change wins; every such case is listed.
//
//   node tools/update-base-filter.js [--to <tag>] [--dry]      (default: NeverSink's latest release)
// Afterwards run "Build Loot Filter.cmd". The old base is kept as filter/base-<old version>.filter.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = path.join(ROOT, 'filter', 'base.filter');
const REPO = 'NeverSinkDev/NeverSink-Filter';

// ---------- parsing ----------
const START = /^#?(Show|Hide|Minimal)\b/;

function parse(text) {
  const lines = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    const kind = START.test(l) ? 'rule' : l === '# FilterBlade: Conditional Entry' ? 'cond' : null;
    if (!kind) { blocks.push({ kind: 'text', lines: [l] }); i++; continue; }
    const b = { kind, lines: [] };
    while (i < lines.length && lines[i].trim() !== '') b.lines.push(lines[i++]);
    if (kind === 'rule') {
      b.disabled = l.startsWith('#');
      const type = (l.match(/\$type->(\S+)/) || [])[1] || '';
      const tier = (l.match(/\$tier->(\S+)/) || [])[1] || '';
      b.key = type || tier ? `${type}|${tier}` : l.replace(/^#?/, '').replace(/\s+/g, ' ');
    }
    blocks.push(b);
  }
  return blocks;
}

const header = (text, field) => ((text.match(new RegExp(`^# ${field}:\\s*(.+?)\\s*$`, 'm')) || [])[1] || '');

/** A rule's body as an ordered list of [key, normalized line]. */
function body(rule) {
  const seen = {};
  return rule.lines.slice(1).map((l) => {
    const n = l.replace(/^#/, '').trim();
    const m = n.match(/^(\w+)\s*(==|!=|<=|>=|<|>|=)?/);
    let k = m ? m[1] : n;
    if (k === 'CustomAlertSound' || k === 'PlayAlertSound' || k === 'PlayAlertSoundPositional') k = 'Sound';
    else if (m && m[2] && /[<>]/.test(m[2]) && k !== 'BaseType' && k !== 'Class') k += m[2][0];
    seen[k] = (seen[k] || 0) + 1;
    if (seen[k] > 1) k += '#' + seen[k];
    return [k, n];
  });
}

/** same rule content (FilterBlade rewrites "#Show # ..." as "#Show  # # ..." on switched-off rules) */
const same = (a, b) => a.disabled === b.disabled && body(a).map((x) => x.join('=')).join('\n') === body(b).map((x) => x.join('=')).join('\n');

const names = (line) => [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const listKey = (k) => k === 'BaseType' || k === 'Class';

function mergeRule(base, ours, theirs, log) {
  const B = new Map(body(base));
  const O = new Map(body(ours));
  const T = body(theirs);
  const TM = new Map(T);
  const keys = [...T.map(([k]) => k), ...[...O.keys()].filter((k) => !TM.has(k))];
  const out = [];
  for (const k of keys) {
    const b = B.get(k);
    const o = O.get(k);
    const t = TM.get(k);
    let r;
    if (o === b) r = t;
    else if (t === b) r = o;
    else if (o === t) r = t;
    else if (listKey(k) && b && o && t) {
      if (theirs.key.startsWith('uniques')) { r = t; log.push(`${theirs.key}: ${k} kept NeverSink's new list`); }
      else {
        const nb = new Set(names(b));
        const no = new Set(names(o));
        const drop = new Set([...nb].filter((n) => !no.has(n)));
        const add = [...no].filter((n) => !nb.has(n));
        const list = [...names(t).filter((n) => !drop.has(n)), ...add.filter((n) => !names(t).includes(n))];
        const op = t.match(/^\w+\s*(==)?/)[0];
        r = `${op} ${list.map((n) => `"${n}"`).join(' ')}`;
        log.push(`${theirs.key}: ${k} merged (export's -${drop.size}/+${add.length} applied to NeverSink's new list)`);
      }
    } else { r = o; log.push(`${theirs.key}: "${t ?? '(none)'}" -> export's "${o ?? '(removed)'}"`); }
    if (r !== undefined) out.push(r);
  }
  const disabled = base.disabled !== ours.disabled ? ours.disabled : theirs.disabled;
  const head = theirs.lines[0].replace(/^#/, '');
  return {
    ...theirs,
    disabled,
    lines: [(disabled ? '#' : '') + head, ...out.map((l) => (disabled ? '#\t' : '\t') + l)],
  };
}

function port(baseText, oursText, theirsText) {
  const base = parse(baseText);
  const ours = parse(oursText);
  const theirs = parse(theirsText);
  const rules = (bs) => new Map(bs.filter((b) => b.kind === 'rule').map((b) => [b.key, b]));
  const RB = rules(base);
  const RO = rules(ours);
  const RT = rules(theirs);
  const log = [];
  const report = { edited: 0, switchedOff: [], conds: 0, lost: [], moved: [] };

  // FilterBlade's extra rules, attached to the rule before them
  const conds = new Map();
  let prev = '__top__';
  for (const b of ours) {
    if (b.kind === 'rule') prev = b.key;
    if (b.kind === 'cond') { if (!conds.has(prev)) conds.set(prev, []); conds.get(prev).push(b); report.conds++; }
  }
  // an anchor rule NeverSink removed: use the closest earlier rule that still exists
  const baseOrder = [...RB.keys()];
  const anchorFor = new Map();
  for (const a of conds.keys()) {
    let i = baseOrder.indexOf(a);
    while (i >= 0 && !RT.has(baseOrder[i])) i--;
    const to = i >= 0 ? baseOrder[i] : '__top__';
    anchorFor.set(a, to);
    if (to !== a) report.moved.push(`${conds.get(a).length} extra rule(s) after "${a}" (gone in the new version) now after "${to}"`);
  }
  const insertAfter = new Map();
  for (const [a, list] of conds) {
    const to = anchorFor.get(a);
    if (!insertAfter.has(to)) insertAfter.set(to, []);
    insertAfter.get(to).push(...list);
  }

  // rules the export changed but the new version no longer has
  for (const [k, o] of RO) {
    const b = RB.get(k);
    if (!b || RT.has(k)) continue;
    if (!same(b, o)) report.lost.push(k);
  }

  const out = [];
  const pushConds = (key) => {
    for (const c of insertAfter.get(key) || []) out.push({ kind: 'text', lines: [''] }, c);
  };
  let firstRule = true;
  for (const t of theirs) {
    if (t.kind === 'rule' && firstRule) { firstRule = false; if (insertAfter.has('__top__')) { pushConds('__top__'); out.push({ kind: 'text', lines: [''] }); } }
    if (t.kind !== 'rule') { out.push(t); continue; }
    const b = RB.get(t.key);
    const o = RO.get(t.key);
    if (b && o && !same(b, o)) {
      const m = mergeRule(b, o, t, log);
      report.edited++;
      if (m.disabled && !t.disabled) report.switchedOff.push(t.key);
      out.push(m);
    } else out.push(t);
    pushConds(t.key);
  }
  return { text: out.map((b) => b.lines.join('\n')).join('\n').replace(/\n/g, '\r\n'), report, log };
}

// ---------- download ----------
async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'ExileGuide-filter-updater' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
const raw = (tag, type) => `https://raw.githubusercontent.com/${REPO}/${encodeURIComponent(tag)}/${encodeURIComponent(`NeverSink's filter - ${type}.filter`).replace(/'/g, '%27')}`;

async function main() {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const ours = fs.readFileSync(BASE, 'utf8');
  const from = header(ours, 'VERSION');
  const type = header(ours, 'TYPE');
  const style = header(ours, 'STYLE');
  if (!from || !type) throw new Error('filter/base.filter has no VERSION / TYPE header');
  if (style && style.toUpperCase() !== 'DEFAULT') console.log(`Note: the export uses the ${style} style; NeverSink's GitHub files are DEFAULT style, so colours follow DEFAULT.`);
  const to = opt('--to') || JSON.parse(await get(`https://api.github.com/repos/${REPO}/releases/latest`)).tag_name;
  if (to === from) { console.log(`filter/base.filter is already NeverSink ${to}.`); return; }
  console.log(`Porting filter/base.filter: NeverSink ${from} -> ${to} (${type})`);
  const [baseText, theirsText] = await Promise.all([get(raw(from, type)), get(raw(to, type))]);
  if (header(baseText, 'VERSION') !== from) throw new Error(`downloaded ${from} file says version ${header(baseText, 'VERSION')}`);
  const { text, report, log } = port(baseText, ours, theirsText);
  console.log(`  ${report.edited} edited rules carried over (${report.switchedOff.length} switched off), ${report.conds} extra FilterBlade rules`);
  for (const m of report.moved) console.log('  moved: ' + m);
  if (report.lost.length) console.log(`  edits lost (rule no longer in ${to}): ${report.lost.join(', ')}`);
  if (log.length) { console.log(`  ${log.length} lines changed by both:`); for (const l of log) console.log('    ' + l.slice(0, 220)); }
  if (args.includes('--dry')) return;
  const keep = path.join(ROOT, 'filter', `base-${from}.filter`);
  fs.copyFileSync(BASE, keep);
  fs.writeFileSync(BASE, text);
  console.log(`Wrote filter/base.filter (${to}); the old one is ${path.relative(ROOT, keep)}. Now run "Build Loot Filter.cmd".`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { parse, port };
