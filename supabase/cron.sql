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

-- Angebote: täglich 6:00 Uhr (UTC 5:00) für die oft gekauften Produkte jedes Haushalts.
select cron.schedule('speisekammer-offers', '0 5 * * *', $$
  select net.http_post(
    url := 'https://<PROJEKT-REF>.supabase.co/functions/v1/offers',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb
  );
$$);
