// Gemeinsame Daten für den ganzen Haushalt (Luca 22.11.2026).
// Die App liest und schreibt weiter localStorage. Ist Supabase eingerichtet, wird jeder Schreibzugriff auf
// einen der Schlüssel unten zusätzlich hochgeladen, und Änderungen vom anderen Handy kommen live herein.
// Ohne Supabase (und in der Demo) bleibt alles auf dem Gerät.

// Haushaltsweit: alle sehen dasselbe
export const HOUSEHOLD_KEYS = [
  'speisekammer.hhSettings',     // Einstellungen für alle (inkl. Anzeige-Standard)
  'speisekammer.minStock', 'speisekammer.minPending', 'speisekammer.parts', 'speisekammer.recHidden',
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

const DIRTY = 'speisekammer.dirty.', BASEK = 'speisekammer.base.'; // BASEK: zuletzt bekannter Serverstand (Grundlage für den Abgleich)
// Dreiwege-Zusammenführung: base = zuletzt bekannter Stand, mine = meine neue Fassung, theirs = Stand auf dem Server.
// Was ich nicht geändert habe, kommt vom Server; was ich geändert habe, von mir (bei Objekten bis in die Tiefe).
// Schlüsselreihenfolge ignorieren: jsonb in der Datenbank sortiert die Schlüssel um, sonst wird das eigene Echo nicht erkannt
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(y => [y, x[y]])) : x);
const same = (a, b) => canon(a) === canon(b);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
export function merge3(base, mine, theirs) {
  if (!isObj(mine) || !isObj(theirs)) return same(mine, base) ? theirs : mine;
  const b = isObj(base) ? base : {}, out = {};
  for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(b)])) {
    const m = mine[k], t = theirs[k], o = b[k];
    let v;
    if (same(m, o)) v = t;                       // von mir unverändert: Stand des anderen Handys
    else if (isObj(m) && isObj(t)) v = merge3(o, m, t);
    else v = m;                                  // von mir geändert (oder gelöscht)
    if (v !== undefined) out[k] = v;
  }
  return out;
}
// Essensplan: Tage einzeln zusammenführen, der zuletzt geänderte Tag (t) gewinnt
export function mergePlan(base, mine, theirs) {
  if (!mine?.days || !theirs?.days) return mine ?? theirs;
  const first = mine.days[0]?.date ?? '', by = new Map();
  for (const d of theirs.days) if (d.date >= first) by.set(d.date, d);
  for (const d of mine.days) { const o = by.get(d.date); if (!o || (d.t ?? 0) >= (o.t ?? 0)) by.set(d.date, d); }
  return { ...mine, days: [...by.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}
const MERGERS = { 'speisekammer.plan': mergePlan };
export async function initShared(store, onChange) {
  if (!store.listShared) return;
  const raw = Storage.prototype.setItem.bind(localStorage);
  const rawGet = Storage.prototype.getItem.bind(localStorage);

  const mine = new Map(), busy = new Set(), pending = new Map(), bases = new Map();
  const remember = (key, json) => { const l = mine.get(key) ?? []; l.push(canon(parse(json))); mine.set(key, l.slice(-30)); };
  // 1) Stand vom Server holen; was es dort noch nicht gibt, einmal vom Handy hochladen
  const [hh, me] = await Promise.all([store.listShared(), store.listMine()]);
  const have = new Set();
  for (const { key, value } of [...hh, ...me]) {
    have.add(key);
    if (rawGet(DIRTY + key) && rawGet(key) != null && !MERGE_KEYS.includes(key)) { push(key, parse(rawGet(key)), parse(rawGet(BASEK + key))).catch(e => console.warn('Abgleich', key, e)); continue; } // lokaler Stand war noch nicht hochgeladen (Grundlage: zuletzt bekannter Serverstand, damit nur echte Änderungen überschreiben)
    if (key === 'speisekammer.settings') { // Diagnose: was hat der Server beim Start überschrieben?
      const loc = parse(rawGet(key)) ?? {}, diff = Object.keys({ ...loc, ...value }).filter(k => k !== 'health' && JSON.stringify(loc[k]) !== JSON.stringify(value[k]));
      raw('speisekammer.dbg', JSON.stringify({ at: new Date().toISOString(), diff: diff.map(k => `${k}: lokal ${JSON.stringify(loc[k])} → Server ${JSON.stringify(value[k])}`).slice(0, 6) }));
    }
    if (key === 'speisekammer.plan' && parse(rawGet(key))?.days) { // Plan: lokal neuere Tage nicht durch älteren Serverstand ersetzen
      const loc = parse(rawGet(key)), m = mergePlan(null, loc, value);
      raw(key, JSON.stringify(m));
      if (!same(m, value)) push(key, m, null).catch(e => console.warn('Abgleich', key, e));
      continue;
    }
    if (!MERGE_KEYS.includes(key)) raw(BASEK + key, JSON.stringify(value));
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
    const before = k ? parse(rawGet(key)) : null;
    raw(key, value);
    if (k) push(key, parse(value), before).catch(e => console.warn('Abgleich', key, e));
  };

  // Eigene Schreibzugriffe: nacheinander senden (nur der neueste Wert zählt) und das Echo vom Server nicht zurückspielen,
  // sonst überschreibt ein verspätetes Echo eines älteren Wertes die aktuelle Einstellung (Uhrzeit sprang zurück, 23.11.)
  async function send(key, value, fn) {
    pending.set(key, value);
    if (busy.has(key)) return;
    busy.add(key);
    try {
      while (pending.has(key)) {
        const v = pending.get(key); pending.delete(key); remember(key, JSON.stringify(v));
        raw(DIRTY + key, '1'); // noch nicht beim Server angekommen (App kann vorher geschlossen werden)
        raw('speisekammer.dbg2', JSON.stringify({ at: new Date().toISOString(), key, sent: v?.eatenBfTime ?? v?.expiryTime ?? null }));
        document.dispatchEvent(new CustomEvent('shared:sending', { detail: { key } }));
        try { await fn(v); } catch (e) { document.dispatchEvent(new CustomEvent('shared:error', { detail: { key, message: e?.message ?? String(e) } })); throw e; }
        if (!pending.has(key)) { localStorage.removeItem(DIRTY + key); raw('speisekammer.dbg3', new Date().toISOString()); document.dispatchEvent(new CustomEvent('shared:saved', { detail: { key } })); }
      }
    } finally { busy.delete(key); }
  }
  async function push(key, value, before) {
    if (kind(key) === 'me') return send(key, strip(key, value), v => store.setMine(key, v));
    if (!MERGE_KEYS.includes(key)) {
      // Haushaltsdaten: vor dem Schreiben den Stand des anderen Handys holen und beide Änderungen zusammenführen (nichts überschreiben)
      if (!bases.has(key)) bases.set(key, before);
      return send(key, value, async v => {
        const theirs = await store.getShared(key);
        const merged = theirs == null ? v : (MERGERS[key] ?? merge3)(bases.get(key), v, theirs);
        const json = JSON.stringify(merged);
        remember(key, json);
        if (json !== JSON.stringify(v)) { raw(key, json); onChange?.(key); }
        await store.setShared(key, merged);
        bases.set(key, merged); raw(BASEK + key, JSON.stringify(merged));
        // Kontrolle: steht beim Server wirklich, was ich gesendet habe?
        const back = await store.getShared(key);
        if (back != null && !same(back, merged)) throw new Error('Der Server hat etwas anderes gespeichert als gesendet (' + key.replace('speisekammer.', '') + ')');
      });
    }
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
    document.dispatchEvent(new CustomEvent('shared:sending', { detail: { key } }));
    let merged;
    try { merged = await store.mergeList(key, changed); } catch (e) { document.dispatchEvent(new CustomEvent('shared:error', { detail: { key, message: e?.message ?? String(e) } })); throw e; }
    document.dispatchEvent(new CustomEvent('shared:saved', { detail: { key } }));
    raw(key, JSON.stringify(merged.filter(x => !x.del)));
    onChange?.(key);
  }

  // Unterwegs verlorene Änderungen erneut senden: beim Zurückkehren in die App, bei Netz und alle 20 s
  const retryDirty = () => {
    if (navigator.onLine === false) return;
    for (const key of [...HOUSEHOLD_KEYS, ...MEMBER_KEYS]) {
      if (MERGE_KEYS.includes(key) || busy.has(key) || !rawGet(DIRTY + key) || rawGet(key) == null) continue;
      push(key, parse(rawGet(key)), parse(rawGet(BASEK + key))).catch(e => console.warn('Erneut senden', key, e));
    }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) retryDirty(); });
  window.addEventListener('online', retryDirty);
  document.addEventListener('shared:retry', retryDirty);
  setInterval(retryDirty, 20000);

  // 3) Änderungen vom anderen Handy
  store.onShared((scope, key, value) => {
    if (!kind(key)) return;
    if (!MERGE_KEYS.includes(key) && kind(key) === 'hh' && (busy.has(key) || rawGet(DIRTY + key))) return; // eigene Änderung noch unterwegs: wird beim Senden zusammengeführt
    if (!MERGE_KEYS.includes(key) && (mine.get(key) ?? []).includes(canon(kind(key) === 'me' ? strip(key, value) : value))) return; // eigenes Echo
    const locPlan = key === 'speisekammer.plan' ? parse(rawGet(key)) : null;
    const v = JSON.stringify(locPlan?.days && value?.days ? mergePlan(null, locPlan, value) : MERGE_KEYS.includes(key) ? value.filter(x => !x.del) : keepLocal(key, value, parse(rawGet(key))));
    if (rawGet(key) === v) return;
    if (kind(key) === 'hh' && !MERGE_KEYS.includes(key)) { bases.set(key, value); raw(BASEK + key, JSON.stringify(value)); } // jetzt bekannter Serverstand
    raw(key, v); onChange?.(key);
  });
}
