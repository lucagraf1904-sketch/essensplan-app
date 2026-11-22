// Dienstplan pro Person (Luca 22.11.2026; gedacht u. a. für Schichtdienst in der Altenpflege).
// Gespeichert unter 'speisekammer.shifts' = { Name: { 'JJJJ-MM-TT': 'F' | 'S' | 'N' | 'X' } } (Haushalt).
// Schichtzeiten sind Annahmen (übliche Pflegezeiten) und in den Einstellungen änderbar.
//
// Quellen Nachtschicht (abgerufen 22.11.2026):
// - DGE, DGEwissen 3/2024 „Ernährung bei Schichtarbeit“: vor der Nachtschicht leichtes Abendessen, gegen Mitternacht kleiner leichter Snack,
//   1–6 Uhr möglichst nichts, morgens leichtes Frühstück; 4 h vor dem Schlafen kein Koffein.
// - gesundheit.gv.at „Gesunde Ernährung bei Nachtschicht“ (Stand 10.11.2020): ausgewogenes, leichtes Abendessen vor der Schicht; fettarm;
//   zweite kleine Mahlzeit etwa 2 h vor Schichtende; keine süßen/salzigen Automaten-Snacks.
// - AOK „Gesünder essen in der Nachtschicht“ (Stand 28.05.2024): Mitnehm-Ideen Gemüsesuppe, Gemüse-Wrap, Joghurt mit Beeren,
//   Salat mit Hülsenfrüchten, belegtes Vollkornbrötchen; kleine Portionen.
// Für Früh- und Spätschicht nennen diese Quellen keine Uhrzeit für die Hauptmahlzeit, nur einen festen Rhythmus.
// Die Zeiten unten (Spätschicht: warm vor Dienstbeginn) sind daher eine Annahme.
import { isoLocal } from './categories.js';

const KEY = 'speisekammer.shifts';
export const SHIFTS = {
  F: { label: 'Früh', icon: '🌅', from: '06:00', to: '14:00' },
  S: { label: 'Spät', icon: '🌇', from: '13:30', to: '21:30' },
  N: { label: 'Nacht', icon: '🌙', from: '21:00', to: '06:30' },
  X: { label: 'Frei', icon: '🏠' },
};
export const SHIFT_ORDER = ['', 'F', 'S', 'N', 'X'];
export const SOURCES = 'DGE (DGEwissen 3/2024), gesundheit.gv.at (Stand 10.11.2020), AOK (Stand 28.05.2024)';

export function loadShifts() { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } }
export function setShift(person, date, code) {
  const all = loadShifts(), p = { ...(all[person] ?? {}) };
  if (code) p[date] = code; else delete p[date];
  // alte Einträge (älter als 14 Tage) aufräumen
  const cut = isoLocal(new Date(Date.now() - 14 * 864e5));
  for (const d of Object.keys(p)) if (d < cut) delete p[d];
  all[person] = p; localStorage.setItem(KEY, JSON.stringify(all));
}
export const shiftOf = (person, date) => loadShifts()[person]?.[date] ?? '';
// Alle Personen mit Schicht an einem Tag: [{ person, code }]
export function shiftsOn(date) {
  return Object.entries(loadShifts()).map(([person, d]) => ({ person, code: d[date] })).filter(x => x.code && x.code !== 'X');
}

// Was bedeutet die Schicht fürs Essen? Hinweise für Plan und Erinnerung.
// opt: { noFridge, noMicrowave, dinnerAt }
export function mealAdvice(code, opt = {}) {
  const box = [];
  if (opt.noFridge) box.push('ohne Kühlung: nichts mit Fisch, Hack, Mayo oder Milchprodukten, besser Vollkornbrot, Gemüsesticks, Obst, Nüsse');
  if (opt.noMicrowave) box.push('ohne Mikrowelle: etwas, das kalt schmeckt (Salat mit Hülsenfrüchten, Wrap) oder Suppe in der Thermoskanne');
  switch (code) {
    case 'F': return { short: 'Frühschicht', main: null, eatAt: opt.dinnerAt,
      tips: ['Kleines Frühstück für die Pause einpacken (z. B. belegtes Vollkornbrötchen, Obst).'], box };
    case 'S': return { short: 'Spätschicht', main: '12:00', eatAt: '12:00', away: true,
      tips: ['Warme Hauptmahlzeit vor Dienstbeginn (gegen 12 Uhr, Annahme).', 'Für die Pause eine Dose mitnehmen: 1 Portion vom Vortag oder ein kaltes Gericht.'], box };
    case 'N': return { short: 'Nachtschicht', main: opt.dinnerAt, eatAt: opt.dinnerAt, light: true,
      tips: ['Vor der Schicht ein leichtes, ausgewogenes Abendessen (fettarm).', 'Gegen Mitternacht nur ein kleiner, leichter Snack; zwischen 1 und 6 Uhr möglichst nichts.',
        'Für die Dose: Gemüsesuppe, Salat mit Hülsenfrüchten, Joghurt mit Beeren oder ein Vollkornbrötchen, kleine Portionen.',
        'Nach der Schicht ein leichtes Frühstück, Koffein nur zu Schichtbeginn.'], box };
    default: return null;
  }
}
