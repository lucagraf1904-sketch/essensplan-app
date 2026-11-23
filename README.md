# Speisekammer (Version 1)

Web-App für das iPhone (Homebildschirm), ohne Build-Schritt.

## Funktionen
- Vorrat mit Menge, Kategorie, Lagerort, Haltbarkeit und Preis
- Tab „Einkauf“: Einkaufsliste zum Abhaken, „Wieder kaufen?“-Vorschläge (mind. 2× in 90 Tagen gekauft), Tipps mit Alternativen zum Antippen (tips.js; Quelle: recherche/reports/Mehlarten und Morbus Crohn Vorbeugung.md). Mit Supabase für den Haushalt geteilt.
- Tab „Einstellungen“: Schalter für Tipps (Haupt- und Themenschalter), Einfrier-Frage, Vorschläge (settings.js), dazu Utensilien und Warn-Vorlauf.
- (alt) Tab „Küche“: Liste der Küchenutensilien (vorhanden ja/nein, eigene ergänzen). Wird pro Gerät gespeichert, noch nicht über Supabase geteilt.
- Sortierung nach Ablaufdatum, Warnleiste ab 3 Tagen (im Tab „Küche“ einstellbar: 1–7 Tage), Benachrichtigung beim Öffnen (nach Freigabe über 🔔)
- Antippen eines Artikels: verbraucht / weggeworfen / einfrieren / auftauen / bearbeiten
- Einfrieren (ganz oder Teilmenge): Ort wird Gefrierschrank, `frozenAt` = heute, `expiry` wird durch die empfohlene maximale Tiefkühl-Lagerdauer ersetzt (altes MHD in `origExpiry`). Hackfleisch 4 Monate (Lebensmittelüberwachung Bremen, Infoblatt 21), übriges Fleisch/Fisch 6, Obst/Gemüse 12 Monate (Verbraucherzentrale NRW). Brot, Milchprodukte, Sonstiges: 3 Monate, Annahme ohne Quelle. Abgelaufenes lässt sich nicht einfrieren. Auftauen: Kühlschrank, Fleisch/Fisch 1 Tag, sonst 2 Tage (Annahme).
- Beim Anlegen und nach dem Bon-Scan fragt die App bei Fleisch & Fisch mit Knöpfen: alles einfrieren / nur 1 einfrieren / Kühlschrank. Weitere Fragen nutzen dieselbe Funktion `ask()` in app.js.
- Supabase: bestehende Datenbank braucht die zwei `alter table items add column ...`-Zeilen aus `schema.sql`.
- Bon-Scan per Foto (Texterkennung mit Tesseract.js lokal auf dem Handy) oder eingefügter Text, Lidl-Format
- Verlauf und Monatsbilanz (ausgegeben, weggeworfen, nach Kategorie)
- Pfand und Leergut-Rückgabe vom Bon landen in der Kategorie „Pfand“: zählen zu „Ausgegeben“ (wie auf dem Bon), nicht zu den Lebensmitteln und nicht in den Vorrat. Die Bilanz zeigt bezahlt / zurück / netto. Das Leergut-Zeilenformat ist am echten Bon noch nicht geprüft.
- Export/Import als JSON
- Haushaltsweit (Luca 22.11.): Mindestbestand, Einkaufsliste, Utensilien, Angebote, Gerichte, Plan, Dienstplan und Haushalts-Einstellungen
  werden mit Supabase geteilt (shared.js, Tabelle household_data; Listen eintragsweise über `merge_list`, damit gleichzeitiges Abhaken nichts überschreibt).
  Persönlich (member_data, nur für die Person selbst): eigene Anzeige, Erinnerungszeiten, Gewicht. Erkrankungen bleiben nur auf dem Gerät.
  Anzeige: Haushalts-Standard, jede Person kann für sich abweichen („Als Standard für alle übernehmen“ / „Haushalts-Standard verwenden“).
