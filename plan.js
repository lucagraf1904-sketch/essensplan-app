// Essensplan (Wochenplan) mit Gerichten und Dienstplan.
// Regeln aus „Essensplan-Logik v1“ (Doc vom 21./22.11.2026), vereinfacht für v1:
// bald Ablaufendes zuerst, Vorrat nutzen, aktuelle Angebote, Lieblingsgerichte, lange nicht Gegessenes, 2× Fisch, höchstens 2× Rind,
// keine Wiederholung, lange Gerichte eher am Wochenende, Schichten (Nacht: leicht; Spät: Dose; Vortag: vorkochen).
// Noch nicht drin: Nährstoffkonto (BLS-Daten), Kalorien je Zubereitungsart. Der Plan liegt unter 'speisekammer.plan' (Haushalt).
import { isoLocal } from './categories.js';
import { activeRecipes, loadRecipes, STARTERS, KINDS, TAGS, addStarters, upsertRecipe, updateRecipe, deleteRecipe, markCooked, recipeFromParts, parseRecipeText, needFromLine } from './recipes.js';
import { SHIFTS, SHIFT_ORDER, SOURCES as SHIFT_SOURCES, shiftsOn, shiftOf, setShift, mealAdvice, shiftDay, shiftConf, setShiftConf, setShiftDay } from './shifts.js';
import { getSettings } from './settings.js';
import { offersFor, chainName } from './offers.js';
import { loadMeds } from './meds.js';
import { GRUNDSTOCK, GRUNDSTOCK_SOURCE } from './suggestions.js';

