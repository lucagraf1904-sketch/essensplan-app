// Reine Rechenfunktionen der Haushaltskasse (ohne DOM, ohne Datenbank), mit Tests in tests/budget.
// Geld wird intern in Cent (ganze Zahlen) gerechnet, damit 0,1 + 0,2 keine Rundungsfehler erzeugt.
// Datumswerte sind Texte 'YYYY-MM-DD' in lokaler Zeit (keine Zeitzonen-Verschiebung durch Date-Objekte in UTC).

// ---------- Geld ----------
export const toCents = v => (v == null || v === '' || !Number.isFinite(+v)) ? null : Math.round(+v * 100);
export const fromCents = c => Math.round(c) / 100;

// Liest deutsche und englische Schreibweisen: „12,50“, „12.5“, „1.234,56“, „1234“, „12,50 €“. Gibt Cent zurück oder null.
export function parseAmount(input) {
  let s = String(input ?? '').replace(/[€\s ]/g, '').replace(/^\+/, '');
  if (!s || /[^0-9.,]/.test(s)) return null;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? ',' : '.';
    s = s.split(dec === ',' ? '.' : ',').join('');
    s = s.replace(dec, '.');
  } else if (lastComma >= 0) {
    if ((s.match(/,/g) || []).length > 1) return null;
    s = s.replace(',', '.');
  } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ''); // „1.234“ = tausendzweihundertvierunddreißig
  }
  if (!/^\d*(\.\d{0,2})?$/.test(s) || s === '.' ) return null;
  const n = Math.round(parseFloat(s) * 100);
  return Number.isFinite(n) && n >= 0 && n < 1e11 ? n : null;
}

const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const EUR0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, minimumFractionDigits: 0 });
export const eur = cents => EUR.format(fromCents(cents ?? 0));
// Ganze Euro für Achsen und große Zahlen ab 1.000 €
export const eurShort = cents => Math.abs(cents) >= 100000 ? EUR0.format(Math.round(fromCents(cents))) : eur(cents);
export const amountInput = cents => cents == null ? '' : (fromCents(cents)).toFixed(2).replace('.', ',');

// ---------- Datum ----------
const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = (now = new Date()) => iso(now);
export const parseIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const isIso = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(parseIso(s)) === s;
export const daysInMonth = (y, m0) => new Date(y, m0 + 1, 0).getDate();
export function addDays(s, n) { const d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); }
// Monate addieren wie Postgres (date + interval): Monatsende wird abgeschnitten, 31.01. + 1 Monat = 28./29.02.
export function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const t = (y * 12 + (m - 1)) + n, ty = Math.floor(t / 12), tm = t - ty * 12;
  return `${ty}-${pad(tm + 1)}-${pad(Math.min(d, daysInMonth(ty, tm)))}`;
}
export const diffDays = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 86400000);

export const FREQS = {
  weekly: { label: 'wöchentlich', short: '/Woche', perMonth: 52 / 12 },
  monthly: { label: 'monatlich', short: '/Monat', perMonth: 1 },
  quarterly: { label: 'vierteljährlich', short: '/Quartal', perMonth: 1 / 3 },
  halfyearly: { label: 'halbjährlich', short: '/Halbjahr', perMonth: 1 / 6 },
  yearly: { label: 'jährlich', short: '/Jahr', perMonth: 1 / 12 },
};
// Fälligkeit Nummer n ab dem Startdatum (gleiche Regel wie budget_nth_due in supabase/budget.sql)
export function nthDue(start, freq, n) {
  switch (freq) {
    case 'weekly': return addDays(start, 7 * n);
    case 'monthly': return addMonths(start, n);
    case 'quarterly': return addMonths(start, 3 * n);
    case 'halfyearly': return addMonths(start, 6 * n);
    case 'yearly': return addMonths(start, 12 * n);
    default: throw new Error('Unbekannter Rhythmus: ' + freq);
  }
}
export const monthlyCents = r => Math.round(r.amount * (FREQS[r.freq]?.perMonth ?? 1));

// Kommende Fälligkeiten eines Fixkosten-Eintrags im Zeitraum [from, to] (beide inklusive), ab next_due
export function occurrences(r, from, to, max = 400) {
  if (!r.active) return [];
  const out = [];
  let k = r.n, d = r.nextDue;
  for (let i = 0; i < max && d <= to; i++) {
    if (r.endDate && d > r.endDate) break;
    if (d >= from) out.push(d);
    k++; d = nthDue(r.startDate, r.freq, k);
  }
  return out;
}

