import { localStore } from './store.js';
import { SUPABASE_URL, VAPID_PUBLIC_KEY } from './config.js';
import { CATEGORIES, guessCategory, defaultExpiry, freezeExpiry, isoLocal } from './categories.js';
import { parseReceipt, ocrImage } from './receipt.js';
import { getSettings, setSetting, tipsOn } from './settings.js';
import { scanBarcode, lookupBarcode, nutritionLine } from './barcode.js';
import { CHAINS, chainName, listOffers, addOffer, deleteOffer, defaultUntil, offersFor, allOffers, shoppingCheck } from './offers.js';
import { tipFor, listHints, SOURCE } from './tips.js';
import { initHealth } from './health.js';
import { monthReport, productKey, pretty, ymOf, toCSV, parseSize } from './balance.js';

const $ = s => document.querySelector(s);
const store = SUPABASE_URL ? (await import('./store-supabase.js')).supabaseStore : localStore;
let WARN_DAYS = +(localStorage.getItem('warnDays') ?? 3);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = n => (n ?? 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

function daysLeft(expiry) {
  if (!expiry) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(expiry + 'T00:00:00') - today) / 86400000);
}
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('de-DE') : '';
function expiryBadge(d, frozen = false) {
  if (frozen && d != null && d > WARN_DAYS) return `<span class="badge frozen">❄️ noch ${d > 60 ? Math.round(d / 30) + ' Mon' : d + ' T'}</span>`;
  if (d == null) return '<span class="badge">ohne Datum</span>';
  if (d < 0) return `<span class="badge expired">seit ${-d} T abgelaufen</span>`;
  if (d === 0) return '<span class="badge expired">heute</span>';
  if (d <= WARN_DAYS) return `<span class="badge soon">noch ${d} T</span>`;
  return `<span class="badge">noch ${d} T</span>`;
}

// ---------- Tabs ----------
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  $('#fab').classList.toggle('hidden', b.dataset.tab !== 'pantry');
  if (b.dataset.tab === 'log') renderLog();
  if (b.dataset.tab === 'shop') { renderShop(); refreshOffers(); }
}));

// ---------- Vorrat ----------
async function renderPantry() {
  const items = await store.listItems();
  const q = $('#search').value.toLowerCase();
  const loc = $('#filter-loc').value;
  const shown = items
    .filter(i => (!q || i.name.toLowerCase().includes(q)) && (!loc || i.location === loc))
    .sort((a, b) => (daysLeft(a.expiry) ?? 1e9) - (daysLeft(b.expiry) ?? 1e9));

  $('#pantry-list').innerHTML = shown.map(i => `
    <li data-id="${i.id}">
      <div class="main">
        <div class="name">${esc(i.name)}</div>
        <div class="meta">${esc(i.qty)} ${esc(i.unit)}${i.size ? ' à ' + esc(i.size) : ''} · ${esc(i.category)} · ${esc(i.location)}</div>
        ${i.frozenAt ? `<div class="meta">MHD (Kühlschrank): ${i.origExpiry ? fmtDate(i.origExpiry) : 'unbekannt'}</div>
        <div class="meta frozen-meta"><b>❄️ Tiefkühl bis ${fmtDate(i.expiry)}</b> · eingefroren ${fmtDate(i.frozenAt)}</div>` : ''}
      </div>
      ${expiryBadge(daysLeft(i.expiry), !!i.frozenAt)}
    </li>`).join('');
  $('#pantry-empty').classList.toggle('hidden', items.length > 0);

  const soon = items.filter(i => { const d = daysLeft(i.expiry); return d != null && d <= WARN_DAYS; });
  $('#warn-box').innerHTML = soon.length
    ? `<div class="warn">⚠️ ${soon.length} Artikel ${soon.length === 1 ? 'läuft' : 'laufen'} bald ab: ${soon.slice(0, 5).map(i => esc(i.name)).join(', ')}${soon.length > 5 ? ' …' : ''}</div>`
    : '';
  return soon;
}
$('#search').addEventListener('input', renderPantry);
$('#filter-loc').addEventListener('change', renderPantry);

// Tippen auf Artikel → Verbrauch abhaken
let current = null;
$('#pantry-list').addEventListener('click', async e => {
  const li = e.target.closest('li[data-id]'); if (!li) return;
  current = (await store.listItems()).find(i => i.id === li.dataset.id);
  $('#use-title').textContent = current.name;
  $('#use-qty').value = current.qty;
  const frozen = !!current.frozenAt, d = daysLeft(current.expiry);
  const fz = freezeExpiry(current);
  const canFreeze = !frozen && current.location !== 'Gefrierschrank' && !(d != null && d < 0);
  $('#use-freeze').classList.toggle('hidden', !canFreeze);
  $('#use-thaw').classList.toggle('hidden', !frozen);
  $('#use-freeze-info').innerHTML = frozen
    ? `❄️ Eingefroren am ${fmtDate(current.frozenAt)}, empfohlen bis ${fmtDate(current.expiry)}.`
    : canFreeze
      ? `Einfrieren: haltbar bis ca. ${fmtDate(fz.date)} (${fz.months} Monate, ${fz.source ? 'laut ' + esc(fz.source) : 'Annahme ohne Quelle'}).${fz.hint ? ' ' + esc(fz.hint) : ''}`
      : (d != null && d < 0 && !frozen ? 'Abgelaufenes nicht mehr einfrieren.' : '');
  $('#use-dialog').showModal();
});
$('#use-dialog').addEventListener('close', async () => {
  const v = $('#use-dialog').returnValue;
  if (!current) return;
  if (v === 'eaten' || v === 'wasted') {
    await store.consume(current.id, parseFloat($('#use-qty').value) || current.qty, v);
    renderPantry();
  } else if (v === 'freeze') {
    await freezeItem(current, parseFloat($('#use-qty').value) || current.qty);
    renderPantry();
  } else if (v === 'thaw') {
    // Aufgetautes wie frische Ware behandeln und bald verarbeiten (LMTVet Bremen, Infoblatt 21).
    // Annahme: Fleisch & Fisch 1 Tag, alles andere 2 Tage im Kühlschrank.
    await store.upsertItem({ ...current, location: 'Kühlschrank', frozenAt: null, origExpiry: null, expiry: thawExpiry(current) });
    renderPantry();
  } else if (v === 'edit') openItem(current);
});

function thawExpiry(item) {
  const t = new Date(); t.setDate(t.getDate() + (item.category === 'Fleisch & Fisch' ? 1 : 2));
  return isoLocal(t);
}

// Frage mit Antwort-Knöpfen. options: [{ value, label, cls }]. Liefert den gewählten value.
function ask(title, text, options) {
  return new Promise(resolve => {
    const d = $('#ask-dialog');
    $('#ask-title').textContent = title;
    $('#ask-text').innerHTML = text;
    $('#ask-options').innerHTML = options.map(o => `<button value="${esc(o.value)}" class="${o.cls ?? ''}">${esc(o.label)}</button>`).join('');
    d.addEventListener('close', () => resolve(d.returnValue), { once: true });
    d.returnValue = '';
    d.showModal();
  });
}

