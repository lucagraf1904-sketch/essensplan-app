// DEMO-Essensplan (Vorschau). Nicht der echte Planer: feste Beispielgerichte, einfache Punkteregel.
// Liefert getPlannedMeal(date, meal) für die Abendessen-Erinnerung in app.js.
import { isoLocal } from './categories.js';

const PLAN_KEY = 'speisekammer.demoPlan', DB_KEY = 'speisekammer.v1', SHOP_KEY = 'speisekammer.shopping';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Beispielgerichte: kein Schwein, wenig Weizen, Ninja/Herd/Ofen. kcal = grobe Schätzung pro Portion.
// need: Zutaten mit Suchwort (für Vorrat) und Anzeigename (für die Einkaufsliste)
const DINNERS = [
  { id: 'chili', title: 'Chili con Carne mit Reis', type: 'rind', method: 'Ninja Druckgaren', min: 45, kcal: 650, veg: 250,
    need: [['hack', 'Rinderhackfleisch'], ['paprika', 'Paprika'], ['bohnen', 'Kidneybohnen'], ['reis', 'Reis'], ['tomate', 'Gehackte Tomaten']] },
  { id: 'bolo', title: 'Vollkorn-Spaghetti Bolognese', type: 'rind', method: 'Herd, Topf', min: 40, kcal: 700, veg: 200,
    need: [['hack', 'Rinderhackfleisch'], ['spaghetti', 'Vollkorn-Spaghetti'], ['tomate', 'Passierte Tomaten'], ['möhre', 'Möhren']] },
  { id: 'lachs', title: 'Lachs mit Ofengemüse', type: 'fisch', method: 'Backofen 180 °C', min: 35, kcal: 560, veg: 300,
    need: [['lachs', 'Lachsfilet'], ['paprika', 'Paprika'], ['zucchini', 'Zucchini'], ['kartoffel', 'Kartoffeln']] },
  { id: 'seelachs', title: 'Seelachs mit Spinat und Kartoffeln', type: 'fisch', method: 'Pfanne + Topf', min: 30, kcal: 480, veg: 250,
    need: [['seelachs', 'Seelachsfilet (TK)'], ['spinat', 'Spinat (TK)'], ['kartoffel', 'Kartoffeln']] },
  { id: 'haehnchen-curry', title: 'Hähnchen-Curry mit Reis', type: 'gefluegel', method: 'Ninja Druckgaren', min: 35, kcal: 620, veg: 250,
    need: [['hähnchen', 'Hähnchenbrustfilet'], ['paprika', 'Paprika'], ['kokos', 'Kokosmilch'], ['reis', 'Reis']] },
  { id: 'haehnchen-ninja', title: 'Hähnchen aus dem Ninja mit Brokkoli', type: 'gefluegel', method: 'Ninja Heißluft 180 °C + Dämpfen', min: 30, kcal: 520, veg: 300,
    need: [['hähnchen', 'Hähnchenbrustfilet'], ['brokkoli', 'Brokkoli'], ['kartoffel', 'Kartoffeln']] },
  { id: 'gulasch', title: 'Rindergulasch mit Kartoffeln', type: 'rind', method: 'Ninja Schmoren', min: 75, kcal: 640, veg: 150,
    need: [['gulasch', 'Rindergulasch'], ['zwiebel', 'Zwiebeln'], ['paprika', 'Paprika'], ['kartoffel', 'Kartoffeln']] },
  { id: 'linsen', title: 'Linsen-Gemüse-Suppe', type: 'veggie', method: 'Ninja Druckgaren', min: 75, kcal: 450, veg: 350,
    need: [['linsen', 'Rote Linsen'], ['möhre', 'Möhren'], ['kartoffel', 'Kartoffeln'], ['lauch', 'Lauch']] },
  { id: 'omelett', title: 'Gemüse-Omelett mit Roggenbrot', type: 'veggie', method: 'Pfanne', min: 20, kcal: 520, veg: 250,
    need: [['eier', 'Eier'], ['paprika', 'Paprika'], ['spinat', 'Spinat (TK)'], ['gouda', 'Gouda'], ['roggen', 'Roggen-Vollkornbrot']] },
  { id: 'pfannkuchen', title: 'Dinkel-Vollkorn-Pfannkuchen mit Apfel', type: 'veggie', method: 'Pfanne', min: 30, kcal: 600, veg: 150, forgotten: true,
    need: [['eier', 'Eier'], ['milch', 'Milch'], ['äpfel', 'Äpfel'], ['dinkel', 'Dinkel-Vollkornmehl']] },
  { id: 'putenpfanne', title: 'Putengeschnetzeltes mit Champignons und Reis', type: 'gefluegel', method: 'Pfanne', min: 30, kcal: 580, veg: 250,
    need: [['pute', 'Putengeschnetzeltes'], ['champignon', 'Champignons'], ['reis', 'Reis']] },
  { id: 'ofenkartoffel', title: 'Ofenkartoffeln mit Quark und Gurkensalat', type: 'veggie', method: 'Backofen 180 °C', min: 50, kcal: 500, veg: 250,
    need: [['kartoffel', 'Kartoffeln'], ['quark', 'Magerquark'], ['gurke', 'Gurke']] },
];
const BREAKFASTS = [
  { title: 'Dinkel-Vollkorn-Toast mit Ei und Paprika', need: [['toast', 'Dinkel-Vollkorn-Toast'], ['eier', 'Eier']] },
  { title: 'Roggen-Vollkornbrot mit Käse und Gurke', need: [['roggen', 'Roggen-Vollkornbrot'], ['gouda', 'Gouda']] },
  { title: 'Naturjoghurt mit Apfel und Haferflocken', need: [['joghurt', 'Naturjoghurt'], ['äpfel', 'Äpfel'], ['hafer', 'Haferflocken']] },
  { title: 'Dinkel-Vollkorn-Toast mit Quark und Tomate', need: [['toast', 'Dinkel-Vollkorn-Toast'], ['quark', 'Magerquark']] },
  { title: 'Laugenbrezel mit Käse und Obst (Wochenend-Ausnahme)', need: [['laugen', 'Laugenbrezel'], ['gouda', 'Gouda']], weekend: true },
];
const TYPE = { rind: 'Rind', fisch: 'Fisch', gefluegel: 'Geflügel', veggie: 'Vegetarisch' };
const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

