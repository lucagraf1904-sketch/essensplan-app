// ENTWURF, NICHT AKTIV (22.11.2026): Luca will die Fragerunde erst nach seinem ausdrücklichen Go.
// Zum Aktivieren: in app.js importieren, #wizard-Container in index.html, CSS ergänzen, in sw.js FILES aufnehmen.
// Kennenlern-Assistent: fragt beim ersten Start Vorlieben, No-Gos und Gewohnheiten ab.
// Alles zum Antippen; nur bei Listen (No-Gos, Lieblingsgerichte, Allergien) kann man Eigenes ergänzen.
// Antworten liegen in localStorage 'speisekammer.profile' (pro Gerät; Supabase folgt).
// Vorbelegt mit dem, was Luca bereits gesagt hat (Stand 22.11.2026).

const KEY = 'speisekammer.profile';

export const DEFAULT_PROFILE = {
  version: 1, done: false, persons: 2,
  mealPattern: 'fasten',
  meals: { breakfast: { from: '11:00', to: '12:30', warm: false }, dinner: { from: '17:00', to: '18:00', warm: true } },
  fasting: true,
  meat: 'wenig-schwein',
  wheat: 'meiden',
  health: ['blutzucker'],
  priorities: ['gemuese', 'reste'],
  allergies: [], dislikes: [], favorites: [], cuisines: [],
  cookTime: 30, spice: 'mittel', leftovers: true, calorieGoal: null,
  people: [], thawReminder: '19:00',
};

// Was Luca bereits erzählt hat. Wird im Assistenten als „schon bekannt“ markiert.
export const KNOWN = {
  persons: 'Du und deine Frau',
  mealPattern: 'Intervallfasten, erste Mahlzeit kalt 11–12:30 Uhr, warm 17–18 Uhr',
  meat: 'Weitgehend kein Schweinefleisch',
  wheat: 'Wenig Weizen wegen des Blutzuckers',
  health: 'Blutzucker',
  calorieGoal: 'Kein Kalorienziel pro Person',
};
const KNOWN_EXTRA = ['Eine warme Mahlzeit am Tag', 'Lieblingsgerichte tragt ihr selbst ein, lange nicht Gegessenes wird ab und zu vorgeschlagen',
  'Hackfleisch wird oft eingefroren', 'Küche: Herd mit Töpfen, Pfannen, Backofen, Ninja Foodi MAX', 'Einkauf fast nur bei Lidl'];
const AGE = [['18-30', 25, '18–30'], ['31-50', 40, '31–50'], ['51-65', 58, '51–65'], ['65+', 70, 'über 65']];

const MEAL_PATTERNS = {
  fasten: { fasting: true,  meals: { breakfast: { from: '11:00', to: '12:30', warm: false }, dinner: { from: '17:00', to: '18:00', warm: true } } },
  drei:   { fasting: false, meals: { breakfast: { from: '07:00', to: '08:00', warm: false }, lunch: { from: '12:00', to: '13:00', warm: true }, dinner: { from: '18:00', to: '19:00', warm: false } } },
  abend:  { fasting: false, meals: { breakfast: { from: '07:00', to: '08:00', warm: false }, lunch: { from: '12:00', to: '13:00', warm: false }, dinner: { from: '18:00', to: '19:00', warm: true } } },
};

export function getProfile() {
  try { return { ...DEFAULT_PROFILE, ...(JSON.parse(localStorage.getItem(KEY)) ?? {}) }; }
  catch { return { ...DEFAULT_PROFILE }; }
}
function saveProfile(p) { localStorage.setItem(KEY, JSON.stringify(p)); }

