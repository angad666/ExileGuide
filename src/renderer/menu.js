'use strict';
const { esc } = window.Common;
const el = document.getElementById('menu');
let entered = false;
window.guide.onMenu(({ entries, scale }) => {
  entered = false;
  el.style.setProperty('--scale', scale);
  let html = '<div class="hd">Search strings<span>1-9 or click · Esc / F3 closes</span></div>';
  let group = null;
  entries.forEach((e, i) => {
    if (e.group !== group) { html += `<div class="grp">${esc(e.group)}</div>`; group = e.group; }
    html += `<div class="it${e.here ? ' here' : ''}${e.done ? ' done' : ''}" data-i="${i}">
      <span class="k">${i < 9 ? i + 1 : ''}</span>
      <div class="body"><div class="lbl">${esc(e.label)}${e.here ? ' ← now' : ''}</div><div class="s">${esc(e.search)}</div></div></div>`;
  });
  el.innerHTML = html;
  window.guide.menuResize(el.getBoundingClientRect().height + 2);
});
el.addEventListener('click', (e) => {
  const it = e.target.closest('[data-i]');
  if (it) window.guide.menuPick(+it.dataset.i);
});
el.addEventListener('mouseenter', () => { entered = true; });
el.addEventListener('mouseleave', () => { if (entered) window.guide.menuClose(); });
