// Barcode-Scan (EAN) mit der Handykamera + Produktdaten aus Open Food Facts.
// Open Food Facts: offene Datenbank, Daten unter ODbL. Quelle in der App nennen.
// Kamera: natives BarcodeDetector, wo vorhanden (Android/Chrome); auf dem iPhone (Safari hat es nicht)
// wird html5-qrcode nachgeladen. Ohne Kamera: Foto eines Barcodes oder Nummer eintippen.
import { guessCategory } from './categories.js';

const LIB = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
const CACHE_KEY = 'speisekammer.barcodes';
const $ = s => document.querySelector(s);

function loadLib() {
  if (window.Html5Qrcode) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = LIB; s.onload = res; s.onerror = () => rej(new Error('Scanner konnte nicht geladen werden (offline?)'));
    document.head.appendChild(s);
  });
}

const EAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

// Öffnet den Scanner im Dialog #barcode-box. Liefert den erkannten Code oder null (abgebrochen).
export async function scanBarcode() {
  const box = $('#barcode-box'), view = $('#barcode-view');
  box.showModal();
  $('#barcode-msg').textContent = 'Kamera wird gestartet …';
  let stop = () => {};
  const result = new Promise(resolve => {
    $('#barcode-cancel').onclick = () => resolve(null);
    box.oncancel = e => { e.preventDefault(); resolve(null); };
    $('#barcode-manual').onclick = () => {
      const c = $('#barcode-input').value.replace(/\D/g, '');
      if (c.length >= 8) resolve(c); else $('#barcode-msg').textContent = 'Bitte 8 bis 13 Ziffern eingeben.';
    };
    $('#barcode-file').onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { resolve(await decodeFile(f)); }
      catch { $('#barcode-msg').textContent = 'Kein Barcode im Foto erkannt. Näher ran und scharf stellen.'; }
    };
    startCamera(view, resolve).then(s => { stop = s; $('#barcode-msg').textContent = 'Barcode ins Bild halten.'; })
      .catch(err => { $('#barcode-msg').textContent = `Kamera nicht verfügbar (${err.message}). Foto wählen oder Nummer eintippen.`; });
  });
  const code = await result;
  try { await stop(); } catch {}
  view.innerHTML = '';
  box.close();
  return code;
}

async function startCamera(view, onCode) {
  if ('BarcodeDetector' in window) {
    const det = new window.BarcodeDetector({ formats: EAN_FORMATS });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = Object.assign(document.createElement('video'), { srcObject: stream, playsInline: true, muted: true });
    view.innerHTML = ''; view.appendChild(video); await video.play();
    let running = true;
    (async function loop() {
      while (running) {
        try { const r = await det.detect(video); if (r[0]) { running = false; onCode(r[0].rawValue); return; } } catch {}
        await new Promise(r => setTimeout(r, 200));
      }
    })();
    return async () => { running = false; stream.getTracks().forEach(t => t.stop()); };
  }
  await loadLib();
  view.innerHTML = '<div id="barcode-reader"></div>';
  const H = window.Html5Qrcode, F = window.Html5QrcodeSupportedFormats;
  const scanner = new H('barcode-reader', { formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E], verbose: false });
  let done = false;
  await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 140 } },
    text => { if (!done) { done = true; onCode(text); } }, () => {});
  return async () => { if (scanner.isScanning) await scanner.stop(); scanner.clear(); };
}

async function decodeFile(file) {
  if ('BarcodeDetector' in window) {
    const r = await new window.BarcodeDetector({ formats: EAN_FORMATS }).detect(await createImageBitmap(file));
    if (r[0]) return r[0].rawValue;
    throw new Error('none');
  }
  await loadLib();
  const tmp = document.createElement('div'); tmp.id = 'barcode-tmp'; tmp.hidden = true; document.body.appendChild(tmp);
  try { return await new window.Html5Qrcode('barcode-tmp').scanFile(file, false); }
  finally { tmp.remove(); }
}

// ---------- Open Food Facts ----------
const OFF_CATS = [
  [/en:(meats|poultry|fishes|seafood|sausages|hams)/, 'Fleisch & Fisch'],
  [/en:(dairies|milks|cheeses|yogurts|butters|creams)/, 'Milchprodukte'],
  [/en:eggs/, 'Eier'],
  [/en:(breads|viennoiseries|pastries)/, 'Brot & Backwaren'],
  [/en:frozen-foods/, 'Tiefkühl'],
  [/en:(fresh-fruits|fruits)\b/, 'Obst'],
  [/en:(fresh-vegetables|vegetables)\b/, 'Gemüse'],
  [/en:(canned-foods|canned)/, 'Konserven'],
  [/en:(beverages|waters|juices|sodas)/, 'Getränke'],
  [/en:(pastas|rices|cereals-and-their-products|flours|legumes|breakfast-cereals)/, 'Trockenware'],
  [/en:(condiments|sauces|spices|oils|vinegars)/, 'Gewürze & Öle'],
  [/en:(snacks|sweets|chocolates|biscuits|confectioneries)/, 'Süßes & Snacks'],
];

const loadCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) ?? {}; } catch { return {}; } };

// Liefert { name, size, category, nutrition, barcode, source } oder null, wenn unbekannt.
export async function lookupBarcode(code) {
  const cache = loadCache();
  if (cache[code]) return cache[code];
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json` +
    '?fields=product_name,product_name_de,generic_name_de,brands,quantity,nutriments,categories_tags';
  const r = await fetch(url);
  if (!r.ok && r.status !== 404) throw new Error('Open Food Facts nicht erreichbar');
  const j = await r.json();
  if (j.status !== 1 || !j.product) return null;
  const p = j.product, n = p.nutriments ?? {};
  const base = (p.product_name_de || p.product_name || p.generic_name_de || '').trim();
  const brand = (p.brands || '').split(',')[0].trim();
  const name = brand && base && !base.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${base}` : (base || brand);
  const tags = (p.categories_tags ?? []).join(' ');
  const category = OFF_CATS.find(([re]) => re.test(tags))?.[1] ?? guessCategory(name);
  const num = k => (typeof n[k] === 'number' ? Math.round(n[k] * 100) / 100 : null);
  const info = {
    barcode: code, name, size: (p.quantity || '').trim(), category, source: 'Open Food Facts',
    nutrition: { per: '100 g', kcal: num('energy-kcal_100g'), fat: num('fat_100g'), satFat: num('saturated-fat_100g'),
      carbs: num('carbohydrates_100g'), sugar: num('sugars_100g'), fiber: num('fiber_100g'),
      protein: num('proteins_100g'), salt: num('salt_100g') },
  };
  localStorage.setItem(CACHE_KEY, JSON.stringify({ ...cache, [code]: info }));
  return info;
}

export function nutritionLine(nu) {
  if (!nu) return '';
  const f = (v, u) => v == null ? null : `${String(v).replace('.', ',')} ${u}`;
  const parts = [
    nu.kcal != null && `${Math.round(nu.kcal)} kcal`, f(nu.protein, 'g Eiweiß'), f(nu.carbs, 'g KH'),
    f(nu.sugar, 'g Zucker'), f(nu.fat, 'g Fett'), f(nu.fiber, 'g Ballaststoffe'), f(nu.salt, 'g Salz'),
  ].filter(Boolean);
  return parts.length ? `Je ${nu.per ?? '100 g'}: ${parts.join(' · ')}` : '';
}
