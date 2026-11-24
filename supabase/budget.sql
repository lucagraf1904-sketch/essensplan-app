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
create unique index if not exists budget_pots_auto_rest on budget_pots(household_id) where auto_rest;

alter table budget_tx add column if not exists pot_id uuid references budget_pots(id) on delete cascade;
alter table budget_tx add column if not exists ext_ref text;   -- z. B. 'rest:2026-10' (Monatsrest) oder 'sk:<log-id>' (Einkauf aus der Speisekammer)
alter table budget_recurring add column if not exists pot_id uuid references budget_pots(id) on delete cascade;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'budget_tx_ext_ref') then
    alter table budget_tx add constraint budget_tx_ext_ref unique (household_id, ext_ref); end if;
end $$;
-- Neue Arten: save = in den Spartopf, unsave = aus dem Spartopf. Beide brauchen einen Topf, die anderen keinen.
alter table budget_tx drop constraint if exists budget_tx_kind_check;
alter table budget_tx add constraint budget_tx_kind_check check (kind in ('expense', 'income', 'save', 'unsave'));
alter table budget_tx drop constraint if exists budget_tx_pot_check;
alter table budget_tx add constraint budget_tx_pot_check check ((kind in ('save', 'unsave')) = (pot_id is not null));
alter table budget_tx drop constraint if exists budget_tx_source_check;
alter table budget_tx add constraint budget_tx_source_check check (source in ('manual', 'receipt', 'recurring', 'import', 'rest', 'pantry'));
alter table budget_recurring drop constraint if exists budget_recurring_kind_check;
alter table budget_recurring add constraint budget_recurring_kind_check check (kind in ('expense', 'income', 'save'));
alter table budget_recurring drop constraint if exists budget_recurring_pot_check;
alter table budget_recurring add constraint budget_recurring_pot_check check ((kind = 'save') = (pot_id is not null));
create index if not exists budget_tx_pot on budget_tx(pot_id) where pot_id is not null;
-- Ein Topf mit Buchungen lässt sich nicht löschen (nur auflösen), damit keine Spar-Historie verloren geht
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'budget_tx_pot_id_fkey' and confdeltype <> 'r') then
    alter table budget_tx drop constraint budget_tx_pot_id_fkey;
    alter table budget_tx add constraint budget_tx_pot_id_fkey foreign key (pot_id) references budget_pots(id) on delete restrict;
  end if;
end $$;

-- ---------- Zugriff nur im eigenen Haushalt ----------
alter table budget_policies  enable row level security;
alter table budget_recurring enable row level security;
alter table budget_tx        enable row level security;
alter table budget_settings  enable row level security;
alter table budget_pots      enable row level security;
drop policy if exists budget_pots_all on budget_pots;
create policy budget_pots_all on budget_pots for all using (household_id = my_household()) with check (household_id = my_household());
drop policy if exists budget_policies_all on budget_policies;
create policy budget_policies_all on budget_policies for all using (household_id = my_household()) with check (household_id = my_household());
drop policy if exists budget_recurring_all on budget_recurring;
create policy budget_recurring_all on budget_recurring for all using (household_id = my_household()) with check (household_id = my_household());
drop policy if exists budget_tx_all on budget_tx;
create policy budget_tx_all on budget_tx for all using (household_id = my_household()) with check (household_id = my_household());
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
create or replace function budget_book_due() returns int
language plpgsql security invoker set search_path = public as $$
declare
  r budget_recurring;
  today date := (now() at time zone 'Europe/Berlin')::date;
  d date; k int; guard int; cnt int := 0; hh uuid := my_household();
begin
  if hh is null then raise exception 'Kein Haushalt'; end if;
  for r in select * from budget_recurring where household_id = hh and active and next_due <= today for update skip locked loop
    d := r.next_due; k := r.n; guard := 0;
    while d <= today and (r.end_date is null or d <= r.end_date) and guard < 60 loop
      insert into budget_tx(household_id, date, amount, kind, category, note, source, recurring_id, due_date, pot_id)
        values (r.household_id, d, r.amount, r.kind, r.category, r.name, 'recurring', r.id, d, r.pot_id)
        on conflict (recurring_id, due_date) where recurring_id is not null do nothing;
      if found then cnt := cnt + 1; end if;
      k := k + 1; guard := guard + 1;
      d := budget_nth_due(r.start_date, r.freq, k);
    end loop;
    update budget_recurring set next_due = d, n = k, active = (r.end_date is null or d <= r.end_date) where id = r.id;
  end loop;
  return cnt;
end $$;

-- ---------- Speicher für Policen (privat, je Haushalt ein Ordner) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('budget-policies', 'budget-policies', false, 26214400, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists budget_policies_files on storage.objects;
create policy budget_policies_files on storage.objects for all to authenticated
  using (bucket_id = 'budget-policies' and (storage.foldername(name))[1] = public.my_household()::text)
  with check (bucket_id = 'budget-policies' and (storage.foldername(name))[1] = public.my_household()::text);

-- ---------- Rechte und Live-Abgleich ----------
grant select, insert, update, delete on budget_policies, budget_recurring, budget_tx, budget_settings, budget_pots to authenticated;
grant all on budget_policies, budget_recurring, budget_tx, budget_settings, budget_pots to service_role;
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
end $$;
notify pgrst, 'reload schema';
