// Auswertung von Kassenbon-Text (Lidl-Format, funktioniert grob auch für andere Märkte).
// Typische Lidl-Zeilen:
//   "Bio Vollmilch 3,8%        1,19 A"
//   "  2 x 0,89"                      (Mengenzeile zum vorherigen Artikel)
//   "  0,512 kg x 2,99 EUR/kg"        (Gewichtszeile)
//   "Pfand 0,25 EUR             0,25 B"
//   "Preisvorteil              -0,30"
//   "Leergut                   -1,50"       (Rückgabe, auch "Pfandbon"/"Pfandrückgabe")
// Das genaue Layout habe ich nicht an echten Bons verifiziert; die Regeln sind bewusst tolerant.
import { guessCategory, defaultExpiry } from './categories.js';
import { parseSize } from './balance.js';

const SKIP = /(summe|zu zahlen|gesamt|mwst|netto|brutto|kartenzahlung|girocard|visa|mastercard|bar\b|gegeben|rückgeld|ruckgeld|lidl plus|coupon|rabatt|preisvorteil|pfand|leergut|eur\/kg|steuer|bon-nr|filiale|kasse|uhrzeit|datum|tse|beleg)/i;
const PRICE_LINE = /^(.*?[A-Za-zÄÖÜäöüß].*?)\s+(-?\d{1,4}[,.]\d{2})\s*(?:€|EUR)?\s*[AB]?\s*\*?$/;
const QTY_LINE = /^\s*(\d+)\s*[xX×*]\s*(\d{1,4}[,.]\d{2})/;
const WEIGHT_LINE = /^\s*(\d+[,.]\d{1,3})\s*kg\s*[xX×*]/i;
const DEPOSIT_LINE = /(pfand|leergut)/i;
const LAST_AMOUNT = /(-?\d{1,4}[,.]\d{2})\s*(?:€|EUR)?\s*[AB]?\s*\*?$/i;
const DISCOUNT_LINE = /^(.*?)\s+(-\d{1,4}[,.]\d{2})\s*[AB]?\s*$/;
const num = s => parseFloat(s.replace(',', '.'));

export function parseReceipt(text, date = new Date()) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;

    const q = line.match(QTY_LINE);
    if (q && out.length && !/[A-Za-zÄÖÜäöüß]{3,}/.test(line)) {
      out[out.length - 1].qty = parseInt(q[1], 10);
      continue;
    }
    const w = line.match(WEIGHT_LINE);
    if (w && out.length) {
      out[out.length - 1].qty = num(w[1]);
      out[out.length - 1].unit = 'kg';
      continue;
    }
    // Rabatte vom letzten Artikel abziehen
    const d = line.match(DISCOUNT_LINE);
    if (d && out.length && /(preisvorteil|rabatt|coupon|lidl plus)/i.test(d[1])) {
      // auf den letzten echten Artikel, nicht auf eine Pfand-Zeile
      const t = [...out].reverse().find(o => !o.deposit) ?? out[out.length - 1];
      t.price = +(t.price + num(d[2])).toFixed(2);
      continue;
    }
    // Pfand und Leergut als eigene Positionen (Kategorie "Pfand"), nicht in den Vorrat
    if (DEPOSIT_LINE.test(line)) {
      const a = line.match(LAST_AMOUNT);
      if (a) {
        let price = num(a[1]);
        const back = price < 0 || /(leergut|pfandbon|rückgabe|ruckgabe|rueckgabe)/i.test(line);
        if (back) price = -Math.abs(price);
        if (price !== 0) out.push({ name: back ? 'Leergut-Rückgabe' : 'Pfand', size: '', price, qty: 1, unit: 'Stk', category: 'Pfand', expiry: '', selected: false, deposit: true });
      }
      continue;
    }
    if (SKIP.test(line)) continue;

    const m = line.match(PRICE_LINE);
    if (!m) continue;
    const price = num(m[2]);
    if (price <= 0) continue;
    const name = cleanName(m[1]);
    if (name.length < 2) continue;
    const category = guessCategory(name);
    out.push({ name, size: parseSize(name)?.label ?? '', price, qty: 1, unit: 'Stk', category, expiry: defaultExpiry(category, date), selected: category !== 'Haushalt' });
  }
  return out;
}

function cleanName(s) {
  return s.replace(/\s{2,}/g, ' ')
          .replace(/^\d{4,}\s+/, '')          // Artikelnummern am Anfang
          .replace(/[|_~]+/g, '')
          .trim()
          .replace(/\b([A-ZÄÖÜ])([A-ZÄÖÜ]+)\b/g, (_, a, b) => a + b.toLowerCase()); // GROSS → Gross
}

export async function ocrImage(file, onProgress) {
  if (!window.Tesseract) throw new Error('Texterkennung nicht geladen (Internet nötig beim ersten Mal).');
  const { data } = await window.Tesseract.recognize(file, 'deu', {
    logger: m => m.status === 'recognizing text' && onProgress?.(Math.round(m.progress * 100)),
  });
  return data.text;
}
