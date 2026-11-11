'use strict';
// Builds the league-start loot filter:
//   base filter (a FilterBlade / NeverSink export, e.g. Tytykiller's melee preset)
//   + the build's key-base block on top (filter/<build>-block.filter), so those rules win over everything
//   + 3.30 fixes: drops item names that no longer exist from "BaseType ==" lists (a filter naming an
//     unknown item can fail to load), and swaps Custom sounds whose .mp3 is missing for a built-in sound.
// Usage (the .cmd launchers run this with the overlay's own Electron in Node mode):
//   node tools/build-filter.js [--base <file>] [--block <file>] [--out <file>] [--name <filter name>]
// Defaults: base = filter/base.filter, block = filter/sss-block.filter,
//           out  = <Documents>\My Games\Path of Exile\<name>.filter
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

function poeFolder() {
  const home = os.homedir();
  const cands = [
    path.join(home, 'OneDrive', 'Documents', 'My Games', 'Path of Exile'),
    path.join(home, 'Documents', 'My Games', 'Path of Exile'),
  ];
  // OneDrive folders with a suffix ("OneDrive - Personal")
  try {
    for (const d of fs.readdirSync(home)) if (/^OneDrive/i.test(d)) cands.push(path.join(home, d, 'Documents', 'My Games', 'Path of Exile'));
  } catch { /* ignore */ }
  return cands.find((p) => fs.existsSync(p)) || cands[0];
}

// Items removed in 3.30 (Covens of Umbra patch notes). Patterns match whole item names.
// (Allflame Embers stay in the game; Sacrifice fragments "remain but have no functionality".)
const REMOVED = [
  /Scarab/i, // all Scarabs became Threads; "Maven's Chisel of Scarabs" -> "of Threads"; Veiled Scarab -> Frayed Thread
  /^Coin of (Knowledge|Power|Skill|Restoration|Desecration)$/i, // rethemed to Soul Cores / deleted
  /^(Templar|Fruiting|Deceptive) Astrolabe$/i, // converted to Cryptic Astrolabe
  /^(Fragmented|Skittering) Delirium Orb$/i, // -> Threaded Delirium Orb
  /^Mortal (Grief|Rage|Hope|Ignorance)$/i, // -> Royal Visage
];
const isRemoved = (name) => REMOVED.some((re) => re.test(name));

function fixBaseTypes(lines, report) {
  // returns lines; rules whose exact-match list becomes empty are commented out
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = /^(\s*)BaseType\s*==\s*(.*)$/.exec(line);
    if (!m) { out.push(line); i++; continue; }
    const names = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    const keep = names.filter((n) => !isRemoved(n));
    if (keep.length === names.length) { out.push(line); i++; continue; }
    report.removed.push(...names.filter(isRemoved));
    if (keep.length) { out.push(`${m[1]}BaseType == ${keep.map((n) => `"${n}"`).join(' ')}`); i++; continue; }
    // empty list: comment out the whole rule (back to its Show/Hide line, forward to the blank line)
    let start = out.length - 1;
    while (start >= 0 && !/^\s*(Show|Hide|Minimal)\b/.test(out[start]) && out[start].trim() !== '') start--;
    if (start >= 0 && /^\s*(Show|Hide|Minimal)\b/.test(out[start])) {
      for (let k = start; k < out.length; k++) out[k] = `#${out[k]}`;
      out.push(`#${line}`);
      i++;
      while (i < lines.length && lines[i].trim() !== '') { out.push(`#${lines[i]}`); i++; }
      report.rulesDisabled++;
    } else { out.push(`#${line}`); i++; }
  }
  return out;
}

function fixSounds(lines, folder, report) {
  return lines.map((line) => {
    const m = /^(\s*)CustomAlertSound\s+"([^"]+)"(.*)$/.exec(line);
    if (!m) return line;
    if (fs.existsSync(path.join(folder, m[2]))) return line;
    report.missingSounds.add(m[2]);
    return `${m[1]}# CustomAlertSound "${m[2]}" (file missing, built-in sound instead)\n${m[1]}PlayAlertSound 2 300`;
  }).flatMap((l) => l.split('\n'));
}

function main() {
  const base = opt('--base', path.join(ROOT, 'filter', 'base.filter'));
  const block = opt('--block', path.join(ROOT, 'filter', 'sss-block.filter'));
  const name = opt('--name', 'SSS-Slayer-3.30');
  const folder = poeFolder();
  const out = opt('--out', path.join(folder, `${name}.filter`));
  const report = { removed: [], rulesDisabled: 0, missingSounds: new Set() };

  // custom sounds travel with the app (filter\sounds in OneDrive) and are copied next to the filter on this PC
  const soundDir = path.join(ROOT, 'filter', 'sounds');
  let copied = 0;
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    for (const f of fs.readdirSync(soundDir)) {
      if (!/\.(mp3|wav)$/i.test(f)) continue;
      const dst = path.join(path.dirname(out), f);
      const src = path.join(soundDir, f);
      if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) { fs.copyFileSync(src, dst); copied++; }
    }
  } catch { /* no sounds folder */ }
  if (copied) console.log(`Copied ${copied} sound files to ${path.dirname(out)}`);

  const baseText = fs.readFileSync(base, 'utf8').replace(/^﻿/, '');
  // a previously built filter can be used as the base: strip the old block first
  const stripped = baseText.replace(/#=+ BUILD BLOCK START[\s\S]*?#=+ BUILD BLOCK END[^\n]*\n?/g, '');
  let lines = stripped.split(/\r?\n/);
  lines = fixBaseTypes(lines, report);
  lines = fixSounds(lines, path.dirname(out), report);

  const blockText = fs.readFileSync(block, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n').trimEnd();
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const blockLines = [
    '#=============================================================================================================== BUILD BLOCK START',
    `# Static Strike Slayer key bases + 3.30 fixes. Built ${stamp} from ${path.basename(base)} by ExileGuide\\tools\\build-filter.js`,
    '# Edit filter\\sss-block.filter and run "Build Loot Filter.cmd" again; do not edit this part here.',
    ...blockText.split('\n'),
    '#=============================================================================================================== BUILD BLOCK END',
    '',
  ];
  // insert before the first rule, so the block overrides everything below it
  const first = lines.findIndex((l) => /^\s*(Show|Hide|Minimal)\b/.test(l));
  lines.splice(first < 0 ? 0 : first, 0, ...blockLines);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join('\r\n'));

  const uniq = [...new Set(report.removed)];
  console.log(`Wrote ${out}`);
  console.log(`  build block: ${blockText.split('\n').filter((l) => /^\s*(Show|Hide)\b/.test(l)).length} rules from ${path.basename(block)}`);
  console.log(`  3.30: removed ${uniq.length} item names that no longer exist${uniq.length ? ` (${uniq.slice(0, 6).join(', ')}${uniq.length > 6 ? ', ...' : ''})` : ''}; ${report.rulesDisabled} rules left empty were disabled`);
  if (report.missingSounds.size) console.log(`  ${report.missingSounds.size} custom sounds of the base filter use built-in alert sounds instead (no sound pack installed).`);
}

main();
