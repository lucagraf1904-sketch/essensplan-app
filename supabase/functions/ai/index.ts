// Supabase Edge Function „ai“: KI-Funktionen der App über kostenlose Anbieter. Die API-Schlüssel liegen nur hier (Secrets), nie in der App.
//   Text (Chat, Gericht anpassen)  → Cloudflare Workers AI (kein Training mit Kundendaten, keine Speicherung laut Cloudflare-Doku)
//   Fotos (Rezept, Kassenbon, Verpackung) → Cloudflare (Gemma 4), als Ersatz Mistral (Gratis-Modus; Training im Mistral-Admin-Bereich abschalten!)
// Aufruf (angemeldet): POST { action: 'chat' | 'adapt' | 'parse', ... } → { text } | { recipe } | { data }
//   chat:  { messages: [{ role, content }], context?: { pantry[], utensils[], prefs[] }, health?: string[] }
//   adapt: { recipe: { title, ingredients[], steps[], min, servings }, goal, context?, health? }
//   parse: { kind: 'recipe' | 'receipt' | 'package', image: 'data:image/jpeg;base64,…' }   (nie zusammen mit health)
// Gesundheitsangaben (health) kommen nur mit, wenn die Person es für genau diese Anfrage angetippt hat (Lucas Vorgabe, Option B).
// Es werden keine Inhalte gespeichert oder protokolliert, nur Zähler pro Haushalt (Tabelle ai_usage, Funktion ai_use).
// Secrets: CF_ACCOUNT_ID, CF_API_TOKEN. Optional: MISTRAL_API_KEY (Ersatz für Fotos), CF_TEXT_MODEL, CF_VISION_MODEL, MISTRAL_VISION_MODEL, VISION_ORDER (z. B. „mistral,cloudflare“).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, status = 200) => Response.json(b, { status, headers: cors });
class Fail extends Error { constructor(public status: number, msg: string, public code?: string, public detail?: string) { super(msg); } }

const CF_MODEL = () => Deno.env.get('CF_TEXT_MODEL') || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MISTRAL_MODEL = () => Deno.env.get('MISTRAL_VISION_MODEL') || 'mistral-small-latest';
// Fotos: erst Cloudflare (Gemma 4, Apache-2.0-Lizenz, kein Training, keine Speicherung), dann Mistral als Ersatz, falls MISTRAL_API_KEY gesetzt ist.
const CF_VISION_MODEL = () => Deno.env.get('CF_VISION_MODEL') || '@cf/google/gemma-4-26b-a4b-it';
const VISION_ORDER = () => (Deno.env.get('VISION_ORDER') || 'cloudflare,mistral').split(',').map(x => x.trim()).filter(Boolean);

const SYSTEM = `Du bist der Küchen-Assistent der App „Speisekammer“ für einen Haushalt in Deutschland. Antworte immer auf Deutsch, kurz, konkret und ohne Floskeln.
Regeln:
- Nutze den Vorrat und die vorhandenen Geräte, wenn es passt. Nenne zuerst, was bald abläuft.
- Kalorien und Nährwerte sind immer grobe Schätzungen und müssen als solche („ca.“) gekennzeichnet sein.
- Keine Diagnosen, keine Ratschläge zu Medikamenten oder Dosierungen. Bei Krankheit oder Medikamenten auf Ärztin, Arzt oder Apotheke verweisen.
- Erfinde keine Quellen, Studien oder Zahlen. Wenn du etwas nicht sicher weißt, sag das.
- Beachte die genannten Vorlieben (z. B. wenig Weizen, kein Schweinefleisch).`;

const str = (v: unknown, max: number) => typeof v === 'string' ? v.slice(0, max) : '';
const list = (v: unknown, n: number, max: number) => Array.isArray(v) ? v.map(x => str(x, max)).filter(Boolean).slice(0, n) : [];

function contextText(c: any, health: string[] | null): string {
  const parts: string[] = [];
  const pantry = list(c?.pantry, 60, 80), tools = list(c?.utensils, 20, 40), prefs = list(c?.prefs, 10, 40);
  if (pantry.length) parts.push('Vorrat: ' + pantry.join('; '));
  if (tools.length) parts.push('Geräte: ' + tools.join(', '));
  if (prefs.length) parts.push('Vorlieben: ' + prefs.join(', '));
  if (health?.length) parts.push('Gesundheitsangaben (freiwillig, nur für diese eine Anfrage mitgeschickt, bitte nicht weitergeben): ' + health.join(', ') + '. Gib dazu nur allgemeine Ernährungshinweise, keine Diagnose.');
  return parts.join('\n');
}

