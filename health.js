// Bewegung aus Apple Health: Tagesschritte und aktive Kalorien, geliefert vom iPhone-Kurzbefehl (siehe KURZBEFEHL.md).
// VORBEREITET, noch nicht live: zeigt sich nur mit Supabase und HEALTH_ENABLED = true in config.js.
// Bewusst ohne Ziel und ohne Bewertung (Luca: kein Kalorienziel). Reine Übersicht.
import { HEALTH_ENABLED, HEALTH_SHORTCUT_NAME } from './config.js';
import { isoLocal } from './categories.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n == null ? '–' : Math.round(n).toLocaleString('de-DE');
const DAYS = 7;

export const shortcutUrl = (name = HEALTH_SHORTCUT_NAME) => 'shortcuts://run-shortcut?name=' + encodeURIComponent(name);

function lastDays(n, today = new Date()) {
  return Array.from({ length: n }, (_, i) => { const d = new Date(today); d.setDate(d.getDate() - (n - 1 - i)); return isoLocal(d); });
}
const when = ts => {
  if (!ts) return '';
  const d = new Date(ts), today = isoLocal() === isoLocal(d);
  return (today ? 'heute ' : d.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' }) + ' ') +
    d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
};

// Reine Darstellung, auch für Vorschau/Test nutzbar. data = { me, people:[{user_id,label}], days:[{user_id,date,steps,active_kcal,updated_at}] }
export function healthHtml(data, today = new Date()) {
  const dates = lastDays(DAYS, today), todayIso = dates[DAYS - 1];
  const people = [...data.people].sort((a, b) => (b.user_id === data.me) - (a.user_id === data.me));
  const byKey = new Map(data.days.map(d => [d.user_id + d.date, d]));
  const cards = people.map(p => {
    const t = byKey.get(p.user_id + todayIso);
    const week = dates.map(d => byKey.get(p.user_id + d));
    const maxSteps = Math.max(1, ...week.map(w => w?.steps ?? 0));
    const withData = week.filter(w => w?.steps != null);
    const avg = withData.length ? withData.reduce((s, w) => s + w.steps, 0) / withData.length : null;
    const bars = week.map((w, i) => {
      const h = w?.steps ? Math.max(4, Math.round(w.steps / maxSteps * 100)) : 0;
      const label = new Date(dates[i] + 'T12:00').toLocaleDateString('de-DE', { weekday: 'narrow' });
      return `<div class="hbar" title="${esc(dates[i])}: ${fmt(w?.steps)} Schritte"><i style="height:${Math.round(h * 0.32)}px"></i><span>${label}</span></div>`;
    }).join('');
    return `<div class="stat health-person">
      <div class="muted">${esc(p.label)}</div>
      <b>${fmt(t?.steps)} <small>Schritte</small></b>
      <div>${fmt(t?.active_kcal)} kcal aktiv</div>
      <div class="hbars">${bars}</div>
      <div class="muted tiny">Ø ${DAYS} Tage: ${fmt(avg)} Schritte${t?.updated_at ? ' · Stand ' + when(t.updated_at) : withData.length ? '' : ' · noch keine Daten'}</div>
    </div>`;
  }).join('');
  return `<h2>Bewegung heute</h2>
    <div class="stats health-stats">${cards || '<p class="muted">Noch kein Kurzbefehl eingerichtet. Einstellungen → Bewegung.</p>'}</div>
    <button id="health-refresh" class="health-refresh">🔄 Schritte aktualisieren</button>
    <p class="muted tiny">Werte aus Apple Health über den Kurzbefehl „${esc(HEALTH_SHORTCUT_NAME)}“. „Aktiv“ = Bewegungskalorien ohne Grundumsatz. Keine Ziele, nur Übersicht.</p>`;
}

export function initHealth(store, $) {
  if (!HEALTH_ENABLED || store.mode !== 'supabase' || !store.listHealth) return { render() {} };
  const box = $('#health-box'), set = $('#health-settings');
  box.classList.remove('hidden'); set.classList.remove('hidden');
  let refreshing = false;

  async function render() {
    const from = lastDays(DAYS)[0];
    try { box.innerHTML = healthHtml(await store.listHealth(from)); }
    catch (e) { box.innerHTML = `<h2>Bewegung heute</h2><p class="muted">Nicht geladen: ${esc(e.message)}</p>`; }
  }

  async function renderSettings(newToken) {
    const t = await store.healthToken().catch(() => null);
    set.innerHTML = `<h2>Bewegung (Apple Health)</h2>
      <p class="muted">Ein Kurzbefehl auf dem iPhone schickt Schritte und aktive Kalorien. Jede Person braucht ihren eigenen Schlüssel. Anleitung: KURZBEFEHL.md.</p>
      ${t ? `<p class="muted tiny">Schlüssel für „${esc(t.label)}“ vorhanden${t.last_used_at ? ', zuletzt benutzt ' + when(t.last_used_at) : ', noch nie benutzt'}.</p>` : ''}
      ${newToken ? `<div class="warn info"><b>Nur jetzt sichtbar.</b> In den Kurzbefehl übernehmen:
          <p class="tiny">Adresse<br><code id="h-url">${esc(store.healthUrl())}</code></p>
          <p class="tiny">Schlüssel<br><code id="h-tok">${esc(newToken)}</code></p>
          <button data-copy="h-url">Adresse kopieren</button> <button data-copy="h-tok">Schlüssel kopieren</button></div>` : ''}
      <div class="toolbar"><input id="h-label" placeholder="Name, z. B. Luca" value="${esc(t?.label ?? '')}">
        <button id="h-new">${t ? 'Neuer Schlüssel' : 'Schlüssel erzeugen'}</button></div>
      ${t ? `<label class="row"><input type="checkbox" id="h-share" ${t.share_household ? 'checked' : ''}> Meine Werte im Haushalt zeigen</label>` : ''}
      <p class="muted tiny">Ein neuer Schlüssel macht den alten ungültig. Dann im Kurzbefehl ersetzen.</p>`;
  }

  set.addEventListener('click', async e => {
    if (e.target.id === 'h-new') {
      if (e.target.dataset.sure !== '1' && e.target.textContent.startsWith('Neuer')) { e.target.dataset.sure = '1'; e.target.textContent = 'Wirklich? Nochmal tippen'; return; }
      try { await renderSettings(await store.createHealthToken($('#h-label').value)); } catch (err) { alertBox(err.message); }
    }
    const c = e.target.dataset.copy;
    if (c) { await navigator.clipboard?.writeText($('#' + c).textContent); e.target.textContent = '✓ kopiert'; }
  });
  set.addEventListener('change', async e => { if (e.target.id === 'h-share') await store.setHealthShare(e.target.checked); render(); });
  const alertBox = m => set.insertAdjacentHTML('beforeend', `<p class="muted">${esc(m)}</p>`);

  // Knopf startet den Kurzbefehl. iOS wechselt in die Kurzbefehle-App; zurück in der App wird neu geladen.
  box.addEventListener('click', e => {
    if (e.target.id !== 'health-refresh') return;
    refreshing = true;
    location.href = shortcutUrl();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (refreshing) { refreshing = false; setTimeout(render, 1500); } else render();
  });

  renderSettings();
  render();
  return { render };
}
