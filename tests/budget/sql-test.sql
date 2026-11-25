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
-- Spartopf mit monatlicher Sparrate: wird gebucht, Topf-Pflicht wird geprüft
insert into budget_pots(household_id, name, goal) values (my_household(), 'Urlaub', 1500);
insert into budget_recurring(household_id, name, amount, kind, category, freq, start_date, next_due, pot_id)
  select my_household(), 'Sparrate Urlaub', 50, 'save', 'fi-sparen', 'monthly', (now() at time zone 'Europe/Berlin')::date - interval '40 days', (now() at time zone 'Europe/Berlin')::date - interval '40 days', id from budget_pots;
select budget_book_due() = 2 as savings_booked;
select count(*) = 2 as save_tx_have_pot from budget_tx where kind = 'save' and pot_id is not null;
do $$ begin
  begin insert into budget_tx(household_id, date, amount, kind, category) values (my_household(), current_date, 1, 'save', 'fi-sparen'); raise exception 'FEHLER: Sparen ohne Topf möglich';
  exception when check_violation then raise notice 'ok: Sparen braucht einen Topf'; end;
end $$;
-- Monatsrest nur einmal je Monat
insert into budget_tx(household_id, date, amount, kind, category, pot_id, ext_ref, source) select my_household(), current_date, 10, 'save', 'fi-sparen', id, 'rest:2026-10', 'rest' from budget_pots;
do $$ begin
  begin insert into budget_tx(household_id, date, amount, kind, category, pot_id, ext_ref, source) select my_household(), current_date, 10, 'save', 'fi-sparen', id, 'rest:2026-10', 'rest' from budget_pots; raise exception 'FEHLER: Monatsrest doppelt';
  exception when unique_violation then raise notice 'ok: Monatsrest nur einmal'; end;
end $$;
do $$ begin
  begin delete from budget_pots; raise exception 'FEHLER: Topf mit Buchungen löschbar';
  exception when foreign_key_violation then raise notice 'ok: Topf mit Buchungen nicht löschbar'; end;
end $$;
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
select count(*) = 0 as b_sees_no_pots from budget_pots;
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
insert into budget_policies(household_id, name) values (my_household(), 'B-Police');
insert into storage.objects(bucket_id, name) select 'budget-policies', my_household()::text || '/' || id::text || '/x.pdf' from budget_policies where name = 'B-Police';
-- Datei zu nicht vorhandener Police wird abgelehnt
do $$ begin
  begin insert into storage.objects(bucket_id, name) values ('budget-policies', my_household()::text || '/p/x.pdf'); raise exception 'FEHLER: Datei ohne Police';
  exception when insufficient_privilege then raise notice 'ok: keine Datei ohne Police'; end;
end $$;
do $$ begin
  begin insert into storage.objects(bucket_id, name) values ('budget-policies', gen_random_uuid()::text || '/p/x.pdf'); raise exception 'FEHLER: fremder Ordner beschreibbar';
  exception when insufficient_privilege then raise notice 'ok: fremder Ordner gesperrt'; end;
end $$;
select budget_book_due() = 0 as b_books_nothing;

-- ---------- Version 3: Privat und Freigabe im selben Haushalt ----------
reset role;
insert into auth.users values ('00000000-0000-0000-0000-00000000000c');
select set_config('test.code', (select join_code from households where name = 'A'), false);
set role authenticated;
-- A legt Mitgliedschaft, Konten und Einträge an
select set_config('request.uid', '00000000-0000-0000-0000-00000000000a', false);

insert into budget_members(household_id, display_name) values (my_household(), 'Anna');
insert into budget_accounts(household_id, name, owner) values (my_household(), 'Annas Konto', auth.uid());
insert into budget_accounts(household_id, name) values (my_household(), 'Gemeinschaftskonto');
insert into budget_tx(household_id, date, amount, category, note, owner) values (my_household(), current_date, 42, 'li-date', 'privat A', auth.uid());
insert into budget_tx(household_id, date, amount, category, note) values (my_household(), current_date, 10, 'lm-supermarkt', 'gemeinsam');
insert into budget_policies(household_id, name, owner, pages) values (my_household(), 'Privat-Police', auth.uid(), '["geheim"]');
insert into storage.objects(bucket_id, name) select 'budget-policies', my_household()::text || '/' || id::text || '/p.pdf' from budget_policies where name = 'Privat-Police';
insert into budget_recurring(household_id, name, amount, category, freq, start_date, next_due, owner)
  values (my_household(), 'Privat-Abo', 9, 'ab-streaming', 'monthly', current_date - 1, current_date - 1, auth.uid());
