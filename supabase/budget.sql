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
alter table budget_tx add constraint budget_tx_kind_check check (kind in ('expense', 'income', 'save', 'unsave'));
alter table budget_tx drop constraint if exists budget_tx_pot_check;
alter table budget_tx add constraint budget_tx_pot_check check ((kind in ('save', 'unsave')) = (pot_id is not null));
alter table budget_tx drop constraint if exists budget_tx_source_check;
alter table budget_tx add constraint budget_tx_source_check check (source in ('manual', 'receipt', 'recurring', 'import', 'rest', 'pantry', 'cash'));
alter table budget_recurring drop constraint if exists budget_recurring_kind_check;
alter table budget_recurring add constraint budget_recurring_kind_check check (kind in ('expense', 'income', 'save'));
alter table budget_recurring drop constraint if exists budget_recurring_pot_check;
alter table budget_recurring add constraint budget_recurring_pot_check check ((kind = 'save') = (pot_id is not null));
create index if not exists budget_tx_pot on budget_tx(pot_id) where pot_id is not null;
-- ETFs (Version 5): eine Art Spartopf. Eingezahlt = Startbetrag + Sparplan + Einmalzahlungen − Verkäufe (wie beim Topf),
-- den aktuellen Depotwert trägt man selbst ein (market_value, Stand market_value_at). Keine Kursabfrage.
alter table budget_pots add column if not exists kind text not null default 'pot';
alter table budget_pots drop constraint if exists budget_pots_kind_check;
alter table budget_pots add constraint budget_pots_kind_check check (kind in ('pot', 'etf', 'reserve'));  -- reserve: Geld in einem Bargeld-Umschlag mit Fixkosten (Version 7)
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