- Gefrierschrank-Übersicht (Filter „Gefrierschrank“): älteste Einfrierung zuerst, mit Datum und Dauer.
- Monatsbudget (Einstellungen → Budget): Balken in der Bilanz, Hochrechnung bis Monatsende, Warnung im Vorrat ab 70/80/90/100 %.
- Einkaufsliste nach Ladenweg: Abteilungen in eigener Reihenfolge je Laden (🧭 pro Eintrag änderbar), Erledigtes unten.
- Gewicht (Einstellungen → Persönlich, standardmäßig aus): ein Eintrag pro Woche, Kurve ohne Bewertung (weight.js).
- Essensplan (plan.js, recipes.js): Wochenplan aus eigenen Gerichten (oder 14 Beispielgerichten), bald Ablaufendes, Vorrat,
  Angebote, Lieblingsgerichte, lange nicht Gegessenes, 2× Fisch / max. 2× Rind, Reste. „Gekocht“ fragt, was verbraucht wurde.
  Gerichte: eigene eintragen, Rezepttext einfügen, per Link (Edge Function `recipe-import`, liest schema.org-Rezeptdaten).
  Jedes Rezept ist im Editor voll änderbar (Name, Art, Dauer, kcal, Gerät, Portionen, Zutaten, Schritte, Link, Merkmale); Zutaten → need neu erkannt.
  Rezeptspeicher (Luca 23.11.): Rezepte mit store=true liegen nur zum Nachschlagen bereit, der Planer nimmt sie nicht; Suche über Titel/Zutaten.
- Essen und Medikamente (meds.js, Einstellungen → 💊): allgemeine Info-Karten in eigenen Worten nach Verbraucherzentrale (Stand 25.07.2025),
  Hinweis beim ersten Öffnen, optionaler Filter nach Wirkstoffgruppen (nur auf dem Gerät). Grundregel (Luca 23.11.): Erkrankungen und Medikamente
  ändern den Plan nie automatisch; Lebensmittel werden nur per eigenem Tipp ausgeschlossen (settings.planExclude, Haushalt, ohne Grund gespeichert).
  Abgleich 23.11. mit der Nachprüfung (Übermäßiger Verzehr, Abschnitt 7.2): Karten ohne Zeitangaben, Quelle je Karte (SOURCES), „nicht bestätigt“ entfernt
  (Milch/Antibiotika, Koffein); nur von der VZ genannte Karten bleiben mit VZ-Quelle. Tipps: „Mehr dazu“ (more) mit Arztzeile, Gicht/Vitamin K/Grapefruit.
  Nicht gebaut: persönliche Warnungen, Dosis, Einnahme-Erinnerungen. Rechtliche Einordnung: recherche/reports/Medikamenten-Infos rechtlich absichern.md.
- Dienstplan (shifts.js, Einstellungen → Persönlich): Früh/Spät/Nacht/Frei je Person; Nacht = leichte Gerichte, Vortag = Portion für die Dose,
  Spätschicht = Erinnerung 11:30 statt Abendessen. Quellen: DGE (DGEwissen 3/2024), gesundheit.gv.at (Stand 10.11.2020), AOK (Stand 28.05.2024).
  Schichtzeiten (6–14, 13:30–21:30, 21–6:30) und die Mittagszeit bei Spätschicht sind Annahmen.
  Kalender im Stil der iPhone-Kalender-App (Plan → 🗓️ Kalender, Luca 23.11.): Monat mit farbigen Schichten je Person, Wischen, Heute;
  Tag antippen → Blatt von unten: Person (auch andere, z. B. Mama), Schicht, Zeiten nur für diesen Tag. „Meine Zeiten“ = Standard je Schichtart
  (Beginn, Ende, Hauptmahlzeit, Pause; speisekammer.shiftConf, Haushalt). Tipps nur passend zur Schicht und den eigenen Zeiten, Schalter settings.shiftTips.

## Ersteinrichtung (onboarding.js, Luca 23.11.)
Beim ersten Öffnen (je Gerät, Flag `speisekammer.onboarded`): Einführung, Kennenlern-Fragen zum Antippen (Name/Personen, Essenszeit, Küche, Vorlieben und Ziele,
Ausschlüsse, Gesundheit freiwillig nur lokal, Schichtdienst) und Bestandsaufnahme (typische Artikel antippen = +1 Stück, Barcode, Bon). Bekanntes ist als
Vorschlag vorausgewählt und gilt erst mit „Weiter“; jeder Schritt ist überspringbar. Ausschlüsse setzt die Person selbst. Bestandsaufnahme bucht nichts in die Ausgaben
(noLog), Haltbarkeit sind Schätzwerte. Erneut starten: Einstellungen → 🧭 Einrichtung wiederholen. In der Demo startet sie nicht automatisch (Knopf „Einrichtung“).

