// Haushaltskasse: Hauptmodul. Ansichten, Schnellerfassung, Fixkosten, Versicherungen, Auswertung, Einstellungen.
import { SUPABASE_URL } from '../config.js';
import { createSupabaseStore, createDemoStore } from './store.js';
import { EXPENSE_GROUPS, INCOME_GROUPS, cat, group, groupOf, subsOf, catPath, groupsFor, setCustomCategories } from './categories.js';
import {
  parseAmount, eur, amountInput, todayIso, addDays, addMonths, isIso, FREQS, monthlyCents, occurrences, nextFrom,
  monthKey, monthRange, shiftMonth, monthName, monthShort, dayLabel, dateShort, dateShortNoYear, monthSummary, budgetLevel,
  noticeInfo, matches, toCsv, topCategories, guessCategory, diffDays, potBalances, potPlan, lastDayOfMonth, groupPantry, similarTx, pantryDone,
  inScope, defaultOwner, sumsToTx, byAccount,
} from './logic.js';
import { columns, diverging, band } from './charts.js';
import { initChat, readPolicyFile, splitPastedText, photoToDataUrl } from './policies.js';

const VERSION = 'v3';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => crypto.randomUUID?.() ?? 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2);

const state = { tx: [], recurring: [], policies: [], pots: [], potTx: [], pantry: [], members: [], accounts: [], memberIds: [], sums: [], scope: localStorage.getItem('haushaltskasse.scope') || 'all', config: { limits: {}, custom: [] }, today: todayIso(), month: todayIso().slice(0, 7), view: 'home',
  txFilter: { q: '', kind: 'all', group: '', account: '' }, statsRange: 6, statsTable: false };
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
const signed = t => (t.kind === 'income' ? '+' : t.kind === 'save' ? '→ ' : t.kind === 'unsave' ? '← ' : '−') + eur(t.amount).replace('-', '');
const potOf = id => state.pots.find(p => p.id === id);
const potRate = id => state.recurring.filter(r => r.kind === 'save' && r.potId === id && r.active).reduce((a, r) => a + monthlyCents(r), 0);
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
  const [tx, recurring, policies, config, pots, potTx, members, accounts, memberIds, sums] = await Promise.all([store.listTx(since), store.listRecurring(), store.listPolicies(), store.getConfig(), store.listPots(), store.listPotTx(),
    store.listMembers(), store.listAccounts(), store.memberIds(), store.sharedSums(since).catch(() => [])]);
  // Noch nicht gesendete Buchungen sichtbar lassen
  const pending = outbox.get().filter(o => !o.user || o.user === store.me());
  const del = new Set(pending.filter(o => o.op === 'delete').map(o => o.id));
  const saves = new Map(pending.filter(o => o.op === 'save').map(o => [o.tx.id, o.tx]));
  // Freigabe „nur Summen“ der anderen fließt als Monatswerte mit ein (synthetic, ohne Einzelbuchungen)
  state.tx = [...saves.values(), ...tx.filter(t => !del.has(t.id) && !saves.has(t.id)), ...sumsToTx(sums)].sort(byDateDesc);
  state.members = members; state.accounts = accounts; state.memberIds = memberIds; state.sums = sums;
  state.recurring = recurring; state.policies = policies; state.pots = pots; state.potTx = potTx;
  if (!cfgDirty) state.config = { limits: {}, custom: [], ...config };
  setCustomCategories(state.config.custom);
  chat?.clearCache();
  await loadPantry();
  saveSnapshot();
}
// Letzter Stand für unterwegs ohne Netz (13 Monate Buchungen, ohne Seitentexte der Policen)
const SNAP = 'haushaltskasse.snapshot';
function saveSnapshot() {
  if (store.mode !== 'supabase') return;
  const since = addMonths(state.today.slice(0, 7) + '-01', -13);
  try { localStorage.setItem(SNAP, JSON.stringify({ at: new Date().toISOString(), user: store.me(), household: store.household(), tx: state.tx.filter(t => t.date >= since), recurring: state.recurring, policies: state.policies, config: state.config, pots: state.pots, potTx: state.potTx, members: state.members, accounts: state.accounts, memberIds: state.memberIds, sums: state.sums })); }
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
  renderScopeBar();
  $('#m-label').textContent = monthName(state.month);
  $('#m-next').disabled = state.month >= shiftMonth(state.today.slice(0, 7), 12);
  const fn = { home: renderHome, tx: renderTx, fixed: renderFixed, ins: renderIns, stats: renderStats }[state.view];
  fn?.();
}
// ---------- Personen, Konten, Ansicht ----------
const me = () => store.me();
const multi = () => state.memberIds.length > 1 || state.members.length > 1;
const myMember = () => state.members.find(m => m.userId === me()) ?? { share: {}, defaultPrivate: false };
const memberName = id => id === me() ? 'Ich' : state.members.find(m => m.userId === id)?.displayName || 'Partner';
const others = () => state.members.filter(m => m.userId !== me());
const accOf = id => state.accounts.find(a => a.id === id);
const accLabel = a => a ? `${a.icon} ${a.name}` : 'ohne Konto';
const canWrite = owner => owner == null || owner === me();
const sc = o => inScope(o, state.scope, me());
// Was die aktuelle Ansicht zeigt
const V = {
  get tx() { return state.tx.filter(t => sc(t.owner)); },
  get recurring() { return state.recurring.filter(r => sc(r.owner)); },
  get pots() { return state.pots.filter(p => sc(p.owner)); },
  get potTx() { return state.potTx.filter(t => sc(t.owner)); },
  get policies() { return state.policies.filter(p => sc(p.owner)); },
};
const real = list => list.filter(t => !t.synthetic);
const ownerTag = owner => owner == null ? '' : owner === me() ? ' · 🔒 privat' : ` · 🔒 ${esc(memberName(owner))}`;
function renderScopeBar() {
  const bar = $('#scope-bar');
  bar.classList.toggle('hidden', !multi());
  if (!multi()) return;
  const opts = [['all', 'Alles'], ['shared', '👥 Gemeinsam'], ['mine', '🔒 Nur ich'], ...others().map(m => [m.userId, `🔒 ${m.displayName || 'Partner'}`])];
  if (!opts.some(([v]) => v === state.scope)) state.scope = 'all';
  bar.innerHTML = opts.map(([v, l]) => `<button type="button" class="chip ${state.scope === v ? 'on' : ''}" role="radio" aria-checked="${state.scope === v}" data-scope="${esc(v)}">${esc(l)}</button>`).join('');
}
// Beim ersten Start: eigener Eintrag mit Namen, eigenes Konto, bei mehreren Personen ein Gemeinschaftskonto
async function ensureSetup() {
  let changed = false;
  try {
    if (!state.members.some(m => m.userId === me())) { await store.saveMe({ displayName: store.suggestedName(), share: {}, defaultPrivate: false }); changed = true; }
    const name = myMember().displayName || store.suggestedName();
    if (!state.accounts.some(a => a.owner === me())) { await store.saveAccount({ name: `Konto ${name}`, owner: me() }).catch(e => { if (!e.duplicate) throw e; }); changed = true; }
    if (multi() && !state.accounts.some(a => a.owner == null)) { await store.saveAccount({ name: 'Gemeinschaftskonto', owner: null, icon: '🏦' }).catch(e => { if (!e.duplicate) throw e; }); changed = true; }
  } catch (e) { console.warn('Einrichtung', e); }
  if (changed) { [state.members, state.accounts] = await Promise.all([store.listMembers(), store.listAccounts()]); }
}

