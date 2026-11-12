'use strict';
const { esc, renderTokens, renderGemBlocks, renderNotes } = window.Common;
const $ = (id) => document.getElementById(id);
const api = window.guide;

let state = null;      // from main
let draft = null;      // build being edited
let draftFile = null;
let dirty = false;
let preview = null;    // {plan, planSummary, warnings}
let quests = [];
let areas = [];

const searchesToText = (list) => (list || []).map((x) => `${x.label} => ${x.search}`).join('\n');
const textToSearches = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const i = l.indexOf('=>');
  return i >= 0 ? { label: l.slice(0, i).trim(), search: l.slice(i + 2).trim() } : { label: l, search: l };
});

const HOTKEY_NAMES = {
  nextStep: 'Next step', prevStep: 'Previous step', searchMenu: 'Search menu (vendor / stash)', nextZone: 'Skip to next zone', prevZone: 'Back to previous zone',
  pasteSearch: 'Paste gem/item search', cycleStage: 'Cycle build stage', toggleDetails: 'Compact / detailed overlay',
  toggleLock: 'Lock / unlock overlay', toggleVisible: 'Show / hide overlay', openSettings: 'Open this window',
  timerPause: 'Start / pause / resume timer',
};

// ---------------- tabs ----------------
function showTab(name) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === `tab-${name}`));
  if (name === 'json') $('json').value = JSON.stringify(draft, null, 2);
  if (name === 'route') { renderRoute(); scrollToCurrent(); }
  if (name === 'plan') renderPlan();
}
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });
api.onTab((t) => showTab(t));

// ---------------- load ----------------
async function load(keepDraft = false) {
  state = await api.get();
  if (!keepDraft || !draft) {
    draft = structuredClone(state.build);
    draftFile = state.buildFile;
    dirty = false;
    preview = { plan: state.plan, planSummary: state.planSummary, warnings: state.warnings };
  }
  renderStatus();
  renderBuildSelect();
  renderBuildForm();
  renderSettings();
  if ($('tab-route').classList.contains('on')) renderRoute();
  if ($('tab-plan').classList.contains('on')) renderPlan();
  setDirty(dirty);
}

function renderStatus() {
  const s = state;
  $('status').innerHTML = `Build <b>${esc(s.build.name)}</b> · step <b>${s.stepIndex + 1}</b>/${s.route.length} · level <b>${s.level}</b> · log ${s.logStatus.ok ? '<span style="color:var(--quest)">connected</span>' : '<span style="color:#ffb3a6">not found</span>'}`;
}

function setDirty(d) {
  dirty = d;
  $('dirty').classList.toggle('hidden', !d);
}

let previewTimer = null;
function changed() {
  setDirty(true);
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const r = await api.previewBuild(draft);
    if (r.ok) { preview = r; renderWarnings(); if ($('tab-plan').classList.contains('on')) renderPlan(); }
    else showWarnings([r.error]);
  }, 350);
}

// ---------------- build tab ----------------
function renderBuildSelect() {
  $('buildSelect').innerHTML = state.builds.map((b) => `<option value="${esc(b.file)}"${b.file === state.buildFile ? ' selected' : ''}>${esc(b.name)}${b.ascendancy ? ` (${esc(b.ascendancy)})` : ''}</option>`).join('');
}

function renderBuildForm() {
  const b = draft;
  $('bClass').innerHTML = state.classes.map((c) => `<option${c === b.class ? ' selected' : ''}>${c}</option>`).join('');
  $('bName').value = b.name || '';
  $('bAsc').value = b.ascendancy || '';
  $('bBandit').value = b.bandit || 'None';
  $('bPantheon').value = b.pantheon || '';
  $('bLeague').checked = b.leagueStart !== false;
  $('bLibrary').checked = b.library !== false;
  $('bSource').value = b.source?.pob || '';
  $('buildSearches').value = searchesToText(b.searches);
  $('extraGems').value = (b.extraGems || []).map((g) => `${g.name}${g.neededAt ? ` @ ${g.neededAt}` : ''}`).join('\n');
  renderStages();
  renderNotesTbl();
  renderMileTbl();
  $('pobNotes').textContent = b.pobNotes || '';
  $('pobNotesCard').classList.toggle('hidden', !b.pobNotes);
  renderWarnings();
}

