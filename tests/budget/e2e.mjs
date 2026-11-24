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
// Anmeldeseite (ohne Demo; Supabase ist hier nicht erreichbar)
const login = await newPage();
await login.goto('http://app.test/budget/'); await login.waitForSelector('#auth:not(.hidden)'); await shot(login, '12-anmeldung');

await browser.close();
const relevant = errors.filter(e => !/esm\.sh|net::ERR_FAILED|Failed to load resource/.test(e));
if (relevant.length) { console.error('Fehler im Browser:\n' + relevant.join('\n')); process.exit(1); }
console.log('E2E ok');