// Auswahl „Bezahlt von“ und „Wer sieht das“ in den Formularen
function whoWidget(el, { account = undefined, owner = null, editing = false, accounts = true, hint = '' } = {}) {
  const ro = editing && !canWrite(owner);
  el.dataset.owner = owner ?? ''; el.dataset.touched = editing ? '1' : '';
  el.dataset.acc = account ?? ''; el.dataset.ro = ro ? '1' : '';
  const accs = state.accounts.filter(a => !a.archived || a.id === account);
  el.innerHTML = (ro ? `<p class="ro">🔒 Gehört ${esc(memberName(owner))}. Du kannst es ansehen, aber nicht ändern.</p>` : '')
    + (accounts && accs.length ? `<div><span class="lbl">Bezahlt von</span><div class="chips" role="radiogroup" aria-label="Bezahlt von" style="margin-top:6px">${accs.map(a =>
      `<button type="button" class="chip ${a.id === el.dataset.acc ? 'on' : ''}" role="radio" aria-checked="${a.id === el.dataset.acc}" data-acc="${esc(a.id)}" ${ro ? 'disabled' : ''}>${esc(accLabel(a))}</button>`).join('')}</div></div>` : '')
    + `<div><span class="lbl">Wer sieht das?</span><div class="seg small" role="radiogroup" aria-label="Wer sieht das" style="margin-top:6px;display:flex">
        <label><input type="radio" name="${el.id}-own" value="shared" ${!el.dataset.owner ? 'checked' : ''} ${ro ? 'disabled' : ''}><span>👥 Gemeinsam</span></label>
        <label><input type="radio" name="${el.id}-own" value="me" ${el.dataset.owner ? 'checked' : ''} ${ro ? 'disabled' : ''}><span>🔒 Nur ich</span></label></div>
        <p class="tiny muted" style="margin-top:4px">${multi() ? (hint || 'Private Einträge sieht dein Partner nur, wenn du es unter Einstellungen → Freigabe erlaubst.') : 'Wichtig, sobald jemand deinem Haushalt beitritt. Bis dahin siehst nur du alles.'}</p></div>`;
  el.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => {
    el.dataset.acc = el.dataset.acc === b.dataset.acc ? '' : b.dataset.acc;
    el.querySelectorAll('[data-acc]').forEach(x => { const on = x.dataset.acc === el.dataset.acc; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); });
    if (!el.dataset.touched) { const o = defaultOwner(accOf(el.dataset.acc), me(), myMember().defaultPrivate); el.dataset.owner = o ?? ''; el.querySelector(`[value=${o ? 'me' : 'shared'}]`).checked = true; }
  });
  el.querySelectorAll(`[name="${el.id}-own"]`).forEach(r => r.onchange = () => { el.dataset.owner = r.value === 'me' ? me() : ''; el.dataset.touched = '1'; });
  return ro;
}
const whoValue = el => ({ accountId: el.dataset.acc || null, owner: el.dataset.owner || null, readOnly: el.dataset.ro === '1' });
// Besitzer ändern geht nur zwischen „gemeinsam“ und „ich“; fremde Einträge bleiben, wie sie sind
const keepOwner = (old, wanted) => old && !canWrite(old.owner) ? old.owner : wanted;
const lastAccount = () => { const id = localStorage.getItem('haushaltskasse.account'); return accOf(id) && !accOf(id).archived ? id : (state.accounts.find(a => a.owner == null && !a.archived) ?? state.accounts.find(a => a.owner === me() && !a.archived))?.id ?? null; };

const summary = (key = state.month) => monthSummary({ tx: V.tx, recurring: V.recurring, key, today: state.today, groupOf });

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
  if (t.potId) {
    const p = potOf(t.potId);
    return `<li><button class="item" data-pot="${esc(t.potId)}"><span class="ic" aria-hidden="true">${esc(p?.icon ?? '🐷')}</span>
      <span><span class="t">${esc(p?.name ?? 'Spartopf')}</span><span class="s">${t.kind === 'save' ? 'In den Spartopf' : 'Aus dem Spartopf'}${t.note && t.note !== p?.name ? ' · ' + esc(t.note) : ''}</span></span>
      <span class="a">${signed(t)}</span></button></li>`;
  }
  const c = cat(t.category);
  return `<li><button class="item" data-tx="${esc(t.id)}">
    <span class="ic" aria-hidden="true">${c.icon}</span>
    <span><span class="t">${esc(t.note || c.label)}</span><span class="s">${esc(t.note ? catPath(t.category) : group(c.group)?.label ?? '')}${t.recurringId || t.source === 'recurring' ? ' · Fixkosten' : ''}${t.source === 'receipt' ? ' · Bon' : ''}${t.accountId && state.accounts.length > 1 ? ' · ' + esc(accOf(t.accountId)?.name ?? '') : ''}${ownerTag(t.owner)}</span></span>
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
      ${band({ spent: s.expense, pending: s.pendingExpense, saved: Math.max(0, s.saved + s.pendingSave - s.unsaved), total: s.plannedIncome, progress: cur ? (s.dayIndex - 0.5) / s.days : null })}
      <div class="band-legend"><span><i class="k-spent"></i>Ausgegeben ${eur(s.expense)}</span>${s.pendingExpense ? `<span><i class="k-pending"></i>Fixkosten offen ${eur(s.pendingExpense)}</span>` : ''}${s.saved + s.pendingSave ? `<span><i class="k-saved"></i>Gespart ${eur(s.saved + s.pendingSave)}</span>` : ''}<span><i class="k-free"></i>Frei ${eur(Math.max(0, s.free))}</span></div>
      <details><summary class="tiny" style="cursor:pointer;margin-top:10px;opacity:.9">So rechnet die App</summary>
      <dl class="band-math">
        <dt>Einnahmen${s.pendingIncome ? ' (inkl. erwartet)' : ''}</dt><dd>${eur(s.plannedIncome)}</dd>
        <dt>Ausgaben bisher${s.fixedBooked ? `, davon Fixkosten ${eur(s.fixedBooked)}` : ''}</dt><dd>−${eur(s.expense)}</dd>
        ${s.pendingExpense ? `<dt>Fixkosten noch offen</dt><dd>−${eur(s.pendingExpense)}</dd>` : ''}
        ${s.saved + s.pendingSave ? `<dt>In Spartöpfe${s.pendingSave ? ' (inkl. Sparrate, die noch kommt)' : ''}</dt><dd>−${eur(s.saved + s.pendingSave)}</dd>` : ''}
        ${s.unsaved ? `<dt>Aus Spartöpfen genommen</dt><dd>+${eur(s.unsaved)}</dd>` : ''}
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
  const upcoming = V.recurring.flatMap(r => occurrences(r, addDays(state.today, 1), until).map(d => ({ d, r }))).sort((a, b) => a.d.localeCompare(b.d)).slice(0, 8);
  const recent = real(V.tx).filter(t => monthKey(t.date) === state.month).slice(0, 5);

  $('#view-home').innerHTML = bandHtml
    + restCard() + pantryCard()
    + (alerts ? `<div class="section-head"><h2>Fristen</h2></div>${alerts}` : '')
    + potsSection()
    + `<div class="section-head"><h2>Budgets</h2><button class="btn link" data-act="limits">${limited.length ? 'Ändern' : 'Festlegen'}</button></div>`
    + (limited.length ? `<ul class="list">${budgets}</ul><p class="tiny muted" style="margin:6px 4px 0">${pace != null ? 'Der Strich zeigt, wie weit der Monat ist. Liegt der Balken davor, bist du im Plan.' : ''}</p>`
      : `<div class="card empty"><p>Lege fest, wie viel du im Monat z. B. für Lebensmittel oder Essen gehen ausgeben willst. Die App warnt, bevor es knapp wird.</p><button class="btn primary" data-act="limits">Budgets festlegen</button></div>`)
    + `<div class="section-head"><h2>In den nächsten 14 Tagen</h2><button class="btn link" data-act="fixed">Fixkosten</button></div>`
    + (upcoming.length ? `<ul class="list">${upcoming.map(({ d, r }) => `<li><button class="item" ${r.potId ? `data-pot="${esc(r.potId)}"` : `data-rec="${esc(r.id)}"`}><span class="ic" aria-hidden="true">${r.potId ? esc(potOf(r.potId)?.icon ?? '🐷') : cat(r.category).icon}</span>
        <span><span class="t">${esc(r.name)}</span><span class="s">${esc(dayLabel(d, state.today))}</span></span><span class="a ${r.kind === 'income' ? 'amt-in' : ''}">${r.kind === 'income' ? '+' : r.kind === 'save' ? '→ ' : '−'}${eur(r.amount)}</span></button></li>`).join('')}</ul>`
      : `<div class="card empty"><p>In den nächsten zwei Wochen ist nichts fällig.</p>${state.recurring.length ? '' : '<button class="btn" data-act="add-rec">Fixkosten eintragen</button>'}</div>`)
    + `<div class="section-head"><h2>Letzte Buchungen</h2>${recent.length ? '<button class="btn link" data-act="tx">Alle</button>' : ''}</div>`
    + (recent.length ? `<ul class="list">${recent.map(txItem).join('')}</ul>` : `<div class="card empty"><p>In diesem Monat ist noch nichts gebucht.</p><button class="btn primary" data-act="add">Erste Ausgabe erfassen</button></div>`);

  $('#view-home').querySelectorAll('[data-deadline]').forEach(b => b.onclick = () => dl[+b.dataset.deadline].open());
}

// ---------- Buchungen ----------
function renderTx() {
  const f = state.txFilter;
  const list = (f.q ? real(V.tx) : real(V.tx).filter(t => monthKey(t.date) === state.month))
    .filter(t => f.kind === 'all' || t.kind === f.kind)
    .filter(t => !f.account || (f.account === '-' ? !t.accountId : t.accountId === f.account))
    .filter(t => !f.group || groupOf(t.category) === f.group)
    .filter(t => !f.q || matches(`${t.note} ${catPath(t.category)} ${eur(t.amount)} ${dateShort(t.date)} ${accOf(t.accountId)?.name ?? ''} ${t.owner ? memberName(t.owner) : ''}`, f.q));
  // Freigabe „nur Summen“: eine Zeile je Person und Monat
  const sumLines = f.q ? [] : others().map(m => { const xs = V.tx.filter(t => t.synthetic && t.owner === m.userId && monthKey(t.date) === state.month && t.kind === 'expense' && (!f.group || groupOf(t.category) === f.group)); return { m, total: xs.reduce((a, t) => a + t.amount, 0) }; }).filter(x => x.total);
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
      ${state.accounts.length > 1 ? `<select id="tx-a" aria-label="Konto" style="flex:1;min-width:150px"><option value="">Alle Konten</option>${state.accounts.map(a => `<option value="${esc(a.id)}" ${f.account === a.id ? 'selected' : ''}>${esc(accLabel(a))}</option>`).join('')}<option value="-" ${f.account === '-' ? 'selected' : ''}>Ohne Konto</option></select>` : ''}
      <select id="tx-g" aria-label="Kategorie" style="flex:1;min-width:150px">
        <option value="">Alle Kategorien</option>${groups.map(g => `<option value="${g.id}" ${f.group === g.id ? 'selected' : ''}>${g.icon} ${esc(g.label)}</option>`).join('')}
      </select>
    </div>
    <p class="tiny muted">${f.q ? `Suche in allen Monaten · ${list.length} Treffer` : esc(monthName(state.month))} · Ausgaben ${eur(sumE)}${sumI ? ` · Einnahmen ${eur(sumI)}` : ''}</p>
  </div>`;
  const body = list.length ? [...days.entries()].map(([d, ts]) => {
    const e = ts.filter(t => t.kind === 'expense').reduce((a, t) => a + t.amount, 0);
    return `<div class="day-head"><span>${esc(dayLabel(d, state.today))}${f.q ? ' · ' + dateShort(d) : ''}</span><span>${e ? '−' + eur(e) : ''}</span></div><ul class="list">${ts.map(txItem).join('')}</ul>`;
  }).join('') : !['all', 'shared', 'mine'].includes(state.scope) ? `<div class="card empty" style="margin-top:14px"><p>Keine einzelnen Buchungen von ${esc(memberName(state.scope))} sichtbar. ${esc(memberName(state.scope))} entscheidet in den eigenen Einstellungen, was freigegeben ist.</p></div>`
    : `<div class="card empty" style="margin-top:14px"><p>${f.q || f.group || f.kind !== 'all' || f.account ? 'Keine Buchung passt zum Filter.' : 'In diesem Monat ist noch nichts gebucht.'}</p>${f.q || f.group || f.kind !== 'all' || f.account ? '<button class="btn" data-act="clear-filter">Filter zurücksetzen</button>' : '<button class="btn primary" data-act="add">Ausgabe erfassen</button>'}</div>`;
  const hadFocus = document.activeElement?.id === 'tx-q', pos = hadFocus ? document.activeElement.selectionStart : 0;
  const sumHtml = sumLines.map(x => `<div class="card" style="margin-top:10px"><p>🔒 <b>${esc(x.m.displayName || 'Partner')}</b>: private Ausgaben ${eur(x.total)} in ${esc(monthName(state.month).split(' ')[0])}</p><p class="tiny muted">Nur die Summe ist freigegeben, keine einzelnen Buchungen.</p></div>`).join('');
  $('#view-tx').innerHTML = head + sumHtml + body;
  if (hadFocus) { const q = $('#tx-q'); q.focus(); q.setSelectionRange(pos, pos); }
  $('#tx-q').oninput = e => { state.txFilter.q = e.target.value; renderTx(); };
  $$('[name=txk]').forEach(r => r.onchange = () => { state.txFilter.kind = r.value; renderTx(); });
  $('#tx-g').onchange = e => { state.txFilter.group = e.target.value; renderTx(); };
  if ($('#tx-a')) $('#tx-a').onchange = e => { state.txFilter.account = e.target.value; renderTx(); };
}

