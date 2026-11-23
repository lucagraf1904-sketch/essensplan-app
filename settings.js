// Einstellungen zum Antippen.
// Zwei Ebenen (Luca 22.11.2026): Haushalt (gilt für alle, mit Supabase geteilt) und persönlich (diese Person/dieses Handy).
// Persönliche Werte überschreiben den Haushalts-Standard. Anzeige: eigene Auswahl möglich, sonst gilt der Haushalts-Standard.
const KEY = 'speisekammer.settings', HH_KEY = 'speisekammer.hhSettings';

export const DEFAULT_SETTINGS = {
  tips: true,            // Hauptschalter für alle Tipps und Hinweise
  tipsBread: true,       // Brot, Mehl, Frühstück
  tipsProduce: true,     // Obst und Gemüse
  tipsProcessed: true,   // Fertigprodukte, Wurst
  tipsMeat: true,        // Fleisch (Inhalte folgen mit der Fleisch-Recherche)
  askFreeze: true,       // Bei Fleisch/Fisch fragen, ob eingefroren wird
  shopSuggestions: true, // „Wieder kaufen?“-Vorschläge auf der Einkaufsliste
  remindExpiry: true,    // Erinnerung: Artikel laufen bald ab
  expiryTime: '16:00',
  remindDinner: true,    // Erinnerung ans Abendessen (Luca: 16 Uhr voreingestellt)
  dinnerTime: '16:00',   // feste Zeit bzw. Rückfall, wenn kein Gericht geplant ist
  dinnerAuto: true,      // Erinnerung = Essenszeit minus Zubereitungszeit des geplanten Gerichts
  dinnerAt: '17:00',     // geplante Essenszeit
  autoOffers: true,      // Angebote automatisch suchen (Marktguru, inoffiziell; braucht Supabase)
  homeStore: 'lidl',     // Stammladen für den Preisvergleich
  maxStores: 2,          // Luca 22.11.: höchstens zwei Läden pro Einkauf
  minSaving: 2,          // Luca 22.11.: zweiter Laden lohnt ab 2 €
  ownBrandOk: true,      // Luca 22.11.: gleichwertige Eigenmarke mit gleicher Menge zählt als gleich
  health: [],            // Gesundheit (freiwillig, nur auf diesem Gerät): crohn, diabetes, bluthochdruck, cholesterin, laktose, zoeliakie, reizdarm, schwanger
  prefs: [],             // Vorlieben: wenigWeizen, keinSchwein, vegetarisch, wenigFleisch
  drinks: 'a',           // Getränke-Umfang (Luca 22.11.): off | a Vorrat+Bilanz | b +kcal | c +Trinkzähler
  glassMl: 250,          // Trinkzähler: Glasgröße
  drinkGoalMl: 1500,     // Trinkzähler: Tagesziel (DGE-Richtwert 1,5 l laut Verbraucherzentrale)
  // Anzeige (Luca 22.11.): jede Zusatzinfo einzeln schaltbar, dazu Stufen Minimal/Normal/Alles
  showQty: true, showCategory: true, showLocation: true, showPack: true, showOpened: true, showFrozenDetail: true,
  showExpiryBadge: true, showExpiryDate: false, showPrice: false, showWarnBox: true,
  showGoodNote: true, showOfferTags: true, showDeals: true, showCheck: true,
  showBalHints: true, showBalCompare: true, showUnitPrice: true, showWaste: true,
  shopSort: 'aisle',     // Einkaufsliste: 'aisle' = nach Ladenweg, 'added' = wie eingetragen
  shopLayoutStore: '',   // Ladenweg für welchen Laden ('' = Stammladen)
  householdSize: 2,      // Personen im Haushalt (Einrichtung, für „pro Person“-Richtwerte)
  myName: '',            // Name dieser Person (für Dienstplan)
  weightOn: false,       // Gewichtstracker (Luca 22.11.: Schalter, standardmäßig aus)
  shiftsOn: false,       // Dienstplan für diese Person
  shiftTips: true,       // Tipps zur Schicht anzeigen (Luca 23.11.: abschaltbar)
  workNoFridge: false,   // Kein Kühlschrank am Arbeitsplatz
  workNoMicrowave: false,// Keine Mikrowelle am Arbeitsplatz
  budget: 0,             // Monatsbudget in € (0 = aus), Haushalt
  budgetWarnPct: 80,     // Warnung ab diesem Anteil
  askLeftovers: true,     // Nach dem Abendessen fragen: alles aufgegessen? Was passiert mit dem Rest?
  planExclude: [],       // Vom Nutzer selbst gewählte Ausschlüsse im Essensplan: [{ w: Suchwort, label, from }] (Haushalt)
  weekFish: 2, weekBeef: 1, weekVeg: 0, weekVegG: 0, // Wochenziele (Luca 23.11.): Fisch pro Woche, Rind höchstens, vegetarische Abende, Gemüse-g pro Abend
  planHealthRules: true, // Fisch- und Fleischquoten im Essensplan (Schalter erscheint, sobald der Planer gebaut ist)
};