// Bei Fleisch und Fisch fragen, ob eingefroren wird
const askFreezeCats = ['Fleisch & Fisch'];
async function askFreeze(item) {
  if (!getSettings().askFreeze) return;
  if (!askFreezeCats.includes(item.category) || item.location === 'Gefrierschrank' || item.frozenAt) return;
  const fz = freezeExpiry(item);
  const countable = item.qty > 1 && ['Stk', 'Pck'].includes(item.unit);
  const v = await ask(`${item.name} einfrieren?`,
    `Eingefroren haltbar bis ca. <b>${fmtDate(fz.date)}</b> (${fz.months} Monate${fz.source ? ', laut ' + esc(fz.source) : ''}).` +
    (item.expiry ? ` Im Kühlschrank bis ${fmtDate(item.expiry)}.` : ''),
    [
      { value: 'all', label: countable ? `❄️ Ja, alle ${item.qty} einfrieren` : '❄️ Ja, einfrieren', cls: 'primary' },
      ...(countable ? [{ value: 'one', label: '❄️ Nur 1 einfrieren, Rest in den Kühlschrank' }] : []),
      { value: 'no', label: '🧊 Nein, kommt in den Kühlschrank' },
    ]);
  if (v === 'all') await freezeItem(item, item.qty);
  if (v === 'one') await freezeItem(item, 1);
}

// Ganz oder teilweise einfrieren. Bei Teilmengen wird der Artikel aufgeteilt (Preis anteilig).
async function freezeItem(it, qty) {
  const today = isoLocal();
  const frozen = { location: 'Gefrierschrank', frozenAt: today, origExpiry: it.expiry || null, expiry: freezeExpiry(it).date };
  if (qty >= it.qty) return store.upsertItem({ ...it, ...frozen });
  const share = qty / it.qty;
  const price = it.price ? +(it.price * share).toFixed(2) : null;
  await store.upsertItem({ ...it, qty: +(it.qty - qty).toFixed(3), price: it.price ? +(it.price - price).toFixed(2) : null });
  await store.upsertItem({ ...it, id: undefined, addedAt: undefined, qty, price, ...frozen, noLog: true });
}

// ---------- Artikel anlegen / bearbeiten ----------
const form = $('#item-form');
form.category.innerHTML = Object.keys(CATEGORIES).map(c => `<option>${c}</option>`).join('');
let editing = null;
function openItem(item) {
  editing = item ?? null;
  $('#item-title').textContent = item ? 'Bearbeiten' : 'Neuer Artikel';
  $('#item-delete').classList.toggle('hidden', !item);
  const v = item ?? { name: '', size: '', qty: 1, unit: 'Stk', category: 'Sonstiges', location: 'Vorratsschrank', expiry: '', price: '' };
  for (const k of ['name', 'size', 'qty', 'unit', 'category', 'location', 'expiry', 'price']) form[k].value = v[k] ?? '';
  formFreeze = { frozenAt: v.frozenAt ?? null, origExpiry: v.origExpiry ?? null };
  formExtra = { barcode: v.barcode ?? null, nutrition: v.nutrition ?? null };
  $('#item-nutrition').textContent = nutritionLine(formExtra.nutrition);
  renderFreezeNote();
  $('#item-dialog').showModal();
}

// ---------- Barcode → Open Food Facts ----------
let formExtra = { barcode: null, nutrition: null };
$('#btn-barcode').addEventListener('click', async () => {
  const code = await scanBarcode();
  if (!code) return;
  const msg = t => $('#item-nutrition').textContent = t;
  msg(`Barcode ${code} – suche Produkt …`);
  formExtra.barcode = code;
  try {
    const info = await lookupBarcode(code);
    if (!info) return msg(`Barcode ${code} ist bei Open Food Facts nicht bekannt. Bitte Namen eintragen.`);
    form.name.value = info.name || form.name.value;
    if (info.size) form.size.value = info.size;
    form.category.value = info.category;
    if (!editing) { form.location.value = CATEGORIES[info.category]?.location ?? form.location.value; if (!form.expiry.value) form.expiry.value = defaultExpiry(info.category); }
    formExtra.nutrition = info.nutrition;
    msg([nutritionLine(info.nutrition), `Quelle: ${info.source}`].filter(Boolean).join(' · '));
  } catch (e) { msg(`Barcode ${code}: ${e.message}. Bitte Namen eintragen.`); }
});

// Ort „Gefrierschrank“ im Formular = einfrieren: Haltbarkeit wird angepasst, das MHD bleibt sichtbar.
let formFreeze = { frozenAt: null, origExpiry: null };
function renderFreezeNote() {
  const frozen = !!formFreeze.frozenAt;
  $('#expiry-label').textContent = frozen ? '❄️ Tiefkühl bis' : 'Haltbar bis';
  const fz = frozen ? freezeExpiry({ name: form.name.value, category: form.category.value }) : null;
  $('#freeze-note').classList.toggle('hidden', !frozen);
  $('#freeze-note').innerHTML = frozen
    ? `MHD (Kühlschrank): <b>${formFreeze.origExpiry ? fmtDate(formFreeze.origExpiry) : 'unbekannt'}</b><br>` +
      `❄️ Tiefkühl bis: <b>${fmtDate(form.expiry.value)}</b> · eingefroren am ${fmtDate(formFreeze.frozenAt)}<br>` +
      `<small>Empfehlung: ${fz.months} Monate${fz.source ? ', laut ' + esc(fz.source) : ' (Annahme ohne Quelle)'}</small>`
    : '';
}
form.location.addEventListener('change', () => {
  const toFreezer = form.location.value === 'Gefrierschrank';
  if (toFreezer && !formFreeze.frozenAt && form.category.value !== 'Tiefkühl') {
    formFreeze = { frozenAt: isoLocal(), origExpiry: form.expiry.value || null };
    form.expiry.value = freezeExpiry({ name: form.name.value, category: form.category.value }).date;
  } else if (!toFreezer && formFreeze.frozenAt) {
    // Heute eingefroren → rückgängig (altes MHD). Länger eingefroren → wie Auftauen.
    form.expiry.value = formFreeze.frozenAt === isoLocal() ? (formFreeze.origExpiry ?? '') : thawExpiry({ category: form.category.value });
    formFreeze = { frozenAt: null, origExpiry: null };
  }
  renderFreezeNote();
});
form.expiry.addEventListener('change', renderFreezeNote);
// Kategorie beim Tippen raten (nur bei neuen Artikeln)
form.name.addEventListener('change', () => {
  if (editing) return;
  const c = guessCategory(form.name.value);
  form.category.value = c;
  form.location.value = CATEGORIES[c].location;
  if (!form.expiry.value) form.expiry.value = defaultExpiry(c);
  if (!form.size.value) form.size.value = parseSize(form.name.value)?.label ?? '';
});
$('#fab').addEventListener('click', () => openItem(null));
$('#item-dialog').addEventListener('close', async () => {
  const v = $('#item-dialog').returnValue;
  if (v === 'delete' && editing) await store.deleteItem(editing.id);
  if (v === 'save') {
    const f = Object.fromEntries(new FormData(form));
    const saved = await store.upsertItem({ ...(editing ?? {}), ...f, ...formFreeze, ...formExtra, qty: parseFloat(f.qty) || 0, price: f.price ? parseFloat(f.price) : null });
    if (!editing) { await renderPantry(); await askFreeze(saved); }
  }
  renderPantry();
});

