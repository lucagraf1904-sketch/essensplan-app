// Oberflächentest der Haushaltskasse im Demo-Modus (ohne Server: Dateien werden per Playwright-Routing von der Platte geliefert).
// Aufruf: node tests/budget/e2e.mjs [Ordner für Screenshots]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.argv[2] || null;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.pdf': 'application/pdf' };

// Minimales PDF mit Text auf zwei Seiten (für den Upload-Test)
function makePdf(pages) {
  const objs = [];
  const add = s => { objs.push(s); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const pageIds = [];
  const kids = [];
  const pagesId = objs.length + 1 + pages.length * 2;
  for (const text of pages) {
    const lines = text.split('\n').map((l, i) => `BT /F1 11 Tf 50 ${780 - i * 16} Td (${l.replace(/[()\\]/g, m => '\\' + m)}) Tj ET`).join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(lines, 'latin1')} >>\nstream\n${lines}\nendstream`);
    const pid = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`);
    pageIds.push(pid); kids.push(`${pid} 0 R`);
  }
  add(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const browser = await chromium.launch();
const errors = [];
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', timezoneId: 'Europe/Berlin', ...opts });
  await ctx.route('http://app.test/**', async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path);
    try { await route.fulfill({ body: await readFile(file), contentType: TYPES[extname(file)] ?? 'application/octet-stream' }); }
    catch { await route.fulfill({ status: 404, body: 'not found' }); }
  });
  await ctx.route(/esm\.sh/, r => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  return page;
}
const shot = async (page, name, fullPage = true) => { if (OUT) await page.screenshot({ path: join(OUT, name + '.png'), fullPage }); };

const page = await newPage();
await page.goto('http://app.test/budget/?demo=1');
await page.waitForSelector('#view-home .band');
await page.waitForTimeout(300);
await shot(page, '01-uebersicht');

// Übersicht: Fixkosten wurden automatisch gebucht, Monatsband zeigt einen Betrag
const st = await page.evaluate(() => ({ tx: window.__budget.state.tx.length, rec: window.__budget.state.recurring.length, booked: window.__budget.state.tx.filter(t => t.source === 'recurring').length }));
assert.ok(st.tx > 50, 'Beispielbuchungen geladen'); assert.ok(st.booked > 10, 'Fixkosten gebucht: ' + st.booked);
assert.match(await page.textContent('.band-value'), /€/);

// Schnellerfassung: 12,50 € Sprit
await page.click('#fab');
await page.fill('#tx-amount', '12,50');
await page.click('#tx-groups [data-g=mobilitaet]');
await page.click('#tx-subs [data-cat=mo-sprit]');
await page.fill('#tx-note', 'Shell Test');
await shot(page, '02-erfassen', false);
await page.click('#tx-save');
await page.waitForSelector('#toast.show');
assert.match(await page.textContent('#toast'), /12,50.*Sprit/);
const added = await page.evaluate(() => window.__budget.state.tx.find(t => t.note === 'Shell Test'));
assert.equal(added.amount, 1250); assert.equal(added.category, 'mo-sprit');

// Rückgängig
await page.click('#toast button');
await page.waitForTimeout(100);
assert.equal(await page.evaluate(() => window.__budget.state.tx.some(t => t.note === 'Shell Test')), false, 'Rückgängig entfernt die Buchung');

// Ungültiger Betrag
await page.click('#fab');
await page.fill('#tx-amount', 'abc');
await page.click('#tx-save');
assert.match(await page.textContent('#tx-err'), /Betrag/);
await page.fill('#tx-amount', '5');
await page.click('#tx-save');
assert.match(await page.textContent('#tx-err'), /Kategorie/);
await page.keyboard.press('Escape');

// Buchungen: Suche
await page.click('.tabs [data-view=tx]');
await page.fill('#tx-q', 'aral');
await page.waitForTimeout(100);
const hits = await page.$$eval('#view-tx .item', els => els.length);
assert.ok(hits > 0, 'Suche findet Aral');
await shot(page, '03-buchungen');
await page.fill('#tx-q', '');

// Fixkosten anlegen: Netflix 13,99 monatlich
await page.click('.tabs [data-view=fixed]');
await shot(page, '04-fixkosten');
await page.click('#view-fixed [data-act=add-rec]');
await page.fill('#rec-name', 'Testabo');
await page.fill('#rec-amount', '9,99');
await page.selectOption('#rec-cat', 'ab-streaming');
await page.click('#form-rec [type=submit]');
await page.waitForTimeout(200);
assert.ok(await page.evaluate(() => window.__budget.state.recurring.some(r => r.name === 'Testabo' && r.amount === 999)));