## Gemeinsame Daten mit Supabase einrichten
1. Projekt auf supabase.com anlegen (Region Frankfurt).
2. SQL Editor → Inhalt von `supabase/schema.sql` einfügen → Run (mehrfach ausführbar).
3. Authentication → Sign In / Providers → Email: „Confirm email“ ausschalten. Die App meldet mit E-Mail + Passwort an (ohne Mail).
   Optional (Code per Mail): in den Vorlagen „Magic Link“ und „Confirm signup“ `{{ .Token }}` einfügen; am iPhone ließ sich die Vorlage nicht bearbeiten (22.11.).
4. Project URL und anon key in `config.js` eintragen. Den service_role key nie in die App.
5. Edge Function für den Rezeptimport: `supabase functions deploy recipe-import` (prüft die Anmeldung).
6. Person 1 meldet sich an und legt den Haushalt an. Den Einladungscode (Verlauf → Haushalt & Konto) an Person 2 geben, die „Beitreten“ wählt.

Ohne Eintrag in `config.js` läuft die App rein lokal.

## Grenzen dieser Version
- Ablaufwarnung nur beim Öffnen der App, keine Push-Nachricht im Hintergrund. Kommt mit Backend.
- Haltbarkeiten sind grobe Richtwerte je Kategorie.
- Bon-Parser ist an einem nachgebauten Lidl-Bon getestet, nicht an echten Fotos.

## Lokal starten
    python3 -m http.server 8000
Dann http://localhost:8000 öffnen.

## Auf dem iPhone
Auf GitHub Pages (oder einem anderen HTTPS-Host) veröffentlichen, in Safari öffnen, Teilen → „Zum Home-Bildschirm“.

## Barcode-Scan (22.11.2026)
Im Artikel-Dialog „📷 Barcode scannen“: Kamera (BarcodeDetector bzw. html5-qrcode von unpkg), Foto oder Nummer eintippen.
Produktname, Packungsgröße, Kategorie und Nährwerte je 100 g kommen aus Open Food Facts (ODbL, Quelle wird angezeigt).
Bekannte Barcodes werden lokal gemerkt. In der Claude-Vorschau gehen Kamera und Abruf nicht (Sandbox), in der echten App schon.

## Push-Erinnerungen
Einstellungen → Erinnerungen: Ablaufwarnung und Abendessen, je Uhrzeit (Standard 16:00).
Ohne Server erinnert die App, sobald sie nach der Uhrzeit offen ist. Für echte Push-Nachrichten:
1. VAPID-Schlüssel erzeugen: `npx web-push generate-vapid-keys`. Öffentlichen Schlüssel in `config.js` (VAPID_PUBLIC_KEY).
2. `supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:… CRON_SECRET=<zufällig>`
3. (inkl. „Was wurde gegessen?“) `supabase functions deploy reminders --no-verify-jwt` (die Funktion prüft stattdessen den Header x-cron-secret).
4. `supabase/cron.sql` mit Projekt-Ref und CRON_SECRET im SQL Editor ausführen.
5. Auf dem iPhone: App über „Teilen → Zum Home-Bildschirm“ installieren (iOS 16.4+), dann in den Einstellungen „Benachrichtigungen erlauben“.

## Angebote
Einkauf → Angebote: Links zu den Prospekten (Lidl, Aldi Nord, Netto, Rewe, Edeka, Kaufland), Angebote per Antippen eintragen (offers.js).
Passende Angebote erscheinen am Listeneintrag. Abgelaufene verschwinden automatisch.

### Automatische Angebote (Marktguru, inoffiziell; Lucas Entscheidung vom 22.11.2026)
Die Edge Function `supabase/functions/offers` fragt die Marktguru-Suche für PLZ 19249, 19230, 19243, 19288 und 29451 ab
(Suchbegriffe: offene Einkaufsliste plus Produkte, die in 90 Tagen mindestens zweimal gekauft wurden) und schreibt
die Treffer in die Tabelle `offers`. Stammartikel `ALWAYS` (Dinkel-Vollkorn-Toast) wird immer mitgesucht. Ablauf: täglich 05:00 UTC per `cron.sql` und beim Öffnen des Einkauf-Tabs (höchstens einmal am Tag),
außerdem über „🔄 Angebote jetzt suchen“.

