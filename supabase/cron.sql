-- Ruft die Edge Function „reminders“ alle 15 Minuten auf. Einmal im SQL Editor ausführen,
-- vorher <PROJEKT-REF> und <CRON_SECRET> ersetzen (gleicher Wert wie im Secret CRON_SECRET).
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('speisekammer-reminders', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://<PROJEKT-REF>.supabase.co/functions/v1/reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb
  );
$$);

-- Angebote: nur freitags 14:00 Uhr deutscher Zeit (Luca 24.11., sparsam wegen Marktguru-AGB).
-- Zwei Einträge (12 und 13 Uhr UTC) wegen Sommer-/Winterzeit; die Function prüft selbst, ob es in Berlin gerade Freitag 14 Uhr ist, sonst tut sie nichts.
-- Die Function heißt bei Luca im Dashboard „quick-action“ (technischer Name der Adresse).
-- Alten täglichen Eintrag zuerst entfernen: select cron.unschedule('speisekammer-offers');
select cron.schedule('speisekammer-offers-fr-a', '0 12 * * 5', $$
  select net.http_post(
    url := 'https://<PROJEKT-REF>.supabase.co/functions/v1/quick-action',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb
  );
$$);
select cron.schedule('speisekammer-offers-fr-b', '0 13 * * 5', $$
  select net.http_post(
    url := 'https://<PROJEKT-REF>.supabase.co/functions/v1/quick-action',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb
  );
$$);