// Fehler des Anbieters verständlich weitergeben. Kurze Meldung für die Anzeige, Original-Text (gekürzt, ohne Schlüssel) separat in „detail“.
// 429 heißt nicht automatisch „Tageskontingent leer“: Mistral meldet z. B. mit Code 1300 auch „kein API-Zugang für dieses Konto“.
async function providerFail(r: Response, who: string): Promise<Fail> {
  const raw = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 240);
  console.error(`${who}: HTTP ${r.status} ${raw}`); // nur Status und Fehlertext, keine Inhalte der Anfrage
  if (r.status === 429 && /"code"\s*:\s*"?1300/.test(raw)) return new Fail(502, `${who} gibt diesem Konto gerade keine Anfragen frei (Status 429, Code 1300).`, 'provider-access', raw);
  if (r.status === 429) return new Fail(429, `${who} bremst gerade (Status 429). Bitte gleich noch einmal versuchen.`, 'provider-limit', raw);
  if (r.status === 401 || r.status === 403) return new Fail(502, `${who}: Zugang abgelehnt (Status ${r.status}), Schlüssel oder Rechte prüfen.`, 'provider-auth', raw);
  if (r.status === 400 || r.status === 422) return new Fail(502, `${who} lehnt die Anfrage ab (Status ${r.status}), z. B. Modell ohne Bildunterstützung.`, 'provider-request', raw);
  return new Fail(502, `${who} antwortet nicht (Status ${r.status}).`, 'provider', raw);
}

async function cfChat(messages: { role: string; content: unknown }[], maxTokens: number, model = CF_MODEL()): Promise<string> {
  const acc = Deno.env.get('CF_ACCOUNT_ID'), tok = Deno.env.get('CF_API_TOKEN');
  if (!acc || !tok) throw new Fail(503, 'Die KI ist noch nicht eingerichtet (Cloudflare-Zugang fehlt).', 'setup');
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/ai/v1/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: model === CF_MODEL() ? 0.4 : 0 }),
  }).catch(() => { throw new Fail(502, 'Der KI-Dienst ist gerade nicht erreichbar.', 'provider'); });
  if (!r.ok) throw await providerFail(r, 'KI-Dienst (Cloudflare)');
  const j = await r.json().catch(() => null);
  const t = j?.choices?.[0]?.message?.content ?? j?.result?.response ?? j?.result?.choices?.[0]?.message?.content;
  if (typeof t !== 'string' || !t.trim()) throw new Fail(502, 'Der KI-Dienst hat keine Antwort geliefert.', 'provider');
  return t.trim();
}

async function mistralVision(prompt: string, image: string): Promise<string> {
  const key = Deno.env.get('MISTRAL_API_KEY');
  if (!key) throw new Fail(503, 'Foto-Einlesen ist noch nicht eingerichtet (Mistral-Zugang fehlt).', 'setup');
  const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(90000),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MISTRAL_MODEL(), temperature: 0, max_tokens: 2500, response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: image }] }],
    }),
  }).catch(() => { throw new Fail(502, 'Der Foto-Dienst ist gerade nicht erreichbar.', 'provider'); });
  if (!r.ok) throw await providerFail(r, 'Foto-Dienst (Mistral)');
  const j = await r.json().catch(() => null);
  const t = j?.choices?.[0]?.message?.content;
  if (typeof t !== 'string' || !t.trim()) throw new Fail(502, 'Der Foto-Dienst hat keine Antwort geliefert.', 'provider');
  return t;
}

async function cfVision(prompt: string, image: string): Promise<string> {
  return await cfChat([{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image } }] }], 2500, CF_VISION_MODEL());
}
// Foto-Dienste der Reihe nach versuchen. Fehlt ein Schlüssel oder schlägt ein Dienst fehl, kommt der nächste dran.
async function vision(prompt: string, image: string): Promise<string> {
  const errors: Fail[] = [];
  for (const p of VISION_ORDER()) {
    try {
      if (p === 'cloudflare') return await cfVision(prompt, image);
      if (p === 'mistral') { if (!Deno.env.get('MISTRAL_API_KEY') && errors.length) continue; return await mistralVision(prompt, image); }
    } catch (e) { if (e instanceof Fail) errors.push(e); else throw e; }
  }
  const first = errors[0];
  if (!first) throw new Fail(503, 'Foto-Einlesen ist nicht eingerichtet.', 'setup');
  const more = errors.slice(1).map(e => e.message).join(' ');
  throw new Fail(first.status, first.message + (more ? ' Ersatzdienst: ' + more : ''), first.code, [first.detail, ...errors.slice(1).map(e => e.detail)].filter(Boolean).join(' | ').slice(0, 480));
}

