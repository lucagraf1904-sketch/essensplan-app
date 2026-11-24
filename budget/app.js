// Haushaltskasse: Hauptmodul. Ansichten, Schnellerfassung, Fixkosten, Versicherungen, Auswertung, Einstellungen.
import { SUPABASE_URL } from '../config.js';
import { createSupabaseStore, createDemoStore } from './store.js';
import { EXPENSE_GROUPS, INCOME_GROUPS, cat, group, groupOf, subsOf, catPath, groupsFor, setCustomCategories } from './categories.js';
import {
  parseAmount, eur, amountInput, todayIso, addDays, addMonths, isIso, FREQS, monthlyCents, occurrences, nextFrom,
  monthKey, monthRange, shiftMonth, monthName, monthShort, dayLabel, dateShort, dateShortNoYear, monthSummary, budgetLevel,
  noticeInfo, matches, toCsv, topCategories, guessCategory, diffDays,
} from './logic.js';
import { columns, diverging, band } from './charts.js';
import { initChat, readPolicyFile, splitPastedText, photoToDataUrl } from './policies.js';

const VERSION = 'v1';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => crypto.randomUUID?.() ?? 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2);

const state = { tx: [], recurring: [], policies: [], config: { limits: {}, custom: [] }, today: todayIso(), month: todayIso().slice(0, 7), view: 'home',
  txFilter: { q: '', kind: 'all', group: '' }, statsRange: 6, statsTable: false };
let store = null, chat = null;
const saving = new Map(); // Buchungs-ID → laufendes Speichern (Rückgängig wartet darauf)

// ---------- Kleine Helfer ----------
let toastTimer = null;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button">${esc(action.label)}</button>` : '');
  if (action) t.querySelector('button').onclick = () => { t.classList.remove('show'); action.fn(); };
  t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6000 : 3200);
}
function ask(title, html, buttons = [{ value: 'ok', label: 'OK', cls: 'primary' }]) {
  return new Promise(res => {
    const d = $('#dlg-ask');
    $('#ask-title').textContent = title; $('#ask-body').innerHTML = html;
    $('#ask-btns').innerHTML = buttons.map(b => `<button class="btn ${b.cls ?? ''}" value="${esc(b.value)}">${esc(b.label)}</button>`).join('');
    d.onclose = () => res(d.returnValue || '');
    d.returnValue = ''; d.showModal();
  });
}
const confirmDelete = async what => (await ask(`${what} löschen?`, '<p>Das lässt sich nicht rückgängig machen.</p>', [{ value: '', label: 'Abbrechen' }, { value: 'yes', label: 'Löschen', cls: 'danger' }])) === 'yes';
const amountClass = t => t.kind === 'income' ? 'amt-in' : '';
const signed = t => (t.kind === 'income' ? '+' : '−') + eur(t.amount).replace('-', '');
const setSync = (text, warn = false) => { const s = $('#sync'); s.textContent = text; s.classList.toggle('warn', warn); };

// ---------- Warteschlange für Buchungen ohne Netz ----------
const OUTBOX = 'haushaltskasse.outbox';
const outbox = { get: () => { try { return JSON.parse(localStorage.getItem(OUTBOX)) ?? []; } catch { return []; } }, set: l => localStorage.setItem(OUTBOX, JSON.stringify(l)) };
function queue(op) { op.user = store.me(); const l = outbox.get().filter(x => (x.tx?.id ?? x.id) !== (op.tx?.id ?? op.id)); l.push(op); outbox.set(l); showOutbox(); }
function showOutbox() { const n = store?.mode === 'supabase' ? outbox.get().length : 0; setSync(n ? `${n} ${n === 1 ? 'Änderung wartet' : 'Änderungen warten'} auf Netz` : '', !!n); }
async function flushOutbox() {
  if (store.mode !== 'supabase') return;
  const l = outbox.get(); if (!l.length) return;
  const rest = [], failed = [];
  for (const op of l) {
    if (op.user && op.user !== store.me()) continue; // Warteschlange einer anderen Person auf diesem Gerät: nie in diesen Haushalt schreiben
    try { if (op.op === 'save') await store.saveTx(op.tx); else await store.deleteTx(op.id); }
    catch (e) { rest.push({ ...op, fails: (op.fails ?? 0) + (e.offline ? 0 : 1), lastError: e.message }); if (!e.offline) failed.push(e.message); }
  }
  outbox.set(rest); showOutbox();
  if (failed.length) {
    const v = await ask('Buchungen nicht gespeichert', `<p>${rest.length} unterwegs erfasste ${rest.length === 1 ? 'Änderung konnte' : 'Änderungen konnten'} nicht gespeichert werden: ${esc(failed[0])}</p><p class="tiny muted">Sie bleiben vorerst auf dem Handy und werden beim nächsten Öffnen erneut gesendet.</p>`,
      [{ value: 'drop', label: 'Verwerfen', cls: 'danger' }, { value: '', label: 'Später erneut', cls: 'primary' }]);
    if (v === 'drop') { outbox.set([]); showOutbox(); scheduleReload(); }
  }
}

// ---------- Daten laden ----------
async function loadAll({ book = true } = {}) {
  if (book) { try { const n = await store.bookDue(); if (n && !(store.mode === 'demo' && n > 20)) toast(`${n} ${n === 1 ? 'Fixkosten-Buchung' : 'Fixkosten-Buchungen'} automatisch eingetragen`); } catch (e) { if (!e.offline) throw e; } }
  await flushOutbox();
  const since = addMonths(state.today.slice(0, 7) + '-01', -24);
  const [tx, recurring, policies, config] = await Promise.all([store.listTx(since), store.listRecurring(), store.listPolicies(), store.getConfig()]);
  // Noch nicht gesendete Buchungen sichtbar lassen
  const pending = outbox.get().filter(o => !o.user || o.user === store.me());
  const del = new Set(pending.filter(o => o.op === 'delete').map(o => o.id));
  const saves = new Map(pending.filter(o => o.op === 'save').map(o => [o.tx.id, o.tx]));
  state.tx = [...saves.values(), ...tx.filter(t => !del.has(t.id) && !saves.has(t.id))].sort(byDateDesc);
  state.recurring = recurring; state.policies = policies;
  state.config = { limits: {}, custom: [], ...config };
  setCustomCategories(state.config.custom);
  chat?.clearCache();
  saveSnapshot();
}
// Letzter Stand für unterwegs ohne Netz (13 Monate Buchungen, ohne Seitentexte der Policen)
const SNAP = 'haushaltskasse.snapshot';
function saveSnapshot() {
  if (store.mode !== 'supabase') return;
  const since = addMonths(state.today.slice(0, 7) + '-01', -13);
  try { localStorage.setItem(SNAP, JSON.stringify({ at: new Date().toISOString(), user: store.me(), household: store.household(), tx: state.tx.filter(t => t.date >= since), recurring: state.recurring, policies: state.policies, config: state.config })); }
  catch { /* Speicher voll: dann eben ohne Offline-Stand */ }
}
function loadSnapshot() { try { return JSON.parse(localStorage.getItem(SNAP)); } catch { return null; } }
const byDateDesc = (a, b) => b.date.localeCompare(a.date) || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));

let reloadTimer = null;
function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(async () => { try { await loadAll({ book: false }); render(); } catch (e) { console.warn(e); } }, 500); }