// ---------- Fixkosten ----------
function recItem(r) {
  const c = cat(r.category), pol = r.policyId && state.policies.find(p => p.id === r.policyId);
  const n = noticeInfo(r.contractEnd ?? pol?.contractEnd, r.noticeMonths ?? pol?.noticeMonths, state.today);
  const nb = n ? `<span class="badge ${n.daysLeft <= 14 ? 'bad' : n.daysLeft <= 60 ? 'warn' : ''}">kündbar bis ${dateShortNoYear(n.deadline)}${n.deadline.slice(0, 4) !== state.today.slice(0, 4) ? n.deadline.slice(0, 4) : ''}</span>` : '';
  const sub = r.active ? `${FREQS[r.freq].label} · nächste ${r.nextDue.slice(0, 4) === state.today.slice(0, 4) ? dateShortNoYear(r.nextDue) : dateShort(r.nextDue)}` : `beendet${r.endDate ? ' am ' + dateShort(r.endDate) : ''}`;
  return `<li><button class="item" ${r.potId ? `data-pot="${esc(r.potId)}"` : `data-rec="${esc(r.id)}"`}><span class="ic" aria-hidden="true">${r.potId ? esc(potOf(r.potId)?.icon ?? '🐷') : c.icon}</span>
    <span><span class="t">${esc(r.name)}</span><span class="s">${esc(sub)}${r.accountId && state.accounts.length > 1 ? ' · ' + esc(accOf(r.accountId)?.name ?? '') : ''}${ownerTag(r.owner)}</span>${nb ? `<span style="display:block;margin-top:3px">${nb}</span>` : ''}</span>
    <span class="a ${r.kind === 'income' ? 'amt-in' : ''}">${eur(r.amount)}<small>${r.freq === 'monthly' ? 'im Monat' : `≈ ${eur(monthlyCents(r))}/Monat`}</small></span></button></li>`;
}
function renderFixed() {
  const act = V.recurring.filter(r => r.active), ended = V.recurring.filter(r => !r.active);
  const perAcc = new Map();
  for (const r of act) if (r.kind !== 'income') perAcc.set(r.accountId ?? '', (perAcc.get(r.accountId ?? '') ?? 0) + monthlyCents(r));
  const sumFixed = others().map(m => ({ m, total: state.sums.filter(x => x.owner === m.userId && x.area === 'fixed' && x.kind !== 'income').reduce((a, x) => a + x.total, 0) })).filter(x => x.total && sc(x.m.userId) && state.scope !== 'shared');
  const exp = act.filter(r => r.kind === 'expense'), inc = act.filter(r => r.kind === 'income'), sav = act.filter(r => r.kind === 'save');
  const mExp = exp.reduce((a, r) => a + monthlyCents(r), 0), mInc = inc.reduce((a, r) => a + monthlyCents(r), 0), mSav = sav.reduce((a, r) => a + monthlyCents(r), 0);
  const ins = exp.filter(r => groupOf(r.category) === 'versicherung').reduce((a, r) => a + monthlyCents(r), 0);
  const nonMonthly = exp.filter(r => r.freq !== 'monthly').reduce((a, r) => a + monthlyCents(r), 0);
  const byGroup = new Map();
  for (const r of [...exp].sort((a, b) => monthlyCents(b) - monthlyCents(a))) { const g = groupOf(r.category); if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(r); }
  const ordered = EXPENSE_GROUPS.filter(g => byGroup.has(g.id));
  $('#view-fixed').innerHTML = `
    <div class="kpis" style="margin-top:6px">
      <div class="kpi"><span>Fixkosten</span><b>${eur(mExp)}</b><small>pro Monat</small></div>
      <div class="kpi"><span>Regelmäßig rein</span><b class="amt-in">${eur(mInc)}</b><small>pro Monat</small></div>
      <div class="kpi"><span>Bleibt</span><b>${mInc ? eur(mInc - mExp - mSav) : '–'}</b><small>${mInc ? (mSav ? 'nach Sparraten' : 'für alles andere') : 'Einnahme fehlt'}</small></div>
    </div>
    ${nonMonthly ? `<p class="tiny muted" style="margin:10px 4px 0">Darin stecken ${eur(nonMonthly)} pro Monat für jährliche oder vierteljährliche Kosten${ins ? `, ${eur(ins)} davon für Versicherungen` : ''}. Diesen Betrag am besten monatlich zurücklegen.</p>` : ''}
    ${state.accounts.length && perAcc.size ? `<div class="section-head"><h2>Abbuchungen je Konto</h2></div><div class="card" style="padding:4px 14px">${[...perAcc.entries()].sort((a, b) => b[1] - a[1]).map(([id, c]) => `<div class="acc-row"><span>${esc(accLabel(accOf(id)))}</span><b>${eur(c)}/Monat</b></div>`).join('')}
      <p class="tiny muted" style="padding:8px 0">So viel geht im Schnitt pro Monat von jedem Konto für Fixkosten und Sparraten ab.</p></div>` : ''}
    ${sumFixed.map(x => `<p class="tiny muted" style="margin:10px 4px 0">🔒 ${esc(x.m.displayName || 'Partner')} hat private Fixkosten von ${eur(x.total)} im Monat (nur Summe freigegeben).</p>`).join('')}
    <div class="section-head"><h2>Ausgaben</h2><button class="btn link" data-act="add-rec">Hinzufügen</button></div>
    ${exp.length ? ordered.map(g => `<div class="day-head"><span>${g.icon} ${esc(g.label)}</span><span>${eur(byGroup.get(g.id).reduce((a, r) => a + monthlyCents(r), 0))}/Monat</span></div><ul class="list">${byGroup.get(g.id).map(recItem).join('')}</ul>`).join('')
      : `<div class="card empty"><p>Trag hier ein, was regelmäßig abgeht: Miete, Strom, Handy, Streaming, Versicherungen. Die App bucht es dann jeden Monat automatisch.</p><button class="btn primary" data-act="add-rec">Fixkosten eintragen</button></div>`}
    <div class="section-head"><h2>Sparraten</h2><button class="btn link" data-act="add-pot">Spartopf anlegen</button></div>
    ${sav.length ? `<ul class="list">${sav.map(recItem).join('')}</ul>` : `<div class="card empty"><p>Eine feste Sparrate legt jeden Monat automatisch Geld in einen Spartopf.</p><button class="btn" data-act="add-pot">Spartopf anlegen</button></div>`}
    <div class="section-head"><h2>Regelmäßige Einnahmen</h2><button class="btn link" data-act="add-income">Hinzufügen</button></div>
    ${inc.length ? `<ul class="list">${inc.map(recItem).join('')}</ul>` : `<div class="card empty"><p>Gehalt, BAföG oder Nebenjob eintragen, dann weiß die App, wie viel im Monat frei ist.</p><button class="btn" data-act="add-income">Einnahme eintragen</button></div>`}
    ${ended.length ? `<div class="section-head"><h2>Beendet</h2></div><ul class="list">${ended.map(recItem).join('')}</ul>` : ''}`;
}

