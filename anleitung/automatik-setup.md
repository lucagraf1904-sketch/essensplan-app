# Supabase automatisch aktualisieren (einmalig einrichten, ca. 5 Minuten)

Nach jedem Merge in `main` führt GitHub selbst aus, was bisher von Hand nötig war:
- `supabase/budget.sql` im SQL Editor ausführen → macht jetzt die Automatik, wenn sich die Datei geändert hat
- Edge Function `ai` neu deployen → macht jetzt die Automatik, wenn sich `supabase/functions/ai/` geändert hat

Die Datei dafür ist `.github/workflows/supabase-update.yml`. Dafür braucht GitHub **zwei Zugangsdaten**, die du einmal als geschützte „Secrets“ hinterlegst. Secrets sind verschlüsselt, auch du kannst sie danach nicht mehr lesen, nur ersetzen.

## 1. Datenbank-Adresse holen (`SUPABASE_DB_URL`)
1. Supabase-Dashboard → dein Projekt öffnen → oben auf **„Connect“**.
2. Bei der Verbindungsart **„Session pooler“** wählen (nicht „Direct connection“: GitHub kann die direkte Adresse oft nicht erreichen, weil sie nur über IPv6 läuft).
3. Die **URI** kopieren. Sie sieht ungefähr so aus:
   `postgresql://postgres.ixynvpdkgzukqrqzdtwo:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
4. `[YOUR-PASSWORD]` durch dein **Datenbank-Passwort** ersetzen (die eckigen Klammern mit weg).
   - Passwort vergessen? Unter **Project Settings → Database → Reset database password** ein neues setzen. Die App ist davon nicht betroffen, sie nutzt das Passwort nicht.
   - Enthält das Passwort Sonderzeichen wie `@ : / ? # %`, ist ein neues Passwort aus Buchstaben und Ziffern am einfachsten. Sonst müssen diese Zeichen in der Adresse codiert werden (z. B. `@` → `%40`).

## 2. Zugangsschlüssel für die Funktion (`SUPABASE_ACCESS_TOKEN`)
1. https://supabase.com/dashboard/account/tokens öffnen.
2. **„Generate new token“**, Name z. B. `github-essensplan`, ablaufen lassen nach Wunsch (läuft er ab, muss er hier neu erzeugt und in GitHub ersetzt werden).
3. Den angezeigten Schlüssel (beginnt mit `sbp_`) kopieren. Er wird nur einmal angezeigt.

## 3. Beides in GitHub hinterlegen
1. https://github.com/lucagraf1904-sketch/essensplan-app/settings/secrets/actions öffnen
   (Repo → **Settings** → **Secrets and variables** → **Actions**).
2. **„New repository secret“**:
   - Name `SUPABASE_DB_URL`, Wert: die Adresse aus Schritt 1 → **Add secret**
   - Name `SUPABASE_ACCESS_TOKEN`, Wert: der Schlüssel aus Schritt 2 → **Add secret**
   Die Namen müssen genau so geschrieben sein.

## 4. Einmal testen
1. Repo → Tab **„Actions“** → links **„Supabase aktualisieren“** → rechts **„Run workflow“** → **Run workflow**.
2. Nach ca. 1 Minute: grüner Haken = beides aktualisiert. In der Zusammenfassung stehen „Datenbank aktualisiert“ und „KI-Funktion deployt“.
3. Roter Fehler: auf den Lauf tippen, den roten Schritt öffnen und mir die Meldung schicken. Häufig: Passwort fehlt oder ist falsch in der Adresse, oder „Direct connection“ statt „Session pooler“.
4. Die Automatik bricht nach spätestens 10 Minuten ab und fragt nie nach einem Passwort. Fehlt es in `SUPABASE_DB_URL`, kommt sofort die Meldung „Passwort fehlt“.

## Gut zu wissen
- Die Datenbank-Änderung läuft „alles oder nichts“: scheitert etwas, bleibt die Datenbank, wie sie war.
- `budget.sql` löscht keine Daten und darf beliebig oft laufen.
- Fehlen die Secrets, überspringt die Automatik den Schritt nur (Hinweis statt Fehler). Dann geht es wie bisher von Hand.
- Die Speisekammer-Datei `supabase/schema.sql` führt die Automatik bewusst nicht aus.
- Die Secrets der KI-Funktion (`CF_ACCOUNT_ID`, `CF_API_TOKEN` …) bleiben, wie sie sind.
- Datenbank-Passwort geändert oder Schlüssel abgelaufen? Nur das jeweilige Secret in GitHub ersetzen.
