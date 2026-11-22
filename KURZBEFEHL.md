# Bewegung aus Apple Health per Kurzbefehl (vorbereitet, noch nicht live)

Stand 22.11.2026. Geht erst live, wenn Supabase läuft und der Essensplaner fertig ist (Lucas Entscheidung).
Bis dahin steht in `config.js` `HEALTH_ENABLED = false`; dann ist in der App nichts davon zu sehen.
Auf einem echten iPhone ist noch nichts davon getestet.

## 1. Konzept

```
iPhone (je Person)                         Supabase                            App
Kurzbefehl „Speisekammer Bewegung“         Edge Function health-ingest         Tab Verlauf: „Bewegung heute“
  liest Schritte + aktive Energie   ──POST──▶ prüft Schlüssel (Hash)    ──▶ health_daily  ──▶ je Person: Schritte, kcal aktiv,
  aus Health (heute, optional gestern)       übernimmt den größeren Wert                      7-Tage-Balken, Ø, Stand
ausgelöst durch 3–4 Tageszeit-Automationen                                       Knopf „🔄 Schritte aktualisieren“
  oder den Knopf in der App (shortcuts://run-shortcut?name=…)                    startet den Kurzbefehl
```

- **Pro Person ein Schlüssel.** Der Kurzbefehl kann sich nicht bei Supabase anmelden. Darum erzeugt jede Person in der App (Einstellungen → Bewegung)
  einen Schlüssel. In der Datenbank liegt nur der SHA-256-Hash. Ein neuer Schlüssel macht den alten ungültig.
- **Tageswerte statt Einzelmessungen.** Gespeichert wird pro Person und Tag eine Zeile (Schritte, aktive kcal). Weitere Läufe am selben Tag
  überschreiben nur mit einem größeren Wert. Mehrfaches Senden schadet also nicht.
- **Sichtbarkeit.** Eigene Werte sieht man immer. Die Werte der anderen Person sieht man nur, wenn sie „Meine Werte im Haushalt zeigen“ eingeschaltet hat (Standard: an, abschaltbar).
- **Kein Ziel, keine Bewertung.** Reine Übersicht: heute, 7-Tage-Balken, Durchschnitt.
- **Aktive Energie** = Bewegungskalorien aus Health, ohne Grundumsatz. Ohne Apple Watch schätzt das iPhone sie nur grob aus Schritten und Stockwerken.
  Mit einer späteren Watch werden die Werte genauer, am Kurzbefehl ändert sich nichts.
- **Datenschutz.** Schritte und Kalorien gelten als Gesundheitsdaten (Art. 9 DSGVO). Für den privaten Haushalt unkritisch, bei einem späteren Verkauf der App zu beachten.
  Supabase-Region Frankfurt.

### Dateien
| Datei | Inhalt |
|---|---|
| `supabase/schema.sql` (Abschnitt „Bewegung“) | Tabellen `health_tokens`, `health_daily`, RLS, Funktionen `create_health_token`, `health_people`, `health_shared` |
| `supabase/functions/health-ingest/index.ts` | Endpunkt für den Kurzbefehl |
| `health.js` | Anzeige im Tab Verlauf, Schlüssel-Verwaltung in den Einstellungen, Knopf „Schritte aktualisieren“ |
| `config.js` | `HEALTH_ENABLED`, `HEALTH_SHORTCUT_NAME` |
| `screenshot-bewegung.png` | Vorschau der Anzeige mit Beispieldaten |

Geprüft: Schema auf lokalem PostgreSQL 16 (Person 2 sieht die Werte von Person 1 nur bei eingeschaltetem Teilen, fremde Haushalte nie),
Zahlen-Umwandlung der Edge Function („8.421 Schritte“ → 8421, „312,4 kcal“ → 312,4), Darstellung im Browser. Nicht geprüft: Edge Function auf Supabase, Kurzbefehl auf dem iPhone.

## 2. Live schalten (später)
1. Abschnitt „Bewegung“ aus `supabase/schema.sql` im SQL Editor ausführen (pgcrypto ist bei Supabase vorinstalliert).
2. `supabase functions deploy health-ingest --no-verify-jwt` (die Funktion prüft selbst den Schlüssel).
3. In `config.js` `HEALTH_ENABLED = true`, veröffentlichen.
4. Jede Person: App → Einstellungen → Bewegung → Name eintragen → „Schlüssel erzeugen“ → Adresse und Schlüssel kopieren.
5. Kurzbefehl anlegen (Abschnitt 3) oder per iCloud-Link übernehmen (Abschnitt 5), einmal von Hand starten, Health erlauben.
6. Automationen anlegen (Abschnitt 4).

