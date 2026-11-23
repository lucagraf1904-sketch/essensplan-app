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
const codeOf = v => typeof v === 'object' && v ? v.c : (v ?? '');
export const shiftOf = (person, date) => codeOf(loadShifts()[person]?.[date]);
// Alle Personen mit Schicht an einem Tag: [{ person, code }]
export function shiftsOn(date) {
  return Object.entries(loadShifts()).map(([person, d]) => ({ person, code: codeOf(d[date]) })).filter(x => x.code && x.code !== 'X');
}

// Eigene Zeiten je Person und Schichtart (Luca 23.11.: selbst eintragen, wann gegessen wird). Haushalt, 'speisekammer.shiftConf'.
// main = Hauptmahlzeit ('' = gemeinsames Abendessen), snack = Pause/Dose ('' = keine)
const CONF_KEY = 'speisekammer.shiftConf';
export const DEFAULT_CONF = {
  F: { from: '06:00', to: '14:00', main: '', snack: '09:30' },
  S: { from: '13:30', to: '21:30', main: '12:00', snack: '18:00' },
  N: { from: '21:00', to: '06:30', main: '', snack: '00:00' },
};
const loadConfAll = () => { try { return JSON.parse(localStorage.getItem(CONF_KEY)) ?? {}; } catch { return {}; } };
export function shiftConf(person, code) { return { ...DEFAULT_CONF[code], ...(loadConfAll()[person]?.[code] ?? {}) }; }
export function setShiftConf(person, code, field, value) {
  const all = loadConfAll(); all[person] = { ...(all[person] ?? {}) }; all[person][code] = { ...(all[person][code] ?? {}), [field]: value };
  localStorage.setItem(CONF_KEY, JSON.stringify(all));
}
// Zeiten nur für einen Tag (überschreibt die Schichtart)
export function setShiftDay(person, date, patch) {
  const all = loadShifts(), p = { ...(all[person] ?? {}) }, cur = p[date];
  const o = typeof cur === 'object' && cur ? { ...cur } : { c: cur };
  if (!o.c) return;
  Object.assign(o, patch); for (const k of Object.keys(o)) if (o[k] == null) delete o[k];
  p[date] = Object.keys(o).length === 1 ? o.c : o; all[person] = p; localStorage.setItem(KEY, JSON.stringify(all));
}
// Schicht eines Tages mit allen Zeiten: { code, from, to, main, snack, own } oder null
export function shiftDay(person, date) {
  const v = loadShifts()[person]?.[date], code = codeOf(v);
  if (!code || code === 'X') return null;
  const o = typeof v === 'object' && v ? v : {};
  const base = shiftConf(person, code);
  return { code, from: o.from ?? base.from, to: o.to ?? base.to, main: o.main ?? base.main, snack: o.snack ?? base.snack, own: Object.keys(o).length > 1 };
}

// Was bedeutet die Schicht fürs Essen? Nur Hinweise, die zur Schicht und den eigenen Zeiten passen.
// sd = shiftDay(...), opt: { noFridge, noMicrowave, dinnerAt }
export function mealAdvice(sd, opt = {}) {
  if (!sd) return null;
  const main = sd.main || opt.dinnerAt, tips = [], dose = [];
  if (sd.snack) {
    if (opt.noFridge) dose.push('ohne Kühlung: nichts mit Fisch, Hack, Mayo oder Milchprodukten; besser Vollkornbrot, Gemüsesticks, Obst, Nüsse');
    if (opt.noMicrowave) dose.push('ohne Mikrowelle: etwas, das kalt schmeckt (Salat mit Hülsenfrüchten, Wrap) oder Suppe in der Thermoskanne');
  }
  if (sd.code === 'F') {
    if (sd.snack) tips.push(`Pause gegen ${sd.snack}: kleines Frühstück einpacken, z. B. belegtes Vollkornbrötchen und Obst.`);
  } else if (sd.code === 'S') {
    if (sd.main && sd.main < sd.from) tips.push(`Warm essen um ${sd.main}, vor Dienstbeginn um ${sd.from}.`);
    if (sd.snack) tips.push(`Dose für die Pause gegen ${sd.snack}: 1 Portion vom Vortag oder etwas Kaltes.`);
  } else if (sd.code === 'N') {
    tips.push(`Vor der Schicht (${main}) leicht und fettarm essen.`);
    if (sd.snack) tips.push(`Gegen ${sd.snack} nur ein kleiner, leichter Snack (z. B. Gemüsesuppe, Joghurt mit Beeren, Vollkornbrötchen); zwischen 1 und 6 Uhr möglichst nichts.`);
    tips.push('Nach der Schicht ein leichtes Frühstück; Koffein nur zu Schichtbeginn.');
  }
  return { short: SHIFTS[sd.code].label + 'schicht', main, tips: [...tips, ...dose.map(d => 'Dose ' + d)] };
}