-- C tritt bei
select set_config('request.uid', '00000000-0000-0000-0000-00000000000c', false);
select (join_household(current_setting('test.code'))).name = 'A' as c_joined;
insert into budget_members(household_id, display_name) values (my_household(), 'Chris');
select count(*) = 0 as c_no_private_tx from budget_tx where note = 'privat A';
select count(*) = 1 as c_sees_shared_tx from budget_tx where note = 'gemeinsam';
select count(*) = 0 as c_no_private_policy from budget_policies where name = 'Privat-Police';
select count(*) = 0 as c_no_private_file from storage.objects where name like '%/p.pdf';
select count(*) = 2 as c_sees_account_names from budget_accounts;
-- C öffnet die App: As private Fixkosten werden trotzdem gebucht (C sieht sie nicht)
select budget_book_due() = 0 as c_count_without_private;
reset role;
select count(*) >= 1 as c_books_private_of_a from budget_tx where note = 'Privat-Abo';
set role authenticated;
-- C darf nichts in As Namen anlegen
do $$ begin
  begin insert into budget_tx(household_id, date, amount, category, owner) values (my_household(), current_date, 1, 'x', '00000000-0000-0000-0000-00000000000a'); raise exception 'FEHLER: im fremden Namen gebucht';
  exception when insufficient_privilege then raise notice 'ok: nicht im fremden Namen'; end;
end $$;
-- A gibt Buchungen nur als Summe frei
select set_config('request.uid', '00000000-0000-0000-0000-00000000000a', false);
update budget_members set share = share || '{"tx":"sums"}' where user_id = auth.uid();
select set_config('request.uid', '00000000-0000-0000-0000-00000000000c', false);
select count(*) = 0 as sums_hides_rows from budget_tx where note = 'privat A';
select (select total from budget_shared_sums(current_date - 400) where area = 'tx' and category = 'li-date') = 42 as sums_visible;
-- A gibt alles frei: C sieht die Zeile, darf sie aber nicht ändern
select set_config('request.uid', '00000000-0000-0000-0000-00000000000a', false);
update budget_members set share = share || '{"tx":"all","policies":"all"}' where user_id = auth.uid();
select set_config('request.uid', '00000000-0000-0000-0000-00000000000c', false);
select count(*) = 1 as all_shows_rows from budget_tx where note = 'privat A';
update budget_tx set amount = 0 where note = 'privat A';
select set_config('request.uid', '00000000-0000-0000-0000-00000000000a', false);
select amount = 42 as c_cannot_change from budget_tx where note = 'privat A';
select set_config('request.uid', '00000000-0000-0000-0000-00000000000c', false);
select count(*) = 1 as c_sees_shared_policy_file from storage.objects where name like '%/p.pdf';
-- C kann As Freigabe nicht ändern
update budget_members set share = '{}' where user_id = '00000000-0000-0000-0000-00000000000a';
select share->>'tx' = 'all' as c_cannot_change_share from budget_members where user_id = '00000000-0000-0000-0000-00000000000a';
-- Review-Befunde Version 3
-- C darf die Datei einer nur freigegebenen Police nicht löschen
delete from storage.objects where name like '%/p.pdf';
reset role;
select count(*) = 1 as file_survives_viewer_delete from storage.objects where name like '%/p.pdf';
set role authenticated;
-- Zähler verrät keine privaten Buchungen anderer
select set_config('request.uid', '00000000-0000-0000-0000-00000000000a', false);
insert into budget_recurring(household_id, name, amount, category, freq, start_date, next_due, owner)
  values (my_household(), 'Privat-Abo 2', 5, 'ab-musik', 'monthly', current_date, current_date, auth.uid());