// Erstes JSON-Objekt aus einer Modellantwort holen (auch wenn Text oder ```json drumherum steht)
function parseJson(t: string): any {
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Fail(502, 'Die KI-Antwort war nicht lesbar. Bitte noch einmal versuchen.', 'format');
  try { return JSON.parse(t.slice(s, e + 1)); } catch { throw new Fail(502, 'Die KI-Antwort war nicht lesbar. Bitte noch einmal versuchen.', 'format'); }
}

const num = (v: unknown) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

const PARSE_PROMPTS: Record<string, string> = {
  recipe: `Lies das Rezept auf dem Foto (Kochbuchseite, Zeitschrift oder Screenshot). Antworte NUR mit JSON in genau dieser Form:
{"title":"Name des Gerichts","ingredients":["500 g Rinderhack","2 Paprika"],"steps":["Schritt 1","Schritt 2"],"min":45,"servings":"4 Portionen"}
"min" ist die Gesamtdauer in Minuten oder null. "servings" ist Text oder null. Übernimm nur, was lesbar dasteht. Erfinde nichts, lass Unleserliches weg. Ist kein Rezept zu sehen: {"title":"","ingredients":[],"steps":[],"min":null,"servings":null}.`,
  receipt: `Lies den Kassenbon auf dem Foto (Supermarkt in Deutschland). Antworte NUR mit JSON in genau dieser Form:
{"items":[{"name":"Rinderhackfleisch","price":4.99,"qty":1,"unit":"Stk","size":"500 g"}],"deposit":[{"name":"Pfand","price":0.25}]}
"price" ist der Endpreis der Zeile in Euro als Zahl, nach Abzug von Rabatten auf diese Zeile. "qty" ist die Anzahl oder das Gewicht, "unit" eine von Stk, kg, g, l, ml. "size" ist die Packungsgröße, wenn sie auf dem Bon steht, sonst "". Schreibe Abkürzungen aus, wenn der Artikel eindeutig ist. Pfand und Leergut gehören nur in "deposit" (Leergut-Rückgabe mit negativem Preis). Summen, Zahlungsarten, MwSt und Kundenkarten-Zeilen weglassen. Erfinde keine Zeilen.`,
  package: `Lies die Verpackung auf dem Foto. Antworte NUR mit JSON in genau dieser Form:
{"name":"Haferflocken zart","size":"500 g","bestBefore":"2027-03-31","kcal100":372}
"size" ist die Füllmenge. "bestBefore" ist das Mindesthaltbarkeitsdatum als YYYY-MM-DD oder null, wenn es nicht lesbar ist (bei Angabe nur Monat/Jahr den letzten Tag des Monats nehmen). "kcal100" sind die kcal pro 100 g/ml laut Nährwerttabelle oder null. Erfinde nichts.`,
};

