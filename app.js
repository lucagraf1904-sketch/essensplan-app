import { localStore } from './store.js';
import { SUPABASE_URL, VAPID_PUBLIC_KEY } from './config.js';
import { CATEGORIES, guessCategory, defaultExpiry, freezeExpiry, isoLocal, PACKS, PACK_SOURCE, packExpiry, OPENED_DAYS } from './categories.js';
import { parseReceipt, ocrImage } from './receipt.js';
import { getSettings, setSetting, tipsOn, showPreset, applyShowPreset, hasOwnShow, showToHousehold, showReset } from './settings.js';
import { initShared } from './shared.js';
import { renderWeight, setWeight, weekStart } from './weight.js';
import { initPlan } from './plan.js';
import { CARDS, GROUPS, SOURCES as MED_SOURCES, PURPOSE, NOTICE, EMERGENCY, EXCLUDE_NOTE, loadMeds, saveMeds } from './meds.js';
import { shiftOf, shiftDay, SHIFTS } from './shifts.js';
import { scanBarcode, lookupBarcode, nutritionLine } from './barcode.js';
import { CHAINS, chainName, listOffers, addOffer, deleteOffer, defaultUntil, offersFor, allOffers, shoppingCheck } from './offers.js';
import { tipFor, listHints, SOURCE, ARZT } from './tips.js';
import { initEaten, openEaten, partsOf, partsLabel, partsLeft, configureParts, eatenPending } from './eaten.js';
import { initOnboarding } from './onboarding.js';
import { initAi, aiOn, parsePhoto, adaptRecipe } from './ai.js';
const moreHtml = t => t?.more?.length ? `<details class="tip-more"><summary>Mehr dazu</summary>${t.more.map(m => `<p class="tiny">${esc(m)}</p>`).join('')}${t.doc ? `<p class="tiny muted">${esc(ARZT)}</p>` : ''}</details>` : '';
import { conditionLabel, searchConditions, conditionTags } from './conditions.js';
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

// ---------- Dialoge ohne Tastatur beim Öffnen ----------
// showModal() fokussiert sonst das erste Eingabefeld, und das iPhone öffnet sofort die Tastatur.
// Die Überschrift (bzw. der Dialog selbst) bekommt den Fokus; die Tastatur kommt erst beim Antippen eines Feldes.
document.querySelectorAll('dialog').forEach(d => {
  const h = d.querySelector('h2') ?? d;
  if (!d.querySelector('[autofocus]')) { h.setAttribute('tabindex', '-1'); h.setAttribute('autofocus', ''); }
});
const _showModal = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal = function () {
  _showModal.call(this);
  const a = document.activeElement;
  if (a && this.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { a.blur(); (this.querySelector('h2') ?? this).focus?.({ preventScroll: true }); }
};

// ---------- Tabs ----------
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  $('#fab').classList.toggle('hidden', b.dataset.tab !== 'pantry');
  if (b.dataset.tab === 'log') renderLog();
  if (b.dataset.tab === 'shop') { renderShop(); refreshOffers(); }
}));

// ---------- Vorrat ----------
let pantryCache = null;
const norm = t => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss');
async function renderPantry(useCache) {
  const items = useCache === true && pantryCache ? pantryCache : (pantryCache = await store.listItems());
  const words = norm($('#search').value).split(/\s+/).filter(Boolean);
  const loc = $('#filter-loc').value;
  // Gefrierschrank-Inventar: älteste Einfrierung zuerst, mit Datum und Dauer
  const fz = loc === 'Gefrierschrank', frozeOn = i => i.frozenAt || (i.location === 'Gefrierschrank' ? (i.addedAt ?? '').slice(0, 10) : null);
  const shown = items
    .filter(i => { const hay = norm([i.name, i.category, i.location, i.size].join(' ')); return words.every(w => hay.includes(w)); })
    .filter(i => !loc || i.location === loc)
    .sort(fz ? (a, b) => (frozeOn(a) || '9').localeCompare(frozeOn(b) || '9')
             : (a, b) => (daysLeft(a.expiry) ?? 1e9) - (daysLeft(b.expiry) ?? 1e9));
  const inFreezer = items.filter(i => i.location === 'Gefrierschrank');
  const weeksAgo = d => { const w = Math.floor((Date.now() - new Date(d + 'T12:00')) / 6048e5); return w < 1 ? 'diese Woche' : w === 1 ? 'vor 1 Woche' : w < 9 ? `vor ${w} Wochen` : `vor ${Math.round(w / 4.3)} Monaten`; };
  $('#freezer-head').innerHTML = fz
    ? `<div class="freezer-sum">❄️ <b>${inFreezer.length} ${inFreezer.length === 1 ? 'Artikel' : 'Artikel'}</b> im Gefrierschrank${inFreezer.length ? ` · älteste zuerst` : ''}</div>`
    : inFreezer.length ? `<button class="chip" id="freezer-open">❄️ Gefrierschrank (${inFreezer.length})</button>` : '';

  const sh = getSettings();
  const metaFor = i => [
    sh.showQty && (partsLabel(i) ? esc(partsLabel(i)) : `${esc(+(+i.qty).toFixed(2))} ${esc(i.unit === 'Portion' && i.qty != 1 ? 'Portionen' : i.unit)}${i.size ? ' à ' + esc(i.size) : ''}`),
    sh.showCategory && esc(i.category), sh.showLocation && esc(i.location),
    sh.showPack && drinksOn() && i.pack && PACKS[i.pack] && esc(PACKS[i.pack].label),
    sh.showPrice && i.price != null && eur(i.price),
    sh.showExpiryDate && i.expiry && !i.frozenAt && `bis ${fmtDate(i.expiry)}`,
  ].filter(Boolean).join(' · ');
  $('#pantry-list').innerHTML = shown.map(i => `
    <li data-id="${i.id}">
      <div class="main">
        <div class="name">${esc(i.name)}${i.frozenAt && !sh.showFrozenDetail ? ' ❄️' : ''}</div>
        ${metaFor(i) ? `<div class="meta">${metaFor(i)}</div>` : ''}
        ${sh.showOpened && drinksOn() && i.openedAt ? `<div class="meta">🥤 Geöffnet am ${fmtDate(i.openedAt)} · gekühlt ca. ${OPENED_DAYS} Tage (Richtwert)</div>` : ''}
        ${fz && frozeOn(i) ? `<div class="meta frozen-meta">❄️ eingefroren ${fmtDate(frozeOn(i))} (${weeksAgo(frozeOn(i))})${i.expiry ? ` · bis ${fmtDate(i.expiry)}` : ''}</div>` : ''}
        ${!fz && i.frozenAt && sh.showFrozenDetail ? `<div class="meta">MHD (Kühlschrank): ${i.origExpiry ? fmtDate(i.origExpiry) : 'unbekannt'}</div>
        <div class="meta frozen-meta"><b>❄️ Tiefkühl bis ${fmtDate(i.expiry)}</b> · eingefroren ${fmtDate(i.frozenAt)}</div>` : ''}
      </div>
      ${sh.showExpiryBadge ? expiryBadge(daysLeft(i.expiry), !!i.frozenAt) : ''}
    </li>`).join('');
  $('#pantry-empty').classList.toggle('hidden', items.length > 0);
  if (!shown.length && items.length) $('#pantry-list').innerHTML = `<li class="muted">Nichts gefunden für „${esc($('#search').value)}“${loc ? ' in ' + esc(loc) : ''}.</li>`;

  const soon = items.filter(i => { const d = daysLeft(i.expiry); return d != null && d <= WARN_DAYS; });
  const soonW = soon.filter(i => !leftovers([i]).length);
  $('#warn-box').innerHTML = soonW.length && sh.showWarnBox
    ? `<div class="warn">⚠️ ${soonW.length} Artikel ${soonW.length === 1 ? 'läuft' : 'laufen'} bald ab: ${soonW.slice(0, 5).map(i => esc(i.name)).join(', ')}${soonW.length > 5 ? ' …' : ''}</div>`
    : '';
  checkMinStock(items);
  renderLeftovers(items);
  budgetWarn();
  renderDrinkCounter();
  return soon;
}
$('#search').addEventListener('input', () => renderPantry(true));
document.addEventListener('click', e => { if (e.target.id === 'freezer-open') { $('#filter-loc').value = 'Gefrierschrank'; renderPantry(); } });
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
  $('#use-opened').classList.toggle('hidden', !(drinksOn() && current.category === 'Getränke' && !current.openedAt && !frozen));
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
  } else if (v === 'parts') {
    const it = current; if (partsOf(it) || await configureParts(it)) await openEaten('manual', [it], `${it.name}: Teile entnehmen`);
    renderPantry();
  } else if (v === 'freeze') {
    await freezeItem(current, parseFloat($('#use-qty').value) || current.qty);
    renderPantry();
  } else if (v === 'thaw') {
    // Aufgetautes wie frische Ware behandeln und bald verarbeiten (LMTVet Bremen, Infoblatt 21).
    // Annahme: Fleisch & Fisch 1 Tag, alles andere 2 Tage im Kühlschrank.
    await store.upsertItem({ ...current, location: 'Kühlschrank', frozenAt: null, origExpiry: null, expiry: thawExpiry(current) });
    renderPantry();
  } else if (v === 'opened') {
    // Geöffnet: in den Kühlschrank, Richtwert OPENED_DAYS Tage (VZ: „wenige Tage gekühlt“), nie später als das MHD
    const t = new Date(); t.setDate(t.getDate() + OPENED_DAYS);
    const exp = current.expiry && current.expiry < isoLocal(t) ? current.expiry : isoLocal(t);
    await store.upsertItem({ ...current, location: 'Kühlschrank', openedAt: isoLocal(), expiry: exp });
    renderPantry();
  } else if (v === 'edit') openItem(current);
  if (v === 'eaten' && drinkLevel() >= 2) await logDrinkKcal(current, parseFloat($('#use-qty').value) || current.qty);
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