// Fixkosten fällig bis heute buchen (für die Demo ohne Server; der Server macht das in budget_book_due)
export function bookDueLocal(recurring, today, existingKeys = new Set()) {
  const txs = [];
  for (const r of recurring) {
    if (!r.active || r.nextDue > today) continue;
    let k = r.n, d = r.nextDue, guard = 0;
    while (d <= today && (!r.endDate || d <= r.endDate) && guard < 60) {
      const key = r.id + '|' + d;
      // aus einem Spartopf bezahlt: nicht vom Konto
      if (!existingKeys.has(key)) { txs.push({ date: d, amount: r.amount, kind: r.kind, category: r.category, note: r.name, source: 'recurring', recurringId: r.id, dueDate: d, potId: r.potId ?? null, owner: r.owner ?? null, accountId: r.payPotId ? null : r.accountId ?? null }); existingKeys.add(key); }
      k++; guard++; d = nthDue(r.startDate, r.freq, k);
    }
    r.n = k; r.nextDue = d; r.active = !r.endDate || d <= r.endDate;
  }
  return txs;
}

// Nächste Fälligkeit ab heute für ein Startdatum (Vorschlag im Formular)
export function nextFrom(start, freq, today) {
  let k = 0, d = start;
  while (d < today && k < 5000) { k++; d = nthDue(start, freq, k); }
  return d;
}

