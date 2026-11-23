// Ersteinrichtung (Luca 23.11.2026, „Einführung, Kennenlernen, Bestandsaufnahme“): Einführung, Kennenlern-Fragen, Bestandsaufnahme.
// Grundsätze: alles zum Antippen, Bekanntes ist als Vorschlag vorausgewählt und wird erst mit „Weiter“ übernommen,
// jedes Feld und jeder Schritt ist überspringbar. Gesundheitsangaben bleiben nur auf diesem Gerät (settings.health ist LOCAL_ONLY).
// Die App ändert den Essensplan nie von selbst wegen Erkrankungen: Ausschlüsse setzt die Person hier selbst per Tipp.
import { CATEGORIES, guessCategory, defaultExpiry, freezeExpiry, isoLocal } from './categories.js';
import { CONDITIONS, conditionLabel } from './conditions.js';
import { STARTERS, addStarters, loadRecipes } from './recipes.js';

export const DONE_KEY = 'speisekammer.onboarded';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Vorschläge aus dem, was für diesen Haushalt schon bekannt ist (Luca 22.11.); die Person bestätigt oder ändert.
const SUGGEST = { prefs: ['wenigWeizen', 'keinSchwein'], dinnerAt: '17:00' };
const PREFS = [['wenigWeizen', 'Wenig Weizen'], ['keinSchwein', 'Kein Schweinefleisch'], ['wenigFleisch', 'Wenig Fleisch'], ['vegetarisch', 'Vegetarisch']];
const EXCL = [['pilz', 'Pilze'], ['fisch', 'Fisch'], ['meeresfrüchte', 'Meeresfrüchte'], ['nüsse', 'Nüsse'], ['eier', 'Eier'], ['zwiebel', 'Zwiebeln'],
  ['koriander', 'Koriander'], ['innereien', 'Innereien'], ['oliven', 'Oliven'], ['rosenkohl', 'Rosenkohl'], ['paprika', 'Paprika'], ['tomate', 'Tomaten']];
const HEALTH = ['diabetes', 'bluthochdruck', 'cholesterin', 'gicht', 'reizdarm', 'laktose', 'zoeliakie', 'crohn', 'schilddruese', 'eisenmangel', 'schwanger'];
const EXTRA_UT = ['Mikrowelle', 'Mixer / Pürierstab', 'Reiskocher', 'Slow Cooker', 'Grill'];
const DINNER = ['12:00', '17:00', '18:00', '19:00'];
const GOALS = [1500, 2000, 2500];

// Bestandsaufnahme: typische Artikel, ein Tipp = +1 Stück. c = Kategorie, l = Lagerort (sonst nach Kategorie)
const STOCK = [
  ['🧊 Kühlschrank', [['Milch', 'Milchprodukte'], ['Butter', 'Milchprodukte'], ['Eier', 'Eier'], ['Joghurt', 'Milchprodukte'], ['Quark', 'Milchprodukte'], ['Käse', 'Milchprodukte'],
    ['Frischkäse', 'Milchprodukte'], ['Sahne', 'Milchprodukte'], ['Aufschnitt', 'Fleisch & Fisch'], ['Hähnchenbrust', 'Fleisch & Fisch'], ['Rinderhack', 'Fleisch & Fisch'], ['Lachsfilet', 'Fleisch & Fisch']]],
  ['🥕 Obst & Gemüse', [['Äpfel', 'Obst'], ['Bananen', 'Obst'], ['Zitronen', 'Obst'], ['Tomaten', 'Gemüse'], ['Gurke', 'Gemüse'], ['Paprika', 'Gemüse'], ['Karotten', 'Gemüse'],
    ['Zwiebeln', 'Gemüse'], ['Kartoffeln', 'Gemüse'], ['Brokkoli', 'Gemüse'], ['Salat', 'Gemüse'], ['Champignons', 'Gemüse']]],
  ['🥫 Vorratsschrank', [['Dinkel-Vollkorn-Toast', 'Brot & Backwaren'], ['Brot', 'Brot & Backwaren'], ['Nudeln', 'Trockenware'], ['Reis', 'Trockenware'], ['Haferflocken', 'Trockenware'],
    ['Mehl', 'Trockenware'], ['Linsen', 'Trockenware'], ['Gehackte Tomaten (Dose)', 'Konserven'], ['Kidneybohnen (Dose)', 'Konserven'], ['Mais (Dose)', 'Konserven'],
    ['Olivenöl', 'Gewürze & Öle'], ['Zucker', 'Trockenware'], ['Kaffee', 'Getränke'], ['Tee', 'Getränke'], ['Mineralwasser', 'Getränke']]],
  ['❄️ Gefrierschrank', [['Rinderhack (TK)', 'Fleisch & Fisch', 'Gefrierschrank'], ['Hähnchen (TK)', 'Fleisch & Fisch', 'Gefrierschrank'], ['Lachsfilet (TK)', 'Fleisch & Fisch', 'Gefrierschrank'],
    ['TK-Spinat', 'Tiefkühl', 'Gefrierschrank'], ['TK-Gemüse', 'Tiefkühl', 'Gefrierschrank'], ['TK-Beeren', 'Tiefkühl', 'Gefrierschrank'], ['TK-Pizza', 'Tiefkühl', 'Gefrierschrank']]],
];

