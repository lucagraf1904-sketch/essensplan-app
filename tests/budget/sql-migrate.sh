#!/usr/bin/env bash
# Prüft die Umstellung Version 8 → 9: Datenbank mit dem Stand von PR #8 (Bargeld-Umschläge) anlegen, Beispieldaten eintragen,
# dann das aktuelle budget.sql zweimal ausführen und prüfen, was aus den Umschlägen wurde. Aufruf: bash tests/budget/sql-migrate.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=haushaltskasse_migrate
OLD=$(mktemp); git show 87a34e5:supabase/budget.sql > "$OLD"; chmod 644 "$OLD"
su postgres -c "dropdb --if-exists $DB && createdb $DB"
run() { su postgres -c "psql -q -v ON_ERROR_STOP=1 -d $DB -f $1" || { echo "FEHLER in $1"; exit 1; }; }
run tests/budget/supabase-stub.sql; run supabase/schema.sql; run "$OLD"
run tests/budget/sql-migrate-data.sql
run supabase/budget.sql; run supabase/budget.sql
run tests/budget/sql-migrate-check.sql
rm -f "$OLD"
echo "Umstellung ok"