-- Darf ich einen Eintrag von p_owner im Bereich p_area sehen? Eigene und gemeinsame immer, fremde private nur bei Freigabe 'all'.
create or replace function budget_can_see(p_owner uuid, p_area text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_owner is null or p_owner = auth.uid() or exists (
    select 1 from budget_members m where m.user_id = p_owner and m.household_id = my_household() and m.share->>p_area = 'all')
$$;
-- Ändern dürfen alle nur Gemeinsames und Eigenes (Fremdes auch bei Freigabe nur ansehen)
create or replace function budget_can_write(p_owner uuid) returns boolean
language sql stable set search_path = public as $$ select p_owner is null or p_owner = auth.uid() $$;

-- ---------- Bargeld-Umschläge (Version 4) ----------
-- Jeder Umschlag bekommt monatlich seinen Betrag. Die Summe zeigt, wie viel Bargeld abzuheben ist.
-- „Abgehoben“ bucht je Umschlag eine Ausgabe (source 'cash', ext_ref 'cash:<Monat>:<Umschlag>'). Restgeld wird nicht mitgeführt.
create table if not exists budget_cash (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  icon text not null default '💶',
  amount numeric(12,2) not null check (amount > 0),
  category text not null default 'sonstiges',
  owner uuid references auth.users(id) on delete cascade,   -- null = gemeinsam
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists budget_cash_household on budget_cash(household_id);
-- Version 7: Rücklage-Umschläge. Ein Umschlag mit zugeordneten Fixkosten sammelt sein Geld in einem verdeckten Topf (kind 'reserve'):
-- Abheben = Einzahlung in diesen Topf, Fälligkeit der Fixkosten = Ausgabe wie bisher + Entnahme aus dem Topf (bucht budget_book_due).
alter table budget_cash add column if not exists pot_id uuid references budget_pots(id) on delete set null;
alter table budget_recurring add column if not exists cash_id uuid references budget_cash(id) on delete set null;

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
-- Bargeld-Umschläge: Sichtbarkeit wie Fixkosten (geplantes Monatsgeld)
alter table budget_cash enable row level security;
drop policy if exists budget_cash_read on budget_cash;
-- Gleicher Bereich wie die Buchungen beim Abheben ('tx'): wer den Umschlag sieht, sieht auch, ob er abgehoben ist
create policy budget_cash_read on budget_cash for select using (household_id = my_household() and budget_can_see(owner, 'tx'));
drop policy if exists budget_cash_write on budget_cash;
create policy budget_cash_write on budget_cash for all using (household_id = my_household() and budget_can_write(owner)) with check (household_id = my_household() and budget_can_write(owner));
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
    if new.cash_id is not null and not exists (select 1 from budget_cash where id = new.cash_id and household_id = new.household_id) then
      raise exception 'Umschlag gehört nicht zu diesem Haushalt';
    end if;
  end if;
  if tg_table_name in ('budget_tx', 'budget_recurring') and new.account_id is not null
     and not exists (select 1 from budget_accounts where id = new.account_id and household_id = new.household_id) then
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
  if new.owner is distinct from old.owner and (exists (select 1 from budget_tx where pot_id = old.id) or exists (select 1 from budget_recurring where pot_id = old.id)) then
    raise exception 'Ein Spartopf mit Buchungen kann nicht zwischen privat und gemeinsam wechseln.';
  end if;
  return new;
end $$;
drop trigger if exists budget_pots_owner_lock on budget_pots;
create trigger budget_pots_owner_lock before update on budget_pots for each row execute function budget_pot_owner_lock();

drop trigger if exists budget_cash_touch on budget_cash;
create or replace function budget_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create trigger budget_cash_touch before insert or update on budget_cash for each row execute function budget_touch();

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
  d date; k int; guard int; cnt int := 0; hh uuid := my_household(); cp uuid; co uuid;
begin
  if hh is null then raise exception 'Kein Haushalt'; end if;
  for r in select * from budget_recurring where household_id = hh and active and next_due <= today for update skip locked loop
    -- Jede Fixkosten-Position für sich: ein fehlerhafter Eintrag hält die anderen nicht auf
    begin
      d := r.next_due; k := r.n; guard := 0;
      while d <= today and (r.end_date is null or d <= r.end_date) and guard < 60 loop
        insert into budget_tx(household_id, date, amount, kind, category, note, source, recurring_id, due_date, pot_id, owner, account_id)
          values (r.household_id, d, r.amount, r.kind, r.category, r.name, 'recurring', r.id, d, r.pot_id, r.owner, r.account_id)
          on conflict (recurring_id, due_date) where recurring_id is not null do nothing;
        -- nur mitzählen, was die aufrufende Person sehen darf (sonst verrät die Zahl private Buchungen anderer)
        if found then
          if r.owner is null or r.owner = auth.uid() then cnt := cnt + 1; end if;
          -- Aus Rücklage-Umschlag bezahlt: gleichen Betrag aus dem Umschlag-Topf nehmen (zählt dann nicht noch einmal gegen „Noch frei“)
          if r.cash_id is not null and r.kind = 'expense' then
            cp := null; co := null;
            select c.pot_id, p.owner into cp, co from budget_cash c join budget_pots p on p.id = c.pot_id
             where c.id = r.cash_id and c.household_id = hh and not p.archived;
            if cp is not null then
              insert into budget_tx(household_id, date, amount, kind, category, note, source, pot_id, owner, ext_ref)
                values (hh, d, r.amount, 'unsave', 'fi-sparen', 'Aus Umschlag: ' || r.name, 'recurring', cp, co, 'cover:' || r.id::text || ':' || d::text)
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
   where p.household_id = my_household() and not p.archived and m.share->>'pots' = 'sums'
   group by p.owner, p.kind
  union all
  select r.owner, 'fixed', null, r.kind, null,
         sum(r.amount * case r.freq when 'weekly' then 52.0 / 12 when 'monthly' then 1 when 'quarterly' then 1.0 / 3 when 'halfyearly' then 1.0 / 6 else 1.0 / 12 end)
    from budget_recurring r join m on m.user_id = r.owner
   where r.household_id = my_household() and r.active and r.pot_id is null and m.share->>'fixed' = 'sums'
   group by r.owner, r.kind
  union all
  select c.owner, 'cash', to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY-MM'), 'expense', c.category, sum(c.amount)
    from budget_cash c join m on m.user_id = c.owner
   where c.household_id = my_household() and c.active and c.pot_id is null and m.share->>'tx' = 'sums'
     and not exists (select 1 from budget_tx t where t.household_id = c.household_id
                     and t.ext_ref = 'cash:' || to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY-MM') || ':' || c.id::text)
   group by c.owner, c.category
$$;

-- ---------- Rechte und Live-Abgleich ----------
grant select, insert, update, delete on budget_policies, budget_recurring, budget_tx, budget_settings, budget_pots, budget_members, budget_accounts, budget_cash to authenticated;
grant all on budget_policies, budget_recurring, budget_tx, budget_settings, budget_pots, budget_members, budget_accounts, budget_cash to service_role;
grant execute on function budget_can_see(uuid, text), budget_can_write(uuid), budget_shared_sums(date) to authenticated;
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
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'budget_cash') then
    alter publication supabase_realtime add table budget_cash; end if;
end $$;
notify pgrst, 'reload schema';