let goalsOpen = false;
const PLAN_KEY = 'speisekammer.plan', SHOP_KEY = 'speisekammer.shopping';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = n => (+n).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return isoLocal(d); };
const daysTo = iso => Math.round((new Date(iso + 'T12:00') - new Date(isoLocal() + 'T12:00')) / 86400000);
const has = (items, w) => items.find(i => i.qty > 0 && i.category !== 'Reste' && i.name.toLowerCase().includes(w));
const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`;
const dayLabel = iso => { const d = new Date(iso + 'T12:00'), t = daysTo(iso); return `${t === 0 ? 'Heute' : t === 1 ? 'Morgen' : DAYS[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.`; };

const BREAKFASTS = [
  { title: 'Dinkel-Vollkorn-Toast mit Ei und Paprika', need: [['toast', 'Dinkel-Vollkorn-Toast'], ['eier', 'Eier']] },
  { title: 'Roggen-Vollkornbrot mit Käse und Gurke', need: [['roggen', 'Roggen-Vollkornbrot'], ['gouda', 'Gouda']] },
  { title: 'Naturjoghurt mit Apfel und Haferflocken', need: [['joghurt', 'Naturjoghurt'], ['äpfel', 'Äpfel'], ['hafer', 'Haferflocken']] },
  { title: 'Dinkel-Vollkorn-Toast mit Quark und Tomate', need: [['toast', 'Dinkel-Vollkorn-Toast'], ['quark', 'Magerquark']] },
  { title: 'Laugenbrezel mit Käse und Obst (Wochenend-Ausnahme)', need: [['laugen', 'Laugenbrezel'], ['gouda', 'Gouda']], weekend: true },
];

let ctx = null, view = 'week', items = [], offers = [];
const loadPlan = () => { try { return JSON.parse(localStorage.getItem(PLAN_KEY)); } catch { return null; } };
function savePlan(p) {
  localStorage.setItem(PLAN_KEY, JSON.stringify(p));
  // Für pünktliche Push-Erinnerungen (Edge Function „reminders“ liest meal_plan)
  ctx?.store?.savePlanRows?.(p.days.map(d => { const m = mealOf(d); return { date: d.date, title: m.title, method: m.method, minutes: m.min, status: d.status }; })).catch?.(e => console.warn('Plan-Abgleich', e));
}
const needOf = (d, r) => d?.need ?? r?.need ?? [];
const needLabel = n => n[2] ? `${n[1]} (${n[2]})` : n[1];
const recipe = id => loadRecipes().find(r => r.id === id) ?? STARTERS.find(r => r.id === id);
function mealOf(d) {
  if (d.leftover) return { title: d.leftover.name, method: 'Aufwärmen', min: 10 };
  const r = recipe(d.dinner); return r ? { title: r.title, method: r.method, min: r.min } : { title: d.title ?? 'Gericht gelöscht', method: '', min: 0 };
}

// ---------- Planung ----------
// Nur selbst gewählte Ausschlüsse (Einstellungen). Erkrankungen und Medikamente ändern den Plan nie automatisch (Luca 23.11.2026).
function excludedBy(r) {
  const ex = getSettings().planExclude ?? []; if (!ex.length) return null;
  const hay = [r.title, ...(r.need ?? []).flat(), ...(r.ingredients ?? [])].join(' ').toLowerCase();
  return ex.find(e => hay.includes(e.w)) ?? null;
}
function score(r, i, date, chosen, forgottenUsed) {
  const s = getSettings(), prefs = s.prefs ?? [], why = [];
  let p = 0;
  const meat = ['rind', 'schwein', 'gefluegel'];
  if (prefs.includes('vegetarisch') && (meat.includes(r.kind) || r.kind === 'fisch')) return null;
  if (excludedBy(r)) return null;
  if (chosen.some(c => c.id === r.id)) p -= 10;
  // Vorrat und Ablauf
  let usedMain = false;
  for (const [w, n] of r.need ?? []) {
    const it = has(items, w); if (!it) continue;
    const d = it.expiry && !it.frozenAt ? daysTo(it.expiry) : 99;
    if (i > Math.max(d, 0)) continue; // bis dahin abgelaufen
    if (!usedMain && chosen.some(c => c.need?.[0]?.[0] === w) && r.need[0][0] === w) continue; // Hauptzutat schon verplant
    usedMain = true;
    if (it.frozenAt) { p += 1; if (i === 0 && !r.fromFrozenOk) p -= 2; else why.push(`${it.name} ist eingefroren da`); }
    else if (d <= 1) { p += 5; why.push(`${it.name} läuft ${d <= 0 ? 'heute' : 'morgen'} ab`); }
    else if (d <= 3) { p += 3.5; why.push(`${it.name} läuft in ${d} Tagen ab`); }
    else if (d <= 7) { p += 1.5; why.push(`${it.name} ist da`); }
    else p += 1;
  }
  // Angebote für fehlende Zutaten
  let offerWhy = null;
  for (const [w, n] of r.need ?? []) {
    if (has(items, w)) continue;
    const o = offersFor(n, offers)[0];
    if (o) { p += 1.5; offerWhy ??= `🏷️ ${n} im Angebot (${chainName(o.chain)} ${eur(o.price)})`; }
  }
  if (offerWhy) why.push(offerWhy);
  // Vorlieben
  if (r.fav) { p += 2; why.push('Lieblingsgericht'); }
  if (r.kind === 'schwein' && prefs.includes('keinSchwein')) p -= 4;
  const meatN = chosen.filter(c => meat.includes(c.kind)).length;
  if (prefs.includes('wenigFleisch') && meat.includes(r.kind) && meatN >= 2) p -= 3;
  // Wochenregeln (Schalter „planHealthRules“)
  if (s.planHealthRules) {
    const fish = chosen.filter(c => c.kind === 'fisch').length, beef = chosen.filter(c => c.kind === 'rind').length, veg = chosen.filter(c => c.kind === 'veggie').length;
    const wf = s.weekFish ?? 2, wb = s.weekBeef ?? 1, wv = s.weekVeg ?? 0, wg = s.weekVegG ?? 0;
    if (r.kind === 'fisch' && fish < wf) { p += 2; if (i >= 3) why.push(`Fischabend (Ziel ${wf}× pro Woche)`); }
    if (r.kind === 'fisch' && fish >= wf) p -= wf ? 3 : 6;
    if (r.kind === 'rind' && beef >= wb) p -= wb ? 4 : 6;
    if (r.kind === 'veggie' && veg < wv) { p += 2; if (i >= 3) why.push(`Vegetarischer Abend (Ziel ${wv}× pro Woche)`); }
    if (wg && r.veg) p += r.veg >= wg ? 1 : -1;
  }
  // Abwechslung
  const prev = chosen.at(-1);
  if (prev && prev.kind === r.kind && r.kind !== 'veggie') p -= 1.5;
  // Lange nicht gegessen (höchstens 2× pro Woche)
  const since = r.last ? daysTo(r.last) * -1 : null;
  if (forgottenUsed < 2 && r.count && since != null && since >= 28) { p += 2; why.push(`Lange nicht gegessen (${Math.round(since / 7)} Wochen)`); }
  // Lange Gerichte eher am Wochenende
  const wd = new Date(date + 'T12:00').getDay();
  if (wd >= 1 && wd <= 5 && r.min > 60) p -= 1.5;
  // Schichten
  const sh = shiftsOn(date);
  if (sh.some(x => x.code === 'N')) {
    if (r.tags?.includes('leicht')) { p += 2.5; why.push('leicht, passt vor die Nachtschicht'); }
    if ((r.kcal ?? 0) > 600) p -= 2;
  }
  if (sh.some(x => x.code === 'S') && r.min > 45) p -= 1.5; // Spätschicht: wer zu Hause ist, kocht eher kurz
  const tomorrow = shiftsOn(addDays(date, 1));
  if (tomorrow.some(x => (x.code === 'S' || x.code === 'N') && shiftDay(x.person, addDays(date, 1))?.snack) && r.tags?.includes('mitnehmen')) { p += 1; why.push('1 Portion mehr für die Dose morgen'); }
  return { p, why };
}

function breakfastFor(i, date, used) {
  const wd = new Date(date + 'T12:00').getDay();
  const bf = BREAKFASTS.filter(b => (!b.weekend || wd === 0 || wd === 6) && !excludedBy(b));
  if (!bf.filter(b => !b.weekend).length) return 'Frühstück nach Wahl';
  const urgent = bf.find(b => b.need.some(([w]) => { const it = has(items, w); return it && !it.frozenAt && it.expiry && i <= daysTo(it.expiry) && daysTo(it.expiry) <= 1 && !used.has(w); }));
  if (urgent) urgent.need.forEach(([w]) => used.add(w));
  const weekend = bf.find(b => b.weekend);
  const normal = bf.filter(b => !b.weekend);
  return (urgent ?? (weekend && wd === 0 ? weekend : normal[i % normal.length])).title;
}

function rank(i, date, chosen, forgottenUsed, exclude = []) {
  return activeRecipes().filter(r => !exclude.includes(r.id)).map(r => ({ r, sc: score(r, i, date, chosen, forgottenUsed) }))
    .filter(x => x.sc).sort((a, b) => b.sc.p - a.sc.p);
}

function build(start = isoLocal(), keep = [], dry = false) {
  const chosen = [], days = [], usedBf = new Set();
  let forgotten = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i), kept = keep.find(d => d.date === date && (d.status !== 'geplant' || d.leftover || (d.need && recipe(d.dinner) && !excludedBy(recipe(d.dinner)))));
    if (kept) { days.push(kept); const r = recipe(kept.dinner); if (r) chosen.push(r); continue; }
    const best = rank(i, date, chosen, forgotten)[0];
    if (!best) { days.push({ date, dinner: null, why: [], breakfast: breakfastFor(i, date, usedBf), status: 'geplant' }); continue; }
    if (best.sc.why.some(w => w.startsWith('Lange nicht'))) forgotten++;
    chosen.push(best.r);
    days.push({ date, dinner: best.r.id, title: best.r.title, why: best.sc.why.slice(0, 3), breakfast: breakfastFor(i, date, usedBf), status: 'geplant' });
  }
  const p = { start, days, made: new Date().toISOString() }; if (!dry) savePlan(p); return p;
}
function getPlan() {
  const p = loadPlan();
  if (!activeRecipes().length) return p?.days?.length ? p : { days: [] };
  if (!p || !p.days?.length || daysTo(p.days.at(-1).date) < 0) return build();
  // Vergangene Tage abschneiden, Woche nach hinten auffüllen
  if (daysTo(p.days[0].date) < 0) return rebuildFrom(p.days.filter(d => daysTo(d.date) >= 0));
  // Selbst gewählter Ausschluss neu dazugekommen: betroffene offene Tage neu planen
  if (p.days.some(d => d.status === 'geplant' && !d.leftover && recipe(d.dinner) && excludedBy(recipe(d.dinner)))) return build(isoLocal(), p.days);
  return p;
}
// Bestehende Tage behalten, nur fehlende Tage am Ende neu planen
function rebuildFrom(keep) {
  const chosen = keep.map(d => recipe(d.dinner)).filter(Boolean), days = [...keep], usedBf = new Set();
  for (let i = days.length; i < 7; i++) {
    const date = addDays(isoLocal(), i), best = rank(i, date, chosen, 0)[0];
    if (best) chosen.push(best.r);
    days.push({ date, dinner: best?.r.id ?? null, title: best?.r.title, why: best?.sc.why.slice(0, 3) ?? [], breakfast: breakfastFor(i, date, usedBf), status: 'geplant' });
  }
  const p = { start: isoLocal(), days, made: new Date().toISOString() }; savePlan(p); return p;
}

// Für die Abendessen-Erinnerung (app.js)
export async function getPlannedMeal(date, meal = 'dinner') {
  if (meal !== 'dinner') return null;
  const d = loadPlan()?.days?.find(x => x.date === date); if (!d || (!d.dinner && !d.leftover)) return null;
  const m = mealOf(d), r = recipe(d.dinner);
  const thaw = r && !d.leftover ? needOf(d, r).map(([w]) => has(items, w)).find(i => i?.frozenAt) : null;
  return { date, meal, title: m.title, totalMinutes: m.min, method: m.method, thawFrom: thaw ? addDays(date, -1) : null, status: d.status };
}

// ---------- Anzeige ----------
const loadShop = () => { try { return JSON.parse(localStorage.getItem(SHOP_KEY)) ?? []; } catch { return []; } };
function toast(msg) {
  let t = document.getElementById('plan-toast');
  if (!t) { t = Object.assign(document.createElement('div'), { id: 'plan-toast' }); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2500);
}
const tabsHtml = s => `<div class="seg wrap plan-views">
  <button type="button" data-view="week" class="${view === 'week' ? 'active' : ''}">📅 Woche</button>
  <button type="button" data-view="recipes" class="${view === 'recipes' ? 'active' : ''}">📖 Gerichte</button>
  <button type="button" data-view="shifts" class="${view === 'shifts' ? 'active' : ''}">🗓️ Kalender</button></div>`;

export async function render() {
  const el = $('#tab-plan'); if (!el || !ctx) return;
  [items, offers] = await Promise.all([ctx.store.listItems(), ctx.allOffers().catch(() => [])]);
  const s = getSettings();
  el.innerHTML = `<h2>Essensplan</h2>${tabsHtml(s)}<div id="plan-body"></div>`;
  const body = $('#plan-body');
  if (view === 'recipes') return renderRecipes(body);
  if (view === 'shifts') return renderShifts(body);
  renderWeek(body, s);
}

function shiftLine(date, s) {
  return shiftsOn(date).map(({ person }) => {
    const sd = shiftDay(person, date); if (!sd) return '';
    const a = mealAdvice(sd, person === s.myName ? { noFridge: s.workNoFridge, noMicrowave: s.workNoMicrowave, dinnerAt: s.dinnerAt } : { dinnerAt: s.dinnerAt });
    const times = `${SHIFTS[sd.code].icon} <b>${esc(person)}</b>: ${esc(a.short)} ${sd.from}–${sd.to} · Essen ${sd.main || s.dinnerAt}${sd.snack ? ` · Pause ${sd.snack}` : ''}`;
    if (!s.shiftTips || !a.tips.length) return `<div class="plan-shift tiny">${times}</div>`;
    return `<details class="plan-shift"><summary>${times}</summary><ul class="tiny">${a.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>`;
  }).join('');
}

function renderWeek(body, s) {
  const recs = activeRecipes();
  if (!recs.length) {
    body.innerHTML = `<div class="tip hint"><b>Noch keine Gerichte</b><p>Der Plan wählt aus euren Gerichten. Tragt eure Lieblingsgerichte ein oder übernehmt die ${STARTERS.length} Beispielgerichte und ändert sie nach Belieben.</p>
      <div class="tip-alts"><button class="chip" data-rec="starters">Beispielgerichte übernehmen</button><button class="chip" data-rec="new">＋ Eigenes Gericht</button></div></div>`;
    return;
  }
  const p = getPlan(), listed = new Set(loadShop().filter(x => !x.done).map(x => x.name.toLowerCase()));
  const rs = p.days.filter(d => d.status !== 'uebersprungen' && !d.leftover).map(d => recipe(d.dinner)).filter(Boolean);
  const fish = rs.filter(r => r.kind === 'fisch').length, meat = rs.filter(r => ['rind', 'schwein'].includes(r.kind)).length;
  const veg = Math.round(rs.reduce((a, r) => a + (r.veg ?? 0), 0) / Math.max(1, rs.length));
  const rests = items.filter(i => i.category === 'Reste' && !i.frozenAt && i.qty > 0 && !p.days.some(d => d.leftover?.id === i.id));
  const restDay = p.days.findIndex(d => d.status === 'geplant' && !d.leftover && daysTo(d.date) >= 0);
  const ex = s.planExclude ?? [], hasInfo = (s.health ?? []).length || loadMeds().groups.length || ex.length;
  const info = hasInfo ? `<div class="tip hint tiny">ℹ️ Der Plan richtet sich nicht selbst nach Erkrankungen oder Medikamenten. Hinweise und Vorschläge stehen unter Einstellungen; Lebensmittel schließt du dort selbst aus.${ex.length ? ` Ausgeschlossen: ${ex.map(e => esc(e.label)).join(', ')}.` : ''}</div>` : '';
  const goal = (k, icon, label, def, max, suffix = '×', step = 1) => { const v = s[k] ?? def; return `<span class="goal"><span>${icon} ${label}</span><button type="button" class="chip" data-goal="${k}" data-d="${-step}" data-max="${max}" aria-label="weniger">−</button><b>${v ? v + suffix : 'aus'}</b><button type="button" class="chip" data-goal="${k}" data-d="${step}" data-max="${max}" aria-label="mehr">＋</button></span>`; };
  const goals = s.planHealthRules ? `<details class="tip hint goals" ${goalsOpen ? 'open' : ''}><summary>🎯 Wochenziele: Fisch ${s.weekFish ?? 2}×, Rind höchstens ${s.weekBeef ?? 1}×${(s.weekVeg ?? 0) ? `, vegetarisch ${s.weekVeg}×` : ''}${(s.weekVegG ?? 0) ? `, Gemüse ab ${s.weekVegG} g` : ''}</summary>
      <div class="goal-rows">${goal('weekFish', '🐟', 'Fisch pro Woche', 2, 5)}${goal('weekBeef', '🥩', 'Rind höchstens', 1, 5)}${goal('weekVeg', '🥦', 'Vegetarische Abende', 0, 7)}${goal('weekVegG', '🥗', 'Gemüse pro Abend mind.', 0, 500, ' g', 50)}</div>
      <p class="tiny muted">Der Plan richtet sich danach, soweit eure Gerichte es hergeben. Änderungen gelten für den Haushalt und planen die offenen Tage neu (Gekochtes bleibt).</p></details>` : '';
  body.innerHTML = `${info}${goals}<div class="plan-sum"><span>🐟 Fisch ${fish}×</span><span>🥩 Rind/Schwein ${meat}×</span>${veg ? `<span>🥦 ca. ${veg} g Gemüse/Abend</span>` : ''}</div>
    <ul class="list plan-list">${p.days.map((d, i) => {
      const today = daysTo(d.date) === 0, r = recipe(d.dinner), m = mealOf(d);
      const head = `<div class="plan-date">${dayLabel(d.date)}</div>${shiftLine(d.date, s)}<div class="tiny muted">☀️ 11–12:30 Uhr · ${esc(d.breakfast)}</div>`;
      const restBox = i === restDay && rests.length ? `<div class="plan-rest">🍲 Im Kühlschrank: ${rests.map(x => `<b>${esc(x.name)}</b> (${esc(x.qty)} ${x.qty === 1 ? 'Portion' : 'Portionen'})`).join(', ')}
          <div class="tip-alts">${rests.map(x => `<button class="chip" data-act="useleft" data-rest="${x.id}">🍽️ ${today ? 'Heute' : 'Dann'} Rest essen${rests.length > 1 ? ': ' + esc(x.name.replace(/^Rest: /, '')) : ''}</button>`).join('')}</div>
          <div class="tiny muted">Das geplante Gericht rückt dann einen Tag nach hinten. Reste höchstens 2 Tage im Kühlschrank (Verbraucherzentrale).</div></div>` : '';
      if (d.leftover) return `<li class="plan-day ${d.status}" data-i="${i}">${head}
        <div class="plan-dinner"><b>🍲 ${esc(d.leftover.name)}</b><div class="tiny">Reste · Aufwärmen, gut durcherhitzen · ca. 10 min</div>
          ${r ? `<div class="tiny muted">${esc(r.title)} ist auf den nächsten Tag verschoben.</div>` : ''}</div>
        ${d.status === 'gekocht' ? '<div class="good-tag">✓ Gegessen</div>' : `<div class="tip-alts"><button class="chip" data-act="done">✓ Gegessen</button><button class="chip" data-act="unleft">Doch frisch kochen</button></div>`}
      </li>`;
      if (!r) return `<li class="plan-day" data-i="${i}">${restBox}${head}<div class="plan-dinner muted">Kein passendes Gericht. <button class="chip" data-act="swap">🔄 Vorschlag</button></div></li>`;
      const missing = needOf(d, r).filter(([w]) => !has(items, w)).map(([, n]) => n);
      const toBuy = missing.filter(n => !listed.has(n.toLowerCase()));
      const thaw = needOf(d, r).map(([w]) => has(items, w)).find(x => x?.frozenAt);
      const tomorrowAway = shiftsOn(addDays(d.date, 1)).filter(x => (x.code === 'S' || x.code === 'N') && shiftDay(x.person, addDays(d.date, 1))?.snack);
      return `<li class="plan-day ${d.status}" data-i="${i}">${restBox}${head}
        <div class="plan-dinner"><b>🍽️ ${esc(m.title)}</b>${r.fav ? ' <span title="Lieblingsgericht">★</span>' : ''}
          <div class="tiny">${esc(KINDS[r.kind] ?? '')}${r.method ? ' · ' + esc(r.method) : ''} · ${fmtMin(r.min)}${r.kcal ? ` · ca. ${r.kcal} kcal` : ''}</div>
          ${d.need ? `<div class="tiny plan-changed">✏️ Zutaten für diesen Tag angepasst</div>` : ''}
          ${d.why?.length ? `<div class="tiny plan-why">${d.why.map(w => `<span>✓ ${esc(w)}</span>`).join('')}</div>` : ''}
          ${thaw ? `<div class="tiny plan-thaw">❄️ ${esc(thaw.name)} am Vorabend in den Kühlschrank legen</div>` : ''}
          ${tomorrowAway.length ? `<div class="tiny plan-thaw">🍱 Vorkochen: ${tomorrowAway.map(x => `${esc(x.person)} hat morgen ${SHIFTS[x.code].label}schicht`).join(', ')}. ${r.tags?.includes('mitnehmen') ? '1 Portion mehr kochen und in die Dose.' : 'Für die Dose eignet sich das Gericht weniger, lieber etwas Kaltes vorbereiten.'}</div>` : ''}
          ${missing.length ? `<div class="tiny muted">Fehlt: ${missing.map(n => listed.has(n.toLowerCase()) ? `${esc(n)} ✓` : esc(n)).join(', ')}</div>` : ''}
          ${missing.length && !toBuy.length ? '<div class="tiny good-tag">🛒 Alles Fehlende steht auf der Einkaufsliste</div>' : ''}
          ${r.ingredients?.length || r.steps?.length || r.url ? `<details class="tiny"><summary>Rezept</summary>
            ${d.need ? `<ul>${d.need.map(n => `<li>${esc(needLabel(n))}</li>`).join('')}</ul>` : r.ingredients?.length ? `<ul>${r.ingredients.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
            ${r.steps?.length ? `<ol>${r.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
            ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">Originalrezept öffnen ↗</a>` : ''}</details>` : ''}
        </div>
        ${d.status === 'gekocht' ? '<div class="good-tag">✓ Gekocht</div>' : d.status === 'uebersprungen' ? '<div class="muted tiny">Übersprungen</div>' : `<div class="tip-alts">
          <button class="chip" data-act="swap">🔄 Anderes Gericht</button>
          <button class="chip" data-act="done">✓ Gekocht</button>
          <button class="chip" data-act="needs">✏️ Zutaten anpassen</button>
          <button class="chip" data-act="skip">Überspringen</button>
          ${toBuy.length ? `<button class="chip" data-act="shop">＋ Fehlendes auf die Liste</button>` : ''}</div>`}
        ${d.status !== 'geplant' ? '<button class="chip" data-act="undo">Rückgängig</button>' : ''}
      </li>`;
    }).join('')}</ul>
    <button id="plan-new">🔄 Plan anhand Vorrat neu prüfen</button><p class="tiny muted">Zeigt zuerst eine Vorschau. Gekochte, übersprungene und eigene angepasste Tage sowie eingeplante Reste bleiben, die Wochenziele auch.</p>
    <p class="muted tiny">Kalorien sind grobe Schätzungen pro Portion. Regeln: bald Ablaufendes und Vorrat zuerst, Angebote, Lieblingsgerichte, lange nicht Gegessenes, ${s.planHealthRules ? '2× Fisch, höchstens 2× Rind, ' : ''}lange Gerichte eher am Wochenende${s.shiftsOn ? ', Schichten (Hinweise nach ' + SHIFT_SOURCES + ')' : ''}. Nährstoffe pro Woche kommen später.</p>`;
}

let recTab = 'plan';
function renderRecipes(body) {
  if (recTab === 'ideas') return renderIdeas(body);
  const all = loadRecipes(), missingStarters = STARTERS.filter(x => !all.some(r => r.id === x.id)).length;
  const inPlan = all.filter(r => !r.store), stored = all.filter(r => r.store);
  const l = (recTab === 'store' ? stored : inPlan).sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || a.title.localeCompare(b.title, 'de'));
  const today = loadPlan()?.days?.find(d => daysTo(d.date) === 0);
  body.innerHTML = `<div class="seg wrap rec-tabs">
      <button type="button" data-rectab="plan" class="${recTab === 'plan' ? 'active' : ''}">🍽️ Im Plan (${inPlan.length})</button>
      <button type="button" data-rectab="store" class="${recTab === 'store' ? 'active' : ''}">📚 Rezeptspeicher (${stored.length})</button>
      <button type="button" data-rectab="ideas" class="${recTab === 'ideas' ? 'active' : ''}">💡 Vorschläge</button></div>
    <p class="tiny muted">${recTab === 'store' ? 'Hier liegen Rezepte zum Nachschlagen. Der Plan nimmt sie nicht von selbst; ihr könnt sie jederzeit kochen oder in den Plan aufnehmen.' : 'Aus diesen Gerichten stellt die App den Wochenplan zusammen.'}</p>
    <div class="tip-alts">
      <button class="chip" data-rec="new">＋ Neues Rezept</button>
      <button class="chip" data-rec="link">🔗 Per Link</button>
      <button class="chip" data-rec="paste">📋 Rezepttext einfügen</button>
      <button class="chip ai-only" data-rec="photo">📷 Per Foto (KI)</button>
      ${missingStarters ? `<button class="chip" data-rec="starters">Beispielgerichte (${missingStarters})</button>` : ''}</div>
    <input id="rec-q" type="search" placeholder="Rezept suchen …" autocomplete="off" value="${esc(recQ)}">
    <ul class="list rec-list">${l.map(r => `<li data-rec-id="${r.id}" data-q="${esc(recText(r))}" class="${r.paused ? 'paused' : ''}"${recQ && !recText(r).includes(recQ.toLowerCase()) ? ' hidden' : ''}>
      <details><summary><div class="name">${r.fav ? '★ ' : ''}${esc(r.title)}${r.paused ? ' <span class="muted tiny">(pausiert)</span>' : ''}</div>
        <div class="meta">${esc(KINDS[r.kind] ?? '')} · ${fmtMin(r.min)}${r.kcal ? ` · ca. ${r.kcal} kcal` : ''}${(r.tags ?? []).map(t => ' · ' + esc(TAGS[t] ?? t)).join('')}${r.last ? ` · zuletzt ${new Date(r.last + 'T12:00').toLocaleDateString('de-DE')}` : ''}</div></summary>
        ${r.method ? `<p class="tiny">🍳 ${esc(r.method)}${r.servings ? ` · ${esc(r.servings)}` : ''}</p>` : ''}
        ${(r.ingredients?.length ? r.ingredients : (r.need ?? []).map(n => n[1])).length ? `<p class="tiny"><b>Zutaten</b></p><ul class="tiny">${(r.ingredients?.length ? r.ingredients : (r.need ?? []).map(n => n[1])).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${r.steps?.length ? `<p class="tiny"><b>Zubereitung</b></p><ol class="tiny">${r.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
        ${r.url ? `<p class="tiny"><a href="${esc(r.url)}" target="_blank" rel="noopener">Originalrezept öffnen ↗</a></p>` : ''}
        <div class="tip-alts">
          <button class="chip" data-rec-edit="${r.id}">✎ Bearbeiten</button>
          ${today && today.status === 'geplant' ? `<button class="chip" data-rec-today="${r.id}">🍳 Heute kochen</button>` : ''}
          <button class="chip" data-rec-move="${r.id}">${r.store ? '🍽️ In den Plan aufnehmen' : '📚 In den Rezeptspeicher'}</button>
          <button class="chip" data-rec-fav="${r.id}">${r.fav ? '☆ Kein Liebling' : '★ Lieblingsgericht'}</button>
          ${r.store ? '' : `<button class="chip" data-rec-pause="${r.id}">${r.paused ? '▶️ Wieder einplanen' : '⏸️ Gerade nicht'}</button>`}
          <button class="chip" data-rec-del="${r.id}">🗑️ Löschen</button></div>
      </details></li>`).join('') || `<li class="muted">${recTab === 'store' ? 'Der Rezeptspeicher ist leer. Neue Rezepte oder importierte könnt ihr hier ablegen.' : 'Noch keine Gerichte.'}</li>`}</ul>
    <p class="muted tiny">★ = Lieblingsgericht (kommt öfter). Gilt für den ganzen Haushalt. Importierte Rezepte nur für den privaten Gebrauch; der Link zum Original bleibt gespeichert.</p>`;
}
let recQ = '';
// ---------- Vorschläge (Vorauswahl) ----------
const HIDE_KEY = 'speisekammer.recHidden'; // nur auf diesem Gerät
const hidden = () => { try { return JSON.parse(localStorage.getItem(HIDE_KEY)) ?? []; } catch { return []; } };
function ideas() {
  const own = loadRecipes(), hid = hidden();
  const pool = [...own.filter(r => r.store), ...GRUNDSTOCK.filter(g => !own.some(r => r.id === g.id))].filter(r => !hid.includes(r.id));
  return pool.map(r => ({ r, sc: score(r, 1, isoLocal(), [], 0) })).filter(x => x.sc).sort((a, b) => b.sc.p - a.sc.p).slice(0, 10);
}
function renderIdeas(body) {
  const list = ideas(), hid = hidden().length;
  const own = loadRecipes();
  body.innerHTML = `<div class="seg wrap rec-tabs">
      <button type="button" data-rectab="plan">🍽️ Im Plan</button><button type="button" data-rectab="store">📚 Rezeptspeicher</button><button type="button" data-rectab="ideas" class="active">💡 Vorschläge</button></div>
    <p class="tiny muted">Passend zu Vorrat, Ablaufdaten, euren Vorlieben und Ausschlüssen. Vorschläge kommen aus eurem Rezeptspeicher und einem Grundstock einfacher Gerichte. Nichts wird von selbst übernommen.</p>
    <div class="tip-alts"><button class="chip" data-rec="search">🔎 Rezept dazu suchen (Chefkoch)</button></div>
    <ul class="list rec-list">${list.map(({ r, sc }) => `<li data-idea="${esc(r.id)}"><details><summary><div class="name">${esc(r.title)}</div>
        <div class="meta">${esc(KINDS[r.kind] ?? '')} · ${fmtMin(r.min)}${r.kcal ? ` · ca. ${r.kcal} kcal` : ''}${r.store ? ' · aus dem Rezeptspeicher' : ' · Grundstock'}</div>
        ${sc.why.length ? `<div class="tiny plan-why">${sc.why.slice(0, 3).map(w => `<span>✓ ${esc(w)}</span>`).join('')}</div>` : ''}</summary>
        ${(r.ingredients?.length ? r.ingredients : r.need.map(n => n[1])).length ? `<p class="tiny"><b>Zutaten</b></p><ul class="tiny">${(r.ingredients?.length ? r.ingredients : r.need.map(n => n[1])).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${r.steps?.length ? `<p class="tiny"><b>Zubereitung</b></p><ol class="tiny">${r.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
        <div class="tip-alts"><button class="chip" data-idea-add="${esc(r.id)}">＋ In meine Gerichte</button><button class="chip" data-idea-store="${esc(r.id)}">📚 In den Rezeptspeicher</button><button class="chip" data-idea-hide="${esc(r.id)}">Nicht zeigen</button></div></details></li>`).join('') || '<li class="muted tiny">Keine Vorschläge mehr.</li>'}</ul>
    ${hid ? '<button class="chip" data-idea-reset>Ausgeblendete wieder zeigen</button>' : ''}
    <p class="muted tiny">Quelle Grundstock: ${esc(GRUNDSTOCK_SOURCE)} Eigene Rezepte im Speicher: ${own.filter(r => r.store).length}.</p>`;
}
function searchChefkoch() {
  const dlg = Object.assign(document.createElement('dialog'), { className: 'sheet' });
  const pantry = items.filter(i => i.qty > 0 && !['Reste', 'Getränke'].includes(i.category) && !i.frozenAt).sort((a, b) => (a.expiry || '9') .localeCompare(b.expiry || '9')).slice(0, 24);
  const pick = new Set(pantry.filter(i => i.expiry && daysTo(i.expiry) <= 3).slice(0, 3).map(i => i.id));
  const fill = () => {
    dlg.innerHTML = `<div class="sheet-head"><button type="button" class="link" data-x="close">Schließen</button><b>Rezept dazu suchen</b><span></span></div>
      <p class="tiny muted">Wähle bis zu 3 Zutaten. Chefkoch öffnet sich in einem neuen Tab. Gefällt dir ein Rezept, kopiere den Link und nimm ihn über „🔗 Per Link“ in den Rezeptspeicher auf.</p>
      <div class="tip-alts">${pantry.map(i => `<button type="button" class="chip ${pick.has(i.id) ? 'accepted' : ''}" data-x="${i.id}">${esc(i.name)}</button>`).join('') || '<span class="tiny muted">Der Vorrat ist leer.</span>'}</div>
      <button type="button" class="primary" data-x="go" ${pick.size ? '' : 'disabled'}>Auf Chefkoch suchen</button>`;
  };
  dlg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (e.target === dlg) return dlg.close(); if (!b) return;
    const x = b.dataset.x; if (x === 'close') return dlg.close();
    if (x === 'go') {
      const q = pantry.filter(i => pick.has(i.id)).map(i => encodeURIComponent(i.name.split(/[ ,(]/)[0].toLowerCase())).join('+');
      window.open(`https://www.chefkoch.de/rs/s0/${q}/Rezepte.html`, '_blank', 'noopener'); return;
    }
    if (pick.has(x)) pick.delete(x); else if (pick.size < 3) pick.add(x); else toast('Höchstens 3 Zutaten, sonst findet Chefkoch kaum etwas.');
    fill();
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.appendChild(dlg); fill(); dlg.showModal();
}
const recText = r => [r.title, ...(r.ingredients ?? []), ...(r.need ?? []).map(n => n[1]), ...(r.tags ?? []).map(t => TAGS[t] ?? t)].join(' ').toLowerCase();

// ---------- Kalender (Luca 23.11.: „wie die Kalender-App auf dem iPhone“) ----------
let calMonth = 0, calSel = isoLocal(), sheetPerson = '';
const MONTHS_BACK = -12, MONTHS_AHEAD = 24;
const persons = me => [me, ...Object.keys(JSON.parse(localStorage.getItem('speisekammer.shifts') ?? '{}')).filter(p => p && p !== me)];
const initial = p => esc((p || '?').trim().slice(0, 1).toUpperCase());
const longDate = d => new Date(d + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
function calendar(me, s) {
  const now = new Date(), first = new Date(now.getFullYear(), now.getMonth() + calMonth, 1);
  const lead = (first.getDay() + 6) % 7, n = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate(), today = isoLocal();
  const ps = persons(me), cells = Array.from({ length: lead }, () => '<span class="cal-d empty"></span>');
  for (let i = 1; i <= n; i++) {
    const d = isoLocal(new Date(first.getFullYear(), first.getMonth(), i)), wd = (lead + i - 1) % 7;
    const ev = ps.map(p => ({ p, code: shiftOf(p, d) })).filter(x => x.code);
    cells.push(`<button type="button" data-cal-day="${d}" class="cal-d${d === today ? ' today' : ''}${d === calSel ? ' sel' : ''}${wd >= 5 ? ' we' : ''}" aria-label="${esc(longDate(d))}">
      <span class="cal-n">${i}</span>
      ${ev.slice(0, 3).map(x => `<span class="cal-ev ev-${x.code}">${x.p === me ? SHIFTS[x.code].label : `${initial(x.p)} ${SHIFTS[x.code].label.slice(0, 1)}`}</span>`).join('')}
      ${ev.length > 3 ? `<span class="cal-more">+${ev.length - 3}</span>` : ''}</button>`);
  }
  while (cells.length % 7) cells.push('<span class="cal-d empty"></span>');
  return `<div class="ical">
    <div class="ical-top"><div><span class="ical-month">${first.toLocaleDateString('de-DE', { month: 'long' })}</span> <span class="ical-year">${first.getFullYear()}</span></div>
      <div class="ical-nav"><button type="button" data-cal-today ${calMonth === 0 && calSel === today ? 'disabled' : ''}>Heute</button>
        <button type="button" data-cal-move="-1" ${calMonth <= MONTHS_BACK ? 'disabled' : ''} aria-label="Voriger Monat">‹</button>
        <button type="button" data-cal-move="1" ${calMonth >= MONTHS_AHEAD ? 'disabled' : ''} aria-label="Nächster Monat">›</button></div></div>
    <div class="ical-wd">${['M', 'D', 'M', 'D', 'F', 'S', 'S'].map((w, i) => `<span class="${i >= 5 ? 'we' : ''}">${w}</span>`).join('')}</div>
    <div class="ical-grid" id="ical-grid">${cells.join('')}</div></div>`;
}
// Liste unter dem Monat wie in der iPhone-App: Einträge des gewählten Tages
function dayList(me, d, s) {
  const rows = persons(me).map(p => ({ p, code: shiftOf(p, d), sd: shiftDay(p, d) })).filter(x => x.code);
  const mine = shiftDay(me, d), adv = mine && s.shiftTips ? mealAdvice(mine, { noFridge: s.workNoFridge, noMicrowave: s.workNoMicrowave, dinnerAt: s.dinnerAt }) : null;
  return `<div class="ical-day"><div class="ical-day-head"><b>${esc(longDate(d))}</b><button type="button" class="ical-add" data-sheet="${d}" aria-label="Schicht eintragen">＋</button></div>
    ${rows.map(x => `<button type="button" class="ical-row" data-sheet="${d}" data-sheet-person="${esc(x.p)}"><span class="ical-bar ev-${x.code}"></span>
      <span class="ical-row-main"><b>${SHIFTS[x.code].icon} ${SHIFTS[x.code].label}${x.code === 'X' ? '' : 'schicht'}</b>${x.p !== me ? ` <span class="muted">· ${esc(x.p)}</span>` : ''}
      ${x.sd ? `<span class="tiny muted">Dienst ${x.sd.from}–${x.sd.to} · Essen ${x.sd.main || s.dinnerAt}${x.sd.snack ? ` · Pause ${x.sd.snack}` : ''}${x.sd.own ? ' · nur an diesem Tag geändert' : ''}</span>` : `<span class="tiny muted">Essen wie gewohnt um ${esc(s.dinnerAt)} Uhr</span>`}</span>
      <span class="ical-chev">›</span></button>`).join('') || '<p class="tiny muted ical-empty">Keine Schicht. Tag antippen oder ＋ zum Eintragen.</p>'}
    ${adv?.tips.length ? `<ul class="tiny shift-tips">${adv.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</div>`;
}
function renderShifts(body) {
  const s = getSettings(), me = s.myName;
  if (!s.shiftsOn) { body.innerHTML = `<div class="tip hint"><p>Im Kalender tragt ihr Früh-, Spät- und Nachtschichten ein. Der Essensplan richtet Gerichte und Essenszeiten danach.</p><button class="primary" data-shifts-on>Dienstplan einschalten</button></div>`; return; }
  if (!me) { body.innerHTML = `<div class="tip hint"><p>Damit der Plan weiß, wessen Schicht es ist, trag bitte deinen Namen ein.</p><button class="chip" data-shift-name>Namen eintragen</button></div>`; return; }
  const t = (code, f, v, allowEmpty) => `<label class="shift-t">${{ from: 'Beginn', to: 'Ende', main: 'Hauptmahlzeit', snack: 'Pause/Dose' }[f]}
    <input type="time" data-conf="${code}" data-f="${f}" value="${esc(v)}">${allowEmpty && v ? `<button type="button" class="ghost tiny" data-conf-clear="${code}" data-f="${f}" aria-label="Leeren">✕</button>` : ''}</label>`;
  body.innerHTML = `${calendar(me, s)}
    ${dayList(me, calSel, s)}
    <details class="shift-conf" ${localStorage.getItem('shiftConfOpen') ? 'open' : ''}><summary><b>⏰ Meine Standardzeiten</b> <span class="tiny muted">Dienst und Essen je Schicht</span></summary>
      ${['F', 'S', 'N'].map(code => { const c = shiftConf(me, code); return `<div class="shift-conf-row"><div class="shift-day">${SHIFTS[code].icon} ${SHIFTS[code].label}</div>
        <div class="shift-times">${t(code, 'from', c.from)}${t(code, 'to', c.to)}${t(code, 'main', c.main, true)}${t(code, 'snack', c.snack, true)}</div>
        ${!c.main ? `<div class="tiny muted">Hauptmahlzeit leer = gemeinsames Abendessen um ${esc(s.dinnerAt)} Uhr.</div>` : ''}</div>`; }).join('')}
      <p class="tiny muted">Gilt für dich und ist für den Haushalt sichtbar. Einzelne Tage änderst du im Kalender.</p></details>
    <p class="muted tiny">Wischen wechselt den Monat. Der Plan berücksichtigt die Schichten: vor der Nachtschicht leichte Gerichte, am Vortag einer Spät- oder Nachtschicht eine Portion mehr für die Dose, die Erinnerung richtet sich nach deiner Essenszeit. ${s.shiftTips ? `Tipps nach ${SHIFT_SOURCES}; abschaltbar unter Einstellungen → Persönlich.` : 'Tipps sind ausgeschaltet (Einstellungen → Persönlich).'} Die vorgegebenen Zeiten sind übliche Pflegezeiten (Annahme). Keine medizinische Beratung.</p>`;
  const g = $('#ical-grid'); let x0 = null, y0 = 0;
  g.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  g.addEventListener('touchend', e => {
    if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { calMonth = Math.max(MONTHS_BACK, Math.min(MONTHS_AHEAD, calMonth + (dx < 0 ? 1 : -1))); render(); }
  });
}

// Eintragen-Fenster (Blatt von unten, wie „Neues Ereignis“)
function sheetEl() {
  let d = document.getElementById('shift-sheet'); if (d) return d;
  d = Object.assign(document.createElement('dialog'), { id: 'shift-sheet', className: 'sheet' });
  document.body.appendChild(d);
  d.addEventListener('click', async e => {
    if (e.target === d) return d.close();
    const b = e.target.closest('button'); if (!b) return;
    const date = d.dataset.date;
    if (b.dataset.close != null) return d.close();
    if (b.dataset.shPerson != null) { sheetPerson = b.dataset.shPerson; return fillSheet(); }
    if (b.dataset.shAdd != null) { const n = (await ctx.askInput('Person hinzufügen', 'Name, z. B. Mama', ''))?.trim(); if (n) { sheetPerson = n; fillSheet(); } return; }
    if (b.dataset.shCode) { const cur = shiftOf(sheetPerson, date); setShift(sheetPerson, date, cur === b.dataset.shCode ? '' : b.dataset.shCode); rebuildOpen(); fillSheet(); return render(); }
    if (b.dataset.shReset != null) { setShiftDay(sheetPerson, date, { from: null, to: null, main: null, snack: null }); rebuildOpen(); fillSheet(); return render(); }
    if (b.dataset.shDel != null) { setShift(sheetPerson, date, ''); rebuildOpen(); render(); return d.close(); }
    if (b.dataset.shNext) { d.dataset.date = addDays(date, +b.dataset.shNext); calSel = d.dataset.date; fillSheet(); return render(); }
  });
  d.addEventListener('change', e => {
    const i = e.target.closest('[data-sh-f]'); if (!i) return;
    setShiftDay(sheetPerson, d.dataset.date, { [i.dataset.shF]: i.value }); rebuildOpen(); fillSheet(); render();
  });
  return d;
}
function fillSheet() {
  const d = sheetEl(), date = d.dataset.date, s = getSettings(), me = s.myName, ps = persons(me);
  if (!ps.includes(sheetPerson)) ps.push(sheetPerson);
  const code = shiftOf(sheetPerson, date), sd = shiftDay(sheetPerson, date);
  const f = (k, l, hint) => `<label class="sheet-f"><span>${l}</span><input type="time" data-sh-f="${k}" value="${esc(sd?.[k] ?? '')}">${hint ? `<small class="muted">${hint}</small>` : ''}</label>`;
  d.innerHTML = `<div class="sheet-head"><button type="button" class="link" data-close>Fertig</button><b>${esc(new Date(date + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' }))}</b>
      <span><button type="button" class="link" data-sh-next="-1" aria-label="Vortag">‹</button><button type="button" class="link" data-sh-next="1" aria-label="Nächster Tag">›</button></span></div>
    <p class="sheet-label">Wer?</p>
    <div class="tip-alts">${ps.map(p => `<button type="button" class="chip ${p === sheetPerson ? 'accepted' : ''}" data-sh-person="${esc(p)}">${p === me ? 'Ich' : esc(p)}</button>`).join('')}<button type="button" class="chip" data-sh-add>＋ Person</button></div>
    <p class="sheet-label">Schicht</p>
    <div class="sheet-codes">${SHIFT_ORDER.filter(Boolean).map(c => `<button type="button" class="ev-${c} ${code === c ? 'on' : ''}" data-sh-code="${c}"><span>${SHIFTS[c].icon}</span>${SHIFTS[c].label}</button>`).join('')}</div>
    ${sd ? `<p class="sheet-label">Zeiten an diesem Tag</p><div class="sheet-group">
        ${f('from', 'Dienstbeginn')}${f('to', 'Dienstende')}${f('main', 'Hauptmahlzeit', sd.main ? '' : `leer = Abendessen ${esc(s.dinnerAt)}`)}${f('snack', 'Pause / Dose', sd.snack ? '' : 'leer = keine')}</div>
      ${sd.own ? '<button type="button" class="link" data-sh-reset>Zeiten auf Standard zurücksetzen</button>' : '<p class="tiny muted">Standardzeiten der Schicht. Änderungen gelten nur für diesen Tag.</p>'}` : ''}
    ${code ? '<button type="button" class="link danger" data-sh-del>Eintrag löschen</button>' : ''}`;
}
function openSheet(date, person) {
  const d = sheetEl(); d.dataset.date = date; sheetPerson = person || getSettings().myName; fillSheet();
  if (!d.open) d.showModal();
}

// Plan neu prüfen: Vorschau, dann übernehmen (nichts wird ohne Bestätigung geändert)
async function recheckPlan() {
  const old = loadPlan(); if (!old?.days?.length) { build(); return render(); }
  [items, offers] = await Promise.all([ctx.store.listItems(), ctx.allOffers().catch(() => offers)]);
  const keep = old.days.filter(d => daysTo(d.date) >= 0), fresh = build(isoLocal(), keep, true);
  const title = d => d.leftover ? `Reste: ${d.leftover.name}` : (d.dinner ? (recipe(d.dinner)?.title ?? d.title) : 'kein Gericht');
  const rows = fresh.days.map(d => { const o = keep.find(x => x.date === d.date); const kept = o && (o.status !== 'geplant' || o.leftover || o.need);
    if (kept) return { d, kind: 'kept', old: o }; return { d, kind: !o || o.dinner === d.dinner ? 'same' : 'changed', old: o }; });
  const changed = rows.filter(r => r.kind === 'changed');
  const line = r => `<li><b>${esc(dayLabel(r.d.date))}</b> ${r.kind === 'changed' ? `${esc(title(r.old))} → <b>${esc(title(r.d))}</b>${r.d.why?.[0] ? `<br><small class="muted">${esc(r.d.why[0])}</small>` : ''}` : `${esc(title(r.d))} <small class="muted">${r.kind === 'kept' ? (r.old.status === 'gekocht' ? '(gekocht, bleibt)' : r.old.status === 'uebersprungen' ? '(übersprungen, bleibt)' : r.old.leftover ? '(Rest, bleibt)' : '(angepasst, bleibt)') : '(bleibt)'}</small>`}</li>`;
  const v = await ctx.ask(changed.length ? `${changed.length} ${changed.length === 1 ? 'Tag ändert' : 'Tage ändern'} sich` : 'Der Plan passt schon', `<ul class="plan-diff">${rows.map(line).join('')}</ul><p class="tiny muted">Berücksichtigt Vorrat, Ablaufdaten, Angebote und eure Wochenziele.</p>`,
    changed.length ? [{ value: 'yes', label: 'Neuen Plan übernehmen', cls: 'primary' }, { value: '', label: 'Abbrechen' }] : [{ value: '', label: 'OK', cls: 'primary' }]);
  if (v === 'yes') { savePlan(fresh); toast('Plan erneuert'); }
  render();
}

// Zutaten eines Tages anpassen (ersetzen, weglassen, ergänzen). Gilt nur für diesen Tag; „Im Rezept übernehmen“ ändert das Gerichte-Rezept.
function needsEl() {
  let d = document.getElementById('need-sheet'); if (d) return d;
  d = Object.assign(document.createElement('dialog'), { id: 'need-sheet', className: 'sheet' });
  document.body.appendChild(d);
  d.addEventListener('click', async e => {
    if (e.target === d) return d.close();
    const b = e.target.closest('button'); if (!b) return;
    const p = loadPlan(), day = p?.days?.find(x => x.date === d.dataset.date), r = day && recipe(day.dinner); if (!r) return d.close();
    const cur = () => (day.need ?? r.need ?? []).map(n => [...n]);
    const save = need => { day.need = need; savePlan(p); fillNeeds(); render(); };
    if (b.dataset.close != null) return d.close();
    if (b.dataset.nDel != null) { const n = cur(); n.splice(+b.dataset.nDel, 1); return save(n); }
    if (b.dataset.nEdit != null) {
      const n = cur(), o = n[+b.dataset.nEdit];
      const v = (await ctx.askInput('Zutat ändern', 'Neue Zutat oder Menge, z. B. „Hähnchen“ oder „400 g Pute“', o[2] ?? o[1]))?.trim(); if (!v) return;
      const nn = needFromLine(v); if (!nn) return toast('Das habe ich nicht verstanden.');
      n[+b.dataset.nEdit] = /\d/.test(v) ? [nn[0], nn[1], v] : nn; return save(n);
    }
    if (b.dataset.nAdd != null) {
      const v = (await ctx.askInput('Zutat ergänzen', 'Zutat, z. B. „Zucchini“ oder „200 g Feta“', ''))?.trim(); if (!v) return;
      const nn = needFromLine(v); if (!nn) return toast('Das habe ich nicht verstanden.');
      return save([...cur(), /\d/.test(v) ? [nn[0], nn[1], v] : nn]);
    }
    if (b.dataset.nReset != null) { delete day.need; savePlan(p); fillNeeds(); return render(); }
    if (b.dataset.nKeep != null) {
      const need = cur();
      updateRecipe(r.id, x => { x.need = need.map(n => [n[0], n[1]]); if (x.ingredients?.length) x.ingredients = need.map(n => n[2] ?? n[1]); });
      delete day.need; savePlan(p); d.close(); toast('Im Rezept übernommen'); return render();
    }
  });
  return d;
}
function fillNeeds() {
  const d = needsEl(), day = loadPlan()?.days?.find(x => x.date === d.dataset.date), r = day && recipe(day.dinner); if (!r) return;
  const need = needOf(day, r);
  d.innerHTML = `<div class="sheet-head"><button type="button" class="link" data-close>Fertig</button><b>Zutaten anpassen</b><span></span></div>
    <p class="tiny muted">${esc(r.title)} · ${esc(dayLabel(day.date))} – gilt nur für diesen Tag; das gespeicherte Rezept bleibt unverändert. Vorrat-Abgleich und Einkaufsliste folgen deiner Änderung.</p>
    <ul class="need-list">${need.map((n, i) => `<li><span>${esc(needLabel(n))}${has(items, n[0]) ? ' <small class="good-tag">im Vorrat</small>' : ''}</span><button type="button" class="chip" data-n-edit="${i}">Ändern</button><button type="button" class="chip" data-n-del="${i}" aria-label="Weglassen">✕</button></li>`).join('') || '<li class="muted tiny">Keine Zutaten erfasst.</li>'}</ul>
    <div class="tip-alts"><button type="button" class="chip" data-n-add>＋ Zutat ergänzen</button>
      ${day.need ? '<button type="button" class="chip" data-n-keep>💾 Im Rezept übernehmen</button><button type="button" class="chip" data-n-reset>Zurücksetzen</button>' : ''}</div>`;
}
function openNeeds(date) { const d = needsEl(); d.dataset.date = date; fillNeeds(); if (!d.open) d.showModal(); }

// ---------- Aktionen ----------
async function onClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.view) { view = b.dataset.view; goalsOpen = false; return render(); }
  if (b.id === 'plan-new') return recheckPlan();
  if (b.dataset.goal) {
    const k = b.dataset.goal, def = { weekFish: 2, weekBeef: 1, weekVeg: 0, weekVegG: 0 }[k], cur = getSettings()[k] ?? def;
    ctx.setSetting(k, Math.max(0, Math.min(+b.dataset.max, cur + +b.dataset.d)));
    rebuildOpen(); goalsOpen = true; return render();
  }
  if (b.dataset.rec) return recipeAction(b.dataset.rec);
  if (b.dataset.ideaAdd || b.dataset.ideaStore) {
    const id = b.dataset.ideaAdd || b.dataset.ideaStore, g = GRUNDSTOCK.find(x => x.id === id), ex = loadRecipes().find(x => x.id === id);
    if (g) upsertRecipe({ ...g, src: 'grundstock', store: !!b.dataset.ideaStore }); else if (ex) updateRecipe(id, x => { x.store = !!b.dataset.ideaStore; });
    rebuildOpen(); toast(b.dataset.ideaAdd ? 'In deinen Gerichten, der Plan kann es nutzen' : 'Im Rezeptspeicher'); return render();
  }
  if (b.dataset.ideaHide) { localStorage.setItem(HIDE_KEY, JSON.stringify([...hidden(), b.dataset.ideaHide])); return render(); }
  if (b.dataset.ideaReset != null) { localStorage.removeItem(HIDE_KEY); return render(); }
  if (b.dataset.recEdit) return editRecipe(b.dataset.recEdit);
  if (b.dataset.rectab) { recTab = b.dataset.rectab; return render(); }
  if (b.dataset.recFav) { updateRecipe(b.dataset.recFav, x => x.fav = !x.fav); return render(); }
  if (b.dataset.recPause) { updateRecipe(b.dataset.recPause, x => x.paused = !x.paused); rebuildOpen(); return render(); }
  if (b.dataset.recMove) { updateRecipe(b.dataset.recMove, x => x.store = !x.store); rebuildOpen(); toast('Verschoben'); return render(); }
  if (b.dataset.recDel) {
    const r = loadRecipes().find(x => x.id === b.dataset.recDel);
    if (await ctx.ask(`„${r?.title}“ löschen?`, 'Für alle im Haushalt.', [{ value: 'yes', label: 'Löschen', cls: 'danger' }, { value: '', label: 'Abbrechen' }])) { deleteRecipe(b.dataset.recDel); rebuildOpen(); }
    return render();
  }
  if (b.dataset.recToday) {
    const p = getPlan(), d = p.days.find(x => daysTo(x.date) === 0), r = recipe(b.dataset.recToday); if (!d || !r) return;
    Object.assign(d, { dinner: r.id, title: r.title, why: ['selbst ausgewählt'] }); savePlan(p); view = 'week'; toast(`🍳 Heute: ${r.title}`); return render();
  }
  if (b.dataset.calDay) { calSel = b.dataset.calDay; await render(); return openSheet(calSel); }
  if (b.dataset.sheet) { return openSheet(b.dataset.sheet, b.dataset.sheetPerson); }
  if (b.dataset.calMove) { calMonth = Math.max(MONTHS_BACK, Math.min(MONTHS_AHEAD, calMonth + +b.dataset.calMove)); return render(); }
  if ('calToday' in b.dataset) { calMonth = 0; calSel = isoLocal(); return render(); }
  if ('shiftsOn' in b.dataset) { ctx.setSetting('shiftsOn', true); return render(); }
  if ('shiftName' in b.dataset) { const n = await ctx.askInput('Dein Name', 'Name', ''); if (n) { ctx.setSetting('myName', n); } return render(); }
  if (b.dataset.confClear) { setShiftConf(getSettings().myName, b.dataset.confClear, b.dataset.f, ''); localStorage.setItem('shiftConfOpen', '1'); rebuildOpen(); return render(); }
  if (b.dataset.shiftDay) {
    const me = getSettings().myName, d = b.dataset.shiftDay, sd = shiftDay(me, d); if (!sd) return;
    const patch = {};
    for (const [f, l] of [['from', 'Dienstbeginn'], ['to', 'Dienstende'], ['main', 'Hauptmahlzeit (leer = gemeinsames Abendessen)'], ['snack', 'Pause/Dose (leer = keine)']]) {
      const v = await ctx.askInput(`${dayLabel(d)}: ${SHIFTS[sd.code].label}`, l, sd[f] ?? '', 'time'); if (v == null) return;
      patch[f] = v;
    }
    setShiftDay(me, d, patch); rebuildOpen(); return render();
  }
  if (b.dataset.shiftDayReset) { setShiftDay(getSettings().myName, b.dataset.shiftDayReset, { from: null, to: null, main: null, snack: null }); rebuildOpen(); return render(); }
  if (b.dataset.shift) {
    const me = getSettings().myName, cur = shiftOf(me, b.dataset.shift);
    setShift(me, b.dataset.shift, cur === b.dataset.code ? '' : b.dataset.code);
    rebuildOpen(); return render();
  }
  const li = b.closest('li[data-i]'); if (!li) return;
  const p = getPlan(), i = +li.dataset.i, d = p.days[i], r = recipe(d.dinner), act = b.dataset.act;
  if (act === 'swap') {
    const chosen = p.days.filter(x => x !== d).map(x => recipe(x.dinner)).filter(Boolean);
    const seen = d.swapped ?? []; if (d.dinner) seen.push(d.dinner);
    const ranked = rank(i, d.date, chosen, 0);
    const next = ranked.find(c => !seen.includes(c.r.id)) ?? ranked[0];
    if (!next) return toast('Keine weiteren Gerichte.');
    delete d.need;
    Object.assign(d, { dinner: next.r.id, title: next.r.title, why: next.sc.why.slice(0, 3), swapped: seen.length >= activeRecipes().length - 1 ? [] : seen });
  } else if (act === 'needs') {
    return openNeeds(d.date);
  } else if (act === 'useleft') {
    const it = items.find(x => x.id === b.dataset.rest); if (!it) return;
    const last = p.days.at(-1), dropped = { dinner: last.dinner, title: last.title, why: last.why, need: last.need };
    for (let j = p.days.length - 1; j > i; j--) Object.assign(p.days[j], { dinner: p.days[j - 1].dinner, title: p.days[j - 1].title, why: p.days[j - 1].why, need: p.days[j - 1].need });
    d.leftover = { id: it.id, name: it.name, dropped };
    savePlan(p); render(); toast(`🍲 ${it.name} eingeplant`); return;
  } else if (act === 'unleft') {
    const dropped = d.leftover.dropped; delete d.leftover;
    for (let j = i; j < p.days.length - 1; j++) Object.assign(p.days[j], { dinner: p.days[j + 1].dinner, title: p.days[j + 1].title, why: p.days[j + 1].why, need: p.days[j + 1].need });
    Object.assign(p.days.at(-1), dropped);
  } else if (act === 'done' && d.leftover) {
    d.status = 'gekocht'; savePlan(p); render();
    document.dispatchEvent(new CustomEvent('plan:leftoverEaten', { detail: { id: d.leftover.id } }));
    return;
  } else if (act === 'done') {
    d.status = 'gekocht'; savePlan(p); markCooked(r.id, d.date); render();
    await askUsed(needOf(d, r));
    document.dispatchEvent(new CustomEvent('plan:cooked', { detail: { title: r.title, date: d.date } }));
    return;
  } else if (act === 'skip') {
    d.status = 'uebersprungen';
  } else if (act === 'undo') d.status = 'geplant';
  else if (act === 'shop') {
    const add = needOf(d, r).filter(([w]) => !has(items, w)).map(([, n]) => n);
    const added = add.filter(n => ctx.addShop(n));
    savePlan(p); render();
    toast(added.length ? `🛒 Auf die Einkaufsliste: ${added.join(', ')}` : 'Steht schon alles auf der Liste.');
    return;
  }
  savePlan(p); render();
}
// Nach einer Schicht-Änderung: offene Tage neu bewerten, Gekochtes bleibt
function rebuildOpen() { const p = loadPlan(); if (p?.days?.length) build(isoLocal(), p.days.filter(d => daysTo(d.date) >= 0)); }

// „Gekocht“: verbrauchte Zutaten antippen (bucht sie im Vorrat ab)
async function askUsed(need) {
  let left = need.map(([w]) => has(items, w)).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
  while (left.length) {
    const v = await ctx.ask('Was wurde verbraucht?', 'Antippen, was aufgebraucht ist. Der Rest bleibt im Vorrat.',
      [...left.map(x => ({ value: x.id, label: `${x.name} (${x.qty} ${x.unit})` })), { value: '', label: 'Fertig', cls: 'primary' }]);
    if (!v) break;
    const it = left.find(x => x.id === v);
    if (ctx.partsOf?.(it)) { await ctx.openEaten('cook', [it], `${it.name}: wie viel verbraucht?`); left = left.filter(x => x.id !== v); continue; }
    await ctx.store.consume(it.id, it.qty, 'eaten');
    left = left.filter(x => x.id !== v);
  }
  await ctx.renderPantry();
}

// ---------- Gerichte bearbeiten ----------
async function recipeAction(kind) {
  if (kind === 'starters') { addStarters(); build(); toast('Beispielgerichte übernommen'); return render(); }
  if (kind === 'new') return openEditor(null);
  if (kind === 'search') return searchChefkoch();
  if (kind === 'link') {
    if (!ctx.store.importRecipe) {
      await ctx.ask('Import per Link', 'Der Import per Link braucht die gemeinsame Datenbank (Supabase), weil das Handy fremde Webseiten nicht direkt lesen darf. Bis dahin: auf der Rezeptseite Titel, Zutaten und Zubereitung markieren, kopieren und unter „Rezepttext einfügen“ einfügen.', [{ value: 'ok', label: 'OK', cls: 'primary' }]);
      return;
    }
    const url = await ctx.askInput('Rezept per Link', 'Link zur Rezeptseite', '', 'url'); if (!url) return;
    try { toast('Rezept wird geladen …'); const data = await ctx.store.importRecipe(url); return confirmImport(recipeFromParts({ ...data, url })); }
    catch (e) { await ctx.ask('Import hat nicht geklappt', esc(e.message) + '<br>Tipp: Rezepttext kopieren und unter „Rezepttext einfügen“ einfügen.', [{ value: 'ok', label: 'OK' }]); return; }
  }
  if (kind === 'photo') {
    const parts = await ctx.aiRecipePhoto?.(); if (!parts) return;
    return confirmImport(recipeFromParts(parts));
  }
  if (kind === 'paste') {
    const t = await ctx.askInput('Rezepttext einfügen', 'Titel, Zutaten und Zubereitung (von der Webseite kopiert)', '', 'textarea'); if (!t) return;
    const parsed = parseRecipeText(t); if (!parsed) return;
    return confirmImport(recipeFromParts(parsed));
  }
}
async function confirmImport(r) {
  const v = await ctx.ask(`„${r.title}“ übernehmen?`, `${esc(KINDS[r.kind])} · ${fmtMin(r.min)} · ${r.need.length} Zutaten erkannt: ${r.need.map(n => esc(n[1])).join(', ') || 'keine'}${r.steps?.length ? ` · ${r.steps.length} Schritte` : ''}`,
    [{ value: 'plan', label: '🍽️ In den Plan', cls: 'primary' }, { value: 'store', label: '📚 In den Rezeptspeicher' }, { value: 'edit', label: '✎ Vorher bearbeiten' }, { value: '', label: 'Abbrechen' }]);
  if (v === 'edit') return openEditor({ ...r, store: recTab === 'store' });
  if (!v) return;
  upsertRecipe({ ...r, store: v === 'store', src: r.url ? 'link' : 'own' }); toast(v === 'store' ? 'Im Rezeptspeicher abgelegt' : 'Gericht gespeichert');
  view = 'recipes'; recTab = v; render();
}

// Rezept-Editor (alle Felder). r = null → neues Rezept
let editing = null;
function openEditor(r) {
  editing = r?.id ? loadRecipes().find(x => x.id === r.id) ?? r : (r ?? { title: '', kind: 'veggie', min: 30, tags: [], store: recTab === 'store' });
  const f = $('#rec-form'), e = editing;
  f.reset();
  $('#rec-head').textContent = e.id ? 'Rezept bearbeiten' : 'Neues Rezept';
  f.title.value = e.title ?? ''; f.min.value = e.min ?? ''; f.kcal.value = e.kcal ?? ''; f.method.value = e.method ?? ''; f.servings.value = e.servings ?? '';
  f.ingredients.value = (e.ingredients?.length ? e.ingredients : (e.need ?? []).map(n => n[1])).join('\n');
  f.steps.value = (e.steps ?? []).join('\n'); f.url.value = e.url ?? '';
  const st = { kind: e.kind ?? 'veggie', tags: [...(e.tags ?? [])], fav: !!e.fav, store: !!e.store };
  const draw = () => {
    $('#rec-kind').innerHTML = Object.entries(KINDS).map(([k, l]) => `<button type="button" data-k="${k}" class="${st.kind === k ? 'active' : ''}">${esc(l)}</button>`).join('');
    $('#rec-min').innerHTML = [15, 20, 30, 45, 60, 90].map(m => `<button type="button" data-m="${m}" class="${+f.min.value === m ? 'active' : ''}">${fmtMin(m)}</button>`).join('');
    $('#rec-tags').innerHTML = [...Object.entries(TAGS), ['fav', '★ Lieblingsgericht']].map(([k, l]) => { const on = k === 'fav' ? st.fav : st.tags.includes(k); return `<button type="button" class="chip ${on ? 'accepted' : ''}" data-t="${k}">${on ? '✓ ' : ''}${esc(l)}</button>`; }).join('');
    $('#rec-place').innerHTML = `<button type="button" data-p="plan" class="${!st.store ? 'active' : ''}">🍽️ Im Plan</button><button type="button" data-p="store" class="${st.store ? 'active' : ''}">📚 Rezeptspeicher</button>`;
  };
  draw();
  f.onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.k) st.kind = b.dataset.k;
    else if (b.dataset.m) f.min.value = b.dataset.m;
    else if (b.dataset.t === 'fav') st.fav = !st.fav;
    else if (b.dataset.t) st.tags = st.tags.includes(b.dataset.t) ? st.tags.filter(x => x !== b.dataset.t) : [...st.tags, b.dataset.t];
    else if (b.dataset.p) st.store = b.dataset.p === 'store';
    else return;
    draw();
  };
  f.min.oninput = draw;
  // KI: Gericht anpassen (Vorschlag füllt das Formular, gespeichert wird erst nach deiner Prüfung)
  $('#rec-ai').onclick = async () => {
    const ls = t => t.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const r = await ctx.aiAdapt?.({ title: f.title.value.trim(), ingredients: ls(f.ingredients.value), steps: ls(f.steps.value), min: parseInt(f.min.value) || null, servings: f.servings.value.trim() || null });
    if (!r) return;
    if (r.title) f.title.value = r.title;
    if (r.ingredients?.length) f.ingredients.value = r.ingredients.join('\n');
    if (r.steps?.length) f.steps.value = r.steps.join('\n');
    if (r.min) f.min.value = r.min;
    if (r.servings) f.servings.value = r.servings;
    draw();
    await ctx.ask('Vorschlag der KI übernommen', `${esc(r.note || 'Das Gericht wurde angepasst.')}<br><span class="muted tiny">Bitte prüfen (Mengen, Zeiten) und dann speichern. Kalorien sind nicht neu berechnet.</span>`, [{ value: 'ok', label: 'OK', cls: 'primary' }]);
  };
  const d = $('#rec-dialog');
  d.onclose = () => {
    if (d.returnValue !== 'save' || !f.title.value.trim()) return;
    const lines = t => t.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const ingredients = lines(f.ingredients.value);
    const oldNames = (e.need ?? []).map(n => n[1]).join('\n');
    const need = ingredients.join('\n') === oldNames && e.need?.length ? e.need : ingredients.map(needFromLine).filter(Boolean).filter(([w]) => !/^(salz|pfeffer|wasser|öl|zucker)$/.test(w));
    upsertRecipe({ ...(e.id ? { id: e.id } : {}), title: f.title.value.trim(), kind: st.kind, min: parseInt(f.min.value) || 30, kcal: parseInt(f.kcal.value) || null,
      method: f.method.value.trim(), servings: f.servings.value.trim() || null, ingredients, steps: lines(f.steps.value), url: f.url.value.trim() || null,
      need, tags: st.tags, fav: st.fav, store: st.store, src: e.src ?? (e.url ? 'link' : 'own') });
    toast('Rezept gespeichert'); view = 'recipes'; recTab = st.store ? 'store' : 'plan'; rebuildOpen(); render();
  };
  d.returnValue = ''; d.showModal();
}
async function editRecipe(id) { openEditor({ id }); }

export function initPlan(c) {
  ctx = c;
  document.addEventListener('change', e => {
    const i = e.target.closest?.('[data-conf]'); if (!i) return;
    setShiftConf(getSettings().myName, i.dataset.conf, i.dataset.f, i.value); localStorage.setItem('shiftConfOpen', '1'); rebuildOpen(); render();
  });
  document.addEventListener('input', e => {
    if (e.target.id !== 'rec-q') return;
    recQ = e.target.value; const q = recQ.trim().toLowerCase();
    document.querySelectorAll('.rec-list li[data-q]').forEach(li => li.hidden = !!q && !li.dataset.q.includes(q));
  });
  document.addEventListener('toggle', e => { if (e.target.classList?.contains('shift-cal')) e.target.open ? localStorage.removeItem('shiftCalClosed') : localStorage.setItem('shiftCalClosed', '1'); }, true);
  document.addEventListener('toggle', e => { if (e.target.classList?.contains('shift-conf')) e.target.open ? localStorage.setItem('shiftConfOpen', '1') : localStorage.removeItem('shiftConfOpen'); }, true);
  // Demo: Beispielgerichte einmal übernehmen, mit Beispiel-Lieblingsgericht und lange nicht Gegessenem
  if (localStorage.getItem('speisekammer.seedStarters')) {
    addStarters(); localStorage.removeItem('speisekammer.seedStarters');
    updateRecipe('chili', r => r.fav = true);
    updateRecipe('pfannkuchen', r => { r.last = addDays(isoLocal(), -60); r.count = 4; });
  }
  const tab = $('#tab-plan'); if (!tab) return;
  tab.addEventListener('click', onClick);
  document.querySelector('nav button[data-tab=plan]')?.addEventListener('click', render);
  document.addEventListener('pantry:changed', render);
  document.addEventListener('shared:changed', e => { if (['speisekammer.plan', 'speisekammer.recipes', 'speisekammer.shifts'].includes(e.detail?.key) && tab.classList.contains('active')) render(); });
  render();
}