function showWarnings(list) {
  const el = $('buildWarnings');
  el.classList.toggle('hidden', !list.length);
  el.textContent = list.join('\n');
}
function renderWarnings() {
  showWarnings([...(preview?.warnings || []), ...(draft.importWarnings || [])]);
}

const bindField = (id, fn) => $(id).addEventListener('input', (e) => { fn(e.target); changed(); });
bindField('bName', (el) => { draft.name = el.value; });
bindField('bClass', (el) => { draft.class = el.value; });
bindField('bAsc', (el) => { draft.ascendancy = el.value; });
bindField('bBandit', (el) => { draft.bandit = el.value; });
bindField('bPantheon', (el) => { draft.pantheon = el.value; });
bindField('bLeague', (el) => { draft.leagueStart = el.checked; });
bindField('bLibrary', (el) => { draft.library = el.checked; });
bindField('bSource', (el) => { draft.source = { ...(draft.source || {}), pob: el.value }; });
bindField('buildSearches', (el) => { draft.searches = textToSearches(el.value); });
bindField('extraGems', (el) => {
  draft.extraGems = el.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^(.*?)\s*@\s*(\d+)\s*$/.exec(l);
    return m ? { name: m[1], neededAt: +m[2] } : { name: l };
  });
});

// stages
const linksToText = (links) => links.map((l) => `${l.label}: ${l.gems.join(', ')}`).join('\n');
function textToLinks(t) {
  return t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(':');
    const label = i > 0 ? l.slice(0, i).trim() : '';
    const gems = (i > 0 ? l.slice(i + 1) : l).split(/[,+–]/).map((g) => g.trim()).filter(Boolean);
    return { label: label || gems[0] || 'Link', gems };
  });
}
const gearToText = (gear) => gear.map((g) => `${g.slot}: ${g.rarity && g.rarity !== 'normal' ? `[${g.rarity}] ` : ''}${g.name}${g.sockets || g.mods?.length ? ` | ${g.sockets || ''}` : ''}${g.mods?.length ? ` | ${g.mods.join('; ')}` : ''}`).join('\n');
function textToGear(t) {
  return t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(':');
    const slot = i > 0 ? l.slice(0, i).trim() : 'Item';
    const parts = (i > 0 ? l.slice(i + 1) : l).split('|').map((p) => p.trim());
    let name = parts[0] || '';
    let rarity = 'normal';
    const m = /^\[(\w+)\]\s*(.*)$/.exec(name);
    if (m) { rarity = m[1].toLowerCase(); name = m[2]; }
    return { slot, rarity, name, base: name, sockets: parts[1] || '', mods: (parts[2] || '').split(';').map((x) => x.trim()).filter(Boolean) };
  });
}

function renderStages() {
  $('stages').innerHTML = (draft.stages || []).map((s, i) => `
    <div class="stage" data-i="${i}">
      <div class="stage-head">
        <label>Title <input type="text" data-f="title" value="${esc(s.title)}"></label>
        <label>From lv <input type="number" data-f="from" value="${s.from ?? ''}"></label>
        <label>To lv <input type="number" data-f="to" value="${s.to ?? ''}"></label>
        <label style="flex:1">Passive tree reminder <input type="text" data-f="tree" value="${esc(s.tree || '')}" placeholder="e.g. PoB tree 'lvl 1-12'"></label>
        <button class="small" data-act="up" title="Move up">▲</button>
        <button class="small" data-act="down" title="Move down">▼</button>
        <button class="small danger" data-act="del">Remove</button>
      </div>
      <div class="stage-body">
        <label>Links (Label: Gem, Gem, Gem)<textarea data-f="links" spellcheck="false">${esc(linksToText(s.links || []))}</textarea></label>
        <label>Gear (Slot: [rarity] Item | sockets | mod; mod)<textarea data-f="gear" spellcheck="false">${esc(gearToText(s.gear || []))}</textarea></label>
      </div>
      <label class="notes">Stage notes (one per line, shown in the Gear panel)<textarea data-f="notes" spellcheck="false">${esc((s.notes || []).join('\n'))}</textarea></label>
    </div>`).join('') || '<p class="muted">No stages yet. Import a PoB or add one.</p>';
}
$('stages').addEventListener('input', (e) => {
  const st = e.target.closest('.stage'); if (!st) return;
  const s = draft.stages[+st.dataset.i];
  const f = e.target.dataset.f;
  if (f === 'title' || f === 'tree') s[f] = e.target.value;
  if (f === 'from' || f === 'to') s[f] = e.target.value === '' ? undefined : +e.target.value;
  if (f === 'links') s.links = textToLinks(e.target.value);
  if (f === 'gear') s.gear = textToGear(e.target.value);
  if (f === 'notes') s.notes = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean);
  changed();
});
$('stages').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const i = +b.closest('.stage').dataset.i;
  const arr = draft.stages;
  if (b.dataset.act === 'del' && confirm(`Remove stage "${arr[i].title}"?`)) arr.splice(i, 1);
  if (b.dataset.act === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
  if (b.dataset.act === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
  renderStages(); changed();
});
$('btnAddStage').onclick = () => {
  const last = draft.stages[draft.stages.length - 1];
  draft.stages.push({ title: 'New stage', from: last ? (last.to || last.from + 10) : 1, to: 100, tree: '', links: [], gear: [], notes: [] });
  renderStages(); changed();
};