## 3. Kurzbefehl anlegen, Aktion für Aktion

Kurzbefehle-App → „+“ → Name genau **Speisekammer Bewegung** (sonst findet der Knopf in der App ihn nicht).
Die deutschen Aktionsnamen können je nach iOS-Version leicht abweichen. Im Zweifel in der Aktionssuche „Health“, „URL“ oder „Datum“ eingeben.

**Block A: heute (Pflicht)**

1. **Text** → den Schlüssel aus der App einfügen. Ergebnis antippen → „Umbenennen“ → `Schlüssel`.
2. **Health-Messwerte suchen** (engl. *Find Health Samples*)
   - Typ: **Schritte**
   - Filter: **Startdatum** **ist heute**
   - Gruppieren nach: **Tag**
3. **Statistik berechnen** → **Summe** von *Health-Messwerte*. Ergebnis umbenennen in `Schritte`.
4. **Health-Messwerte suchen**
   - Typ: **Aktive Energie**
   - Filter: **Startdatum** **ist heute**
   - Gruppieren nach: **Tag**
5. **Statistik berechnen** → **Summe**. Umbenennen in `Kcal`.
6. **Aktuelles Datum**.
7. **Datum formatieren** → Datumsformat **Eigenes**, Formatzeichenfolge `yyyy-MM-dd`. Umbenennen in `Tag`.
8. **Inhalte von URL abrufen** (engl. *Get Contents of URL*)
   - URL: die Adresse aus der App (`https://<projekt>.supabase.co/functions/v1/health-ingest`)
   - „Mehr anzeigen“ → Methode **POST**
   - Header hinzufügen: Schlüssel `x-health-token`, Wert = Variable `Schlüssel`
   - Hauptteil der Anfrage: **JSON**, drei Felder vom Typ **Text**:
     `date` = `Tag`, `steps` = `Schritte`, `active_kcal` = `Kcal`
     (Typ Text ist Absicht: Health-Werte kommen teils mit Einheit, der Server rechnet sie um.)
9. Optional nur für den Knopf-Start: **Mitteilung anzeigen** mit *Inhalte von URL* („Gespeichert: 6.843 Schritte, 268,5 kcal aktiv“).
   Bei den Automationen erscheint sie dann ebenfalls, also weglassen, wenn sie dort stört.

Warum „Gruppieren nach Tag“: Health liefert sonst Einzelmessungen. Sobald später eine Apple Watch dazukommt, zählen iPhone und Watch dieselben Schritte doppelt,
wenn man Einzelmessungen addiert. Ob die Tagesgruppierung im Kurzbefehl Dubletten so herausrechnet wie die Health-App, **weiß ich nicht sicher**.
Prüfung beim ersten Lauf: Zahl im Kurzbefehl mit der Health-App vergleichen. Ohne Watch ist das kein Thema.

**Block B: gestern nachreichen (empfohlen, auf dem iPhone noch nicht getestet)**

Hilft gegen Läufe, die bei gesperrtem iPhone ausfallen (Abschnitt 6), und holt die Schritte nach dem letzten Abendlauf nach.
Vor Aktion 8 einfügen:

- **Datum** `heute 00:00` → umbenennen `HeuteStart`. **Datum anpassen** → `HeuteStart` minus 1 Tag → umbenennen `GesternStart`.
- Zweimal **Health-Messwerte suchen** wie oben, aber Filter **Startdatum ist zwischen** `GesternStart` und `HeuteStart` → je **Statistik berechnen → Summe** → `SchritteG`, `KcalG`.
- **Datum formatieren** `GesternStart` → `yyyy-MM-dd` → `TagG`.

Dann in Aktion 8 statt der drei Felder ein Feld `days` vom Typ **Array** mit zwei **Wörterbüchern**:
`{date: Tag, steps: Schritte, active_kcal: Kcal}` und `{date: TagG, steps: SchritteG, active_kcal: KcalG}`.
Der Server nimmt beide Formen an.

**Erster Start:** Kurzbefehl einmal von Hand antippen. iOS fragt nach Health-Zugriff (Schritte, Aktive Energie) und nach der Verbindung zu `supabase.co`. Beides erlauben,
bei der URL „Immer erlauben“. Erst danach laufen die Automationen ohne Rückfrage.

## 4. Automationen (pro iPhone, je ca. 1 Minute)

Kurzbefehle → Automation → „+“ → **Tageszeit** → Uhrzeit → **Sofort ausführen** → Aktion **Kurzbefehl ausführen** → *Speisekammer Bewegung*.
„Bei Ausführung benachrichtigen“ aus.