// Versicherungen: Police als PDF hochladen und fragen
await page.click('.tabs [data-view=ins]');
await shot(page, '05-versicherungen');
await page.click('#view-ins [data-act=add-pol]');
await page.fill('#pol-name', 'Hausrat Test');
await page.selectOption('#pol-cat', 'vers-hausrat');
await page.fill('#pol-amount', '79,20');
await page.fill('#pol-next', '2027-03-01');
await page.setInputFiles('#pol-file', { name: 'hausrat.pdf', mimeType: 'application/pdf', buffer: makePdf([
  'Versicherungsschein Hausratversicherung\nVersicherungssumme 40.000 EUR\nSelbstbeteiligung 150 EUR',
  'Paragraf 5 Fahrraddiebstahl\nFahrraeder sind gegen Diebstahl bis 1.000 EUR versichert,\nwenn sie mit einem Schloss gesichert waren.',
]) });
await page.waitForFunction(() => /Seiten gelesen/.test(document.querySelector('#pol-file-msg').textContent), null, { timeout: 15000 });
await shot(page, '06-police-hochladen', false);
await page.click('#form-pol [type=submit]');
await page.waitForFunction(() => window.__budget.state.policies.some(p => p.name === 'Hausrat Test' && p.pageCount === 2), null, { timeout: 5000 });
assert.ok(await page.evaluate(() => window.__budget.state.recurring.some(r => r.name === 'Hausrat Test' && r.freq === 'yearly' && r.amount === 7920)), 'Beitrag als Fixkosten');

// Bearbeiten einer Versicherung behält den Policentext (Review-Befund)
await page.click('#view-ins [data-pol]');
await page.click('#dlg-pol details.more summary >> nth=0');
await page.fill('#pol-notes', 'geändert');
await page.click('#form-pol [type=submit]');
await page.waitForTimeout(300);
assert.ok(await page.evaluate(() => window.__budget.state.policies.every(p => p.name !== 'Autoversicherung Golf' || p.pageCount === 3)), 'Seiten bleiben nach Bearbeiten');
assert.equal(await page.evaluate(() => document.querySelector('#dlg-pol').open), false);

await page.click('#view-ins [data-ask=""]');
await page.selectOption('#chat-scope', { label: '🛡️ Hausrat Test' });
await page.fill('#chat-input', 'Ist mein Fahrrad versichert, wenn es geklaut wird?');
await page.click('#chat-form button');
await page.waitForSelector('#chat-msgs .msg-a blockquote', { state: 'attached' });
const quoted = await page.$$eval('#chat-msgs .msg-a blockquote', els => els.map(e => e.textContent).join(' | '));
assert.match(quoted, /Fahrraddiebstahl/, 'Fundstelle Seite 2 wird gezeigt');
await shot(page, '07-chat', false);
await page.keyboard.press('Escape');

// Auswertung
await page.click('.tabs [data-view=stats]');
await page.waitForSelector('#ch-exp svg');
await page.hover('#ch-exp .hit >> nth=2');
await shot(page, '08-auswertung');
await page.click('#view-stats [data-act=table]');
assert.ok(await page.$('#view-stats table'));

// Einstellungen: Budget ändern
await page.click('#btn-settings');
await page.fill('[data-limit=freizeit]', '80');
await page.waitForTimeout(800);
assert.equal(await page.evaluate(() => window.__budget.state.config.limits.freizeit), 8000);
await shot(page, '09-einstellungen', false);
await page.keyboard.press('Escape');

