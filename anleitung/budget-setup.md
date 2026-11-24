# Haushaltskasse einrichten (einmalig, ca. 10 Minuten)

Die Haushaltskasse liegt unter `/budget/` im selben Repo wie die Speisekammer, also z. B.
`https://<dein-github-name>.github.io/essensplan-app/budget/`. Sie nutzt dasselbe Supabase-Projekt, dieselbe Anmeldung und denselben Haushalt.
Ohne Einrichtung kannst du sie mit `…/budget/?demo=1` sofort mit Beispieldaten ausprobieren (nur auf dem Gerät, ohne KI).

## 1. Datenbank (Pflicht)
1. Supabase-Dashboard → **SQL Editor** → Inhalt von `supabase/budget.sql` einfügen → **Run**.
   Die Datei ist wiederholbar. Sie legt an: Buchungen, Fixkosten, Versicherungen, Einstellungen, das automatische Buchen (`budget_book_due`) und den privaten Speicher `budget-policies` für die Policen-PDFs.
2. Kontrolle: unter *Storage* erscheint der Bucket `budget-policies` (privat), unter *Table Editor* die Tabellen `budget_*`.

## 2. KI-Funktion aktualisieren (für Police fragen und Bon-Foto)
Die Funktion `ai` der Speisekammer wurde erweitert (neue Aktion `policy`, neue Foto-Arten `expense` und `doc`). Ohne Update meldet die App „Unbekannte Aktion“ bzw. „Unbekannte Foto-Art“.
1. Dashboard → *Edge Functions* → `ai` → Code durch den aktuellen Inhalt von `supabase/functions/ai/index.ts` ersetzen → **Deploy**.
2. Neue Schlüssel sind nicht nötig (weiter Cloudflare Workers AI, siehe `anleitung/ai-setup.md`).

## 3. Auf dem Handy
Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“. Die App heißt dort „Kasse“.
Wer in der Speisekammer angemeldet ist, ist es hier auch (gleiche Adresse, gleiche Anmeldung).

## Update: Spartöpfe und Speisekammer-Einkäufe (24.11.2026)
`supabase/budget.sql` **noch einmal** im SQL Editor ausführen (wiederholbar, bestehende Buchungen bleiben). Die KI-Funktion muss dafür nicht neu deployt werden.
- **Spartöpfe:** Stand = Startbetrag + Einzahlungen − Entnahmen. Geld kommt über eine monatliche Sparrate (wird wie Fixkosten automatisch gebucht) und den Monatsrest: Nach Monatsende fragt die App, in welchen Topf der Rest soll, oder legt ihn automatisch in den Topf mit „Monatsrest automatisch“. Gefragt wird nur für Monate mit mindestens 5 eigenen Buchungen und Einnahmen. Sparen mindert „Noch frei“, ist aber keine Ausgabe. Ein Topf mit Buchungen lässt sich nur auflösen, nicht löschen.
- **Einkäufe aus der Speisekammer:** Bons, die in der Speisekammer erfasst werden, erscheinen in der Übersicht als Vorschlag (ab Einführung, höchstens 45 Tage zurück). Putzmittel („Haushalt“) wird als Drogerie & Haushalt gebucht, Getränke und Pfand als Getränke, alles andere als Supermarkt. Gibt es am selben Tag schon eine ähnliche Lebensmittel-Buchung, fragt die App nach, ob es derselbe Einkauf ist. Die Speisekammer selbst merkt davon nichts.

