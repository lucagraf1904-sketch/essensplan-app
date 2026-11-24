// Tests der reinen Rechenfunktionen: node --test tests/budget
import test from 'node:test';
import assert from 'node:assert/strict';
import { inScope, defaultOwner, sumsToTx, byAccount, pantryDone, potBalances, potPlan, monthsUntil, groupPantry, similarTx, parseAmount, addMonths, nthDue, occurrences, bookDueLocal, monthSummary, noticeInfo, budgetLevel, toCsv, nextFrom, monthlyCents, isIso, matches } from '../../budget/logic.js';
import { rank, chunkPages, selectExcerpts, queryTerms } from '../../budget/retrieval.js';

test('Beträge lesen', () => {
  const cases = { '12,50': 1250, '12.5': 1250, '1.234,56': 123456, '1,234.56': 123456, '1234': 123400, '1.234': 123400, '0,99 €': 99, ' 7 ': 700, '+3,1': 310, ',5': 50 };
  for (const [k, v] of Object.entries(cases)) assert.equal(parseAmount(k), v, k);
  for (const bad of ['', 'abc', '12,345', '-5', '1,2,3', '12.345,6.7', '.', '1e5']) assert.equal(parseAmount(bad), null, bad);
});

test('Monate addieren schneidet am Monatsende ab (wie Postgres)', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-01-31', 2), '2026-03-31');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(addMonths('2026-01-10', -13), '2024-12-10');
});