const loadDb = () => { try { return JSON.parse(localStorage.getItem(DB_KEY)) ?? { items: [], log: [] }; } catch { return { items: [], log: [] }; } };
const loadPlan = () => { try { return JSON.parse(localStorage.getItem(PLAN_KEY)); } catch { return null; } };
const savePlan = p => localStorage.setItem(PLAN_KEY, JSON.stringify(p));
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return isoLocal(d); };
const daysTo = iso => Math.round((new Date(iso + 'T12:00') - new Date(isoLocal() + 'T12:00')) / 86400000);
const has = (items, w) => items.find(i => i.name.toLowerCase().includes(w));

// Punkte: Vorrat nutzen (bald ablaufend zählt dreifach), Fisch 2×/Woche, Fleisch max. 3×, keine Wiederholung
function score(r, items, chosen, dayIdx) {
  let s = 0; const why = [];
  for (const [w] of r.need) {
    const it = has(items, w); if (!it) continue;
    const d = it.expiry && !it.frozenAt ? daysTo(it.expiry) : 99;
    if (dayIdx > Math.max(d, 0)) continue; // bis dahin abgelaufen
    if (chosen.some(c => c.need[0][0] === w && r.need[0][0] === w)) continue; // Hauptzutat (z. B. eine Packung Hack) schon verplant
    if (d <= 2) { s += 5; why.push(`${it.name} läuft ${d <= 0 ? 'heute' : d === 1 ? 'morgen' : 'übermorgen'} ab`); }
    else { s += 1.5; why.push(`${it.name} ist da${it.frozenAt ? ' (eingefroren)' : ''}`); }
  }
  const fish = chosen.filter(c => c.type === 'fisch').length, meat = chosen.filter(c => c.type === 'rind').length;
  if (r.type === 'fisch' && fish < 2) { s += 2; why.push('Fischabend (Ziel 2× pro Woche)'); }
  if (r.type === 'fisch' && fish >= 2) s -= 3;
  if (r.type === 'rind' && meat >= 2) s -= 4;
  if (chosen.some(c => c.id === r.id)) s -= 10;
  if (r.forgotten && dayIdx === 5) { s += 3; why.push('Lange nicht gegessen'); }
  if (dayIdx < 5 && r.min > 60) s -= 1; // lange Gerichte eher am Wochenende
  return { s, why };
}