// ---------- Monate ----------
export const monthKey = s => s.slice(0, 7);
export function monthRange(key) {
  const [y, m] = key.split('-').map(Number);
  const days = daysInMonth(y, m - 1);
  return { from: `${key}-01`, to: `${key}-${pad(days)}`, days };
}
export const shiftMonth = (key, n) => addMonths(key + '-01', n).slice(0, 7);
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export const monthName = key => { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
export const monthShort = key => MONTHS_SHORT[+key.slice(5, 7) - 1];
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export function dayLabel(s, today) {
  if (s === today) return 'Heute';
  if (s === addDays(today, -1)) return 'Gestern';
  if (s === addDays(today, 1)) return 'Morgen';
  const d = parseIso(s);
  return `${WD[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}${d.getFullYear() !== parseIso(today).getFullYear() ? ' ' + d.getFullYear() : ''}`;
}
export const dateShort = s => { const d = parseIso(s); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
export const dateShortNoYear = s => { const d = parseIso(s); return `${d.getDate()}.${d.getMonth() + 1}.`; };

// Monatsübersicht. groupOf: Kategorie-ID → Gruppen-ID.
// Ergebnis in Cent: income, expense (gebucht), pendingIncome/pendingExpense (Fixkosten, die in diesem Monat noch kommen),
// saved/unsaved (in Spartöpfe gelegt bzw. herausgenommen), pendingSave (Sparraten, die noch kommen),
// free = income + pendingIncome + unsaved − expense − pendingExpense − saved − pendingSave, byGroup: Ausgaben je Gruppe.
// Sparen ist keine Ausgabe (zählt nicht in expense/byGroup), mindert aber, was frei ist.
export function monthSummary({ tx, recurring, key, today, groupOf }) {
  const { from, to, days } = monthRange(key);
  const s = { key, from, to, days, income: 0, expense: 0, fixedBooked: 0, pendingIncome: 0, pendingExpense: 0, saved: 0, unsaved: 0, pendingSave: 0, byGroup: {}, pendingByGroup: {}, pendingList: [] };
  for (const t of tx) {
    if (t.date < from || t.date > to) continue;
    if (t.kind === 'income') s.income += t.amount;
    else if (t.kind === 'save') s.saved += t.amount;
    else if (t.kind === 'unsave') s.unsaved += t.amount;
    else {
      s.expense += t.amount;
      if (t.recurringId) s.fixedBooked += t.amount;
      const g = groupOf(t.category); s.byGroup[g] = (s.byGroup[g] ?? 0) + t.amount;
    }
  }
  for (const r of recurring) {
    for (const d of occurrences(r, from, to)) {
      if (r.kind === 'income') s.pendingIncome += r.amount;
      else if (r.kind === 'save') s.pendingSave += r.amount;
      else { s.pendingExpense += r.amount; const g = groupOf(r.category); s.pendingByGroup[g] = (s.pendingByGroup[g] ?? 0) + r.amount; }
      s.pendingList.push({ date: d, r });
    }
  }
  s.pendingList.sort((a, b) => a.date.localeCompare(b.date));
  s.plannedIncome = s.income + s.pendingIncome;
  s.free = s.plannedIncome + s.unsaved - s.expense - s.pendingExpense - s.saved - s.pendingSave;
  // Tage bis Monatsende inklusive heute (nur im laufenden Monat), sonst null
  s.daysLeft = today >= from && today <= to ? diffDays(today, to) + 1 : null;
  s.dayIndex = today >= from && today <= to ? diffDays(from, today) + 1 : today > to ? days : 0;
  s.perDay = s.daysLeft ? Math.floor(Math.max(0, s.free) / s.daysLeft) : null;
  return s;
}

// Budget-Ampel: ok unter 85 %, warn ab 85 %, over über 100 %
export function budgetLevel(spent, limit) {
  if (!limit) return { ratio: 0, level: 'none' };
  const ratio = spent / limit;
  return { ratio, level: ratio > 1 ? 'over' : ratio >= 0.85 ? 'warn' : 'ok' };
}

// ---------- Kündigungsfristen ----------
// contractEnd = Vertragsende bzw. Ablauf; noticeMonths = Kündigungsfrist in Monaten vor dem Ablauf.
// Verträge verlängern sich meist um ein Jahr: liegt die Frist schon hinter uns, wird das nächste Vertragsjahr genommen.
export function noticeInfo(contractEnd, noticeMonths, today) {
  if (!contractEnd || noticeMonths == null || noticeMonths === '' || !isIso(contractEnd)) return null;
  let end = contractEnd, guard = 0;
  let deadline = addMonths(end, -noticeMonths);
  const missed = deadline < today && end >= today; // aktuelle Frist verpasst, Vertrag läuft noch
  while (deadline < today && guard++ < 50) { end = addMonths(end, 12); deadline = addMonths(end, -noticeMonths); }
  return { end, deadline, daysLeft: diffDays(today, deadline), missed };
}

// ---------- Spartöpfe ----------
// Stand je Topf in Cent: Startbetrag + Einzahlungen − Entnahmen (potTx = alle Buchungen mit Topf, nicht nur die letzten Monate)
export function potBalances(pots, potTx) {
  const b = new Map(pots.map(p => [p.id, p.startBalance ?? 0]));
  for (const t of potTx) if (b.has(t.potId)) b.set(t.potId, b.get(t.potId) + (t.kind === 'save' ? t.amount : t.kind === 'unsave' ? -t.amount : 0));
  return b;
}
// Monate bis zum Zieldatum, ab dem laufenden Monat gezählt (Zieldatum im laufenden Monat = 1, schon vorbei = 0)
export function monthsUntil(today, target) {
  if (!target) return null;
  const [y, m] = today.split('-').map(Number), [ty, tm] = target.split('-').map(Number);
  return target < today ? 0 : Math.max(1, (ty - y) * 12 + (tm - m) + (target.slice(8) >= today.slice(8) ? 1 : 0));
}
// Ziel-Rechnung: was fehlt, wie viel pro Monat nötig ist, und ob die Sparrate reicht
export function potPlan({ goal, targetDate }, balance, monthlyRate, today) {
  if (!goal) return { hasGoal: false };
  const missing = Math.max(0, goal - balance), ratio = Math.min(1, Math.max(0, balance / goal));
  const months = monthsUntil(today, targetDate);
  const need = months ? Math.ceil(missing / months) : null;
  let status = 'open';
  if (!missing) status = 'done';
  else if (months === 0) status = 'late';
  else if (need != null && monthlyRate) status = monthlyRate >= need ? 'ontrack' : 'behind';
  const etaMonths = monthlyRate > 0 ? Math.ceil(missing / monthlyRate) : null;
  return { hasGoal: true, missing, ratio, months, need, status, etaMonths };
}
export const lastDayOfMonth = key => monthRange(key).to;

// ---------- Einkäufe aus der Speisekammer ----------
// Bons der Speisekammer stehen dort als einzelne Artikelzeilen (log, type 'bought'). Zeilen derselben Person, die kurz hintereinander
// gespeichert wurden (höchstens 3 Minuten Abstand), sind ein Einkauf. Schlüssel 'sk:<erste Zeilen-ID>' verhindert doppeltes Übernehmen.
// Kategorien der Speisekammer → Haushaltskasse (Putzmittel & Co. sind keine Lebensmittel)
export const PANTRY_CATEGORY = { Haushalt: 'hh-waren', 'Getränke': 'lm-getraenke', Pfand: 'lm-getraenke' };
export const pantryCategory = c => PANTRY_CATEGORY[c] ?? 'lm-supermarkt';
// now: nur Einkäufe, deren letzte Zeile älter als gapMin ist (sonst wird der Bon evtl. noch gespeichert).
// since: Einkäufe, die vor diesem Zeitpunkt beginnen, fallen weg (die Abfrage holt etwas mehr, damit Gruppen am Rand vollständig sind).
export function groupPantry(rows, gapMin = 3, { now = null, since = null } = {}) {
  const sorted = [...rows].filter(r => r.price > 0).sort((a, b) => a.at.localeCompare(b.at));
  const out = [];
  let cur = null;
  for (const r of sorted) {
    if (!cur || r.by !== cur.by || (new Date(r.at) - new Date(cur.lastAt)) > gapMin * 60000) {
      cur = { key: 'sk:' + r.id, at: r.at, date: iso(new Date(r.at)), lastAt: r.at, by: r.by, amount: 0, items: [], parts: {} };
      out.push(cur);
    }
    const c = pantryCategory(r.category);
    cur.amount += r.price; cur.items.push(r.name); cur.lastAt = r.at; cur.parts[c] = (cur.parts[c] ?? 0) + r.price;
  }
  return out.filter(g => (!now || now - new Date(g.lastAt) > gapMin * 60000) && (!since || new Date(g.at) >= new Date(since)));
}
// Ist ein Einkauf schon übernommen? (Buchungen heißen 'sk:<id>:<kategorie>')
export const pantryDone = (key, refs) => refs.some(r => r === key || r.startsWith(key + ':'));
// Mögliche Doppelbuchung: Lebensmittel am selben Tag mit ähnlichem Betrag (±1 € bzw. ±3 %)
export function similarTx(tx, purchase, groupOf) {
  return tx.find(t => t.kind === 'expense' && t.date === purchase.date && groupOf(t.category) === 'lebensmittel' && !String(t.extRef ?? '').startsWith(purchase.key)
    && Math.abs(t.amount - purchase.amount) <= Math.max(100, purchase.amount * 0.03)) ?? null;
}

// ---------- Personen und Konten ----------
// Ansicht: 'all' = alles, was ich sehen darf; 'shared' = nur Gemeinsames; 'mine' = nur meine privaten; sonst User-ID = private Einträge dieser Person
export function inScope(owner, scope, me) {
  if (scope === 'all' || !scope) return true;
  if (scope === 'shared') return owner == null;
  if (scope === 'mine') return owner === me;
  return owner === scope;
}
// Vorgabe für neue Einträge: Gemeinschaftskonto → gemeinsam; Konto einer anderen Person → gemeinsam (privat kann nur sie selbst buchen);
// eigenes Konto → je nach Einstellung „neue Einträge privat“
export function defaultOwner(account, me, defaultPrivate) {
  if (!account || account.owner == null || account.owner !== me) return defaultPrivate && !account ? me : null;
  return defaultPrivate ? me : null;
}
// Freigabe „nur Summen“ als Monatswerte, die in die Übersicht und Auswertung einfließen (keine Einzelbuchungen)
export function sumsToTx(sums) {
  return sums.filter(x => (x.area === 'tx' || x.area === 'pots') && x.month && x.total).map(x => ({
    id: `sum:${x.owner}:${x.area}:${x.month}:${x.kind}:${x.category}`, date: `${x.month}-01`, amount: x.total, kind: x.kind, category: x.category,
    note: '', source: 'sums', owner: x.owner, synthetic: true, potId: null, accountId: null,
  }));
}
// Ausgaben je Konto in einem Zeitraum (Cent); ohne Konto unter dem Schlüssel ''
export function byAccount(tx, from, to) {
  const m = new Map();
  for (const t of tx) {
    if (t.synthetic || t.date < from || t.date > to || (t.kind !== 'expense' && t.kind !== 'save')) continue;
    const k = t.accountId ?? ''; m.set(k, (m.get(k) ?? 0) + t.amount);
  }
  return m;
}

// ---------- ETFs ----------
// Gewinn/Verlust aus eingezahlter Summe und selbst eingetragenem Depotwert
export function etfGain(paid, value) {
  if (value == null) return null;
  const gain = value - paid;
  return { gain, pct: paid > 0 ? gain / paid * 100 : null };
}
// Geschätzter Wert heute: zuletzt eingetragener Depotwert plus alle Ein- und Auszahlungen nach diesem Datum
// (Kursänderungen seitdem kennt die App nicht). estimated = true, wenn seitdem etwas dazukam oder abging.
export function etfValue(p, moves) {
  if (p.marketValue == null) return { value: null, estimated: false };
  let v = p.marketValue, estimated = false;
  for (const t of moves) {
    if (t.potId !== p.id || !p.marketValueAt || t.date <= p.marketValueAt) continue;
    v += t.kind === 'save' ? t.amount : t.kind === 'unsave' ? -t.amount : 0; estimated = true;
  }
  return { value: Math.max(0, v), estimated };
}
// ISIN prüfen (Format und Prüfziffer nach ISO 6166)
export function isValidIsin(isin) {
  const s = String(isin ?? '').toUpperCase().replace(/\s/g, '');
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(s)) return false;
  const digits = s.slice(0, 11).split('').map(c => /[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c).join('');
  let sum = 0, dbl = true;
  for (let i = digits.length - 1; i >= 0; i--) { let d = +digits[i]; if (dbl) { d *= 2; if (d > 9) d -= 9; } sum += d; dbl = !dbl; }
  return (10 - sum % 10) % 10 === +s[11];
}

// ---------- Fixkosten aus einem Spartopf ----------
// Reicht das Geld im Topf bis zu den nächsten Fälligkeiten? deposits: Sparraten [{ date, amount }], dues: Fixkosten [{ date, amount, name }].
// Am selben Tag kommt die Sparrate zuerst. Ergebnis: ok (mit nächster Fälligkeit) oder erster Engpass mit Datum, Name und Fehlbetrag.
export function potForecast({ balance, deposits = [], dues = [] }) {
  const ev = [...deposits.map(d => ({ ...d, in: true })), ...dues.map(d => ({ ...d, in: false }))]
    .sort((a, b) => a.date.localeCompare(b.date) || (a.in === b.in ? 0 : a.in ? -1 : 1));
  let cash = balance;
  for (const e of ev) {
    cash += e.in ? e.amount : -e.amount;
    if (!e.in && cash < 0) return { ok: false, date: e.date, name: e.name, missing: -cash };
  }
  const next = [...dues].sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  return { ok: true, next, end: cash };
}
// Vorschlag für die Sparrate: was die Fixkosten im Schnitt kosten, umgerechnet auf den Rhythmus der Sparrate (aufgerundet auf ganze Euro)
export function potRateSuggestion(recs, freq) {
  const perMonth = recs.reduce((a, r) => a + r.amount * (FREQS[r.freq]?.perMonth ?? 1), 0);
  return perMonth ? Math.ceil(perMonth / (FREQS[freq]?.perMonth ?? 1) / 100) * 100 : 0;
}

// ---------- Suche ----------
export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
export function matches(text, query) {
  const t = norm(text), words = norm(query).split(/\s+/).filter(Boolean);
  return words.every(w => t.includes(w));
}

// ---------- Export ----------
// Textfelder gegen Formel-Einschleusung schützen (=, +, -, @ am Anfang), Beträge bleiben Zahlen
const csvCell = (v, text = true) => {
  let s = String(v ?? '');
  if (text && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\n\r]/.test(s) || s.startsWith("'") ? '"' + s.replace(/"/g, '""') + '"' : s;
};
// CSV mit Semikolon und Dezimalkomma (öffnet so direkt in Excel/Numbers mit deutscher Einstellung)
export function toCsv(tx, catPath) {
  const head = ['Datum', 'Art', 'Kategorie', 'Betrag', 'Notiz', 'Quelle'];
  const rows = [...tx].sort((a, b) => a.date.localeCompare(b.date)).map(t => [
    dateShort(t.date), { income: 'Einnahme', expense: 'Ausgabe', save: 'In Spartopf', unsave: 'Aus Spartopf' }[t.kind] ?? t.kind, catPath(t.category),
    (t.kind === 'income' || t.kind === 'unsave' ? '' : '-') + fromCents(t.amount).toFixed(2).replace('.', ','), t.note ?? '',
    { manual: 'von Hand', receipt: 'Kassenbon', recurring: 'Fixkosten', import: 'Import', rest: 'Monatsrest', pantry: 'Speisekammer', cash: 'Bargeld' }[t.source] ?? t.source,
  ]);
  return '﻿' + [head, ...rows].map(r => r.map((v, i) => csvCell(v, i !== 3)).join(';')).join('\r\n');
}

// Häufig genutzte Kategorien (für die Schnellerfassung zuerst anzeigen)
export function topCategories(tx, kind, n = 6) {
  const count = new Map();
  for (const t of tx.slice(0, 300)) if (t.kind === kind && t.source !== 'recurring') count.set(t.category, (count.get(t.category) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);
}
// Kategorie aus früheren Buchungen mit gleicher Notiz vorschlagen („Aral“ → Sprit)
export function guessCategory(tx, note, kind) {
  const n = norm(note).trim(); if (n.length < 2) return null;
  const hit = tx.find(t => t.kind === kind && t.note && norm(t.note).trim() === n);
  return hit?.category ?? null;
}