// Eingabe im Frage-Dialog (Tastatur erst beim Antippen des Feldes)
async function askInput(title, label, value = '', type = 'text', extra = '') {
  const field = type === 'textarea' ? `<textarea id="ask-input" rows="8">${esc(value)}</textarea>`
    : `<input id="ask-input" type="${type === 'number' ? 'text' : type}" ${type === 'number' ? 'inputmode="decimal"' : ''} value="${esc(value)}">`;
  const v = await ask(title, `${extra}<label class="ask-field">${esc(label)}${field}</label>`,
    [{ value: 'ok', label: 'Übernehmen', cls: 'primary' }, { value: '', label: 'Abbrechen' }]);
  return v === 'ok' ? $('#ask-input').value.trim() : null;
}
const askNumber = async (title, label, value) => { const v = await askInput(title, label, value, 'number'); const n = parseFloat(String(v ?? '').replace(',', '.')); return n > 0 ? n : null; };

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
  formExtra = { barcode: v.barcode ?? null, nutrition: v.nutrition ?? null, pack: v.pack ?? null, openedAt: v.openedAt ?? null };
  form.minStock.value = v.name ? String(minStockFor(v.name)?.min ?? '') : '';
  renderPack();
  $('#item-nutrition').textContent = nutritionLine(formExtra.nutrition);
  renderFreezeNote();
  $('#item-dialog').showModal();
}

// ---------- Barcode → Open Food Facts ----------
let formExtra = { barcode: null, nutrition: null, pack: null, openedAt: null };

// ---------- Getränke (Umfang per Einstellung: 0 aus, 1 A Vorrat+Bilanz, 2 B +kcal, 3 C +Trinkzähler) ----------
const DRINK_LEVELS = { off: 0, a: 1, b: 2, c: 3 };
const drinkLevel = () => DRINK_LEVELS[getSettings().drinks] ?? 1;
const drinksOn = () => drinkLevel() >= 1;
function renderPack() {
  const show = drinksOn() && form.category.value === 'Getränke';
  $('#pack-row').classList.toggle('hidden', !show);
  if (!show) return;
  // Knöpfe nur einmal bauen (sonst verschluckt ein Neuaufbau beim Verlassen des Namensfelds den Tipp)
  if (!$('#pack-pick').children.length) $('#pack-pick').innerHTML = Object.entries(PACKS).map(([k, p]) => `<button type="button" data-pack="${k}">${esc(p.label)}</button>`).join('');
  $('#pack-pick').querySelectorAll('[data-pack]').forEach(b => b.classList.toggle('active', b.dataset.pack === formExtra.pack));
  const p = PACKS[formExtra.pack];
  $('#pack-note').textContent = p ? `Ungeöffnet ${p.range} laut ${PACK_SOURCE}. Die App nimmt den unteren Wert. Das MHD auf der Packung geht vor.` : 'Antippen, dann wird die Haltbarkeit passend gesetzt.';
}
$('#pack-pick').addEventListener('click', e => {
  const b = e.target.closest('[data-pack]'); if (!b) return;
  formExtra.pack = b.dataset.pack;
  form.expiry.value = packExpiry(formExtra.pack);
  if (PACKS[formExtra.pack].location) form.location.value = PACKS[formExtra.pack].location;
  renderPack(); renderFreezeNote();
});
form.category.addEventListener('change', renderPack);

// Mindestbestand je Produkt (Haushalt, über shared.js): { productKey: { min, name } }
const MIN_KEY = 'speisekammer.minStock', MIN_PENDING = 'speisekammer.minPending';
const loadMin = () => { try { return JSON.parse(localStorage.getItem(MIN_KEY)) ?? {}; } catch { return {}; } };
const minStockFor = name => loadMin()[productKey(name)] ?? null;
function setMinStock(name, min) {
  const m = loadMin(), k = productKey(name); if (!k) return;
  if (min) m[k] = { min, name: pretty(k) }; else delete m[k];
  localStorage.setItem(MIN_KEY, JSON.stringify(m));
}
function checkMinStock(items) {
  const m = loadMin(); if (!Object.keys(m).length && !minNotice.length) return;
  let pending; try { pending = new Set(JSON.parse(localStorage.getItem(MIN_PENDING)) ?? []); } catch { pending = new Set(); }
  const added = [];
  for (const [k, { min, name }] of Object.entries(m)) {
    const have = items.filter(i => { const ik = productKey(i.name); return ik === k || ik.includes(k) || k.includes(ik); })
      .reduce((s, i) => s + (i.unit === 'Stk' || i.unit === 'Pck' ? (+i.qty || 0) : 1), 0);
    if (have >= min) { pending.delete(k); continue; }
    if (pending.has(k)) continue;
    const list = loadShop();
    if (!list.some(x => !x.done && productKey(x.name) === k)) { list.push({ id: shopId(), name, done: false, auto: 'min' }); saveShop(list); added.push(name); }
    pending.add(k);
  }
  localStorage.setItem(MIN_PENDING, JSON.stringify([...pending]));
  if (added.length) minNotice = [...new Set([...minNotice, ...added])];
  if (minNotice.length) $('#warn-box').insertAdjacentHTML('beforeend', `<div class="warn info" id="min-notice">🛒 Mindestbestand unterschritten, auf die Einkaufsliste gesetzt: ${minNotice.map(esc).join(', ')} <small>(antippen zum Ausblenden)</small></div>`);
}
let minNotice = [];
document.addEventListener('click', e => { if (e.target.closest('#min-notice')) { minNotice = []; e.target.closest('#min-notice').remove(); } });

// Stufe B: kcal beim Abhaken eines Getränks (aus Open-Food-Facts-Nährwerten je 100 ml/g)
async function logDrinkKcal(item, qty) {
  if (item.category !== 'Getränke' || item.nutrition?.kcal == null) return;
  const size = parseSize(item.size || item.name);
  const ml = size ? (size.unit === 'ml' || size.unit === 'g' ? size.amount : null) : null;
  if (!ml) return;
  const units = item.unit === 'Stk' || item.unit === 'Pck' ? qty : 1;
  const kcal = Math.round(item.nutrition.kcal * ml / 100 * units);
  await store.addLog({ type: 'drink', itemName: item.name, category: 'Getränke', qty: units, unit: item.unit, value: null, kcal });
}