let ctx = null, step = 0, d = {}, host = null;
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function initOnboarding(c) {
  ctx = c;
  window.__startOnboarding = () => start(true);
  if (localStorage.getItem(DONE_KEY) || document.querySelector('script[src="demo.js"]')) return;
  setTimeout(() => { if (!localStorage.getItem(DONE_KEY)) start(false); }, 400);
}

function loadDraft() {
  const s = ctx.getSettings(), first = !localStorage.getItem(DONE_KEY);
  const ut = ctx.ut.load();
  d = {
    name: s.myName ?? '', size: s.householdSize ?? 2,
    dinnerAt: first ? (s.dinnerAt || SUGGEST.dinnerAt) : s.dinnerAt,
    utensils: new Set(ut.filter(u => u.has).map(u => u.name)), utList: ut,
    prefs: new Set((s.prefs?.length ? s.prefs : first ? SUGGEST.prefs : [])),
    excl: new Set((s.planExclude ?? []).map(e => e.w)),
    weightOn: !!s.weightOn, goal: s.drinkGoalMl ?? 1500,
    health: new Set(s.health ?? []), shiftsOn: !!s.shiftsOn, starters: false,
    suggested: first,
  };
}

// ---------- Schritte: html(), apply() = Auswahl übernehmen ----------
const chip = (attr, val, label, on, extra = '') => `<button type="button" class="chip ${on ? 'accepted' : ''}" ${attr}="${esc(val)}" ${extra}>${on ? '✓ ' : ''}${esc(label)}</button>`;
const hint = t => `<p class="tiny muted">${t}</p>`;
const sug = () => d.suggested ? '<span class="onb-sug">Vorschlag, bitte bestätigen oder ändern</span>' : '';

