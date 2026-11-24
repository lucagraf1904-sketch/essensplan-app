// Supabase Edge Function „reminders“: schickt Push-Erinnerungen (Ablauf + Abendessen) zur eingestellten Uhrzeit.
// Wird alle 15 Minuten per pg_cron aufgerufen (siehe supabase/cron.sql).
// Secrets (supabase secrets set ...): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (z. B. mailto:…), CRON_SECRET.
// SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY stellt Supabase automatisch bereit.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

// Datum und Uhrzeit in der Zeitzone des Geräts
function local(tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

Deno.serve(async req => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('forbidden', { status: 403 });

  const { data: subs, error } = await sb.from('push_subscriptions').select('*');
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0;
  for (const s of subs ?? []) {
    const { date, time } = local(s.tz || 'Europe/Berlin');
    const dueExpiry = s.remind_expiry && time >= s.expiry_time.slice(0, 5) && s.last_expiry_sent !== date;
    // Abendessen: Essenszeit minus Zubereitungszeit des geplanten Gerichts, sonst feste Zeit
    let dinnerTime: string | null = s.dinner_time.slice(0, 5), meal: { title: string; total_minutes: number; status: string } | null = null;
    if (s.remind_dinner) {
      const { data } = await sb.from('meal_plan').select('title, total_minutes, status')
        .eq('household_id', s.household_id).eq('date', date).eq('meal', 'dinner').maybeSingle();
      meal = data;
      if (meal?.status === 'uebersprungen') dinnerTime = null;
      else if (s.dinner_auto && meal?.total_minutes > 0) {
        const [h, m] = s.dinner_at.slice(0, 5).split(':').map(Number);
        const start = Math.max(0, h * 60 + m - meal.total_minutes);
        dinnerTime = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
      }
    }
    const dueDinner = s.remind_dinner && dinnerTime !== null && time >= dinnerTime && s.last_dinner_sent !== date;
    // „Was wurde gegessen?“ (Frühstück / Abendessen), nur wenn Packungen mit Teilmengen im Vorrat liegen
    const dueEatBf = s.ask_eaten_bf && time >= s.eaten_bf_time.slice(0, 5) && s.last_eaten_bf_sent !== date;
    const dueEatDin = s.ask_eaten_din && time >= s.eaten_din_time.slice(0, 5) && s.last_eaten_din_sent !== date;
    let hasParts = false;
    if (dueEatBf || dueEatDin) {
      const [{ data: its }, { data: kv }] = await Promise.all([
        sb.from('items').select('name').eq('household_id', s.household_id).gt('qty', 0),
        sb.from('household_data').select('value').eq('household_id', s.household_id).eq('key', 'speisekammer.parts').maybeSingle()]);
      const keys = Object.keys((kv?.value ?? {}) as Record<string, unknown>);
      hasParts = (its ?? []).some(i => { const n = String(i.name).toLowerCase(); return keys.includes(n) || /toast|\beier\b/.test(n); });
    }
    const eatBf = dueEatBf && hasParts, eatDin = dueEatDin && hasParts;
    if (!dueExpiry && !dueDinner && !dueEatBf && !dueEatDin) continue;

    const { data: items } = await sb.from('items').select('name, expiry, category')
      .eq('household_id', s.household_id).not('category', 'in', '("Badezimmer","Haushalt","Pfand")').not('expiry', 'is', null).lte('expiry', addDays(date, s.warn_days ?? 3)).order('expiry');
    const label = (i: { name: string; expiry: string }) => {
      const d = daysBetween(date, i.expiry);
      return `${i.name} (${d < 0 ? 'abgelaufen' : d === 0 ? 'heute' : d === 1 ? 'morgen' : 'in ' + d + ' T'})`;
    };
    const soon = items ?? [];
    const messages: { title: string; body: string; tag: string }[] = [];
    if (dueExpiry && soon.length) messages.push({ title: `${soon.length} Artikel bald ablaufend`, body: soon.slice(0, 5).map(label).join(', '), tag: 'ablauf' });
    if (dueDinner && meal?.title && meal.total_minutes) messages.push({ title: `Jetzt anfangen: ${meal.title}`,
      body: `Dauert ${meal.total_minutes} min, dann ist es um ${s.dinner_at.slice(0, 5)} Uhr fertig.`, tag: 'abendessen' });
    else if (dueDinner) messages.push({ title: 'Zeit fürs Abendessen',
      body: soon.length ? `Zuerst verbrauchen: ${soon.slice(0, 3).map(label).join(', ')}` : 'Schau in den Vorrat, was heute weg muss.', tag: 'abendessen' });

    if (eatBf) messages.push({ title: 'Was hast du gefrühstückt?', body: 'Kurz antippen, dann stimmt der Vorrat.', tag: 'gegessen-bf' });
    if (eatDin) messages.push({ title: 'Was wurde zum Abendessen gegessen?', body: 'Kurz antippen, dann stimmt der Vorrat.', tag: 'gegessen-din' });
    const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    let gone = false;
    for (const m of messages) {
      try { await webpush.sendNotification(sub, JSON.stringify(m), { TTL: 3600 }); sent++; }
      catch (e) { if ((e as { statusCode?: number }).statusCode === 404 || (e as { statusCode?: number }).statusCode === 410) gone = true; }
    }
    if (gone) { await sb.from('push_subscriptions').delete().eq('id', s.id); continue; }
    await sb.from('push_subscriptions').update({
      ...(dueExpiry ? { last_expiry_sent: date } : {}), ...(dueDinner ? { last_dinner_sent: date } : {}),
      ...(dueEatBf ? { last_eaten_bf_sent: date } : {}), ...(dueEatDin ? { last_eaten_din_sent: date } : {}),
    }).eq('id', s.id);
  }
  return Response.json({ sent });
});