Vorschlag (Zeiten, zu denen das Handy meist ohnehin in der Hand ist, siehe Abschnitt 6):
- **12:45** nach dem Frühstück
- **17:45** beim Abendessen
- **21:30** abends
- optional **08:00**

Automationen lassen sich nicht teilen. Jede Person legt sie selbst an.

## 5. Antworten auf die offenen Fragen

**Muss der Kurzbefehl selbst erstellt werden, oder geht das über die App?**
Selbst, aber nur einmal. Eine Web-App kann auf dem iPhone keine Kurzbefehle und keine Automationen anlegen. Das erlaubt Apple keiner App, auch keiner aus dem App Store.
Der praktische Weg:
1. Luca baut den Kurzbefehl einmal nach Abschnitt 3 (ca. 10 Minuten) und ersetzt im **Text**-Feld den Schlüssel durch eine **Importfrage**
   (Kurzbefehl-Details → „Importfragen“ → Frage für das Text-Feld: „Dein Schlüssel aus der Speisekammer-App?“).
2. Teilen → **iCloud-Link kopieren**. Den Link könnte die App später als Knopf „Kurzbefehl holen“ anzeigen.
3. Die zweite Person tippt den Link an → „Kurzbefehl hinzufügen“ → beantwortet die Importfrage mit ihrem eigenen Schlüssel → startet ihn einmal und erlaubt Health.
4. Die Automationen legt jede Person selbst an (Abschnitt 4).

**Lässt sich der Kurzbefehl samt Health-Aktionen per iCloud-Link teilen?**
Ja. Geteilt werden alle Aktionen, auch die Health-Aktionen. Die Health-Freigabe selbst wird nicht mitgeteilt. Die empfangende Person erlaubt den Zugriff auf ihrem iPhone beim ersten Start
(dass die Freigabe neu erteilt werden muss, steht bei Apple nicht wörtlich, so verhält sich iOS aber bei Datenschutz-Freigaben je Kurzbefehl).
Wichtig: Apple speichert den geteilten Kurzbefehl samt eingebetteter Inhalte, und jeder mit dem Link kann ihn laden. Darum den Schlüssel **nie** fest eintragen, sondern über die Importfrage.
Felder mit Importfrage werden beim Teilen geleert. Quellen: [Kurzbefehle teilen](https://support.apple.com/guide/shortcuts/apdf01f8c054/ios),
[Importfragen](https://support.apple.com/guide/shortcuts/add-import-questions-to-shared-shortcuts-apdf330fd3a0/ios),
[Shortcuts Sharing & Privacy](https://www.apple.com/legal/privacy/data/en/shortcuts-sharing/).

**Lesen Automationen Health-Daten bei gesperrtem iPhone?**
Nein. Apple sperrt Health-Daten, solange das iPhone gesperrt ist. Apple-Entwicklersupport 2026: „your app is not allowed to read health data while a device is locked“
([Apple Developer Forums](https://developer.apple.com/forums/thread/824819)). Im Kurzbefehl erscheint dann „Protected health data is inaccessible“
([Automators-Forum](https://talk.automators.fm/t/get-workouts-from-health-not-working-when-iphone-locked/13100)). Die Tageszeit-Automation startet zwar, bricht aber beim Lesen ab.

## 6. Folgen aus der Sperre und Gegenmaßnahmen
1. **Zeiten wählen, zu denen das Handy entsperrt ist** (Abschnitt 4). Ein Lauf, der ausfällt, kostet nichts. Der nächste erfolgreiche Lauf schickt den aktuellen Tagesstand.
2. **Block B** schickt beim ersten erfolgreichen Lauf am nächsten Tag den vollständigen Vortag. Damit sind vergangene Tage vollständig, auch wenn abends nichts lief.
3. **Knopf in der App** „Schritte aktualisieren“: Wer die App offen hat, hat entsperrt. Der Knopf liefert immer.
4. Option, falls 1–3 nicht reichen: Automation **App → „Wird geöffnet“** für eine oft genutzte App (z. B. WhatsApp). Läuft garantiert entsperrt, aber sehr oft.
   Der Server verträgt das, iOS zeigt eventuell kurz ein Banner. Erst ausprobieren, wenn nötig.

Konsequenz für die Anzeige: Der heutige Wert ist ein Zwischenstand. Darum zeigt die Karte „Stand heute 17:45 Uhr“.

## 7. Bewusst nicht gemacht
- Kein Kalorien- oder Schrittziel, keine Ampel.
- Keine Verrechnung mit den Essens-kcal. Kann der Essensplaner später als reine Info nutzen, falls gewünscht.
- Kein Mac nötig, alles läuft auf den iPhones.