const STEPS = [
  { id: 'intro', title: 'Willkommen in der Speisekammer 👋', skip: false, html: () => `
      <p>Die App merkt sich, was im Haus ist, warnt vor Abgelaufenem, schlägt einen Essensplan vor und hilft beim Einkaufen. Damit das passt, stellen wir ein paar Fragen. Das dauert etwa 3 Minuten.</p>
      <ul class="onb-list">
        <li><b>Antippen statt tippen:</b> fast alles sind Knöpfe.</li>
        <li><b>Alles überspringbar:</b> jeder Schritt hat „Überspringen“. Später geht alles auch unter Einstellungen.</li>
        <li><b>Gesundheit bleibt bei dir:</b> Angaben dazu werden nur auf diesem Handy gespeichert und nie hochgeladen.</li>
        <li><b>Die App berät nur:</b> den Essensplan ändert sie nie von selbst, auch nicht wegen Erkrankungen. Was weggelassen wird, bestimmst du.</li>
      </ul>` },
  { id: 'you', title: 'Wer bist du, wer isst mit?', html: () => `
      <label class="onb-f">Dein Name (für Dienstplan und Anzeige)<input id="onb-name" value="${esc(d.name)}" placeholder="z. B. Luca" autocomplete="off" enterkeyhint="done"></label>
      <p class="onb-q">Wie viele Personen essen regelmäßig mit?</p>
      <div class="tip-alts">${[1, 2, 3, 4, 5, 6].map(n => chip('data-size', n, n === 6 ? '6+' : String(n), d.size === n)).join('')}</div>` ,
    apply: () => { const n = document.getElementById('onb-name')?.value.trim(); if (n) ctx.setSetting('myName', n); ctx.setSetting('householdSize', d.size); } },
  { id: 'rhythm', title: 'Wann wird warm gegessen?', html: () => `
      ${sug()}<p class="onb-q">Das warme Essen am Tag (für Erinnerung und Plan)</p>
      <div class="tip-alts">${DINNER.map(t => chip('data-dinner', t, t + ' Uhr', d.dinnerAt === t)).join('')}</div>
      ${hint('Die Erinnerung kommt automatisch früher, je nachdem, wie lange das Gericht dauert. Feinheiten stellst du später unter Einstellungen ein.')}`,
    apply: () => ctx.setSetting('dinnerAt', d.dinnerAt) },
  { id: 'kitchen', title: 'Was habt ihr in der Küche?', html: () => `
      ${sug()}<p class="onb-q">Der Plan wählt nur Gerichte, die damit gehen.</p>
      <div class="tip-alts">${[...d.utList.map(u => u.name), ...EXTRA_UT.filter(n => !d.utList.some(u => u.name === n))].map(n => chip('data-ut', n, n.replace(/ \(.*\)/, ''), d.utensils.has(n))).join('')}</div>`,
    apply: () => {
      const names = new Set([...d.utList.map(u => u.name), ...d.utensils]);
      ctx.ut.save([...names].map(name => ({ ...(d.utList.find(u => u.name === name) ?? {}), name, has: d.utensils.has(name) })));
    } },
  { id: 'goals', title: 'Ernährung: Vorlieben und Ziele', html: () => `
      ${sug()}<p class="onb-q">Was soll der Plan bevorzugen? (mehrere möglich)</p>
      <div class="tip-alts">${PREFS.map(([k, l]) => chip('data-pref', k, l, d.prefs.has(k))).join('')}</div>
      <p class="tiny muted">Ein Kalorienziel gibt es nicht, die App rechnet nicht mit.</p>
      <p class="onb-q">Gewicht im Blick behalten? (einmal pro Woche eintragen, nur Verlauf, keine Bewertung)</p>
      <div class="tip-alts">${chip('data-weight', 'on', 'Ja, Gewichtstracker an', d.weightOn)}</div>
      <p class="onb-q">Trinkziel pro Tag</p>
      <div class="tip-alts">${GOALS.map(g => chip('data-goal', g, (g / 1000).toLocaleString('de-DE') + ' l', d.goal === g)).join('')}</div>`,
    apply: () => { ctx.setSetting('prefs', [...d.prefs]); ctx.setSetting('weightOn', d.weightOn); ctx.setSetting('drinkGoalMl', d.goal); } },
  { id: 'excl', title: 'Was soll nicht auf den Tisch?', html: () => `
      <p class="onb-q">Diese Lebensmittel lässt der Essensplan weg (gilt für den ganzen Haushalt):</p>
      <div class="tip-alts">${EXCL.map(([w, l]) => chip('data-excl', w, l, d.excl.has(w))).join('')}</div>
      <div class="onb-row"><input id="onb-excl-new" placeholder="Etwas anderes …" autocomplete="off" enterkeyhint="done"><button type="button" class="chip" data-excl-add>Hinzufügen</button></div>
      ${[...d.excl].filter(w => !EXCL.some(e => e[0] === w)).length ? `<div class="tip-alts">${[...d.excl].filter(w => !EXCL.some(e => e[0] === w)).map(w => chip('data-excl', w, w, true)).join('')}</div>` : ''}
      ${hint('Das ist deine eigene Entscheidung. Rezepte mit diesen Zutaten schlägt der Plan nicht vor. Du kannst es jederzeit unter Einstellungen → Essensplan ändern.')}`,
    apply: () => ctx.applyExcludes(d.excl, [...EXCL, ...Object.entries(d.names ?? {})]) },
  { id: 'health', title: 'Gesundheit (freiwillig)', html: () => `
      <div class="tip hint"><p><b>Nur auf diesem Handy.</b> Diese Angaben werden nicht hochgeladen und nicht mit Lina oder anderen geteilt. Die App ändert deinen Essensplan dadurch nicht und ersetzt keine ärztliche Beratung. Du bekommst nur passende Hinweise bei den Tipps und entscheidest selbst, was du daraus machst.</p></div>
      <p class="onb-q">Trifft etwas auf dich zu? (mehrere möglich, leer lassen ist völlig in Ordnung)</p>
      <div class="tip-alts">${HEALTH.map(id => chip('data-health', id, conditionLabel(id).replace(/ \(.*\)/, ''), d.health.has(id))).join('')}</div>
      ${hint('Weitere Erkrankungen findest du später unter Einstellungen → Gesundheit & Vorlieben (mit Suche).')}`,
    apply: () => ctx.setSetting('health', [...d.health]) },
  { id: 'shifts', title: 'Schichtdienst?', html: () => `
      <p class="onb-q">Arbeitest du im Früh-, Spät- oder Nachtdienst?</p>
      <div class="tip-alts">${chip('data-shifts', 'on', 'Ja, Dienstplan einschalten', d.shiftsOn)}${chip('data-shifts', 'off', 'Nein', !d.shiftsOn)}</div>
      ${hint('Mit Dienstplan gibt es unter Plan → Kalender einen Monatskalender. Der Essensplan richtet sich dann nach deinen Schichten und Essenszeiten.')}`,
    apply: () => ctx.setSetting('shiftsOn', d.shiftsOn) },
  { id: 'stock', title: 'Bestandsaufnahme: Was ist da?', wide: true, html: () => stockHtml() },
  { id: 'done', title: 'Fertig 🎉', skip: false, html: () => `
      <p>Die Einrichtung ist abgeschlossen. Alles lässt sich unter <b>Einstellungen</b> ändern, die Einrichtung selbst unter „🧭 Einrichtung wiederholen“.</p>
      <ul class="onb-list">
        <li><b>Vorrat:</b> mit ＋ weitere Artikel anlegen, mit 📷 Barcodes scannen, mit dem Bon-Tab Kassenbons einlesen.</li>
        <li><b>Haltbarkeit:</b> bei der Bestandsaufnahme sind die Daten Schätzwerte. Tippe auf einen Artikel, um das Datum von der Packung einzutragen.</li>
        <li><b>Plan:</b> ${loadRecipes().length ? 'Eure Gerichte sind schon da.' : 'Es gibt noch keine Gerichte. Du kannst Beispielgerichte übernehmen und danach eigene eintragen.'}</li>
      </ul>
      ${loadRecipes().length ? '' : `<div class="tip-alts">${chip('data-starters', 'on', `Beispielgerichte übernehmen (${STARTERS.length})`, d.starters)}</div>`}`,
    apply: () => { if (d.starters) addStarters(); } },
];