const read = k => { try { return JSON.parse(localStorage.getItem(k)) ?? {}; } catch { return {}; } };
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

export function getSettings() { return { ...DEFAULT_SETTINGS, ...read(HH_KEY), ...read(KEY) }; }
export const isPersonal = k => PERSONAL_KEYS.includes(k);
export function setSetting(k, v) {
  if (isPersonal(k)) write(KEY, { ...read(KEY), [k]: v });
  else { write(HH_KEY, { ...read(HH_KEY), [k]: v }); const me = read(KEY); if (k in me) { delete me[k]; write(KEY, me); } }
  return getSettings();
}
// Ist ein Tipp-Thema aktiv? (Hauptschalter UND Themenschalter)
export function tipsOn(topic) {
  const s = getSettings();
  return s.tips && s[topic] !== false;
}

// Anzeige-Stufen: setzen alle Anzeige-Schalter (plus Tipps und „Wieder kaufen?“) auf einmal
export const SHOW_KEYS = ['showQty','showCategory','showLocation','showPack','showOpened','showFrozenDetail','showExpiryBadge','showExpiryDate','showPrice','showWarnBox',
  'showGoodNote','showOfferTags','showDeals','showCheck','showBalHints','showBalCompare','showUnitPrice','showWaste','tips','shopSuggestions'];
// Persönlich (pro Person): Anzeige, Tipps, Gesundheit, Erinnerungszeiten, Trinkzähler, Gewicht, Dienstplan-Rahmen
export const PERSONAL_KEYS = [...SHOW_KEYS, 'tipsBread', 'tipsProduce', 'tipsProcessed', 'tipsMeat', 'health',
  'remindExpiry', 'expiryTime', 'remindDinner', 'dinnerTime', 'dinnerAuto', 'glassMl', 'drinkGoalMl',
  'weightOn', 'myName', 'shiftsOn', 'shiftTips', 'workNoFridge', 'workNoMicrowave'];
const MINIMAL_ON = ['showQty', 'showExpiryBadge', 'showWarnBox'];
export const SHOW_PRESETS = {
  minimal: Object.fromEntries(SHOW_KEYS.map(k => [k, MINIMAL_ON.includes(k)])),
  normal: Object.fromEntries(SHOW_KEYS.map(k => [k, DEFAULT_SETTINGS[k]])),
  alles: Object.fromEntries(SHOW_KEYS.map(k => [k, true])),
};
export function showPreset(s = getSettings()) {
  return Object.entries(SHOW_PRESETS).find(([, p]) => SHOW_KEYS.every(k => !!s[k] === p[k]))?.[0] ?? 'eigene';
}
export function applyShowPreset(name) {
  const p = SHOW_PRESETS[name]; if (!p) return;
  write(KEY, { ...read(KEY), ...p }); return getSettings();
}
// Anzeige: hat diese Person eine eigene Auswahl? Als Standard für alle übernehmen / auf Standard zurücksetzen
export const hasOwnShow = () => SHOW_KEYS.some(k => k in read(KEY));
export function showToHousehold() {
  const me = read(KEY), hh = read(HH_KEY), s = getSettings();
  for (const k of SHOW_KEYS) { hh[k] = s[k]; delete me[k]; }
  write(HH_KEY, hh); write(KEY, me);
}
export function showReset() { const me = read(KEY); for (const k of SHOW_KEYS) delete me[k]; write(KEY, me); }

// Alte Geräte hatten alles persönlich gespeichert: Haushalts-Werte einmal umziehen
(function migrate() {
  const me = read(KEY), hh = read(HH_KEY), move = Object.keys(me).filter(k => !isPersonal(k));
  if (!move.length) return;
  for (const k of move) { if (!(k in hh)) hh[k] = me[k]; delete me[k]; }
  write(HH_KEY, hh); write(KEY, me);
})();
