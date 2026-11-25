'use strict';
// Makes some sections of a NeverSink filter one strictness level stricter: every rule whose $type matches --type
// is replaced with the same rule ($type + $tier) from his stricter filter, so it follows his own definition of the
// next level (which rules are switched off or turned into Hide), with the same economy tiering.
//
//   node tools/stricter-rules.js --in <filter> --stricter <NeverSink filter one level up> --type <regex> [--except "<type> <tier>,..."] [--out <filter>]
//
// e.g. --type "^uniques" applies Uber-Plus-Strict's unique rules (replicas, foulborn, unique maps, heist uniques too).
// --except keeps the listed rules as they are, e.g. "uniques t3boss": Uber-Plus-Strict hides the boss-only uniques on
// cheap bases (Doppelganger Guise, Oriath's End, Legacy of Fury, Viridi's Veil...), which are worth picking up.
const fs = require('fs');
const path = require('path');

function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
  const inp = opt('--in');
  const strict = opt('--stricter');
  const type = opt('--type');
  const out = opt('--out', inp);
  if (!inp || !strict || !type) throw new Error('--in, --stricter and --type are required');
  const typeRe = new RegExp(type);
  // --except "<type> <tier>,...": rules to keep at the current level
  const except = new Set((opt('--except', '') || '').split(',').map((s) => s.trim()).filter(Boolean));

  const read = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
  const key = (l) => { const m = /^#?(?:Show|Hide)\b.*?\$type->(\S+)\s+\$tier->(\S+)/.exec(l); return m && typeRe.test(m[1]) ? `${m[1]} ${m[2]}` : null; };
  const block = (L, i) => { const b = []; for (let j = i; j < L.length && L[j].trim() !== ''; j++) b.push(L[j]); return b; };

  const S = read(strict);
  const hdr = (k) => ((S.find((l) => new RegExp(`^# ${k}:`).test(l)) || '').split(':')[1] || '').trim();
  const stricter = new Map();
  S.forEach((l, i) => { const k = key(l); if (k) stricter.set(k, block(S, i)); });
  if (!stricter.size) throw new Error(`no rules with $type matching ${type} in ${strict}`);

  const L = read(inp);
  const changed = [];
  const missing = [];
  for (let i = 0; i < L.length; i++) {
    const k = key(L[i]);
    if (!k) continue;
    const old = block(L, i);
    const neu = except.has(k) ? old : stricter.get(k);
    if (!neu) { missing.push(k); i += old.length - 1; continue; }
    if (old.join('\n') !== neu.join('\n')) {
      L.splice(i, old.length, ...neu);
      changed.push(`${k}: ${old[0].split(' ')[0]} -> ${neu[0].split(' ')[0]}`);
    }
    i += neu.length - 1;
  }
  console.log(`One level stricter for $type ${type} (from ${hdr('TYPE')} ${hdr('VERSION')}): ${changed.length} rules changed`);
  for (const c of changed) console.log('  ' + c);
  if (missing.length) console.log(`  not in the stricter filter, left as is: ${missing.join(', ')}`);
  fs.writeFileSync(out, L.join('\r\n'));
  console.log(`Wrote ${path.relative(process.cwd(), out)}`);
}

try { main(); } catch (e) { console.error(e.message); process.exit(1); }