// ---------- Bestandsaufnahme ----------
let items = [];
const findItem = n => items.find(i => same(i.name, n));
function stockHtml() {
  return `<p class="onb-q">Tippe an, was ihr gerade da habt. Jeder Tipp zählt ein Stück dazu, ✕ nimmt eins weg.</p>
    ${STOCK.map(([g, list]) => `<p class="set-sub">${g}</p><div class="tip-alts">${list.map(([n]) => {
      const it = findItem(n), q = it ? Math.round(it.qty) : 0;
      return `<span class="onb-stock ${q ? 'on' : ''}"><button type="button" class="chip ${q ? 'accepted' : ''}" data-stock="${esc(n)}">${q ? `✓ ${q}× ` : ''}${esc(n)}</button>${q ? `<button type="button" class="chip onb-minus" data-stock-minus="${esc(n)}" aria-label="${esc(n)} weniger">✕</button>` : ''}</span>`;
    }).join('')}</div>`).join('')}
    <p class="set-sub">Mehr erfassen</p>
    <div class="tip-alts"><button type="button" class="chip" data-stock-scan>📷 Barcode scannen</button><button type="button" class="chip" data-stock-bon>🧾 Kassenbon einlesen</button><button type="button" class="chip" data-stock-other>＋ Anderes eintragen</button></div>
    ${hint('Haltbarkeit und Menge sind hier Schätzwerte. Später antippen und das Datum von der Packung eintragen. Die Bestandsaufnahme zählt nicht als Einkauf und taucht nicht in den Ausgaben auf.')}`;
}
async function bump(name, delta, cat, loc) {
  const it = findItem(name);
  if (it) {
    const qty = Math.round(it.qty) + delta;
    if (qty <= 0) await ctx.store.deleteItem(it.id); else await ctx.store.upsertItem({ ...it, qty });
  } else if (delta > 0) {
    const category = cat ?? guessCategory(name), location = loc ?? CATEGORIES[category]?.location ?? 'Vorratsschrank';
    const base = { name, category, location, qty: 1, unit: 'Stk', size: '', price: null, expiry: defaultExpiry(category), noLog: true };
    if (location === 'Gefrierschrank' && category !== 'Tiefkühl') Object.assign(base, { frozenAt: isoLocal(), origExpiry: base.expiry, expiry: freezeExpiry({ name, category }).date });
    else if (category === 'Tiefkühl') base.expiry = defaultExpiry('Tiefkühl');
    await ctx.store.upsertItem(base);
  }
  items = await ctx.store.listItems();
}
const stockMeta = n => { for (const [, list] of STOCK) { const e = list.find(x => x[0] === n); if (e) return e; } return [n]; };