// Fragen. type: single (ein Tipp = weiter) | multi (Mehrfachauswahl, optional eigene Einträge)
const STEPS = [
  { type: 'info', title: 'Lernen wir uns kennen', text: 'Ein paar Fragen zum Antippen, damit der Essensplan zu euch passt. Dauert etwa 2 Minuten. Einiges habe ich schon vorausgefüllt, ihr könnt alles ändern und später jederzeit im Tab „Küche“ anpassen.' },
  { type: 'known', title: 'Das weiß ich schon', text: 'Aus unseren bisherigen Gesprächen. Es ist in den nächsten Fragen vorausgewählt und mit „✓ schon bekannt“ markiert. Ihr könnt es dort bestätigen oder ändern.' },
  { key: 'persons', type: 'single', title: 'Für wie viele Personen kocht ihr?', options: [[1, '1 Person'], [2, '2 Personen'], [3, '3 Personen'], [4, '4 oder mehr']] },
  { key: 'people', type: 'people', title: 'Wer seid ihr?', text: 'Für die Nährstoff-Richtwerte (D-A-CH). Name ist freiwillig.' },
  { key: 'mealPattern', type: 'single', title: 'Wie esst ihr über den Tag?', options: [
    ['fasten', 'Intervallfasten: kalt 11–12:30 Uhr, warm 17–18 Uhr'],
    ['abend', 'Frühstück, Mittag kalt, Abendessen warm'],
    ['drei', 'Frühstück, Mittag warm, Abendbrot kalt']] },
  { key: 'meat', type: 'single', title: 'Wie haltet ihr es mit Fleisch?', options: [
    ['alles', 'Wir essen alles'], ['wenig-schwein', 'Weitgehend ohne Schwein'], ['kein-schwein', 'Gar kein Schwein'],
    ['pescetarisch', 'Kein Fleisch, aber Fisch'], ['vegetarisch', 'Vegetarisch']] },
  { key: 'wheat', type: 'single', title: 'Weizen und Getreide?', text: 'Hinweis: Dinkel ist botanisch eine Weizenart.', options: [
    ['meiden', 'Weizen möglichst meiden'], ['vollkorn', 'Lieber Vollkorn'], ['egal', 'Ist uns egal']] },
  { key: 'health', type: 'multi', title: 'Gibt es gesundheitlich etwas zu beachten?', text: 'Mehrfachauswahl. Die App gibt Hinweise, ersetzt aber keine ärztliche Beratung.', options: [
    ['blutzucker', 'Blutzucker stabil halten'], ['darm', 'Darmschonend'], ['salzarm', 'Wenig Salz'], ['cholesterin', 'Wenig gesättigte Fette']] },
  { key: 'allergies', type: 'multi', title: 'Allergien oder Unverträglichkeiten?', custom: true, options: [
    'Laktose', 'Gluten', 'Nüsse', 'Erdnüsse', 'Ei', 'Fisch', 'Meeresfrüchte', 'Soja', 'Sellerie', 'Senf'] },
  { key: 'priorities', type: 'multi', title: 'Worauf legt ihr Wert?', text: 'Mehrfachauswahl.', options: [
    ['gemuese', 'Viel Gemüse'], ['eiweiss', 'Viel Eiweiß'], ['ballaststoffe', 'Viele Ballaststoffe'], ['schnell', 'Schnell gekocht'],
    ['guenstig', 'Günstig'], ['reste', 'Nichts wegwerfen'], ['abwechslung', 'Viel Abwechslung'], ['saisonal', 'Saisonal und regional']] },
  { key: 'dislikes', type: 'multi', title: 'Was geht gar nicht?', text: 'Tippt alles an, was nie auf den Plan soll.', custom: true, options: [
    'Pilze', 'Rosenkohl', 'Leber', 'Innereien', 'Oliven', 'Koriander', 'Rote Bete', 'Fenchel', 'Kapern', 'Meeresfrüchte', 'Lamm', 'Aubergine', 'Sellerie', 'Rosinen'] },
  { key: 'favorites', type: 'multi', title: 'Was esst ihr besonders gern?', text: 'Lieblingsgerichte kommen öfter, und lange nicht Gegessenes wird ab und zu vorgeschlagen.', custom: true, options: [
    'Pfannkuchen', 'Spaghetti Bolognese', 'Chili con Carne', 'Lasagne', 'Hähnchen-Gemüse-Pfanne', 'Ofengemüse', 'Gemüsecurry', 'Frikadellen',
    'Lachs mit Gemüse', 'Burger', 'Wraps', 'Suppe / Eintopf', 'Rührei / Omelett', 'Kartoffelauflauf', 'Hähnchenschenkel aus dem Ninja'] },
  { key: 'cuisines', type: 'multi', title: 'Welche Küchen mögt ihr?', options: [
    'Deutsch', 'Italienisch', 'Asiatisch', 'Indisch', 'Mexikanisch', 'Türkisch / Orient', 'Griechisch', 'Amerikanisch'] },
  { key: 'cookTime', type: 'single', title: 'Wie viel Zeit fürs warme Essen an normalen Tagen?', options: [[15, 'Bis 15 Minuten'], [30, 'Bis 30 Minuten'], [45, 'Bis 45 Minuten'], [60, 'Eine Stunde ist okay']] },
  { key: 'spice', type: 'single', title: 'Wie scharf darf es sein?', options: [['mild', 'Mild'], ['mittel', 'Mittel'], ['scharf', 'Gern scharf']] },
  { key: 'leftovers', type: 'single', title: 'Doppelt kochen und am nächsten Tag Reste essen?', options: [[true, 'Ja, gern'], [false, 'Lieber jeden Tag frisch']] },
  { key: 'thawReminder', type: 'single', title: 'Wann sollen wir ans Auftauen erinnern?', text: 'Am Abend vor dem Tag, an dem Tiefgekühltes auf dem Plan steht.', options: [['18:00', '18 Uhr'], ['19:00', '19 Uhr'], ['20:00', '20 Uhr'], ['21:00', '21 Uhr']] },
  { key: 'calorieGoal', type: 'single', title: 'Wollt ihr ein Kalorienziel?', options: [[null, 'Nein, nur anzeigen'], ['abnehmen', 'Ja, leicht abnehmen'], ['halten', 'Ja, Gewicht halten']] },
  { type: 'summary', title: 'Passt das so?' },
];