function build(start = isoLocal()) {
  const items = loadDb().items, chosen = [], days = [], usedBf = new Set();
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i), wd = new Date(date + 'T12:00').getDay();
    const ranked = DINNERS.map(r => ({ r, ...score(r, items, chosen, i) })).sort((a, b) => b.s - a.s);
    const pick = ranked[0]; chosen.push(pick.r);
    const bf = BREAKFASTS.filter(b => !b.weekend || wd === 0 || wd === 6);
    // Frühstück: bald Ablaufendes zuerst, sonst reihum (Wochenende: Brezel-Ausnahme)
    const urgent = bf.find(b => b.need.some(([w]) => { const it = has(items, w); return it && !it.frozenAt && it.expiry && i <= daysTo(it.expiry) && daysTo(it.expiry) <= 1 && !usedBf.has(w); }));
    if (urgent) urgent.need.forEach(([w]) => usedBf.add(w));
    const weekend = bf.find(b => b.weekend);
    const breakfast = (urgent ?? (weekend && wd === 0 ? weekend : bf.filter(b => !b.weekend)[i % 4])).title;
    days.push({ date, dinner: pick.r.id, why: pick.why.slice(0, 3), breakfast, status: 'geplant' });
  }
  const p = { start, days }; savePlan(p); return p;
}
function getPlan() {
  const p = loadPlan();
  if (!p || !p.days?.length || daysTo(p.days.at(-1).date) < 0) return build();
  return p;
}
const recipe = id => DINNERS.find(r => r.id === id);
// Auftauen: eingefrorene Zutat am Vorabend in den Kühlschrank
const thawFor = r => { const it = r.need.map(([w]) => has(loadDb().items, w)).find(i => i?.frozenAt); return it?.name ?? null; };

// Für die Abendessen-Erinnerung (app.js)
export async function getPlannedMeal(date, meal = 'dinner') {
  if (meal !== 'dinner') return null;
  const d = getPlan().days.find(x => x.date === date); if (!d) return null;
  const r = recipe(d.dinner);
  return { date, meal, title: r.title, totalMinutes: r.min, method: r.method, thawFrom: thawFor(r) ? addDays(date, -1) : null, status: d.status };
}