// route notes
function whereInput(n) {
  if (n.quest !== undefined) {
    return `<select data-f="quest">${quests.map((q) => `<option value="${q.id}"${q.id === n.quest ? ' selected' : ''}>A${q.act} · ${esc(q.name)} (${q.id})</option>`).join('')}</select>`;
  }
  if (n.level !== undefined) return `<input type="number" data-f="level" value="${n.level}" min="1" max="100" placeholder="level">`;
  return `<select data-f="area">${areas.map((a) => `<option value="${a.id}"${a.id === n.area ? ' selected' : ''}>A${a.act} · ${esc(a.name)}${a.town ? ' (town)' : ''}</option>`).join('')}</select>`;
}
function renderNotesTbl() {
  const rows = (draft.steps || []).map((n, i) => {
    const trig = n.quest !== undefined ? 'quest' : n.level !== undefined ? 'level' : 'area';
    return `<tr data-i="${i}">
      <td><select data-f="trigger"><option value="area"${trig === 'area' ? ' selected' : ''}>First visit to zone</option><option value="quest"${trig === 'quest' ? ' selected' : ''}>Quest hand-in</option><option value="level"${trig === 'level' ? ' selected' : ''}>Route reaches level</option></select></td>
      <td>${whereInput(n)}</td>
      <td><input type="text" data-f="text" value="${esc(n.text)}"></td>
      <td><input type="text" data-f="search" value="${esc(n.search || '')}" spellcheck="false"></td>
      <td><select data-f="kind"><option value="note"${n.kind !== 'item' ? ' selected' : ''}>note</option><option value="item"${n.kind === 'item' ? ' selected' : ''}>gear</option></select></td>
      <td><button class="small danger" data-act="del">✕</button></td></tr>`;
  });
  document.querySelector('#notesTbl tbody').innerHTML = rows.join('') || '<tr><td colspan="6" class="muted">No route notes.</td></tr>';
}
document.querySelector('#notesTbl').addEventListener('input', (e) => {
  const tr = e.target.closest('tr[data-i]'); if (!tr) return;
  const n = draft.steps[+tr.dataset.i];
  const f = e.target.dataset.f;
  if (f === 'trigger') {
    delete n.area; delete n.quest; delete n.level;
    if (e.target.value === 'area') n.area = '1_1_town';
    if (e.target.value === 'quest') n.quest = 'a1q1';
    if (e.target.value === 'level') n.level = 10;
    renderNotesTbl();
  } else if (f === 'level') n.level = +e.target.value;
  else n[f] = e.target.value;
  changed();
});
document.querySelector('#notesTbl').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act=del]'); if (!b) return;
  draft.steps.splice(+b.closest('tr').dataset.i, 1); renderNotesTbl(); changed();
});
$('btnAddNote').onclick = () => { (draft.steps ||= []).push({ area: '1_1_town', text: '', search: '', kind: 'note' }); renderNotesTbl(); changed(); };

