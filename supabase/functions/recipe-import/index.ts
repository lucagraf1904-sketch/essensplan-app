// Supabase Edge Function „recipe-import“: liest eine Rezeptseite und gibt die Rezeptdaten zurück.
// Viele Rezeptseiten (Chefkoch, Lecker, Kitchen Stories, Blogs mit WordPress-Rezept-Plugins) enthalten die Daten maschinenlesbar
// als JSON-LD nach schema.org/Recipe. Nur diese strukturierten Angaben werden übernommen, keine Bilder, kein Seitentext.
// Nutzung nur privat im eigenen Haushalt; der Link zum Original wird mitgespeichert.
// Aufruf (angemeldet): POST { url } → { title, ingredients[], steps[], min, servings, url }
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, status = 200) => Response.json(b, { status, headers: cors });

// Keine Adressen im eigenen Netz abrufen (Schutz vor Missbrauch der Funktion)
function allowed(u: URL) {
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false;
  if (u.port && !['80', '443'].includes(u.port)) return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return false; // keine nackten IP-Adressen
  return true;
}
// ISO-8601-Dauer „PT1H15M“ → Minuten
const minutes = (d?: string) => { const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(d ?? ''); return m ? (+(m[1] ?? 0)) * 1440 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0)) || null : null; };
const text = (v: unknown): string => typeof v === 'string' ? v.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : '';
function steps(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === 'string') return v.split(/\n+/).map(text).filter(Boolean);
  if (Array.isArray(v)) return v.flatMap(x => typeof x === 'string' ? [text(x)] : x?.itemListElement ? steps(x.itemListElement) : [text(x?.text ?? x?.name)]).filter(Boolean);
  return [];
}
function findRecipe(node: any): any {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipe(n); if (r) return r; } return null; }
  const t = node['@type']; if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return node;
  return findRecipe(node['@graph']) ?? null;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ error: 'Nicht angemeldet' }, 401);
  const { url } = await req.json().catch(() => ({}));
  let u: URL; try { u = new URL(String(url ?? '').trim()); } catch { return json({ error: 'Das ist kein gültiger Link.' }, 400); }
  if (!allowed(u)) return json({ error: 'Dieser Link kann nicht gelesen werden.' }, 400);
  let html = '';
  try {
    const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0 (Speisekammer-App; Rezeptimport)', accept: 'text/html' } });
    if (!r.ok) return json({ error: `Seite antwortet nicht (${r.status}).` }, 502);
    if (!allowed(new URL(r.url))) return json({ error: 'Weiterleitung auf eine nicht erlaubte Adresse.' }, 400);
    html = (await r.text()).slice(0, 3_000_000);
  } catch { return json({ error: 'Seite konnte nicht geladen werden.' }, 502); }
  let recipe: any = null;
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { recipe = findRecipe(JSON.parse(m[1].trim())); } catch { /* kaputtes JSON überspringen */ }
    if (recipe) break;
  }
  if (!recipe) return json({ error: 'Auf der Seite wurden keine Rezeptdaten gefunden. Tipp: Rezepttext kopieren und einfügen.' }, 422);
  const ingredients = (Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient : []).map(text).filter(Boolean).slice(0, 40);
  return json({
    title: text(recipe.name).slice(0, 100),
    ingredients,
    steps: steps(recipe.recipeInstructions).slice(0, 30),
    min: minutes(recipe.totalTime) ?? ((minutes(recipe.prepTime) ?? 0) + (minutes(recipe.cookTime) ?? 0) || null),
    servings: text(Array.isArray(recipe.recipeYield) ? recipe.recipeYield[0] : String(recipe.recipeYield ?? '')).slice(0, 30) || null,
    url: u.toString(),
  });
});