function cleanParsed(kind: string, d: any) {
  if (kind === 'recipe') {
    return { title: str(d?.title, 120), ingredients: list(d?.ingredients, 60, 160), steps: list(d?.steps, 40, 600), min: num(d?.min), servings: str(d?.servings, 40) || null };
  }
  if (kind === 'receipt') {
    const items = (Array.isArray(d?.items) ? d.items : []).slice(0, 120).map((x: any) => ({
      name: str(x?.name, 100), price: num(x?.price), qty: num(x?.qty) ?? 1,
      unit: ['Stk', 'kg', 'g', 'l', 'ml'].includes(x?.unit) ? x.unit : 'Stk', size: str(x?.size, 30),
    })).filter((x: any) => x.name && x.price !== null);
    const deposit = (Array.isArray(d?.deposit) ? d.deposit : []).slice(0, 20).map((x: any) => ({ name: str(x?.name, 60) || 'Pfand', price: num(x?.price) })).filter((x: any) => x.price);
    return { items, deposit };
  }
  const bb = str(d?.bestBefore, 10);
  return { name: str(d?.name, 100), size: str(d?.size, 30), bestBefore: /^\d{4}-\d{2}-\d{2}$/.test(bb) ? bb : null, kcal100: num(d?.kcal100) };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ error: 'Nicht angemeldet' }, 401);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Ungültige Anfrage' }, 400);
  const action = body.action;
  if (!['chat', 'adapt', 'parse'].includes(action)) return json({ error: 'Unbekannte Aktion' }, 400);
  const isImage = action === 'parse';
  const health = Array.isArray(body.health) && body.health.length ? list(body.health, 10, 60) : null;
  // Option B: Fotos laufen nie zusammen mit Gesundheitsangaben
  if (isImage && Array.isArray(body.health) && body.health.length) return json({ error: 'Fotos werden nie zusammen mit Gesundheitsangaben gesendet.' }, 400);
  const kind = isImage ? 'image' : 'text';

  // Eingaben prüfen, bevor gezählt wird
  let image = '';
  if (isImage) {
    image = str(body.image, 3_000_000);
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) return json({ error: 'Das Foto ist nicht lesbar oder zu groß.' }, 400);
    if (!PARSE_PROMPTS[body.kind]) return json({ error: 'Unbekannte Foto-Art' }, 400);
  }
  if (action === 'chat') {
    const m = Array.isArray(body.messages) ? body.messages.slice(-10) : [];
    if (!m.length || m[m.length - 1]?.role !== 'user') return json({ error: 'Keine Frage übergeben.' }, 400);
  }
  if (action === 'adapt' && (!body.recipe?.title || !str(body.goal, 200))) return json({ error: 'Rezept oder Wunsch fehlt.' }, 400);

  // Tageslimit des Haushalts (zählt vorab, bei Fehler des Anbieters wird zurückgegeben)
  const use = await sb.rpc('ai_use', { p_kind: kind, p_delta: 1 });
  if (use.error) return json({ error: 'Limit-Prüfung nicht möglich: ' + use.error.message.slice(0, 120) }, 500);
  if (!use.data?.ok) return json({ error: `Tageslimit erreicht: ${use.data.limit} ${isImage ? 'Foto-' : 'Text-'}Anfragen pro Tag für euren Haushalt. Morgen geht es weiter.`, code: 'limit', used: use.data.used, limit: use.data.limit }, 429);

  try {
    let out: unknown;
    if (action === 'chat') {
      const ctx = contextText(body.context, health);
      const msgs = body.messages.slice(-10).filter((x: any) => x && (x.role === 'user' || x.role === 'assistant')).map((x: any) => ({ role: x.role, content: str(x.content, 2000) }));
      out = { text: await cfChat([{ role: 'system', content: SYSTEM + (ctx ? '\n\n' + ctx : '') }, ...msgs], 700) };
    } else if (action === 'adapt') {
      const r = body.recipe, ctx = contextText(body.context, health);
      const recipe = JSON.stringify({ title: str(r.title, 120), ingredients: list(r.ingredients, 60, 160), steps: list(r.steps, 40, 600), min: num(r.min), servings: str(r.servings, 40) || null });
      const prompt = `Passe dieses Gericht an. Wunsch: ${str(body.goal, 200)}\n\nGericht (JSON):\n${recipe}\n\nAntworte NUR mit JSON in genau dieser Form: {"title":"...","ingredients":["500 g ..."],"steps":["..."],"min":45,"servings":"4 Portionen","note":"ein Satz, was du geändert hast und worauf man achten sollte"}\nÄndere nur, was der Wunsch verlangt. Mengen sinnvoll anpassen. Keine neuen Zutaten erfinden, die dem Wunsch widersprechen.`;
      const d = parseJson(await cfChat([{ role: 'system', content: SYSTEM + (ctx ? '\n\n' + ctx : '') }, { role: 'user', content: prompt }], 1400));
      out = { recipe: { ...cleanParsed('recipe', d), note: str(d?.note, 400) } };
    } else {
      out = { data: cleanParsed(body.kind, parseJson(await vision(PARSE_PROMPTS[body.kind], image))) };
    }
    return json(out);
  } catch (e) {
    await sb.rpc('ai_use', { p_kind: kind, p_delta: -1 }); // fehlgeschlagene Anfrage zählt nicht
    if (e instanceof Fail) return json({ error: e.message, code: e.code, detail: e.detail }, e.status);
    return json({ error: 'Unerwarteter Fehler in der KI-Funktion.' }, 500);
  }
});
