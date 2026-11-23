// Gemeinsame Daten für den ganzen Haushalt (Luca 22.11.2026).
// Die App liest und schreibt weiter localStorage. Ist Supabase eingerichtet, wird jeder Schreibzugriff auf
// einen der Schlüssel unten zusätzlich hochgeladen, und Änderungen vom anderen Handy kommen live herein.
// Ohne Supabase (und in der Demo) bleibt alles auf dem Gerät.

// Haushaltsweit: alle sehen dasselbe
export const HOUSEHOLD_KEYS = [
  'speisekammer.hhSettings',     // Einstellungen für alle (inkl. Anzeige-Standard)
  'speisekammer.minStock', 'speisekammer.minPending', 'speisekammer.parts',
  'speisekammer.utensils', 'warnDays',
  'speisekammer.offers', 'speisekammer.acceptedOffers',
  'speisekammer.shopping',       // Einkaufsliste (eintragsweise zusammengeführt)
  'speisekammer.recipes',        // eigene Gerichte (eintragsweise zusammengeführt)
  'speisekammer.plan', 'speisekammer.shifts', 'speisekammer.shiftConf', 'speisekammer.layout',
];
// Listen, die eintragsweise zusammengeführt werden (gleichzeitiges Abhaken)
export const MERGE_KEYS = ['speisekammer.shopping', 'speisekammer.recipes'];
// Persönlich: nur die Person selbst (eigene Anzeige, Gewicht)
export const MEMBER_KEYS = ['speisekammer.settings', 'speisekammer.weight'];

// Gesundheitsangaben bleiben nur auf dem Gerät (Zusage an Luca, Art. 9 DSGVO): werden nie hochgeladen
const LOCAL_ONLY = { 'speisekammer.settings': ['health'] };
const strip = (key, v) => { const f = LOCAL_ONLY[key]; if (!f || !v || typeof v !== 'object') return v; const c = { ...v }; for (const x of f) delete c[x]; return c; };
const keepLocal = (key, v, cur) => { const f = LOCAL_ONLY[key]; if (!f || !cur || typeof cur !== 'object') return v; const c = { ...v }; for (const x of f) if (x in cur) c[x] = cur[x]; return c; };
const kind = k => HOUSEHOLD_KEYS.includes(k) ? 'hh' : MEMBER_KEYS.includes(k) ? 'me' : null;
const parse = v => { try { return JSON.parse(v); } catch { return v; } };

const DIRTY = 'speisekammer.dirty.';
export async function initShared(store, onChange) {
  if (!store.listShared) return;
  const raw = Storage.prototype.setItem.bind(localStorage);
  const rawGet = Storage.prototype.getItem.bind(localStorage);

  // 1) Stand vom Server holen; was es dort noch nicht gibt, einmal vom Handy hochladen
  const [hh, me] = await Promise.all([store.listShared(), store.listMine()]);
  const have = new Set();
  for (const { key, value } of [...hh, ...me]) {
    have.add(key);
    if (rawGet(DIRTY + key) && rawGet(key) != null && !MERGE_KEYS.includes(key)) { push(key, parse(rawGet(key)), null).catch(e => console.warn('Abgleich', key, e)); continue; } // lokaler Stand war noch nicht hochgeladen
    raw(key, JSON.stringify(MERGE_KEYS.includes(key) ? value.filter(x => !x.del) : keepLocal(key, value, parse(rawGet(key)))));
  }
  for (const key of [...HOUSEHOLD_KEYS, ...MEMBER_KEYS]) {
    const v = rawGet(key);
    if (v == null || have.has(key)) continue;
    push(key, parse(v), null).catch(e => console.warn('Abgleich', key, e));
  }

  // 2) Schreibzugriffe abfangen
  localStorage.setItem = (key, value) => {
    const k = kind(key);
    const before = k && MERGE_KEYS.includes(key) ? parse(rawGet(key)) : null;
    raw(key, value);
    if (k) push(key, parse(value), before).catch(e => console.warn('Abgleich', key, e));
  };

  // Eigene Schreibzugriffe: nacheinander senden (nur der neueste Wert zählt) und das Echo vom Server nicht zurückspielen,
  // sonst überschreibt ein verspätetes Echo eines älteren Wertes die aktuelle Einstellung (Uhrzeit sprang zurück, 23.11.)
  const mine = new Map(), busy = new Set(), pending = new Map();
  const remember = (key, json) => { const l = mine.get(key) ?? []; l.push(json); mine.set(key, l.slice(-30)); };
  async function send(key, value, fn) {
    pending.set(key, value);
    if (busy.has(key)) return;
    busy.add(key);
    try {
      while (pending.has(key)) {
        const v = pending.get(key); pending.delete(key); remember(key, JSON.stringify(v));
        raw(DIRTY + key, '1'); // noch nicht beim Server angekommen (App kann vorher geschlossen werden)
        try { await fn(v); } catch (e) { document.dispatchEvent(new CustomEvent('shared:error', { detail: { key, message: e?.message ?? String(e) } })); throw e; }
        if (!pending.has(key)) { localStorage.removeItem(DIRTY + key); document.dispatchEvent(new CustomEvent('shared:saved', { detail: { key } })); }
      }
    } finally { busy.delete(key); }
  }
  async function push(key, value, before) {
    if (kind(key) === 'me') return send(key, strip(key, value), v => store.setMine(key, v));
    if (!MERGE_KEYS.includes(key)) return send(key, value, v => store.setShared(key, v));
    // Liste: nur geänderte und gelöschte Einträge schicken
    const now = Date.now(), old = new Map((Array.isArray(before) ? before : []).map(x => [x.id, x]));
    const changed = [];
    for (const x of Array.isArray(value) ? value : []) {
      const o = old.get(x.id); old.delete(x.id);
      const { t, ...rest } = x; const { t: ot, ...orest } = o ?? {};
      if (!o || JSON.stringify(rest) !== JSON.stringify(orest)) { x.t = now; changed.push(x); }
    }
    for (const id of old.keys()) changed.push({ id, del: true, t: now });
    if (!changed.length) return;
    const merged = await store.mergeList(key, changed);
    raw(key, JSON.stringify(merged.filter(x => !x.del)));
    onChange?.(key);
  }

  // 3) Änderungen vom anderen Handy
  store.onShared((scope, key, value) => {
    if (!kind(key)) return;
    if (!MERGE_KEYS.includes(key) && (mine.get(key) ?? []).includes(JSON.stringify(kind(key) === 'me' ? strip(key, value) : value))) return; // eigenes Echo
    const v = JSON.stringify(MERGE_KEYS.includes(key) ? value.filter(x => !x.del) : keepLocal(key, value, parse(rawGet(key))));
    if (rawGet(key) === v) return;
    raw(key, v); onChange?.(key);
  });
}