const QUESTIONS = STEPS.filter(s => s.key);
const LABEL = {};
for (const s of STEPS) for (const o of s.options ?? []) { const [v, l] = Array.isArray(o) ? o : [o, o]; LABEL[s.key + ':' + v] = l; }
const labelOf = (key, v) => LABEL[key + ':' + v] ?? v;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = s => document.querySelector(s);

export function profileSummary(p = getProfile()) {
  const list = (key) => (p[key] ?? []).length ? p[key].map(v => esc(labelOf(key, v))).join(', ') : 'nichts';
  return `<dl class="profile-sum">
    <dt>Personen</dt><dd>${p.persons}${(p.people ?? []).length ? ': ' + p.people.map((x, k) => esc(x.name || 'Person ' + (k + 1)) + ` (${x.sex === 'w' ? 'Frau' : x.sex === 'm' ? 'Mann' : '?'}, ${esc(x.ageBand)}, ${esc(x.activity)})`).join('; ') : ''}</dd>
    <dt>Tagesablauf</dt><dd>${esc(labelOf('mealPattern', p.mealPattern))}</dd>
    <dt>Fleisch</dt><dd>${esc(labelOf('meat', p.meat))}</dd>
    <dt>Getreide</dt><dd>${esc(labelOf('wheat', p.wheat))}</dd>
    <dt>Gesundheit</dt><dd>${list('health')}</dd>
    <dt>Allergien</dt><dd>${list('allergies')}</dd>
    <dt>Wichtig</dt><dd>${list('priorities')}</dd>
    <dt>Geht gar nicht</dt><dd>${list('dislikes')}</dd>
    <dt>Lieblingsessen</dt><dd>${list('favorites')}</dd>
    <dt>Küchen</dt><dd>${list('cuisines')}</dd>
    <dt>Kochzeit</dt><dd>${esc(labelOf('cookTime', p.cookTime))}</dd>
    <dt>Schärfe</dt><dd>${esc(labelOf('spice', p.spice))}</dd>
    <dt>Reste</dt><dd>${esc(labelOf('leftovers', p.leftovers))}</dd>
    <dt>Auftau-Erinnerung</dt><dd>${esc(labelOf('thawReminder', p.thawReminder))} am Vorabend</dd>
    <dt>Kalorienziel</dt><dd>${esc(labelOf('calorieGoal', p.calorieGoal))}</dd>
  </dl>`;
}

