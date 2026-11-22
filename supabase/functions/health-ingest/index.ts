// Supabase Edge Function „health-ingest“ (VORBEREITET, noch nicht live; siehe KURZBEFEHL.md).
// Empfängt Tagesschritte und aktive Kalorien vom iPhone-Kurzbefehl.
// Deploy: supabase functions deploy health-ingest --no-verify-jwt
//   (kein Supabase-Login im Kurzbefehl; die Funktion prüft stattdessen den persönlichen Schlüssel im Header x-health-token)
//
// Anfrage: POST, Header x-health-token: <Schlüssel>, JSON-Body
//   { "date": "2026-11-22", "steps": 8421, "active_kcal": 312.4 }
//   oder mehrere Tage: { "days": [ {date, steps, active_kcal}, ... ] }  (höchstens 7, nicht älter als 14 Tage)
// Zahlen dürfen auch Text sein („8.421“, „312,4 kcal“), weil der Kurzbefehl Health-Werte je nach iOS mit Einheit liefert.
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// „8.421 Schritte“ → 8421, „312,4 kcal“ → 312.4, 8421 → 8421
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');          // deutsch: 1.234,5
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');        // 8.421 = Tausenderpunkt
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('POST erwartet', { status: 405 });
  const token = req.headers.get('x-health-token')?.trim();
  if (!token || token.length < 20) return new Response('Schlüssel fehlt', { status: 401 });

  const { data: owner } = await sb.from('health_tokens').select('user_id, household_id')
    .eq('token_hash', await sha256(token)).maybeSingle();
  if (!owner) return new Response('Schlüssel ungültig', { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return new Response('Kein gültiges JSON', { status: 400 }); }
  const days = (Array.isArray(body.days) ? body.days : [body]).slice(0, 7) as Record<string, unknown>[];

  const now = Date.now();
  const rows = [];
  for (const d of days) {
    const date = String(d.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response(`Datum ungültig: ${d.date}`, { status: 400 });
    const t = Date.parse(date + 'T00:00:00Z');
    if (t > now + 86400000 || t < now - 14 * 86400000) return new Response(`Datum außerhalb des Zeitraums: ${date}`, { status: 400 });
    const steps = num(d.steps), kcal = num(d.active_kcal);
    if (steps !== null && (steps < 0 || steps > 150000)) return new Response('Schritte unplausibel', { status: 400 });
    if (kcal !== null && (kcal < 0 || kcal > 10000)) return new Response('Kalorien unplausibel', { status: 400 });
    rows.push({ date, steps: steps === null ? null : Math.round(steps), active_kcal: kcal === null ? null : Math.round(kcal * 10) / 10 });
  }

  // Tageswerte wachsen über den Tag. Ein späterer, kleinerer Wert (z. B. Lauf mit unvollständigen Daten) überschreibt nicht.
  const { data: old } = await sb.from('health_daily').select('date, steps, active_kcal')
    .eq('user_id', owner.user_id).in('date', rows.map(r => r.date));
  const prev = new Map((old ?? []).map(r => [r.date, r]));
  const max = (a: number | null, b: number | null) => a === null ? b : b === null ? a : Math.max(a, b);
  const upserts = rows.map(r => {
    const p = prev.get(r.date);
    return { user_id: owner.user_id, household_id: owner.household_id, date: r.date, source: 'shortcut', updated_at: new Date().toISOString(),
      steps: max(r.steps, p?.steps ?? null), active_kcal: max(r.active_kcal, p?.active_kcal == null ? null : +p.active_kcal) };
  });
  const { error } = await sb.from('health_daily').upsert(upserts, { onConflict: 'user_id,date' });
  if (error) return new Response(error.message, { status: 500 });
  await sb.from('health_tokens').update({ last_used_at: new Date().toISOString() }).eq('user_id', owner.user_id);

  // Kurze Textantwort, damit der Kurzbefehl sie bei Bedarf als Mitteilung zeigen kann
  const today = upserts.find(u => u.date === isoDay(new Date())) ?? upserts[0];
  return new Response(`Gespeichert: ${today.steps ?? '–'} Schritte, ${today.active_kcal ?? '–'} kcal aktiv`, {
    headers: { 'content-type': 'text/plain; charset=utf-8' } });
});