// ---------- Bon-Scan ----------
let scanned = [];
function renderScan() {
  $('#scan-result').innerHTML = scanned.map((s, i) => `
    <li class="scan-row" data-i="${i}">
      <input type="checkbox" class="s-sel" ${s.selected ? 'checked' : ''} ${s.deposit ? 'disabled' : ''}>
      <input class="s-name" value="${esc(s.name)}">
      <span class="meta">${eur(s.price)}</span>
      ${s.deposit ? '<span class="meta">♻️ nur Bilanz</span>' : `<input class="s-size" placeholder="Größe" value="${esc(s.size)}">
      <input class="s-days" type="date" value="${esc(s.expiry)}">`}
    </li>`).join('');
  $('#scan-actions').classList.toggle('hidden', !scanned.length);
}
function handleText(text) {
  scanned = parseReceipt(text);
  $('#scan-status').textContent = scanned.length
    ? `${scanned.length} Positionen erkannt. Bitte kurz prüfen, Haltbarkeit ist geschätzt.`
    : 'Keine Positionen erkannt. Versuche ein schärferes, gerades Foto oder füge den Text ein.';
  renderScan();
}
$('#scan-file').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  $('#scan-status').textContent = 'Texterkennung läuft …';
  try {
    const text = await ocrImage(file, p => $('#scan-status').textContent = `Texterkennung läuft … ${p} %`);
    $('#scan-text').value = text;
    handleText(text);
  } catch (err) { $('#scan-status').textContent = 'Fehler: ' + err.message; }
  e.target.value = '';
});
$('#scan-parse').addEventListener('click', () => handleText($('#scan-text').value));
$('#scan-result').addEventListener('input', e => {
  const li = e.target.closest('li'); const s = scanned[li.dataset.i];
  if (e.target.classList.contains('s-sel')) s.selected = e.target.checked;
  if (e.target.classList.contains('s-name')) s.name = e.target.value;
  if (e.target.classList.contains('s-days')) s.expiry = e.target.value;
  if (e.target.classList.contains('s-size')) s.size = e.target.value;
});
$('#scan-import').addEventListener('click', async () => {
  const sel = scanned.filter(s => s.selected);
  const added = [];
  for (const s of sel) {
    added.push(await store.upsertItem({ name: s.name, qty: s.qty, unit: s.unit, category: s.category,
      location: CATEGORIES[s.category].location, expiry: s.expiry, price: s.price, size: s.size }));
  }
  // Nicht übernommene Positionen (z. B. Haushalt) trotzdem als Ausgabe buchen
  for (const s of scanned.filter(s => !s.selected)) {
    await store.addLog({ type: 'bought', itemName: s.name, category: s.category, qty: s.qty, unit: s.unit, price: s.price, size: s.size });
  }
  $('#scan-status').textContent = `${sel.length} Artikel übernommen.`;
  scanned = []; renderScan(); renderPantry();
  for (const it of added) await askFreeze(it);
  renderPantry();
});

// ---------- Verlauf & Monatsbilanz ----------
const monthInput = $('#month-pick');
monthInput.value = ymOf(new Date());
monthInput.addEventListener('change', renderLog);
let lastBalance = null;

async function renderLog() {
  const [rawLog, aliases] = await Promise.all([store.listLog(), store.getAliases()]);
  const log = rawLog.slice().sort((a, b) => b.at.localeCompare(a.at));
  const ym = monthInput.value || ymOf(new Date());
  const bal = lastBalance = monthReport(log, ym, aliases);
  const pct = q => Math.round(q * 100) + ' %';
  const arrow = d => !bal.hasPrev ? '' : Math.abs(d) < 0.01 ? '<span class="diff">±0</span>'
    : `<span class="diff ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲ +' : '▼ '}${eur(d)}</span>`;
  const hintText = h => h.kind === 'waste'
    ? `🗑️ <b>${esc(pretty(h.key))} ${esc(h.label)}</b>: ${pct(h.quota)} weggeworfen (${eur(h.wasted)}). Kleinere Packung oder seltener kaufen.`
    : `💡 <b>${esc(pretty(h.key))}</b>: Nur in ${esc(h.best)} gekauft (${eur(h.unitPrice.value)}/${h.unitPrice.per}) wären es ${eur(h.saving)} weniger gewesen.`;
  $('#month-stats').innerHTML = `
    <div class="stats">
      <div class="stat"><span class="muted">Ausgegeben</span><b>${eur(bal.spent)}</b>${arrow(bal.spentDiff)}</div>
      <div class="stat"><span class="muted">Weggeworfen</span><b>${eur(bal.wasted)}</b>${bal.hasPrev ? arrow(Math.round((bal.wasted - bal.prevWasted) * 100) / 100) : ''}</div>
    </div>
    ${bal.deposit.paid || bal.deposit.back ? `<p class="muted">♻️ Pfand: ${eur(bal.deposit.paid)} bezahlt, ${eur(bal.deposit.back)} zurück (netto ${eur(bal.deposit.net)}). Ist in „Ausgegeben“ enthalten, nicht bei den Lebensmitteln.</p>` : ''}
    ${bal.hasPrev ? '' : '<p class="muted">Vergleich mit dem Vormonat erscheint, sobald es Daten aus dem Vormonat gibt.</p>'}
    ${bal.hints.length ? `<h2>Spartipps</h2><ul class="list small hints">${bal.hints.slice(0, 6).map(h => `<li><div class="main">${hintText(h)}</div></li>`).join('')}</ul>` : ''}
    <div class="seg"><button data-view="product" class="active">Je Lebensmittel</button><button data-view="cat">Je Kategorie</button></div>
    <ul id="bal-product" class="list small">${bal.byProduct.map(p => `
      <li data-key="${esc(p.key)}"><div class="main">${esc(pretty(p.key))}
        <div class="meta">${p.count}× gekauft ${arrow(p.diff)}</div>
        <table class="sizes">${p.sizes.map(v => `<tr><td>${esc(v.label)}</td><td>${v.count}×</td><td>${eur(v.total)}</td>
          <td class="muted">${v.unitPrice ? eur(v.unitPrice.value) + '/' + v.unitPrice.per : ''}</td>
          <td>${v.waste?.wasted ? `<span class="waste ${v.waste.quota >= 0.25 ? 'bad' : ''}">🗑️ ${pct(v.waste.quota)}</span>` : ''}</td></tr>`).join('')}</table>
        </div><b>${eur(p.total)}</b></li>`).join('')
      || '<li class="muted">Keine Einkäufe in diesem Monat.</li>'}</ul>
    <ul id="bal-cat" class="list small hidden">${bal.byCategory.map(c =>
      `<li><div class="main">${esc(c.category)}</div><b>${eur(c.total)}</b></li>`).join('')}</ul>
    <p class="muted">Tippe auf ein Lebensmittel, um es mit einem anderen zusammenzufassen (z. B. „Rinderhackfleisch“ → „Rinderhack“).</p>
    <button id="btn-csv">Als Tabelle (CSV) exportieren</button>`;
  const label = { bought: '🛒', eaten: '✅', wasted: '🗑️' };
  $('#log-list').innerHTML = log.filter(l => ymOf(l.at) === ym).slice(0, 200).map(l => `
    <li><span>${label[l.type]}</span><div class="main">${esc(l.itemName)} <span class="meta">${esc(l.qty)} ${esc(l.unit)}${l.size ? ' à ' + esc(l.size) : ''}</span></div>
    <span class="meta">${l.price ? eur(l.price) + ' · ' : ''}${new Date(l.at).toLocaleDateString('de-DE')}</span></li>`).join('');
}
$('#month-stats').addEventListener('click', async e => {
  const seg = e.target.closest('.seg button');
  if (seg) {
    document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('active', b === seg));
    $('#bal-product').classList.toggle('hidden', seg.dataset.view !== 'product');
    $('#bal-cat').classList.toggle('hidden', seg.dataset.view !== 'cat');
    return;
  }
  if (e.target.id === 'btn-csv' && lastBalance) {
    const blob = new Blob(['﻿' + toCSV(lastBalance, monthInput.value)], { type: 'text/csv' });
    Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `bilanz-${monthInput.value}.csv` }).click();
    return;
  }
  const li = e.target.closest('#bal-product li[data-key]');
  if (li) {
    const target = prompt(`„${pretty(li.dataset.key)}“ zusammenfassen als:`, pretty(li.dataset.key));
    if (target != null && target.trim()) {
      await store.setAlias(li.dataset.key, productKey(target));
      renderLog();
    }
  }
});