// milestones
function renderMileTbl() {
  const rows = (draft.milestones || []).map((m, i) => `<tr data-i="${i}">
    <td><input type="number" data-f="level" value="${m.level ?? ''}"></td>
    <td><input type="number" data-f="until" value="${m.until ?? ''}"></td>
    <td><input type="text" data-f="slot" value="${esc(m.slot || '')}"></td>
    <td><input type="text" data-f="text" value="${esc(m.text)}"></td>
    <td><input type="text" data-f="search" value="${esc(m.search || '')}" spellcheck="false"></td>
    <td><button class="small danger" data-act="del">✕</button></td></tr>`);
  document.querySelector('#mileTbl tbody').innerHTML = rows.join('') || '<tr><td colspan="6" class="muted">No milestones.</td></tr>';
}
document.querySelector('#mileTbl').addEventListener('input', (e) => {
  const tr = e.target.closest('tr[data-i]'); if (!tr) return;
  const m = draft.milestones[+tr.dataset.i];
  const f = e.target.dataset.f;
  m[f] = (f === 'level' || f === 'until') ? (e.target.value === '' ? undefined : +e.target.value) : e.target.value;
  changed();
});
document.querySelector('#mileTbl').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act=del]'); if (!b) return;
  draft.milestones.splice(+b.closest('tr').dataset.i, 1); renderMileTbl(); changed();
});
$('btnAddMile').onclick = () => { (draft.milestones ||= []).push({ level: 1, until: 100, slot: '', text: '', search: '' }); renderMileTbl(); changed(); };

// build actions
$('buildSelect').onchange = async (e) => {
  if (dirty && !confirm('Discard unsaved changes?')) { e.target.value = draftFile; return; }
  await api.selectBuild(e.target.value);
  await load();
};
$('btnSave').onclick = $('btnSave2').onclick = saveBuild;
async function saveBuild() {
  const r = await api.saveBuild(draftFile, draft);
  if (!r.ok) { alert(`Could not save: ${r.error}`); return; }
  draftFile = r.file;
  setDirty(false);
  await load();
}
$('btnNew').onclick = async () => {
  if (dirty && !confirm('Discard unsaved changes?')) return;
  draft = { schema: 1, name: 'New build', class: 'Duelist', ascendancy: '', bandit: 'None', leagueStart: true, library: true, pantheon: '', source: { pob: '' },
    stages: [{ title: 'Level 1-12', from: 1, to: 12, tree: '', links: [{ label: 'Main', gems: [] }], gear: [], notes: [] }],
    extraGems: [], gemOverrides: {}, steps: [], milestones: [] };
  draftFile = null; renderBuildForm(); changed();
};
$('btnDup').onclick = () => { draft = structuredClone(draft); draft.name += ' (copy)'; draftFile = null; renderBuildForm(); changed(); };
$('btnDelete').onclick = async () => {
  if (state.builds.length <= 1) { alert('Keep at least one build.'); return; }
  if (!confirm(`Delete build file ${state.buildFile}?`)) return;
  await api.deleteBuild(state.buildFile); await load();
};
$('btnFolder').onclick = () => api.openBuildsFolder();
$('btnImport').onclick = async () => {
  const input = $('pobInput').value.trim();
  if (!input) return;
  if (dirty && !confirm('Discard unsaved changes to the current build?')) return;
  $('importMsg').className = 'msg'; $('importMsg').textContent = 'Importing…';
  const r = await api.importPob(input);
  if (!r.ok) { $('importMsg').className = 'msg err'; $('importMsg').textContent = r.error; return; }
  draft = r.build; draftFile = null;
  const nStages = draft.stages.length;
  $('importMsg').className = 'msg ok';
  $('importMsg').textContent = `Imported ${draft.class}${draft.ascendancy ? ' / ' + draft.ascendancy : ''}: ${nStages} stage(s): ${draft.stages.map((s) => `${s.title} (lv ${s.from}${s.to ? '-' + s.to : ''})`).join(', ')}. Check the stage levels, rename the build, then Save.`;
  renderBuildForm(); changed();
};