// ---------- Navigation ----------
function show(view) {
  state.view = view;
  $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + view));
  $$('.tabs button').forEach(b => { if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('#fab').classList.toggle('hidden', view === 'ins');
  render(); window.scrollTo({ top: 0 });
}
function render() {
  $('#m-label').textContent = monthName(state.month);
  $('#m-next').disabled = state.month >= shiftMonth(state.today.slice(0, 7), 12);
  const fn = { home: renderHome, tx: renderTx, fixed: renderFixed, ins: renderIns, stats: renderStats }[state.view];
  fn?.();
}
const summary = (key = state.month) => monthSummary({ tx: state.tx, recurring: state.recurring, key, today: state.today, groupOf });

// ---------- Übersicht ----------
function deadlines(days = 60) {
  const out = [], seenPolicy = new Set();
  for (const p of state.policies) {
    const n = noticeInfo(p.contractEnd, p.noticeMonths, state.today);
    if (n && n.daysLeft <= days) { out.push({ name: p.name, icon: cat(p.category).icon, ...n, open: () => openPolicy(p) }); seenPolicy.add(p.id); }
  }
  for (const r of state.recurring) {
    if (!r.active || (r.policyId && seenPolicy.has(r.policyId))) continue;
    const pol = r.policyId && state.policies.find(p => p.id === r.policyId);
    const n = noticeInfo(r.contractEnd ?? pol?.contractEnd, r.noticeMonths ?? pol?.noticeMonths, state.today);
    if (n && n.daysLeft <= days) out.push({ name: r.name, icon: cat(r.category).icon, ...n, open: () => openRec(r) });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

function txItem(t) {
  const c = cat(t.category);
  return `<li><button class="item" data-tx="${esc(t.id)}">
    <span class="ic" aria-hidden="true">${c.icon}</span>
    <span><span class="t">${esc(t.note || c.label)}</span><span class="s">${esc(t.note ? catPath(t.category) : group(c.group)?.label ?? '')}${t.recurringId || t.source === 'recurring' ? ' · Fixkosten' : ''}${t.source === 'receipt' ? ' · Bon' : ''}</span></span>
    <span class="a ${amountClass(t)}">${signed(t)}</span></button></li>`;
}

function renderHome() {
  const s = summary(), cur = state.month === state.today.slice(0, 7), past = state.month < state.today.slice(0, 7);
  const mName = monthName(state.month).split(' ')[0];
  let bandHtml;
  if (!s.plannedIncome) {
    bandHtml = `<div class="band">
      <p class="band-label">Ausgegeben im ${esc(mName)}</p>
      <p class="band-value">${eur(s.expense)}</p>
      <p class="band-sub">${s.pendingExpense ? `Dazu kommen noch ${eur(s.pendingExpense)} Fixkosten. ` : ''}Trag dein Einkommen als regelmäßige Einnahme ein, dann siehst du hier, wie viel noch frei ist.</p>
      <p style="margin-top:10px"><button class="btn link" data-act="add-income">Einkommen eintragen</button></p></div>`;
  } else {
    const label = cur ? `Noch frei im ${mName}` : past ? `Übrig geblieben im ${mName}` : `Voraussichtlich frei im ${mName}`;
    let sub = '';
    if (cur && s.free > 0) sub = `Etwa ${eur(s.perDay)} pro Tag für die restlichen ${s.daysLeft} ${s.daysLeft === 1 ? 'Tag' : 'Tage'}.`;
    else if (s.free < 0) sub = `${eur(-s.free)} mehr ausgegeben als eingenommen.`;
    else if (past) sub = s.free > 0 ? 'Gut gemacht. Den Rest kannst du sparen.' : 'Einnahmen und Ausgaben gleichen sich aus.';
    else if (!cur) sub = 'Fixkosten und erwartete Einnahmen eingerechnet.';
    bandHtml = `<div class="band">
      <p class="band-label">${esc(label)}</p>
      <p class="band-value ${s.free < 0 ? 'neg' : ''}">${s.free < 0 ? '−' : ''}${eur(Math.abs(s.free))}</p>
      <p class="band-sub">${esc(sub)}</p>
      ${band({ spent: s.expense, pending: s.pendingExpense, total: s.plannedIncome, progress: cur ? (s.dayIndex - 0.5) / s.days : null })}
      <div class="band-legend"><span><i class="k-spent"></i>Ausgegeben ${eur(s.expense)}</span>${s.pendingExpense ? `<span><i class="k-pending"></i>Fixkosten offen ${eur(s.pendingExpense)}</span>` : ''}<span><i class="k-free"></i>Frei ${eur(Math.max(0, s.free))}</span></div>
      <details><summary class="tiny" style="cursor:pointer;margin-top:10px;opacity:.9">So rechnet die App</summary>
      <dl class="band-math">
        <dt>Einnahmen${s.pendingIncome ? ' (inkl. erwartet)' : ''}</dt><dd>${eur(s.plannedIncome)}</dd>
        <dt>Ausgaben bisher${s.fixedBooked ? `, davon Fixkosten ${eur(s.fixedBooked)}` : ''}</dt><dd>−${eur(s.expense)}</dd>
        ${s.pendingExpense ? `<dt>Fixkosten noch offen</dt><dd>−${eur(s.pendingExpense)}</dd>` : ''}
        <dt class="sum">Frei</dt><dd class="sum">${s.free < 0 ? '−' : ''}${eur(Math.abs(s.free))}</dd>
      </dl></details></div>`;
  }

  // Fristen
  const dl = deadlines();
  const alerts = dl.map((d, i) => `<div class="alert ${d.daysLeft <= 14 ? 'bad' : ''}"><span aria-hidden="true">${d.icon}</span>
    <span><b>${esc(d.name)}: kündbar bis ${dateShort(d.deadline)}</b><span class="tiny">${d.daysLeft === 0 ? 'Heute ist der letzte Tag.' : `Noch ${d.daysLeft} ${d.daysLeft === 1 ? 'Tag' : 'Tage'}`}. Vertrag läuft bis ${dateShort(d.end)}.</span></span>
    <button class="btn small" data-deadline="${i}">Ansehen</button></div>`).join('');

  // Budgets
  const limits = state.config.limits ?? {};
  const limited = EXPENSE_GROUPS.filter(g => limits[g.id] > 0);
  const pace = cur ? (s.dayIndex - 0.5) / s.days : null;
  const budgets = limited.map(g => {
    const spent = s.byGroup[g.id] ?? 0, pend = s.pendingByGroup[g.id] ?? 0, lim = limits[g.id];
    const { level } = budgetLevel(spent + pend, lim);
    const left = lim - spent - pend;
    const note = level === 'over' ? `${eur(-left)} über dem Budget` : level === 'warn' ? `Nur noch ${eur(left)} übrig` : `Noch ${eur(left)} frei`;
    const icon = level === 'over' ? '⚠️ ' : level === 'warn' ? '⚠️ ' : '';
    return `<li><button class="budget item" style="display:grid;grid-template-columns:1fr" data-group="${g.id}">
      <span class="budget-top"><b>${g.icon} ${esc(g.label)}</b><span>${eur(spent)} von ${eur(lim)}</span></span>
      <span class="meter ${level === 'ok' ? '' : level}"><i style="width:${Math.min(100, 100 * spent / lim)}%"></i>${pend ? `<i class="pend" style="left:${Math.min(100, 100 * spent / lim)}%;width:${Math.max(0, Math.min(100 - 100 * spent / lim, 100 * pend / lim))}%"></i>` : ''}${pace != null ? `<span class="pace" style="left:${100 * pace}%"></span>` : ''}</span>
      <span class="budget-note ${level === 'ok' ? '' : level}">${icon}${note}${pend ? ` · inkl. ${eur(pend)} Fixkosten, die noch kommen` : ''}</span></button></li>`;
  }).join('');

  // Demnächst fällig (14 Tage)
  const until = addDays(state.today, 14);
  const upcoming = state.recurring.flatMap(r => occurrences(r, addDays(state.today, 1), until).map(d => ({ d, r }))).sort((a, b) => a.d.localeCompare(b.d)).slice(0, 8);
  const recent = state.tx.filter(t => monthKey(t.date) === state.month).slice(0, 5);

  $('#view-home').innerHTML = bandHtml
    + (alerts ? `<div class="section-head"><h2>Fristen</h2></div>${alerts}` : '')
    + `<div class="section-head"><h2>Budgets</h2><button class="btn link" data-act="limits">${limited.length ? 'Ändern' : 'Festlegen'}</button></div>`
    + (limited.length ? `<ul class="list">${budgets}</ul><p class="tiny muted" style="margin:6px 4px 0">${pace != null ? 'Der Strich zeigt, wie weit der Monat ist. Liegt der Balken davor, bist du im Plan.' : ''}</p>`
      : `<div class="card empty"><p>Lege fest, wie viel du im Monat z. B. für Lebensmittel oder Essen gehen ausgeben willst. Die App warnt, bevor es knapp wird.</p><button class="btn primary" data-act="limits">Budgets festlegen</button></div>`)
    + `<div class="section-head"><h2>In den nächsten 14 Tagen</h2><button class="btn link" data-act="fixed">Fixkosten</button></div>`
    + (upcoming.length ? `<ul class="list">${upcoming.map(({ d, r }) => `<li><button class="item" data-rec="${esc(r.id)}"><span class="ic" aria-hidden="true">${cat(r.category).icon}</span>
        <span><span class="t">${esc(r.name)}</span><span class="s">${esc(dayLabel(d, state.today))}</span></span><span class="a ${r.kind === 'income' ? 'amt-in' : ''}">${r.kind === 'income' ? '+' : '−'}${eur(r.amount)}</span></button></li>`).join('')}</ul>`
      : `<div class="card empty"><p>In den nächsten zwei Wochen ist nichts fällig.</p>${state.recurring.length ? '' : '<button class="btn" data-act="add-rec">Fixkosten eintragen</button>'}</div>`)
    + `<div class="section-head"><h2>Letzte Buchungen</h2>${recent.length ? '<button class="btn link" data-act="tx">Alle</button>' : ''}</div>`
    + (recent.length ? `<ul class="list">${recent.map(txItem).join('')}</ul>` : `<div class="card empty"><p>In diesem Monat ist noch nichts gebucht.</p><button class="btn primary" data-act="add">Erste Ausgabe erfassen</button></div>`);

  $('#view-home').querySelectorAll('[data-deadline]').forEach(b => b.onclick = () => dl[+b.dataset.deadline].open());
}

// ---------- Buchungen ----------
function renderTx() {
  const f = state.txFilter;
  const list = (f.q ? state.tx : state.tx.filter(t => monthKey(t.date) === state.month))
    .filter(t => f.kind === 'all' || t.kind === f.kind)
    .filter(t => !f.group || groupOf(t.category) === f.group)
    .filter(t => !f.q || matches(`${t.note} ${catPath(t.category)} ${eur(t.amount)} ${dateShort(t.date)}`, f.q));
  const sumE = list.filter(t => t.kind === 'expense').reduce((a, t) => a + t.amount, 0);
  const sumI = list.filter(t => t.kind === 'income').reduce((a, t) => a + t.amount, 0);
  const days = new Map();
  for (const t of list) { if (!days.has(t.date)) days.set(t.date, []); days.get(t.date).push(t); }
  const groups = [...EXPENSE_GROUPS, ...INCOME_GROUPS];
  const head = `<div class="stack" style="margin-top:6px">
    <input type="search" id="tx-q" placeholder="Suchen: Notiz, Kategorie, Betrag" value="${esc(f.q)}" aria-label="Buchungen durchsuchen" enterkeyhint="search">
    <div class="row wrap">
      <div class="seg small" role="radiogroup" aria-label="Art">
        ${[['all', 'Alle'], ['expense', 'Ausgaben'], ['income', 'Einnahmen']].map(([v, l]) => `<label><input type="radio" name="txk" value="${v}" ${f.kind === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
      </div>
      <select id="tx-g" aria-label="Kategorie" style="flex:1;min-width:150px">
        <option value="">Alle Kategorien</option>${groups.map(g => `<option value="${g.id}" ${f.group === g.id ? 'selected' : ''}>${g.icon} ${esc(g.label)}</option>`).join('')}
      </select>
    </div>
    <p class="tiny muted">${f.q ? `Suche in allen Monaten · ${list.length} Treffer` : esc(monthName(state.month))} · Ausgaben ${eur(sumE)}${sumI ? ` · Einnahmen ${eur(sumI)}` : ''}</p>
  </div>`;
  const body = list.length ? [...days.entries()].map(([d, ts]) => {
    const e = ts.filter(t => t.kind === 'expense').reduce((a, t) => a + t.amount, 0);
    return `<div class="day-head"><span>${esc(dayLabel(d, state.today))}${f.q ? ' · ' + dateShort(d) : ''}</span><span>${e ? '−' + eur(e) : ''}</span></div><ul class="list">${ts.map(txItem).join('')}</ul>`;
  }).join('') : `<div class="card empty" style="margin-top:14px"><p>${f.q || f.group || f.kind !== 'all' ? 'Keine Buchung passt zum Filter.' : 'In diesem Monat ist noch nichts gebucht.'}</p>${f.q || f.group || f.kind !== 'all' ? '<button class="btn" data-act="clear-filter">Filter zurücksetzen</button>' : '<button class="btn primary" data-act="add">Ausgabe erfassen</button>'}</div>`;
  const hadFocus = document.activeElement?.id === 'tx-q', pos = hadFocus ? document.activeElement.selectionStart : 0;
  $('#view-tx').innerHTML = head + body;
  if (hadFocus) { const q = $('#tx-q'); q.focus(); q.setSelectionRange(pos, pos); }
  $('#tx-q').oninput = e => { state.txFilter.q = e.target.value; renderTx(); };
  $$('[name=txk]').forEach(r => r.onchange = () => { state.txFilter.kind = r.value; renderTx(); });
  $('#tx-g').onchange = e => { state.txFilter.group = e.target.value; renderTx(); };
}

// ---------- Fixkosten ----------
function recItem(r) {
  const c = cat(r.category), pol = r.policyId && state.policies.find(p => p.id === r.policyId);
  const n = noticeInfo(r.contractEnd ?? pol?.contractEnd, r.noticeMonths ?? pol?.noticeMonths, state.today);
  const nb = n ? `<span class="badge ${n.daysLeft <= 14 ? 'bad' : n.daysLeft <= 60 ? 'warn' : ''}">kündbar bis ${dateShortNoYear(n.deadline)}${n.deadline.slice(0, 4) !== state.today.slice(0, 4) ? n.deadline.slice(0, 4) : ''}</span>` : '';
  const sub = r.active ? `${FREQS[r.freq].label} · nächste ${r.nextDue.slice(0, 4) === state.today.slice(0, 4) ? dateShortNoYear(r.nextDue) : dateShort(r.nextDue)}` : `beendet${r.endDate ? ' am ' + dateShort(r.endDate) : ''}`;
  return `<li><button class="item" data-rec="${esc(r.id)}"><span class="ic" aria-hidden="true">${c.icon}</span>
    <span><span class="t">${esc(r.name)}</span><span class="s">${esc(sub)}</span>${nb ? `<span style="display:block;margin-top:3px">${nb}</span>` : ''}</span>
    <span class="a ${r.kind === 'income' ? 'amt-in' : ''}">${eur(r.amount)}<small>${r.freq === 'monthly' ? 'im Monat' : `≈ ${eur(monthlyCents(r))}/Monat`}</small></span></button></li>`;
}
function renderFixed() {
  const act = state.recurring.filter(r => r.active), ended = state.recurring.filter(r => !r.active);
  const exp = act.filter(r => r.kind === 'expense'), inc = act.filter(r => r.kind === 'income');
  const mExp = exp.reduce((a, r) => a + monthlyCents(r), 0), mInc = inc.reduce((a, r) => a + monthlyCents(r), 0);
  const ins = exp.filter(r => groupOf(r.category) === 'versicherung').reduce((a, r) => a + monthlyCents(r), 0);
  const nonMonthly = exp.filter(r => r.freq !== 'monthly').reduce((a, r) => a + monthlyCents(r), 0);
  const byGroup = new Map();
  for (const r of [...exp].sort((a, b) => monthlyCents(b) - monthlyCents(a))) { const g = groupOf(r.category); if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(r); }
  const ordered = EXPENSE_GROUPS.filter(g => byGroup.has(g.id));
  $('#view-fixed').innerHTML = `
    <div class="kpis" style="margin-top:6px">
      <div class="kpi"><span>Fixkosten</span><b>${eur(mExp)}</b><small>pro Monat</small></div>
      <div class="kpi"><span>Regelmäßig rein</span><b class="amt-in">${eur(mInc)}</b><small>pro Monat</small></div>
      <div class="kpi"><span>Bleibt</span><b>${mInc ? eur(mInc - mExp) : '–'}</b><small>${mInc ? 'für alles andere' : 'Einnahme fehlt'}</small></div>
    </div>
    ${nonMonthly ? `<p class="tiny muted" style="margin:10px 4px 0">Darin stecken ${eur(nonMonthly)} pro Monat für jährliche oder vierteljährliche Kosten${ins ? `, ${eur(ins)} davon für Versicherungen` : ''}. Diesen Betrag am besten monatlich zurücklegen.</p>` : ''}
    <div class="section-head"><h2>Ausgaben</h2><button class="btn link" data-act="add-rec">Hinzufügen</button></div>
    ${exp.length ? ordered.map(g => `<div class="day-head"><span>${g.icon} ${esc(g.label)}</span><span>${eur(byGroup.get(g.id).reduce((a, r) => a + monthlyCents(r), 0))}/Monat</span></div><ul class="list">${byGroup.get(g.id).map(recItem).join('')}</ul>`).join('')
      : `<div class="card empty"><p>Trag hier ein, was regelmäßig abgeht: Miete, Strom, Handy, Streaming, Versicherungen. Die App bucht es dann jeden Monat automatisch.</p><button class="btn primary" data-act="add-rec">Fixkosten eintragen</button></div>`}
    <div class="section-head"><h2>Regelmäßige Einnahmen</h2><button class="btn link" data-act="add-income">Hinzufügen</button></div>
    ${inc.length ? `<ul class="list">${inc.map(recItem).join('')}</ul>` : `<div class="card empty"><p>Gehalt, BAföG oder Nebenjob eintragen, dann weiß die App, wie viel im Monat frei ist.</p><button class="btn" data-act="add-income">Einnahme eintragen</button></div>`}
    ${ended.length ? `<div class="section-head"><h2>Beendet</h2></div><ul class="list">${ended.map(recItem).join('')}</ul>` : ''}`;
}

// ---------- Versicherungen ----------
function renderIns() {
  const ps = state.policies;
  const withText = ps.filter(p => p.pageCount > 0).length;
  const cards = ps.map(p => {
    const r = state.recurring.find(x => x.policyId === p.id && x.active) ?? state.recurring.find(x => x.policyId === p.id);
    const n = noticeInfo(p.contractEnd, p.noticeMonths, state.today);
    return `<div class="card pol">
      <div class="pol-top"><span class="ic" aria-hidden="true">${cat(p.category).icon}</span>
        <span><b>${esc(p.name)}</b><span class="tiny muted" style="display:block">${esc([cat(p.category).label, p.insurer].filter(Boolean).join(' · '))}</span></span>
        <span style="text-align:right">${r ? `<b>${eur(r.amount)}</b><span class="tiny muted" style="display:block">${FREQS[r.freq].label}</span>` : '<span class="tiny muted">kein Beitrag</span>'}</span></div>
      <div class="row wrap">
        ${p.pageCount ? `<span class="badge good">✓ Police hinterlegt · ${p.pageCount} ${p.pageCount === 1 ? 'Seite' : 'Seiten'}</span>` : '<span class="badge warn">Police fehlt</span>'}
        ${n ? `<span class="badge ${n.daysLeft <= 14 ? 'bad' : n.daysLeft <= 60 ? 'warn' : ''}">kündbar bis ${dateShort(n.deadline)}</span>` : ''}
        ${p.notes ? `<span class="tiny muted">${esc(p.notes)}</span>` : ''}
      </div>
      <div class="pol-actions">
        <button class="btn small ${p.pageCount ? 'primary' : ''}" data-ask="${esc(p.id)}" ${p.pageCount ? '' : 'disabled'}>Fragen</button>
        ${p.filePath ? `<button class="btn small" data-file="${esc(p.id)}">Police öffnen</button>` : ''}
        <button class="btn small" data-pol="${esc(p.id)}">${p.pageCount ? 'Bearbeiten' : 'Police hinzufügen'}</button>
      </div></div>`;
  }).join('');
  $('#view-ins').innerHTML = `
    <button class="ask-all" style="margin-top:6px" data-ask="" ${withText ? '' : 'disabled'}><span style="font-size:1.8rem" aria-hidden="true">💬</span>
      <span><b>Frag deine Versicherungen</b><span class="tiny">${withText ? `„Ist Marderbiss abgedeckt?“ · „Zahlt die Haftpflicht, wenn mir ein geliehenes Handy runterfällt?“ Die Antwort nennt die Seite in der Police.` : 'Hinterlege zuerst eine Police als PDF oder Foto.'}</span></span></button>
    <div class="section-head"><h2>Deine Versicherungen</h2><button class="btn link" data-act="add-pol">Hinzufügen</button></div>
    ${ps.length ? cards : `<div class="card empty"><p>Lege deine Versicherungen an, z. B. Kfz, Haftpflicht und Hausrat. Mit hinterlegter Police kannst du danach fragen, was abgedeckt ist.</p><button class="btn primary" data-act="add-pol">Versicherung anlegen</button></div>`}`;
}

// ---------- Auswertung ----------
function renderStats() {
  const n = state.statsRange, keys = Array.from({ length: n }, (_, i) => shiftMonth(state.month, i - n + 1));
  const sums = keys.map(k => summary(k));
  const curKey = state.today.slice(0, 7);
  const done = sums.filter(s => s.key < curKey);
  const avgE = done.length ? Math.round(done.reduce((a, s) => a + s.expense, 0) / done.length) : null;
  const avgI = done.length ? Math.round(done.reduce((a, s) => a + s.income, 0) / done.length) : null;
  const rate = avgI ? Math.round(100 * (avgI - avgE) / avgI) : null;
  const s = sums[sums.length - 1], prev = summary(shiftMonth(state.month, -1));
  const limits = state.config.limits ?? {};
  const rows = EXPENSE_GROUPS.map(g => ({ g, v: s.byGroup[g.id] ?? 0, p: prev.byGroup[g.id] ?? 0, lim: limits[g.id] ?? 0 })).filter(r => r.v || r.p).sort((a, b) => b.v - a.v);
  const maxV = Math.max(1, ...rows.map(r => Math.max(r.v, r.lim)));
  const fixedShare = s.expense ? Math.round(100 * s.fixedBooked / s.expense) : 0;
  $('#view-stats').innerHTML = `
    <div class="row" style="justify-content:space-between;margin-top:6px">
      <div class="seg small" role="radiogroup" aria-label="Zeitraum">${[6, 12].map(v => `<label><input type="radio" name="rng" value="${v}" ${n === v ? 'checked' : ''}><span>${v} Monate</span></label>`).join('')}</div>
      <button class="btn link" data-act="table">${state.statsTable ? 'Als Diagramm' : 'Als Tabelle'}</button>
    </div>
    <div class="kpis" style="margin-top:12px">
      <div class="kpi"><span>Ø Ausgaben</span><b>${avgE != null ? eur(avgE) : '–'}</b><small>pro Monat</small></div>
      <div class="kpi"><span>Ø Einnahmen</span><b>${avgI ? eur(avgI) : '–'}</b><small>pro Monat</small></div>
      <div class="kpi"><span>Sparquote</span><b>${rate != null ? rate + ' %' : '–'}</b><small>${done.length ? `aus ${done.length} abgeschl. Monaten` : 'noch kein ganzer Monat'}</small></div>
    </div>
    ${state.statsTable ? `<div class="card" style="margin-top:14px"><table class="data-table"><thead><tr><th>Monat</th><th>Einnahmen</th><th>Ausgaben</th><th>Plus/Minus</th></tr></thead><tbody>
      ${sums.map(x => `<tr><td>${esc(monthName(x.key))}</td><td>${eur(x.income)}</td><td>${eur(x.expense)}</td><td>${x.income - x.expense >= 0 ? '+' : '−'}${eur(Math.abs(x.income - x.expense))}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="card" style="margin-top:14px"><h2>Ausgaben je Monat</h2><p class="tiny muted">Hervorgehoben: ${esc(monthName(state.month))}${avgE ? `. Linie: Durchschnitt ${eur(avgE)} (abgeschlossene Monate)` : ''}${keys.includes(curKey) ? '. Der laufende Monat ist noch nicht fertig.' : ''}</p><div id="ch-exp" style="margin-top:8px"></div></div>
       <div class="card"><h2>Plus oder Minus je Monat</h2><p class="tiny muted">Einnahmen minus Ausgaben. Blau: Geld übrig, orange: mehr ausgegeben als eingenommen.</p><div id="ch-bal" style="margin-top:8px"></div>
       <div class="legend"><span><i style="background:var(--pos)"></i>Plus</span><span><i style="background:var(--neg)"></i>Minus</span></div></div>`}
    <div class="card"><h2>Wofür im ${esc(monthName(state.month).split(' ')[0])}</h2>
      <p class="tiny muted">${s.expense ? `${eur(s.expense)} ausgegeben, ${fixedShare} % davon Fixkosten. Vergleich mit dem Vormonat darunter.` : 'Noch keine Ausgaben in diesem Monat.'}${Object.keys(limits).length ? ' Strich = Budget.' : ''}</p>
      <div class="rank" style="margin-top:12px">${rows.map(r => {
        const d = r.v - r.p, dTxt = !r.p ? 'im Vormonat nichts' : d === 0 ? 'wie im Vormonat' : `${d > 0 ? '+' : '−'}${eur(Math.abs(d))} zum Vormonat`;
        return `<button class="rank-row" data-group="${r.g.id}" style="border:0;background:none;padding:0;text-align:left;cursor:pointer;color:inherit;font:inherit">
          <span class="lab">${r.g.icon} ${esc(r.g.label)}</span><span class="num">${eur(r.v)}</span>
          <span class="track"><i style="width:${100 * r.v / maxV}%"></i>${r.lim ? `<u style="left:${100 * r.lim / maxV}%" title="Budget ${eur(r.lim)}"></u>` : ''}</span>
          <span class="delta">${esc(dTxt)}</span></button>`;
      }).join('') || '<p class="muted">Keine Daten.</p>'}</div></div>`;
  if (!state.statsTable) {
    const hi = keys.indexOf(state.month);
    columns($('#ch-exp'), sums.map(x => ({ label: monthShort(x.key), value: x.expense, title: monthName(x.key), extra: x.fixedBooked ? `davon Fixkosten ${eur(x.fixedBooked)}` : '' })), { highlight: hi, avg: avgE });
    diverging($('#ch-bal'), sums.map(x => ({ label: monthShort(x.key), value: x.income - x.expense, title: monthName(x.key) })));
  }
  $$('[name=rng]').forEach(r => r.onchange = () => { state.statsRange = +r.value; renderStats(); });
}

// ---------- Schnellerfassung ----------
const tx = { kind: 'expense', group: null, cat: null, editing: null, catTouched: false, source: 'manual' };
function drawCats() {
  const groups = groupsFor(tx.kind);
  const recent = topCategories(state.tx, tx.kind, 5).filter(id => cat(id).group);
  $('#tx-recent').innerHTML = recent.length && !tx.editing ? recent.map(id => `<button type="button" class="chip ${tx.cat === id ? 'on' : ''}" data-cat="${esc(id)}">${cat(id).icon} ${esc(cat(id).label)}</button>`).join('') : '';
  $('#tx-groups').innerHTML = groups.length > 1 ? groups.map(g => `<button type="button" role="radio" aria-checked="${tx.group === g.id}" data-g="${g.id}"><span aria-hidden="true">${g.icon}</span>${esc(g.label)}</button>`).join('') : '';
  const subs = tx.group ? subsOf(tx.group) : [];
  $('#tx-subs').innerHTML = subs.length ? [[tx.group, groups.length > 1 ? 'Allgemein' : 'Ohne Angabe'], ...subs].map(([id, l]) => `<button type="button" class="chip ${tx.cat === id ? 'on' : ''}" aria-pressed="${tx.cat === id}" data-cat="${esc(id)}">${esc(l)}</button>`).join('') : '';
  $('#tx-save').textContent = tx.editing ? 'Änderung speichern' : tx.kind === 'income' ? 'Einnahme speichern' : 'Ausgabe speichern';
}
function setCat(id, touched = true) { tx.cat = id; tx.group = cat(id).group; if (touched) tx.catTouched = true; drawCats(); }
function openTx(t = null, preset = {}) {
  tx.editing = t; tx.kind = t?.kind ?? preset.kind ?? 'expense'; tx.cat = t?.category ?? preset.category ?? (tx.kind === 'income' ? 'einkommen' : null); tx.group = tx.cat ? cat(tx.cat).group : (tx.kind === 'income' ? 'einkommen' : null);
  tx.catTouched = !!tx.cat; tx.source = t?.source ?? 'manual';
  $$('[name=kind]').forEach(r => r.checked = r.value === tx.kind);
  $('#tx-amount').value = t ? amountInput(t.amount) : '';
  $('#tx-note').value = t?.note ?? '';
  const d = t?.date ?? state.today;
  const when = d === state.today ? 'today' : d === addDays(state.today, -1) ? 'yesterday' : 'other';
  $$('[name=when]').forEach(r => r.checked = r.value === when);
  $('#tx-date').value = d; $('#tx-date').classList.toggle('hidden', when !== 'other');
  $('#tx-delete').classList.toggle('hidden', !t);
  $('#tx-err').textContent = ''; $('#tx-photo-msg').textContent = t?.recurringId ? 'Automatisch aus den Fixkosten gebucht. Änderungen gelten nur für diese eine Buchung.' : '';
  const notes = [...new Set(state.tx.filter(x => x.note && x.source !== 'recurring').map(x => x.note))].slice(0, 60);
  $('#note-list').innerHTML = notes.map(n => `<option value="${esc(n)}">`).join('');
  drawCats();
  $('#dlg-tx').showModal();
  if (!t) setTimeout(() => $('#tx-amount').focus(), 60);
}
async function saveTxForm() {
  const amount = parseAmount($('#tx-amount').value);
  const when = $$('[name=when]').find(r => r.checked)?.value;
  const date = when === 'today' ? state.today : when === 'yesterday' ? addDays(state.today, -1) : $('#tx-date').value;
  if (!amount) { $('#tx-err').textContent = 'Bitte einen Betrag eingeben, z. B. 12,50.'; $('#tx-amount').focus(); return; }
  if (!tx.cat) { $('#tx-err').textContent = 'Bitte eine Kategorie antippen.'; return; }
  if (!isIso(date)) { $('#tx-err').textContent = 'Bitte ein gültiges Datum wählen.'; return; }
  const old = tx.editing;
  const t = { ...(old ?? {}), id: old?.id ?? uid(), date, amount, kind: tx.kind, category: tx.cat, note: $('#tx-note').value.trim(), source: old?.source ?? tx.source, createdAt: old?.createdAt ?? new Date().toISOString() };
  if (!old) { t.recurringId = null; t.dueDate = null; }
  // Sofort anzeigen, dann im Hintergrund speichern
  state.tx = [t, ...state.tx.filter(x => x.id !== t.id)].sort(byDateDesc);
  $('#dlg-tx').close(); render();
  toast(`${old ? 'Geändert' : 'Gespeichert'}: ${eur(amount)} ${cat(t.category).label}`, old ? null : { label: 'Rückgängig', fn: () => deleteTx(t, true) });
  const p = store.saveTx(t); saving.set(t.id, p.catch(() => {}));
  try { const saved = await p; state.tx = state.tx.map(x => x.id === t.id ? { ...t, ...saved } : x); }
  catch (e) {
    if (e.offline && store.mode === 'supabase') { queue({ op: 'save', tx: t }); return; }
    state.tx = old ? state.tx.map(x => x.id === t.id ? old : x) : state.tx.filter(x => x.id !== t.id); render();
    ask('Nicht gespeichert', `<p>${esc(e.message)}</p>`);
  }
}
async function deleteTx(t, silent = false) {
  if (!silent && !(await confirmDelete('Buchung'))) return;
  state.tx = state.tx.filter(x => x.id !== t.id); $('#dlg-tx').open && $('#dlg-tx').close(); render();
  if (!silent) toast('Buchung gelöscht', { label: 'Rückgängig', fn: async () => { state.tx = [t, ...state.tx].sort(byDateDesc); render(); try { await store.saveTx(t); } catch (e) { e.offline ? queue({ op: 'save', tx: t }) : ask('Nicht wiederhergestellt', esc(e.message)); } } });
  try { await saving.get(t.id); saving.delete(t.id); await store.deleteTx(t.id); } catch (e) { if (e.offline && store.mode === 'supabase') queue({ op: 'delete', id: t.id }); else { state.tx = [t, ...state.tx].sort(byDateDesc); render(); ask('Nicht gelöscht', `<p>${esc(e.message)}</p>`); } }
}
async function receiptPhoto(file) {
  const msg = $('#tx-photo-msg');
  msg.textContent = 'Bon wird gelesen …';
  try {
    const r = await store.askAi({ action: 'parse', kind: 'expense', image: await photoToDataUrl(file, 1400) });
    const d = r.data ?? {};
    if (d.total) $('#tx-amount').value = amountInput(Math.round(d.total * 100));
    if (d.merchant && !$('#tx-note').value) $('#tx-note').value = d.merchant;
    if (d.date && isIso(d.date) && d.date <= state.today && d.date >= addDays(state.today, -60)) {
      const when = d.date === state.today ? 'today' : d.date === addDays(state.today, -1) ? 'yesterday' : 'other';
      $$('[name=when]').forEach(x => x.checked = x.value === when); $('#tx-date').value = d.date; $('#tx-date').classList.toggle('hidden', when !== 'other');
    }
    const guess = guessCategory(state.tx, d.merchant, 'expense');
    if (guess) setCat(guess); else if (d.category && group(d.category)) setCat(d.category);
    tx.source = 'receipt';
    msg.textContent = d.total ? 'Bitte kurz prüfen: Betrag, Datum und Kategorie aus dem Bon übernommen.' : 'Auf dem Bon wurde keine Summe erkannt. Bitte Betrag eintippen.';
  } catch (e) { msg.textContent = e.demo ? 'In der Demo ist keine KI verbunden. Bitte Betrag eintippen.' : 'Bon nicht lesbar: ' + e.message; }
}

// ---------- Fixkosten bearbeiten ----------
let recEditing = null;
function catOptions(kind, selected) {
  return groupsFor(kind).map(g => `<optgroup label="${esc(g.label)}">${[[g.id, g.label + ' (allgemein)'], ...subsOf(g.id)].map(([id, l]) => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(l)}</option>`).join('')}</optgroup>`).join('');
}
const freqOptions = sel => Object.entries(FREQS).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v.label}</option>`).join('');
const noticeOptions = sel => [['', 'keine Angabe'], ['0', 'jederzeit'], ['1', '1 Monat'], ['2', '2 Monate'], ['3', '3 Monate'], ['6', '6 Monate'], ['12', '12 Monate']].map(([v, l]) => `<option value="${v}" ${String(sel ?? '') === v ? 'selected' : ''}>${l}</option>`).join('');
function recHint() {
  const a = parseAmount($('#rec-amount').value), f = $('#rec-freq').value, next = $('#rec-next').value;
  const parts = [];
  if (a && f !== 'monthly') parts.push(`Entspricht etwa ${eur(monthlyCents({ amount: a, freq: f }))} pro Monat.`);
  if (isIso(next) && next <= state.today) parts.push(next === state.today ? 'Heute fällig: wird beim Speichern direkt gebucht.' : `Liegt in der Vergangenheit: alle Abbuchungen seit ${dateShort(next)} werden beim Speichern nachgebucht.`);
  $('#rec-hint').textContent = parts.join(' ');
}
function openRec(r = null, preset = {}) {
  recEditing = r;
  const kind = r?.kind ?? preset.kind ?? 'expense';
  $$('[name=rkind]').forEach(x => x.checked = x.value === kind);
  $('#rec-title').textContent = r ? (kind === 'income' ? 'Regelmäßige Einnahme' : 'Fixkosten') : kind === 'income' ? 'Neue regelmäßige Einnahme' : 'Neue Fixkosten';
  $('#rec-name').value = r?.name ?? preset.name ?? '';
  $('#rec-amount').value = r ? amountInput(r.amount) : '';
  $('#rec-freq').innerHTML = freqOptions(r?.freq ?? 'monthly');
  $('#rec-cat').innerHTML = catOptions(kind, r?.category ?? preset.category ?? (kind === 'income' ? 'ei-gehalt' : ''));
  if (!r && !preset.category && kind === 'expense') $('#rec-cat').value = 'wo-miete';
  $('#rec-next').value = r?.active ? r.nextDue : r?.nextDue ?? addDays(state.today, 1);
  $('#rec-end').value = r?.endDate ?? '';
  $('#rec-cend').value = r?.contractEnd ?? '';
  $('#rec-notice').innerHTML = noticeOptions(r?.noticeMonths);
  $('#rec-contract').open = !!(r?.contractEnd || r?.noticeMonths != null);
  $('#rec-delete').classList.toggle('hidden', !r);
  $('#rec-err').textContent = '';
  const pol = r?.policyId && state.policies.find(p => p.id === r.policyId);
  recHint();
  if (pol) $('#rec-hint').textContent = `Gehört zur Versicherung „${pol.name}“. ` + $('#rec-hint').textContent;
  $('#dlg-rec').showModal();
}
async function saveRecForm() {
  const kind = $$('[name=rkind]').find(x => x.checked).value;
  const name = $('#rec-name').value.trim(), amount = parseAmount($('#rec-amount').value), freq = $('#rec-freq').value, next = $('#rec-next').value, end = $('#rec-end').value;
  const err = m => { $('#rec-err').textContent = m; };
  if (!name) return err('Bitte eine Bezeichnung eingeben.');
  if (!amount) return err('Bitte einen Betrag eingeben.');
  if (!isIso(next)) return err('Bitte das Datum der nächsten Abbuchung wählen.');
  if (end && (!isIso(end) || end < next)) return err('Die letzte Abbuchung muss nach der nächsten liegen.');
  const old = recEditing;
  const scheduleChanged = !old || old.freq !== freq || old.nextDue !== next || !old.active;
  const r = { ...(old ?? {}), name, amount, kind, freq, category: $('#rec-cat').value, endDate: end || null, contractEnd: $('#rec-cend').value || null,
    noticeMonths: $('#rec-notice').value === '' ? null : +$('#rec-notice').value, active: true,
    ...(scheduleChanged ? { startDate: next, nextDue: next, n: 0 } : {}) };
  if (next < addMonths(state.today, -24)) return err('Die nächste Abbuchung darf höchstens zwei Jahre zurückliegen.');
  try {
    await store.saveRecurring(r);
    $('#dlg-rec').close();
    await loadAll(); render();
    toast('Gespeichert');
  } catch (e) { err(e.message); }
}

// ---------- Versicherung bearbeiten ----------
let polEditing = null, polFile = null, polRead = null;
function openPolicy(p = null) {
  polEditing = p; polFile = null; polRead = null;
  const r = p && (state.recurring.find(x => x.policyId === p.id && x.active) ?? state.recurring.find(x => x.policyId === p.id));
  $('#pol-title').textContent = p ? p.name : 'Neue Versicherung';
  $('#pol-name').value = p?.name ?? '';
  $('#pol-cat').innerHTML = (group('versicherung').subs).map(([id, l]) => `<option value="${id}" ${id === (p?.category ?? 'vers-kfz') ? 'selected' : ''}>${esc(l)}</option>`).join('');
  $('#pol-insurer').value = p?.insurer ?? '';
  $('#pol-amount').value = r ? amountInput(r.amount) : '';
  $('#pol-freq').innerHTML = freqOptions(r?.freq ?? 'yearly');
  $('#pol-next').value = r?.active ? r.nextDue : '';
  $('#pol-no').value = p?.policyNo ?? '';
  $('#pol-cend').value = p?.contractEnd ?? '';
  $('#pol-notice').innerHTML = noticeOptions(p?.noticeMonths ?? (p ? null : 1));
  $('#pol-notes').value = p?.notes ?? '';
  $('#pol-text').value = '';
  $('#pol-file').value = '';
  $('#pol-file-state').textContent = p?.pageCount ? `Hinterlegt: ${p.fileName ?? 'Text'} (${p.pageCount} ${p.pageCount === 1 ? 'Seite' : 'Seiten'}${p.textSource === 'photo' ? ', per KI abgeschrieben' : p.textSource === 'manual' ? ', Text eingefügt' : ''}). Neue Datei ersetzt sie.` : p?.filePath ? `Datei hinterlegt (${p.fileName}), aber kein lesbarer Text.` : 'Noch keine Police hinterlegt. Am besten das PDF aus dem Kundenportal oder der E-Mail des Versicherers.';
  $('#pol-file-msg').textContent = ''; $('#pol-progress').classList.add('hidden');
  $('#pol-delete').classList.toggle('hidden', !p);
  $('#pol-err').textContent = '';
  $('#dlg-pol').showModal();
}
async function polFileChosen(file) {
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) { $('#pol-file-msg').textContent = 'Die Datei ist größer als 25 MB.'; return; }
  polFile = file; polRead = null;
  const bar = $('#pol-progress'), span = bar.querySelector('span'), msg = $('#pol-file-msg');
  bar.classList.remove('hidden'); span.style.width = '3%'; msg.textContent = `${file.name} wird gelesen …`;
  try {
    polRead = await readPolicyFile(file, store, {
      onProgress: p => { span.style.width = Math.round(p * 100) + '%'; },
      confirmScan: async (total, n) => (await ask('PDF ohne Text', `<p>Die Datei sieht eingescannt aus. Soll die KI die ersten ${n} von ${total} Seiten abschreiben? Das braucht ${n} der 10 Foto-Anfragen pro Tag, und die Seiten werden an einen KI-Dienst geschickt.</p>`, [{ value: '', label: 'Nein' }, { value: 'yes', label: 'Abschreiben', cls: 'primary' }])) === 'yes',
    });
    msg.textContent = polRead.note + ' Wird beim Speichern hinterlegt.';
    if (!$('#pol-name').value.trim()) $('#pol-name').value = file.name.replace(/\.[a-z]+$/i, '').replace(/[_-]+/g, ' ').slice(0, 60);
  } catch (e) {
    msg.textContent = e.demo ? 'Fotos abschreiben geht nur mit verbundener KI. In der Demo bitte ein PDF mit Text wählen oder Text einfügen.' : 'Nicht lesbar: ' + e.message + ' Die Datei wird trotzdem gespeichert; den Text kannst du unten selbst einfügen.';
  }
  bar.classList.add('hidden');
}
async function savePolicyForm() {
  const name = $('#pol-name').value.trim(), err = m => { $('#pol-err').textContent = m; };
  if (!name) return err('Bitte eine Bezeichnung eingeben.');
  const amountRaw = $('#pol-amount').value.trim(), amount = amountRaw ? parseAmount(amountRaw) : null, next = $('#pol-next').value;
  if (amountRaw && !amount) return err('Der Beitrag ist keine gültige Zahl.');
  if (amount && !isIso(next)) return err('Bitte das Datum der nächsten Abbuchung angeben, damit der Beitrag als Fixkosten gebucht wird.');
  const old = polEditing;
  const p = { ...(old ?? {}), id: old?.id ?? uid(), name, category: $('#pol-cat').value, insurer: $('#pol-insurer').value.trim(), policyNo: $('#pol-no').value.trim(),
    contractEnd: $('#pol-cend').value || null, noticeMonths: $('#pol-notice').value === '' ? null : +$('#pol-notice').value, notes: $('#pol-notes').value.trim() };
  const btn = $('#form-pol [type=submit]'); btn.disabled = true; btn.textContent = 'Speichert …';
  try {
    await store.savePolicy(p);
    const pasted = splitPastedText($('#pol-text').value);
    if (pasted.length) await store.savePolicyPages(p.id, pasted, 'manual');
    else if (polRead?.pages?.some(x => x.trim())) await store.savePolicyPages(p.id, polRead.pages, polRead.source);
    else if (polFile) await store.savePolicyPages(p.id, [], null); // neue Datei ohne lesbaren Text: alter Text passt nicht mehr dazu
    let fileErr = null;
    if (polFile) { try { await store.uploadPolicyFile(p.id, polFile); } catch (e) { fileErr = e; } }
    // Beitrag als Fixkosten
    const r = state.recurring.find(x => x.policyId === p.id && x.active) ?? state.recurring.find(x => x.policyId === p.id);
    const freq = $('#pol-freq').value;
    if (amount) {
      const changed = !r || r.freq !== freq || r.nextDue !== next || !r.active;
      await store.saveRecurring({ ...(r ?? {}), name, amount, kind: 'expense', category: p.category, freq, policyId: p.id, active: true, endDate: r?.endDate ?? null,
        contractEnd: null, noticeMonths: null, ...(changed ? { startDate: next, nextDue: next, n: 0 } : {}) });
    } else if (r && (await ask('Beitrag entfernen?', `<p>Die Fixkosten „${esc(r.name)}“ gehören zu dieser Versicherung. Sollen sie gelöscht werden? Bisherige Buchungen bleiben.</p>`, [{ value: '', label: 'Behalten' }, { value: 'yes', label: 'Löschen', cls: 'danger' }])) === 'yes') {
      await store.deleteRecurring(r.id);
    }
    $('#dlg-pol').close();
    await loadAll(); render();
    if (fileErr) ask('Datei nicht hochgeladen', `<p>Die Versicherung und der ausgelesene Text sind gespeichert, die Datei selbst aber nicht: ${esc(fileErr.message)}</p>`);
    else toast('Versicherung gespeichert');
  } catch (e) { err(e.message); }
  finally { btn.disabled = false; btn.textContent = 'Speichern'; }
}

// ---------- Einstellungen ----------
let cfgTimer = null;
function saveConfigSoon() { clearTimeout(cfgTimer); cfgTimer = setTimeout(async () => { try { await store.setConfig(state.config); setSync(''); } catch (e) { toast('Einstellungen nicht gespeichert: ' + e.message); } }, 600); }
function openSettings(focus) {
  const hh = store.household(), limits = state.config.limits ?? {};
  $('#settings-body').innerHTML = `
    <section class="set-group" id="set-limits"><h3>Budgets pro Monat</h3>
      <p class="tiny muted">Leer lassen = kein Budget. Fixkosten zählen mit, z. B. die Miete zu Wohnen.</p>
      ${EXPENSE_GROUPS.map(g => `<label class="limit-row"><span>${g.icon} ${esc(g.label)}</span><input inputmode="decimal" data-limit="${g.id}" value="${limits[g.id] ? amountInput(limits[g.id]).replace(',00', '') : ''}" placeholder="–" aria-label="Budget ${esc(g.label)} in Euro"></label>`).join('')}
    </section>
    <section class="set-group"><h3>Eigene Unterkategorien</h3>
      <p class="tiny muted">Zum Beispiel „Fußballverein“ unter Freizeit oder „Kita“ unter Kinder.</p>
      <ul class="list">${(state.config.custom ?? []).map(c => `<li class="item" style="cursor:default"><span class="ic">${cat(c.id).icon}</span><span><span class="t">${esc(c.label)}</span><span class="s">${esc(group(c.group)?.label)}</span></span><button class="btn small danger" data-del-custom="${esc(c.id)}">Entfernen</button></li>`).join('') || '<li class="item muted" style="cursor:default;grid-template-columns:1fr">Noch keine.</li>'}</ul>
      <form id="form-custom" class="grid2"><select id="custom-group" aria-label="Oberkategorie">${[...EXPENSE_GROUPS, ...INCOME_GROUPS].map(g => `<option value="${g.id}">${g.icon} ${esc(g.label)}</option>`).join('')}</select>
        <div class="row"><input id="custom-label" placeholder="Name" maxlength="40" aria-label="Name der Unterkategorie"><button class="btn">Dazu</button></div></form>
    </section>
    <section class="set-group"><h3>Haushalt</h3>
      ${store.mode === 'supabase' ? `<p>${esc(hh?.name ?? '')}</p><p class="tiny muted">Mit diesem Code tritt dein Partner oder deine Partnerin bei (in der Speisekammer oder hier beim ersten Anmelden):</p><p class="code">${esc(hh?.join_code ?? '')}</p>` : '<p class="muted">Demo: Daten bleiben nur auf diesem Gerät.</p>'}
    </section>
    <section class="set-group"><h3>Daten</h3>
      <div class="row wrap"><button class="btn" data-act="csv">Buchungen als CSV (Excel)</button><a class="btn" href="../">Zur Speisekammer</a></div>
    </section>
    <section class="set-group"><h3>Konto</h3>
      <div class="row wrap">${store.mode === 'supabase' ? '<button class="btn" data-act="logout">Abmelden</button>' : '<button class="btn" data-act="demo-reset">Beispieldaten neu laden</button><button class="btn" data-act="demo-exit">Demo beenden</button>'}</div>
      <p class="tiny muted">Haushaltskasse ${VERSION}</p>
    </section>`;
  $$('[data-limit]').forEach(inp => inp.oninput = () => {
    const v = inp.value.trim(), c = v ? parseAmount(v) : null;
    inp.setAttribute('aria-invalid', v && c == null ? 'true' : 'false');
    if (v && c == null) return;
    state.config.limits = { ...(state.config.limits ?? {}) };
    if (c) state.config.limits[inp.dataset.limit] = c; else delete state.config.limits[inp.dataset.limit];
    saveConfigSoon(); render();
  });
  $('#form-custom').onsubmit = e => {
    e.preventDefault();
    const label = $('#custom-label').value.trim(); if (!label) return;
    state.config.custom = [...(state.config.custom ?? []), { id: 'c-' + uid().slice(0, 8), label, group: $('#custom-group').value }];
    setCustomCategories(state.config.custom); saveConfigSoon(); openSettings();
  };
  $$('[data-del-custom]').forEach(b => b.onclick = () => {
    state.config.custom = (state.config.custom ?? []).filter(c => c.id !== b.dataset.delCustom);
    setCustomCategories(state.config.custom); saveConfigSoon(); openSettings();
  });
  if (!$('#dlg-settings').open) $('#dlg-settings').showModal();
  if (focus === 'limits') setTimeout(() => $('#set-limits input')?.focus(), 80);
}
function downloadCsv() {
  const blob = new Blob([toCsv(state.tx, catPath)], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `haushaltskasse-${state.today}.csv` });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- Ereignisse ----------
function bindEvents() {
  $$('.tabs button').forEach(b => b.onclick = () => show(b.dataset.view));
  $('#fab').onclick = () => openTx();
  $('#m-prev').onclick = () => { state.month = shiftMonth(state.month, -1); render(); };
  $('#m-next').onclick = () => { state.month = shiftMonth(state.month, 1); render(); };
  $('#m-label').onclick = () => { state.month = state.today.slice(0, 7); render(); };
  $('#btn-settings').onclick = () => openSettings();
  $('#btn-demo-exit').onclick = () => exitDemo();

  // Klicks in allen Ansichten und Dialogen
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-tx],[data-rec],[data-pol],[data-ask],[data-file],[data-act],[data-group]');
    if (!el || el.closest('#dlg-tx')) return;
    if (el.dataset.tx) return openTx(state.tx.find(t => t.id === el.dataset.tx));
    if (el.dataset.rec) return openRec(state.recurring.find(r => r.id === el.dataset.rec));
    if (el.dataset.pol) return openPolicy(state.policies.find(p => p.id === el.dataset.pol));
    if (el.dataset.ask !== undefined && el.hasAttribute('data-ask')) return chat.open(el.dataset.ask);
    if (el.dataset.file) { const p = state.policies.find(x => x.id === el.dataset.file); try { window.open(await store.policyFileUrl(p.filePath), '_blank', 'noopener'); } catch (err) { toast(err.message); } return; }
    if (el.dataset.group && !el.dataset.act) { state.txFilter = { q: '', kind: 'expense', group: el.dataset.group }; return show('tx'); }
    const act = el.dataset.act;
    if (act === 'add') openTx();
    else if (act === 'add-rec') openRec();
    else if (act === 'add-income') openRec(null, { kind: 'income', name: 'Gehalt', category: 'ei-gehalt' });
    else if (act === 'add-pol') openPolicy();
    else if (act === 'fixed') show('fixed');
    else if (act === 'tx') show('tx');
    else if (act === 'limits') openSettings('limits');
    else if (act === 'clear-filter') { state.txFilter = { q: '', kind: 'all', group: '' }; renderTx(); }
    else if (act === 'table') { state.statsTable = !state.statsTable; renderStats(); }
    else if (act === 'csv') downloadCsv();
    else if (act === 'logout') { if (outbox.get().length && (await ask('Abmelden?', '<p>Es gibt noch nicht gesendete Buchungen. Beim Abmelden gehen sie verloren.</p>', [{ value: '', label: 'Abbrechen' }, { value: 'yes', label: 'Trotzdem abmelden', cls: 'danger' }])) !== 'yes') return;
      localStorage.removeItem(OUTBOX); localStorage.removeItem(SNAP); await store.signOut(); location.reload(); }
    else if (act === 'demo-reset') { store.reset(); await loadAll(); $('#dlg-settings').close(); render(); toast('Beispieldaten neu geladen'); }
    else if (act === 'demo-exit') exitDemo();
  });

  // Dialoge: Schließen-Knöpfe und Tippen auf den Hintergrund
  $$('dialog').forEach(d => {
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    d.querySelectorAll('[data-close]').forEach(b => b.onclick = () => d.close());
  });

  // Schnellerfassung
  $$('[name=kind]').forEach(r => r.onchange = () => { tx.kind = r.value; tx.cat = r.value === 'income' ? 'einkommen' : null; tx.group = r.value === 'income' ? 'einkommen' : null; tx.catTouched = false; drawCats(); });
  $('#tx-groups').onclick = e => { const b = e.target.closest('[data-g]'); if (b) setCat(b.dataset.g); };
  $('#tx-subs').onclick = e => { const b = e.target.closest('[data-cat]'); if (b) setCat(b.dataset.cat); };
  $('#tx-recent').onclick = e => { const b = e.target.closest('[data-cat]'); if (b) setCat(b.dataset.cat); };
  $$('[name=when]').forEach(r => r.onchange = () => { $('#tx-date').classList.toggle('hidden', r.value !== 'other' || !r.checked); if (r.value === 'other') $('#tx-date').focus(); });
  $('#tx-note').onchange = () => { if (tx.catTouched) return; const g = guessCategory(state.tx, $('#tx-note').value, tx.kind); if (g) setCat(g, false); };
  $('#tx-amount').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#tx-note').focus(); } };
  $('#tx-photo').onchange = e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) receiptPhoto(f); };
  $('#form-tx').onsubmit = e => { e.preventDefault(); saveTxForm(); };
  $('#tx-delete').onclick = () => deleteTx(tx.editing);

  // Fixkosten
  $('#form-rec').onsubmit = e => { e.preventDefault(); saveRecForm(); };
  ['#rec-amount', '#rec-freq', '#rec-next'].forEach(s => $(s).addEventListener('input', recHint));
  $$('[name=rkind]').forEach(r => r.onchange = () => { $('#rec-cat').innerHTML = catOptions(r.value, r.value === 'income' ? 'ei-gehalt' : 'wo-miete'); });
  $('#rec-delete').onclick = async () => {
    if (!(await confirmDelete(recEditing.kind === 'income' ? 'Regelmäßige Einnahme' : 'Fixkosten'))) return;
    try { await store.deleteRecurring(recEditing.id); $('#dlg-rec').close(); await loadAll({ book: false }); render(); toast('Gelöscht. Bisherige Buchungen bleiben erhalten.'); } catch (e) { $('#rec-err').textContent = e.message; }
  };

  // Versicherung
  $('#form-pol').onsubmit = e => { e.preventDefault(); savePolicyForm(); };
  $('#pol-file').onchange = e => polFileChosen(e.target.files?.[0]);
  $('#pol-delete').onclick = async () => {
    const p = polEditing, r = state.recurring.find(x => x.policyId === p.id);
    const v = await ask(`„${p.name}“ löschen?`, `<p>Die Police und der ausgelesene Text werden gelöscht.${r ? ' Die zugehörigen Fixkosten auch löschen? Bisherige Buchungen bleiben in jedem Fall.' : ''}</p>`,
      [{ value: '', label: 'Abbrechen' }, ...(r ? [{ value: 'keep', label: 'Nur Versicherung' }] : []), { value: 'all', label: r ? 'Beides löschen' : 'Löschen', cls: 'danger' }]);
    if (!v) return;
    try { if (r && v === 'all') await store.deleteRecurring(r.id); await store.deletePolicy(p); $('#dlg-pol').close(); await loadAll({ book: false }); render(); toast('Versicherung gelöscht'); }
    catch (e) { $('#pol-err').textContent = e.message; }
  };

  // Tageswechsel, Rückkehr in die App, Netz wieder da
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !store) return;
    const t = todayIso();
    if (t !== state.today) { const wasCurrent = state.month === state.today.slice(0, 7); state.today = t; if (wasCurrent) state.month = t.slice(0, 7); }
    try { await loadAll(); render(); } catch (e) { console.warn(e); }
  });
  addEventListener('online', async () => { await flushOutbox(); scheduleReload(); });
}

