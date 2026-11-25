-- Haushaltskasse (Budget-App unter /budget): Datenbankschema für Supabase.
-- Voraussetzung: supabase/schema.sql wurde bereits ausgeführt (households, members, my_household()).
-- Im Supabase-Dashboard unter SQL Editor einfügen und ausführen. Mehrfach ausführbar (idempotent).
-- Alle Daten hängen am Haushalt; Row Level Security zeigt nur die Daten des eigenen Haushalts.

-- ---------- Versicherungen (Police als PDF im Storage, ausgelesener Text je Seite in pages) ----------
create table if not exists budget_policies (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,                    -- z. B. „Autoversicherung Golf“
  category text not null default 'vers-sonst',
  insurer text,
  policy_no text,
  contract_end date,                     -- Ablauf / Hauptfälligkeit
  notice_months int check (notice_months between 0 and 24),
  notes text,                            -- eigene Notizen, z. B. Selbstbeteiligung
  file_path text,                        -- Pfad im Bucket budget-policies: <household_id>/<policy_id>/<datei>
  file_name text,
  pages jsonb,                           -- ["Text Seite 1", "Text Seite 2", …]
  text_source text check (text_source in ('pdf', 'photo', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Seitenzahl für die Liste, ohne die (großen) Seitentexte laden zu müssen
alter table budget_policies add column if not exists page_count int generated always as (case when jsonb_typeof(pages) = 'array' then jsonb_array_length(pages) else 0 end) stored;

-- ---------- Fixkosten und regelmäßige Einnahmen ----------
-- Fälligkeit k (0, 1, 2, …) = budget_nth_due(start_date, freq, k). next_due ist die Fälligkeit Nummer n.
create table if not exists budget_recurring (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  amount numeric(12,2) not null check (amount >= 0),
  kind text not null default 'expense' check (kind in ('expense', 'income')),
  category text not null,
  freq text not null default 'monthly' check (freq in ('weekly', 'monthly', 'quarterly', 'halfyearly', 'yearly')),
  start_date date not null,
  next_due date not null,
  n int not null default 0,
  end_date date,
  contract_end date,
  notice_months int check (notice_months between 0 and 24),
  active boolean not null default true,
  policy_id uuid references budget_policies(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Buchungen ----------
create table if not exists budget_tx (
  id uuid primary key default gen_random_uuid(),   -- vom Handy erzeugt, damit erneutes Senden nichts doppelt bucht
  household_id uuid not null references households(id) on delete cascade,
  date date not null,
  amount numeric(12,2) not null check (amount >= 0),
  kind text not null default 'expense' check (kind in ('expense', 'income')),
  category text not null,
  note text,
  source text not null default 'manual' check (source in ('manual', 'receipt', 'recurring', 'import')),
  recurring_id uuid references budget_recurring(id) on delete set null,
  due_date date,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists budget_tx_household_date on budget_tx(household_id, date desc);
create unique index if not exists budget_tx_recurring_due on budget_tx(recurring_id, due_date) where recurring_id is not null;

-- ---------- Einstellungen des Haushalts (Budgets je Kategorie, eigene Kategorien) ----------
create table if not exists budget_settings (
  household_id uuid primary key references households(id) on delete cascade,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- Spartöpfe (Version 2, 24.11.2026) ----------
-- Stand eines Topfs = start_balance + Einzahlungen (budget_tx.kind = 'save') − Entnahmen ('unsave').
create table if not exists budget_pots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  icon text not null default '🐷',
  goal numeric(12,2) check (goal is null or goal > 0),   -- Sparziel, optional
  target_date date,                                      -- bis wann, optional
  start_balance numeric(12,2) not null default 0,        -- was schon drauf war, als der Topf angelegt wurde
  auto_rest boolean not null default false,              -- Monatsrest automatisch hierher
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Nur ein Topf bekommt den Monatsrest automatisch
-- (Index für „Monatsrest automatisch“ steht ab Version 3 weiter unten, je Person)

alter table budget_tx add column if not exists pot_id uuid references budget_pots(id) on delete cascade;
alter table budget_tx add column if not exists ext_ref text;   -- z. B. 'rest:2026-10' (Monatsrest) oder 'sk:<log-id>' (Einkauf aus der Speisekammer)
alter table budget_recurring add column if not exists pot_id uuid references budget_pots(id) on delete cascade;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'budget_tx_ext_ref') then
    alter table budget_tx add constraint budget_tx_ext_ref unique (household_id, ext_ref); end if;
end $$;
-- Neue Arten: save = in den Spartopf, unsave = aus dem Spartopf. Beide brauchen einen Topf, die anderen keinen.
alter table budget_tx drop constraint if exists budget_tx_kind_check;
alter table budget_tx add constraint budget_tx_kind_check check (kind in ('expense', 'income', 'save', 'unsave', 'transfer'));  -- transfer: Version 10
alter table budget_tx drop constraint if exists budget_tx_pot_check;
alter table budget_tx add constraint budget_tx_pot_check check ((kind in ('save', 'unsave')) = (pot_id is not null));
alter table budget_tx drop constraint if exists budget_tx_source_check;
alter table budget_tx add constraint budget_tx_source_check check (source in ('manual', 'receipt', 'recurring', 'import', 'rest', 'pantry', 'cash'));
alter table budget_recurring drop constraint if exists budget_recurring_kind_check;
alter table budget_recurring add constraint budget_recurring_kind_check check (kind in ('expense', 'income', 'save', 'transfer'));  -- transfer: Version 10
alter table budget_recurring drop constraint if exists budget_recurring_pot_check;
alter table budget_recurring add constraint budget_recurring_pot_check check ((kind = 'save') = (pot_id is not null));
create index if not exists budget_tx_pot on budget_tx(pot_id) where pot_id is not null;
-- ETFs (Version 5): eine Art Spartopf. Eingezahlt = Startbetrag + Sparplan + Einmalzahlungen − Verkäufe (wie beim Topf),
-- den aktuellen Depotwert trägt man selbst ein (market_value, Stand market_value_at). Keine Kursabfrage.
alter table budget_pots add column if not exists kind text not null default 'pot';
alter table budget_pots drop constraint if exists budget_pots_kind_check;
update budget_pots set kind = 'pot' where kind = 'reserve';  -- Version 9: Rücklagen der früheren Bargeld-Umschläge sind normale Spartöpfe
alter table budget_pots add constraint budget_pots_kind_check check (kind in ('pot', 'etf'));
alter table budget_pots add column if not exists isin text check (isin is null or isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$');
alter table budget_pots add column if not exists market_value numeric(14,2) check (market_value is null or market_value >= 0);
alter table budget_pots add column if not exists market_value_at date;
-- Ein Topf mit Buchungen lässt sich nicht löschen (nur auflösen), damit keine Spar-Historie verloren geht
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'budget_tx_pot_id_fkey' and confdeltype <> 'r') then
    alter table budget_tx drop constraint budget_tx_pot_id_fkey;
    alter table budget_tx add constraint budget_tx_pot_id_fkey foreign key (pot_id) references budget_pots(id) on delete restrict;
  end if;
end $$;

-- ---------- Personen, Konten, Freigaben (Version 3, 24.11.2026) ----------
-- owner = null: gehört dem Haushalt, alle sehen es. owner = Person: privat, die anderen sehen es nur nach Freigabe (budget_members.share).
create table if not exists budget_members (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  display_name text,
  -- Freigabe der eigenen privaten Einträge je Bereich: none | sums | all (policies: none | all)
  share jsonb not null default '{"tx":"none","fixed":"none","pots":"none","policies":"none"}'::jsonb,
  default_private boolean not null default false,   -- neue Einträge vom eigenen Konto standardmäßig privat
  updated_at timestamptz not null default now()
);
create table if not exists budget_accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  owner uuid references auth.users(id) on delete cascade,  -- null = Gemeinschaftskonto
  icon text not null default '💳',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists budget_accounts_name on budget_accounts(household_id, coalesce(owner, '00000000-0000-0000-0000-000000000000'::uuid), name);
alter table budget_tx        add column if not exists owner uuid references auth.users(id) on delete cascade;
alter table budget_tx        add column if not exists account_id uuid references budget_accounts(id) on delete set null;
alter table budget_recurring add column if not exists owner uuid references auth.users(id) on delete cascade;
alter table budget_recurring add column if not exists account_id uuid references budget_accounts(id) on delete set null;
alter table budget_pots      add column if not exists owner uuid references auth.users(id) on delete cascade;
alter table budget_policies  add column if not exists owner uuid references auth.users(id) on delete cascade;
-- Version 3: je Person ein Topf für den eigenen Rest, dazu einer für den gemeinsamen Rest (owner null)
drop index if exists budget_pots_auto_rest;
create unique index if not exists budget_pots_auto_rest_owner on budget_pots(household_id, coalesce(owner, '00000000-0000-0000-0000-000000000000'::uuid)) where auto_rest;

-- ---------- Umbuchungen und Kontostand (Version 10) ----------
-- Umbuchung (kind 'transfer'): von account_id auf to_account_id, keine Ausgabe und keine Einnahme. Auch als Dauerauftrag (budget_recurring).
alter table budget_tx        add column if not exists to_account_id uuid references budget_accounts(id) on delete set null;
alter table budget_recurring add column if not exists to_account_id uuid references budget_accounts(id) on delete set null;
alter table budget_tx drop constraint if exists budget_tx_transfer_check;
alter table budget_tx add constraint budget_tx_transfer_check check (to_account_id is null or kind = 'transfer');
alter table budget_recurring drop constraint if exists budget_recurring_transfer_check;
alter table budget_recurring add constraint budget_recurring_transfer_check check (to_account_id is null or kind = 'transfer');
-- Kontostand: eingetragener Stand (start_balance) zum Zeitpunkt balance_at; alles, was danach gebucht wird, rechnet die App dazu
alter table budget_accounts add column if not exists start_balance numeric(14,2);
alter table budget_accounts add column if not exists balance_at timestamptz;
-- Zeitpunkt des Stands setzt der Server (die Uhr des Handys kann falsch gehen und mit created_at der Buchungen verglichen werden)
create or replace function budget_balance_at() returns trigger language plpgsql set search_path = public as $$
begin
  if new.start_balance is null then new.balance_at := null;
  elsif tg_op = 'INSERT' or new.start_balance is distinct from old.start_balance or new.balance_at is distinct from old.balance_at then new.balance_at := now();
  end if;
  return new;
end $$;
drop trigger if exists budget_accounts_balance_at on budget_accounts;
create trigger budget_accounts_balance_at before insert or update on budget_accounts for each row execute function budget_balance_at();

-- Darf ich einen Eintrag von p_owner im Bereich p_area sehen? Eigene und gemeinsame immer, fremde private nur bei Freigabe 'all'.
create or replace function budget_can_see(p_owner uuid, p_area text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_owner is null or p_owner = auth.uid() or exists (
    select 1 from budget_members m where m.user_id = p_owner and m.household_id = my_household() and m.share->>p_area = 'all')
$$;
-- Ändern dürfen alle nur Gemeinsames und Eigenes (Fremdes auch bei Freigabe nur ansehen)
create or replace function budget_can_write(p_owner uuid) returns boolean
language sql stable set search_path = public as $$ select p_owner is null or p_owner = auth.uid() $$;

-- ---------- Fixkosten aus einem Spartopf bezahlen (Version 9, ersetzt die Bargeld-Umschläge der Versionen 4, 7 und 8) ----------
-- pay_pot_id: Die Fixkosten gehen nicht vom Konto ab, sondern werden aus diesem Topf bezahlt. Am Zahltag bucht budget_book_due
-- die Ausgabe (ohne Konto) und nimmt den gleichen Betrag aus dem Topf. Vom Konto geht nur die Sparrate des Topfs ab, so oft wie dort eingestellt.
alter table budget_recurring add column if not exists pay_pot_id uuid references budget_pots(id) on delete set null;
alter table budget_recurring drop constraint if exists budget_recurring_pay_pot_check;
alter table budget_recurring add constraint budget_recurring_pay_pot_check check (pay_pot_id is null or kind = 'expense');
create index if not exists budget_recurring_pay_pot on budget_recurring(pay_pot_id) where pay_pot_id is not null;

-- ---------- Zugriff nur im eigenen Haushalt ----------
alter table budget_policies  enable row level security;
alter table budget_recurring enable row level security;
alter table budget_tx        enable row level security;
alter table budget_settings  enable row level security;
alter table budget_pots      enable row level security;
alter table budget_members   enable row level security;
alter table budget_accounts  enable row level security;
-- Alte Regeln (Version 1/2: alles im Haushalt sichtbar) entfernen
drop policy if exists budget_pots_all on budget_pots;
drop policy if exists budget_policies_all on budget_policies;
drop policy if exists budget_recurring_all on budget_recurring;
drop policy if exists budget_tx_all on budget_tx;
do $$ declare t text; begin
  foreach t in array array['budget_pots', 'budget_policies', 'budget_recurring', 'budget_tx'] loop
    execute format('drop policy if exists %s_read on %s', t, t);
    execute format('drop policy if exists %s_ins on %s', t, t);
    execute format('drop policy if exists %s_upd on %s', t, t);
    execute format('drop policy if exists %s_del on %s', t, t);
    execute format('create policy %s_ins on %s for insert with check (household_id = my_household() and budget_can_write(owner))', t, t);
    execute format('create policy %s_upd on %s for update using (household_id = my_household() and budget_can_write(owner)) with check (household_id = my_household() and budget_can_write(owner))', t, t);
    execute format('create policy %s_del on %s for delete using (household_id = my_household() and budget_can_write(owner))', t, t);
  end loop;
end $$;
create policy budget_tx_read on budget_tx for select using (household_id = my_household() and budget_can_see(owner, case when pot_id is null then 'tx' else 'pots' end));
create policy budget_recurring_read on budget_recurring for select using (household_id = my_household() and budget_can_see(owner, case when pot_id is null then 'fixed' else 'pots' end));
create policy budget_pots_read on budget_pots for select using (household_id = my_household() and budget_can_see(owner, 'pots'));
-- Version 6: Versicherungen (Kategorie vers-*) und andere Verträge (Arbeit, Miete …) haben getrennte Freigaben
create policy budget_policies_read on budget_policies for select using (household_id = my_household() and budget_can_see(owner, case when category like 'vers-%' then 'policies' else 'contracts' end));
drop policy if exists budget_members_read on budget_members;
create policy budget_members_read on budget_members for select using (household_id = my_household());
drop policy if exists budget_members_write on budget_members;
create policy budget_members_write on budget_members for all using (user_id = auth.uid()) with check (user_id = auth.uid() and household_id = my_household());
drop policy if exists budget_accounts_read on budget_accounts;
create policy budget_accounts_read on budget_accounts for select using (household_id = my_household());
drop policy if exists budget_accounts_write on budget_accounts;
create policy budget_accounts_write on budget_accounts for all using (household_id = my_household() and budget_can_write(owner)) with check (household_id = my_household() and budget_can_write(owner));
drop policy if exists budget_settings_all on budget_settings;
create policy budget_settings_all on budget_settings for all using (household_id = my_household()) with check (household_id = my_household());

-- Verknüpfungen nur innerhalb des eigenen Haushalts (sonst könnte eine fremde ID eingetragen werden)
create or replace function budget_check_links() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- getrennte IFs: PL/pgSQL würde sonst new.recurring_id auch bei budget_recurring auswerten (Feld fehlt dort)
  if tg_table_name in ('budget_tx', 'budget_recurring') and new.pot_id is not null
     and not exists (select 1 from budget_pots where id = new.pot_id and household_id = new.household_id) then
    raise exception 'Spartopf gehört nicht zu diesem Haushalt';
  end if;
  if tg_table_name = 'budget_recurring' then
    -- Bezahlt aus Spartopf: gleicher Haushalt, gleicher Besitzer, normaler Topf (kein ETF), nicht aufgelöst
    if new.pay_pot_id is not null and not exists (select 1 from budget_pots where id = new.pay_pot_id and household_id = new.household_id
        and kind = 'pot' and not archived and owner is not distinct from new.owner) then
      raise exception 'Spartopf passt nicht: Fixkosten und Topf müssen beide gemeinsam oder beide privat sein (kein ETF, nicht aufgelöst)';
    end if;
  end if;
  if tg_table_name in ('budget_tx', 'budget_recurring') and new.account_id is not null
     and not exists (select 1 from budget_accounts where id = new.account_id and household_id = new.household_id) then
    raise exception 'Konto gehört nicht zu diesem Haushalt';
  end if;
  if tg_table_name in ('budget_tx', 'budget_recurring') and new.to_account_id is not null
     and not exists (select 1 from budget_accounts where id = new.to_account_id and household_id = new.household_id) then
    raise exception 'Konto gehört nicht zu diesem Haushalt';
  end if;
  if tg_table_name in ('budget_tx', 'budget_recurring') and new.pot_id is not null
     and new.owner is distinct from (select owner from budget_pots where id = new.pot_id) then
    -- gleiche Meldung wie „nicht gefunden“, damit niemand erfährt, ob es einen fremden privaten Topf mit dieser ID gibt
    raise exception 'Spartopf gehört nicht zu diesem Haushalt';
  end if;
  if tg_table_name = 'budget_tx' then
    if new.recurring_id is not null and not exists (select 1 from budget_recurring where id = new.recurring_id and household_id = new.household_id) then
      raise exception 'Fixkosten-Eintrag gehört nicht zu diesem Haushalt';
    end if;
  elsif tg_table_name = 'budget_recurring' then
    if new.policy_id is not null and not exists (select 1 from budget_policies where id = new.policy_id and household_id = new.household_id) then
      raise exception 'Versicherung gehört nicht zu diesem Haushalt';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists budget_tx_links on budget_tx;
create trigger budget_tx_links before insert or update on budget_tx for each row execute function budget_check_links();
drop trigger if exists budget_recurring_links on budget_recurring;
create trigger budget_recurring_links before insert or update on budget_recurring for each row execute function budget_check_links();

-- Ein Topf mit Buchungen oder Sparrate kann nicht mehr zwischen privat und gemeinsam wechseln
create or replace function budget_pot_owner_lock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner is distinct from old.owner and (exists (select 1 from budget_tx where pot_id = old.id) or exists (select 1 from budget_recurring where pot_id = old.id or pay_pot_id = old.id)) then
    raise exception 'Ein Spartopf mit Buchungen kann nicht zwischen privat und gemeinsam wechseln.';
  end if;
  return new;
end $$;
drop trigger if exists budget_pots_owner_lock on budget_pots;
create trigger budget_pots_owner_lock before update on budget_pots for each row execute function budget_pot_owner_lock();

-- Topf aufgelöst: Fixkosten, die daraus bezahlt wurden, gehen wieder vom Konto ab (auch private anderer Personen, die man selbst nicht ändern darf)
create or replace function budget_pot_unlink() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.archived and not old.archived then update budget_recurring set pay_pot_id = null where pay_pot_id = new.id and household_id = new.household_id; end if;
  return new;
end $$;
drop trigger if exists budget_pots_unlink on budget_pots;
create trigger budget_pots_unlink after update on budget_pots for each row execute function budget_pot_unlink();

-- ---------- Umstellung Version 8 → 9: Bargeld-Umschläge entfernen ----------
-- Rücklage-Umschläge (mit Fixkosten) werden zu Spartöpfen mit gleichem Namen und Inhalt: Die Fixkosten werden daraus bezahlt,
-- der Abhebe-Betrag wird zur Sparrate im gleichen Rhythmus (ab der nächsten noch nicht abgehobenen Abhebung, vom zuletzt genutzten Konto).
-- Normale Umschläge entfallen, ihre bisherigen Buchungen bleiben. Läuft nur, solange es die Tabelle budget_cash noch gibt.
do $$
declare c record; p record; step int; i int; mk text; d date; acc uuid; dd int; diff int;
  today date := (now() at time zone 'Europe/Berlin')::date;
begin
  if to_regclass('public.budget_cash') is null then return; end if;
  for c in execute 'select * from budget_cash where pot_id is not null and active order by created_at' loop
    select * into p from budget_pots where id = c.pot_id and household_id = c.household_id and not archived;
    if not found then continue; end if;
    update budget_pots set kind = 'pot', name = c.name, icon = c.icon where id = p.id;
    execute 'update budget_recurring set pay_pot_id = $1 where cash_id = $2 and kind = ''expense'' and owner is not distinct from $3' using p.id, c.id, p.owner;
    execute 'select count(*) from budget_recurring where cash_id = $1 and pay_pot_id is distinct from $2' into i using c.id, p.id;
    if i > 0 then raise notice 'Umschlag %: % Fixkosten mit anderem Besitzer werden wieder vom Konto bezahlt', c.id, i; end if;
    if exists (select 1 from budget_recurring where pot_id = p.id and kind = 'save' and active) then continue; end if;
    step := case c.freq when 'quarterly' then 3 when 'halfyearly' then 6 when 'yearly' then 12 else 1 end;
    dd := least(coalesce(c.withdraw_day, 1), 28); d := null;
    for i in 0..24 loop
      mk := to_char(date_trunc('month', today) + make_interval(months => i), 'YYYY-MM');
      if c.start_month is not null then
        if mk < c.start_month then continue; end if;
        diff := (substr(mk, 1, 4)::int * 12 + substr(mk, 6, 2)::int) - (substr(c.start_month, 1, 4)::int * 12 + substr(c.start_month, 6, 2)::int);
        if mod(diff, step) <> 0 then continue; end if;
      end if;
      -- in diesem Monat schon abgehoben: erst die nächste Abhebung wird Sparrate
      if i = 0 and exists (select 1 from budget_tx where household_id = c.household_id and ext_ref = 'cash:' || mk || ':' || c.id::text) then continue; end if;
      d := greatest(to_date(mk || '-' || lpad(dd::text, 2, '0'), 'YYYY-MM-DD'), today);
      exit;
    end loop;
    if d is null then continue; end if;
    acc := null;
    select account_id into acc from budget_tx where pot_id = p.id and source = 'cash' and account_id is not null order by date desc, created_at desc limit 1;
    insert into budget_recurring(household_id, name, amount, kind, category, freq, start_date, next_due, n, pot_id, owner, account_id)
      values (c.household_id, 'Sparrate ' || c.name, c.amount, 'save', 'fi-sparen', c.freq, d, d, 0, p.id, p.owner, acc);
  end loop;
end $$;
alter table budget_recurring drop column if exists cash_id;
drop table if exists budget_cash cascade;   -- entfernt auch budget_cash_due
drop function if exists budget_cash_links();
drop function if exists budget_cash_unlink();
drop function if exists budget_touch();

-- ---------- Fixkosten automatisch buchen ----------
-- Monatsende wird abgefangen: Start 31.01. → 28./29.02. → 31.03. (Postgres rechnet date + interval so).
create or replace function budget_nth_due(p_start date, p_freq text, p_n int) returns date
language sql immutable set search_path = public as $$
  select case p_freq
    when 'weekly'     then p_start + 7 * p_n
    when 'monthly'    then (p_start + make_interval(months => p_n))::date
    when 'quarterly'  then (p_start + make_interval(months => 3 * p_n))::date
    when 'halfyearly' then (p_start + make_interval(months => 6 * p_n))::date
    when 'yearly'     then (p_start + make_interval(years => p_n))::date
  end
$$;

-- Bucht alle bis heute (Zeitzone Berlin) fälligen Fixkosten des eigenen Haushalts. Wird beim Öffnen der App aufgerufen.
-- Zwei Handys gleichzeitig: Zeilensperre (skip locked) und der eindeutige Index (recurring_id, due_date) verhindern Doppelbuchungen.
-- security definer: bucht auch private Fixkosten der anderen Personen (die man selbst nicht sieht), aber nur im eigenen Haushalt.
create or replace function budget_book_due() returns int
language plpgsql security definer set search_path = public as $$
declare
  r budget_recurring;
  today date := (now() at time zone 'Europe/Berlin')::date;
  d date; k int; guard int; cnt int := 0; hh uuid := my_household(); pp budget_pots;
begin
  if hh is null then raise exception 'Kein Haushalt'; end if;
  for r in select * from budget_recurring where household_id = hh and active and next_due <= today for update skip locked loop
    -- Jede Fixkosten-Position für sich: ein fehlerhafter Eintrag hält die anderen nicht auf
    begin
      d := r.next_due; k := r.n; guard := 0;
      while d <= today and (r.end_date is null or d <= r.end_date) and guard < 60 loop
        -- Aus Spartopf bezahlt: nicht vom Konto (account_id leer)
        insert into budget_tx(household_id, date, amount, kind, category, note, source, recurring_id, due_date, pot_id, owner, account_id, to_account_id)
          values (r.household_id, d, r.amount, r.kind, r.category, r.name, 'recurring', r.id, d, r.pot_id, r.owner, case when r.pay_pot_id is null then r.account_id end, r.to_account_id)
          on conflict (recurring_id, due_date) where recurring_id is not null do nothing;
        -- nur mitzählen, was die aufrufende Person sehen darf (sonst verrät die Zahl private Buchungen anderer)
        if found then
          if r.owner is null or r.owner = auth.uid() then cnt := cnt + 1; end if;
          -- Aus Spartopf bezahlt: gleichen Betrag aus dem Topf nehmen (zählt dann nicht noch einmal gegen „Noch frei“)
          if r.pay_pot_id is not null and r.kind = 'expense' then
            select * into pp from budget_pots where id = r.pay_pot_id and household_id = hh and not archived;
            if found then
              insert into budget_tx(household_id, date, amount, kind, category, note, source, pot_id, owner, ext_ref)
                values (hh, d, r.amount, 'unsave', 'fi-sparen', 'Bezahlt: ' || r.name, 'recurring', pp.id, pp.owner, 'cover:' || r.id::text || ':' || d::text)
                on conflict on constraint budget_tx_ext_ref do nothing;
            end if;
          end if;
        end if;
        k := k + 1; guard := guard + 1;
        d := budget_nth_due(r.start_date, r.freq, k);
      end loop;
      update budget_recurring set next_due = d, n = k, active = (r.end_date is null or d <= r.end_date) where id = r.id;
    exception when others then
      raise warning 'budget_book_due: Eintrag % übersprungen: %', r.id, sqlerrm;
    end;
  end loop;
  return cnt;
end $$;

-- ---------- Speicher für Policen (privat, je Haushalt ein Ordner) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('budget-policies', 'budget-policies', false, 26214400, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists budget_policies_files on storage.objects;
-- Lesen: wenn die Police sichtbar ist. Hochladen, ändern, löschen: nur bei eigener oder gemeinsamer Police.
-- objects.name ausdrücklich, sonst nähme Postgres in der Unterabfrage p.name.
create policy budget_policies_files on storage.objects for select to authenticated
  using (bucket_id = 'budget-policies' and (storage.foldername(objects.name))[1] = public.my_household()::text
         and exists (select 1 from public.budget_policies p where p.id::text = (storage.foldername(objects.name))[2]));
drop policy if exists budget_policies_files_ins on storage.objects;
create policy budget_policies_files_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'budget-policies' and (storage.foldername(objects.name))[1] = public.my_household()::text
         and exists (select 1 from public.budget_policies p where p.id::text = (storage.foldername(objects.name))[2] and public.budget_can_write(p.owner)));
drop policy if exists budget_policies_files_upd on storage.objects;
create policy budget_policies_files_upd on storage.objects for update to authenticated
  using (bucket_id = 'budget-policies' and (storage.foldername(objects.name))[1] = public.my_household()::text
         and exists (select 1 from public.budget_policies p where p.id::text = (storage.foldername(objects.name))[2] and public.budget_can_write(p.owner)));
drop policy if exists budget_policies_files_del on storage.objects;
create policy budget_policies_files_del on storage.objects for delete to authenticated
  using (bucket_id = 'budget-policies' and (storage.foldername(objects.name))[1] = public.my_household()::text
         and exists (select 1 from public.budget_policies p where p.id::text = (storage.foldername(objects.name))[2] and public.budget_can_write(p.owner)));

-- ---------- Freigabe „nur Summen“ ----------
-- Liefert für Personen, die einen Bereich nur als Summe freigeben, Monatssummen je Kategorie (Buchungen), je Art (Spartöpfe),
-- den Stand aller Töpfe und die monatlichen Fixkosten. Keine Einzelbuchungen, keine Notizen.
create or replace function budget_shared_sums(p_since date) returns table(owner uuid, area text, month text, kind text, category text, total numeric)
language sql stable security definer set search_path = public as $$
  with m as (select user_id, share from budget_members where household_id = my_household() and user_id <> auth.uid())
  select t.owner, case when t.pot_id is null then 'tx' else 'pots' end, to_char(t.date, 'YYYY-MM'), t.kind,
         t.category, sum(t.amount)
    from budget_tx t join m on m.user_id = t.owner
   where t.household_id = my_household() and t.date >= p_since and m.share->>(case when t.pot_id is null then 'tx' else 'pots' end) = 'sums'
   group by 1, 2, 3, 4, 5
  union all
  select p.owner, case when p.kind = 'etf' then 'etfbal' else 'potbal' end, null, null, null,
         sum(p.start_balance + coalesce((select sum(case when t.kind = 'save' then t.amount else -t.amount end) from budget_tx t where t.pot_id = p.id), 0))
    from budget_pots p join m on m.user_id = p.owner
   where p.household_id = my_household() and not p.archived and p.kind in ('pot', 'etf') and m.share->>'pots' = 'sums'
   group by p.owner, p.kind
  union all
  select r.owner, 'fixed', null, r.kind, null,
         sum(r.amount * case r.freq when 'weekly' then 52.0 / 12 when 'monthly' then 1 when 'quarterly' then 1.0 / 3 when 'halfyearly' then 1.0 / 6 else 1.0 / 12 end)
    from budget_recurring r join m on m.user_id = r.owner
   -- aus einem Spartopf bezahlte Fixkosten nicht mitzählen: dafür geht schon die Sparrate ab
   where r.household_id = my_household() and r.active and r.pot_id is null and r.pay_pot_id is null and r.kind <> 'transfer' and m.share->>'fixed' = 'sums'
   group by r.owner, r.kind
$$;

-- ---------- Kontostand (Version 10) ----------
-- Stand = eingetragener Stand + alles, was danach gebucht wurde: Einnahmen und Entnahmen aus Spartöpfen auf das Konto +,
-- Ausgaben und Einzahlungen in Spartöpfe −, Umbuchungen − beim Absender und + beim Empfänger.
-- „Danach“: Buchungsdatum nach dem Tag des Eintrags, oder am selben Tag, aber später erfasst.
-- Nur für gemeinsame und eigene Konten. security definer: zählt auch private Buchungen der anderen Person auf dem Gemeinschaftskonto mit
-- (sonst stimmte dessen Stand nicht); es wird nur die Summe gezeigt, keine Einzelbuchung.
create or replace function budget_account_balances() returns table(account_id uuid, balance numeric)
language sql stable security definer set search_path = public as $$
  select a.id, a.start_balance + coalesce((
    select sum(case when t.kind = 'transfer' then (case when t.to_account_id = a.id then t.amount else 0 end) - (case when t.account_id = a.id then t.amount else 0 end)
                    when t.kind in ('income', 'unsave') then t.amount else -t.amount end)
      from budget_tx t
     where t.household_id = a.household_id and (t.account_id = a.id or t.to_account_id = a.id)
       and (t.date > (a.balance_at at time zone 'Europe/Berlin')::date or (t.date = (a.balance_at at time zone 'Europe/Berlin')::date and t.created_at > a.balance_at))), 0)
    from budget_accounts a
   where a.household_id = my_household() and a.balance_at is not null and a.start_balance is not null and (a.owner is null or a.owner = auth.uid())
$$;

-- ---------- Rechte und Live-Abgleich ----------
grant select, insert, update, delete on budget_policies, budget_recurring, budget_tx, budget_settings, budget_pots, budget_members, budget_accounts to authenticated;
grant all on budget_policies, budget_recurring, budget_tx, budget_settings, budget_pots, budget_members, budget_accounts to service_role;
grant execute on function budget_can_see(uuid, text), budget_can_write(uuid), budget_shared_sums(date), budget_account_balances() to authenticated;
grant execute on function budget_nth_due(date, text, int), budget_book_due() to authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'budget_tx') then
    alter publication supabase_realtime add table budget_tx; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'budget_recurring') then
    alter publication supabase_realtime add table budget_recurring; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'budget_policies') then
    alter publication supabase_realtime add table budget_policies; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'budget_settings') then
    alter publication supabase_realtime add table budget_settings; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'budget_pots') then
    alter publication supabase_realtime add table budget_pots; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'budget_members') then
    alter publication supabase_realtime add table budget_members; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'budget_accounts') then
    alter publication supabase_realtime add table budget_accounts; end if;
end $$;
notify pgrst, 'reload schema';