// Stufe C: Trinkzähler (pro Gerät = pro Person), Glasgröße und Tagesziel einstellbar
const DRINK_KEY = 'speisekammer.drinkCount';
const drinkToday = () => { try { const d = JSON.parse(localStorage.getItem(DRINK_KEY)) ?? {}; return d[isoLocal()] ?? 0; } catch { return 0; } };
function addGlass(n) {
  let d; try { d = JSON.parse(localStorage.getItem(DRINK_KEY)) ?? {}; } catch { d = {}; }
  d[isoLocal()] = Math.max(0, (d[isoLocal()] ?? 0) + n);
  for (const k of Object.keys(d)) if (k < isoLocal(new Date(Date.now() - 60 * 86400000))) delete d[k]; // 60 Tage behalten
  localStorage.setItem(DRINK_KEY, JSON.stringify(d)); renderDrinkCounter();
}
async function renderDrinkCounter() {
  const el = $('#drink-counter'); if (!el) return;
  if (drinkLevel() < 3) { el.innerHTML = ''; return; }
  const s = getSettings(), n = drinkToday(), ml = n * s.glassMl, goal = s.drinkGoalMl;
  const pct = Math.min(100, Math.round(ml / goal * 100));
  el.innerHTML = `<div class="drink-card"><div class="drink-top"><b>💧 Heute getrunken: ${(ml / 1000).toLocaleString('de-DE')} l</b><span class="muted tiny">Ziel ${(goal / 1000).toLocaleString('de-DE')} l</span></div>
    <div class="drink-bar"><span style="width:${pct}%"></span></div>
    <div class="tip-alts"><button class="chip" data-glass="1">＋1 Glas (${s.glassMl} ml)</button>${n ? '<button class="chip" data-glass="-1">−1</button>' : ''}</div></div>`;
}
document.addEventListener('click', e => { const b = e.target.closest('[data-glass]'); if (b) addGlass(+b.dataset.glass); });
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
  renderPack();
});
$('#fab').addEventListener('click', () => openItem(null));
$('#item-dialog').addEventListener('close', async () => {
  const v = $('#item-dialog').returnValue;
  if (v === 'delete' && editing) await store.deleteItem(editing.id);
  if (v === 'save') {
    const f = Object.fromEntries(new FormData(form));
    const minStock = f.minStock ? +f.minStock : null; delete f.minStock;
    setMinStock(f.name, minStock);
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
  } catch (err) { $('#scan-status').textContent = 'Fehler: ' + shortErr(err.message); }
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

const drinkKcal = (log, ym) => log.filter(l => l.type === 'drink' && ymOf(l.at) === ym).reduce((s, l) => s + (l.kcal || 0), 0);
// Budget (Haushalt): Balken in der Bilanz, Warnung im Vorrat
function budgetState(spent, ym = ymOf(new Date())) {
  const s = getSettings(); if (!(s.budget > 0)) return null;
  const now = new Date(), cur = ym === ymOf(now);
  const days = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate(), day = cur ? now.getDate() : days;
  const pct = spent / s.budget, forecast = cur && day >= 5 ? spent / day * days : null;
  return { budget: s.budget, spent, pct, rest: s.budget - spent, forecast, warn: pct * 100 >= s.budgetWarnPct, over: pct >= 1, cur };
}
function budgetBar(spent, ym) {
  const b = budgetState(spent, ym); if (!b) return '';
  return `<div class="budget ${b.over ? 'over' : b.warn ? 'warn' : ''}">
    <div class="budget-top"><span>💶 Budget</span><b>${eur(b.spent)} von ${eur(b.budget)}</b></div>
    <div class="budget-bar"><i style="width:${Math.min(100, Math.round(b.pct * 100))}%"></i></div>
    <div class="tiny">${b.over ? `⚠️ Budget um ${eur(-b.rest)} überschritten.` : `Noch ${eur(b.rest)} frei (${Math.round(b.pct * 100)} % verbraucht).`}
      ${b.forecast ? ` Bei diesem Tempo ca. ${eur(Math.round(b.forecast))} bis Monatsende${b.forecast > b.budget && !b.over ? ', also drüber' : ''}.` : ''}</div>
  </div>`;
}
async function budgetWarn() {
  const s = getSettings(); if (!(s.budget > 0)) return;
  const ym = ymOf(new Date()), bal = monthReport(await store.listLog(), ym, await store.getAliases());
  const b = budgetState(bal.spent - (bal.deposit?.net ?? 0), ym); if (!b?.warn) return;
  const tag = `${ym}:${b.over ? 'over' : 'warn'}`;
  if (localStorage.getItem('budgetHidden') === tag) return;
  $('#warn-box').insertAdjacentHTML('beforeend', `<div class="warn ${b.over ? '' : 'info'}" id="budget-warn" data-tag="${tag}">💶 ${b.over ? `Monatsbudget überschritten: ${eur(b.spent)} von ${eur(b.budget)}.` : `${Math.round(b.pct * 100)} % vom Monatsbudget verbraucht, noch ${eur(b.rest)} frei.`} <small>(antippen zum Ausblenden)</small></div>`);
}
document.addEventListener('click', e => { const w = e.target.closest('#budget-warn'); if (w) { localStorage.setItem('budgetHidden', w.dataset.tag); w.remove(); } });

async function renderLog() {
  const [rawLog, aliases] = await Promise.all([store.listLog(), store.getAliases()]);
  const log = rawLog.slice().sort((a, b) => b.at.localeCompare(a.at));
  const ym = monthInput.value || ymOf(new Date());
  const bal = lastBalance = monthReport(log, ym, aliases);
  const pct = q => Math.round(q * 100) + ' %';
  const sh = getSettings();
  const arrow = d => !bal.hasPrev || !sh.showBalCompare ? '' : Math.abs(d) < 0.01 ? '<span class="diff">±0</span>'
    : `<span class="diff ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲ +' : '▼ '}${eur(d)}</span>`;
  const hintText = h => h.kind === 'waste'
    ? `🗑️ <b>${esc(pretty(h.key))} ${esc(h.label)}</b>: ${pct(h.quota)} weggeworfen (${eur(h.wasted)}). Kleinere Packung oder seltener kaufen.`
    : `💡 <b>${esc(pretty(h.key))}</b>: Nur in ${esc(h.best)} gekauft (${eur(h.unitPrice.value)}/${h.unitPrice.per}) wären es ${eur(h.saving)} weniger gewesen.`;
  $('#month-stats').innerHTML = `${budgetBar(bal.spent - (bal.deposit?.net ?? 0), ym)}
    <div class="stats">
      <div class="stat"><span class="muted">Ausgegeben</span><b>${eur(bal.spent)}</b>${arrow(bal.spentDiff)}</div>
      <div class="stat"><span class="muted">Weggeworfen</span><b>${eur(bal.wasted)}</b>${bal.hasPrev ? arrow(Math.round((bal.wasted - bal.prevWasted) * 100) / 100) : ''}</div>
    </div>
    ${drinksOn() ? (d => d ? `<p class="muted">🥤 Getränke: <b>${eur(d.total)}</b> (ohne Pfand)${drinkLevel() >= 2 && drinkKcal(rawLog, ym) ? ` · ca. ${drinkKcal(rawLog, ym)} kcal aus abgehakten Getränken` : ''}</p>` : '')(bal.byCategory.find(c => c.category === 'Getränke')) : ''}
    ${bal.deposit.paid || bal.deposit.back ? `<p class="muted">♻️ Pfand: ${eur(bal.deposit.paid)} bezahlt, ${eur(bal.deposit.back)} zurück (netto ${eur(bal.deposit.net)}). Ist in „Ausgegeben“ enthalten, nicht bei den Lebensmitteln.</p>` : ''}
    ${bal.hasPrev || !sh.showBalCompare ? '' : '<p class="muted">Vergleich mit dem Vormonat erscheint, sobald es Daten aus dem Vormonat gibt.</p>'}
    ${bal.hints.length && sh.showBalHints ? `<h2>Spartipps</h2><ul class="list small hints">${bal.hints.slice(0, 6).map(h => `<li><div class="main">${hintText(h)}</div></li>`).join('')}</ul>` : ''}
    <div class="seg"><button data-view="product" class="active">Je Lebensmittel</button><button data-view="cat">Je Kategorie</button></div>
    <ul id="bal-product" class="list small">${bal.byProduct.map(p => `
      <li data-key="${esc(p.key)}"><div class="main">${esc(pretty(p.key))}
        <div class="meta">${p.count}× gekauft ${arrow(p.diff)}</div>
        <table class="sizes">${p.sizes.map(v => `<tr><td>${esc(v.label)}</td><td>${v.count}×</td><td>${eur(v.total)}</td>
          <td class="muted">${v.unitPrice && sh.showUnitPrice ? eur(v.unitPrice.value) + '/' + v.unitPrice.per : ''}</td>
          <td>${v.waste?.wasted && sh.showWaste ? `<span class="waste ${v.waste.quota >= 0.25 ? 'bad' : ''}">🗑️ ${pct(v.waste.quota)}</span>` : ''}</td></tr>`).join('')}</table>
        </div><b>${eur(p.total)}</b></li>`).join('')
      || '<li class="muted">Keine Einkäufe in diesem Monat.</li>'}</ul>
    <ul id="bal-cat" class="list small hidden">${bal.byCategory.map(c =>
      `<li><div class="main">${esc(c.category)}</div><b>${eur(c.total)}</b></li>`).join('')}</ul>
    <p class="muted">Tippe auf ein Lebensmittel, um es mit einem anderen zusammenzufassen (z. B. „Rinderhackfleisch“ → „Rinderhack“).</p>
    <button id="btn-csv">Als Tabelle (CSV) exportieren</button>`;
  const label = { bought: '🛒', eaten: '✅', wasted: '🗑️', drink: '🥤' };
  $('#log-list').innerHTML = log.filter(l => ymOf(l.at) === ym && (l.type !== 'drink' || drinkLevel() >= 2)).slice(0, 200).map(l => `
    <li><span>${label[l.type]}</span><div class="main">${esc(l.itemName)} <span class="meta">${esc(l.qty)} ${esc(l.unit)}${l.size ? ' à ' + esc(l.size) : ''}</span></div>
    <span class="meta">${l.kcal ? l.kcal + ' kcal · ' : ''}${l.price ? eur(l.price) + ' · ' : ''}${new Date(l.at).toLocaleDateString('de-DE')}</span></li>`).join('');
}
$('#weight-box').addEventListener('click', async e => {
  if (e.target.id !== 'weight-add') return;
  const cur = JSON.parse(localStorage.getItem('speisekammer.weight') ?? '{}')[weekStart()];
  const n = await askNumber('Gewicht diese Woche', 'kg, z. B. 78,4', cur ?? ''); if (!n) return;
  setWeight(n); renderWeight($('#weight-box'), true);
});
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
  // Eigener Dienstplan: Spätschicht = warm vor Dienstbeginn (Annahme 12 Uhr), sonst normal
  const sd = s.shiftsOn && s.myName ? shiftDay(s.myName, date) : null, shift = sd?.code ?? '';
  // Spätschicht mit eigener Mahlzeit vor Dienstbeginn: 30 min vorher erinnern
  if (shift === 'S' && sd.main && sd.main < sd.from) return { time: minToHM(Math.max(0, hmToMin(sd.main) - 30)), meal: null, shift, sd };
  if (sd?.main) s = { ...s, dinnerAt: sd.main }; // eigene Essenszeit an diesem Tag
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
    if (dr.shift === 'S') await showNote('Vor der Spätschicht', `Um ${dr.sd.main} warm essen (z. B. die Portion von gestern)${dr.sd.snack ? ' und eine Dose für die Pause einpacken' : ''}.`, 'abendessen');
    else if (s.shiftsOn && s.myName && shiftOf(s.myName, today) === 'N' && m?.title) await showNote(`Vor der Nachtschicht: ${m.title}`, `Leicht essen und eine kleine Dose für die Nacht vorbereiten. Dauert ${fmtDur(m.totalMinutes)}.`, 'abendessen');
    else if (m?.title && m.totalMinutes) await showNote(`Jetzt anfangen: ${m.title}`, `Dauert ${fmtDur(m.totalMinutes)}, dann ist es um ${s.dinnerAt} Uhr fertig.`, 'abendessen');
    else if (leftovers(await store.listItems()).length) await showNote('Zeit fürs Abendessen', `Reste im Kühlschrank: ${leftovers(await store.listItems()).map(i => i.name.replace(/^Rest: /, '')).join(', ')}. Gut durcherhitzen.`, 'abendessen');
    else await showNote('Zeit fürs Abendessen', soon.length ? `Zuerst verbrauchen: ${soonText(soon.slice(0, 3))}` : 'Schau in den Vorrat, was heute weg muss.', 'abendessen');
  }
}
setInterval(checkReminders, 60000);