// ---------------- plan tab ----------------
function renderPlan() {
  if (!preview) return;
  $('planSteps').innerHTML = preview.planSummary.map((p) => `
    <div class="planstep" data-step="${p.stepIndex}">
      <div class="where"><b>Act ${p.act}</b> · ${esc(p.area)}${p.quest ? ` · ${esc(p.quest)}` : ''}</div>
      ${renderGemBlocks(p.gems)}${renderNotes(p.notes)}
    </div>`).join('') || '<p class="muted">No gem actions. Add link groups to the build.</p>';

  const ov = draft.gemOverrides || {};
  const qOpts = (sel) => `<option value="">auto</option>` + quests.filter((q) => q.act <= 6).map((q) => `<option value="${q.id}"${q.id === sel ? ' selected' : ''}>A${q.act} ${esc(q.name)}</option>`).join('');
  $('planTbl').querySelector('tbody').innerHTML = preview.plan.map((g) => {
    const o = ov[g.name] || {};
    const src = g.sources.map((s) => s.kind === 'start' ? esc(s.npc) : `${s.kind === 'take' ? '<span style="color:var(--take)">reward</span>' : '<span style="color:var(--buy)">buy</span>'} A${s.act} ${esc(s.npc)}${s.copies > 1 ? ` ×${s.copies}` : ''}`).join('<br>');
    const status = g.skip ? '<span class="muted">skipped</span>' : !g.campaign ? '<span class="muted">after campaign</span>' : g.missing ? '<span style="color:#ffb3a6">not sold to this class: find a drop</span>' : '';
    return `<tr data-gem="${esc(g.name)}" class="${g.missing ? 'missing' : ''} ${!g.campaign ? 'later' : ''}">
      <td>${esc(g.name)}</td>
      <td>lv ${g.neededAt}</td>
      <td>${src || status}</td>
      <td><input type="number" data-f="neededAt" value="${o.neededAt ?? ''}" placeholder="${g.neededAt}"></td>
      <td><select data-f="pin">${qOpts(o.pin)}</select></td>
      <td><input type="checkbox" data-f="skip"${o.skip ? ' checked' : ''}></td></tr>`;
  }).join('');
}
$('planSteps').addEventListener('click', async (e) => {
  const el = e.target.closest('[data-step]'); if (!el) return;
  await api.jump(+el.dataset.step); await load(true);
});
$('planTbl').addEventListener('change', (e) => {
  const tr = e.target.closest('tr[data-gem]'); if (!tr) return;
  const name = tr.dataset.gem;
  draft.gemOverrides ||= {};
  const o = draft.gemOverrides[name] ||= {};
  const f = e.target.dataset.f;
  if (f === 'skip') o.skip = e.target.checked || undefined;
  if (f === 'pin') o.pin = e.target.value || undefined;
  if (f === 'neededAt') o.neededAt = e.target.value ? +e.target.value : undefined;
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  if (!Object.keys(o).length) delete draft.gemOverrides[name];
  changed();
});

// ---------------- route tab ----------------
function renderRoute() {
  const sel = $('routeAct');
  if (!sel.options.length) {
    sel.innerHTML = `<option value="">All acts</option>` + state.sections.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('');
  }
  const only = $('routeGemsOnly').checked;
  const actIdx = sel.value === '' ? null : +sel.value;
  let html = '';
  let lastSection = null;
  let lastSeg = null;
  for (const s of state.route) {
    const secIdx = state.sections.findIndex((x) => x.name === s.section);
    if (actIdx !== null && secIdx !== actIdx) continue;
    if (only && !s.gems.length && !s.notes.length) continue;
    if (s.section !== lastSection) { html += `<div class="act">${esc(s.section)}</div>`; lastSection = s.section; lastSeg = null; }
    const newSeg = lastSeg !== null && s.segment !== lastSeg;
    lastSeg = s.segment;
    html += `<div class="step${s.index === state.stepIndex ? ' cur' : ''}${newSeg ? ' newseg' : ''}" data-step="${s.index}">
      <span class="idx">${s.index + 1}</span><span class="area">${esc(s.area)}</span>
      <div class="body">${renderTokens(s.tokens)}${renderGemBlocks(s.gems)}${renderNotes(s.notes)}</div></div>`;
  }
  $('routeList').innerHTML = html;
}
function scrollToCurrent() {
  const el = document.querySelector('.route .step.cur');
  if (el) el.scrollIntoView({ block: 'center' });
}
$('routeAct').onchange = renderRoute;
$('routeGemsOnly').onchange = renderRoute;
$('btnToCurrent').onclick = () => { $('routeAct').value = ''; renderRoute(); scrollToCurrent(); };
$('routeList').addEventListener('click', async (e) => {
  const el = e.target.closest('[data-step]'); if (!el) return;
  await api.jump(+el.dataset.step);
  state = await api.get();
  document.querySelectorAll('.route .step.cur').forEach((x) => x.classList.remove('cur'));
  el.classList.add('cur');
  renderStatus();
});