// Spartöpfe: Monatsrest wurde automatisch in den Notgroschen gelegt (Demo: Monatsrest automatisch an)
await page.click('.tabs [data-view=home]');
const rest = await page.evaluate(() => window.__budget.state.tx.find(t => t.source === 'rest'));
assert.ok(rest && rest.kind === 'save' && rest.amount > 0, 'Monatsrest automatisch gespart');
assert.ok(rest.date.endsWith(String(new Date(new Date().getFullYear(), new Date().getMonth(), 0).getDate())), 'am letzten Tag des Vormonats');
await shot(page, '13-spartoepfe');
// Einzahlen in „Urlaub“
const potBal = () => page.evaluate(() => { const s = window.__budget.state, p = s.pots.find(x => x.name === 'Urlaub'); return p.startBalance + s.potTx.filter(t => t.potId === p.id).reduce((a, t) => a + (t.kind === 'save' ? t.amount : -t.amount), 0); });
const before = await potBal();
await page.click('#view-home .pot >> text=Urlaub');
await page.waitForSelector('#dlg-pot[open]');
await page.waitForTimeout(400);
await shot(page, '14-topf', false);
await page.click('#pot-in');
await page.fill('#mv-amount', '50');
await page.click('#ask-btns button[value=ok]');
await page.waitForFunction(b => { const s = window.__budget.state, p = s.pots.find(x => x.name === 'Urlaub'); return p.startBalance + s.potTx.filter(t => t.potId === p.id).reduce((a, t) => a + (t.kind === 'save' ? t.amount : -t.amount), 0) === b + 5000; }, before);
await page.waitForFunction(() => /eingezahlt/.test(document.querySelector('#toast').textContent));
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('#dlg-pot').open);
// Neuen Topf mit Ziel und Sparrate anlegen
await page.click('#view-home [data-act=add-pot]');
await page.fill('#pot-name', 'Neues Fahrrad');
await page.fill('#pot-goal', '900');
await page.fill('#pot-rate', '75');
await page.click('#form-pot [type=submit]');
await page.waitForFunction(() => window.__budget.state.pots.some(p => p.name === 'Neues Fahrrad' && p.goal === 90000));
assert.ok(await page.evaluate(() => window.__budget.state.recurring.some(r => r.kind === 'save' && r.name === 'Sparrate Neues Fahrrad' && r.amount === 7500)));
await page.waitForFunction(() => [...document.querySelectorAll('#view-home .pot')].some(e => /Neues Fahrrad[\s\S]*Ziel 900/.test(e.textContent)));
// Einkäufe aus der Speisekammer übernehmen
const sugg = await page.$$eval('#view-home .suggest', els => els.length);
assert.ok(sugg >= 1, 'Speisekammer-Einkäufe werden vorgeschlagen');
await shot(page, '15-speisekammer');
await page.click('#view-home .suggest [data-act=pantry-take] >> nth=0');
await page.waitForFunction(() => window.__budget.state.tx.some(t => t.source === 'pantry'));
await page.waitForFunction(n => document.querySelectorAll('#view-home .suggest').length === n - 1, sugg, { timeout: 5000 }); // übernommener Einkauf verschwindet aus den Vorschlägen

// ---------- Personen, Konten, Freigabe ----------
await page.click('.tabs [data-view=home]');
await page.waitForSelector('#scope-bar:not(.hidden) [data-scope=shared]');
await shot(page, '16-ansicht');
// Private Ausgabe vom eigenen Konto
await page.click('#fab');
await page.fill('#tx-amount', '23,40');
await page.click('#tx-groups [data-g=kleidung]');
await page.fill('#tx-note', 'Privat-Test');
const myAcc = await page.evaluate(() => window.__budget.state.accounts.find(a => a.owner === 'demo').id);
await page.click(`#tx-who [data-acc="${myAcc}"]`);
await page.check('#tx-who [value=me]');
await page.waitForTimeout(150);
await shot(page, '17-erfassen-konto', false);
await page.click('#tx-save');
await page.waitForFunction(() => window.__budget.state.tx.some(t => t.note === 'Privat-Test'));
const pt = await page.evaluate(() => window.__budget.state.tx.find(t => t.note === 'Privat-Test'));
assert.equal(pt.owner, 'demo'); assert.ok(pt.accountId, 'Konto gespeichert');
// Vom Gemeinschaftskonto ist die Vorgabe „gemeinsam“
await page.click('#fab');
const joint = await page.evaluate(() => window.__budget.state.accounts.find(a => a.owner == null).id);
await page.click(`#tx-who [data-acc="${joint}"]`);
assert.ok(await page.isChecked('#tx-who [value=shared]'), 'Gemeinschaftskonto → gemeinsam');
await page.keyboard.press('Escape');
// Ansicht „Gemeinsam“ blendet Privates aus, „Nur ich“ zeigt es
await page.click('.tabs [data-view=tx]');
await page.click('#scope-bar [data-scope=shared]');
await page.fill('#tx-q', 'Privat-Test');
await page.waitForTimeout(100);
assert.equal(await page.$$eval('#view-tx .item', e => e.length), 0, 'in „Gemeinsam“ unsichtbar');
await page.click('#scope-bar [data-scope=mine]');
await page.waitForTimeout(100);
assert.equal(await page.$$eval('#view-tx .item', e => e.length), 1, 'in „Nur ich“ sichtbar');
await page.fill('#tx-q', '');
// Lea gibt nur Summen frei: eine Summen-Zeile, keine Einzelbuchungen
await page.click('#scope-bar [data-scope=lea]');
await page.waitForFunction(() => /Lea[\s\S]*private Ausgaben/.test(document.querySelector('#view-tx').textContent));
assert.equal(await page.$$eval('#view-tx .item', e => e.length), 0, 'keine Einzelbuchungen von Lea');
await shot(page, '18-lea-summen');
await page.click('#scope-bar [data-scope=all]');
// Fixkosten: Abbuchungen je Konto
await page.click('.tabs [data-view=fixed]');
await page.waitForFunction(() => /Abbuchungen je Konto[\s\S]*Gemeinschaftskonto/.test(document.querySelector('#view-fixed').textContent));
// Freigabe ändern und Name
await page.click('#btn-settings');
await page.check('[name=share-tx][value=sums]');
await page.fill('#me-name', 'Alexandra');
await page.waitForTimeout(900);
const meRow = await page.evaluate(() => window.__budget.state.members.find(m => m.userId === 'demo'));
assert.equal(meRow.share.tx, 'sums'); assert.equal(meRow.displayName, 'Alexandra');
// Konto anlegen
await page.fill('#acc-name', 'Kreditkarte');
await page.click('#form-acc button');
await page.waitForFunction(() => window.__budget.state.accounts.some(a => a.name === 'Kreditkarte' && a.owner === 'demo'));
await shot(page, '19-einstellungen-freigabe', false);
await page.keyboard.press('Escape');