// ---------- Versicherungen ----------
function renderIns() {
  const ps = V.policies;
  const withText = ps.filter(p => p.pageCount > 0).length;
  const cards = ps.map(p => {
    const r = state.recurring.find(x => x.policyId === p.id && x.active) ?? state.recurring.find(x => x.policyId === p.id);
    const n = noticeInfo(p.contractEnd, p.noticeMonths, state.today);
    return `<div class="card pol">
      <div class="pol-top"><span class="ic" aria-hidden="true">${cat(p.category).icon}</span>
        <span><b>${esc(p.name)}</b><span class="tiny muted" style="display:block">${esc([cat(p.category).label, p.insurer].filter(Boolean).join(' · '))}${ownerTag(p.owner)}</span></span>
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
    ${state.statsTable ? `<div class="card" style="margin-top:14px"><table class="data-table"><thead><tr><th>Monat</th><th>Einnahmen</th><th>Ausgaben</th><th>Gespart</th><th>Plus/Minus</th></tr></thead><tbody>
      ${sums.map(x => `<tr><td>${esc(monthName(x.key))}</td><td>${eur(x.income)}</td><td>${eur(x.expense)}</td><td>${eur(x.saved - x.unsaved)}</td><td>${x.income - x.expense >= 0 ? '+' : '−'}${eur(Math.abs(x.income - x.expense))}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="card" style="margin-top:14px"><h2>Ausgaben je Monat</h2><p class="tiny muted">Hervorgehoben: ${esc(monthName(state.month))}${avgE ? `. Linie: Durchschnitt ${eur(avgE)} (abgeschlossene Monate)` : ''}${keys.includes(curKey) ? '. Der laufende Monat ist noch nicht fertig.' : ''}</p><div id="ch-exp" style="margin-top:8px"></div></div>
       <div class="card"><h2>Plus oder Minus je Monat</h2><p class="tiny muted">Einnahmen minus Ausgaben. Blau: Geld übrig (Gespartes zählt dazu), orange: mehr ausgegeben als eingenommen.</p><div id="ch-bal" style="margin-top:8px"></div>
       <div class="legend"><span><i style="background:var(--pos)"></i>Plus</span><span><i style="background:var(--neg)"></i>Minus</span></div></div>`}
    ${(() => { const r = monthRange(state.month), m = byAccount(V.tx, r.from, r.to); return state.accounts.length && m.size ? `<div class="card"><h2>Nach Konto im ${esc(monthName(state.month).split(' ')[0])}</h2><p class="tiny muted">Ausgaben und Sparen, je nachdem, von welchem Konto bezahlt wurde.</p>
      <div class="rank" style="margin-top:12px">${[...m.entries()].sort((a, b) => b[1] - a[1]).map(([id, c]) => `<button class="rank-row" data-acc-filter="${esc(id || '-')}" style="border:0;background:none;padding:0;text-align:left;cursor:pointer;color:inherit;font:inherit"><span class="lab">${esc(accLabel(accOf(id)))}</span><span class="num">${eur(c)}</span><span class="track"><i style="width:${100 * c / Math.max(...m.values())}%"></i></span></button>`).join('')}</div></div>` : ''; })()}
    <div class="card"><h2>Wofür im ${esc(monthName(state.month).split(' ')[0])}</h2>
      <p class="tiny muted">${s.expense ? `${eur(s.expense)} ausgegeben, ${fixedShare} % davon Fixkosten. Vergleich mit dem Vormonat darunter.` : 'Noch keine Ausgaben in diesem Monat.'}${s.saved - s.unsaved > 0 ? ` Dazu ${eur(s.saved - s.unsaved)} in Spartöpfe gelegt.` : ''}${Object.keys(limits).length ? ' Strich = Budget.' : ''}</p>
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
  const recent = topCategories(real(state.tx), tx.kind, 5).filter(id => cat(id).group);
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
  const ro = whoWidget($('#tx-who'), { account: t ? t.accountId : lastAccount(), owner: t ? t.owner : defaultOwner(accOf(lastAccount()), me(), myMember().defaultPrivate), editing: !!t });
  $('#tx-delete').classList.toggle('hidden', !t || ro);
  $('#tx-save').classList.toggle('hidden', ro);
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
  const who = whoValue($('#tx-who'));
  if (who.readOnly) return;
  const t = { ...(old ?? {}), id: old?.id ?? uid(), date, amount, kind: tx.kind, category: tx.cat, note: $('#tx-note').value.trim(), source: old?.source ?? tx.source, createdAt: old?.createdAt ?? new Date().toISOString(),
    accountId: who.accountId, owner: keepOwner(old, who.owner) };
  if (who.accountId) localStorage.setItem('haushaltskasse.account', who.accountId);
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
  const ro = whoWidget($('#rec-who'), { account: r ? r.accountId : lastAccount(), owner: r ? r.owner : defaultOwner(accOf(lastAccount()), me(), myMember().defaultPrivate), editing: !!r });
  $('#form-rec [type=submit]').classList.toggle('hidden', ro);
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
  const who = whoValue($('#rec-who'));
  if (who.readOnly) return;
  const r = { ...(old ?? {}), accountId: who.accountId, owner: keepOwner(old, who.owner), name, amount, kind, freq, category: $('#rec-cat').value, endDate: end || null, contractEnd: $('#rec-cend').value || null,
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
  const roPol = whoWidget($('#pol-who'), { account: undefined, owner: p ? p.owner : (myMember().defaultPrivate ? me() : null), editing: !!p, accounts: false, hint: 'Eine private Police (auch die Datei) sieht dein Partner nur, wenn du Versicherungen freigibst.' });
  $('#form-pol [type=submit]').classList.toggle('hidden', roPol);
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
  const who = whoValue($('#pol-who'));
  if (who.readOnly) return;
  const p = { ...(old ?? {}), owner: keepOwner(old, who.owner), id: old?.id ?? uid(), name, category: $('#pol-cat').value, insurer: $('#pol-insurer').value.trim(), policyNo: $('#pol-no').value.trim(),
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
      await store.saveRecurring({ ...(r ?? {}), owner: p.owner, accountId: r?.accountId ?? lastAccount(), name, amount, kind: 'expense', category: p.category, freq, policyId: p.id, active: true, endDate: r?.endDate ?? null,
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

// ---------- Spartöpfe ----------
const POT_ICONS = ['🐷', '🏖️', '🛟', '🚗', '🏠', '🎁', '💍', '🎓', '👶', '💻', '🚲', '🎄'];
function potCard(p, bal) {
  const rate = potRate(p.id), plan = potPlan(p, bal, rate, state.today);
  const until = p.targetDate ? ` bis ${monthShort(p.targetDate.slice(0, 7))} ${p.targetDate.slice(0, 4)}` : '';
  let note = '', cls = plan.status ?? '';
  if (!plan.hasGoal) note = rate ? `Sparrate ${eur(rate)} im Monat` : 'Ohne Ziel';
  else if (plan.status === 'done') note = '🎉 Ziel erreicht';
  else if (plan.status === 'late') note = `⚠️ Zieldatum vorbei, es fehlen noch ${eur(plan.missing)}`;
  else if (plan.status === 'ontrack') note = `Im Plan: ${eur(rate)} im Monat reichen`;
  else if (plan.status === 'behind') note = `⚠️ Fürs Ziel ${eur(plan.need)} im Monat nötig, Sparrate ist ${eur(rate)}`;
  else if (plan.need) note = `Noch ${eur(plan.missing)}: ${eur(plan.need)} im Monat${until}`;
  else note = rate ? `Mit ${eur(rate)} im Monat in ca. ${plan.etaMonths} ${plan.etaMonths === 1 ? 'Monat' : 'Monaten'} erreicht` : `Noch ${eur(plan.missing)} bis zum Ziel`;
  return `<li><button class="pot" data-pot="${esc(p.id)}">
    <span class="ic" aria-hidden="true">${esc(p.icon)}</span><span class="nm">${esc(p.name)}${p.owner ? ' 🔒' : ''}</span><span class="bal">${eur(bal)}</span>
    <span class="gl">${plan.hasGoal ? `Ziel ${eur(p.goal)}${until}` : p.autoRest ? 'bekommt den Monatsrest' : ''}</span><span class="gl r">${plan.hasGoal ? Math.round(plan.ratio * 100) + ' %' : ''}</span>
    ${plan.hasGoal ? `<span class="meter"><i style="width:${(plan.ratio * 100).toFixed(1)}%"></i></span>` : ''}
    <span class="note ${cls}">${note}</span></button></li>`;
}
function potsSection() {
  const pots = V.pots.filter(p => !p.archived);
  const bal = potBalances(state.pots, state.potTx);
  const otherBal = state.scope === 'shared' ? [] : others().filter(m => sc(m.userId)).map(m => ({ m, total: state.sums.filter(x => x.owner === m.userId && x.area === 'potbal').reduce((a, x) => a + x.total, 0) })).filter(x => x.total);
  const total = pots.reduce((a, p) => a + (bal.get(p.id) ?? 0), 0);
  return `<div class="section-head"><h2>Spartöpfe${pots.length ? ` · ${eur(total)}` : ''}</h2><button class="btn link" data-act="add-pot">${pots.length ? 'Neuer Topf' : 'Anlegen'}</button></div>`
    + (pots.length ? `<ul class="list">${pots.map(p => potCard(p, bal.get(p.id) ?? 0)).join('')}</ul>`
      : `<div class="card empty"><p>Leg Geld für Urlaub, Auto oder einen Notgroschen zur Seite. Mit fester Sparrate und dem, was am Monatsende übrig bleibt.</p><button class="btn primary" data-act="add-pot">Spartopf anlegen</button></div>`)
    + otherBal.map(x => `<p class="tiny muted" style="margin:8px 4px 0">🔒 ${esc(x.m.displayName || 'Partner')} hat ${eur(x.total)} in eigenen Spartöpfen (nur Summe freigegeben).</p>`).join('');
}

// Was am Ende eines Monats übrig blieb. Nur für Monate, in denen die App wirklich genutzt wurde (mindestens 5 eigene Buchungen).
const restPots = () => state.pots.filter(p => !p.archived && canWrite(p.owner));
function restCandidate() {
  const m = shiftMonth(state.today.slice(0, 7), -1);
  const pots = restPots();
  if (!pots.length || state.config.closed?.[m] || state.tx.some(t => t.extRef === 'rest:' + m)) return null; // closed: schon einmal erledigt (gebucht, behalten oder automatisch)
  const used = real(state.tx).filter(t => monthKey(t.date) === m && t.source !== 'recurring' && !t.potId).length;
  // Nur eigenes und gemeinsames Geld (nicht die freigegebenen Summen anderer)
  const s = monthSummary({ tx: state.tx.filter(t => canWrite(t.owner)), recurring: state.recurring.filter(r => canWrite(r.owner)), key: m, today: state.today, groupOf });
  if (used < 5 || !s.income || s.free <= 0) return null;
  return { month: m, amount: s.free };
}
function restCard() {
  const c = restCandidate(); if (!c || state.month !== state.today.slice(0, 7)) return '';
  const pots = restPots();
  return `<div class="card" style="margin-top:14px;display:grid;gap:10px">
    <p><b>Im ${esc(monthName(c.month).split(' ')[0])} sind ${eur(c.amount)} übrig geblieben.</b></p>
    <p class="tiny muted">In einen Spartopf legen? Gebucht wird am letzten Tag des Monats, der laufende Monat bleibt unverändert.</p>
    <div class="row wrap"><select id="rest-pot" aria-label="Spartopf" style="flex:1;min-width:140px">${pots.map(p => `<option value="${esc(p.id)}">${esc(p.icon)} ${esc(p.name)}</option>`).join('')}</select>
      <button class="btn primary" data-act="rest-book" data-month="${c.month}" data-amount="${c.amount}">In Topf legen</button>
      <button class="btn" data-act="rest-keep" data-month="${c.month}">Behalten</button></div></div>`;
}
async function bookRest(month, pot, amount, auto = false) {
  const t = { id: uid(), owner: pot.owner ?? null, date: lastDayOfMonth(month), amount, kind: 'save', category: 'fi-sparen', potId: pot.id, note: `Rest aus ${monthName(month)}`, source: 'rest', extRef: 'rest:' + month, createdAt: new Date().toISOString() };
  state.config.closed = { ...(state.config.closed ?? {}), [month]: auto ? 'auto' : 'pot' }; saveConfigSoon(0);
  try { await store.saveTx(t); toast(`${eur(amount)} aus dem ${monthName(month).split(' ')[0]} ${auto ? 'automatisch ' : ''}in „${pot.name}“ gelegt`); }
  catch (e) { if (!e.duplicate) { ask('Nicht gebucht', `<p>${esc(e.message)}</p>`); return; } }
  await loadAll({ book: false }); render();
}
async function autoRest() {
  const pot = restPots().find(p => p.autoRest), c = restCandidate();
  if (pot && c) await bookRest(c.month, pot, c.amount, true);
}

function openPot(p = null) {
  potEditing = p;
  const rec = p && state.recurring.find(r => r.kind === 'save' && r.potId === p.id && r.active);
  const roPot = whoWidget($('#pot-who'), { account: rec ? rec.accountId : lastAccount(), owner: p ? p.owner : (myMember().defaultPrivate ? me() : null), editing: !!p, hint: 'Ein privater Topf zählt nur für dich. Die Sparrate geht vom gewählten Konto ab.' });
  const bal = p ? potBalances(state.pots, state.potTx).get(p.id) ?? 0 : 0;
  $('#pot-title').textContent = p ? `${p.icon} ${p.name}` : 'Neuer Spartopf';
  $('#pot-name').value = p?.name ?? '';
  const icon = p?.icon ?? '🐷';
  $('#pot-icons').innerHTML = POT_ICONS.map(i => `<label><input type="radio" name="pot-icon" value="${i}" ${i === icon ? 'checked' : ''} aria-label="Symbol ${i}"><span aria-hidden="true">${i}</span></label>`).join('');
  $('#pot-goal').value = p?.goal ? amountInput(p.goal).replace(',00', '') : '';
  $('#pot-date').value = p?.targetDate ?? '';
  $('#pot-rate').value = rec ? amountInput(rec.amount) : '';
  $('#pot-next').value = rec?.nextDue ?? addMonths(state.today.slice(0, 7) + '-01', 1);
  $('#pot-start').value = p ? amountInput(p.startBalance) : '';
  $('#pot-start-wrap').firstChild.textContent = p ? 'Startbetrag beim Anlegen (€)' : 'Schon drauf (€)';
  $('#pot-auto').checked = !!p?.autoRest;
  $('#pot-delete').classList.toggle('hidden', !p || p.archived);
  $('#form-pot [type=submit]').classList.toggle('hidden', !!p?.archived || roPot);
  if (roPot) $('#pot-delete').classList.add('hidden');
  $('#pot-err').textContent = ''; $('#pot-hint').textContent = p?.archived ? 'Dieser Topf ist aufgelöst. Die Bewegungen bleiben zur Übersicht erhalten.' : '';
  const moves = p ? state.potTx.filter(t => t.potId === p.id).slice(0, 30) : [];
  $('#pot-summary').innerHTML = p ? `<div class="pot-head">
      <span class="tiny muted">Stand</span><span class="big">${eur(bal)}</span>
      ${p.goal ? `<span class="meter"><i style="width:${Math.min(100, 100 * bal / p.goal).toFixed(1)}%;background:var(--good)"></i></span><span class="tiny">${Math.round(Math.min(1, bal / p.goal) * 100)} % von ${eur(p.goal)}</span>` : ''}
      ${p.archived || roPot ? '' : '<div class="row wrap"><button type="button" class="btn small primary" id="pot-in">Einzahlen</button><button type="button" class="btn small" id="pot-out">Entnehmen</button></div>'}</div>
    ${moves.length ? `<details class="more"><summary>Bewegungen (${moves.length})</summary><ul class="list">${moves.map(t => `<li class="item" style="cursor:default"><span class="ic" aria-hidden="true">${t.kind === 'save' ? '↘' : '↗'}</span>
      <span><span class="t">${t.kind === 'save' ? 'Eingezahlt' : 'Entnommen'}</span><span class="s">${dateShort(t.date)}${t.note ? ' · ' + esc(t.note) : ''}</span></span>
      <span class="a">${t.kind === 'save' ? '+' : '−'}${eur(t.amount)} <button type="button" class="btn small danger" data-del-move="${esc(t.id)}" aria-label="Bewegung löschen">✕</button></span></li>`).join('')}</ul></details>` : ''}` : '';
  if (p) {
    if ($('#pot-in')) { $('#pot-in').onclick = () => potMove(p, 'save'); $('#pot-out').onclick = () => potMove(p, 'unsave'); }
    $$('[data-del-move]').forEach(b => b.onclick = async () => {
      if (!(await confirmDelete('Bewegung'))) return;
      try { await store.deleteTx(b.dataset.delMove); await loadAll({ book: false }); render(); openPot(potOf(p.id)); } catch (e) { $('#pot-err').textContent = e.message; }
    });
  }
  if (!$('#dlg-pot').open) $('#dlg-pot').showModal();
}
let potEditing = null;
async function potMove(p, kind) {
  const v = await ask(kind === 'save' ? `In „${p.name}“ einzahlen` : `Aus „${p.name}“ entnehmen`,
    `<label class="field">Betrag (€)<input id="mv-amount" inputmode="decimal" placeholder="0,00"></label><label class="field">Notiz <span class="muted">(optional)</span><input id="mv-note" maxlength="80" placeholder="${kind === 'save' ? 'z. B. Geburtstagsgeld' : 'z. B. Flug gebucht'}"></label>
     <p class="tiny muted">${kind === 'save' ? 'Zählt im laufenden Monat als gespart und mindert, was frei ist.' : 'Das Geld steht dann im laufenden Monat wieder zur Verfügung.'}</p>`,
    [{ value: '', label: 'Abbrechen' }, { value: 'ok', label: kind === 'save' ? 'Einzahlen' : 'Entnehmen', cls: 'primary' }]);
  if (v !== 'ok') return;
  const amount = parseAmount($('#mv-amount').value);
  if (!amount) { toast('Kein gültiger Betrag'); return; }
  const bal = potBalances(state.pots, state.potTx).get(p.id) ?? 0;
  if (kind === 'unsave' && amount > bal && (await ask('Mehr als drauf ist', `<p>Im Topf sind nur ${eur(bal)}. Trotzdem ${eur(amount)} entnehmen?</p>`, [{ value: '', label: 'Abbrechen' }, { value: 'ok', label: 'Trotzdem', cls: 'primary' }])) !== 'ok') return;
  try {
    await store.saveTx({ id: uid(), owner: p.owner ?? null, date: state.today, amount, kind, category: 'fi-sparen', potId: p.id, note: $('#mv-note').value.trim(), source: 'manual', createdAt: new Date().toISOString() });
    await loadAll({ book: false }); render(); openPot(potOf(p.id));
    toast(kind === 'save' ? `${eur(amount)} eingezahlt` : `${eur(amount)} entnommen`);
  } catch (e) { $('#pot-err').textContent = e.message; }
}
async function savePotForm() {
  const err = m => { $('#pot-err').textContent = m; };
  const name = $('#pot-name').value.trim();
  if (!name) return err('Bitte einen Namen eingeben.');
  const read = id => { const v = $(id).value.trim(); if (!v) return { ok: true, c: null }; const c = parseAmount(v); return { ok: c != null, c }; };
  const goal = read('#pot-goal'), rate = read('#pot-rate'), start = read('#pot-start');
  if (!goal.ok) return err('Das Ziel ist keine gültige Zahl.');
  if (!rate.ok) return err('Die Sparrate ist keine gültige Zahl.');
  if (!start.ok) return err('Der Betrag bei „Schon drauf“ ist keine gültige Zahl.');
  const date = $('#pot-date').value, next = $('#pot-next').value;
  if (date && !isIso(date)) return err('Bitte ein gültiges Zieldatum wählen.');
  if (rate.c && !isIso(next)) return err('Bitte angeben, wann die nächste Sparrate abgeht.');
  if (rate.c && next < state.today && (await ask('Sparrate nachbuchen?', `<p>Die erste Sparrate am ${dateShort(next)} liegt in der Vergangenheit. Alle Raten seit dann werden gebucht.</p>`, [{ value: '', label: 'Datum ändern' }, { value: 'ok', label: 'Nachbuchen', cls: 'primary' }])) !== 'ok') return;
  const old = potEditing;
  if (old?.archived) return err('Dieser Topf ist aufgelöst.');
  const who = whoValue($('#pot-who'));
  if (who.readOnly) return;
  const p = { ...(old ?? {}), id: old?.id ?? uid(), name, icon: $$('[name=pot-icon]').find(x => x.checked)?.value ?? '🐷', goal: goal.c || null, targetDate: date || null,
    startBalance: start.c ?? 0, autoRest: $('#pot-auto').checked, archived: false, owner: keepOwner(old, who.owner) };
  if (old && old.owner !== p.owner && state.potTx.some(t => t.potId === p.id)) return err('Ein Topf mit Bewegungen kann nicht mehr zwischen privat und gemeinsam wechseln. Lege dafür einen neuen Topf an.');
  try {
    await store.savePot(p);
    const rec = state.recurring.find(r => r.kind === 'save' && r.potId === p.id && r.active);
    if (rate.c) {
      const changed = !rec || rec.nextDue !== next;
      await store.saveRecurring({ ...(rec ?? {}), name: `Sparrate ${name}`, amount: rate.c, kind: 'save', category: 'fi-sparen', freq: 'monthly', potId: p.id, active: true, owner: p.owner, accountId: who.accountId,
        endDate: null, contractEnd: null, noticeMonths: null, ...(changed ? { startDate: next, nextDue: next, n: 0 } : {}) });
    } else if (rec) await store.deleteRecurring(rec.id);
    $('#dlg-pot').close();
    await loadAll(); render();
    toast(old ? 'Spartopf gespeichert' : `Spartopf „${name}“ angelegt`);
  } catch (e) { err(e.message); }
}
async function dissolvePot() {
  const p = potEditing, bal = potBalances(state.pots, state.potTx).get(p.id) ?? 0;
  const hasMoves = state.potTx.some(t => t.potId === p.id);
  const v = await ask(`„${p.name}“ auflösen?`, hasMoves || bal
    ? `<p>${bal > 0 ? `Die ${eur(bal)} kommen als Entnahme zurück in diesen Monat.` : 'Der Topf ist leer.'} Die Sparrate endet. Bisherige Einzahlungen bleiben in der Auswertung sichtbar.</p>`
    : '<p>Der Topf hat noch keine Bewegungen und wird gelöscht.</p>',
    [{ value: '', label: 'Abbrechen' }, { value: 'ok', label: 'Auflösen', cls: 'danger' }]);
  if (v !== 'ok') return;
  try {
    for (const r of state.recurring.filter(r => r.potId === p.id && r.active)) await store.saveRecurring({ ...r, active: false, endDate: state.today < r.startDate ? r.startDate : state.today });
    if (!hasMoves && !bal) await store.deletePot(p.id);
    else {
      if (bal > 0) await store.saveTx({ id: uid(), owner: p.owner ?? null, date: state.today, amount: bal, kind: 'unsave', category: 'fi-sparen', potId: p.id, note: 'Topf aufgelöst', source: 'manual', createdAt: new Date().toISOString() });
      await store.savePot({ ...p, archived: true, autoRest: false });
    }
    $('#dlg-pot').close(); await loadAll({ book: false }); render(); toast(`„${p.name}“ aufgelöst`);
  } catch (e) { $('#pot-err').textContent = e.message; }
}

// ---------- Einkäufe aus der Speisekammer ----------
let pantryTimer = null;
async function loadPantry() {
  if (!store.listPantryPurchases) return;
  if (!state.config.pantrySince) { // ab Einführung: nur Einkäufe der letzten 14 Tage vorschlagen, keine ganze Historie
    state.config.pantrySince = addDays(state.today, -14);
    try { await store.setConfig(state.config); } catch { /* nächstes Mal */ }
  }
  try {
    const since = new Date([state.config.pantrySince, addDays(state.today, -45)].sort().pop() + 'T00:00:00');
    const rows = await store.listPantryPurchases(new Date(since - 86400000).toISOString()); // einen Tag mehr holen, damit Einkäufe am Rand vollständig sind
    const refs = [...state.tx.map(t => t.extRef).filter(Boolean), ...(state.config.pantryDismissed ?? [])];
    const all = groupPantry(rows, 3, { since: since.toISOString() });
    state.pantry = all.filter(p => Date.now() - new Date(p.lastAt) > 3 * 60000 && !pantryDone(p.key, refs)).map(p => ({ ...p, similar: similarTx(real(state.tx), p, groupOf) }));
    // Bon wird gerade noch gespeichert: in ein paar Minuten erneut schauen
    clearTimeout(pantryTimer);
    if (all.some(p => Date.now() - new Date(p.lastAt) <= 3 * 60000)) pantryTimer = setTimeout(() => scheduleReload(), 3.5 * 60000);
  } catch (e) { console.warn('Speisekammer-Einkäufe', e); state.pantry = []; }
}
function pantryCard() {
  if (!state.pantry.length) return '';
  const list = state.pantry.slice(-5).reverse();
  const plain = state.pantry.filter(p => !p.similar).length;
  return `<div class="section-head"><h2>Aus der Speisekammer</h2>${plain > 1 ? `<button class="btn link" data-act="pantry-all">Alle ${plain} übernehmen</button>` : ''}</div>
    <div class="card" style="padding:0">${list.map(p => `<div class="suggest">
      <div class="top"><span><b>🛒 Einkauf ${esc(dayLabel(p.date, state.today))}</b><span class="tiny muted" style="display:block">${p.items.length} Artikel: ${esc(p.items.slice(0, 3).join(', '))}${p.items.length > 3 ? ' …' : ''}</span>${Object.keys(p.parts).length > 1 ? `<span class="tiny muted" style="display:block">Wird aufgeteilt: ${Object.entries(p.parts).map(([c, a]) => `${esc(cat(c).label)} ${eur(a)}`).join(', ')}</span>` : ''}</span><b>${eur(p.amount)}</b></div>
      ${p.similar ? `<p class="warnline">⚠️ Am selben Tag hast du schon ${eur(p.similar.amount)}${p.similar.note ? ` „${esc(p.similar.note)}“` : ''} erfasst. Derselbe Einkauf?</p>` : ''}
      <div class="row wrap">${p.similar
        ? `<button class="btn small" data-act="pantry-skip" data-key="${esc(p.key)}">Ja, schon erfasst</button><button class="btn small" data-act="pantry-take" data-key="${esc(p.key)}">Nein, übernehmen</button>`
        : `<button class="btn small primary" data-act="pantry-take" data-key="${esc(p.key)}">Übernehmen</button><button class="btn small" data-act="pantry-skip" data-key="${esc(p.key)}">Ignorieren</button>`}</div></div>`).join('')}</div>`;
}
async function takePantry(list) {
  let n = 0, sum = 0;
  for (const p of list) {
    // Je Kategorie eine Buchung (z. B. Lebensmittel und Putzmittel vom selben Bon)
    try {
      for (const [category, amount] of Object.entries(p.parts)) {
        try { await store.saveTx({ id: uid(), owner: null, accountId: state.accounts.find(a => a.owner == null && !a.archived)?.id ?? null, date: p.date, amount, kind: 'expense', category, note: 'Einkauf (Speisekammer)', source: 'pantry', extRef: `${p.key}:${category}`, createdAt: new Date().toISOString() }); sum += amount; }
        catch (e) { if (!e.duplicate) throw e; }
      }
      n++;
    } catch (e) { ask('Nicht übernommen', `<p>${esc(e.message)}</p>`); break; }
  }
  await loadAll({ book: false }); render();
  if (n) toast(`${n === 1 ? 'Einkauf' : n + ' Einkäufe'} übernommen: ${eur(sum)}`);
}
function dismissPantry(keys) {
  state.config.pantryDismissed = [...(state.config.pantryDismissed ?? []), ...keys].slice(-300);
  state.pantry = state.pantry.filter(p => !keys.includes(p.key));
  saveConfigSoon(0); render();
}

// ---------- Einstellungen ----------
let cfgTimer = null, cfgDirty = false;
// Lokale Änderung bleibt maßgeblich, bis sie gespeichert ist (ein Neuladen dazwischen überschreibt sie nicht)
function saveConfigSoon(delay = 600) { cfgDirty = true; clearTimeout(cfgTimer); cfgTimer = setTimeout(async () => { try { await store.setConfig(state.config); cfgDirty = false; } catch (e) { toast('Einstellungen nicht gespeichert: ' + e.message); } }, delay); }
function openSettings(focus) {
  const hh = store.household(), limits = state.config.limits ?? {};
  const mm = myMember(), share = { tx: 'none', fixed: 'none', pots: 'none', policies: 'none', ...mm.share };
  const partner = others().map(m => m.displayName || 'Partner').join(' und ') || 'Dein Partner';
  const shareRow = (area, label, levels) => `<div class="share-row"><span>${label}</span><div class="seg small" role="radiogroup" aria-label="${label}">${levels.map(([v, l]) =>
    `<label><input type="radio" name="share-${area}" value="${v}" ${share[area] === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>`;
  $('#settings-body').innerHTML = `
    <section class="set-group"><h3>Du</h3>
      <label class="field">Dein Name im Haushalt<input id="me-name" maxlength="30" value="${esc(mm.displayName ?? '')}"></label>
      <div class="share-row"><span>Neue Einträge von deinem Konto</span><div class="seg small" role="radiogroup" aria-label="Neue Einträge"><label><input type="radio" name="me-default" value="shared" ${mm.defaultPrivate ? '' : 'checked'}><span>👥 Gemeinsam</span></label><label><input type="radio" name="me-default" value="private" ${mm.defaultPrivate ? 'checked' : ''}><span>🔒 Nur ich</span></label></div></div>
      <p class="tiny muted">Was vom Gemeinschaftskonto bezahlt wird, ist immer gemeinsam. Jede Buchung lässt sich einzeln umstellen.</p>
    </section>
    <section class="set-group"><h3>Freigabe: was ${esc(partner)} von deinen privaten Sachen sieht</h3>
      ${shareRow('tx', 'Buchungen', [['none', 'Nichts'], ['sums', 'Nur Summen'], ['all', 'Alles']])}
      ${shareRow('fixed', 'Fixkosten', [['none', 'Nichts'], ['sums', 'Nur Summe'], ['all', 'Alles']])}
      ${shareRow('pots', 'Spartöpfe', [['none', 'Nichts'], ['sums', 'Nur Summe'], ['all', 'Alles']])}
      ${shareRow('policies', 'Versicherungen', [['none', 'Nichts'], ['all', 'Alles']])}
      <p class="tiny muted">„Nur Summen“: Monatssummen je Kategorie bzw. Gesamtstand, keine einzelnen Buchungen, Notizen oder Namen. Gemeinsame Einträge sehen immer alle. Ansehen heißt nicht ändern: Private Einträge kann nur ihr Besitzer bearbeiten.</p>
    </section>
    <section class="set-group"><h3>Konten</h3>
      <div>${state.accounts.map(a => `<div class="acc-row"><span>${esc(accLabel(a))} <span class="owner-tag">${a.owner == null ? 'gemeinsam' : a.owner === me() ? 'meins' : esc(memberName(a.owner))}${a.archived ? ' · ausgeblendet' : ''}</span></span>
        ${canWrite(a.owner) ? `<button class="btn small" data-acc-toggle="${esc(a.id)}">${a.archived ? 'Einblenden' : 'Ausblenden'}</button>` : '<span></span>'}</div>`).join('') || '<p class="muted">Noch keine Konten.</p>'}</div>
      <form id="form-acc" class="row wrap"><input id="acc-name" placeholder="z. B. Tagesgeld, Kreditkarte" maxlength="40" aria-label="Name des Kontos" style="flex:2;min-width:140px">
        <select id="acc-owner" aria-label="Wem gehört das Konto" style="flex:1;min-width:120px"><option value="me">Meins</option><option value="shared">Gemeinsam</option></select><button class="btn">Dazu</button></form>
    </section>
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
  // Änderungen sammeln (Name, Freigabe, Vorgabe) und gemeinsam speichern, damit keine verloren geht
  let meTimer = null, mePatch = {};
  const saveMe = (patch, delay = 0) => {
    mePatch = { ...mePatch, ...patch, share: { ...(mePatch.share ?? {}), ...(patch.share ?? {}) } };
    clearTimeout(meTimer); meTimer = setTimeout(async () => {
      const p = mePatch; mePatch = {};
      try { const cur = myMember(); const saved = await store.saveMe({ ...cur, ...p, share: { ...cur.share, ...p.share } }); state.members = state.members.filter(m => m.userId !== me()).concat(saved); render(); }
      catch (e) { toast('Nicht gespeichert: ' + e.message); } }, delay);
  };
  $('#me-name').oninput = e => saveMe({ displayName: e.target.value.trim() }, 700);
  $$('[name=me-default]').forEach(r => r.onchange = () => saveMe({ defaultPrivate: r.value === 'private' }));
  for (const area of ['tx', 'fixed', 'pots', 'policies']) $$(`[name=share-${area}]`).forEach(r => r.onchange = () => { saveMe({ share: { [area]: r.value } }); toast('Freigabe gespeichert'); });
  $('#form-acc').onsubmit = async e => {
    e.preventDefault(); const name = $('#acc-name').value.trim(); if (!name) return;
    try { await store.saveAccount({ name, owner: $('#acc-owner').value === 'me' ? me() : null, icon: $('#acc-owner').value === 'me' ? '💳' : '🏦' }); state.accounts = await store.listAccounts(); openSettings(); }
    catch (err) { toast(err.message); }
  };
  $$('[data-acc-toggle]').forEach(b => b.onclick = async () => {
    const a = accOf(b.dataset.accToggle);
    try { await store.saveAccount({ ...a, archived: !a.archived }); state.accounts = await store.listAccounts(); openSettings(); } catch (err) { toast(err.message); }
  });
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
  const blob = new Blob([toCsv(real(state.tx), catPath)], { type: 'text/csv;charset=utf-8' });
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
    const sb = e.target.closest('[data-scope]');
    if (sb) { state.scope = sb.dataset.scope; localStorage.setItem('haushaltskasse.scope', state.scope); render(); return; }
    const af = e.target.closest('[data-acc-filter]');
    if (af) { state.txFilter = { q: '', kind: 'all', group: '', account: af.dataset.accFilter }; show('tx'); return; }
    const el = e.target.closest('[data-tx],[data-pot],[data-rec],[data-pol],[data-ask],[data-file],[data-act],[data-group]');
    if (el?.closest('#dlg-pot')) return;
    if (!el || el.closest('#dlg-tx')) return;
    if (el.dataset.pot) return openPot(potOf(el.dataset.pot));
    if (el.dataset.tx) return openTx(state.tx.find(t => t.id === el.dataset.tx));
    if (el.dataset.rec) return openRec(state.recurring.find(r => r.id === el.dataset.rec));
    if (el.dataset.pol) return openPolicy(state.policies.find(p => p.id === el.dataset.pol));
    if (el.dataset.ask !== undefined && el.hasAttribute('data-ask')) return chat.open(el.dataset.ask);
    if (el.dataset.file) { const p = state.policies.find(x => x.id === el.dataset.file); try { window.open(await store.policyFileUrl(p.filePath), '_blank', 'noopener'); } catch (err) { toast(err.message); } return; }
    if (el.dataset.group && !el.dataset.act) { state.txFilter = { q: '', kind: 'expense', group: el.dataset.group, account: '' }; return show('tx'); }
    const act = el.dataset.act;
    if (act === 'add') openTx();
    else if (act === 'add-rec') openRec();
    else if (act === 'add-income') openRec(null, { kind: 'income', name: 'Gehalt', category: 'ei-gehalt' });
    else if (act === 'add-pol') openPolicy();
    else if (act === 'add-pot') openPot();
    else if (act === 'rest-book') { const pot = potOf($('#rest-pot').value); if (pot) bookRest(el.dataset.month, pot, +el.dataset.amount); }
    else if (act === 'rest-keep') { state.config.closed = { ...(state.config.closed ?? {}), [el.dataset.month]: 'keep' }; saveConfigSoon(0); render(); }
    else if (act === 'pantry-take') takePantry(state.pantry.filter(p => p.key === el.dataset.key));
    else if (act === 'pantry-all') takePantry(state.pantry.filter(p => !p.similar));
    else if (act === 'pantry-skip') { dismissPantry([el.dataset.key]); }
    else if (act === 'fixed') show('fixed');
    else if (act === 'tx') show('tx');
    else if (act === 'limits') openSettings('limits');
    else if (act === 'clear-filter') { state.txFilter = { q: '', kind: 'all', group: '', account: '' }; renderTx(); }
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

  // Spartopf
  $('#form-pot').onsubmit = e => { e.preventDefault(); savePotForm(); };
  $('#pot-delete').onclick = () => dissolvePot();

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
  await ensureSetup();
  await autoRest();
  showOutbox();
  store.onChange(() => scheduleReload());
  show(state.view);
}

// Ohne Netz: letzten Stand zeigen, neue Buchungen landen in der Warteschlange und gehen raus, sobald wieder Netz da ist
function startOffline(snap) {
  Object.assign(state, { tx: [...outbox.get().filter(o => o.op === 'save').map(o => o.tx), ...snap.tx].sort(byDateDesc), recurring: snap.recurring, policies: snap.policies, pots: snap.pots ?? [], potTx: snap.potTx ?? [], members: snap.members ?? [], accounts: snap.accounts ?? [], memberIds: snap.memberIds ?? [], sums: snap.sums ?? [], config: { limits: {}, custom: [], ...snap.config } });
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
