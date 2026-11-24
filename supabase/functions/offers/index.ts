// Supabase Edge Function „offers“: holt Angebote über die INOFFIZIELLE Marktguru-Schnittstelle.
// Entscheidung Luca (22.11.2026): inoffiziell nutzen, Risiko bekannt. Nicht freigegeben, Nutzungsbedingungen
// ungeklärt, kann jederzeit ausfallen. Bei Fehlern bleibt die App nutzbar (Angebote per Antippen).
//
// Aufruf:
//  - aus der App (angemeldet): POST { terms: [...] }  → sucht diese Begriffe für den eigenen Haushalt
//  - per Cron (Header x-cron-secret): sucht für jeden Haushalt die oft gekauften Produkte der letzten 90 Tage
// Gedrosselt (Luca 24.11., Marktguru-AGB): automatisch nur freitags 14:00 Uhr (Europe/Berlin), manuell höchstens 1× pro Tag und Haushalt.
// Secrets: MARKTGURU_API_KEY, MARKTGURU_CLIENT_KEY (Header x-apikey / x-clientkey), CRON_SECRET.
// Konfiguration (PLZ, Ketten) wie offers-config.json.
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_BASE = 'https://api.marktguru.de/api/v1/offers/search';
const ZIPS = ['19249', '19230', '19243', '19288', '29451'];  // Lübtheen zuerst, dann Hagenow, Wittenburg, Ludwigslust, Dannenberg
// Kette → Erkennung über advertisers[].name
const CHAINS: [string, RegExp][] = [
  ['lidl', /^lidl/i], ['aldi-nord', /aldi\s*nord|^aldi$/i], ['rewe', /^rewe/i],
  ['netto', /netto\s*marken/i], ['edeka', /^edeka/i], ['kaufland', /^kaufland/i],
];
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function search(term: string, zip: string) {
  const u = `${URL_BASE}?as=web&limit=24&offset=0&q=${encodeURIComponent(term)}&zipCode=${zip}`;
  const r = await fetch(u, { headers: { 'x-apikey': Deno.env.get('MARKTGURU_API_KEY') ?? '', 'x-clientkey': Deno.env.get('MARKTGURU_CLIENT_KEY') ?? '' } });
  if (!r.ok) throw new Error(`Marktguru ${r.status} (${r.status === 401 || r.status === 403 ? 'Schlüssel ungültig oder gesperrt' : 'Schnittstelle antwortet nicht wie erwartet'})`);
  return (await r.json()).results ?? [];
}

async function collect(householdId: string, terms: string[]) {
  const now = Date.now(), rows = new Map<string, Record<string, unknown>>();
  let errors = 0, firstErr = '';
  for (const term of terms.slice(0, 30)) {
    for (const zip of ZIPS) {
      let results = [];
      try { results = await search(term, zip); } catch (e) { errors++; firstErr ||= String((e as Error).message ?? e); continue; }
      for (const o of results) {
        const adv = (o.advertisers ?? []).map((a: { name: string }) => a.name).join(' ');
        const chain = CHAINS.find(([, re]) => re.test(adv))?.[0];
        if (!chain || typeof o.price !== 'number') continue;
        const v = (o.validityDates ?? [])[0] ?? {};
        if (v.to && Date.parse(v.to) < now) continue;
        const key = `${chain}:${o.id}`;
        if (rows.has(key)) continue;
        rows.set(key, {
          household_id: householdId, chain, external_id: String(o.id), term,
          name: [o.brand?.name, o.product?.name].filter(Boolean).join(' ').trim() || term,
          description: o.description ?? null, price: o.price, old_price: o.oldPrice ?? null,
          reference_price: o.referencePrice ?? null, unit: o.unit?.shortName ?? null,
          valid_from: v.from ?? null, valid_to: v.to ?? null, zip, loyalty: !!o.requiresLoyalityMembership, source: 'marktguru',
        });
      }
      await sleep(300); // schonend abfragen
    }
  }
  // Wenn jede Abfrage scheitert (z. B. Schlüssel ungültig), alte Angebote behalten und den Fehler melden
  if (!rows.size && errors > 0) return { found: 0, errors, error: firstErr };
  await admin.from('offers').delete().eq('household_id', householdId).eq('source', 'marktguru');
  if (rows.size) await admin.from('offers').insert([...rows.values()]);
  return { found: rows.size, errors, error: errors ? firstErr : undefined };
}

// Häufig gekaufte Produkte (mind. 2× in 90 Tagen) als Suchbegriffe
// Stammartikel, die immer mitgesucht werden (Luca kauft diesen Toast bei Kaufland)
const ALWAYS = ['Dinkel Vollkorn Toast'];

async function frequentTerms(householdId: string) {
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data } = await admin.from('log').select('item_name').eq('household_id', householdId).eq('type', 'bought').gte('at', since);
  const count: Record<string, number> = {};
  for (const r of data ?? []) {
    const k = String(r.item_name).toLowerCase().replace(/\d+([,.]\d+)?\s*(g|kg|ml|l|%|stk)?/g, '').replace(/\s+/g, ' ').trim();
    if (k.length >= 3) count[k] = (count[k] ?? 0) + 1;
  }
  return Object.entries(count).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

Deno.serve(async req => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Cron: alle Haushalte, nur Freitag 14 Uhr deutscher Zeit (der Cron läuft um 12 und 13 UTC, die Zeitumstellung regelt diese Prüfung)
  if (req.headers.get('x-cron-secret') && req.headers.get('x-cron-secret') === Deno.env.get('CRON_SECRET')) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', weekday: 'short', hour: '2-digit', hour12: false }).formatToParts(new Date());
    const wd = parts.find(p => p.type === 'weekday')?.value, hr = parts.find(p => p.type === 'hour')?.value;
    if (wd !== 'Fri' || hr !== '14') return Response.json({ skipped: true, berlin: `${wd} ${hr}` });
    const { data: hhs } = await admin.from('households').select('id');
    const out = [];
    for (const h of hhs ?? []) out.push(await collect(h.id, [...new Set([...ALWAYS, ...(await frequentTerms(h.id))])]));
    return Response.json(out);
  }

  // App: angemeldeter Nutzer
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return new Response('unauthorized', { status: 401, headers: cors });
  const { data: mem } = await admin.from('members').select('household_id').eq('user_id', user.id).maybeSingle();
  if (!mem) return new Response('no household', { status: 403, headers: cors });
  // Manuell höchstens 1× pro 24 Stunden und Haushalt: sonst die vorhandenen Angebote zurückgeben
  const { data: last } = await admin.from('offers').select('created_at').eq('household_id', mem.household_id).eq('source', 'marktguru').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - Date.parse(last.created_at) < 24 * 3600 * 1000) {
    const { count } = await admin.from('offers').select('id', { count: 'exact', head: true }).eq('household_id', mem.household_id).eq('source', 'marktguru');
    return Response.json({ found: count ?? 0, errors: 0, cached: true, last: last.created_at }, { headers: cors });
  }
  const body = await req.json().catch(() => ({}));
  const terms = [...new Set([...(body.terms ?? []), ...ALWAYS, ...(await frequentTerms(mem.household_id))].map((t: string) => t.trim()).filter(Boolean))];
  return Response.json(await collect(mem.household_id, terms), { headers: cors });
});