// ---------- Bargeld-Umschläge ----------
await page.click('.tabs [data-view=home]');
await page.click('#scope-bar [data-scope=all]');
const cashSum = () => page.evaluate(() => { const t = [...document.querySelectorAll('#view-home .cash-sum')].map(e => e.textContent).join(' '); const m = t.match(/abheben\s*([\d.,]+)/); return m ? m[1] : null; });
assert.equal(await cashSum(), '175,00', 'Demo: 60 + 25 + 40 + 50 € Rücklage');
assert.match(await page.textContent('#view-home'), /Rücklage · drin/);
const freeBefore = await page.textContent('.band-value');
await page.click('#view-home [data-act=add-cash]');
await page.fill('#cash-name', 'Taschengeld Kind');
await page.fill('#cash-amount', '20');
await page.selectOption('#cash-cat', 'fa-kinder');
await page.click('#form-cash [type=submit]');
await page.waitForFunction(() => /abheben\s*195,00/.test(document.querySelector('#view-home').textContent));
assert.notEqual(await page.textContent('.band-value'), freeBefore, 'Noch frei berücksichtigt das Bargeld');
await shot(page, '20-bargeld');
await page.click('#view-home [data-act=cash-withdraw]');
await page.click('#ask-btns button[value=ok]');
await page.waitForFunction(() => /Abgehoben im/.test(document.querySelector('#view-home').textContent));
const cashTx = await page.evaluate(() => window.__budget.state.tx.filter(t => t.source === 'cash'));
assert.equal(cashTx.length, 5); assert.ok(cashTx.some(t => t.category === 'lm-markt' && t.amount === 6000 && t.owner == null));
assert.ok(cashTx.some(t => t.kind === 'save' && t.amount === 5000 && t.potId), 'Rücklage als zurückgelegt gebucht');
assert.ok(cashTx.every(t => t.accountId), 'Konto gesetzt');
await page.reload(); await page.waitForSelector('#view-home .band');
assert.equal((await page.evaluate(() => window.__budget.state.tx.filter(t => t.source === 'cash'))).length, 5, 'nach Neuladen keine Doppelbuchung');
// Fixkosten einem Rücklage-Umschlag zuordnen
await page.click('.tabs [data-view=fixed]');
await page.click('#view-fixed [data-act=add-rec]');
await page.fill('#rec-name', 'Hausrat jährlich');
await page.fill('#rec-amount', '120');
await page.selectOption('#rec-freq', 'yearly');
await page.fill('#rec-next', '2027-03-01');
const resEnv = await page.evaluate(() => window.__budget.state.cash.find(e => e.potId).id);
await page.selectOption('#rec-cash', resEnv);
await page.click('#form-rec [type=submit]');
await page.waitForFunction(id => window.__budget.state.recurring.some(r => r.name === 'Hausrat jährlich' && r.cashId === id), resEnv);
await page.waitForFunction(() => /aus Rücklage Versicherungen/.test(document.querySelector('#view-fixed').textContent));
// Neuer Umschlag direkt aus dem Fixkosten-Dialog
await page.click('#view-fixed [data-act=add-rec]');
await page.fill('#rec-name', 'GEZ-Test');
await page.fill('#rec-amount', '55,08');
await page.selectOption('#rec-freq', 'quarterly');
await page.selectOption('#rec-cash', '__new');
await page.click('#form-rec [type=submit]');
await page.waitForFunction(() => { const s = window.__budget.state, e = s.cash.find(x => x.name === 'Rücklagen'); return e && e.potId && s.recurring.some(r => r.name === 'GEZ-Test' && r.cashId === e.id); });
await page.click('.tabs [data-view=home]');
await page.click('#view-home [data-cash] >> text=Rücklage Versicherungen');
await page.waitForTimeout(300);
assert.match(await page.textContent('#cash-reserve'), /Hausrat jährlich/);
await shot(page, '25-ruecklage', false);
await page.keyboard.press('Escape');