$('#btn-export').addEventListener('click', async () => {
  const blob = new Blob([JSON.stringify(await store.exportAll(), null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `speisekammer-${isoLocal()}.json` });
  a.click();
});
$('#import-file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  await store.importAll(JSON.parse(await f.text()));
  renderPantry(); renderLog();
});

// ---------- Erinnerungen (Ablauf + Abendessen) ----------
// iOS erlaubt Benachrichtigungen nur für die Web-App auf dem Home-Bildschirm (ab iOS 16.4).
// Ohne Server: Erinnerung, sobald die App nach der eingestellten Uhrzeit offen ist.
// Mit Supabase + VAPID-Schlüssel: echte Push-Nachricht zur Uhrzeit (Edge Function „reminders“).
const canNotify = () => 'Notification' in window && Notification.permission === 'granted';
const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
async function showNote(title, body, tag) {
  const reg = await navigator.serviceWorker?.getRegistration();
  reg ? reg.showNotification(title, { body, icon: 'icon.svg', tag }) : new Notification(title, { body, tag });
}
function soonText(soon) {
  return soon.slice(0, 5).map(i => { const d = daysLeft(i.expiry); return `${i.name} (${d < 0 ? 'abgelaufen' : d === 0 ? 'heute' : d === 1 ? 'morgen' : 'in ' + d + ' T'})`; }).join(', ');
}
async function soonItems() {
  return (await store.listItems()).filter(i => { const d = daysLeft(i.expiry); return d != null && d <= WARN_DAYS; })
    .sort((a, b) => daysLeft(a.expiry) - daysLeft(b.expiry));
}
// Geplantes Abendessen (plan.js kommt mit dem Essensplan; bis dahin null)
let planMod;
async function plannedDinner(date) {
  if (planMod === undefined) planMod = await import('./plan.js').catch(() => null);
  try { return planMod?.getPlannedMeal ? await planMod.getPlannedMeal(date, 'dinner') : null; } catch { return null; }
}
const hmToMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const minToHM = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fmtDur = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`;
// Wann soll heute ans Abendessen erinnert werden? { time, meal } oder null (übersprungen)
export async function dinnerReminder(date = isoLocal(), s = getSettings()) {
  const meal = await plannedDinner(date);
  if (meal?.status === 'uebersprungen') return null;
  if (s.dinnerAuto && meal?.totalMinutes > 0) return { time: minToHM(Math.max(0, hmToMin(s.dinnerAt) - meal.totalMinutes)), meal };
  return { time: s.dinnerTime, meal };
}

async function checkReminders(force = false) {
  if (!canNotify()) return;
  const s = getSettings(), today = isoLocal(), now = nowHM();
  const soon = await soonItems();
  if (s.remindExpiry && soon.length && (force || (now >= s.expiryTime && localStorage.getItem('lastNotify') !== today))) {
    localStorage.setItem('lastNotify', today);
    await showNote(`${soon.length} Artikel bald ablaufend`, soonText(soon), 'ablauf');
  }
  const dr = s.remindDinner && !force ? await dinnerReminder(today, s) : null;
  if (dr && now >= dr.time && localStorage.getItem('lastDinnerNotify') !== today) {
    localStorage.setItem('lastDinnerNotify', today);
    const m = dr.meal;
    if (m?.title && m.totalMinutes) await showNote(`Jetzt anfangen: ${m.title}`, `Dauert ${fmtDur(m.totalMinutes)}, dann ist es um ${s.dinnerAt} Uhr fertig.`, 'abendessen');
    else await showNote('Zeit fürs Abendessen', soon.length ? `Zuerst verbrauchen: ${soonText(soon.slice(0, 3))}` : 'Schau in den Vorrat, was heute weg muss.', 'abendessen');
  }
}
setInterval(checkReminders, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkReminders(); });

async function enableNotifications() {
  if (!('Notification' in window)) return pushStatus();
  const p = await Notification.requestPermission();
  if (p === 'granted') { await syncPush(); checkReminders(true); }
  pushStatus();
}
$('#btn-notify').addEventListener('click', enableNotifications);
$('#btn-push').addEventListener('click', enableNotifications);

// Push-Abo bei Supabase speichern (nur wenn eingerichtet). Uhrzeiten wandern mit.
const b64ToBytes = b => { const p = '='.repeat((4 - b.length % 4) % 4); const r = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)); };
async function syncPush() {
  if (store.mode !== 'supabase' || !VAPID_PUBLIC_KEY || !canNotify() || !('PushManager' in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription()
      ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
    const s = getSettings();
    await store.savePush(sub.toJSON(), { remindExpiry: s.remindExpiry, expiryTime: s.expiryTime, remindDinner: s.remindDinner,
      dinnerTime: s.dinnerTime, dinnerAuto: s.dinnerAuto, dinnerAt: s.dinnerAt, warnDays: WARN_DAYS, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
    return true;
  } catch (e) { console.warn('Push-Abo fehlgeschlagen', e); return false; }
}
function pushStatus() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const has = 'Notification' in window;
  const granted = has && Notification.permission === 'granted';
  const realPush = store.mode === 'supabase' && VAPID_PUBLIC_KEY;
  $('#btn-push').classList.toggle('hidden', !has || granted || Notification.permission === 'denied');
  $('#push-status').textContent =
    !has ? (standalone ? 'Dieses Gerät unterstützt keine Benachrichtigungen.' : 'Auf dem iPhone gehen Benachrichtigungen nur, wenn die App über „Teilen → Zum Home-Bildschirm“ installiert ist (ab iOS 16.4).')
    : Notification.permission === 'denied' ? 'Benachrichtigungen sind blockiert. Freigeben unter iPhone-Einstellungen → Mitteilungen → Speisekammer.'
    : !granted ? 'Einmal erlauben, dann erinnert die App zu den Uhrzeiten unten.'
    : realPush ? '✓ Erinnerungen kommen als Push-Nachricht, auch wenn die App geschlossen ist.'
    : '✓ Erlaubt. Noch ohne Server: Die Erinnerung kommt, sobald die App nach der Uhrzeit offen ist. Mit Supabase kommt sie pünktlich als Push.';
}

// ---------- Anmeldung & Haushalt (nur mit Supabase) ----------
function showGate(step) {
  $('#gate').classList.remove('hidden');
  document.querySelectorAll('#gate .step').forEach(el => el.classList.toggle('hidden', el.dataset.step !== step));
}
const gateMsg = t => $('#gate-msg').textContent = t;
async function guard(fn) { try { gateMsg(''); await fn(); } catch (e) { gateMsg(e.message); } }
const gateCreds = () => [$('#gate-email').value.trim(), $('#gate-pass').value];
$('#gate-login').addEventListener('click', () => guard(async () => { await store.signIn(...gateCreds()); await start(); }));
$('#gate-signup').addEventListener('click', () => guard(async () => {
  const [e, p] = gateCreds(); if (p.length < 6) throw new Error('Passwort bitte mit mindestens 6 Zeichen.');
  await store.signUp(e, p); await start();
}));
$('#gate-send').addEventListener('click', () => guard(async () => {
  await store.sendCode($('#gate-email').value.trim()); showGate('code'); gateMsg('Code wurde per E-Mail geschickt.');
}));
$('#gate-verify').addEventListener('click', () => guard(async () => {
  await store.verifyCode($('#gate-email').value.trim(), $('#gate-code').value.trim()); await start();
}));
$('#gate-create').addEventListener('click', () => guard(async () => { await store.createHousehold($('#gate-hh-name').value); await start(); }));
$('#gate-join').addEventListener('click', () => guard(async () => { await store.joinHousehold($('#gate-join-code').value); await start(); }));
$('#btn-logout')?.addEventListener('click', async () => { await store.signOut(); location.reload(); });

async function start() {
  const st = await store.init();
  if (st.needsLogin) return showGate('email');
  if (st.needsHousehold) return showGate('household');
  $('#gate').classList.add('hidden');
  if (store.mode === 'supabase') {
    const hh = store.household();
    $('#hh-info').innerHTML = `Haushalt <b>${esc(hh.name)}</b> · Einladungscode <b>${esc(hh.join_code)}</b>`;
    $('#account').classList.remove('hidden');
    store.onChange(() => { renderPantry(); if ($('#tab-log').classList.contains('active')) renderLog(); });
  }
  await renderPantry();
  initHealth(store, $);
  checkReminders();
  pushStatus();
  monthStartHint();
}

// In den ersten 3 Tagen eines Monats auf die Bilanz des Vormonats hinweisen
function monthStartHint() {
  const now = new Date();
  if (now.getDate() > 3) return;
  const prev = ymOf(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  if (localStorage.getItem('bilanzSeen') === prev) return;
  const name = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString('de-DE', { month: 'long' });
  $('#warn-box').insertAdjacentHTML('afterbegin', `<div class="warn info" id="bilanz-hint">📊 Die Bilanz für ${name} ist fertig. Antippen zum Ansehen.</div>`);
  $('#bilanz-hint').addEventListener('click', () => {
    localStorage.setItem('bilanzSeen', prev);
    monthInput.value = prev;
    document.querySelector('nav button[data-tab=log]').click();
  });
}

// ---------- Küche: Utensilien & Einstellungen ----------
// Annahme: Liste wird pro Gerät gespeichert (localStorage), nicht über Supabase geteilt.
const UT_KEY = 'speisekammer.utensils';
const UT_DEFAULT = [
  { name: 'Pfannen', has: true },
  { name: 'Backofen', has: true },
  { name: 'Ninja Foodi MAX (Heißluft, Druckgaren, Dampf)', has: true },
  { name: 'Herd mit Töpfen', has: true },
  { name: 'Mikrowelle', has: false },
  { name: 'Mixer / Pürierstab', has: false },
];
const loadUt = () => { try { return JSON.parse(localStorage.getItem(UT_KEY)) ?? UT_DEFAULT; } catch { return UT_DEFAULT; } };
const saveUt = u => localStorage.setItem(UT_KEY, JSON.stringify(u));
export const utensils = () => loadUt().filter(u => u.has).map(u => u.name);

function renderUtensils() {
  $('#utensil-list').innerHTML = loadUt().map((u, i) => `
    <li data-i="${i}" class="ut-row">
      <label class="main"><input type="checkbox" class="ut-has" ${u.has ? 'checked' : ''}>
        <span><span class="name">${esc(u.name)}</span>${u.note ? `<br><small class="muted">${esc(u.note)}</small>` : ''}</span></label>
      <button class="ghost ut-del" aria-label="Entfernen">✕</button>
    </li>`).join('');
}
$('#utensil-list').addEventListener('click', e => {
  const li = e.target.closest('li'); if (!li) return;
  const u = loadUt(), i = +li.dataset.i;
  if (e.target.classList.contains('ut-has')) { u[i].has = e.target.checked; delete u[i].note; }
  else if (e.target.classList.contains('ut-del')) u.splice(i, 1);
  else return;
  saveUt(u); renderUtensils();
});
$('#utensil-add').addEventListener('click', () => {
  const n = $('#utensil-new').value.trim(); if (!n) return;
  saveUt([...loadUt(), { name: n, has: true }]); $('#utensil-new').value = ''; renderUtensils();
});
$('#warn-days').value = String(WARN_DAYS);
$('#warn-days').addEventListener('change', e => { WARN_DAYS = +e.target.value; localStorage.setItem('warnDays', WARN_DAYS); renderPantry(); });
renderUtensils();

// ---------- Einkaufsliste ----------
// Annahme: pro Gerät in localStorage, Supabase folgt.
const SHOP_KEY = 'speisekammer.shopping';
const loadShop = () => { try { return JSON.parse(localStorage.getItem(SHOP_KEY)) ?? []; } catch { return []; } };
const saveShop = l => localStorage.setItem(SHOP_KEY, JSON.stringify(l));
const shopId = () => crypto.randomUUID?.() ?? String(Date.now() + Math.random());
function addShop(name) {
  name = name.trim(); if (!name) return;
  const l = loadShop();
  if (!l.some(x => !x.done && x.name.toLowerCase() === name.toLowerCase())) l.push({ id: shopId(), name, done: false });
  saveShop(l); renderShop();
}
// Listen-Hinweise lassen sich für die laufende Woche ausblenden
const weekKey = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return isoLocal(d); };
const hiddenHints = () => { try { const h = JSON.parse(localStorage.getItem('speisekammer.hintsHidden')); return h?.week === weekKey() ? h.keys : []; } catch { return []; } };
function hideHint(k) { localStorage.setItem('speisekammer.hintsHidden', JSON.stringify({ week: weekKey(), keys: [...hiddenHints(), k] })); }
const altButtons = (alts, attr) => alts?.length ? `<div class="tip-alts">${alts.map(a => `<button class="chip" ${attr}="${esc(a)}">${esc(a)}</button>`).join('')}</div>` : '';

// Angenommene Angebote (IDs), pro Gerät
const ACC_KEY = 'speisekammer.acceptedOffers';
const loadAccepted = () => { try { return new Set(JSON.parse(localStorage.getItem(ACC_KEY)) ?? []); } catch { return new Set(); } };
const saveAccepted = set => localStorage.setItem(ACC_KEY, JSON.stringify([...set]));
let curOffers = [];
const offerTag = (o, acc) => `<div class="offer-tag">🏷️ ${esc(chainName(o.chain))}: <b>${eur(o.price)}</b>${o.regular ? ` statt ${eur(o.regular)}` : ''}${o.unitPrice ? ` <span class="muted">(${eur(o.unitPrice.value)}/${esc(o.unitPrice.per)})</span>` : ''}${o.until ? ` · bis ${fmtDate(o.until)}` : ''}${o.loyalty ? ' · mit App' : ''} <span class="muted">(${esc(o.name)})</span>
  ${acc.has(o.id) ? `<button class="chip accepted" data-accept="${o.id}">✓ angenommen</button>` : `<button class="chip" data-accept="${o.id}">Annehmen</button>`}</div>`;

// Automatische Angebote einmal am Tag holen (nur mit Supabase)
let refreshing = false;
async function refreshOffers(force = false) {
  const st = getSettings();
  if (store.mode !== 'supabase' || refreshing || (!force && (!st.autoOffers || localStorage.getItem('lastOfferRefresh') === isoLocal(new Date())))) return;
  refreshing = true; renderOfferAuto('Angebote werden gesucht …');
  try {
    await store.refreshOffers(loadShop().filter(i => !i.done).map(i => i.name));
    localStorage.setItem('lastOfferRefresh', isoLocal(new Date()));
    renderOfferAuto();
  } catch (err) { renderOfferAuto(`Suche fehlgeschlagen: ${err.message}`); }
  finally { refreshing = false; renderShop(); }
}
function renderOfferAuto(msg) {
  const st = getSettings(), last = localStorage.getItem('lastOfferRefresh');
  $('#offer-auto').innerHTML = store.mode === 'supabase'
    ? `<p class="muted tiny">${msg ? esc(msg) : st.autoOffers ? `Automatisch über Marktguru (inoffiziell), täglich.${last ? ` Zuletzt: ${fmtDate(last)}.` : ''}` : 'Automatische Suche ist in den Einstellungen aus.'}</p>
       <button id="offer-refresh" ${refreshing ? 'disabled' : ''}>🔄 Angebote jetzt suchen</button>`
    : '<p class="muted tiny">Automatische Angebote (Marktguru) laufen erst, wenn Supabase eingerichtet ist. Bis dahin: Angebote selbst eintragen.</p>';
}

// Einkaufs-Check: Stammladen allein oder mit zweitem Laden?
function renderCheck(open, offers, log, st, acc) {
  const el = $('#shop-check');
  if (!open.length || !offers.length) { el.innerHTML = ''; return; }
  const r = shoppingCheck(open, offers, log, st, acc);
  const home = chainName(r.home), sec = r.second && r.second.moved.length ? r.second : null;
  if (!sec && !r.homeSavings && !r.unknown.length) { el.innerHTML = ''; return; }
  const other = sec ? chainName(sec.chain) : '';
  let verdict;
  if (st.maxStores < 2) verdict = `Alles bei ${home} (Einstellung: nur ein Laden).`;
  else if (!sec) verdict = `Kein anderer Laden ist für eure Liste günstiger. Alles bei ${home}.`;
  else if (r.worth) verdict = `<b>Lohnt sich:</b> ${other} zusätzlich spart unterm Strich <b>${eur(sec.saving)}</b>.`;
  else verdict = `<b>Lohnt sich nicht:</b> ${other} spart nur ${eur(Math.max(0, sec.saving))} (eure Grenze: ${eur(st.minSaving)}). Empfehlung: alles bei ${home}.`;
  const line = m => `<li>${esc(m.name)}: <b>${eur(m.pick.cost)}</b>${m.homePrice != null ? ` statt ${eur(m.homePrice)}` : ''}${m.worse ? ` <span class="warn-text">(${eur(m.worse)} teurer)</span>` : ''}</li>`;
  const homeNames = r.homeItems.map(i => i.name);
  el.innerHTML = `<div class="check-card ${sec && r.worth ? 'worth' : ''}">
    <b>💶 Einkaufs-Check</b>
    <p>${verdict}</p>
    ${sec && (r.worth || sec.moved.some(m => acc.has(m.pick.o.id))) ? `<p class="tiny"><b>Bei ${esc(other)}:</b></p><ul class="tiny">${sec.moved.map(line).join('')}</ul>
      <p class="tiny"><b>Bei ${esc(home)}:</b> ${homeNames.length ? homeNames.map(esc).join(', ') : 'nichts'}</p>` : ''}
    ${r.homeSavings ? `<p class="tiny">Angebote bei ${esc(home)} sparen zusätzlich ${eur(r.homeSavings)}.</p>` : ''}
    ${r.unknown.length ? `<p class="tiny muted">Ohne Vergleichspreis (noch nicht per Bon gekauft): ${r.unknown.map(esc).join(', ')}</p>` : ''}
    <p class="tiny muted">Schätzung: verglichen mit euren letzten Kassenbon-Preisen, Eigenmarken${st.ownBrandOk ? '' : ' nicht'} als gleichwertig gezählt, ohne Fahrtkosten.</p>
  </div>`;
}

async function renderShop() {
  const list = loadShop();
  const offers = curOffers = await allOffers(store);
  const acc = loadAccepted();
  const valid = new Set(offers.map(o => o.id));
  if ([...acc].some(id => !valid.has(id))) { for (const id of [...acc]) if (!valid.has(id)) acc.delete(id); saveAccepted(acc); }
  renderOffers(offers, list);
  renderOfferAuto();
  const st = getSettings();
  $('#shop-list').innerHTML = list.map(i => {
    const t = !i.done && !i.tipDismissed ? tipFor(i.name, tipsOn) : null;
    return `<li data-id="${i.id}" class="shop-item ${i.done ? 'done' : ''}">
      <div class="shop-row">
        <button class="shop-check" aria-label="Abhaken">${i.done ? '☑️' : '⬜'}</button>
        <div class="main"><div class="name">${esc(i.name)}${t?.good ? ' <span class="good-tag">✓ gute Wahl</span>' : ''}</div>
          ${t?.good && t.text ? `<div class="good-note">${esc(t.text)}</div>` : ''}
          ${!i.done ? offersFor(i.name, offers).slice(0, 3).map(o => offerTag(o, acc)).join('') : ''}</div>
        ${!i.done ? '<button class="ghost shop-offer" aria-label="Angebot eintragen" title="Angebot eintragen">🏷️</button>' : ''}
        <button class="ghost shop-del" aria-label="Entfernen">✕</button>
      </div>
      ${t && !t.good ? `<div class="tip">
        <b>💡 ${esc(t.title)}</b><p>${esc(t.text)}</p>
        ${t.alts ? `<p class="tiny muted">${t.add ? 'Dazu auf die Liste:' : 'Stattdessen:'}</p>${altButtons(t.alts, t.add ? 'data-add' : 'data-alt')}` : ''}
        ${t.details ? `<details><summary>Worauf beim Brot achten</summary><ul>${t.details.map(d => `<li>${esc(d)}</li>`).join('')}</ul></details>` : ''}
        <button class="tip-keep">Behalten, Tipp ausblenden</button>
      </div>` : ''}
    </li>`;
  }).join('');
  $('#shop-empty').classList.toggle('hidden', list.length > 0);
  $('#shop-clear').classList.toggle('hidden', !list.some(i => i.done));

  const open = list.filter(i => !i.done).map(i => i.name);
  const hidden = hiddenHints();
  const hints = listHints(open, tipsOn).filter(h => !hidden.includes(h.key));
  $('#shop-hints').innerHTML = hints.map(h => `<div class="tip hint"><b>💡 ${esc(h.title)}</b><p>${esc(h.text)}</p>${altButtons(h.alts, 'data-add')}
    <button class="tip-keep" data-hide-hint="${esc(h.key)}">Diese Woche ausblenden</button></div>`).join('');
  $('#shop-source').textContent = st.tips && (open.some(n => tipFor(n, tipsOn)) || hints.length) ? 'Tipps: ' + SOURCE : '';

  // „Wieder kaufen?“: mind. 2× in 90 Tagen gekauft, nicht im Vorrat, nicht auf der Liste
  const since = Date.now() - 90 * 86400000;
  const [log, items] = await Promise.all([store.listLog(), store.listItems()]);
  const count = {};
  for (const e of log) if (e.type === 'bought' && new Date(e.at) >= since) count[e.itemName] = (count[e.itemName] ?? 0) + 1;
  const frequent = Object.entries(count).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const onList = n => open.some(o => o.toLowerCase() === n.toLowerCase() || offersFor(o, [{ name: n, price: 0 }]).length);
  let sugg = [];
  if (st.shopSuggestions) {
    const have = new Set([...items.map(i => i.name.toLowerCase()), ...open.map(n => n.toLowerCase())]);
    sugg = frequent.filter(n => !have.has(n.toLowerCase()) && !onList(n) && !offersFor(n, offers).length).slice(0, 8);
  }
  $('#shop-suggest').innerHTML = sugg.length ? `<p class="tiny muted">Wieder kaufen? Antippen zum Hinzufügen</p>${altButtons(sugg, 'data-add')}` : '';

  // Angebots-Hinweise: oft gekaufte Produkte, die gerade im Angebot sind und nicht auf der Liste stehen
  const deals = [];
  for (const n of frequent) {
    if (onList(n)) continue;
    const o = offersFor(n, offers)[0];
    if (o && !deals.some(d => d.o.id === o.id)) deals.push({ n, o });
    if (deals.length >= 4) break;
  }
  $('#shop-deals').innerHTML = deals.map(({ n, o }) => `<div class="tip hint deal"><b>🏷️ ${esc(n)} bei ${esc(chainName(o.chain))} im Angebot</b>
    <p>${esc(o.name)}: <b>${eur(o.price)}</b>${o.regular ? ` statt ${eur(o.regular)}` : ''}${o.until ? ` · bis ${fmtDate(o.until)}` : ''}</p>
    <div class="tip-alts"><button class="chip" data-add="${esc(n)}" data-accept-add="${o.id}">＋ Liste und annehmen</button></div></div>`).join('');

  renderCheck(open, offers, log, st, acc);
}
$('#shop-add').addEventListener('click', () => { addShop($('#shop-new').value); $('#shop-new').value = ''; });
$('#shop-new').addEventListener('keydown', e => { if (e.key === 'Enter') $('#shop-add').click(); });
$('#shop-clear').addEventListener('click', () => { saveShop(loadShop().filter(i => !i.done)); renderShop(); });
$('#tab-shop').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'offer-refresh') return refreshOffers(true);
  if (b.dataset.accept) { const a = loadAccepted(); a.has(b.dataset.accept) ? a.delete(b.dataset.accept) : a.add(b.dataset.accept); saveAccepted(a); return renderShop(); }
  if (b.dataset.acceptAdd) { const a = loadAccepted(); a.add(b.dataset.acceptAdd); saveAccepted(a); }
  if (b.dataset.add) return addShop(b.dataset.add);
  if (b.dataset.hideHint) { hideHint(b.dataset.hideHint); return renderShop(); }
  const li = b.closest('li[data-id]'); if (!li) return;
  const l = loadShop(), it = l.find(x => x.id === li.dataset.id);
  if (b.classList.contains('shop-offer')) return openOffer(it.name);
  if (b.classList.contains('shop-check')) it.done = !it.done;
  else if (b.classList.contains('shop-del')) l.splice(l.indexOf(it), 1);
  else if (b.dataset.alt) { it.name = b.dataset.alt; }
  else if (b.classList.contains('tip-keep')) it.tipDismissed = true;
  else return;
  saveShop(l); renderShop();
});

// ---------- Angebote ----------
$('#offer-chains').innerHTML = CHAINS.map(c => `<a class="chip" href="${c.url}" target="_blank" rel="noopener">${esc(c.name)} ↗</a>`).join('');
let offerChain = localStorage.getItem('lastOfferChain') || 'lidl';
function renderOffers(offers, list) {
  $('#offer-list').innerHTML = offers.length ? offers.map(o => `<li data-offer="${o.id}">
      <div class="main"><b>${esc(o.name)}</b> · ${esc(chainName(o.chain))}<br><span class="muted">${eur(o.price)}${o.regular ? ` statt ${eur(o.regular)} (−${Math.round((1 - o.price / o.regular) * 100)} %)` : ''}${o.until ? ` · bis ${fmtDate(o.until)}` : ''}</span></div>
      ${list.some(i => !i.done && offersFor(i.name, [o]).length) ? '<span class="good-tag">auf der Liste</span>' : `<button class="chip offer-add">＋ Liste</button>`}
      ${o.source === 'manual' ? '<button class="ghost offer-del" aria-label="Löschen">✕</button>' : ''}</li>`).join('')
    : '<li class="muted">Noch keine Angebote.</li>';
}
function openOffer(name = '') {
  const f = $('#offer-form');
  f.reset(); f.name.value = name; f.until.value = defaultUntil(offerChain);
  const pick = () => $('#offer-chain-pick').innerHTML = CHAINS.map(c => `<button type="button" data-chain="${c.id}" class="${c.id === offerChain ? 'active' : ''}">${esc(c.name)}</button>`).join('');
  pick();
  $('#offer-chain-pick').onclick = e => { const b = e.target.closest('[data-chain]'); if (!b) return; const auto = f.until.value === defaultUntil(offerChain); offerChain = b.dataset.chain; if (auto) f.until.value = defaultUntil(offerChain); pick(); };
  const open = loadShop().filter(i => !i.done).map(i => i.name);
  $('#offer-name-sugg').innerHTML = !name && open.length ? open.slice(0, 8).map(n => `<button type="button" class="chip" data-n="${esc(n)}">${esc(n)}</button>`).join('') : '';
  $('#offer-name-sugg').onclick = e => { const b = e.target.closest('[data-n]'); if (b) f.name.value = b.dataset.n; };
  $('#offer-dialog').showModal();
}
$('#offer-new').addEventListener('click', () => openOffer());
$('#offer-dialog').addEventListener('close', () => {
  if ($('#offer-dialog').returnValue !== 'save') return;
  const f = Object.fromEntries(new FormData($('#offer-form')));
  if (!f.name.trim() || !f.price) return;
  localStorage.setItem('lastOfferChain', offerChain);
  addOffer({ chain: offerChain, name: f.name.trim(), price: +f.price, regular: f.regular ? +f.regular : null, until: f.until || null });
  renderShop();
});
$('#offer-list').addEventListener('click', e => {
  const li = e.target.closest('li[data-offer]'); if (!li) return;
  const o = curOffers.find(x => x.id === li.dataset.offer); if (!o) return;
  if (e.target.closest('.offer-del')) { deleteOffer(o.id); renderShop(); }
  else if (e.target.closest('.offer-add')) addShop(o.name);
});

// ---------- Einstellungen (Schalter) ----------
const SWITCHES = {
  '#settings-remind': [
    ['remindExpiry', 'Ablaufwarnung als Nachricht', null, null, 'expiryTime'],
    ['remindDinner', 'Erinnerung ans Abendessen', null, null, 'dinner'],
  ],
  '#settings-tips': [
    ['tips', 'Tipps und Hinweise anzeigen', 'Hauptschalter für alle Empfehlungen'],
    ['tipsBread', 'Brot, Mehl und Frühstück', null, 'tips'],
    ['tipsProduce', 'Obst und Gemüse', null, 'tips'],
    ['tipsProcessed', 'Fertigprodukte und Wurst', null, 'tips'],
    ['tipsMeat', 'Fleisch und Fisch', null, 'tips'],
  ],
  '#settings-offers': [
    ['autoOffers', 'Angebote automatisch suchen', 'Über Marktguru (inoffiziell), braucht Supabase'],
    ['ownBrandOk', 'Eigenmarke zählt als gleich', 'Bei gleicher Menge, z. B. Rewe-Hack statt Lidl-Hack'],
  ],
  '#settings-pantry': [
    ['askFreeze', 'Bei Fleisch und Fisch fragen, ob eingefroren wird'],
    ['shopSuggestions', '„Wieder kaufen?“-Vorschläge auf der Einkaufsliste'],
  ],
};
// Auswahl-Zeilen (Knöpfe statt Tippen)
const CHOICES = [
  ['homeStore', 'Stammladen', CHAINS.map(c => [c.id, c.name])],
  ['maxStores', 'Läden pro Einkauf', [[1, 'Nur einer'], [2, 'Höchstens zwei']]],
  ['minSaving', 'Zweiter Laden lohnt ab', [[1, '1 €'], [2, '2 €'], [3, '3 €'], [5, '5 €']]],
];
function renderChoices(s) {
  $('#settings-offers').insertAdjacentHTML('beforeend', CHOICES.map(([k, label, opts]) => `<li class="switch-row choice-row">
    <span>${esc(label)}</span>
    <div class="seg wrap">${opts.map(([v, t]) => `<button type="button" data-choice="${k}" data-v="${v}" class="${String(s[k]) === String(v) ? 'active' : ''}">${esc(t)}</button>`).join('')}</div>
  </li>`).join(''));
}
function renderSettings() {
  const s = getSettings();
  for (const [sel, rows] of Object.entries(SWITCHES)) {
    $(sel).innerHTML = rows.map(([k, label, sub, parent, timeKey]) => {
      const off = parent && !s[parent];
      if (timeKey === 'dinner') return `<li class="switch-row">
        <label class="main"><span>${esc(label)}</span>
        <input type="checkbox" role="switch" class="switch" data-k="${k}" ${s[k] ? 'checked' : ''}></label>
        ${s[k] ? `<label class="time-row">Essen um <input type="time" class="time-set" data-k="dinnerAt" value="${esc(s.dinnerAt)}"> Uhr</label>
        <label class="main sub-switch"><span>Automatisch nach Zubereitungszeit<br><small class="muted">z. B. Suppe mit 1 h 15 min → Erinnerung ${minToHM(Math.max(0, hmToMin(s.dinnerAt) - 75))}</small></span>
          <input type="checkbox" role="switch" class="switch" data-k="dinnerAuto" ${s.dinnerAuto ? 'checked' : ''}></label>
        <label class="time-row">${s.dinnerAuto ? 'Ohne geplantes Gericht um' : 'Erinnern um'} <input type="time" class="time-set" data-k="dinnerTime" value="${esc(s.dinnerTime)}"> Uhr</label>` : ''}
      </li>`;
      if (timeKey) return `<li class="switch-row">
        <label class="main"><span>${esc(label)}</span>
        <input type="checkbox" role="switch" class="switch" data-k="${k}" ${s[k] ? 'checked' : ''}></label>
        ${s[k] ? `<label class="time-row">um <input type="time" class="time-set" data-k="${timeKey}" value="${esc(s[timeKey])}"> Uhr</label>` : ''}
      </li>`;
      return `<li class="switch-row ${parent ? 'sub' : ''} ${off ? 'disabled' : ''}">
        <label class="main"><span>${esc(label)}${sub ? `<br><small class="muted">${esc(sub)}</small>` : ''}</span>
        <input type="checkbox" role="switch" class="switch" data-k="${k}" ${s[k] ? 'checked' : ''} ${off ? 'disabled' : ''}></label>
      </li>`;
    }).join('');
  }
  renderChoices(s);
}
$('#tab-kitchen').addEventListener('click', e => {
  const b = e.target.closest('[data-choice]'); if (!b) return;
  const v = b.dataset.v;
  setSetting(b.dataset.choice, /^\d+$/.test(v) ? +v : v);
  renderSettings();
});
$('#tab-kitchen').addEventListener('change', e => {
  if (e.target.classList.contains('switch')) setSetting(e.target.dataset.k, e.target.checked);
  else if (e.target.classList.contains('time-set') && e.target.value) {
    setSetting(e.target.dataset.k, e.target.value);
    // heute neu prüfen, falls die Uhrzeit verschoben wurde
    localStorage.removeItem(e.target.dataset.k === 'expiryTime' ? 'lastNotify' : 'lastDinnerNotify');
  } else return;
  renderSettings();
  syncPush();
});
renderSettings();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
start();