test('Fälligkeiten vom Start aus, nicht verkettet (31. bleibt 31.)', () => {
  assert.deepEqual([0, 1, 2, 3].map(n => nthDue('2026-01-31', 'monthly', n)), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.equal(nthDue('2026-11-30', 'quarterly', 1), '2027-02-28');
  assert.equal(nthDue('2024-02-29', 'yearly', 1), '2025-02-28');
  assert.equal(nthDue('2026-11-24', 'weekly', 2), '2026-12-08');
  assert.equal(nextFrom('2026-01-15', 'monthly', '2026-11-24'), '2026-12-15');
});

test('Fixkosten buchen: alle verpassten Termine, keine doppelten', () => {
  const r = { id: 'r1', name: 'Miete', amount: 90000, kind: 'expense', category: 'wo-miete', freq: 'monthly', startDate: '2026-09-01', nextDue: '2026-09-01', n: 0, endDate: null, active: true };
  const keys = new Set(['r1|2026-10-01']);
  const out = bookDueLocal([r], '2026-11-24', keys);
  assert.deepEqual(out.map(t => t.date), ['2026-09-01', '2026-11-01']);
  assert.equal(r.nextDue, '2026-12-01'); assert.equal(r.n, 3);
  assert.equal(bookDueLocal([r], '2026-11-24', keys).length, 0);
});

test('Fixkosten mit Enddatum werden beendet', () => {
  const r = { id: 'r2', name: 'Kredit', amount: 10000, kind: 'expense', category: 'fi-kredit', freq: 'monthly', startDate: '2026-09-15', nextDue: '2026-09-15', n: 0, endDate: '2026-10-15', active: true };
  assert.equal(bookDueLocal([r], '2026-11-24').length, 2);
  assert.equal(r.active, false);
  assert.deepEqual(occurrences(r, '2026-01-01', '2027-12-31'), []);
});

test('Monatsübersicht: frei = Einnahmen − Ausgaben − offene Fixkosten', () => {
  const tx = [
    { date: '2026-11-01', amount: 250000, kind: 'income', category: 'ei-gehalt' },
    { date: '2026-11-01', amount: 90000, kind: 'expense', category: 'wo-miete', recurringId: 'r1' },
    { date: '2026-11-10', amount: 5000, kind: 'expense', category: 'mo-sprit' },
    { date: '2026-10-31', amount: 99999, kind: 'expense', category: 'mo-sprit' },
  ];
  const rec = [{ id: 's', amount: 1399, kind: 'expense', category: 'ab-streaming', freq: 'monthly', startDate: '2026-11-28', nextDue: '2026-11-28', n: 0, active: true }];
  const g = id => ({ 'wo-miete': 'wohnen', 'mo-sprit': 'mobilitaet', 'ab-streaming': 'abos', 'ei-gehalt': 'einkommen' })[id];
  const s = monthSummary({ tx, recurring: rec, key: '2026-11', today: '2026-11-24', groupOf: g });
  assert.equal(s.income, 250000); assert.equal(s.expense, 95000); assert.equal(s.pendingExpense, 1399);
  assert.equal(s.free, 250000 - 95000 - 1399); assert.equal(s.daysLeft, 7); assert.equal(s.fixedBooked, 90000);
  assert.equal(s.perDay, Math.floor(s.free / 7));
  assert.deepEqual(s.byGroup, { wohnen: 90000, mobilitaet: 5000 });
  const dec = monthSummary({ tx, recurring: rec, key: '2026-12', today: '2026-11-24', groupOf: g });
  assert.equal(dec.pendingExpense, 1399); assert.equal(dec.daysLeft, null);
});

test('Kündigungsfrist und Vertragsverlängerung', () => {
  assert.deepEqual(noticeInfo('2026-12-31', 1, '2026-11-24'), { end: '2026-12-31', deadline: '2026-11-30', daysLeft: 6, missed: false });
  const late = noticeInfo('2026-12-31', 3, '2026-11-24'); // Frist 30.09. verpasst → nächstes Jahr
  assert.equal(late.deadline, '2027-09-30'); assert.equal(late.missed, true);
  assert.equal(noticeInfo('2024-01-01', 1, '2026-11-24').deadline, '2026-12-01');
  assert.equal(noticeInfo(null, 1, '2026-11-24'), null);
  assert.equal(noticeInfo('2026-12-31', null, '2026-11-24'), null);
});

test('Budget-Ampel und Monatsanteil', () => {
  assert.equal(budgetLevel(8000, 10000).level, 'ok');
  assert.equal(budgetLevel(8500, 10000).level, 'warn');
  assert.equal(budgetLevel(10001, 10000).level, 'over');
  assert.equal(monthlyCents({ amount: 48600, freq: 'yearly' }), 4050);
  assert.equal(monthlyCents({ amount: 1000, freq: 'weekly' }), 4333);
});

test('CSV: Semikolon, Komma, Schutz vor Formeln', () => {
  const csv = toCsv([{ date: '2026-11-02', amount: 1250, kind: 'expense', category: 'x', note: '=HYPERLINK("x")', source: 'manual' }], () => 'Kat; A');
  assert.ok(csv.startsWith('﻿Datum;Art'));
  assert.ok(csv.includes('02.11.2026;Ausgabe;"Kat; A";-12,50;"\'=HYPERLINK(""x"")";von Hand'));
});

test('Datum prüfen und Suche', () => {
  assert.ok(isIso('2026-02-28')); assert.ok(!isIso('2026-02-30')); assert.ok(!isIso('24.11.2026'));
  assert.ok(matches('Café Müller', 'cafe muller')); assert.ok(matches('Straße', 'strasse')); assert.ok(!matches('Aral', 'shell'));
});

const POLICY = [
  'Versicherungsschein Kfz. Vollkasko 300 EUR Selbstbeteiligung, Teilkasko 150 EUR Selbstbeteiligung. Schutzbrief nicht vereinbart.',
  'A.2.2.5 Glasbruch: Versichert sind Bruchschäden an der Verglasung. A.2.2.6 Tierbiss: Schäden an Kabeln durch Tierbiss, z. B. Marderbiss. Folgeschäden bis 3.000 EUR.',
  'A.2.4 Geltungsbereich: Versicherungsschutz besteht in den geografischen Grenzen Europas. A.2.9 Nicht versichert sind Schäden durch Rennen.',
];
test('Policen-Suche findet die richtige Seite', () => {
  const chunks = chunkPages(POLICY, { policyId: 'p', policy: 'Auto' });
  assert.equal(rank(chunks, 'Ist Marderbiss abgedeckt?')[0].page, 2);
  assert.equal(rank(chunks, 'Bin ich im Urlaub in Spanien versichert?')[0].page, 3);
  assert.equal(rank(chunks, 'Was zahle ich bei einer kaputten Scheibe?')[0].page, 2);
  assert.equal(rank(chunks, 'Wie hoch ist mein Selbstbehalt?')[0].page, 1);
  assert.equal(rank(chunks, 'versichert police').length, 0); // nur Füllwörter
  assert.ok(queryTerms('Fahrräder geklaut').has('fahrrad'));
});
test('Auszüge: Versicherungsschein immer dabei, Grenze eingehalten', () => {
  const { excerpts } = selectExcerpts([{ id: 'p', name: 'Auto', pages: POLICY }], 'Marder', { maxChars: 400 });
  assert.equal(excerpts[0].page, 1); assert.ok(excerpts[0].cover);
  assert.ok(excerpts.some(x => x.page === 2));
  assert.ok(excerpts.reduce((a, x) => a + x.text.length, 0) <= 400);
  const long = chunkPages(['x'.repeat(5000)], {});
  assert.ok(long.every(c => c.text.length <= 1440));
});

test('Sparen mindert „frei“, ist aber keine Ausgabe', () => {
  const tx = [
    { date: '2026-11-01', amount: 200000, kind: 'income', category: 'ei-gehalt' },
    { date: '2026-11-02', amount: 50000, kind: 'expense', category: 'wo-miete' },
    { date: '2026-11-03', amount: 10000, kind: 'save', category: 'fi-sparen', potId: 'p' },
    { date: '2026-11-04', amount: 3000, kind: 'unsave', category: 'fi-sparen', potId: 'p' },
  ];
  const rec = [{ id: 'r', amount: 5000, kind: 'save', category: 'fi-sparen', freq: 'monthly', startDate: '2026-11-28', nextDue: '2026-11-28', n: 0, active: true, potId: 'p' }];
  const s = monthSummary({ tx, recurring: rec, key: '2026-11', today: '2026-11-24', groupOf: () => 'x' });
  assert.equal(s.expense, 50000); assert.equal(s.saved, 10000); assert.equal(s.unsaved, 3000); assert.equal(s.pendingSave, 5000);
  assert.equal(s.free, 200000 - 50000 - 10000 + 3000 - 5000);
  assert.deepEqual(Object.keys(s.byGroup), ['x']);
});

test('Spartopf: Stand und Ziel', () => {
  const b = potBalances([{ id: 'p', startBalance: 20000 }], [{ potId: 'p', kind: 'save', amount: 5000 }, { potId: 'p', kind: 'unsave', amount: 1000 }, { potId: 'q', kind: 'save', amount: 999 }]);
  assert.equal(b.get('p'), 24000); assert.equal(b.has('q'), false);
  assert.equal(monthsUntil('2026-11-24', '2027-08-01'), 9);   // Dez … Aug
  assert.equal(monthsUntil('2026-11-24', '2026-11-30'), 1);
  assert.equal(monthsUntil('2026-11-24', '2026-10-01'), 0);
  const plan = potPlan({ goal: 150000, targetDate: '2027-08-01' }, 24000, 10000, '2026-11-24');
  assert.equal(plan.missing, 126000); assert.equal(plan.need, 14000); assert.equal(plan.status, 'behind'); assert.equal(plan.etaMonths, 13);
  assert.equal(potPlan({ goal: 1000 }, 1500, 0, '2026-11-24').status, 'done');
  assert.equal(potPlan({ goal: null }, 0, 0, '2026-11-24').hasGoal, false);
});

test('Speisekammer-Einkäufe: Artikel zu Einkäufen bündeln, Doppelbuchung erkennen', () => {
  const rows = [
    { id: 'a', name: 'Milch', price: 119, at: '2026-11-20T10:00:00Z', by: 'u1' },
    { id: 'b', name: 'Brot', price: 249, at: '2026-11-20T10:00:30Z', by: 'u1' },
    { id: 'c', name: 'Käse', price: 399, at: '2026-11-20T10:02:00Z', by: 'u1' },
    { id: 'd', name: 'Äpfel', price: 299, at: '2026-11-20T10:02:10Z', by: 'u2' },
    { id: 'e', name: 'Wein', price: 599, at: '2026-11-20T18:00:00Z', by: 'u1' },
    { id: 'f', name: 'Ohne Preis', price: null, at: '2026-11-20T18:00:01Z', by: 'u1' },
    { id: 'g', name: 'Spülmittel', price: 199, at: '2026-11-20T18:00:20Z', by: 'u1', category: 'Haushalt' },
  ];
  const g = groupPantry(rows);
  assert.deepEqual(g.map(x => [x.key, x.amount, x.items.length]), [['sk:a', 767, 3], ['sk:d', 299, 1], ['sk:e', 798, 2]]);
  assert.deepEqual(g[2].parts, { 'lm-supermarkt': 599, 'hh-waren': 199 });
  // Bon wird gerade noch gespeichert: Einkauf erst nach 3 Minuten Ruhe vorschlagen
  assert.equal(groupPantry(rows, 3, { now: new Date('2026-11-20T18:02:00Z') }).length, 2);
  assert.equal(groupPantry(rows, 3, { now: new Date('2026-11-20T18:04:00Z') }).length, 3);
  // Einkauf, der vor dem Stichtag beginnt, taucht nicht mit neuem Schlüssel wieder auf
  assert.deepEqual(groupPantry(rows, 3, { since: '2026-11-20T10:01:00Z' }).map(x => x.key), ['sk:d', 'sk:e']);
  assert.ok(pantryDone('sk:a', ['sk:a:lm-supermarkt'])); assert.ok(!pantryDone('sk:a', ['sk:ab:x']));
  const tx = [{ kind: 'expense', date: g[0].date, category: 'lm-supermarkt', amount: 780 }];
  assert.ok(similarTx(tx, g[0], () => 'lebensmittel'));
  assert.equal(similarTx(tx, g[1], () => 'lebensmittel'), null); // 2,99 € ist nicht ähnlich zu 7,80 €
});

test('Personen: Ansicht, Vorgabe privat/gemeinsam, Summen, Konten', () => {
  assert.ok(inScope(null, 'shared', 'me')); assert.ok(!inScope('me', 'shared', 'me'));
  assert.ok(inScope('me', 'mine', 'me')); assert.ok(!inScope(null, 'mine', 'me'));
  assert.ok(inScope('lea', 'lea', 'me')); assert.ok(inScope('lea', 'all', 'me'));
  const joint = { owner: null }, mineAcc = { owner: 'me' }, leaAcc = { owner: 'lea' };
  assert.equal(defaultOwner(joint, 'me', true), null);
  assert.equal(defaultOwner(mineAcc, 'me', true), 'me'); assert.equal(defaultOwner(mineAcc, 'me', false), null);
  assert.equal(defaultOwner(leaAcc, 'me', true), null);
  assert.equal(defaultOwner(null, 'me', true), 'me');
  const tx = sumsToTx([{ owner: 'lea', area: 'tx', month: '2026-11', kind: 'expense', category: 'kl-kleidung', total: 6000 }, { owner: 'lea', area: 'potbal', total: 9 }]);
  assert.equal(tx.length, 1); assert.equal(tx[0].date, '2026-11-01'); assert.ok(tx[0].synthetic);
  const acc = byAccount([{ date: '2026-11-02', amount: 100, kind: 'expense', accountId: 'a' }, { date: '2026-11-03', amount: 50, kind: 'save', accountId: 'a' },
    { date: '2026-11-03', amount: 70, kind: 'expense' }, { date: '2026-11-03', amount: 999, kind: 'income', accountId: 'a' }, ...tx], '2026-11-01', '2026-11-30');
  assert.equal(acc.get('a'), 150); assert.equal(acc.get(''), 70); assert.equal(acc.size, 2);
});