// ---------------- settings tab ----------------
function codeToAccel(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const c = e.code;
  let key = null;
  const npad = { NumpadDivide: 'numdiv', NumpadMultiply: 'nummult', NumpadSubtract: 'numsub', NumpadAdd: 'numadd', NumpadDecimal: 'numdec' };
  if (/^Numpad\d$/.test(c)) key = 'num' + c.slice(6);
  else if (npad[c]) key = npad[c];
  else if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit\d$/.test(c)) key = c.slice(5);
  else if (/^F\d{1,2}$/.test(c)) key = c;
  else if (['Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right'].includes(c.replace('Arrow', ''))) key = c.replace('Arrow', '');
  else if (c === 'Backquote') key = '`';
  if (!key) return null;
  return [...mods, key].join('+');
}

function renderSettings() {
  const s = state.settings;
  $('sLog').value = s.clientLog;
  $('logMsg').className = `msg ${state.logStatus.ok ? 'ok' : 'err'}`;
  $('logMsg').textContent = state.logStatus.ok ? 'Reading the log: zone changes and level ups move the overlay.' : (state.logStatus.error || 'Log not found.');
  $('hotkeys').innerHTML = Object.keys(HOTKEY_NAMES).map((k) => `<div class="hk"><span>${HOTKEY_NAMES[k]}</span><input type="text" readonly data-hk="${k}" value="${esc(s.hotkeys[k] || '')}" placeholder="(none)"></div>`).join('');
  $('hkMsg').className = `msg ${state.hotkeyFailures.length ? 'err' : ''}`;
  $('hkMsg').textContent = state.hotkeyFailures.length ? `Could not register (used by another program): ${state.hotkeyFailures.join(', ')}` : '';
  $('sPaste').value = s.pasteMode;
  $('sSearches').value = searchesToText(s.searches);
  $('sOpacity').value = s.overlay.opacity;
  $('sScale').value = s.overlay.scale;
  $('sUpcoming').value = s.overlay.showUpcoming;
  $('sAutoReset').checked = s.autoReset;
  $('sLinks').checked = s.overlay.showLinks !== false;
  $('sGear').checked = s.overlay.showGear !== false;
  $('sTree').checked = s.overlay.showTree !== false;
  $('sCompact').checked = !!s.overlay.compact;
  $('sLevel').value = state.level;
  renderTimer();
}
$('hotkeys').addEventListener('keydown', async (e) => {
  const inp = e.target.closest('input[data-hk]'); if (!inp) return;
  e.preventDefault();
  if (e.key === 'Tab') return;
  let accel;
  if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Escape') accel = '';
  else { accel = codeToAccel(e); if (accel === null) return; }
  if (['Control', 'Alt', 'Shift'].includes(accel)) return;
  inp.value = accel;
  const r = await api.save({ hotkeys: { [inp.dataset.hk]: accel } });
  state.hotkeyFailures = r.hotkeyFailures;
  $('hkMsg').className = `msg ${r.hotkeyFailures.length ? 'err' : 'ok'}`;
  $('hkMsg').textContent = r.hotkeyFailures.length ? `Could not register: ${r.hotkeyFailures.join(', ')}` : 'Saved.';
});
$('btnBrowse').onclick = async () => { const p = await api.browseLog(); if (p) $('sLog').value = p; };
$('btnLogApply').onclick = async () => { await api.save({ clientLog: $('sLog').value.trim() }); setTimeout(() => load(true), 400); };
$('btnSearchesSave').onclick = async () => {
  const list = textToSearches($('sSearches').value);
  const long = list.filter((x) => x.search.length > 50).map((x) => x.label);
  await api.save({ searches: list });
  $('searchMsg').className = `msg ${long.length ? 'err' : 'ok'}`;
  $('searchMsg').textContent = long.length ? `Saved, but over 50 characters: ${long.join(', ')}` : `Saved ${list.length} strings.`;
};
$('sPaste').onchange = (e) => api.save({ pasteMode: e.target.value });
const ov = (k, v) => api.save({ overlay: { [k]: v } });
$('sOpacity').oninput = (e) => ov('opacity', +e.target.value);
$('sScale').oninput = (e) => ov('scale', +e.target.value);
$('sUpcoming').onchange = (e) => ov('showUpcoming', +e.target.value);
$('sLinks').onchange = (e) => ov('showLinks', e.target.checked);
$('sGear').onchange = (e) => ov('showGear', e.target.checked);
$('sTree').onchange = (e) => ov('showTree', e.target.checked);
$('sCompact').onchange = (e) => ov('compact', e.target.checked);
$('sAutoReset').onchange = (e) => api.save({ autoReset: e.target.checked });
$('btnSetLevel').onclick = async () => { await api.setLevel(+$('sLevel').value); await load(true); };
$('btnReset').onclick = async () => { if (confirm('Restart the route from the Twilight Strand?')) { await api.reset(); await load(true); } };

