#!/usr/bin/env bash
# Spielt schema.sql und budget.sql in eine frische lokale Test-Datenbank und führt sql-test.sql aus.
# Voraussetzung: lokaler Postgres (z. B. pg_ctlcluster 16 main start). Aufruf: bash tests/budget/sql.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=haushaltskasse_test
su postgres -c "dropdb --if-exists $DB && createdb $DB"
for f in tests/budget/supabase-stub.sql supabase/schema.sql supabase/budget.sql supabase/budget.sql tests/budget/sql-test.sql; do
  su postgres -c "psql -q -v ON_ERROR_STOP=1 -d $DB -f $f" || { echo "FEHLER in $f"; exit 1; }
done
echo "SQL ok"