// Startet den Assistenten. Liefert ein Promise, das beim Abschluss oder Abbruch erfüllt wird.
export function runWizard() {
  return new Promise(resolve => {
    const p = getProfile();
    let i = 0;
    const box = $('#wizard');
    box.classList.remove('hidden');

    const render = () => {
      const s = STEPS[i];
      const val = p[s.key];
      let body = '';
      const knownTag = KNOWN[s.key] ? `<p class="wz-known">✓ schon bekannt: ${esc(KNOWN[s.key])}</p>` : '';
      if (s.type === 'known') {
        body = `<ul class="wz-known-list">${[...Object.values(KNOWN), ...KNOWN_EXTRA].map(k => `<li>✓ ${esc(k)}</li>`).join('')}</ul>`;
      } else if (s.type === 'people') {
        const n = Math.max(1, p.persons || 1);
        p.people = Array.from({ length: n }, (_, k) => p.people?.[k] ?? { name: '', ageBand: '31-50', age: 40, sex: null, activity: 'mittel' });
        const seg = (k, field, opts) => `<div class="seg wz-seg">${opts.map(([v, l]) =>
          `<button class="${p.people[k][field] === v ? 'active' : ''}" data-person="${k}" data-field="${field}" data-val="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
        body = p.people.map((pp, k) => `<div class="wz-person">
          <input class="wz-name" data-person="${k}" placeholder="Person ${k + 1} (Name, freiwillig)" value="${esc(pp.name)}">
          ${seg(k, 'sex', [['w', 'Frau'], ['m', 'Mann']])}
          ${seg(k, 'ageBand', AGE.map(([v, , l]) => [v, l]))}
          ${seg(k, 'activity', [['niedrig', 'wenig aktiv'], ['mittel', 'normal'], ['hoch', 'sehr aktiv']])}
        </div>`).join('');
      } else if (s.type === 'single') {
        body = knownTag + `<div class="wz-options">${s.options.map(([v, l], n) =>
          `<button class="wz-opt ${JSON.stringify(v) === JSON.stringify(val) ? 'sel' : ''}" data-n="${n}">${esc(l)}${KNOWN[s.key] && JSON.stringify(v) === JSON.stringify(DEFAULT_PROFILE[s.key]) ? ' <small>✓ bekannt</small>' : ''}</button>`).join('')}</div>`;
      } else if (s.type === 'multi') {
        const opts = s.options.map(o => Array.isArray(o) ? o : [o, o]);
        for (const v of val ?? []) if (!opts.some(([x]) => x === v)) opts.push([v, v]); // eigene Einträge
        body = knownTag + `<div class="wz-chips">${opts.map(([v, l]) =>
          `<button class="chip ${(val ?? []).includes(v) ? 'sel' : ''}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>
          ${s.custom ? `<div class="toolbar wz-custom"><input id="wz-new" placeholder="Eigenes ergänzen …"><button id="wz-add">＋</button></div>` : ''}`;
      } else if (s.type === 'summary') {
        body = profileSummary(p);
      }
      const isLast = i === STEPS.length - 1;
      box.innerHTML = `<div class="wz-card">
        <div class="wz-progress"><div style="width:${Math.round(i / (STEPS.length - 1) * 100)}%"></div></div>
        <p class="muted wz-step">${QUESTIONS.includes(s) ? `Frage ${QUESTIONS.indexOf(s) + 1} von ${QUESTIONS.length}` : ''}</p>
        <h2>${esc(s.title)}</h2>
        ${s.text ? `<p class="muted">${esc(s.text)}</p>` : ''}
        ${body}
        <div class="wz-nav">
          ${i > 0 ? '<button id="wz-back">Zurück</button>' : '<button id="wz-later">Später</button>'}
          ${s.type === 'single' ? (val !== undefined ? '<button id="wz-next">Weiter</button>' : '') :
            `<button id="wz-next" class="primary">${isLast ? 'Fertig' : i === 0 ? 'Los geht’s' : s.type === 'known' ? 'Verstanden, weiter' : 'Weiter'}</button>`}
        </div>
      </div>`;
    };
    const finish = (done) => {
      if (done) { p.done = true; Object.assign(p, MEAL_PATTERNS[p.mealPattern] ?? {}); saveProfile(p); }
      box.classList.add('hidden'); box.innerHTML = '';
      box.removeEventListener('click', onClick);
      resolve(done);
    };
    const onClick = e => {
      const s = STEPS[i];
      const t = e.target.closest('button'); if (!t) return;
      if (t.id === 'wz-later') return finish(false);
      if (t.id === 'wz-back') { i--; return render(); }
      if (t.id === 'wz-next') { if (i === STEPS.length - 1) return finish(true); i++; saveProfile(p); return render(); }
      if (t.classList.contains('wz-opt')) { p[s.key] = s.options[+t.dataset.n][0]; i++; saveProfile(p); return render(); }
      if (t.dataset.field) {
        const pp = p.people[+t.dataset.person], f = t.dataset.field;
        pp[f] = t.dataset.val;
        if (f === 'ageBand') pp.age = AGE.find(a => a[0] === t.dataset.val)[1];
        t.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === t)); return;
      }
      if (t.classList.contains('chip')) {
        const v = t.dataset.v, arr = p[s.key] ?? [];
        p[s.key] = arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
        t.classList.toggle('sel'); return;
      }
      if (t.id === 'wz-add') {
        const n = $('#wz-new').value.trim(); if (!n) return;
        if (!(p[s.key] ?? []).includes(n)) p[s.key] = [...(p[s.key] ?? []), n];
        return render();
      }
    };
    box.addEventListener('click', onClick);
    box.addEventListener('input', e => { if (e.target.classList.contains('wz-name')) p.people[+e.target.dataset.person].name = e.target.value.trim(); });
    box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'wz-new') $('#wz-add').click(); });
    render();
  });
}
