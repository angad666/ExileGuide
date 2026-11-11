'use strict';
const { esc, renderTokens, renderGemBlocks, renderNotes } = window.Common;
const root = document.getElementById('root');

const KEY_LABEL = (a) => (a || '').replace(/Control\+/g, 'Ctrl+').replace(/num(\d)/g, 'Num$1')
  .replace('numdiv', 'Num/').replace('nummult', 'Num*').replace('numsub', 'Num-').replace('numadd', 'Num+').replace('numdec', 'Num.');

// ---------------- run timer ----------------
let timer = null;
const fmt = (ms, long) => {
  const t = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p2 = (n) => String(n).padStart(2, '0');
  return h || long ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`;
};
const fmtDelta = (ms) => `${ms <= 0 ? '\u2212' : '+'}${fmt(ms)}`;
const elapsedNow = (t) => Math.max(0, (t.finishedAt ?? t.pausedAt ?? Date.now()) - t.startedAt - t.pausedMs);

function timerHtml(t, hotkeys) {
  if (!t || !t.show) return '';
  if (!t.startedAt) {
    return `<div class="timer idle"><span class="tm-main">0:00:00</span><span class="tm-info">Starts in The Twilight Strand · ${esc(KEY_LABEL(hotkeys.timerPause))} starts it now</span></div>`;
  }
  const last = t.splits[t.splits.length - 1];
  let mid;
  if (t.current) {
    const target = t.current.target !== null ? `<span class="tm-target" title="${esc(t.comparison || '')}">${esc(t.comparison || '')} ${fmt(t.current.target, true)}</span>` : '';
    mid = `<span class="tm-seg">${esc(t.current.name)} <b id="tmSeg"></b></span>${target}`;
  } else {
    mid = `<span class="tm-seg done">Finished</span>`;
  }
  const status = t.pausedAt ? `<span class="tm-paused">${t.pauseReason === 'lab' ? 'lab · paused' : 'paused'}</span>` : '';
  const lastHtml = last
    ? `<span class="tm-last ${last.delta === null ? '' : last.delta <= 0 ? 'ahead' : 'behind'}" title="${esc(last.name)} at ${fmt(last.t, true)}">${esc(last.name)} ${last.delta === null ? fmt(last.t, true) : fmtDelta(last.delta)}</span>`
    : '';
  const state = t.finishedAt ? 'finished' : t.pausedAt ? 'paused' : 'running';
  return `<div class="timer ${state}"><span class="tm-main" id="tmMain">${fmt(elapsedNow(t), true)}</span>${mid}${status}<span class="spacer"></span>${lastHtml}</div>`;
}

function tick() {
  const t = timer;
  if (!t || !t.startedAt) return;
  const main = document.getElementById('tmMain');
  if (!main) return;
  const e = elapsedNow(t);
  main.textContent = fmt(e, true);
  const seg = document.getElementById('tmSeg');
  if (seg && t.current) seg.textContent = fmt(e - t.current.since);
  const box = main.parentElement;
  const behind = t.current && t.current.target !== null && e > t.current.target;
  box.classList.toggle('behind', !!behind);
}
setInterval(tick, 250);

function gemHtml(g) {
  const cls = ['g', g.attr || '', g.support ? 'support' : '', g.status].join(' ');
  const where = g.status === 'soon' && g.where ? ` <span class="where">(${esc(g.where)})</span>` : '';
  const now = g.status === 'now' ? ' ←' : '';
  const title = g.status === 'missing' ? 'Not available from campaign quests/vendors for this class' : (g.where || '');
  return `<span class="${cls}" title="${esc(title)}">${esc(g.name.replace(/ Support$/, ''))}${now}${where}</span>`;
}

function render(s) {
  if (!s || !s.view) { root.innerHTML = '<div id="loading">No build loaded. Right-click the tray icon → Build &amp; Settings.</div>'; return; }
  const { view: v, settings, char, flash, logStatus } = s;
  const o = settings.overlay;
  document.documentElement.style.setProperty('--opacity', o.opacity);
  root.style.setProperty('--scale', o.scale || 1);
  root.classList.toggle('unlocked', !settings.locked);

  const step = v.step;
  const pct = ((v.stepIndex + 1) / v.totalSteps) * 100;
  const level = char.level || v.level;
  let html = '';

  html += `<div class="hdr">
    <span class="act">${esc(v.section)}</span>
    <span class="zone">${esc(v.area.name)}</span>
    <span class="meta">Lv <b>${level}</b>${v.area.level && !v.area.town ? ` · zone ${v.area.level}` : ''} · ${v.stepIndex + 1}/${v.totalSteps}</span>
  </div><div class="progress"><div style="width:${pct.toFixed(1)}%"></div></div>`;
  timer = s.timer;
  html += timerHtml(s.timer, settings.hotkeys);

  if (flash) html += `<div class="flash">${esc(flash)}</div>`;
  if (logStatus && logStatus.ok === false) html += `<div class="warn">${esc(logStatus.error || 'Client.txt not readable')}. Auto-advance is off. Fix the path in Settings.</div>`;

  // current step
  html += `<div class="sec">
    <div class="cur"><span class="arrow">▶</span>${renderTokens(step.tokens)}</div>
    ${step.subs.length ? `<div class="subs">${step.subs.map((t) => `<div>${renderTokens(t)}</div>`).join('')}</div>` : ''}
    ${step.gems.length || step.notes.length ? `<div class="actions">${renderGemBlocks(step.gems, { copyable: true })}${renderNotes(step.notes, { copyable: true })}</div>` : ''}`;

  const n = Math.max(0, o.showUpcoming ?? 2);
  const ups = v.upcoming.slice(0, n);
  if (ups.length) {
    html += `<div class="upcoming">${ups.map((u, k) => {
      const tags = [];
      if (u.gems.some((g) => g.kind === 'take')) tags.push('<span class="tag" style="color:var(--take);border-color:rgba(127,214,127,.4)">TAKE</span>');
      if (u.gems.some((g) => g.kind === 'buy')) tags.push('<span class="tag">BUY</span>');
      if (u.notes.length) tags.push('<span class="tag" style="color:var(--note);border-color:rgba(159,198,255,.4)">NOTE</span>');
      return `<div class="u"><span class="n">${k + 1}</span><span>${renderTokens(u.tokens)}</span>${tags.join('')}</div>`;
    }).join('')}</div>`;
  }
  if (v.nextZone && !step.tokens.some((t) => t.id === v.nextZone.id)) {
    html += `<div class="nextzone">Next zone: <span class="t-area">${esc(v.nextZone.name)}</span></div>`;
  }
  html += `</div>`;

  // links + gear
  if (!o.compact && v.stage) {
    const st = v.stage;
    if (o.showLinks !== false && st.links.length) {
      html += `<div class="sec"><div class="sec-title">Links <span class="sub">${esc(st.title)}${st.tree ? '' : ''}</span>
        <span class="spacer"></span>${st.auto ? '' : '<span class="pill">manual</span>'}
        ${st.next ? `<span class="sub">next: ${esc(st.next.title)} @${st.next.from}</span>` : ''}</div>
        ${st.links.map((l) => {
          // PoB labels usually just repeat the skill name; only show labels that add information
          const first = (l.gems[0]?.name || '').replace(/ Support$/, '').toLowerCase();
          const label = l.label && l.label.replace(/ Support$/, '').toLowerCase() !== first ? `<span class="lbl" title="${esc(l.label)}">${esc(l.label)}</span>` : '';
          return `<div class="link${l.isNew ? ' new' : ''}">${l.isNew ? '<span class="newdot" title="New in this stage">●</span>' : '<span class="newdot"></span>'}${label}
          <span class="gems">${l.gems.map(gemHtml).join('<span class="sep">–</span>')}</span></div>`;
        }).join('')}
      </div>`;
    }
    if (o.showGear !== false && (st.gear.length || v.milestones.length || st.notes.length)) {
      const main = st.gear.filter((g) => !/^Flask/.test(g.slot));
      const flasks = st.gear.filter((g) => /^Flask/.test(g.slot));
      html += `<div class="sec gear"><div class="sec-title">Gear <span class="sub">${esc(st.title)}</span></div>
        ${main.map((g) => {
          const mods = g.mods && g.mods.length ? `<div class="mods">${esc(g.mods.slice(0, 3).join(' · '))}</div>` : '';
          const name = g.rarity === 'rare' ? `Rare ${g.name}` : g.name;
          const sock = g.sockets ? ` <span class="t-dim">${esc(g.sockets)}</span>` : '';
          return `<div class="it"><span class="slot">${esc(g.slot)}</span><span class="name"><span class="${esc(g.rarity)}">${esc(name)}</span>${sock}${g.isNew ? '<span class="new">NEW</span>' : ''}${mods}</span></div>`;
        }).join('')}
        ${flasks.length ? `<div class="flasks">Flasks: ${esc(flasks.map((f) => f.name.replace(/ Flask.*$/, '')).join(', '))}</div>` : ''}
        ${st.notes.map((t) => `<div class="mile">${esc(t)}</div>`).join('')}
        ${v.milestones.map((m) => `<div class="mile${m.upcoming ? ' upcoming-m' : ''}"><span class="lv">Lv${m.level ?? 1}${m.slot ? ' ' + esc(m.slot) : ''}</span>${esc(m.text)}${m.search ? ` <span class="chip copy" data-copy="${esc(m.search)}">${esc(m.search)}</span>` : ''}</div>`).join('')}
      </div>`;
    }
  }

  html += `<div class="footer">
    <button data-act="prevZone" title="Previous zone">⏮</button>
    <button data-act="prevStep" title="Previous step">◀</button>
    <button data-act="nextStep" title="Next step">▶</button>
    <button data-act="nextZone" title="Next zone">⏭</button>
    <button data-act="cycleStage" title="Cycle build stage">Stage</button>
    <button data-act="timerPause" title="Start / pause / resume the timer">⏱</button>
    <button data-act="toggleDetails" title="Compact mode">${o.compact ? 'Details' : 'Compact'}</button>
    <span class="spacer"></span>
    <button data-act="openSettings" title="Build & settings">⚙</button>
    <button data-act="toggleLock" title="Lock (click-through)">🔒</button>
  </div>`;
  if (!settings.locked) {
    const h = settings.hotkeys;
    html += `<div class="hint">${esc(KEY_LABEL(h.prevStep))}/${esc(KEY_LABEL(h.nextStep))} step · ${esc(KEY_LABEL(h.pasteSearch))} paste search · ${esc(KEY_LABEL(h.cycleStage))} stage · ${esc(KEY_LABEL(h.timerPause))} timer · ${esc(KEY_LABEL(h.toggleLock))} lock</div>`;
  }

  root.innerHTML = html;
  tick();
}

root.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (btn) { window.guide.action(btn.dataset.act); return; }
  const chip = e.target.closest('[data-copy]');
  if (chip) window.guide.copy(chip.dataset.copy);
});

let lastH = 0;
new ResizeObserver(() => {
  const h = Math.ceil(root.getBoundingClientRect().height * 1) + 2;
  if (h !== lastH) { lastH = h; window.guide.resize(h); }
}).observe(root);

window.guide.onState(render);
window.guide.ready();