// ---------- Dialog ----------
function ensureHost() {
  if (host) return host;
  host = Object.assign(document.createElement('dialog'), { id: 'onb', className: 'onb' });
  document.body.appendChild(host);
  host.addEventListener('cancel', e => { e.preventDefault(); finish(true); });
  host.addEventListener('click', onClick);
  host.addEventListener('input', e => { if (e.target.id === 'onb-name') d.name = e.target.value; });
  host.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'onb-excl-new') { e.preventDefault(); addExcl(); } });
  document.getElementById('item-dialog')?.addEventListener('close', async () => { if (host.open && STEPS[step].id === 'stock') { items = await ctx.store.listItems(); paint(); } });
  return host;
}
function paint() {
  const s = STEPS[step], last = step === STEPS.length - 1, n = STEPS.length;
  const keepScroll = host.querySelector('.onb-body')?.scrollTop ?? 0, keepInput = document.activeElement?.id;
  host.innerHTML = `<div class="onb-top"><div class="onb-prog"><span style="width:${Math.round(step / (n - 1) * 100)}%"></span></div>
      <div class="onb-meta"><span>${step === 0 ? 'Einrichtung' : last ? 'Geschafft' : `Schritt ${step} von ${n - 2}`}</span><button type="button" class="link" data-later>${last ? '' : 'Später'}</button></div></div>
    <div class="onb-body"><h2>${esc(s.title)}</h2>${s.html()}</div>
    <div class="onb-foot">${step > 0 && !last ? '<button type="button" class="chip" data-back>Zurück</button>' : '<span></span>'}
      <span>${s.skip === false ? '' : '<button type="button" class="chip" data-skip>Überspringen</button>'}
      <button type="button" class="primary" data-next>${step === 0 ? 'Los geht’s' : last ? 'Fertig' : 'Weiter'}</button></span></div>`;
  host.querySelector('.onb-body').scrollTop = keepScroll;
  if (keepInput && keepInput.startsWith('onb-')) { const el = document.getElementById(keepInput); el?.focus?.(); }
}
async function start(manual) {
  loadDraft(); step = 0; items = await ctx.store.listItems();
  ensureHost(); paint(); if (!host.open) host.showModal();
}
async function finish(later) {
  localStorage.setItem(DONE_KEY, later ? 'later' : 'done');
  host?.open && host.close();
  ctx.refresh();
}
const go = async delta => {
  if (delta > 0 && STEPS[step].apply) await STEPS[step].apply();
  step = Math.max(0, Math.min(STEPS.length - 1, step + delta)); paint(); host.querySelector('.onb-body').scrollTop = 0;
  if (STEPS[step].id === 'stock') ctx.refresh();
};
function addExcl() {
  const el = document.getElementById('onb-excl-new'), w = el?.value.trim().toLowerCase(); if (!w) return;
  d.excl.add(w); d.names ??= {}; d.names[w] = el.value.trim(); paint();
}
const toggleSet = (set, v) => set.has(v) ? set.delete(v) : set.add(v);