// ---------------- timer ----------------
const fmtT = (ms) => {
  if (ms === null || ms === undefined) return '';
  const t = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
function renderTimer() {
  const s = state.settings.timer || {};
  const goals = Object.entries(s.goals || {}).map(([k, g]) => [k, g.label || k]);
  $('tCompare').innerHTML = [...goals, ['pb', 'Personal best (finished runs)'], ['none', 'Nothing']].map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('');
  $('tCompare').value = s.comparison || 'goal7h';
  $('tLab').checked = s.pauseInLab !== false;
  $('tShow').checked = s.show !== false;
  const t = state.timer || { history: [], defs: [] };
  const runs = [];
  const cur = t.state;
  if (cur && cur.startedAt) runs.push({ label: cur.finishedAt ? 'Current (finished)' : 'Current', startedAt: cur.startedAt, splits: Object.fromEntries(cur.splits.map((x) => [x.key, x.t])) });
  for (const h of t.history) runs.push({ label: h.final !== null && h.final !== undefined ? 'Finished' : 'Ended', startedAt: h.startedAt, splits: h.splits, char: h.char });
  if (!runs.length) { $('timerRuns').innerHTML = '<p class="muted">No runs yet.</p>'; return; }
  const keys = t.defs.map((d) => d);
  $('timerRuns').innerHTML = `<table class="runs"><thead><tr><th>Run</th>${keys.map((d) => `<th>${esc(d.name)}</th>`).join('')}</tr></thead><tbody>${runs.map((r) => `<tr><td>${esc(new Date(r.startedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }))}<br><span class="muted">${esc(r.label)}</span></td>${keys.map((d) => `<td>${fmtT(r.splits[d.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
$('tCompare').onchange = (e) => api.save({ timer: { comparison: e.target.value } });
$('tLab').onchange = (e) => api.save({ timer: { pauseInLab: e.target.checked } });
$('tShow').onchange = (e) => api.save({ timer: { show: e.target.checked } });
$('btnTimerReset').onclick = async () => { if (confirm('Reset the run timer? The current run is kept in the history.')) { await api.timerReset(); await load(true); } };

// ---------------- json tab ----------------
$('btnJsonApply').onclick = () => {
  try {
    draft = JSON.parse($('json').value);
    $('jsonMsg').className = 'msg ok'; $('jsonMsg').textContent = 'Applied to the editor. Save on the Build tab to keep it.';
    renderBuildForm(); changed();
  } catch (err) { $('jsonMsg').className = 'msg err'; $('jsonMsg').textContent = err.message; }
};

api.onProgress(async () => { if (!dirty) { state = await api.get(); renderStatus(); } else { const s = await api.get(); state.stepIndex = s.stepIndex; state.level = s.level; renderStatus(); } });

(async () => {
  [quests, areas] = await Promise.all([api.quests(), api.areas()]);
  await load();
  const hash = location.hash.replace('#', '');
  if (hash) showTab(hash);
})();
