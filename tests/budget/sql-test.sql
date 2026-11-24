-- SQL-Tests für supabase/budget.sql. Zwei Haushalte, Zugriff nur auf den eigenen, Fixkosten buchen ohne Doppelungen.
\set ON_ERROR_STOP on
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select set_config('request.uid', '00000000-0000-0000-0000-00000000000a', false);
select (create_household('A')).id is not null as a_household;
-- Monatsende-Regel
select budget_nth_due('2026-01-31', 'monthly', 1) = '2026-02-28' and budget_nth_due('2026-01-31', 'monthly', 2) = '2026-03-31' as month_end_ok;
-- Fixkosten seit 3 Monaten
insert into budget_recurring(household_id, name, amount, category, freq, start_date, next_due)
  values (my_household(), 'Miete', 900, 'wo-miete', 'monthly', (now() at time zone 'Europe/Berlin')::date - interval '70 days', (now() at time zone 'Europe/Berlin')::date - interval '70 days');
select budget_book_due() as booked_first;
select budget_book_due() = 0 as no_double_booking;
select count(*) between 3 and 4 as tx_count_ok from budget_tx;
select next_due > (now() at time zone 'Europe/Berlin')::date as next_in_future, n between 3 and 4 as n_ok from budget_recurring;
-- Neustart des Rhythmus mit gleichem Startdatum bucht nichts doppelt (eindeutiger Index)
update budget_recurring set n = 0, next_due = start_date;
select budget_book_due() = 0 as restart_no_double;
-- Police mit Seitenzahl
insert into budget_policies(household_id, name, pages) values (my_household(), 'Kfz', '["a","b","c"]');
select page_count = 3 as page_count_ok from budget_policies;
insert into budget_settings(household_id, value) values (my_household(), '{"limits":{"lebensmittel":45000}}');
-- Person B: eigener Haushalt, sieht nichts von A
select set_config('request.uid', '00000000-0000-0000-0000-00000000000b', false);
select (create_household('B')).id is not null as b_household;
select count(*) = 0 as b_sees_no_tx from budget_tx;
select count(*) = 0 as b_sees_no_policies from budget_policies;
select count(*) = 0 as b_sees_no_settings from budget_settings;
-- B darf nicht in A schreiben
do $$ declare a uuid; begin
  select household_id into a from members where user_id = '00000000-0000-0000-0000-00000000000a';
  begin insert into budget_tx(household_id, date, amount, category) values (a, current_date, 1, 'x'); raise exception 'FEHLER: Schreiben in fremden Haushalt möglich';
  exception when insufficient_privilege then raise notice 'ok: fremder Haushalt gesperrt'; end;
end $$;
-- B darf nicht auf A's Fixkosten verweisen (Trigger), auch wenn die ID bekannt wäre
reset role;
do $$ declare rid uuid; begin select id into rid from budget_recurring limit 1; perform set_config('test.rid', rid::text, false); end $$;
set role authenticated;
do $$ begin
  begin insert into budget_tx(household_id, date, amount, category, recurring_id) values (my_household(), current_date, 1, 'x', current_setting('test.rid')::uuid);
    raise exception 'FEHLER: fremde Fixkosten verknüpfbar';
  exception when raise_exception then if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok: %', sqlerrm; end;
end $$;
-- Storage: nur eigener Ordner
insert into storage.objects(bucket_id, name) values ('budget-policies', my_household()::text || '/p/x.pdf');
do $$ begin
  begin insert into storage.objects(bucket_id, name) values ('budget-policies', gen_random_uuid()::text || '/p/x.pdf'); raise exception 'FEHLER: fremder Ordner beschreibbar';
  exception when insufficient_privilege then raise notice 'ok: fremder Ordner gesperrt'; end;
end $$;
select budget_book_due() = 0 as b_books_nothing;