select set_config('request.uid', '00000000-0000-0000-0000-00000000000c', false);
select budget_book_due() = 0 as count_hides_private;
-- Besitzwechsel eines Topfs mit Buchungen wird abgelehnt, das automatische Buchen läuft trotzdem
select set_config('request.uid', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  begin update budget_pots set owner = auth.uid() where name = 'Urlaub'; raise exception 'FEHLER: Besitzwechsel möglich';
  exception when raise_exception then if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok: Besitzwechsel gesperrt'; end;
end $$;
-- Monatsrest automatisch: je Person ein Topf, gemeinsam einer
insert into budget_pots(household_id, name, owner, auto_rest) values (my_household(), 'A privat', auth.uid(), true);
select set_config('request.uid', '00000000-0000-0000-0000-00000000000c', false);
insert into budget_pots(household_id, name, owner, auto_rest) values (my_household(), 'C privat', auth.uid(), true);
select count(*) = 1 as c_has_own_auto_pot from budget_pots where auto_rest and owner = auth.uid();

-- ---------- Version 9: keine Bargeld-Umschläge mehr ----------
select to_regclass('public.budget_cash') is null as cash_table_gone;
-- ---------- Version 5: ETFs ----------
select set_config('request.uid', '00000000-0000-0000-0000-00000000000a', false);
insert into budget_pots(household_id, name, kind, isin, market_value, market_value_at) values (my_household(), 'MSCI World', 'etf', 'IE00B4L5Y983', 4100, current_date);
select count(*) = 1 as etf_saved from budget_pots where kind = 'etf';
do $$ begin
  begin insert into budget_pots(household_id, name, kind, isin) values (my_household(), 'Falsch', 'etf', 'keine-isin'); raise exception 'FEHLER: ungültige ISIN gespeichert';
  exception when check_violation then raise notice 'ok: ISIN wird geprüft'; end;
end $$;
-- Summen-Freigabe trennt Töpfe und ETFs
select set_config('request.uid', '00000000-0000-0000-0000-00000000000a', false);
update budget_members set share = share || '{"pots":"sums"}' where user_id = auth.uid();
insert into budget_pots(household_id, name, kind, owner, start_balance) values (my_household(), 'Privat-ETF', 'etf', auth.uid(), 500);
select set_config('request.uid', '00000000-0000-0000-0000-00000000000c', false);
select (select sum(total) from budget_shared_sums(current_date - 40) where area = 'etfbal') = 500 as etf_sum_separate;
select coalesce((select sum(total) from budget_shared_sums(current_date - 40) where area = 'potbal'), 0) <> 500 as potbal_without_etf;
-- ---------- Version 6: getrennte Freigabe für andere Verträge ----------
select set_config('request.uid', '00000000-0000-0000-0000-00000000000a', false);
update budget_members set share = share || '{"policies":"all","contracts":"none"}' where user_id = auth.uid();
insert into budget_policies(household_id, name, category, owner) values (my_household(), 'Arbeitsvertrag A', 'ei-gehalt', auth.uid());
insert into budget_policies(household_id, name, category, owner) values (my_household(), 'Hausrat A', 'vers-hausrat', auth.uid());
select set_config('request.uid', '00000000-0000-0000-0000-00000000000c', false);
select count(*) = 0 as work_contract_hidden from budget_policies where name = 'Arbeitsvertrag A';
select count(*) = 1 as insurance_shared from budget_policies where name = 'Hausrat A';
select set_config('request.uid', '00000000-0000-0000-0000-00000000000a', false);
update budget_members set share = share || '{"contracts":"all"}' where user_id = auth.uid();
select set_config('request.uid', '00000000-0000-0000-0000-00000000000c', false);
select count(*) = 1 as work_contract_after_share from budget_policies where name = 'Arbeitsvertrag A';
-- ---------- Version 9: Fixkosten aus einem Spartopf bezahlen ----------
select set_config('request.uid', '00000000-0000-0000-0000-00000000000a', false);
insert into budget_accounts(household_id, name, owner) values (my_household(), 'Konto A', auth.uid());
insert into budget_pots(household_id, name, owner, start_balance) values (my_household(), 'Rücklagen A', auth.uid(), 100);
insert into budget_recurring(household_id, name, amount, category, freq, start_date, next_due, owner, account_id, pay_pot_id)
  select my_household(), 'Kfz jährlich', 40, 'vers-kfz', 'yearly', current_date, current_date, auth.uid(), (select id from budget_accounts where name = 'Konto A'), id
    from budget_pots where name = 'Rücklagen A';
select budget_book_due() >= 1 as pot_paid_booked;
select count(*) = 1 as expense_without_account from budget_tx where note = 'Kfz jährlich' and kind = 'expense' and account_id is null and owner = auth.uid();
select count(*) = 1 as cover_unsave_booked from budget_tx where kind = 'unsave' and note = 'Bezahlt: Kfz jährlich' and amount = 40 and owner = auth.uid()
  and pot_id = (select id from budget_pots where name = 'Rücklagen A');
select budget_book_due() = 0 as cover_not_twice;
select count(*) = 1 as cover_once from budget_tx where kind = 'unsave' and note = 'Bezahlt: Kfz jährlich';
-- Topf muss zum Besitzer passen, kein ETF; Einnahmen und Sparraten können nicht aus einem Topf bezahlt werden
do $$ begin
  begin insert into budget_recurring(household_id, name, amount, category, freq, start_date, next_due, owner, pay_pot_id)
      select my_household(), 'Gemeinsam', 10, 'wo-strom', 'monthly', current_date + 5, current_date + 5, null, id from budget_pots where name = 'Rücklagen A';
    raise exception 'FEHLER: gemeinsame Fixkosten aus privatem Topf';
  exception when raise_exception then if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok: Besitzer muss passen'; end;
  begin insert into budget_recurring(household_id, name, amount, category, freq, start_date, next_due, owner, pay_pot_id)
      select my_household(), 'Aus ETF', 10, 'wo-strom', 'monthly', current_date + 5, current_date + 5, owner, id from budget_pots where kind = 'etf' and owner is not null limit 1;
    raise exception 'FEHLER: aus ETF bezahlbar';
  exception when raise_exception then if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok: kein ETF'; end;
  begin insert into budget_recurring(household_id, name, amount, kind, category, freq, start_date, next_due, owner, pay_pot_id)
      select my_household(), 'Gehalt', 10, 'income', 'ei-gehalt', 'monthly', current_date + 5, current_date + 5, owner, id from budget_pots where name = 'Rücklagen A';
    raise exception 'FEHLER: Einnahme aus Topf';
  exception when check_violation then raise notice 'ok: nur Ausgaben'; end;
end $$;
-- Topf eines anderen Haushalts / einer anderen Person nicht verknüpfbar
reset role;
select set_config('test.paypot', (select id::text from budget_pots where name = 'Rücklagen A'), false);
set role authenticated;
select set_config('request.uid', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  begin insert into budget_recurring(household_id, name, amount, category, freq, start_date, next_due, owner, pay_pot_id)
      values (my_household(), 'Fremd', 10, 'wo-strom', 'monthly', current_date + 5, current_date + 5, auth.uid(), current_setting('test.paypot')::uuid);
    raise exception 'FEHLER: fremder Topf verknüpfbar';
  exception when raise_exception then if sqlerrm like 'FEHLER%' then raise; end if; raise notice 'ok: fremder Topf gesperrt'; end;
end $$;
-- Summen-Freigabe zählt aus Töpfen bezahlte Fixkosten nicht als Fixkosten (dafür geht die Sparrate ab)
reset role;
update budget_members set share = share || '{"fixed":"sums"}' where user_id = '00000000-0000-0000-0000-00000000000a';
-- erwartet: private Ausgaben-Fixkosten von A ohne Spartöpfe und ohne „aus Topf bezahlt“ (als Monatswert); es gibt mindestens eine aus dem Topf
select set_config('test.fixedexp', (select coalesce(sum(amount * case freq when 'monthly' then 1 when 'quarterly' then 1.0 / 3 when 'halfyearly' then 1.0 / 6 when 'yearly' then 1.0 / 12 else 52.0 / 12 end), 0)
  from budget_recurring where owner = '00000000-0000-0000-0000-00000000000a' and active and kind = 'expense' and pot_id is null and pay_pot_id is null)::text, false);
select exists (select 1 from budget_recurring where owner = '00000000-0000-0000-0000-00000000000a' and pay_pot_id is not null) as has_pot_paid;
set role authenticated;
select abs(coalesce((select sum(total) from budget_shared_sums(current_date - 40) where area = 'fixed' and kind = 'expense' and owner = '00000000-0000-0000-0000-00000000000a'), 0)
  - current_setting('test.fixedexp')::numeric) < 0.001 as pot_paid_not_in_fixed_sums;
-- Besitzwechsel gesperrt, solange Fixkosten aus dem Topf bezahlt werden; Auflösen löst die Zuordnung
select set_config('request.uid', '00000000-0000-0000-0000-00000000000a', false);
update budget_pots set archived = true where name = 'Rücklagen A';
reset role;
select count(*) = 0 as unlinked_on_archive from budget_recurring where pay_pot_id is not null and name = 'Kfz jährlich';
set role authenticated;
-- ---------- Version 10: Umbuchungen und Kontostand ----------
select set_config('request.uid', '00000000-0000-0000-0000-00000000000a', false);
insert into budget_accounts(household_id, name, owner) values (my_household(), 'Gemeinsam A', null);
update budget_accounts set start_balance = 1000, balance_at = now() - interval '1 hour' where name in ('Konto A', 'Gemeinsam A');
-- Umbuchung 300 von Konto A auf Gemeinsam A, Ausgabe 50 von Gemeinsam A, Einnahme 2000 auf Konto A, Sparen 100 von Konto A
insert into budget_tx(household_id, date, amount, kind, category, account_id, to_account_id)
  values (my_household(), current_date + 1, 300, 'transfer', 'umbuchung', (select id from budget_accounts where name = 'Konto A'), (select id from budget_accounts where name = 'Gemeinsam A'));
insert into budget_tx(household_id, date, amount, kind, category, account_id) values (my_household(), current_date + 1, 50, 'expense', 'lm-markt', (select id from budget_accounts where name = 'Gemeinsam A'));
insert into budget_tx(household_id, date, amount, kind, category, account_id, owner) values (my_household(), current_date + 1, 2000, 'income', 'ei-gehalt', (select id from budget_accounts where name = 'Konto A'), auth.uid());
insert into budget_tx(household_id, date, amount, kind, category, account_id, pot_id) select my_household(), current_date + 1, 100, 'save', 'fi-sparen', (select id from budget_accounts where name = 'Konto A'), id from budget_pots where name = 'Urlaub';
-- vor dem eingetragenen Stand: zählt nicht
insert into budget_tx(household_id, date, amount, kind, category, account_id) values (my_household(), current_date - 3, 999, 'expense', 'lm-markt', (select id from budget_accounts where name = 'Gemeinsam A'));
select (select balance from budget_account_balances() b join budget_accounts a on a.id = b.account_id where a.name = 'Konto A') = 1000 - 300 + 2000 - 100 as balance_own;
select (select balance from budget_account_balances() b join budget_accounts a on a.id = b.account_id where a.name = 'Gemeinsam A') = 1000 + 300 - 50 as balance_joint;
-- Umbuchung nur mit Art transfer; Dauerauftrag bucht die Umbuchung
do $$ begin
  begin insert into budget_tx(household_id, date, amount, kind, category, to_account_id) values (my_household(), current_date, 1, 'expense', 'x', (select id from budget_accounts where name = 'Konto A'));
    raise exception 'FEHLER: Ziel-Konto bei Ausgabe';
  exception when check_violation then raise notice 'ok: Ziel-Konto nur bei Umbuchung'; end;
end $$;
insert into budget_recurring(household_id, name, amount, kind, category, freq, start_date, next_due, account_id, to_account_id)
  values (my_household(), 'Dauerauftrag Haushalt', 800, 'transfer', 'umbuchung', 'monthly', current_date, current_date,
          (select id from budget_accounts where name = 'Konto A'), (select id from budget_accounts where name = 'Gemeinsam A'));
select budget_book_due() >= 1 as transfer_booked;
select count(*) = 1 as transfer_tx from budget_tx where kind = 'transfer' and note = 'Dauerauftrag Haushalt' and to_account_id is not null;
-- C (anderer Haushalt? nein: Partner im selben Haushalt) sieht den Stand des Gemeinschaftskontos, aber nicht den von Konto A (privat)
select set_config('request.uid', '00000000-0000-0000-0000-00000000000c', false);
select not exists (select 1 from budget_account_balances() b join budget_accounts a on a.id = b.account_id where a.name = 'Konto A') as partner_no_private_balance;
select exists (select 1 from budget_account_balances() b join budget_accounts a on a.id = b.account_id where a.name = 'Gemeinsam A') as partner_sees_joint_balance;
select set_config('request.uid', '00000000-0000-0000-0000-00000000000b', false);
select not exists (select 1 from budget_account_balances()) as other_household_nothing;
-- Zeitpunkt des Stands setzt der Server, auch wenn das Handy eine falsche Zeit schickt
select set_config('request.uid', '00000000-0000-0000-0000-00000000000a', false);
update budget_accounts set start_balance = 5, balance_at = '2000-01-01' where name = 'Konto A';
select balance_at > now() - interval '1 minute' as balance_at_from_server from budget_accounts where name = 'Konto A';
update budget_accounts set archived = false where name = 'Konto A';
select balance_at > now() - interval '1 minute' as balance_at_kept from budget_accounts where name = 'Konto A';