## Update: Personen, Konten, Freigaben und Bargeld (Version 3 und 4)
`supabase/budget.sql` **noch einmal** ausführen (wiederholbar, bestehende Daten bleiben und gelten als gemeinsam).
- **Privat oder gemeinsam:** Jeder Eintrag gehört dem Haushalt oder einer Person (🔒). Was eine Person privat anlegt, sieht die andere nur nach Freigabe: Einstellungen → Freigabe, je Bereich „Nichts“, „Nur Summen“ oder „Alles“. Die Datenbank setzt das durch (Row Level Security), auch für Policen-Dateien. Freigegebenes kann angesehen, aber nur vom Besitzer geändert werden.
- **Konten:** Jede Person bekommt automatisch ein eigenes Konto, bei mehreren Personen entsteht ein Gemeinschaftskonto. Weitere unter Einstellungen → Konten. „Bezahlt von“ steht an jeder Buchung, die Fixkosten zeigen die Abbuchungen je Konto. Es wird kein Ausgleich zwischen Personen gerechnet.
- **Ansicht:** Oben „Alles · Gemeinsam · Nur ich · Partner“ (nur bei mehreren Personen).
- **Monatsrest:** bei mehreren Personen getrennt: gemeinsamer Rest in einen gemeinsamen Topf, eigener Rest in einen eigenen Topf.
- **Bargeld-Umschläge:** in der Übersicht unter „Bargeld“. Jeder Umschlag hat einen Monatsbetrag und eine Kategorie. Die Summe ist der Betrag zum Abheben. Bis zum Tipp auf „Abgehoben“ zählt er wie offene Fixkosten, danach wird je Umschlag eine Ausgabe gebucht. Restgeld wird nicht mitgeführt.

## Update: ETFs (Version 5)
`supabase/budget.sql` noch einmal ausführen. In der Übersicht unter „ETFs“: Name, optional ISIN (wird auf Prüfziffer geprüft), monatlicher Sparplan mit Ausführungstag und Konto, was schon eingezahlt ist, und der aktuelle Depotwert.
- **Eingezahlt** zählt die App selbst: Startbetrag + jede Sparplan-Ausführung + Einmalzahlungen − Verkäufe.
- **Wert** trägst du selbst ein (z. B. aus der Banking-App); die App zeigt das Datum und erinnert nach 45 Tagen ans Aktualisieren. Daraus: Gewinn/Verlust in € und %. Es gibt keine Kursabfrage.
- Der Sparplan zählt wie Sparen: mindert „Noch frei“, ist aber keine Ausgabe (Kategorie Geldanlage). Privat/gemeinsam und Freigabe wie bei Spartöpfen (Bereich Spartöpfe).
- Keine Anlageberatung.

## Was wohin geht (Datenschutz)
| Was | Wohin |
|---|---|
| Buchungen, Fixkosten, Budgets, Policen-Text | eure Supabase-Datenbank, nur für euren Haushalt lesbar (Row Level Security) |
| Policen-PDF | Supabase Storage, privater Ordner je Haushalt; Ansehen nur über einen 10 Minuten gültigen Link |
| Frage an die Police | **nur die passenden Auszüge** (höchstens ca. 14.000 Zeichen) gehen an Cloudflare Workers AI. Laut Cloudflare kein Training, keine Speicherung. Die Auszüge können Name, Adresse und Versicherungsnummer enthalten. |
| Bon-Foto, eingescannte Policenseite | als Bild an Cloudflare (Mistral Small 3.1 bzw. Gemma), siehe `ai-setup.md` |

Antworten des Chats sind ohne Gewähr und keine Rechtsberatung. Die App zeigt zu jeder Antwort die gefundenen Stellen mit Seitenzahl, damit man selbst nachlesen kann.

## Grenzen
- Tageslimit der KI gilt gemeinsam mit der Speisekammer: 40 Text- und 10 Foto-Anfragen pro Haushalt und Tag (`ai_use()` in `schema.sql`).
- Eingescannte PDFs ohne Text: höchstens 6 Seiten auf einmal werden per KI abgeschrieben. Besser: PDF aus dem Kundenportal des Versicherers (enthält Text).
- Das automatische Buchen der Fixkosten passiert beim Öffnen der App (holt verpasste Termine nach, höchstens 60 je Eintrag).
- Kündigungsfristen: die App rechnet „Vertragsende minus Frist“ und nimmt an, dass sich Verträge um ein Jahr verlängern. Maßgeblich ist euer Vertrag.

## Tests
```
node --test tests/budget/*.test.mjs     # Rechenlogik und Policen-Suche
node tests/budget/e2e.mjs [ordner]      # Oberfläche im Demo-Modus (Playwright), optional mit Screenshots
bash tests/budget/sql.sh                # Schema gegen lokalen Postgres (Zugriffsregeln, automatisches Buchen)
```
