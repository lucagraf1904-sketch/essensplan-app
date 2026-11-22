-- Speisekammer: Datenbankschema für Supabase.
-- Im Supabase-Dashboard unter SQL Editor einfügen und ausführen. Mehrfach ausführbar (idempotent).
-- Prinzip: Jeder Nutzer gehört zu genau einem Haushalt. Alle Daten hängen am Haushalt,
-- Row Level Security sorgt dafür, dass man nur die Daten des eigenen Haushalts sieht.

create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Unser Haushalt',
  join_code text not null unique default upper(substr(md5(random()::text), 1, 6)),
  created_at timestamptz not null default now()
);

create table if not exists members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  joined_at timestamptz not null default now()
);

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  qty numeric not null default 1,
  unit text not null default 'Stk',
  size text,               -- Packungsgröße, z. B. '500 g'
  category text not null default 'Sonstiges',
  location text not null default 'Vorratsschrank',
  expiry date,
  price numeric(10,2),
  added_at timestamptz not null default now(),
  added_by uuid references auth.users(id) default auth.uid()
);
-- Einfrieren: frozen_at = Tag des Einfrierens, orig_expiry = MHD vor dem Einfrieren (expiry wird überschrieben)
alter table items add column if not exists frozen_at date;
alter table items add column if not exists orig_expiry date;
-- Barcode-Scan: EAN und Nährwerte je 100 g aus Open Food Facts
alter table items add column if not exists barcode text;
alter table items add column if not exists nutrition jsonb;
create index if not exists items_household_expiry on items(household_id, expiry);

create table if not exists log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  type text not null check (type in ('bought','eaten','wasted')),
  item_name text not null,
  category text,
  qty numeric,
  unit text,
  size text,
  price numeric(10,2),   -- bei 'bought': Kaufpreis
  value numeric(10,2),   -- bei 'eaten'/'wasted': anteiliger Warenwert
  at timestamptz not null default now(),
  by_user uuid references auth.users(id) default auth.uid()
);
create index if not exists log_household_at on log(household_id, at desc);

-- Zusammengefasste Produktnamen für die Monatsbilanz (z. B. "rinderhackfleisch" -> "rinderhack")
create table if not exists aliases (
  household_id uuid not null references households(id) on delete cascade,
  from_key text not null,
  to_key text not null,
  primary key (household_id, from_key)
);

-- Hilfsfunktion: Haushalt des angemeldeten Nutzers
create or replace function my_household() returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from members where user_id = auth.uid()
$$;

alter table households enable row level security;
alter table members    enable row level security;
alter table items      enable row level security;
alter table log        enable row level security;
alter table aliases    enable row level security;

drop policy if exists hh_read on households;
create policy hh_read on households for select using (id = my_household());
drop policy if exists mem_read on members;
create policy mem_read on members for select using (household_id = my_household());
drop policy if exists items_all on items;
create policy items_all on items for all using (household_id = my_household()) with check (household_id = my_household());
drop policy if exists log_all on log;
create policy log_all on log for all using (household_id = my_household()) with check (household_id = my_household());
drop policy if exists aliases_all on aliases;
create policy aliases_all on aliases for all using (household_id = my_household()) with check (household_id = my_household());

-- Haushalt anlegen (erster Nutzer) bzw. per Code beitreten (zweiter Nutzer).
create or replace function create_household(p_name text default 'Unser Haushalt') returns households
language plpgsql security definer set search_path = public as $$
declare h households;
begin
  if exists (select 1 from members where user_id = auth.uid()) then
    raise exception 'Du bist bereits in einem Haushalt';
  end if;
  insert into households(name) values (p_name) returning * into h;
  insert into members(user_id, household_id) values (auth.uid(), h.id);
  return h;
end $$;

create or replace function join_household(p_code text) returns households
language plpgsql security definer set search_path = public as $$
declare h households;
begin
  select * into h from households where join_code = upper(trim(p_code));
  if h.id is null then raise exception 'Code nicht gefunden'; end if;
  insert into members(user_id, household_id) values (auth.uid(), h.id)
    on conflict (user_id) do update set household_id = excluded.household_id;
  return h;
end $$;

-- Verbrauch atomar buchen (Menge abziehen, Restwert anpassen, Log-Eintrag).
create or replace function consume_item(p_id uuid, p_qty numeric, p_type text) returns void
language plpgsql security invoker set search_path = public as $$
declare it items; used numeric; share numeric;
begin
  select * into it from items where id = p_id for update;
  if it.id is null then return; end if;
  used := least(p_qty, it.qty);
  share := case when it.qty > 0 then used / it.qty else 1 end;
  insert into log(household_id, type, item_name, category, qty, unit, size, value)
    values (it.household_id, p_type, it.name, it.category, used, it.unit, it.size,
            case when it.price is not null then round(it.price * share, 2) end);
  if it.qty - used <= 0 then
    delete from items where id = p_id;
  else
    update items set qty = it.qty - used,
                     price = case when it.price is not null then round(it.price * (1 - share), 2) end
     where id = p_id;
  end if;
end $$;

-- Live-Abgleich zwischen beiden Handys
-- Echtzeit für items und log (mehrfach ausführbar)
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'items') then
    alter publication supabase_realtime add table items; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'log') then
    alter publication supabase_realtime add table log; end if;
end $$;