function render() {
  const el = $('#tab-plan'); if (!el) return;
  const p = getPlan(), items = loadDb().items;
  const rs = p.days.filter(d => d.status !== 'uebersprungen').map(d => recipe(d.dinner));
  const fish = rs.filter(r => r.type === 'fisch').length, meat = rs.filter(r => r.type === 'rind').length;
  const veg = Math.round(rs.reduce((a, r) => a + r.veg, 0) / Math.max(1, rs.length));
  el.innerHTML = `<h2>Essensplan</h2>
    <div class="tip hint"><b>🧪 Vorschau</b><p>Beispiel-Essensplan für die Demo. Der echte Planer mit euren Lieblingsgerichten, Nährwerten und Lernfunktion kommt später.</p></div>
    <div class="plan-sum"><span>🐟 Fisch ${fish}×</span><span>🥩 Rind ${meat}×</span><span>🥦 ca. ${veg} g Gemüse/Abend</span></div>
    <ul class="list plan-list">${p.days.map((d, i) => {
      const r = recipe(d.dinner), wd = new Date(d.date + 'T12:00'), thaw = thawFor(r);
      const missing = r.need.filter(([w]) => !has(items, w)).map(([, n]) => n);
      const today = daysTo(d.date) === 0;
      return `<li class="plan-day ${d.status}" data-i="${i}">
        <div class="plan-date">${today ? 'Heute' : DAYS[wd.getDay()]}, ${wd.getDate()}.${wd.getMonth() + 1}.</div>
        <div class="tiny muted">☀️ 11–12:30 Uhr · ${esc(d.breakfast)}</div>
        <div class="plan-dinner"><b>🍽️ ${esc(r.title)}</b>
          <div class="tiny">${esc(TYPE[r.type])} · ${esc(r.method)} · ${r.min >= 60 ? `${Math.floor(r.min / 60)} h ${r.min % 60 ? r.min % 60 + ' min' : ''}` : r.min + ' min'} · ca. ${r.kcal} kcal</div>
          ${d.why.length ? `<div class="tiny plan-why">${d.why.map(w => `<span>✓ ${esc(w)}</span>`).join('')}</div>` : ''}
          ${thaw ? `<div class="tiny plan-thaw">❄️ ${esc(thaw)} am Vorabend auftauen</div>` : ''}
          ${missing.length ? `<div class="tiny muted">Fehlt: ${missing.map(esc).join(', ')}</div>` : ''}
        </div>
        ${d.status === 'gekocht' ? '<div class="good-tag">✓ Gekocht</div>' : d.status === 'uebersprungen' ? '<div class="muted tiny">Übersprungen</div>' : `<div class="tip-alts">
          <button class="chip" data-act="swap">🔄 Anderes Gericht</button>
          <button class="chip" data-act="done">✓ Gekocht</button>
          <button class="chip" data-act="skip">Überspringen</button>
          ${missing.length ? `<button class="chip" data-act="shop">＋ Fehlendes auf die Liste</button>` : ''}</div>`}
        ${d.status !== 'geplant' ? '<button class="chip" data-act="undo">Rückgängig</button>' : ''}
      </li>`;
    }).join('')}</ul>
    <button id="plan-new">Plan neu erstellen</button>
    <p id="plan-msg" class="muted tiny"></p>
    <p class="muted tiny">Kalorien sind grobe Schätzungen pro Portion. Regeln: Vorrat und bald Ablaufendes zuerst, 2× Fisch, höchstens 2× Rind, kein Schwein, wenig Weizen, lange Gerichte eher am Wochenende.</p>`;
}

function onClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'plan-new') { build(); return render(); }
  const li = b.closest('li[data-i]'); if (!li) return;
  const p = getPlan(), d = p.days[+li.dataset.i], r = recipe(d.dinner);
  const act = b.dataset.act;
  if (act === 'swap') {
    const others = p.days.filter(x => x !== d).map(x => recipe(x.dinner));
    const items = loadDb().items;
    const ranked = DINNERS.filter(x => x.id !== d.dinner).map(x => ({ x, ...score(x, items, others, +li.dataset.i) })).sort((a, b) => b.s - a.s);
    const seen = d.swapped ?? []; seen.push(d.dinner);
    const next = ranked.find(c => !seen.includes(c.x.id)) ?? ranked[0];
    d.dinner = next.x.id; d.why = next.why.slice(0, 3); d.swapped = seen.length >= DINNERS.length - 1 ? [] : seen;
  } else if (act === 'done') d.status = 'gekocht';
  else if (act === 'skip') d.status = 'uebersprungen';
  else if (act === 'undo') d.status = 'geplant';
  else if (act === 'shop') {
    const items = loadDb().items, list = (() => { try { return JSON.parse(localStorage.getItem(SHOP_KEY)) ?? []; } catch { return []; } })();
    const add = r.need.filter(([w]) => !has(items, w)).map(([, n]) => n).filter(n => !list.some(x => !x.done && x.name.toLowerCase() === n.toLowerCase()));
    for (const name of add) list.push({ id: crypto.randomUUID?.() ?? String(Math.random()), name, done: false });
    localStorage.setItem(SHOP_KEY, JSON.stringify(list));
    savePlan(p); render();
    $('#plan-msg').textContent = add.length ? `Auf die Einkaufsliste: ${add.join(', ')}` : 'Steht schon alles auf der Liste.';
    return;
  }
  savePlan(p); render();
}

const tab = $('#tab-plan');
if (tab) {
  tab.addEventListener('click', onClick);
  document.querySelector('nav button[data-tab=plan]')?.addEventListener('click', render);
  render();
}