Einrichtung:
1. Schlüssel: marktguru.de im Browser öffnen, Entwicklertools → Netzwerk, eine Suche ausführen, beim Abruf an `api.marktguru.de`
   die Header `x-apikey` und `x-clientkey` ablesen. Nur als Supabase-Secret speichern, nie in den Code:
   `supabase secrets set MARKTGURU_API_KEY=… MARKTGURU_CLIENT_KEY=…`
2. `supabase functions deploy offers --no-verify-jwt` (die Funktion prüft selbst: Cron-Secret oder angemeldeter Nutzer).
3. Den Angebots-Teil aus `cron.sql` ausführen.

Risiko: keine offizielle Schnittstelle. Marktguru kann die Schlüssel ändern oder Abrufe sperren; dann bleiben die selbst eingetragenen Angebote.
Für eine offizielle Freigabe liegt ein Entwurf in `entwuerfe/anfrage-marktguru-api.md`.

### Einkaufs-Check (offers.js → shoppingCheck)
Vergleicht für die offene Liste: alles im Stammladen oder Stammladen plus ein zweiter Laden.
Vergleichspreis ist der letzte eigene Kassenbon-Preis (meist Lidl), bei Angeboten im Stammladen der günstigere von beiden.
Mit „Eigenmarke zählt als gleich“ wird der Angebotspreis über den Grundpreis (€/kg, €/l) auf die eigene Packungsgröße umgerechnet.
Ein angenommenes Angebot legt den zweiten Laden fest. Empfehlung „lohnt sich“ ab der eingestellten Grenze (Standard 2 €), ohne Fahrtkosten.
Artikel ohne Bon-Preis werden als „ohne Vergleichspreis“ aufgeführt. Ergebnis ist eine Schätzung.
Einstellungen → Angebote & Preisvergleich: automatische Suche, Stammladen, Anzahl Läden, Grenze, Eigenmarke.

## Demo (22.11.2026)
`demo/demo.js` legt alle Daten unter dem Präfix `demo:` ab (echte Daten bleiben unberührt), füllt Beispieldaten
(Vorrat, Liste, Angebote inkl. Kaufland, sieben Wochen Verlauf), zeigt einen Rundgang und „Zurücksetzen“ (zweimal tippen). Die Demo nutzt den echten Planer (plan.js) und übernimmt beim ersten Start die Beispielgerichte; dazu ein Beispiel-Dienstplan („Beispiel Pflege“).
Bauen: `sh demo/build.sh /pfad/ausgabe` → dann veröffentlichen. Veröffentlicht als Artifact „Speisekammer (Demo)“.

## Bewegung aus Apple Health (vorbereitet, nicht live)
Tagesschritte und aktive Kalorien per iPhone-Kurzbefehl → Edge Function `health-ingest` → Tabelle `health_daily` → Anzeige „Bewegung heute“ im Tab Verlauf (health.js).
Aus, solange `HEALTH_ENABLED = false` in config.js. Konzept, Live-Schritte und Kurzbefehl-Anleitung: `KURZBEFEHL.md`.

## Wochenziele, Zutaten pro Tag, Vorschläge (23.11.)
- **Wochenziele** (Plan-Tab, aufklappbar): Fisch pro Woche, Rind höchstens, vegetarische Abende, Mindest-Gemüse pro Abend. Gelten für den Haushalt, offene Tage werden neu geplant. Nur aktiv bei „Wochenregeln im Plan“.
- **Zutaten anpassen** pro Tag: ersetzen, weglassen, ergänzen. Gilt nur für den Tag (`d.need` im Plan), Vorrat-Abgleich, Einkaufsliste und „Verbraucht?“ folgen. „Im Rezept übernehmen“ schreibt es ins Rezept. Der Tag bleibt beim Neuplanen erhalten; „Anderes Gericht“ verwirft die Anpassung.
- **Vorschläge** (Gerichte-Tab): Rezeptspeicher + Grundstock (`suggestions.js`, eigene Formulierungen, keine fremden Rezepte), bewertet wie der Plan (Vorrat, Ablauf, Vorlieben, Ausschlüsse). Ausgeblendete Vorschläge nur lokal.
- **Rezept dazu suchen**: öffnet Chefkoch-Suche mit bis zu 3 Vorrat-Zutaten (URL-Format ungeprüft); Rezept danach per „Per Link“ importieren (braucht die Edge Function `recipe-import`).