// ---------- ETFs ----------
await page.click('.tabs [data-view=home]');
await page.waitForFunction(() => /ETFs[\s\S]*MSCI World[\s\S]*Eingezahlt/.test(document.querySelector('#view-home').textContent));
await page.click('#view-home [data-act=add-etf]');
await page.fill('#pot-name', 'FTSE All-World');
await page.fill('#etf-isin', 'IE00BK5BQT80');
await page.fill('#pot-start', '1000');
await page.fill('#etf-value', '1.120,50');
await page.fill('#pot-rate', '50');
await page.click('#form-pot [type=submit]');
await page.waitForFunction(() => window.__budget.state.pots.some(p => p.kind === 'etf' && p.name === 'FTSE All-World' && p.marketValue === 112050));
await page.waitForFunction(() => [...document.querySelectorAll('#view-home .pot')].some(e => /FTSE All-World[\s\S]*\+120,50/.test(e.textContent)));
assert.ok(await page.evaluate(() => window.__budget.state.recurring.some(r => r.name === 'Sparplan FTSE All-World' && r.category === 'fi-anlage' && r.kind === 'save')));
assert.ok(!(await page.evaluate(() => [...document.querySelectorAll('#view-home .section-head')].find(h => /Spartöpfe/.test(h.textContent)).nextElementSibling.textContent.includes('FTSE'))), 'ETF nicht bei den Spartöpfen');
// falsche ISIN wird abgewiesen
await page.click('#view-home [data-act=add-etf]');
await page.fill('#pot-name', 'Test');
await page.fill('#etf-isin', 'IE00BK5BQT81');
await page.click('#form-pot [type=submit]');
assert.match(await page.textContent('#pot-err'), /ISIN/);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await shot(page, '21-etf');