// ---------- Anmeldung ----------
function authMsg(m) { $('#auth-msg').textContent = m ?? ''; }
function showAuth(step) {
  $('#app').classList.add('hidden'); $('#auth').classList.remove('hidden');
  $('#auth-step-login').classList.toggle('hidden', step !== 'login');
  $('#auth-step-household').classList.toggle('hidden', step !== 'household');
}
function bindAuth() {
  let mode = 'signin', email = '';
  $$('#form-login [type=submit]').forEach(b => b.onclick = () => { mode = b.dataset.mode; });
  $('#form-login').onsubmit = async e => {
    e.preventDefault(); authMsg('');
    email = $('#login-email').value.trim(); const pw = $('#login-pass').value;
    if (!pw) return authMsg('Bitte Passwort eingeben oder „Code per E-Mail“ wählen.');
    try { await (mode === 'signup' ? store.signUp(email, pw) : store.signIn(email, pw)); await start(); }
    catch (err) { authMsg(/Invalid login/i.test(err.message) ? 'E-Mail oder Passwort stimmt nicht.' : err.message); }
  };
  $('#btn-code').onclick = async () => {
    email = $('#login-email').value.trim(); authMsg('');
    if (!email) return authMsg('Bitte zuerst die E-Mail-Adresse eingeben.');
    try { await store.sendCode(email); $('#form-code').classList.remove('hidden'); $('#login-code').focus(); authMsg(''); toast('Code wurde verschickt'); }
    catch (err) { authMsg(err.message); }
  };
  $('#form-code').onsubmit = async e => { e.preventDefault(); try { await store.verifyCode(email, $('#login-code').value.trim()); await start(); } catch (err) { authMsg(err.message); } };
  $('#form-create').onsubmit = async e => { e.preventDefault(); try { await store.createHousehold($('#hh-name').value.trim()); await start(); } catch (err) { authMsg(err.message); } };
  $('#form-join').onsubmit = async e => { e.preventDefault(); try { await store.joinHousehold($('#hh-code').value.trim()); await start(); } catch (err) { authMsg(err.message); } };
  $('#btn-demo').onclick = () => { localStorage.setItem('haushaltskasse.mode', 'demo'); location.reload(); };
}
function exitDemo() { localStorage.removeItem('haushaltskasse.mode'); localStorage.removeItem('haushaltskasse.demo'); location.href = location.pathname; }

