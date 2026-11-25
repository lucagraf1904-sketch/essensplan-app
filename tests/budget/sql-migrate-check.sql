\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
do $$
declare today date := (now() at time zone 'Europe/Berlin')::date; r record;
begin
  if to_regclass('public.budget_cash') is not null then raise exception 'FEHLER: budget_cash noch da'; end if;
  if exists (select 1 from information_schema.columns where table_name = 'budget_recurring' and column_name = 'cash_id') then raise exception 'FEHLER: cash_id noch da'; end if;
  if exists (select 1 from budget_pots where kind = 'reserve') then raise exception 'FEHLER: reserve-Töpfe übrig'; end if;
  -- 1) Name und Symbol vom Umschlag, Fixkosten aus dem Topf, Sparrate ab nächstem Monat (dieser schon abgehoben), vom zuletzt genutzten Konto
  select p.id, p.name, p.icon, p.owner into r from budget_pots p where p.name = 'Rücklage Versicherungen';
  if r.id is null or r.icon <> '🛡️' or r.owner is null then raise exception 'FEHLER: Topf 1 nicht umbenannt'; end if;
  if not exists (select 1 from budget_recurring where name = 'Kfz' and pay_pot_id = r.id) then raise exception 'FEHLER: Kfz nicht aus Topf 1'; end if;
  if not exists (select 1 from budget_recurring s where s.pot_id = r.id and s.kind = 'save' and s.amount = 50 and s.freq = 'monthly' and s.owner = r.owner
      and s.next_due = make_date(extract(year from date_trunc('month', today) + interval '1 month')::int, extract(month from date_trunc('month', today) + interval '1 month')::int, 3)
      and s.account_id = (select id from budget_accounts where name = 'Konto A')) then raise exception 'FEHLER: Sparrate Topf 1 falsch'; end if;
  -- 2) noch nicht abgehoben: Sparrate ab heute, vierteljährlich, gemeinsam
  if not exists (select 1 from budget_recurring s join budget_pots p on p.id = s.pot_id where p.name = 'GEZ' and s.kind = 'save' and s.freq = 'quarterly' and s.next_due = today and s.owner is null and p.owner is null)
    then raise exception 'FEHLER: Sparrate Topf 2 falsch'; end if;
  if not exists (select 1 from budget_recurring x join budget_pots p on p.id = x.pay_pot_id where x.name = 'Rundfunk' and p.name = 'GEZ') then raise exception 'FEHLER: Rundfunk nicht aus Topf 2'; end if;
  -- genau eine Sparrate je Topf (zweiter Lauf legt nichts doppelt an), Buchungen bleiben
  if (select count(*) from budget_recurring where kind = 'save') <> 2 then raise exception 'FEHLER: Sparraten doppelt'; end if;
  if (select count(*) from budget_tx where source = 'cash') <> 2 then raise exception 'FEHLER: Buchungen verloren'; end if;
  raise notice 'Umstellung geprüft';
end $$;
