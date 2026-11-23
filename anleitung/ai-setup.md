# KI-Funktion einrichten (einmalig, kostenlos)

Die App nutzt zwei Gratis-Dienste. Die Schlüssel kommen **nur** in Supabase (Secrets), nie in die App oder ins Repo.

| Aufgabe | Dienst | Kosten |
|---|---|---|
| Chat, Gericht anpassen (Text) | Cloudflare Workers AI | 0 €, 10.000 „Neurons“ pro Tag gratis, danach Fehlermeldung statt Kosten |
| Fotos einlesen (Rezept, Bon, Verpackung) | Mistral (Gratis-Modus) | 0 €, keine Karte |

## 1. Cloudflare
1. Konto auf cloudflare.com anlegen (kostenlos, keine Karte nötig).
2. **Account-ID** kopieren (Dashboard → rechte Seitenleiste oder Workers & Pages → Übersicht).
3. Unter *AI → Workers AI → „Use REST API“ → Create a Workers AI API token* ein Token anlegen (Rechte „Workers AI – Read“ und „Workers AI – Edit“). Token kopieren.

## 2. Mistral
1. Konto auf console.mistral.ai anlegen, Gratis-Modus („Free mode“, früher „Experiment“) wählen.
2. **Training abschalten:** admin.mistral.ai → *Privacy* → „Data usage for improving our services“ **ausschalten**. (Der Schalter für die Chat-App „Vibe“ ist ein anderer.)
3. Unter *API-Keys* einen Schlüssel erzeugen und kopieren.
4. Auf der Seite *Limits* (admin.mistral.ai/plateforme/limits) die angezeigten Gratis-Limits notieren und im App-Thread nennen.

## 3. Supabase
1. SQL Editor: den neuen Abschnitt „KI-Funktion“ aus `supabase/schema.sql` ausführen (oder die ganze Datei erneut, sie ist wiederholbar). Er legt `ai_usage` und `ai_use()` an.
2. *Edge Functions → Secrets* (oder `supabase secrets set`):
   - `CF_ACCOUNT_ID`
   - `CF_API_TOKEN`
   - `MISTRAL_API_KEY`
   - optional `CF_TEXT_MODEL` (Standard `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, bei knappem Kontingent z. B. `@cf/meta/llama-3.1-8b-instruct-fp8-fast`)
   - optional `MISTRAL_VISION_MODEL` (Standard `mistral-small-latest`)
3. Function `ai` deployen: Dashboard → Edge Functions → *Deploy a new function* → Name `ai` → Inhalt von `supabase/functions/ai/index.ts` einfügen. „Verify JWT“ kann an bleiben.

## Limits und Datenschutz
- Pro Haushalt und Tag: 40 Text- und 10 Foto-Anfragen (in `ai_use()` änderbar, Zahl `lim`).
- Gesundheitsangaben gehen nur mit, wenn bei der einzelnen Anfrage der Haken gesetzt wird. Fotos gehen nie zusammen mit Gesundheitsangaben.
- Es werden nur Zähler gespeichert, keine Fragen, Antworten oder Fotos.
- Cloudflare: kein Training mit Kundendaten, keine Aufbewahrung (Doku „Workers AI – Data usage“, Stand Okt. 2026). Verarbeitungsort nicht angegeben.
- Mistral: im Gratis-Modus Training standardmäßig an, daher Schritt 2.2. Verarbeitungsort nicht belegt.
- Gratis-Tarife können sich ändern. Fällt einer weg, zeigt die App eine Fehlermeldung, der Rest läuft weiter. Der Anbieter ist nur in `supabase/functions/ai/index.ts` verdrahtet und dort austauschbar.
