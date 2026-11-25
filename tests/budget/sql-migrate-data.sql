-- Stand Version 8: ein Rücklage-Umschlag mit Fixkosten (diesen Monat schon abgehoben), einer noch nicht abgehoben, ein normaler Umschlag
\set ON_ERROR_STOP on
insert into auth.users values ('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select set_config('request.uid', '00000000-0000-0000-0000-00000000000a', false);
select (create_household('A')).id is not null;
insert into budget_accounts(household_id, name, owner) values (my_household(), 'Konto A', auth.uid());
-- 1) Rücklage Versicherungen, privat, monatlich 50 €, schon abgehoben
insert into budget_pots(household_id, name, kind, owner, start_balance) values (my_household(), 'Umschlag Rücklage Versicherungen', 'reserve', auth.uid(), 120);
insert into budget_cash(household_id, name, icon, amount, category, owner, pot_id, freq, start_month, withdraw_day)
  select my_household(), 'Rücklage Versicherungen', '🛡️', 50, 'versicherung', auth.uid(), id, 'monthly', to_char(current_date - 60, 'YYYY-MM'), 3 from budget_pots where name = 'Umschlag Rücklage Versicherungen';
insert into budget_tx(household_id, date, amount, kind, category, pot_id, owner, source, ext_ref, account_id)
  select my_household(), (now() at time zone 'Europe/Berlin')::date, 50, 'save', 'fi-sparen', c.pot_id, auth.uid(), 'cash',
         'cash:' || to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY-MM') || ':' || c.id, (select id from budget_accounts where name = 'Konto A')
    from budget_cash c where c.name = 'Rücklage Versicherungen';
insert into budget_recurring(household_id, name, amount, category, freq, start_date, next_due, owner, cash_id)
  select my_household(), 'Kfz', 480, 'vers-kfz', 'yearly', current_date + 100, current_date + 100, auth.uid(), id from budget_cash where name = 'Rücklage Versicherungen';
-- 2) Rücklage gemeinsam, vierteljährlich ab diesem Monat, noch nicht abgehoben
insert into budget_pots(household_id, name, kind, owner) values (my_household(), 'Umschlag GEZ', 'reserve', null);
insert into budget_cash(household_id, name, amount, category, owner, pot_id, freq, start_month)
  select my_household(), 'GEZ', 55, 'versicherung', null, id, 'quarterly', to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY-MM') from budget_pots where name = 'Umschlag GEZ';
insert into budget_recurring(household_id, name, amount, category, freq, start_date, next_due, cash_id)
  select my_household(), 'Rundfunk', 55.08, 'wo-rundfunk', 'quarterly', current_date + 20, current_date + 20, id from budget_cash where name = 'GEZ';
-- 3) normaler Umschlag mit gebuchter Ausgabe
insert into budget_cash(household_id, name, amount, category) values (my_household(), 'Wochenmarkt', 60, 'lm-markt');
insert into budget_tx(household_id, date, amount, category, source, ext_ref) values (my_household(), current_date, 60, 'lm-markt', 'cash', 'cash:x:markt');
