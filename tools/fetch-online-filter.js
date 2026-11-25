'use strict';
// Downloads NeverSink's online filter from pathofexile.com: the same filter FilterBlade keeps re-tiered from the
// economy (his GitHub releases are only updated at release time). Needs your pathofexile.com login: the filter
// page only shows the text to a logged-in account.
//
//   node tools/fetch-online-filter.js [--id wvPeTJ] [--out filter/base-uberstrict.filter] [--sessid <POESESSID>]
//
// The session ID is read from --sessid, the POESESSID environment variable, or user/poesessid.txt (git-ignored;
// --sessid saves it there). It is only sent to www.pathofexile.com, and the script only reads the filter page.
// Default --id is NeverSink's "NeverSink-5uberstr-softcore" (PoE 1, 5-UBER-STRICT).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SESS_FILE = path.join(ROOT, 'user', 'poesessid.txt');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

const unescape = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
  const id = opt('--id', 'wvPeTJ');
  const out = opt('--out', path.join(ROOT, 'filter', 'base-uberstrict.filter'));
  let sess = opt('--sessid');
  if (sess) { fs.mkdirSync(path.dirname(SESS_FILE), { recursive: true }); fs.writeFileSync(SESS_FILE, sess.trim()); }
  sess = (sess || process.env.POESESSID || (fs.existsSync(SESS_FILE) ? fs.readFileSync(SESS_FILE, 'utf8') : '')).trim();
  if (!/^[0-9a-f]{32}$/i.test(sess)) throw new Error('No POESESSID. Log in on pathofexile.com, copy the POESESSID cookie, and run with --sessid <value> (it is saved to user\\poesessid.txt).');

  const r = await fetch(`https://www.pathofexile.com/item-filter/${encodeURIComponent(id)}`, { headers: { 'User-Agent': UA, Cookie: `POESESSID=${sess}` }, redirect: 'follow' });
  if (r.status === 401 || r.status === 403) throw new Error(`pathofexile.com refused the session (${r.status}): it has expired or you logged out. Copy a fresh POESESSID and run again with --sessid <value>.`);
  if (!r.ok) throw new Error(`${r.status} fetching item filter ${id}`);
  const page = await r.text();
  const m = /<pre id="editor"[^>]*>([\s\S]*?)<\/pre>/.exec(page);
  if (!m) throw new Error('filter text not found on the page (pathofexile.com layout changed?)');
  const text = unescape(m[1]).replace(/\r?\n/g, '\r\n');
  const hdr = (k) => ((text.match(new RegExp(`^# ${k}:\\s*(.+?)\\s*$`, 'm')) || [])[1] || '');
  if (hdr('AUTHOR') !== 'NeverSink') throw new Error(`filter ${id} is not NeverSink's (AUTHOR: ${hdr('AUTHOR') || 'none'})`);
  const rules = (text.match(/^(Show|Hide)\b/gm) || []).length;
  if (rules < 300) throw new Error(`only ${rules} rules in the downloaded filter; not saving it`);
  const updated = (/Last updated\s*:\s*([^<]+)</.exec(page) || [])[1];
  fs.writeFileSync(out, text);
  console.log(`Downloaded NeverSink's online filter ${id}: ${hdr('VERSION')} ${hdr('TYPE')}, last updated ${updated ? updated.trim() : '?'} (${rules} rules)`);
  console.log(`Wrote ${path.relative(ROOT, out)}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
