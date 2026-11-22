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