// ---------- Verträge: Arbeitsvertrag mit Gehalt ----------
await page.click('.tabs [data-view=ins]');
await page.click('#view-ins [data-ctype=ei-gehalt]');
assert.match(await page.textContent('#pol-insurer-label'), /Arbeitgeber/);
assert.match(await page.textContent('#pol-amount-label'), /Nettogehalt/);
assert.ok(await page.isChecked('#pol-who [value=me]'), 'Arbeitsvertrag standardmäßig privat');
await page.fill('#pol-name', 'Arbeitsvertrag Muster GmbH');
await page.fill('#pol-insurer', 'Muster GmbH');
await page.fill('#pol-amount', '2700');
await page.fill('#pol-next', '2026-12-28');
await page.setInputFiles('#pol-file', { name: 'arbeitsvertrag.pdf', mimeType: 'application/pdf', buffer: makePdf([
  'Arbeitsvertrag zwischen der Muster GmbH und Max Muster\nParagraf 1 Beginn des Arbeitsverhaeltnisses am 01.03.2025\nDie ersten sechs Monate gelten als Probezeit.',
  'Paragraf 7 Urlaub\nDer Arbeitnehmer hat Anspruch auf 30 Arbeitstage Erholungsurlaub im Kalenderjahr.\nParagraf 9 Kuendigung nach der Probezeit mit gesetzlicher Frist.',
]) });
await page.waitForFunction(() => /Seiten gelesen/.test(document.querySelector('#pol-file-msg').textContent), null, { timeout: 15000 });
await page.click('#form-pol [type=submit]');
// Demo hat schon „Gehalt“: verknüpfen statt doppelt anlegen
await page.waitForSelector('#dlg-ask[open]');
assert.match(await page.textContent('#ask-body'), /Gehalt/);
await page.click('#ask-btns button[value=link]');
await page.waitForFunction(() => window.__budget.state.policies.some(p => p.category === 'ei-gehalt' && p.pageCount === 2));
const sal = await page.evaluate(() => { const s = window.__budget.state, pol = s.policies.find(p => p.category === 'ei-gehalt'); return s.recurring.filter(r => r.kind === 'income' && r.category === 'ei-gehalt' && r.active).map(r => ({ amount: r.amount, linked: r.policyId === pol.id })); });
assert.equal(sal.length, 1, 'kein zweites Gehalt'); assert.equal(sal[0].amount, 270000); assert.ok(sal[0].linked);
await page.waitForFunction(() => /💼 Arbeit/.test(document.querySelector('#view-ins').textContent));
// Fragen mit passenden Beispielen
await page.click('#view-ins [data-ask=""]');
await page.selectOption('#chat-scope', { label: '💶 Arbeitsvertrag Muster GmbH 🔒'.replace(' 🔒', '') }).catch(async () => {
  const v = await page.evaluate(() => [...document.querySelectorAll('#chat-scope option')].find(o => o.textContent.includes('Arbeitsvertrag')).value); await page.selectOption('#chat-scope', v); });
await page.waitForFunction(() => /Urlaubstage/.test(document.querySelector('#chat-chips').textContent));
await page.click('#chat-chips .chip >> nth=0');
await page.waitForSelector('#chat-msgs .msg-a blockquote', { state: 'attached' });
assert.match(await page.$$eval('#chat-msgs blockquote', e => e.map(x => x.textContent).join(' ')), /30 Arbeitstage/);
await shot(page, '24-arbeitsvertrag', false);
await page.keyboard.press('Escape');

// Monat wechseln
await page.click('.tabs [data-view=home]');
await page.click('#m-prev');
assert.match(await page.textContent('.band-label'), /Übrig geblieben|Ausgegeben/);
await page.click('#m-label');

// Daten bleiben nach Neuladen
await page.reload();
await page.waitForSelector('#view-home .band');
assert.ok(await page.evaluate(() => window.__budget.state.policies.some(p => p.name === 'Hausrat Test')));
// Kein doppeltes Buchen nach Neuladen
const booked2 = await page.evaluate(() => window.__budget.state.tx.filter(t => t.source === 'recurring').length);
assert.ok(booked2 >= st.booked && booked2 <= st.booked + 2, `keine Doppelbuchung (${st.booked} → ${booked2})`);

// Dunkelmodus und Desktop
const dark = await newPage({ colorScheme: 'dark' });
await dark.goto('http://app.test/budget/?demo=1'); await dark.waitForSelector('#view-home .band'); await dark.waitForTimeout(200);
await shot(dark, '10-dunkel');
const wide = await newPage({ viewport: { width: 1280, height: 900 } });
await wide.goto('http://app.test/budget/?demo=1'); await wide.waitForSelector('#view-home .band'); await wide.waitForTimeout(200);
await shot(wide, '11-desktop');
// Normaler Link nach der Demo: keine Demo mehr (früher blieb sie hängen)
const after = await newPage();
await after.goto('http://app.test/budget/?demo=1'); await after.waitForSelector('#view-home .band');
await after.evaluate(() => localStorage.setItem('haushaltskasse.mode', 'demo')); // Zustand aus älterer Version
await after.goto('http://app.test/budget/'); await after.waitForSelector('#auth:not(.hidden)');
assert.equal(await after.evaluate(() => localStorage.getItem('haushaltskasse.mode')), null, 'alter Demo-Schalter entfernt');
// Anmeldeseite (ohne Demo; Supabase ist hier nicht erreichbar)
const login = await newPage();
await login.goto('http://app.test/budget/'); await login.waitForSelector('#auth:not(.hidden)'); await shot(login, '12-anmeldung');

await browser.close();
const relevant = errors.filter(e => !/esm\.sh|net::ERR_FAILED|Failed to load resource/.test(e));
if (relevant.length) { console.error('Fehler im Browser:\n' + relevant.join('\n')); process.exit(1); }
console.log('E2E ok');
