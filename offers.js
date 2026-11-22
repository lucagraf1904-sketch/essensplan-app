// Ladenangebote. Aktuell: Prospekt-Links + Angebote per Antippen eintragen (legal, zuverlässig).
// Später kann eine automatische Quelle dieselbe Struktur füllen (Luca, 22.11.2026: erst mit offizieller Freigabe).
// Gespeichert pro Gerät in localStorage (Supabase folgt).
//
// Prospekt-Seiten am 22.11.2026 geprüft. REWE ließ sich nicht automatisch prüfen (blockt Abrufe), URL-Muster aus der Suche.
export const CHAINS = [
  { id: 'lidl',      name: 'Lidl',      url: 'https://www.lidl.de/c/online-prospekte/s10005610', note: 'Filiale wählen' },
  { id: 'aldi-nord', name: 'Aldi Nord', url: 'https://www.aldi-nord.de/prospekte.html', note: 'überall gleich' },
  { id: 'netto',     name: 'Netto',     url: 'https://www.netto-online.de/ueber-netto/Online-Prospekte.chtm', note: 'PLZ eingeben' },
  { id: 'rewe',      name: 'Rewe',      url: 'https://www.rewe.de/angebote/nationale-angebote/', note: 'Markt wählen' },
  { id: 'edeka',     name: 'Edeka',     url: 'https://www.edeka.de/angebote/', note: 'Markt wählen' },
  // Kaufland (Luca, 22.11.2026). URL nicht automatisch prüfbar (Abruf blockiert); Prospekt startet meist donnerstags (laut kaufDA), daher Gültigkeit bis Mittwoch.
  { id: 'kaufland',  name: 'Kaufland',  url: 'https://filiale.kaufland.de/prospekte.html', note: 'Filiale wählen' },
];
export const chainName = id => CHAINS.find(c => c.id === id)?.name ?? id;

const KEY = 'speisekammer.offers';
const uid = () => crypto.randomUUID?.() ?? String(Date.now() + Math.random());
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function loadAll() { try { return JSON.parse(localStorage.getItem(KEY)) ?? []; } catch { return []; } }
function saveAll(l) { localStorage.setItem(KEY, JSON.stringify(l)); }

