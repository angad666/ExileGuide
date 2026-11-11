// Shared rendering helpers for the overlay and settings windows.
(() => {
'use strict';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderTokens(tokens) {
  return tokens.map((t) => {
    switch (t.k) {
      case 'text': return esc(t.v);
      case 'enter': return `<span class="t-area">${esc(t.v)}</span>`;
      case 'area': return `<span class="t-area">${esc(t.v)}</span>`;
      case 'kill': return `<span class="t-kill">${esc(t.v)}</span>`;
      case 'arena': return `<span class="t-arena">${esc(t.v)}</span>`;
      case 'quest': return `<span class="t-quest">${esc(t.v)}</span>`;
      case 'qitem': return `<span class="t-qitem">${esc(t.v)}</span>`;
      case 'generic': return `<span class="t-generic">${esc(t.v)}</span>`;
      case 'wp': return `<span class="t-wp">waypoint</span>`;
      case 'wpget': return `<span class="t-wp">Waypoint</span>`;
      case 'wpuse': return `<span class="t-wp">Waypoint</span> → <span class="t-area">${esc(t.v)}</span>`;
      case 'logout': return `<span class="t-logout">Logout</span> → <span class="t-area">${esc(t.v)}</span>`;
      case 'portal': return `<span class="t-portal">${esc(t.v)}</span>`;
      case 'trial': return `<span class="t-trial">${esc(t.v)}</span>`;
      case 'ascend': return `<span class="t-trial">${esc(t.v)}</span>`;
      case 'craft': return `<span class="t-craft" title="${esc((t.recipes || []).join(', '))}">${esc(t.v)}</span>${t.recipes && t.recipes.length ? ` <span class="t-dim">(${esc(t.recipes.join(', '))})</span>` : ''}`;
      case 'dir': return `<span class="t-dir">${esc(t.v)}</span>`;
      case 'copy': return `<span class="chip copy" data-copy="${esc(t.v)}" title="Click (or F4) to paste">${esc(t.v)}</span>`;
      default: return esc(t.v);
    }
  }).join('');
}

function tokensText(tokens) {
  return tokens.map((t) => {
    switch (t.k) {
      case 'wpuse': return `Waypoint → ${t.v}`;
      case 'logout': return `Logout → ${t.v}`;
      case 'wp': return 'waypoint';
      default: return t.v;
    }
  }).join('');
}

function renderGemBlocks(blocks, { copyable = false } = {}) {
  return blocks.map((b) => {
    const gems = b.gems.map((g) => {
      const extra = [];
      if (g.copies > 1) extra.push(`×${g.copies}`);
      if (g.why && g.why !== 'due') extra.push(g.why);
      if (g.neededAt > 1) extra.push(`for lv ${g.neededAt}`);
      return `<span class="gem">${esc(g.name)}</span>${extra.length ? `<span class="t-dim"> (${esc(extra.join(', '))})</span>` : ''}`;
    }).join(', ');
    const costs = b.kind === 'buy' ? [...new Set(b.gems.map((g) => g.cost))].join('/') : '';
    const search = (b.search || []).map((s) => `<span class="chip${copyable ? ' copy' : ''}" data-copy="${esc(s)}">${esc(s)}</span>`).join(' ');
    return `<div class="gemrow ${b.kind}"><span class="badge ${b.kind}">${b.kind === 'take' ? 'TAKE' : 'BUY'}</span>
      <div class="gemrow-body">${gems} <span class="t-dim">· ${esc(b.npc)}${costs ? ` · ${esc(costs)}` : ''}</span>${search ? `<div class="searches">${search}</div>` : ''}</div></div>`;
  }).join('');
}

function renderNotes(notes, { copyable = false } = {}) {
  return notes.map((n) => `<div class="gemrow note"><span class="badge note">${n.kind === 'item' ? 'GEAR' : 'NOTE'}</span>
    <div class="gemrow-body">${esc(n.text)}${n.search ? `<div class="searches"><span class="chip${copyable ? ' copy' : ''}" data-copy="${esc(n.search)}">${esc(n.search)}</span></div>` : ''}</div></div>`).join('');
}

window.Common = { esc, renderTokens, tokensText, renderGemBlocks, renderNotes };
})();
