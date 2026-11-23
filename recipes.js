// Gerichte (Rezeptstamm) für den Essensplan. Gespeichert unter 'speisekammer.recipes' (Haushalt, eintragsweise abgeglichen).
// Eintrag: { id, store (nur Rezeptspeicher, nicht im Plan), title, kind, method, min, kcal, veg, need: [[Suchwort, Anzeigename]], ingredients, steps, url, tags, fav, paused, last, count, src }
// kind: rind | gefluegel | fisch | veggie | schwein | sonst. tags: leicht (z. B. vor der Nachtschicht), kalt (schmeckt kalt), mitnehmen (taugt für die Dose)
import { isoLocal, CATEGORIES } from './categories.js';

const KEY = 'speisekammer.recipes';
export const KINDS = { rind: 'Rind', gefluegel: 'Geflügel', fisch: 'Fisch', veggie: 'Vegetarisch', schwein: 'Schwein', sonst: 'Sonstiges' };
export const TAGS = { leicht: 'Leicht', kalt: 'Schmeckt kalt', mitnehmen: 'Für die Dose' };

// Beispielgerichte (zum Übernehmen, danach frei änderbar). kcal und Gemüse pro Portion sind grobe Schätzungen.
export const STARTERS = [
  { id: 'chili', title: 'Chili con Carne mit Reis', kind: 'rind', method: 'Ninja Druckgaren', min: 45, kcal: 650, veg: 250, tags: ['mitnehmen'],
    need: [['hack', 'Rinderhackfleisch'], ['paprika', 'Paprika'], ['bohnen', 'Kidneybohnen'], ['reis', 'Reis'], ['tomate', 'Gehackte Tomaten']], fromFrozenOk: true },
  { id: 'bolo', title: 'Vollkorn-Spaghetti Bolognese', kind: 'rind', method: 'Herd, Topf', min: 40, kcal: 700, veg: 200, tags: ['mitnehmen'],
    need: [['hack', 'Rinderhackfleisch'], ['spaghetti', 'Vollkorn-Spaghetti'], ['tomate', 'Passierte Tomaten'], ['möhre', 'Möhren']] },
  { id: 'lachs', title: 'Lachs mit Ofengemüse', kind: 'fisch', method: 'Backofen 180 °C', min: 35, kcal: 560, veg: 300, tags: ['leicht'],
    need: [['lachs', 'Lachsfilet'], ['paprika', 'Paprika'], ['zucchini', 'Zucchini'], ['kartoffel', 'Kartoffeln']] },
  { id: 'seelachs', title: 'Seelachs mit Spinat und Kartoffeln', kind: 'fisch', method: 'Pfanne + Topf', min: 30, kcal: 480, veg: 250, tags: ['leicht'],
    need: [['seelachs', 'Seelachsfilet (TK)'], ['spinat', 'Spinat (TK)'], ['kartoffel', 'Kartoffeln']], fromFrozenOk: true },
  { id: 'haehnchen-curry', title: 'Hähnchen-Curry mit Reis', kind: 'gefluegel', method: 'Ninja Druckgaren', min: 35, kcal: 620, veg: 250, tags: ['mitnehmen'],
    need: [['hähnchen', 'Hähnchenbrustfilet'], ['paprika', 'Paprika'], ['kokos', 'Kokosmilch'], ['reis', 'Reis']] },
  { id: 'haehnchen-ninja', title: 'Hähnchen aus dem Ninja mit Brokkoli', kind: 'gefluegel', method: 'Ninja Heißluft 180 °C + Dämpfen', min: 30, kcal: 520, veg: 300, tags: ['leicht'],
    need: [['hähnchen', 'Hähnchenbrustfilet'], ['brokkoli', 'Brokkoli'], ['kartoffel', 'Kartoffeln']] },
  { id: 'gulasch', title: 'Rindergulasch mit Kartoffeln', kind: 'rind', method: 'Ninja Schmoren', min: 75, kcal: 640, veg: 150, tags: ['mitnehmen'],
    need: [['gulasch', 'Rindergulasch'], ['zwiebel', 'Zwiebeln'], ['paprika', 'Paprika'], ['kartoffel', 'Kartoffeln']] },
  { id: 'linsen', title: 'Linsen-Gemüse-Suppe', kind: 'veggie', method: 'Ninja Druckgaren', min: 75, kcal: 450, veg: 350, tags: ['leicht', 'mitnehmen'],
    need: [['linsen', 'Rote Linsen'], ['möhre', 'Möhren'], ['kartoffel', 'Kartoffeln'], ['lauch', 'Lauch']] },
  { id: 'omelett', title: 'Gemüse-Omelett mit Roggenbrot', kind: 'veggie', method: 'Pfanne', min: 20, kcal: 520, veg: 250, tags: ['leicht'],
    need: [['eier', 'Eier'], ['paprika', 'Paprika'], ['spinat', 'Spinat (TK)'], ['gouda', 'Gouda'], ['roggen', 'Roggen-Vollkornbrot']] },
  { id: 'pfannkuchen', title: 'Dinkel-Vollkorn-Pfannkuchen mit Apfel', kind: 'veggie', method: 'Pfanne', min: 30, kcal: 600, veg: 150, tags: ['kalt'],
    need: [['eier', 'Eier'], ['milch', 'Milch'], ['äpfel', 'Äpfel'], ['mehl', 'Dinkel-Vollkornmehl']] },
  { id: 'putenpfanne', title: 'Putengeschnetzeltes mit Champignons und Reis', kind: 'gefluegel', method: 'Pfanne', min: 30, kcal: 580, veg: 250, tags: ['leicht', 'mitnehmen'],
    need: [['pute', 'Putengeschnetzeltes'], ['champignon', 'Champignons'], ['reis', 'Reis']] },
  { id: 'ofenkartoffel', title: 'Ofenkartoffeln mit Quark und Gurkensalat', kind: 'veggie', method: 'Backofen 180 °C', min: 50, kcal: 500, veg: 250, tags: ['leicht'],
    need: [['kartoffel', 'Kartoffeln'], ['quark', 'Magerquark'], ['gurke', 'Gurke']] },
  { id: 'linsensalat', title: 'Linsensalat mit Feta und Gemüse', kind: 'veggie', method: 'Herd, Topf', min: 25, kcal: 480, veg: 250, tags: ['leicht', 'kalt', 'mitnehmen'],
    need: [['linsen', 'Linsen'], ['feta', 'Feta'], ['paprika', 'Paprika'], ['gurke', 'Gurke']] },
  { id: 'nudelsalat', title: 'Vollkorn-Nudelsalat mit Hähnchen und Gemüse', kind: 'gefluegel', method: 'Herd, Topf + Pfanne', min: 30, kcal: 560, veg: 200, tags: ['kalt', 'mitnehmen'],
    need: [['nudel', 'Vollkorn-Nudeln'], ['hähnchen', 'Hähnchenbrustfilet'], ['paprika', 'Paprika'], ['erbsen', 'Erbsen (TK)']] },
];