async function onClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  const ds = b.dataset;
  if (ds.next != null) { if (step === STEPS.length - 1) { await STEPS[step].apply?.(); return finish(false); } return go(1); }
  if (ds.back != null) return go(-1);
  if (ds.skip != null) { step = Math.min(STEPS.length - 1, step + 1); paint(); host.querySelector('.onb-body').scrollTop = 0; return; }
  if (ds.later != null) return finish(true);
  if (ds.size) d.size = +ds.size;
  else if (ds.dinner) d.dinnerAt = ds.dinner;
  else if (ds.ut) toggleSet(d.utensils, ds.ut);
  else if (ds.pref) toggleSet(d.prefs, ds.pref);
  else if (ds.weight) d.weightOn = !d.weightOn;
  else if (ds.goal) d.goal = +ds.goal;
  else if (ds.excl) toggleSet(d.excl, ds.excl);
  else if ('exclAdd' in ds) return addExcl();
  else if (ds.health) toggleSet(d.health, ds.health);
  else if (ds.shifts) d.shiftsOn = ds.shifts === 'on';
  else if (ds.starters) d.starters = !d.starters;
  else if (ds.stock) { const [n, c, l] = stockMeta(ds.stock); await bump(n, 1, c, l); }
  else if (ds.stockMinus) await bump(ds.stockMinus, -1);
  else if ('stockScan' in ds) return scanOne();
  else if ('stockBon' in ds) { localStorage.setItem(DONE_KEY, 'done'); host.close(); document.querySelector('nav button[data-tab=scan]')?.click(); return; }
  else if ('stockOther' in ds) { ctx.openItem(); return; }
  else return;
  paint();
}
async function scanOne() {
  try {
    const code = await ctx.scanBarcode(); if (!code) return;
    const info = await ctx.lookupBarcode(code).catch(() => null);
    const name = info?.name || (await ctx.askInput('Barcode ' + code, 'Name des Artikels', '')); if (!name) return;
    const category = info?.category ?? guessCategory(name);
    await ctx.store.upsertItem({ name, category, location: CATEGORIES[category]?.location ?? 'Vorratsschrank', qty: 1, unit: 'Stk', size: info?.size ?? '', price: null,
      expiry: defaultExpiry(category), barcode: code, nutrition: info?.nutrition ?? null, noLog: true });
    items = await ctx.store.listItems(); paint();
  } catch (e) { console.warn('Scan', e); }
}
