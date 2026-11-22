// Monatsbilanz: Ausgaben je Lebensmittel und je Kategorie.
// Bon-Namen schwanken ("Rinderhackfleisch 500g", "RINDERHACK 1KG"), daher werden Mengen- und
// Prozentangaben entfernt. Was dann noch verschieden heißt, kann man in der App zusammenfassen (Aliase).

export function productKey(name, aliases = {}) {
  const base = String(name).toLowerCase()
    .replace(/\d+([,.]\d+)?\s*(%|g|kg|ml|l|stk|st|x|er)\b/g, ' ')   // 500g, 1kg, 3,8%, 6er
    .replace(/\b\d+([,.]\d+)?\b/g, ' ')
    .replace(/[^a-zäöüß\- ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return aliases[base] ?? base;
}

// Packungsgröße aus Text lesen: "500g", "1KG", "1,5 l", "6x0,5l", "10er", "250 ml".
// Rückgabe normalisiert auf g / ml / Stk, oder null wenn keine Größe erkennbar.
export function parseSize(text) {
  const t = String(text ?? '').toLowerCase().replace(',', '.');
  let m = t.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l)\b/);
  if (m) {
    const one = norm(+m[2], m[3]);
    return { amount: +m[1] * one.amount, unit: one.unit, label: `${m[1]}×${fmt(+m[2])} ${m[3]}` };
  }
  m = t.match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l)\b/);
  if (m) { const n = norm(+m[1], m[2]); return { ...n, label: labelOf(n) }; }
  m = t.match(/\b(\d+)\s*(er|stk|st\.?|stück)\b/);
  if (m) return { amount: +m[1], unit: 'Stk', label: `${m[1]} Stk` };
  return null;
}
function norm(v, u) {
  if (u === 'kg') return { amount: v * 1000, unit: 'g' };
  if (u === 'l') return { amount: v * 1000, unit: 'ml' };
  if (u === 'cl') return { amount: v * 10, unit: 'ml' };
  return { amount: v, unit: u };
}
const fmt = n => String(+n.toFixed(3)).replace('.', ',');
function labelOf({ amount, unit }) {
  if (unit === 'g') return amount >= 1000 ? `${fmt(amount / 1000)} kg` : `${fmt(amount)} g`;
  if (unit === 'ml') return amount >= 1000 ? `${fmt(amount / 1000)} l` : `${fmt(amount)} ml`;
  return `${fmt(amount)} Stk`;
}

// Grundpreis (€/kg, €/l, €/Stk) für Vergleich zwischen Größen
function unitPrice(total, count, size) {
  if (!size || !size.amount || !count) return null;
  if (size.unit === 'g') return { value: total / (count * size.amount / 1000), per: 'kg' };
  if (size.unit === 'ml') return { value: total / (count * size.amount / 1000), per: 'l' };
  return { value: total / (count * size.amount), per: 'Stk' };
}

export const pretty = k => k.replace(/(^|[\s-])\S/g, c => c.toUpperCase());

// Lokales Monatskürzel YYYY-MM (nicht UTC, sonst landen Einkäufe am Monatsersten um 0:30 im Vormonat)
export const ymOf = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; };

export function monthBalance(log, ym, aliases = {}) {
  const month = log.filter(l => ymOf(l.at) === ym);
  const bought = month.filter(l => l.type === 'bought');
  const spent = bought.reduce((s, l) => s + (l.price || 0), 0);
  const wasted = month.filter(l => l.type === 'wasted').reduce((s, l) => s + (l.value || 0), 0);

  const byCat = {}, byProduct = {};
  let depositPaid = 0, depositBack = 0;
  for (const l of bought) {
    byCat[l.category] = (byCat[l.category] || 0) + (l.price || 0);
    // Pfand: zählt zur Summe (wie auf dem Bon), aber nicht als Lebensmittel
    if (l.category === 'Pfand') { if ((l.price || 0) >= 0) depositPaid += l.price || 0; else depositBack -= l.price; continue; }
    const k = productKey(l.itemName, aliases);
    const p = byProduct[k] ??= { key: k, total: 0, count: 0, names: new Set(), category: l.category, sizes: {} };
    p.total += l.price || 0; p.names.add(l.itemName);
    // Lose Ware nach Gewicht (Bon-Zeile "0,512 kg x ...") → eigene Zeile "lose", Grundpreis aus Gesamtgewicht
    const loose = l.unit === 'kg' && !l.size;
    const size = loose ? null : (parseSize(l.size) ?? parseSize(l.itemName));
    const label = loose ? 'lose' : (size?.label ?? 'Größe unbekannt');
    const v = p.sizes[label] ??= { label, size, count: 0, total: 0, kg: 0 };
    // Packungen zählen: "2 x 0,89" auf dem Bon = 2 Packungen in einer Position
    v.count += loose ? 1 : (l.unit === 'Stk' && l.qty >= 1 ? Math.round(l.qty) : 1);
    v.total += l.price || 0; if (loose) v.kg += l.qty || 0;
  }
  const r2 = n => Math.round(n * 100) / 100;
  return {
    spent: r2(spent), wasted: r2(wasted),
    deposit: { paid: r2(depositPaid), back: r2(depositBack), net: r2(depositPaid - depositBack) },
    byCategory: Object.entries(byCat).map(([category, total]) => ({ category, total: r2(total) })).sort((a, b) => b.total - a.total),
    byProduct: Object.values(byProduct).map(p => ({
      ...p, total: r2(p.total), names: [...p.names],
      sizes: Object.values(p.sizes).map(v => ({
        label: v.label, count: v.count, total: r2(v.total), avg: r2(v.total / v.count),
        unitPrice: v.label === 'lose' ? (v.kg ? { value: r2(v.total / v.kg), per: 'kg' } : null)
                 : (up => up && { ...up, value: r2(up.value) })(unitPrice(v.total, v.count, v.size)),
      })).sort((a, b) => b.total - a.total),
    })).map(p => ({ ...p, count: p.sizes.reduce((n, v) => n + v.count, 0) })).sort((a, b) => b.total - a.total),
  };
}