async function start() {
  const r = await store.init();
  if (r.needsLogin) return showAuth('login');
  if (r.needsHousehold) return showAuth('household');
  $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#demo-bar').classList.toggle('hidden', store.mode !== 'demo');
  setSync('Lädt …');
  await loadAll();
  showOutbox();
  store.onChange(() => scheduleReload());
  show(state.view);
}

// Ohne Netz: letzten Stand zeigen, neue Buchungen landen in der Warteschlange und gehen raus, sobald wieder Netz da ist
function startOffline(snap) {
  Object.assign(state, { tx: [...outbox.get().filter(o => o.op === 'save').map(o => o.tx), ...snap.tx].sort(byDateDesc), recurring: snap.recurring, policies: snap.policies, config: { limits: {}, custom: [], ...snap.config } });
  setCustomCategories(state.config.custom);
  store.useOffline(snap.household);
  $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
  show(state.view);
  setSync('Offline · Stand ' + new Date(snap.at).toLocaleString('de-DE', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }), true);
  addEventListener('online', () => location.reload(), { once: true });
}

async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.has('demo')) localStorage.setItem('haushaltskasse.mode', 'demo');
  const demo = localStorage.getItem('haushaltskasse.mode') === 'demo' || !SUPABASE_URL;
  try { store = demo ? createDemoStore() : await createSupabaseStore(); }
  catch { store = null; }
  chat = initChat({ state, store, toast, ask });
  bindEvents(); bindAuth();
  if (!store) { showAuth('login'); authMsg('Keine Verbindung zum Server. Ohne Netz kannst du die Demo ausprobieren.'); return; }
  try { await start(); }
  catch (e) {
    console.error(e);
    const snap = e.offline && loadSnapshot();
    if (snap && snap.user !== store.me()) { showAuth('login'); authMsg('Keine Verbindung zum Server.'); return; }
    if (snap) { startOffline(snap); return; }
    if (e.offline) { showAuth('login'); authMsg('Keine Verbindung zum Server. Bitte später erneut öffnen.'); return; }
    $('#auth').classList.remove('hidden'); $('#auth-step-login').classList.add('hidden'); authMsg(e.message);
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();

// Für Tests
window.__budget = { state, get store() { return store; } };
