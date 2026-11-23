// KI-Funktionen (Luca 23.11.2026): Küchen-Assistent (Chat), Gericht anpassen, Fotos einlesen (Rezept, Kassenbon, Verpackung).
// Läuft über die Supabase Edge Function „ai“ (supabase/functions/ai). Der Schlüssel der KI-Anbieter liegt nur dort.
// Datenschutz: Gesundheitsangaben gehen NUR mit, wenn die Person es für genau diese Anfrage antippt (Haken wird nach jeder Anfrage zurückgesetzt).
// Fotos gehen nie zusammen mit Gesundheitsangaben weg. Chatverlauf bleibt nur im Speicher, nichts wird gespeichert.
import { getSettings } from './settings.js';
import { conditionLabel } from './conditions.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let ctx = null, history = [], busy = false;

export const aiOn = () => getSettings().aiOn !== false;
export const healthLabels = () => (getSettings().health ?? []).map(conditionLabel);

// Foto verkleinern (längste Seite 1280 px, JPEG): schneller Upload und weniger Gratis-Kontingent
export async function photoToDataUrl(file, max = 1280, quality = 0.8) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('Das Foto konnte nicht gelesen werden.');
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

// Foto einlesen. kind: 'recipe' | 'receipt' | 'package'. Liefert die bereinigten Daten der Funktion.
export async function parsePhoto(kind, file) {
  const image = await photoToDataUrl(file, kind === 'package' ? 1024 : 1280); // Verpackung: kleineres Bild genügt und geht schneller
  const r = await ctx.store.askAi({ action: 'parse', kind, image });
  return r.data;
}

// Gericht anpassen: Wunsch per Knopf, Gesundheitsangaben nur mit Haken für diese eine Anfrage
const GOALS = ['Weniger Fett', 'Weniger Salz', 'Ohne Weizen', 'Vegetarisch', 'Für 4 Portionen', 'Schneller (unter 30 Min.)', 'Mit Ninja Foodi', 'Mehr Gemüse', 'Mehr Eiweiß'];
export async function adaptRecipe(recipe) {
  if (!aiOn()) { await ctx.ask('KI ist aus', 'Du kannst sie unter Einstellungen → 🤖 KI-Assistent einschalten.', [{ value: 'ok', label: 'OK', cls: 'primary' }]); return null; }
  const hl = healthLabels();
  const v = await ctx.ask('🤖 Gericht anpassen', `<p class="tiny muted">Was soll sich ändern? Die KI schlägt eine Fassung vor, du prüfst sie, bevor du speicherst. Das Rezept (ohne Namen) wird an einen KI-Dienst gesendet.</p>
    ${hl.length ? `<label class="ai-health"><input type="checkbox" id="ai-adapt-health"> Meine Gesundheitsangaben (${esc(hl.join(', '))}) für diese eine Anfrage mitschicken</label>` : ''}
    <label class="ask-field">Eigener Wunsch<input id="ai-adapt-own" placeholder="z. B. ohne Pilze, mit Reis statt Nudeln"></label>`,
    [...GOALS.map(g => ({ value: g, label: g })), { value: '__own', label: 'Eigenen Wunsch nehmen', cls: 'primary' }, { value: '', label: 'Abbrechen' }]);
  if (!v) return null;
  const goal = v === '__own' ? $('#ai-adapt-own')?.value.trim() : v;
  if (!goal) return null;
  const withHealth = !!$('#ai-adapt-health')?.checked;
  ctx.toast('🤖 Die KI überarbeitet das Gericht …');
  try {
    const r = await ctx.store.askAi({ action: 'adapt', recipe, goal, context: await ctx.context(), ...(withHealth ? { health: hl } : {}) });
    return r.recipe;
  } catch (e) { await ctx.ask('Anpassen hat nicht geklappt', esc(e.message) + (e.detail ? `<details class="tiny muted"><summary>Technische Details</summary>${esc(e.detail)}</details>` : ''), [{ value: 'ok', label: 'OK' }]); return null; }
}

// ---------- Chat ----------
const CHIPS = ['Was koche ich heute aus dem Vorrat?', 'Was läuft bald ab und was mache ich daraus?', 'Ideen fürs kalte Frühstück', 'Kann man das einfrieren: '];
const fmt = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
function drawChat() {
  $('#ai-msgs').innerHTML = history.length
    ? history.map(m => `<div class="ai-msg ${m.role}">${m.role === 'user' ? esc(m.content) : fmt(m.content)}</div>`).join('') + (busy ? '<div class="ai-msg assistant muted">…</div>' : '')
    : '<p class="muted tiny">Frag zu Essen, Rezepten, Haltbarkeit oder Resten. Die KI kennt euren Vorrat und eure Geräte. Antworten sind Vorschläge, keine Beratung durch Ärztin oder Arzt.</p>';
  $('#ai-msgs').scrollTop = $('#ai-msgs').scrollHeight;
  $('#ai-chips').innerHTML = history.length ? '' : CHIPS.map(c => `<button type="button" class="chip" data-ai-chip="${esc(c)}">${esc(c)}</button>`).join('');
  const hl = healthLabels();
  $('#ai-health-row').classList.toggle('hidden', !hl.length);
  $('#ai-health-text').textContent = hl.length ? `Meine Gesundheitsangaben (${hl.join(', ')}) für diese eine Frage mitschicken` : '';
}
async function send(text) {
  text = text.trim(); if (!text || busy) return;
  const withHealth = $('#ai-health').checked;
  history.push({ role: 'user', content: text }); busy = true; $('#ai-input').value = ''; drawChat();
  try {
    const r = await ctx.store.askAi({ action: 'chat', messages: history.slice(-10), context: await ctx.context(), ...(withHealth ? { health: healthLabels() } : {}) });
    history.push({ role: 'assistant', content: r.text });
  } catch (e) { history.push({ role: 'assistant', content: '⚠️ ' + e.message }); }
  busy = false; $('#ai-health').checked = false; // Option B: Haken gilt nur für diese eine Anfrage
  drawChat();
}
export async function openChat() {
  if (!aiOn()) return ctx.ask('KI ist aus', 'Du kannst sie unter Einstellungen → 🤖 KI-Assistent einschalten.', [{ value: 'ok', label: 'OK', cls: 'primary' }]);
  drawChat(); $('#ai-dialog').showModal();
}

export function initAi(c) {
  ctx = c;
  $('#btn-ai')?.addEventListener('click', openChat);
  $('#ai-close').addEventListener('click', () => $('#ai-dialog').close());
  $('#ai-new').addEventListener('click', () => { history = []; drawChat(); });
  $('#ai-form').addEventListener('submit', e => { e.preventDefault(); send($('#ai-input').value); });
  $('#ai-chips').addEventListener('click', e => {
    const b = e.target.closest('[data-ai-chip]'); if (!b) return;
    const t = b.dataset.aiChip;
    if (t.endsWith(': ')) { $('#ai-input').value = t; $('#ai-input').focus(); } else send(t);
  });
}