export function toCSV(bal, ym) {
  const c = n => n == null ? '' : n.toFixed(2).replace('.', ',');
  const rows = [['Monat', 'Lebensmittel', 'Kategorie', 'Größe', 'Käufe', 'Summe €', 'Ø Preis €', 'Grundpreis €', 'je']];
  for (const p of bal.byProduct) for (const v of p.sizes)
    rows.push([ym, pretty(p.key), p.category, v.label, v.count, c(v.total), c(v.avg), c(v.unitPrice?.value), v.unitPrice?.per ?? '']);
  return rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
}

// ---------- Auswertungen auf Basis der Monatsbilanz ----------
export function prevYm(ym) {
  const [y, m] = ym.split('-').map(Number);
  return ymOf(new Date(y, m - 2, 1));
}

const sizeLabelOf = l => (l.unit === 'kg' && !l.size) ? 'lose' : ((parseSize(l.size) ?? parseSize(l.itemName))?.label ?? 'Größe unbekannt');

// 1) Wegwerf-Quote: Anteil des Warenwerts, der weggeworfen wurde, je Lebensmittel und Größe.
//    Basis: Einkäufe und Weggeworfenes im gewählten Monat (wertbasiert, damit Teilmengen zählen).
export function wasteStats(log, ym, aliases = {}) {
  const res = {};
  for (const l of log) {
    if (ymOf(l.at) !== ym || (l.type !== 'bought' && l.type !== 'wasted')) continue;
    const k = productKey(l.itemName, aliases), s = sizeLabelOf(l);
    const r = (res[k] ??= {})[s] ??= { bought: 0, wasted: 0, wastedQty: 0 };
    if (l.type === 'bought') r.bought += l.price || 0;
    else { r.wasted += l.value || 0; r.wastedQty += l.qty || 0; }
  }
  for (const k in res) for (const s in res[k]) {
    const r = res[k][s];
    r.quota = r.bought > 0 ? Math.min(1, r.wasted / r.bought) : (r.wasted > 0 ? 1 : 0);
  }
  return res;
}

// 3) Spartipp: Was hätte es gekostet, dieselbe Menge komplett in der Größe mit dem besten Grundpreis zu kaufen?
//    Nur wenn mindestens zwei Größen mit vergleichbarem Grundpreis gekauft wurden und bei der günstigeren
//    Größe nicht viel weggeworfen wird (sonst ist die große Packung keine echte Ersparnis).
export function sizeTip(product, waste = {}) {
  const priced = product.sizes.filter(v => v.unitPrice && v.label !== 'Größe unbekannt');
  const per = priced[0]?.unitPrice.per;
  const same = priced.filter(v => v.unitPrice.per === per);
  if (same.length < 2) return null;
  const best = same.reduce((a, b) => (b.unitPrice.value < a.unitPrice.value ? b : a));
  if ((waste[best.label]?.quota ?? 0) >= 0.2) return null;
  let saving = 0;
  for (const v of same) saving += (v.unitPrice.value - best.unitPrice.value) * (v.total / v.unitPrice.value);
  saving = Math.round(saving * 100) / 100;
  return saving >= 0.3 ? { best: best.label, unitPrice: best.unitPrice, saving } : null;
}

// 2) + alles zusammen: Bilanz mit Vormonatsvergleich, Wegwerf-Quoten und Spartipps
export function monthReport(log, ym, aliases = {}) {
  const cur = monthBalance(log, ym, aliases);
  const prev = monthBalance(log, prevYm(ym), aliases);
  const waste = wasteStats(log, ym, aliases);
  const prevBy = Object.fromEntries(prev.byProduct.map(p => [p.key, p.total]));
  const r2 = n => Math.round(n * 100) / 100;
  const byProduct = cur.byProduct.map(p => {
    const w = waste[p.key] ?? {};
    return {
      ...p,
      prevTotal: prevBy[p.key] ?? 0,
      diff: r2(p.total - (prevBy[p.key] ?? 0)),
      sizes: p.sizes.map(v => ({ ...v, waste: w[v.label] ?? null })),
      tip: sizeTip(p, w),
    };
  });
  // Lebensmittel, die nur weggeworfen (aber diesen Monat nicht gekauft) wurden, nicht verlieren
  const wasteOnly = Object.entries(waste).filter(([k]) => !byProduct.some(p => p.key === k))
    .flatMap(([k, sizes]) => Object.entries(sizes).map(([label, r]) => ({ key: k, label, ...r })));
  const hints = [];
  for (const p of byProduct) for (const v of p.sizes)
    if (v.waste && v.waste.quota >= 0.25 && v.waste.wasted >= 0.5)
      hints.push({ kind: 'waste', key: p.key, label: v.label, quota: v.waste.quota, wasted: r2(v.waste.wasted) });
  for (const p of byProduct) if (p.tip) hints.push({ kind: 'size', key: p.key, ...p.tip });
  hints.sort((a, b) => (b.wasted ?? b.saving) - (a.wasted ?? a.saving));
  return {
    ...cur, byProduct, wasteOnly, hints,
    prevSpent: prev.spent, prevWasted: prev.wasted,
    spentDiff: r2(cur.spent - prev.spent), hasPrev: prev.byProduct.length > 0,
  };
}