-- ---------- Push-Erinnerungen (Ablauf + Abendessen) ----------
-- Eine Zeile pro Gerät. Die Edge Function „reminders“ läuft alle 15 Minuten (pg_cron) und schickt fällige Nachrichten.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  tz text not null default 'Europe/Berlin',
  remind_expiry boolean not null default true,
  expiry_time time not null default '16:00',
  remind_dinner boolean not null default true,
  dinner_time time not null default '16:00',   -- feste Zeit bzw. Rückfall ohne geplantes Gericht
  dinner_auto boolean not null default true,    -- Erinnerung = dinner_at minus total_minutes aus meal_plan
  dinner_at time not null default '17:00',
  warn_days int not null default 3,
  last_expiry_sent date,
  last_dinner_sent date,
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
drop policy if exists push_own on push_subscriptions;
create policy push_own on push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and household_id in (select household_id from members where user_id = auth.uid()));
alter table push_subscriptions add column if not exists dinner_auto boolean not null default true;
alter table push_subscriptions add column if not exists dinner_at time not null default '17:00';

-- ---------- Essensplan (abgestimmt mit dem Planungs-Thread, 22.11.2026) ----------
create table if not exists meal_plan (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  date date not null,
  meal text not null check (meal in ('breakfast','dinner')),
  recipe_id uuid,
  title text,
  method text,
  portions int,
  total_minutes int,          -- Vorbereitung + Garen inkl. Druckaufbau
  thaw_from timestamptz,
  status text not null default 'geplant' check (status in ('geplant','gekocht','uebersprungen')),
  created_at timestamptz not null default now(),
  unique (household_id, date, meal)
);
alter table meal_plan enable row level security;
drop policy if exists meal_plan_all on meal_plan;
create policy meal_plan_all on meal_plan for all using (household_id = my_household()) with check (household_id = my_household());

-- ---------- Angebote (manuell oder automatisch über Edge Function „offers“) ----------
create table if not exists offers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  chain text not null,                 -- lidl | aldi-nord | rewe | netto | edeka | kaufland
  name text not null,
  description text,
  price numeric(10,2) not null,
  old_price numeric(10,2),
  reference_price numeric(10,2),       -- Grundpreis je unit
  unit text,                           -- z. B. kg, l
  valid_from timestamptz,
  valid_to timestamptz,
  zip text,
  loyalty boolean default false,       -- nur mit Kundenkarte/App (z. B. Lidl Plus)
  term text,                           -- Suchbegriff
  external_id text,
  source text not null default 'manual' check (source in ('manual','marktguru')),
  created_at timestamptz not null default now()
);
create index if not exists offers_household on offers(household_id, valid_to);
alter table offers enable row level security;
drop policy if exists offers_all on offers;
create policy offers_all on offers for all using (household_id = my_household()) with check (household_id = my_household());

-- ---------- Bewegung aus Apple Health per iPhone-Kurzbefehl (VORBEREITET, noch nicht live; siehe KURZBEFEHL.md) ----------
-- Der Kurzbefehl schickt Tageswerte an die Edge Function „health-ingest“. Er meldet sich nicht an, sondern nutzt einen
-- persönlichen Schlüssel. Gespeichert wird nur der SHA-256-Hash des Schlüssels, der Klartext wird einmal angezeigt.
create table if not exists health_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  label text not null default 'Ich',             -- Anzeigename in der Übersicht, z. B. 'Luca'
  token_hash text not null unique,
  share_household boolean not null default true, -- Werte für die andere Person im Haushalt sichtbar
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create table if not exists health_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  date date not null,                 -- Kalendertag in der Zeitzone des iPhones
  steps int,
  active_kcal numeric(7,1),           -- „Aktive Energie“ aus Health, ohne Grundumsatz
  source text not null default 'shortcut',
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);
alter table health_tokens enable row level security;
alter table health_daily  enable row level security;
drop policy if exists health_tokens_own on health_tokens;
create policy health_tokens_own on health_tokens for select using (user_id = auth.uid());
drop policy if exists health_tokens_upd on health_tokens;
create policy health_tokens_upd on health_tokens for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Lesen: eigene Werte, und die der anderen Person im Haushalt, wenn sie das Teilen eingeschaltet hat.
-- Schreiben nur über die Edge Function (service_role), daher keine insert/update-Policy.
-- security definer, weil health_tokens per RLS nur die eigene Zeile zeigt
create or replace function health_shared(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select share_household from health_tokens where user_id = p_user), false)
$$;
drop policy if exists health_daily_read on health_daily;
create policy health_daily_read on health_daily for select using (
  user_id = auth.uid()
  or (household_id = my_household()
      and health_shared(health_daily.user_id)));
drop policy if exists health_daily_del on health_daily;
create policy health_daily_del on health_daily for delete using (user_id = auth.uid());

-- Namen für die Übersicht (nur Haushalt, nur wer teilt)
create or replace function health_people() returns table(user_id uuid, label text)
language sql stable security definer set search_path = public as $$
  select t.user_id, t.label from health_tokens t
   where t.household_id = my_household() and (t.user_id = auth.uid() or t.share_household)
$$;

-- Neuen Schlüssel erzeugen (alter wird ungültig). Rückgabe = Klartext, nur dieses eine Mal.
create or replace function create_health_token(p_label text default null) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare tok text := encode(gen_random_bytes(24), 'hex');
begin
  if my_household() is null then raise exception 'Erst einem Haushalt beitreten'; end if;
  insert into health_tokens(user_id, household_id, label, token_hash)
    values (auth.uid(), my_household(), coalesce(nullif(trim(p_label), ''), 'Ich'), encode(digest(tok, 'sha256'), 'hex'))
  on conflict (user_id) do update set token_hash = excluded.token_hash, household_id = excluded.household_id,
    label = coalesce(nullif(trim(p_label), ''), health_tokens.label), created_at = now(), last_used_at = null;
  return tok;
end $$;