const uid = () => crypto.randomUUID?.() ?? String(Date.now() + Math.random());
export function loadRecipes() { try { return JSON.parse(localStorage.getItem(KEY)) ?? []; } catch { return []; } }
export function saveRecipes(l) { localStorage.setItem(KEY, JSON.stringify(l)); }
// Im Plan = nicht pausiert und nicht nur im Rezeptspeicher (store: true)
export const activeRecipes = () => loadRecipes().filter(r => !r.paused && !r.store);
export function addStarters() {
  const l = loadRecipes(), have = new Set(l.map(r => r.id));
  saveRecipes([...l, ...STARTERS.filter(s => !have.has(s.id)).map(s => ({ ...s, src: 'start' }))]);
}
export function upsertRecipe(r) {
  const l = loadRecipes(), i = l.findIndex(x => x.id === r.id);
  if (i >= 0) l[i] = { ...l[i], ...r }; else l.push({ id: uid(), src: 'own', tags: [], need: [], ...r });
  saveRecipes(l); return r;
}
export function updateRecipe(id, fn) { const l = loadRecipes(), r = l.find(x => x.id === id); if (!r) return; fn(r); saveRecipes(l); }
export function deleteRecipe(id) { saveRecipes(loadRecipes().filter(r => r.id !== id)); }
export function markCooked(id, date = isoLocal()) { updateRecipe(id, r => { r.last = date; r.count = (r.count ?? 0) + 1; }); }

