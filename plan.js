// Essensplan (Wochenplan) mit Gerichten und Dienstplan.
// Regeln aus „Essensplan-Logik v1“ (Doc vom 21./22.11.2026), vereinfacht für v1:
// bald Ablaufendes zuerst, Vorrat nutzen, aktuelle Angebote, Lieblingsgerichte, lange nicht Gegessenes, 2× Fisch, höchstens 2× Rind,
// keine Wiederholung, lange Gerichte eher am Wochenende, Schichten (Nacht: leicht; Spät: Dose; Vortag: vorkochen).
// Noch nicht drin: Nährstoffkonto (BLS-Daten), Kalorien je Zubereitungsart. Der Plan liegt unter 'speisekammer.plan' (Haushalt).
import { isoLocal } from './categories.js';
import { activeRecipes, loadRecipes, STARTERS, KINDS, TAGS, addStarters, upsertRecipe, updateRecipe, deleteRecipe, markCooked, recipeFromParts, parseRecipeText, needFromLine } from './recipes.js';
import { SHIFTS, SHIFT_ORDER, SOURCES as SHIFT_SOURCES, shiftsOn, shiftOf, setShift, mealAdvice } from './shifts.js';
import { getSettings } from './settings.js';
import { offersFor, chainName } from './offers.js';
import { loadMeds } from './meds.js';

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
    const fish = chosen.filter(c => c.kind === 'fisch').length, beef = chosen.filter(c => c.kind === 'rind').length;
    if (r.kind === 'fisch' && fish < 2) { p += 2; if (i >= 3) why.push('Fischabend (Ziel 2× pro Woche)'); }
    if (r.kind === 'fisch' && fish >= 2) p -= 3;
    if (r.kind === 'rind' && beef >= 2) p -= 4;
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
  if (tomorrow.some(x => x.code === 'S' || x.code === 'N') && r.tags?.includes('mitnehmen')) { p += 1; why.push('1 Portion mehr für die Dose morgen'); }
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

