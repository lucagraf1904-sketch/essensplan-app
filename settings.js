// Einstellungen zum Antippen. Gespeichert pro Gerät in localStorage (Supabase folgt).
const KEY = 'speisekammer.settings';

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
  askLeftovers: true,     // Nach dem Abendessen fragen: alles aufgegessen? Was passiert mit dem Rest?
  planHealthRules: true, // Fisch- und Fleischquoten im Essensplan (Schalter erscheint, sobald der Planer gebaut ist)
};

export function getSettings() {
  try { return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(KEY)) ?? {}) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export function setSetting(k, v) {
  const s = getSettings(); s[k] = v;
  localStorage.setItem(KEY, JSON.stringify(s));
  return s;
}
// Ist ein Tipp-Thema aktiv? (Hauptschalter UND Themenschalter)
export function tipsOn(topic) {
  const s = getSettings();
  return s.tips && s[topic] !== false;
}

// Anzeige-Stufen: setzen alle Anzeige-Schalter (plus Tipps und „Wieder kaufen?“) auf einmal
export const SHOW_KEYS = ['showQty','showCategory','showLocation','showPack','showOpened','showFrozenDetail','showExpiryBadge','showExpiryDate','showPrice','showWarnBox',
  'showGoodNote','showOfferTags','showDeals','showCheck','showBalHints','showBalCompare','showUnitPrice','showWaste','tips','shopSuggestions'];
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
  const s = { ...getSettings(), ...p }; localStorage.setItem(KEY, JSON.stringify(s)); return s;
}