## KI-Assistent (Chat, Gericht anpassen, Fotos einlesen)
Über die Edge Function `ai` (`supabase/functions/ai`), nur mit kostenlosen Anbietern: Text über Cloudflare Workers AI, Fotos über Mistral.
Einrichtung Schritt für Schritt: [anleitung/ai-setup.md](anleitung/ai-setup.md).
- 🤖 oben: Chat mit Vorrat, Geräten und Vorlieben als Kontext. Antworten sind Vorschläge, keine Beratung.
- Rezept bearbeiten → „🤖 Mit KI anpassen“ (Knopf-Wünsche), Vorschlag füllt das Formular, gespeichert wird erst nach deiner Prüfung.
- Gerichte → „📷 Per Foto (KI)“, Bon → „🤖 Foto mit KI einlesen“, Artikel → „🤖 Verpackung fotografieren“.
- Gesundheitsangaben nur mit Haken pro Anfrage, Fotos nie damit. Tageslimit pro Haushalt: 40 Text, 10 Foto. Schalter: Einstellungen → 🤖 KI-Assistent.

## „Was wurde gegessen?“ mit Teilmengen (23.11.)
- `eaten.js`: Teile je Packung pro Artikelname (Haushalt, `speisekammer.parts`), z. B. Toast 20 Scheiben, Eier 10 Stück (Vorbelegung = Annahme, änderbar), Reis 500 g. Gegessene Teile verringern `qty` (in Packungen, auch als Bruchteil); Preisanteil und Bilanz laufen wie beim normalen Verbrauchen.
- Nachfragen zu eigenen Zeiten (persönlich, Standard 12:45 Frühstück, 18:30 Abendessen, einzeln abschaltbar unter Einstellungen → Vorrat). App offen: Dialog mit Zählern; App im Hintergrund: Mitteilung, falls erlaubt. Danach folgt wie bisher „Alles aufgegessen?“ (Reste).
- Per Hand: Artikel antippen → „🍞 Teile entnehmen“. Im Plan fragt „Gekocht“ bei Packungen mit Teilen nach der Menge statt „aufgebraucht ja/nein“.
- Nachfragen laufen nur, solange die App geöffnet ist oder die Mitteilung angetippt wird (kein Server-Push dafür).

## Abgleich zwischen den Handys (23.11.)
- Geteilt (Haushalt, `HOUSEHOLD_KEYS` in shared.js): Vorrat und Verlauf (Tabellen items/log, live), Einkaufsliste und Gerichte (eintragsweise), Wochenplan (tageweise, neuester Tag gewinnt), Dienstplan, Zeiten je Schichtart, Packungs-Teile, Mindestbestand, Haushalts-Einstellungen (Wochenziele, Ausschlüsse), Utensilien, Angebote, Ablaufwarn-Tage, ausgeblendete Vorschläge.
- Pro Person (`MEMBER_KEYS`, member_data): persönliche Einstellungen (Anzeige, Erinnerungs- und Nachfragezeiten, Name), Gewicht.
- Nur lokal: Gesundheitsangaben und Medikamenten-Filter (Art. 9 DSGVO), Trinkzähler, Barcode-Zwischenspeicher, kleine Merker (Hinweise ausgeblendet, „heute schon gefragt“).
- Konflikte: vor jedem Schreiben holt die App den Serverstand und führt per Dreiwege-Vergleich zusammen (`merge3`); nur wirklich geänderte Felder überschreiben. Der Plan wird tageweise über die Änderungszeit `t` zusammengeführt. Eigenes Echo wird ignoriert, ungesendete Änderungen gehen beim Start vor.

## Essen im Plan frei ändern (23.11.)
Am Tag: „🍴 Anders gegessen“ öffnet ein Blatt: wie geplant abhaken, Zutaten anpassen, frei eintippen und Zutaten aus dem Vorrat antippen (Packungen mit Teilen per Zähler, sonst „alles/Teil/nichts“) oder ein anderes Gericht aus der Liste wählen. Freie Tage (`d.free`) können als Gericht in den Rezeptspeicher übernommen oder zurückgesetzt werden (abgebuchter Vorrat bleibt abgebucht).