// ---------- Reste vom Abendessen ----------
// Nach dem Kochen (Plan: „Gekocht“) bzw. abends ab Essenszeit + 90 min einmal am Tag fragen.
// Kühlschrank: höchstens 2 Tage (Verbraucherzentrale, „Speisereste“, Stand 02.12.2025), schnell abgedeckt kühlen, gut durcherhitzen.
async function askLeftover(title = 'Abendessen', date = isoLocal(), fromPlan = false) {
  localStorage.setItem('leftoverAsked', date);
  const first = await ask('Alles aufgegessen?', `🍽️ ${esc(title)}`, [
    { value: 'all', label: '✅ Ja, alles aufgegessen', cls: 'primary' },
    { value: 'rest', label: '🍲 Nein, es ist etwas übrig' },
    ...(fromPlan ? [] : [{ value: 'none', label: 'Heute nicht gekocht' }]),
  ]);
  if (first !== 'rest') return;
  const n = await ask('Wie viel ist übrig?', esc(title), [
    { value: '1', label: '1 Portion' }, { value: '2', label: '2 Portionen' }, { value: '3', label: '3 oder mehr' }]);
  if (!n) return;
  const what = await ask('Was passiert mit dem Rest?', `${esc(title)} · ${n === '3' ? '3+' : n} ${n === '1' ? 'Portion' : 'Portionen'}`, [
    { value: 'tomorrow', label: '🥡 Morgen essen (Kühlschrank)', cls: 'primary' },
    { value: 'freeze', label: '❄️ Einfrieren' },
    { value: 'waste', label: '🗑️ Wegwerfen', cls: 'danger' }]);
  // Ohne Essensplan ist das Gericht unbekannt: Datum als Name (antippen im Vorrat zum Umbenennen)
  const name = title === 'Abendessen' ? `Rest vom ${['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(date + 'T12:00').getDay()]}. ${fmtDate(date)}` : `Rest: ${title}`, qty = +n;
  if (what === 'tomorrow' || what === 'freeze') {
    const item = { name, category: 'Reste', location: 'Kühlschrank', qty, unit: 'Portion', size: '', price: null,
      expiry: defaultExpiry('Reste', new Date(date + 'T12:00')), cookedAt: date, noLog: true };
    const saved = await store.upsertItem(item);
    if (what === 'freeze') await freezeItem(saved, qty);
    await renderPantry(); document.dispatchEvent(new Event('pantry:changed'));
    await ask(what === 'freeze' ? 'Rest eingefroren' : 'Rest steht morgen bereit',
      what === 'freeze' ? `${esc(name)} liegt im Gefrierschrank, empfohlen bis ${fmtDate(freezeExpiry({ name, category: 'Reste' }).date)} (Annahme ohne Quelle).`
        : `${esc(name)} liegt im Kühlschrank. Innerhalb von 2 Tagen essen, vorher gut durcherhitzen. Schnell und abgedeckt in den Kühlschrank stellen.<br><small class="muted">Quelle: Verbraucherzentrale (Speisereste, Stand 02.12.2025)</small>`,
      [{ value: 'ok', label: 'OK', cls: 'primary' }]);
  } else if (what === 'waste') {
    await store.addLog({ type: 'wasted', itemName: name, category: 'Reste', qty, unit: 'Portion', value: null });
  }
}
// Reste im Kühlschrank: oben im Vorrat als Vorschlag fürs nächste Abendessen
const leftovers = items => items.filter(i => i.category === 'Reste' && !i.frozenAt && i.qty > 0);
function renderLeftovers(items) {
  const rs = leftovers(items); if (!rs.length) return;
  $('#warn-box').insertAdjacentHTML('afterbegin', rs.map(i => {
    const d = daysLeft(i.expiry), when = d == null ? '' : d < 0 ? 'abgelaufen' : d === 0 ? 'heute essen' : d === 1 ? 'bis morgen' : `noch ${d} Tage`;
    return `<div class="warn info leftover" data-left="${i.id}">🍲 <b>${esc(i.name)}</b> · ${esc(i.qty)} ${i.qty === 1 ? 'Portion' : 'Portionen'}${when ? ' · ' + when : ''}
      <div class="tip-alts"><button class="chip" data-left-act="eat">🍽️ Gegessen</button><button class="chip" data-left-act="freeze">❄️ Einfrieren</button><button class="chip" data-left-act="waste">🗑️ Weggeworfen</button></div></div>`;
  }).join(''));
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-left-act]'); if (!b) return;
  const id = b.closest('[data-left]').dataset.left;
  const it = (await store.listItems()).find(x => x.id === id); if (!it) return;
  if (b.dataset.leftAct === 'freeze') await freezeItem(it, it.qty);
  else await store.consume(id, it.qty, b.dataset.leftAct === 'eat' ? 'eaten' : 'wasted');
  await renderPantry(); document.dispatchEvent(new Event('pantry:changed'));
});
// Aus dem (Demo-)Essensplan: „Gekocht“ getippt
document.addEventListener('plan:cooked', e => { if (getSettings().askLeftovers) askLeftover(e.detail.title, e.detail.date, true); });
document.addEventListener('plan:leftoverEaten', async e => {
  const it = (await store.listItems()).find(x => x.id === e.detail.id);
  if (it) { await store.consume(it.id, it.qty, 'eaten'); await renderPantry(); document.dispatchEvent(new Event('pantry:changed')); }
});
// Abends einmal fragen, falls nicht schon über den Plan geschehen
async function checkLeftoverPrompt() {
  const s = getSettings(), today = isoLocal();
  if (!s.askLeftovers || localStorage.getItem('leftoverAsked') === today || $('dialog[open]') || eatenPending()) return;
  if (nowHM() < minToHM(hmToMin(s.dinnerAt) + 90)) return;
  let meal = null;
  try { const m = await import('./plan.js'); meal = await m.getPlannedMeal?.(today, 'dinner'); } catch {}
  if (meal?.status === 'uebersprungen' || meal?.status === 'gekocht') return;
  askLeftover(meal?.title ?? 'Abendessen', today);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkLeftoverPrompt(); });
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
let pushTimer;
async function syncPush() {
  if (store.mode !== 'supabase' || !VAPID_PUBLIC_KEY || !canNotify() || !('PushManager' in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription()
      ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
    const s = getSettings();
    await store.savePush(sub.toJSON(), { remindExpiry: s.remindExpiry, expiryTime: s.expiryTime, remindDinner: s.remindDinner,
      dinnerTime: s.dinnerTime, dinnerAuto: s.dinnerAuto, dinnerAt: s.dinnerAt, warnDays: WARN_DAYS,
      askEatenBf: s.askEatenBf, eatenBfTime: s.eatenBfTime, askEatenDin: s.askEatenDin, eatenDinTime: s.eatenDinTime, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
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
// Fehler beim Start (z. B. Haushalt nicht lesbar) sichtbar machen statt wieder nach dem Haushalt zu fragen
$('#gate-join').addEventListener('click', () => guard(async () => { await store.joinHousehold($('#gate-join-code').value); await start(); }));
$('#btn-logout')?.addEventListener('click', async () => { await store.signOut(); location.reload(); });

let planStarted = false;
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
    // Mindestbestand, Einstellungen, Einkaufsliste usw. für den ganzen Haushalt
    await initShared(store, key => {
      if (key === 'warnDays') { WARN_DAYS = +(localStorage.getItem('warnDays') ?? 3); $('#warn-days').value = String(WARN_DAYS); }
      renderSettings(); renderPantry(); renderUtensils();
      if ($('#tab-shop').classList.contains('active')) renderShop();
      document.dispatchEvent(new CustomEvent('shared:changed', { detail: { key } }));
    }).catch(e => console.warn('Gemeinsame Daten', e));
    WARN_DAYS = +(localStorage.getItem('warnDays') ?? 3); $('#warn-days').value = String(WARN_DAYS); renderSettings(); renderUtensils();
  }
  await renderPantry();
  if (!planStarted) {
    initOnboarding({ store, getSettings, setSetting, ut: { load: loadUt, save: saveUt }, scanBarcode, lookupBarcode, askInput, openItem: () => openItem(null),
      applyExcludes: (want, known) => {
        const label = w => known.find(k => k[0] === w)?.[1] ?? w;
        for (const w of want) if (!isExcluded(w)) toggleExclude(w, label(w), 'Einrichtung');
        for (const e of [...excludes()]) if (!want.has(e.w) && (e.from === 'Einrichtung' || known.some(k => k[0] === e.w))) toggleExclude(e.w, e.label, e.from);
      },
      refresh: () => { renderPantry(); renderSettings(); renderUtensils(); document.dispatchEvent(new CustomEvent('pantry:changed')); } });
  }
  initEaten({ store, ask, askInput, renderPantry, getSettings, nowHM, canNotify, showNote, afterDinnerAsk: () => checkLeftoverPrompt() });
  if (!planStarted) { planStarted = true; initPlan({ store, ask, askInput, partsOf, partsLeft, openEaten, configureParts, aiRecipePhoto, aiAdapt: adaptRecipe, allOffers: () => allOffers(store), addShop, renderPantry, setSetting }); }
  initHealth(store, $);
  checkReminders();
  pushStatus();
  monthStartHint();
  setTimeout(checkLeftoverPrompt, 1500);
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
// Mit Supabase für den ganzen Haushalt geteilt (shared.js).
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
  setTimeout(() => renderSummaries(getSettings()), 0);
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
$('#warn-days').addEventListener('change', e => { WARN_DAYS = +e.target.value; localStorage.setItem('warnDays', WARN_DAYS); renderPantry(); renderSummaries(getSettings()); });
renderUtensils();

// ---------- Einkaufsliste ----------
// Mit Supabase für den ganzen Haushalt geteilt und live abgeglichen (shared.js, eintragsweise zusammengeführt).
const SHOP_KEY = 'speisekammer.shopping';
const loadShop = () => { try { return JSON.parse(localStorage.getItem(SHOP_KEY)) ?? []; } catch { return []; } };
const saveShop = l => localStorage.setItem(SHOP_KEY, JSON.stringify(l));
const shopId = () => crypto.randomUUID?.() ?? String(Date.now() + Math.random());
function addShop(name) {
  name = name.trim(); if (!name) return false;
  const l = loadShop();
  if (l.some(x => !x.done && x.name.toLowerCase() === name.toLowerCase())) return false;
  l.push({ id: shopId(), name, done: false });
  saveShop(l); renderShop(); return true;
}
// Listen-Hinweise lassen sich für die laufende Woche ausblenden
const weekKey = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return isoLocal(d); };
const hiddenHints = () => { try { const h = JSON.parse(localStorage.getItem('speisekammer.hintsHidden')); return h?.week === weekKey() ? h.keys : []; } catch { return []; } };
function hideHint(k) { localStorage.setItem('speisekammer.hintsHidden', JSON.stringify({ week: weekKey(), keys: [...hiddenHints(), k] })); }
const altButtons = (alts, attr) => alts?.length ? `<div class="tip-alts">${alts.map(a => `<button class="chip" ${attr}="${esc(a)}">${esc(a)}</button>`).join('')}</div>` : '';

// Angenommene Angebote (IDs), für den Haushalt (shared.js)
const ACC_KEY = 'speisekammer.acceptedOffers';
const loadAccepted = () => { try { return new Set(JSON.parse(localStorage.getItem(ACC_KEY)) ?? []); } catch { return new Set(); } };
const saveAccepted = set => localStorage.setItem(ACC_KEY, JSON.stringify([...set]));
let curOffers = [];
const offerTag = (o, acc) => `<div class="offer-tag">🏷️ ${esc(chainName(o.chain))}: <b>${eur(o.price)}</b>${o.regular ? ` statt ${eur(o.regular)}` : ''}${o.unitPrice ? ` <span class="muted">(${eur(o.unitPrice.value)}/${esc(o.unitPrice.per)})</span>` : ''}${o.until ? ` · bis ${fmtDate(o.until)}` : ''}${o.loyalty ? ' · mit App' : ''} <span class="muted">(${esc(o.name)})</span>
  ${acc.has(o.id) ? `<button class="chip accepted" data-accept="${o.id}">✓ angenommen</button>` : `<button class="chip" data-accept="${o.id}">Annehmen</button>`}</div>`;

// Automatische Angebote einmal am Tag holen (nur mit Supabase)
let refreshing = false, offerErr = '', offerInfo = '';
async function refreshOffers(force = false) {
  const st = getSettings();
  if (store.mode !== 'supabase' || refreshing || (!force && (!st.autoOffers || localStorage.getItem('lastOfferRefresh') === isoLocal(new Date())))) return;
  refreshing = true; offerErr = ''; renderOfferAuto('Angebote werden gesucht …');
  try {
    const res = await store.refreshOffers(loadShop().filter(i => !i.done).map(i => i.name));
    offerInfo = `Letzte Suche: ${res?.found ?? 0} Angebote gefunden${res?.errors ? `, ${res.errors} Abfragen fehlgeschlagen` : ''}.`;
    localStorage.setItem('lastOfferRefresh', isoLocal(new Date()));
    renderOfferAuto();
  } catch (err) { offerErr = `Suche fehlgeschlagen: ${err.message}`; renderOfferAuto(); }
  finally { refreshing = false; renderShop(); }
}
function renderOfferAuto(msg) {
  const st = getSettings(), last = localStorage.getItem('lastOfferRefresh');
  $('#offer-auto').innerHTML = store.mode === 'supabase'
    ? `<p class="muted tiny">${offerErr ? `<b class="offer-err">${esc(offerErr)}</b>` : offerInfo ? `<b>${esc(offerInfo)}</b>` : ''} ${msg ? esc(msg) : st.autoOffers ? `Automatisch über Marktguru (inoffiziell), täglich.${last ? ` Zuletzt: ${fmtDate(last)}.` : ''}` : 'Automatische Suche ist in den Einstellungen aus.'}</p>
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

// Ladenweg: Reihenfolge der Abteilungen je Laden (Haushalt, über shared.js). Standard = typischer Discounter-Weg (Annahme).
const LAYOUT_KEY = 'speisekammer.layout';
const AISLES = ['Obst', 'Gemüse', 'Brot & Backwaren', 'Milchprodukte', 'Eier', 'Fleisch & Fisch', 'Trockenware', 'Konserven',
  'Gewürze & Öle', 'Süßes & Snacks', 'Getränke', 'Tiefkühl', 'Haushalt', 'Sonstiges'];
const loadLayouts = () => { try { return JSON.parse(localStorage.getItem(LAYOUT_KEY)) ?? {}; } catch { return {}; } };
const layoutStore = () => getSettings().shopLayoutStore || getSettings().homeStore;
function layoutFor(storeId = layoutStore()) {
  const own = loadLayouts()[storeId] ?? [];
  return [...own.filter(a => AISLES.includes(a)), ...AISLES.filter(a => !own.includes(a))];
}
const aisleOf = i => i.aisle || (c => AISLES.includes(c) ? c : 'Sonstiges')(guessCategory(i.name));
let layoutEdit = false;
function renderShopSort(list) {
  const st = getSettings(), order = layoutFor();
  $('#shop-sort').innerHTML = !list.length ? '' : `<div class="seg wrap shop-sort-seg">
      <button type="button" data-shopsort="aisle" class="${st.shopSort === 'aisle' ? 'active' : ''}">🧭 Nach Ladenweg</button>
      <button type="button" data-shopsort="added" class="${st.shopSort !== 'aisle' ? 'active' : ''}">Wie eingetragen</button></div>
    ${st.shopSort === 'aisle' ? `<div class="tiny muted shop-sort-store">Weg für <b>${esc(chainName(layoutStore()))}</b>
      <button type="button" class="chip" data-layout-store>Laden wechseln</button>
      <button type="button" class="chip" data-layout-edit>${layoutEdit ? 'Fertig' : 'Reihenfolge ändern'}</button></div>` : ''}
    ${layoutEdit ? `<ol class="list small layout-edit">${order.map((a, i) => `<li><span class="main">${i + 1}. ${esc(a)}</span>
      <button type="button" class="ghost" data-aisle-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Nach oben">↑</button>
      <button type="button" class="ghost" data-aisle-move="${i}" data-dir="1" ${i === order.length - 1 ? 'disabled' : ''} aria-label="Nach unten">↓</button></li>`).join('')}</ol>
      <p class="tiny muted">So, wie ihr durch den Laden geht. Gilt für den ganzen Haushalt.</p>` : ''}`;
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-shopsort],[data-layout-edit],[data-layout-store],[data-aisle-move],[data-set-aisle]'); if (!b) return;
  if (b.dataset.shopsort) { setSetting('shopSort', b.dataset.shopsort); layoutEdit = false; }
  else if ('layoutEdit' in b.dataset) layoutEdit = !layoutEdit;
  else if ('layoutStore' in b.dataset) {
    const v = await ask('Ladenweg für welchen Laden?', 'Jeder Laden hat seine eigene Reihenfolge.', CHAINS.map(c => ({ value: c.id, label: c.name, cls: c.id === layoutStore() ? 'primary' : '' })));
    if (v) setSetting('shopLayoutStore', v);
  } else if (b.dataset.aisleMove) {
    const order = layoutFor(), i = +b.dataset.aisleMove, j = i + +b.dataset.dir;
    [order[i], order[j]] = [order[j], order[i]];
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...loadLayouts(), [layoutStore()]: order }));
  } else if (b.dataset.setAisle) {
    const l = loadShop(), it = l.find(x => x.id === b.dataset.setAisle); if (!it) return;
    const v = await ask(`${it.name}: welche Abteilung?`, 'Die App merkt sich das für diesen Eintrag.', layoutFor().map(a => ({ value: a, label: a, cls: a === aisleOf(it) ? 'primary' : '' })));
    if (!v) return; it.aisle = v; saveShop(l);
  }
  renderShop();
});

async function renderShop() {
  const list = loadShop();
  const offers = curOffers = await allOffers(store);
  const acc = loadAccepted();
  const valid = new Set(offers.map(o => o.id));
  if ([...acc].some(id => !valid.has(id))) { for (const id of [...acc]) if (!valid.has(id)) acc.delete(id); saveAccepted(acc); }
  renderOffers(offers, list);
  renderOfferAuto();
  const st = getSettings();
  renderShopSort(list);
  // Nach Ladenweg: offene Einträge nach Abteilung, erledigte unten
  const byAisle = st.shopSort === 'aisle';
  const order = layoutFor(), rank = i => order.indexOf(aisleOf(i));
  const sorted = byAisle ? [...list.filter(i => !i.done).sort((a, b) => rank(a) - rank(b)), ...list.filter(i => i.done)] : list;
  let lastAisle = null;
  $('#shop-list').innerHTML = sorted.map(i => {
    const head = byAisle && !i.done && aisleOf(i) !== lastAisle ? `<li class="aisle-head">${esc(lastAisle = aisleOf(i))}</li>` : byAisle && i.done && lastAisle !== '✓' ? (lastAisle = '✓', '<li class="aisle-head">Erledigt</li>') : '';
    const t = !i.done && !i.tipDismissed ? tipFor(i.name, tipsOn) : null;
    return `${head}<li data-id="${i.id}" class="shop-item ${i.done ? 'done' : ''}">
      <div class="shop-row">
        <button class="shop-check" aria-label="Abhaken">${i.done ? '☑️' : '⬜'}</button>
        <div class="main"><div class="name">${esc(i.name)}${t?.good && st.showGoodNote ? ' <span class="good-tag">✓ gute Wahl</span>' : ''}</div>
          ${t?.good && t.text && st.showGoodNote ? `<div class="good-note">${esc(t.text)}${moreHtml(t)}</div>` : ''}
          ${!i.done && st.showOfferTags ? offersFor(i.name, offers).slice(0, 3).map(o => offerTag(o, acc)).join('') : ''}</div>
        ${!i.done && byAisle ? `<button class="ghost" data-set-aisle="${i.id}" aria-label="Abteilung ändern" title="Abteilung ändern">🧭</button>` : ''}
        ${!i.done ? '<button class="ghost shop-offer" aria-label="Angebot eintragen" title="Angebot eintragen">🏷️</button>' : ''}
        <button class="ghost shop-del" aria-label="Entfernen">✕</button>
      </div>
      ${t && !t.good ? `<div class="tip">
        <b>💡 ${esc(t.title)}</b><p>${esc(t.text)}</p>
        ${t.alts ? `<p class="tiny muted">${t.add ? 'Dazu auf die Liste:' : 'Stattdessen:'}</p>${altButtons(t.alts, t.add ? 'data-add' : 'data-alt')}` : ''}
        ${t.details ? `<details><summary>Worauf beim Brot achten</summary><ul>${t.details.map(d => `<li>${esc(d)}</li>`).join('')}</ul></details>` : ''}
        ${t.excl ? `<p class="tiny muted">${esc(EXCLUDE_NOTE)}</p><div class="tip-alts">${t.excl.map(([w, l]) => exclBtn(w, l, 'Tipp')).join('')}</div>` : ''}
        ${moreHtml(t)}
        <button class="tip-keep">Behalten, Tipp ausblenden</button>
      </div>` : ''}
    </li>`;
  }).join('');
  $('#shop-empty').classList.toggle('hidden', list.length > 0);
  $('#shop-clear').classList.toggle('hidden', !list.some(i => i.done));

  const open = list.filter(i => !i.done).map(i => i.name);
  const hidden = hiddenHints();
  const hints = listHints(open, tipsOn).filter(h => !hidden.includes(h.key));
  $('#shop-hints').innerHTML = hints.map(h => `<div class="tip hint"><b>💡 ${esc(h.title)}</b><p>${esc(h.text)}</p>${altButtons(h.alts, 'data-add')}${moreHtml(h)}
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
  if (!st.showDeals) deals.length = 0;
  $('#shop-deals').innerHTML = deals.map(({ n, o }) => `<div class="tip hint deal"><b>🏷️ ${esc(n)} bei ${esc(chainName(o.chain))} im Angebot</b>
    <p>${esc(o.name)}: <b>${eur(o.price)}</b>${o.regular ? ` statt ${eur(o.regular)}` : ''}${o.until ? ` · bis ${fmtDate(o.until)}` : ''}</p>
    <div class="tip-alts"><button class="chip" data-add="${esc(n)}" data-accept-add="${o.id}">＋ Liste und annehmen</button></div></div>`).join('');

  if (st.showCheck) renderCheck(open, offers, log, st, acc); else $('#shop-check').innerHTML = '';
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
  '#settings-show': [
    ['_h', 'Vorrat'],
    ['showQty', 'Menge und Packungsgröße'], ['showCategory', 'Kategorie'], ['showLocation', 'Lagerort'],
    ['showExpiryBadge', 'Restlaufzeit („noch 3 T“)'], ['showExpiryDate', 'Ablaufdatum als Datum'], ['showPrice', 'Preis'],
    ['showFrozenDetail', 'Einfrier-Details (altes MHD, Datum)'], ['showPack', 'Verpackung bei Getränken'], ['showOpened', '„Geöffnet am …“ bei Getränken'],
    ['showWarnBox', 'Hinweis oben: läuft bald ab'],
    ['_h', 'Einkaufsliste'],
    ['tips', 'Tipps zu Lebensmitteln'], ['showGoodNote', '„Gute Wahl“-Bestätigung'], ['shopSuggestions', '„Wieder kaufen?“-Vorschläge'],
    ['showOfferTags', 'Angebote am Artikel'], ['showDeals', 'Angebots-Hinweise für oft Gekauftes'], ['showCheck', 'Einkaufs-Check (lohnt ein zweiter Laden?)'],
    ['_h', 'Verlauf & Bilanz'],
    ['showBalCompare', 'Vergleich mit dem Vormonat'], ['showBalHints', 'Spartipps'], ['showUnitPrice', 'Grundpreis (€/kg, €/l)'], ['showWaste', 'Wegwerf-Quote'],
  ],
  '#settings-me': [
    ['weightOn', 'Gewicht eintragen (einmal pro Woche)', 'Kurve unter „Verlauf“, ohne Bewertung. Nur für dich sichtbar.'],
    ['shiftsOn', 'Dienstplan nutzen', 'Früh, Spät, Nacht, Frei: Essenszeiten und Erinnerungen passen sich an'],
    ['shiftTips', 'Tipps zur Schicht anzeigen', 'Kurze Hinweise passend zu Schicht und euren Zeiten', 'shiftsOn'],
    ['workNoFridge', 'Kein Kühlschrank auf der Arbeit', 'Mitnehm-Essen, das ungekühlt hält', 'shiftsOn'],
    ['workNoMicrowave', 'Keine Mikrowelle auf der Arbeit', 'Mitnehm-Essen, das kalt schmeckt', 'shiftsOn'],
  ],
  '#settings-plan': [
    ['planHealthRules', 'Wochenregeln im Plan', 'Die Zahlen stellst du im Wochenplan unter „Wochenziele“ ein (Standard: 2× Fisch, höchstens 1× Rind)'],
  ],
  '#settings-ai': [
    ['aiOn', 'KI-Assistent nutzen', 'Chat (🤖 oben), Gericht anpassen, Fotos einlesen. Braucht Konto und Internet.'],
  ],
  '#settings-pantry': [
    ['askFreeze', 'Bei Fleisch und Fisch fragen, ob eingefroren wird'],
    ['askLeftovers', 'Nach dem Abendessen nach Resten fragen'],
    ['askEatenBf', 'Nachfragen: Was hast du gefrühstückt?', null, null, 'eatenBfTime'],
    ['askEatenDin', 'Nachfragen: Was wurde zum Abendessen gegessen?', null, null, 'eatenDinTime'],
  ],
};
// Gesundheit (nur auf diesem Gerät) & Vorlieben (Haushalt). Erkrankungen über ein Suchfeld mit Vorschlägen,
// Vorlieben als Knöpfe. Steuert Zusatzhinweise in den Tipps (tips.js extra) und später den Essensplan.
const PREFS = [['wenigWeizen', 'Wenig Weizen'], ['keinSchwein', 'Kein Schweinefleisch'], ['wenigFleisch', 'Wenig Fleisch'], ['vegetarisch', 'Vegetarisch']];
// ---------- Ausschlüsse im Essensplan (nur per eigenem Tipp) ----------
// Grundregel (Luca 23.11.): Erkrankungen und Medikamente ändern den Plan nie automatisch. Die App zeigt Infos und Vorschläge,
// die Person schließt Lebensmittel selbst per Knopf aus.
const excludes = () => getSettings().planExclude ?? [];
const isExcluded = w => excludes().some(e => e.w === w);
function toggleExclude(w, label, from) {
  setSetting('planExclude', isExcluded(w) ? excludes().filter(e => e.w !== w) : [...excludes(), { w, label, from }]);
  document.dispatchEvent(new CustomEvent('shared:changed', { detail: { key: 'speisekammer.plan' } }));
}
const exclBtn = (w, label, from) => `<button type="button" class="chip ${isExcluded(w) ? 'accepted' : ''}" data-excl="${esc(w)}" data-excl-label="${esc(label)}" data-excl-from="${esc(from)}">${isExcluded(w) ? `✓ ${esc(label)} ausgeschlossen · wieder erlauben` : `${esc(label)} im Essensplan ausschließen`}</button>`;
// Vorschläge zu Erkrankungen: nur Knöpfe, nichts passiert automatisch
const HEALTH_SUGGEST = {
  gluten: { title: 'Zöliakie', text: 'Glutenhaltig sind z. B. Weizen, Dinkel, Roggen und Gerste. Wenn du möchtest, nimm sie hier selbst aus dem Plan; die Gerichte prüfst du bitte trotzdem selbst.',
    ex: [['weizen', 'Weizen'], ['dinkel', 'Dinkel'], ['roggen', 'Roggen'], ['gerste', 'Gerste']] },
  laktose: { title: 'Laktoseintoleranz', text: 'Wie viel Laktose vertragen wird, ist sehr verschieden. Wenn du möchtest, nimm einzelne Milchprodukte hier selbst aus dem Plan (das trifft auch laktosefreie Varianten mit gleichem Namen).',
    ex: [['milch', 'Milch'], ['sahne', 'Sahne'], ['quark', 'Quark'], ['joghurt', 'Joghurt']] },
};
function renderExcludes() {
  const ex = excludes();
  return `<li class="set-sub">Ausschlüsse im Essensplan</li>
    <li class="tiny muted">${esc(EXCLUDE_NOTE)}</li>
    <li><div class="tip-alts">${ex.map(e => `<button type="button" class="chip accepted" data-excl="${esc(e.w)}">${esc(e.label)} ✕</button>`).join('') || '<span class="tiny muted">Nichts ausgeschlossen.</span>'}
      <button type="button" class="chip" id="excl-add">＋ Lebensmittel ausschließen</button></div></li>`;
}
function renderMeds() {
  const m = loadMeds(), el = $('#settings-meds'); if (!el) return;
  if (!m.ack) {
    el.innerHTML = `<div class="tip hint"><b>ℹ️ Nur zur Information</b><p>${esc(NOTICE)}</p><button type="button" class="primary" id="meds-ack">Verstanden</button></div>
      <p class="tiny muted">${esc(PURPOSE)}</p>`;
    return;
  }
  const mine = m.filter ? CARDS.filter(c => c.groups.some(g => m.groups.includes(g))) : [];
  const rest = CARDS.filter(c => !mine.includes(c));
  const card = c => `<div class="tip med-card"><b>${esc(c.title)}</b>${c.groups.length ? `<p class="tiny muted">Betrifft: ${c.groups.map(g => esc(GROUPS[g])).join('; ')}</p>` : ''}
    <p>${esc(c.text)}</p>${c.exclude ? `<div class="tip-alts">${c.exclude.map(([w, l]) => exclBtn(w, l, 'Info-Karte')).join('')}</div>` : ''}
    <p class="tiny muted">Allgemeine Information, keine persönliche Beratung. Quelle: ${(q => `<a href="${q.url}" target="_blank" rel="noopener">${esc(q.label)}</a> (Stand ${esc(q.stand)}, geprüft ${q.checked})`)(MED_SOURCES[c.src] ?? MED_SOURCES.vz)}</p></div>`;
  el.innerHTML = `<p class="tiny muted">Allgemeine Hinweise, welche Lebensmittel bestimmte Arzneimittelgruppen beeinflussen können. Die App ändert deinen Essensplan dadurch nicht. ${esc(EXCLUDE_NOTE)}</p>
    <ul class="list settings"><li class="switch-row"><label class="main"><span>Meine Wirkstoffgruppen zuerst zeigen<br><small class="muted">Freiwillig, nur auf diesem Handy gespeichert. Filtert nur die Karten.</small></span>
      <input type="checkbox" role="switch" class="switch" id="meds-filter" ${m.filter ? 'checked' : ''}></label></li></ul>
    ${m.filter ? `<div class="tip-alts">${Object.entries(GROUPS).map(([g, l]) => `<button type="button" class="chip ${m.groups.includes(g) ? 'accepted' : ''}" data-med-group="${g}">${m.groups.includes(g) ? '✓ ' : ''}${esc(l)}</button>`).join('')}</div>` : ''}
    ${mine.length ? `<p class="set-sub">Zu deinen Gruppen</p>${mine.map(card).join('')}<p class="set-sub">Weitere Hinweise</p>` : ''}
    ${rest.map(card).join('')}
    <p class="tiny"><b>${esc(EMERGENCY)}</b></p>
    <p class="tiny muted">Nimmst du mehrere Medikamente, frag in der Apotheke nach einer Medikationsanalyse. ${esc(PURPOSE)}</p>`;
}
function renderProfile(s) {
  const health = s.health ?? [], prefs = s.prefs ?? [];
  $('#settings-profile').innerHTML = `<p class="tiny muted">Erkrankungen und Unverträglichkeiten</p>
    <div class="tip-alts">${health.map(id => `<button type="button" class="chip accepted" data-health-del="${esc(id)}">${esc(conditionLabel(id))} ✕</button>`).join('') || '<span class="tiny muted">Keine Angabe</span>'}</div>
    <div class="cond-search"><input id="cond-q" type="search" placeholder="Suchen, z. B. „M“ für Morbus Crohn, Migräne …" autocomplete="off" enterkeyhint="search">
    <ul id="cond-sugg" class="cond-sugg"></ul></div>
    ${(() => { const tags = [...new Set(conditionTags(health))].filter(t => HEALTH_SUGGEST[t]); return tags.length ? `<p class="tiny muted">Vorschläge zu deinen Angaben (die App ändert den Plan nicht selbst):</p>${tags.map(t => `<div class="tip"><b>${esc(HEALTH_SUGGEST[t].title)}</b><p>${esc(HEALTH_SUGGEST[t].text)}</p><div class="tip-alts">${HEALTH_SUGGEST[t].ex.map(([w, l]) => exclBtn(w, l, 'Vorschlag')).join('')}</div></div>`).join('')}` : ''; })()}
    <p class="tiny muted">Vorlieben (antippen, mehrere möglich)</p>
    <div class="tip-alts">${PREFS.map(([v, t]) => `<button type="button" class="chip ${prefs.includes(v) ? 'accepted' : ''}" data-profile="prefs" data-v="${v}">${prefs.includes(v) ? '✓ ' : ''}${esc(t)}</button>`).join('')}</div>
    <p class="tiny muted">Freiwillig, alles kann leer bleiben. Erkrankungen werden nur auf diesem Gerät gespeichert und nie hochgeladen; Vorlieben gelten für den ganzen Haushalt. Ohne Angabe sind alle Tipps allgemein; mit Angabe kommen passende Zusatzhinweise. Den Essensplan ändern Erkrankungen nicht: Du passt ihn selbst an, z. B. mit den Knöpfen oben oder unter Essensplan → Ausschlüsse. Ersetzt keine ärztliche Beratung; bei Erkrankungen die Ernährung mit Arzt oder Ernährungsfachkraft absprechen.</p>`;
}
function renderCondSugg() {
  const q = $('#cond-q')?.value ?? '', health = getSettings().health ?? [];
  const hits = searchConditions(q, health).slice(0, 8);
  const own = q.trim().length >= 3 && !hits.some(c => c.label.toLowerCase() === q.trim().toLowerCase()) && !health.includes(q.trim());
  $('#cond-sugg').innerHTML = hits.map(c => `<li><button type="button" data-health-add="${c.id}">${esc(c.label)}</button></li>`).join('')
    + (own ? `<li><button type="button" class="muted" data-health-add="${esc(q.trim())}">„${esc(q.trim())}“ als eigene Angabe hinzufügen</button></li>` : '');
}
document.addEventListener('input', e => { if (e.target.id === 'cond-q') renderCondSugg(); });
function setHealth(fn) { setSetting('health', fn(getSettings().health ?? [])); renderSettings(); }

// Kurzfassung je Bereich (zugeklappt sichtbar)
function renderSummaries(s) {
  const on = (b, t) => b ? t : null, join = a => a.filter(Boolean).join(' · ');
  const n = (s.health ?? []).length + (s.prefs ?? []).length;
  const sum = {
    profile: n ? join([...(s.health ?? []).map(conditionLabel), ...(s.prefs ?? []).map(p => PREFS.find(x => x[0] === p)?.[1] ?? p)]) : 'Keine Angaben',
    remind: join([on(s.remindExpiry, `Ablauf ${s.expiryTime}`), on(s.remindDinner, s.dinnerAuto ? `Abendessen automatisch (Essen ${s.dinnerAt})` : `Abendessen ${s.dinnerTime}`)]) || 'Aus',
    pantry: join([`Warnung ${WARN_DAYS} ${WARN_DAYS === 1 ? 'Tag' : 'Tage'} vorher`, on(s.askFreeze, 'Einfrier-Frage'), on(s.shopSuggestions, 'Wieder kaufen')]),
    tips: s.tips ? 'An' : 'Aus',
    ai: s.aiOn !== false ? 'An' : 'Aus',
    show: { minimal: 'Minimal: nur das Nötigste', normal: 'Normal', alles: 'Alles anzeigen', eigene: 'Eigene Auswahl' }[showPreset(s)],
    drinks: { off: 'Aus', a: 'A: Vorrat + Bilanz', b: 'B: + kcal', c: 'C: + Trinkzähler' }[s.drinks] ?? 'A: Vorrat + Bilanz',
    plan: join([s.planHealthRules ? 'Wochenregeln an' : 'Wochenregeln aus', (s.planExclude ?? []).length ? `${s.planExclude.length} ausgeschlossen` : null]),
    meds: loadMeds().ack ? (loadMeds().filter && loadMeds().groups.length ? `${loadMeds().groups.length} Gruppen gewählt (nur dieses Handy)` : 'Info-Karten') : 'Nur zur Information',
    me: join([s.myName || null, on(s.weightOn, 'Gewicht'), on(s.shiftsOn, 'Dienstplan')]) || 'Nichts aktiv',
    budget: s.budget > 0 ? `${eur(s.budget)} im Monat, Warnung ab ${s.budgetWarnPct} %` : 'Aus',
    offers: join([`Stammladen ${chainName(s.homeStore)}`, s.maxStores >= 2 ? `2. Laden ab ${eur(s.minSaving)}` : 'nur ein Laden', on(s.autoOffers, 'automatisch')]),
    kitchen: (() => { const u = loadUt().filter(x => x.has); return `${u.length} Geräte`; })(),
  };
  for (const [k, t] of Object.entries(sum)) { const el = $('#sum-' + k); if (el) el.textContent = t; }
}
// Immer nur ein Bereich offen
document.querySelectorAll('.set-group').forEach(d => d.addEventListener('toggle', () => {
  if (d.open) document.querySelectorAll('.set-group').forEach(o => { if (o !== d) o.open = false; });
}));

// Auswahl-Zeilen (Knöpfe statt Tippen)
const CHOICES = [
  ['drinks', 'Umfang', [['off', 'Aus'], ['a', 'A: Vorrat + Bilanz'], ['b', 'B: + kcal'], ['c', 'C: + Trinkzähler']], '#settings-drinks'],
  ['glassMl', 'Glasgröße', [[200, '200 ml'], [250, '250 ml'], [300, '300 ml'], [500, '0,5 l']], '#settings-drinks', s => s.drinks === 'c'],
  ['drinkGoalMl', 'Tagesziel (DGE-Richtwert 1,5 l)', [[1500, '1,5 l'], [2000, '2 l'], [2500, '2,5 l']], '#settings-drinks', s => s.drinks === 'c'],
  ['homeStore', 'Stammladen', CHAINS.map(c => [c.id, c.name])],
  ['maxStores', 'Läden pro Einkauf', [[1, 'Nur einer'], [2, 'Höchstens zwei']]],
  ['minSaving', 'Zweiter Laden lohnt ab', [[1, '1 €'], [2, '2 €'], [3, '3 €'], [5, '5 €']]],
  ['budget', 'Monatsbudget', [[0, 'Aus'], [200, '200 €'], [300, '300 €'], [400, '400 €'], [500, '500 €'], [600, '600 €'], [800, '800 €'], ['own', 'Eigener Betrag']], '#settings-budget'],
  ['budgetWarnPct', 'Warnen ab', [[70, '70 %'], [80, '80 %'], [90, '90 %'], [100, 'erst bei 100 %']], '#settings-budget', s => s.budget > 0],
];
function renderChoices(s) {
  $('#settings-drinks').innerHTML = ''; $('#settings-budget').innerHTML = '';
  for (const [k, label, opts, target = '#settings-offers', when] of CHOICES) {
    if (when && !when(s)) continue;
    $(target).insertAdjacentHTML('beforeend', `<li class="switch-row choice-row">
    <span>${esc(label)}</span>
    <div class="seg wrap">${opts.map(([v, t]) => `<button type="button" data-choice="${k}" data-v="${v}" class="${String(s[k]) === String(v) || (v === 'own' && !opts.some(o => String(o[0]) === String(s[k]))) ? 'active' : ''}">${esc(t)}${v === 'own' && !opts.some(o => String(o[0]) === String(s[k])) ? `: ${esc(s[k])} €` : ''}</button>`).join('')}</div>
  </li>`);
  }
  const info = { off: 'Getränke werden wie alles andere behandelt.', a: 'Haltbarkeit je Verpackung, Knopf „Geöffnet“, eigene Zeile in der Bilanz.',
    b: 'Wie A, dazu kcal beim Abhaken (nur mit Nährwerten aus dem Barcode-Scan).', c: 'Wie B, dazu ein Trinkzähler im Vorrat (pro Handy, also pro Person).' };
  $('#settings-drinks').insertAdjacentHTML('beforeend', `<li class="tiny muted">${esc(info[s.drinks] ?? info.a)} Beim Zurückschalten geht nichts verloren, es wird nur ausgeblendet.</li>`);
}
function renderSettings() {
  const s = getSettings();
  for (const [sel, rows] of Object.entries(SWITCHES)) {
    $(sel).innerHTML = rows.map(([k, label, sub, parent, timeKey]) => {
      if (k === '_h') return `<li class="set-sub">${esc(label)}</li>`;
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
  document.body.classList.toggle('no-ai', !aiOn());
  renderChoices(s);
  renderProfile(s);
  $('#settings-me').insertAdjacentHTML('afterbegin', `<li class="switch-row"><span class="main">Dein Name<br><small class="muted">Für den Dienstplan, z. B. „Luca“</small></span>
    <button type="button" class="chip" id="me-name">${s.myName ? esc(s.myName) + ' ✎' : 'Eintragen'}</button></li>`);
  renderWeight($('#weight-box'), s.weightOn);
  $('#settings-plan').insertAdjacentHTML('beforeend', renderExcludes());
  renderMeds();
  const pre = showPreset(s);
  $('#show-preset').innerHTML = [['minimal', 'Minimal'], ['normal', 'Normal'], ['alles', 'Alles']].map(([v, t]) =>
    `<button type="button" data-preset="${v}" class="${pre === v ? 'active' : ''}">${t}</button>`).join('') + (pre === 'eigene' ? '<button type="button" class="active" disabled>Eigene</button>' : '');
  $('#show-scope').innerHTML = hasOwnShow()
    ? `<p class="muted">Das ist deine eigene Anzeige. Die anderen im Haushalt sehen den Haushalts-Standard.</p>
       <div class="tip-alts"><button type="button" class="chip" data-show-scope="hh">Als Standard für alle übernehmen</button><button type="button" class="chip" data-show-scope="reset">Haushalts-Standard verwenden</button></div>`
    : '<p class="muted">Du siehst den Haushalts-Standard. Änderst du etwas, gilt es nur für dich.</p>';
  renderSummaries(s);
}
$('#tab-kitchen').addEventListener('click', async e => {
  const ex = e.target.closest('[data-excl]');
  if (ex) { const cur = excludes().find(x => x.w === ex.dataset.excl); toggleExclude(ex.dataset.excl, ex.dataset.exclLabel || cur?.label || ex.dataset.excl, ex.dataset.exclFrom || cur?.from || ''); renderSettings(); return; }
  if (e.target.closest('#excl-add')) {
    const t = await askInput('Lebensmittel ausschließen', 'z. B. „Pilze“ oder „Grapefruit“', ''); if (!t) return;
    const w = t.toLowerCase().trim(); if (!isExcluded(w)) toggleExclude(w, t.trim(), 'selbst eingetragen'); renderSettings(); return;
  }
  if (e.target.closest('#meds-ack')) { saveMeds({ ...loadMeds(), ack: true }); renderSettings(); return; }
  const mg = e.target.closest('[data-med-group]');
  if (mg) { const m = loadMeds(), g = mg.dataset.medGroup; m.groups = m.groups.includes(g) ? m.groups.filter(x => x !== g) : [...m.groups, g]; saveMeds(m); renderSettings(); return; }
  if (e.target.closest('#me-name')) { const n = await askInput('Dein Name', 'Name', getSettings().myName); if (n != null) { setSetting('myName', n); renderSettings(); } return; }
  const sc = e.target.closest('[data-show-scope]');
  if (sc) { sc.dataset.showScope === 'hh' ? showToHousehold() : showReset(); renderSettings(); renderPantry(); return; }
  const pr = e.target.closest('[data-preset]');
  if (pr) { applyShowPreset(pr.dataset.preset); renderSettings(); renderPantry(); return; }
  const ha = e.target.closest('[data-health-add]');
  if (ha) return setHealth(h => [...new Set([...h, ha.dataset.healthAdd])]);
  const hd = e.target.closest('[data-health-del]');
  if (hd) return setHealth(h => h.filter(x => x !== hd.dataset.healthDel));
  const pb = e.target.closest('[data-profile]');
  if (pb) {
    const k = pb.dataset.profile, cur = new Set(getSettings()[k] ?? []);
    cur.has(pb.dataset.v) ? cur.delete(pb.dataset.v) : cur.add(pb.dataset.v);
    setSetting(k, [...cur]); return renderSettings();
  }
  const b = e.target.closest('[data-choice]'); if (!b) return;
  let v = b.dataset.v;
  if (v === 'own') {
    const n = await askNumber('Eigenes Monatsbudget', 'Betrag in Euro', getSettings().budget || ''); if (!n) return;
    v = String(Math.round(n));
  }
  setSetting(b.dataset.choice, /^\d+$/.test(v) ? +v : v);
  renderSettings(); renderPantry();
});
$('#tab-kitchen').addEventListener('change', e => {
  if (e.target.id === 'meds-filter') { saveMeds({ ...loadMeds(), filter: e.target.checked }); return renderSettings(); }
  if (e.target.classList.contains('switch')) setSetting(e.target.dataset.k, e.target.checked);
  else if (e.target.classList.contains('time-set') && e.target.value) {
    setSetting(e.target.dataset.k, e.target.value);
    // heute neu prüfen, falls die Uhrzeit verschoben wurde
    localStorage.removeItem(e.target.dataset.k === 'expiryTime' ? 'lastNotify' : 'lastDinnerNotify');
    // Nicht neu zeichnen: Sonst schließt sich die Zeitauswahl bei jedem Drehen am iPhone (Luca 23.11.)
    clearTimeout(pushTimer); pushTimer = setTimeout(syncPush, 1500);
    return;
  } else return;
  renderSettings();
  renderPantry();
  syncPush();
});

// ---------- KI (ai.js): Chat, Gericht anpassen, Fotos einlesen ----------
// Fehlertexte kürzen: Server-Antworten können lang und ohne Leerzeichen sein (JSON), das sprengt sonst den Dialog
function shortErr(m, n = 160) { const s = String(m ?? '').replace(/\s+/g, ' ').trim(); try { const j = JSON.parse(s.slice(s.indexOf('{'))); if (j?.error || j?.message) return String(j.error ?? j.message).slice(0, n); } catch { /* kein JSON */ } return s.length > n ? s.slice(0, n) + ' …' : s; }
document.addEventListener('shared:error', e => toast(`Speichern beim Server fehlgeschlagen: ${String(e.detail.message).slice(0, 120)}`, 6000));
document.addEventListener('shared:saved', e => { if (e.detail.key === 'speisekammer.settings') toast('Einstellung gespeichert ✓', 1500); });
function showDebug() {
  const el = $('#app-version'); if (!el) return;
  const g = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return localStorage.getItem(k); } };
  const d = g('speisekammer.dbg'), d2 = g('speisekammer.dbg2'), d3 = g('speisekammer.dbg3'), t = s => s ? String(s).slice(11, 19) : '–';
  el.textContent = `Version v54 · Start ${t(d?.at)}: ${d?.diff?.length ? 'Server überschrieb ' + d.diff.join('; ') : 'nichts überschrieben'} · zuletzt gesendet ${t(d2?.at)} (${d2?.key?.replace('speisekammer.', '') ?? '–'}) · beim Server angekommen ${t(d3)}`;
}
document.addEventListener('shared:saved', showDebug); document.addEventListener('shared:error', e => { const el = $('#app-version'); if (el) el.textContent = 'Speicherfehler: ' + e.detail.message; });
setTimeout(showDebug, 3000);
function toast(msg, ms = 2500) {
  let t = document.getElementById('plan-toast');
  if (!t) { t = Object.assign(document.createElement('div'), { id: 'plan-toast' }); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
}
// Kontext für die KI: Vorrat (bald Ablaufendes zuerst), Geräte, Vorlieben. Keine Gesundheitsangaben (die gehen nur pro Anfrage mit).
async function aiContext() {
  const items = (await store.listItems()).filter(i => i.qty > 0).sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999')).slice(0, 60);
  return {
    pantry: items.map(i => `${i.name} (${i.qty} ${i.unit}${i.expiry ? ', MHD ' + i.expiry : ''}${i.location === 'Gefrierschrank' ? ', TK' : ''})`),
    utensils: loadUt().filter(u => u.has).map(u => u.name),
    prefs: (getSettings().prefs ?? []).map(p => PREFS.find(x => x[0] === p)?.[1] ?? p),
  };
}
// Foto-Auswahl per Knopfdruck (iPhone: Kamera oder Mediathek)
function pickPhoto() {
  return new Promise(resolve => {
    const i = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
    i.addEventListener('change', () => resolve(i.files[0] ?? null)); i.addEventListener('cancel', () => resolve(null));
    i.click();
  });
}
const aiFail = (e, what) => ask(`${what} hat nicht geklappt`, esc(e.message) + (e.detail ? `<details class="tiny muted"><summary>Technische Details</summary>${esc(e.detail)}</details>` : ''), [{ value: 'ok', label: 'OK' }]);
async function aiRecipePhoto() {
  const f = await pickPhoto(); if (!f) return null;
  toast('🤖 Rezept wird gelesen …', 8000);
  try {
    const d = await parsePhoto('recipe', f);
    if (!d.title && !d.ingredients.length) { await ask('Kein Rezept erkannt', 'Auf dem Foto war kein lesbares Rezept. Tipp: gerade, gut beleuchtet, nur das Rezept im Bild.', [{ value: 'ok', label: 'OK' }]); return null; }
    return d;
  } catch (e) { await aiFail(e, 'Foto-Einlesen'); return null; }
}
$('#scan-ai-file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  $('#scan-status').textContent = '🤖 Bon wird gelesen …';
  try {
    const d = await parsePhoto('receipt', f), date = new Date();
    scanned = [...d.items.map(x => { const category = guessCategory(x.name);
      return { name: x.name, size: x.size || parseSize(x.name)?.label || '', price: x.price, qty: x.qty, unit: x.unit, category, expiry: defaultExpiry(category, date), selected: category !== 'Haushalt' }; }),
      ...d.deposit.map(x => ({ name: x.name, size: '', price: x.price, qty: 1, unit: 'Stk', category: 'Pfand', expiry: '', selected: false, deposit: true }))];
    $('#scan-status').textContent = scanned.length ? `${scanned.length} Positionen von der KI gelesen. Bitte Namen, Preise und Mengen prüfen, Haltbarkeit ist geschätzt.` : 'Keine Positionen erkannt. Versuche ein geraderes Foto.';
    renderScan();
  } catch (err) { $('#scan-status').textContent = 'Fehler: ' + shortErr(err.message); }
});
$('#pack-ai-file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const msg = t => $('#item-nutrition').textContent = t;
  msg('🤖 Verpackung wird gelesen …');
  try {
    const d = await parsePhoto('package', f);
    if (!d.name) return msg('Auf dem Foto war nichts Lesbares. Bitte Namen eintragen.');
    form.name.value = d.name; if (d.size) form.size.value = d.size;
    const cat = guessCategory(d.name); form.category.value = cat;
    if (!editing) form.location.value = CATEGORIES[cat]?.location ?? form.location.value;
    if (d.bestBefore) form.expiry.value = d.bestBefore; else if (!editing && !form.expiry.value) form.expiry.value = defaultExpiry(cat);
    msg(`Von der KI gelesen${d.bestBefore ? '' : ', Mindesthaltbarkeit nicht erkannt (geschätzt)'}. Bitte prüfen.`);
  } catch (err) { msg('Foto konnte nicht gelesen werden: ' + shortErr(err.message)); }
});
initAi({ store, ask, toast, context: aiContext });

renderSettings();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
start().catch(e => { showGate('email'); gateMsg('Fehler beim Start: ' + e.message); });
// Ausschluss-Knopf in Einkaufs-Tipps (z. B. Grapefruit): wirkt nur durch eigenen Tipp
document.addEventListener('click', e => {
  const ex = e.target.closest('#shop-list [data-excl]'); if (!ex) return;
  toggleExclude(ex.dataset.excl, ex.dataset.exclLabel, ex.dataset.exclFrom); renderShop();
});
$('#onb-restart')?.addEventListener('click', () => window.__startOnboarding?.());