// Nur gültige Angebote; abgelaufene werden beim Lesen entfernt.
export function listOffers() {
  const t = today(), all = loadAll(), live = all.filter(o => !o.until || o.until >= t);
  if (live.length !== all.length) saveAll(live);
  return live.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
export function addOffer(o) { saveAll([...loadAll(), { id: uid(), source: 'manual', ...o }]); }
export function deleteOffer(id) { saveAll(loadAll().filter(o => o.id !== id)); }

// Standard-Gültigkeit: bis Samstag dieser Woche (Prospektwoche Mo–Sa), bei Kaufland bis Mittwoch
export function defaultUntil(chain) {
  const end = chain === 'kaufland' ? 3 : 6;
  const d = new Date(); d.setDate(d.getDate() + ((end - d.getDay() + 7) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Passt ein Angebot zu einem Listeneintrag? Vergleich über die Wortstämme (mind. 4 Zeichen).
const words = s => s.toLowerCase().replace(/[^a-zäöüß ]/g, ' ').split(/\s+/).filter(w => w.length >= 4);
export function offersFor(name, offers) {
  const w = words(name);
  if (!w.length) return [];
  return offers.filter(o => { const ow = words(o.name); return w.some(a => ow.some(b => a.includes(b) || b.includes(a))); })
    .sort((a, b) => a.price - b.price);
}

// ---------- Automatische Angebote + Einkaufs-Check ----------
import { productKey, parseSize } from './balance.js';

// Manuelle (lokal) + automatische (Supabase) Angebote zusammen
export async function allOffers(store) {
  let server = [];
  try { server = await store.listOffers(); } catch {}
  return [...listOffers(), ...server];
}

// Letzter eigener Kaufpreis eines Artikels (aus dem Verlauf, meist Lidl-Bons)
function lastPrice(name, log) {
  const k = productKey(name);
  if (!k) return null;
  const same = n => { const b = productKey(n); return b === k || (k.length >= 4 && b.includes(k)) || (b.length >= 4 && k.includes(b)); };
  const hits = log.filter(e => e.type === 'bought' && e.price && same(e.itemName))
    .sort((a, b) => b.at.localeCompare(a.at));
  if (!hits.length) return null;
  const h = hits[0];
  const qty = h.qty && h.unit === 'Stk' ? h.qty : 1;
  return { price: +(h.price / qty).toFixed(2), size: parseSize(h.size || h.itemName) };
}

// Angebotspreis auf die eigene Packungsgröße umgerechnet (Eigenmarke gleichwertig, gleiche Menge)
function offerCost(o, base, ownBrandOk) {
  if (ownBrandOk && base?.size && o.unitPrice) {
    const per = o.unitPrice.per?.toLowerCase();
    if (per === 'kg' && base.size.unit === 'g') return +(o.unitPrice.value * base.size.amount / 1000).toFixed(2);
    if (per === 'l' && base.size.unit === 'ml') return +(o.unitPrice.value * base.size.amount / 1000).toFixed(2);
  }
  return o.price;
}

// Einkaufs-Check: Stammladen allein vs. Stammladen + zweiter Laden (höchstens maxStores).
// accepted: Set angenommener Angebots-IDs (deren Laden ist gesetzt).
export function shoppingCheck(names, offers, log, s, accepted = new Set()) {
  const home = s.homeStore;
  const rows = names.map(name => {
    const base = lastPrice(name, log);
    const cands = offersFor(name, offers).map(o => ({ o, cost: offerCost(o, base, s.ownBrandOk) }));
    const homeOffer = cands.filter(c => c.o.chain === home).sort((a, b) => a.cost - b.cost)[0];
    const homePrice = [base?.price, homeOffer?.cost].filter(v => v != null).reduce((a, b) => Math.min(a, b), Infinity);
    return { name, base, cands, homeOffer, homePrice: homePrice === Infinity ? null : homePrice };
  });
  const acceptedChains = [...new Set(offers.filter(o => accepted.has(o.id)).map(o => o.chain))].filter(c => c !== home);
  const others = [...new Set(offers.map(o => o.chain))].filter(c => c !== home);

  const planFor = chain => {
    let saving = 0; const moved = [];
    for (const r of rows) {
      const best = r.cands.filter(c => c.o.chain === chain).sort((a, b) => a.cost - b.cost)[0];
      if (!best) continue;
      const forced = accepted.has(best.o.id);
      if (r.homePrice != null && best.cost < r.homePrice) { saving += r.homePrice - best.cost; moved.push({ ...r, pick: best }); }
      else if (forced) { moved.push({ ...r, pick: best, worse: r.homePrice != null ? best.cost - r.homePrice : null }); if (r.homePrice != null) saving -= best.cost - r.homePrice; }
    }
    return { chain, saving: +saving.toFixed(2), moved };
  };
  let second = null;
  if (s.maxStores >= 2) {
    const plans = (acceptedChains.length ? acceptedChains.slice(0, 1) : others).map(planFor).sort((a, b) => b.saving - a.saving);
    second = plans[0] ?? null;
  }
  const movedNames = new Set(second?.moved.map(m => m.name) ?? []);
  const homeItems = rows.filter(r => !movedNames.has(r.name));
  const unknown = rows.filter(r => r.homePrice == null && !movedNames.has(r.name)).map(r => r.name);
  const homeSavings = rows.filter(r => r.homeOffer && r.base && r.homeOffer.cost < r.base.price)
    .reduce((a, r) => a + (r.base.price - r.homeOffer.cost), 0);
  return {
    home, homeItems, second, unknown, homeSavings: +homeSavings.toFixed(2),
    worth: !!second && second.saving >= s.minSaving,
  };
}