// ---------- Zutaten auswerten (für Import und eigene Gerichte) ----------
const UNITS = /^(ca\.?|etwa|\d+([.,/]\d+)?|½|¼|¾|\d+-\d+|g|gr|kg|ml|l|el|tl|esslöffel|teelöffel|prise|prisen|stk|stück|dose|dosen|pck|päckchen|packung|bund|zehe|zehen|stange|stangen|zweig|zweige|knolle|knollen|kopf|köpfe|scheibe|scheiben|becher|tasse|tassen|glas|handvoll|msp|etwas|n\.?\s?b\.?|nach|bedarf|große?n?|kleine?n?|mittelgroße?n?|frische?n?|gehackte?n?)$/i;
const GENERIC = new Set(['fleisch', 'filet', 'brust', 'schote', 'pulver', 'sauce', 'soße', 'würfel', 'scheiben', 'frisch', 'gemüse', 'obst']);
const STOP = new Set(['und', 'oder', 'mit', 'von', 'zum', 'zur', 'für', 'in', 'aus', 'à', 'a', 'z.b.', 'evtl.', 'optional']);
// "500 g Rinderhackfleisch, mager" → ['rinderhack', 'Rinderhackfleisch']
export function needFromLine(line) {
  const clean = line.replace(/\(.*?\)/g, ' ').split(/[,;]/)[0].replace(/\s+/g, ' ').trim();
  const words = clean.split(' ').filter(w => w && !UNITS.test(w) && !STOP.has(w.toLowerCase()));
  const name = words.join(' ').replace(/^[^A-Za-zÄÖÜäöüß]+/, '').trim();
  if (!name || name.length < 2) return null;
  // Suchwort: Hauptwort (letztes großgeschriebenes Wort), gekürzt auf den Wortstamm
  // Bekanntes Stichwort aus categories.js (z. B. „paprika“ in „rote Paprikaschoten“) hat Vorrang
  const low = name.toLowerCase();
  const known = Object.values(CATEGORIES).flatMap(c => c.words ?? []).map(w => w.trim()).filter(w => w.length >= 4 && !GENERIC.has(w) && low.includes(w)).sort((a, b) => (low.lastIndexOf(b) + b.length) - (low.lastIndexOf(a) + a.length) || b.length - a.length)[0];
  if (known) return [known, name];
  const main = (words.filter(w => /^[A-ZÄÖÜ]/.test(w)).pop() ?? words[0]).toLowerCase().replace(/[^a-zäöüß-]/g, '');
  const stem = main.replace(/(fleisch|filets?|n|en|e|s)$/, '') || main;
  return [stem.length >= 4 ? stem : main, name];
}
// Eingefügter Rezepttext (z. B. aus einer Webseite kopiert): erste Zeile Titel, Zeilen mit Mengen = Zutaten, Rest = Schritte
export function parseRecipeText(text) {
  const lines = text.split(/\r?\n/).map(l => l.replace(/^[•\-*–\d]+[.)]?\s(?=\D)/, m => /^\d/.test(m) ? m : '').trim()).filter(Boolean);
  if (!lines.length) return null;
  const title = lines[0].slice(0, 80), ingredients = [], steps = [];
  let min = null;
  for (const l of lines.slice(1)) {
    const t = l.match(/(\d+)\s*(min|minuten)\b/i), h = l.match(/(\d+(?:[.,]\d)?)\s*(std|stunden?)\b/i);
    if (/zeit|dauer|gesamt/i.test(l) && (t || h)) { min = (h ? Math.round(parseFloat(h[1].replace(',', '.')) * 60) : 0) + (t ? +t[1] : 0); continue; }
    if (/^zutaten|^zubereitung|^anleitung|^schritt/i.test(l) && l.length < 25) continue;
    if (l.length < 60 && /^(\d|½|¼|¾|ca\.|etwas|1 prise|prise|salz|pfeffer)/i.test(l)) ingredients.push(l); else if (l.length >= 20) steps.push(l);
  }
  return { title, ingredients, steps, min };
}
// Art aus den Zutaten schätzen
export function guessKind(names) {
  const t = names.join(' ').toLowerCase();
  if (/schwein|speck|bacon|schinken|salami|bratwurst|gemischtes hack/.test(t)) return 'schwein';
  if (/lachs|fisch|seelachs|thunfisch|forelle|garnele|kabeljau|hering|makrele/.test(t)) return 'fisch';
  if (/hähnchen|huhn|pute|geflügel|chicken/.test(t)) return 'gefluegel';
  if (/rind|hack|gulasch|steak|lamm|wild/.test(t)) return 'rind';
  return 'veggie';
}
export function recipeFromParts({ title, ingredients = [], steps = [], min = null, url = null, servings = null }) {
  const need = ingredients.map(needFromLine).filter(Boolean).filter(([w]) => !/^(salz|pfeffer|wasser|öl|zucker)$/.test(w)).slice(0, 12);
  return { title: title?.trim() || 'Neues Gericht', kind: guessKind(need.map(n => n[1])), method: '', min: min || 30, need, ingredients, steps, url, servings, tags: [] };
}