function build(start = isoLocal(), keep = []) {
  const chosen = [], days = [], usedBf = new Set();
  let forgotten = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i), kept = keep.find(d => d.date === date && d.status !== 'geplant');
    if (kept) { days.push(kept); const r = recipe(kept.dinner); if (r) chosen.push(r); continue; }
    const best = rank(i, date, chosen, forgotten)[0];
    if (!best) { days.push({ date, dinner: null, why: [], breakfast: breakfastFor(i, date, usedBf), status: 'geplant' }); continue; }
    if (best.sc.why.some(w => w.startsWith('Lange nicht'))) forgotten++;
    chosen.push(best.r);
    days.push({ date, dinner: best.r.id, title: best.r.title, why: best.sc.why.slice(0, 3), breakfast: breakfastFor(i, date, usedBf), status: 'geplant' });
  }
  const p = { start, days, made: new Date().toISOString() }; savePlan(p); return p;
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
  const thaw = r && !d.leftover ? (r.need ?? []).map(([w]) => has(items, w)).find(i => i?.frozenAt) : null;
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
  ${s.shiftsOn ? `<button type="button" data-view="shifts" class="${view === 'shifts' ? 'active' : ''}">🕐 Dienstplan</button>` : ''}</div>`;

export async function render() {
  const el = $('#tab-plan'); if (!el || !ctx) return;
  [items, offers] = await Promise.all([ctx.store.listItems(), ctx.allOffers().catch(() => [])]);
  const s = getSettings();
  if (view === 'shifts' && !s.shiftsOn) view = 'week';
  el.innerHTML = `<h2>Essensplan</h2>${tabsHtml(s)}<div id="plan-body"></div>`;
  const body = $('#plan-body');
  if (view === 'recipes') return renderRecipes(body);
  if (view === 'shifts') return renderShifts(body);
  renderWeek(body, s);
}

function shiftLine(date, s) {
  return shiftsOn(date).map(({ person, code }) => {
    const a = mealAdvice(code, person === s.myName ? { noFridge: s.workNoFridge, noMicrowave: s.workNoMicrowave, dinnerAt: s.dinnerAt } : { dinnerAt: s.dinnerAt });
    return `<details class="plan-shift"><summary>${SHIFTS[code].icon} <b>${esc(person)}</b>: ${esc(a.short)} ${SHIFTS[code].from}–${SHIFTS[code].to}</summary>
      <ul class="tiny">${[...a.tips, ...a.box.map(b => 'Dose ' + b)].map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>`;
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
  body.innerHTML = `${info}<div class="plan-sum"><span>🐟 Fisch ${fish}×</span><span>🥩 Rind/Schwein ${meat}×</span>${veg ? `<span>🥦 ca. ${veg} g Gemüse/Abend</span>` : ''}</div>
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
      const missing = (r.need ?? []).filter(([w]) => !has(items, w)).map(([, n]) => n);
      const toBuy = missing.filter(n => !listed.has(n.toLowerCase()));
      const thaw = (r.need ?? []).map(([w]) => has(items, w)).find(x => x?.frozenAt);
      const tomorrowAway = shiftsOn(addDays(d.date, 1)).filter(x => x.code === 'S' || x.code === 'N');
      return `<li class="plan-day ${d.status}" data-i="${i}">${restBox}${head}
        <div class="plan-dinner"><b>🍽️ ${esc(m.title)}</b>${r.fav ? ' <span title="Lieblingsgericht">★</span>' : ''}
          <div class="tiny">${esc(KINDS[r.kind] ?? '')}${r.method ? ' · ' + esc(r.method) : ''} · ${fmtMin(r.min)}${r.kcal ? ` · ca. ${r.kcal} kcal` : ''}</div>
          ${d.why?.length ? `<div class="tiny plan-why">${d.why.map(w => `<span>✓ ${esc(w)}</span>`).join('')}</div>` : ''}
          ${thaw ? `<div class="tiny plan-thaw">❄️ ${esc(thaw.name)} am Vorabend in den Kühlschrank legen</div>` : ''}
          ${tomorrowAway.length ? `<div class="tiny plan-thaw">🍱 Vorkochen: ${tomorrowAway.map(x => `${esc(x.person)} hat morgen ${SHIFTS[x.code].label}schicht`).join(', ')}. ${r.tags?.includes('mitnehmen') ? '1 Portion mehr kochen und in die Dose.' : 'Für die Dose eignet sich das Gericht weniger, lieber etwas Kaltes vorbereiten.'}</div>` : ''}
          ${missing.length ? `<div class="tiny muted">Fehlt: ${missing.map(n => listed.has(n.toLowerCase()) ? `${esc(n)} ✓` : esc(n)).join(', ')}</div>` : ''}
          ${missing.length && !toBuy.length ? '<div class="tiny good-tag">🛒 Alles Fehlende steht auf der Einkaufsliste</div>' : ''}
          ${r.ingredients?.length || r.steps?.length || r.url ? `<details class="tiny"><summary>Rezept</summary>
            ${r.ingredients?.length ? `<ul>${r.ingredients.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
            ${r.steps?.length ? `<ol>${r.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
            ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">Originalrezept öffnen ↗</a>` : ''}</details>` : ''}
        </div>
        ${d.status === 'gekocht' ? '<div class="good-tag">✓ Gekocht</div>' : d.status === 'uebersprungen' ? '<div class="muted tiny">Übersprungen</div>' : `<div class="tip-alts">
          <button class="chip" data-act="swap">🔄 Anderes Gericht</button>
          <button class="chip" data-act="done">✓ Gekocht</button>
          <button class="chip" data-act="skip">Überspringen</button>
          ${toBuy.length ? `<button class="chip" data-act="shop">＋ Fehlendes auf die Liste</button>` : ''}</div>`}
        ${d.status !== 'geplant' ? '<button class="chip" data-act="undo">Rückgängig</button>' : ''}
      </li>`;
    }).join('')}</ul>
    <button id="plan-new">Plan neu erstellen</button>
    <p class="muted tiny">Kalorien sind grobe Schätzungen pro Portion. Regeln: bald Ablaufendes und Vorrat zuerst, Angebote, Lieblingsgerichte, lange nicht Gegessenes, ${s.planHealthRules ? '2× Fisch, höchstens 2× Rind, ' : ''}lange Gerichte eher am Wochenende${s.shiftsOn ? ', Schichten (Hinweise nach ' + SHIFT_SOURCES + ')' : ''}. Nährstoffe pro Woche kommen später.</p>`;
}

function renderRecipes(body) {
  const l = loadRecipes(), missingStarters = STARTERS.filter(s => !l.some(r => r.id === s.id)).length;
  body.innerHTML = `<div class="tip-alts">
      <button class="chip" data-rec="new">＋ Eigenes Gericht</button>
      <button class="chip" data-rec="link">🔗 Per Link</button>
      <button class="chip" data-rec="paste">📋 Rezepttext einfügen</button>
      ${missingStarters ? `<button class="chip" data-rec="starters">Beispielgerichte (${missingStarters})</button>` : ''}</div>
    <ul class="list rec-list">${l.sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || a.title.localeCompare(b.title, 'de')).map(r => `<li data-rec-id="${r.id}" class="${r.paused ? 'paused' : ''}">
      <div class="main"><div class="name">${r.fav ? '★ ' : ''}${esc(r.title)}${r.paused ? ' <span class="muted tiny">(pausiert)</span>' : ''}</div>
        <div class="meta">${esc(KINDS[r.kind] ?? '')} · ${fmtMin(r.min)}${(r.tags ?? []).map(t => ' · ' + esc(TAGS[t] ?? t)).join('')}${r.last ? ` · zuletzt ${new Date(r.last + 'T12:00').toLocaleDateString('de-DE')}` : ''}${r.url ? ' · 🔗' : ''}</div></div>
      <button class="ghost" data-rec-edit="${r.id}" aria-label="Bearbeiten">✎</button></li>`).join('') || '<li class="muted">Noch keine Gerichte.</li>'}</ul>
    <p class="muted tiny">★ = Lieblingsgericht (kommt öfter). Pausierte Gerichte plant die App nicht ein. Gilt für den ganzen Haushalt. Importierte Rezepte nur für den privaten Gebrauch; der Link zum Original bleibt gespeichert.</p>`;
}

function renderShifts(body) {
  const s = getSettings(), me = s.myName;
  if (!me) { body.innerHTML = `<div class="tip hint"><p>Damit der Plan weiß, wessen Schicht es ist, trag bitte deinen Namen ein.</p><button class="chip" data-shift-name>Namen eintragen</button></div>`; return; }
  const dates = Array.from({ length: 14 }, (_, i) => addDays(isoLocal(), i));
  const others = Object.keys(JSON.parse(localStorage.getItem('speisekammer.shifts') ?? '{}')).filter(p => p !== me);
  body.innerHTML = `<p class="tiny muted">Deine Schichten für die nächsten 14 Tage antippen. ${Object.entries(SHIFTS).filter(([k]) => k !== 'X').map(([, v]) => `${v.icon} ${v.label} ${v.from}–${v.to}`).join(' · ')} (übliche Zeiten, Annahme).</p>
    <ul class="list shift-list">${dates.map(d => `<li><span class="shift-day">${dayLabel(d)}</span>
      <div class="seg wrap">${SHIFT_ORDER.filter(Boolean).map(c => `<button type="button" data-shift="${d}" data-code="${c}" class="${shiftOf(me, d) === c ? 'active' : ''}">${SHIFTS[c].icon} ${SHIFTS[c].label}</button>`).join('')}</div>
      ${others.map(o => shiftOf(o, d) ? `<div class="tiny muted">${esc(o)}: ${SHIFTS[shiftOf(o, d)].icon} ${SHIFTS[shiftOf(o, d)].label}</div>` : '').join('')}</li>`).join('')}</ul>
    <p class="muted tiny">Der Plan berücksichtigt das: vor der Nachtschicht leichte Gerichte, für Spät- und Nachtschicht am Vortag eine Portion mehr für die Dose, die Erinnerung passt sich an. Hinweise nach ${SHIFT_SOURCES}. Keine medizinische Beratung.</p>`;
}

// ---------- Aktionen ----------
async function onClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.view) { view = b.dataset.view; return render(); }
  if (b.id === 'plan-new') { build(isoLocal(), (loadPlan()?.days ?? []).filter(d => daysTo(d.date) >= 0)); return render(); }
  if (b.dataset.rec) return recipeAction(b.dataset.rec);
  if (b.dataset.recEdit) return editRecipe(b.dataset.recEdit);
  if ('shiftName' in b.dataset) { const n = await ctx.askInput('Dein Name', 'Name', ''); if (n) { ctx.setSetting('myName', n); } return render(); }
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
    Object.assign(d, { dinner: next.r.id, title: next.r.title, why: next.sc.why.slice(0, 3), swapped: seen.length >= activeRecipes().length - 1 ? [] : seen });
  } else if (act === 'useleft') {
    const it = items.find(x => x.id === b.dataset.rest); if (!it) return;
    const last = p.days.at(-1), dropped = { dinner: last.dinner, title: last.title, why: last.why };
    for (let j = p.days.length - 1; j > i; j--) Object.assign(p.days[j], { dinner: p.days[j - 1].dinner, title: p.days[j - 1].title, why: p.days[j - 1].why });
    d.leftover = { id: it.id, name: it.name, dropped };
    savePlan(p); render(); toast(`🍲 ${it.name} eingeplant`); return;
  } else if (act === 'unleft') {
    const dropped = d.leftover.dropped; delete d.leftover;
    for (let j = i; j < p.days.length - 1; j++) Object.assign(p.days[j], { dinner: p.days[j + 1].dinner, title: p.days[j + 1].title, why: p.days[j + 1].why });
    Object.assign(p.days.at(-1), dropped);
  } else if (act === 'done' && d.leftover) {
    d.status = 'gekocht'; savePlan(p); render();
    document.dispatchEvent(new CustomEvent('plan:leftoverEaten', { detail: { id: d.leftover.id } }));
    return;
  } else if (act === 'done') {
    d.status = 'gekocht'; savePlan(p); markCooked(r.id, d.date); render();
    await askUsed(r);
    document.dispatchEvent(new CustomEvent('plan:cooked', { detail: { title: r.title, date: d.date } }));
    return;
  } else if (act === 'skip') {
    d.status = 'uebersprungen';
  } else if (act === 'undo') d.status = 'geplant';
  else if (act === 'shop') {
    const add = (r.need ?? []).filter(([w]) => !has(items, w)).map(([, n]) => n);
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
async function askUsed(r) {
  let left = (r.need ?? []).map(([w]) => has(items, w)).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
  while (left.length) {
    const v = await ctx.ask('Was wurde verbraucht?', 'Antippen, was aufgebraucht ist. Der Rest bleibt im Vorrat.',
      [...left.map(x => ({ value: x.id, label: `${x.name} (${x.qty} ${x.unit})` })), { value: '', label: 'Fertig', cls: 'primary' }]);
    if (!v) break;
    const it = left.find(x => x.id === v); await ctx.store.consume(it.id, it.qty, 'eaten');
    left = left.filter(x => x.id !== v);
  }
  await ctx.renderPantry();
}

// ---------- Gerichte bearbeiten ----------
async function recipeAction(kind) {
  if (kind === 'starters') { addStarters(); build(); toast('Beispielgerichte übernommen'); return render(); }
  if (kind === 'new') {
    const title = await ctx.askInput('Neues Gericht', 'Name, z. B. „Kartoffelsuppe“', ''); if (!title) return;
    const k = await ctx.ask('Was für ein Gericht?', esc(title), Object.entries(KINDS).map(([v, l]) => ({ value: v, label: l }))); if (!k) return;
    const min = await ctx.ask('Wie lange dauert es insgesamt?', 'Vorbereiten und Garen', [15, 30, 45, 60, 90].map(m => ({ value: String(m), label: fmtMin(m) }))); if (!min) return;
    const ing = await ctx.askInput('Hauptzutaten', 'Mit Komma trennen, z. B. „Kartoffeln, Möhren, Lauch“', '');
    const need = (ing ?? '').split(',').map(x => needFromLine(x.trim())).filter(Boolean);
    const r = upsertRecipe({ title, kind: k, min: +min, need, method: '', tags: [], fav: false });
    toast('Gericht gespeichert'); view = 'recipes'; render(); return;
  }
  if (kind === 'link') {
    if (!ctx.store.importRecipe) {
      await ctx.ask('Import per Link', 'Der Import per Link braucht die gemeinsame Datenbank (Supabase), weil das Handy fremde Webseiten nicht direkt lesen darf. Bis dahin: auf der Rezeptseite Titel, Zutaten und Zubereitung markieren, kopieren und unter „Rezepttext einfügen“ einfügen.', [{ value: 'ok', label: 'OK', cls: 'primary' }]);
      return;
    }
    const url = await ctx.askInput('Rezept per Link', 'Link zur Rezeptseite', '', 'url'); if (!url) return;
    try { toast('Rezept wird geladen …'); const data = await ctx.store.importRecipe(url); return confirmImport(recipeFromParts({ ...data, url })); }
    catch (e) { await ctx.ask('Import hat nicht geklappt', esc(e.message) + '<br>Tipp: Rezepttext kopieren und unter „Rezepttext einfügen“ einfügen.', [{ value: 'ok', label: 'OK' }]); return; }
  }
  if (kind === 'paste') {
    const t = await ctx.askInput('Rezepttext einfügen', 'Titel, Zutaten und Zubereitung (von der Webseite kopiert)', '', 'textarea'); if (!t) return;
    const parsed = parseRecipeText(t); if (!parsed) return;
    return confirmImport(recipeFromParts(parsed));
  }
}
async function confirmImport(r) {
  const v = await ctx.ask(`„${r.title}“ übernehmen?`, `${esc(KINDS[r.kind])} · ${fmtMin(r.min)} · ${r.need.length} Zutaten erkannt: ${r.need.map(n => esc(n[1])).join(', ') || 'keine'}${r.steps?.length ? ` · ${r.steps.length} Schritte` : ''}`,
    [{ value: 'ok', label: 'Übernehmen', cls: 'primary' }, { value: 'kind', label: 'Art ändern' }, { value: '', label: 'Abbrechen' }]);
  if (v === 'kind') { const k = await ctx.ask('Was für ein Gericht?', esc(r.title), Object.entries(KINDS).map(([x, l]) => ({ value: x, label: l }))); if (k) r.kind = k; return confirmImport(r); }
  if (v !== 'ok') return;
  upsertRecipe({ ...r, src: r.url ? 'link' : 'own' }); toast('Gericht gespeichert'); view = 'recipes'; render();
}
async function editRecipe(id) {
  const r = loadRecipes().find(x => x.id === id); if (!r) return;
  const v = await ctx.ask(r.title, `${esc(KINDS[r.kind] ?? '')} · ${fmtMin(r.min)} · Zutaten: ${(r.need ?? []).map(n => esc(n[1])).join(', ') || 'keine'}`, [
    { value: 'fav', label: r.fav ? '☆ Kein Lieblingsgericht mehr' : '★ Lieblingsgericht', cls: 'primary' },
    { value: 'tags', label: '🏷️ Eigenschaften (leicht, kalt, Dose)' },
    { value: 'min', label: '⏱️ Dauer ändern' },
    { value: 'need', label: '🥕 Hauptzutaten ändern' },
    { value: 'pause', label: r.paused ? '▶️ Wieder einplanen' : '⏸️ Gerade nicht (pausieren)' },
    { value: 'del', label: '🗑️ Löschen', cls: 'danger' }, { value: '', label: 'Schließen' }]);
  if (v === 'fav') updateRecipe(id, x => x.fav = !x.fav);
  else if (v === 'pause') updateRecipe(id, x => x.paused = !x.paused);
  else if (v === 'min') { const m = await ctx.ask('Wie lange dauert es?', esc(r.title), [15, 30, 45, 60, 75, 90, 120].map(m => ({ value: String(m), label: fmtMin(m), cls: m === r.min ? 'primary' : '' }))); if (m) updateRecipe(id, x => x.min = +m); }
  else if (v === 'need') { const t = await ctx.askInput('Hauptzutaten', 'Mit Komma trennen', (r.need ?? []).map(n => n[1]).join(', ')); if (t != null) updateRecipe(id, x => x.need = t.split(',').map(y => needFromLine(y.trim())).filter(Boolean)); }
  else if (v === 'tags') {
    for (;;) {
      const cur = loadRecipes().find(x => x.id === id).tags ?? [];
      const t = await ctx.ask('Eigenschaften', 'Antippen zum An- und Ausschalten', [...Object.entries(TAGS).map(([k, l]) => ({ value: k, label: `${cur.includes(k) ? '✓ ' : ''}${l}` })), { value: '', label: 'Fertig', cls: 'primary' }]);
      if (!t) break;
      updateRecipe(id, x => x.tags = cur.includes(t) ? cur.filter(y => y !== t) : [...cur, t]);
    }
  } else if (v === 'del') { const ok = await ctx.ask(`„${r.title}“ löschen?`, 'Für alle im Haushalt.', [{ value: 'yes', label: 'Löschen', cls: 'danger' }, { value: '', label: 'Abbrechen' }]); if (ok) deleteRecipe(id); }
  else return;
  render();
}

export function initPlan(c) {
  ctx = c;
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
