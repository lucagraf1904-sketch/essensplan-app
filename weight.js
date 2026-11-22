// Gewichtstracker (Luca 22.11.2026): Schalter, standardmäßig aus. Ein Eintrag pro Woche, Kurve ohne Bewertung, pro Person.
// Gespeichert unter 'speisekammer.weight' = { 'JJJJ-MM-TT' (Montag der Woche): kg }. Mit Supabase nur für die Person selbst sichtbar.
import { isoLocal } from './categories.js';

const KEY = 'speisekammer.weight';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } };
const save = w => localStorage.setItem(KEY, JSON.stringify(w));
export const weekStart = (d = new Date()) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return isoLocal(x); };
const fmt = n => n.toLocaleString('de-DE', { maximumFractionDigits: 1 });
const fmtD = iso => { const d = new Date(iso + 'T12:00'); return `${d.getDate()}.${d.getMonth() + 1}.`; };

export function setWeight(kg, week = weekStart()) { const w = load(); if (kg) w[week] = Math.round(kg * 10) / 10; else delete w[week]; save(w); }
export function weightEntries() { return Object.entries(load()).sort(([a], [b]) => a.localeCompare(b)).map(([week, kg]) => ({ week, kg })); }

// Kurve als SVG, ohne Zielwerte und ohne Bewertung
function chart(e) {
  if (e.length < 2) return '';
  const W = 320, H = 120, P = 22, ks = e.map(x => x.kg), lo = Math.min(...ks) - 0.5, hi = Math.max(...ks) + 0.5;
  const x = i => P + i * (W - 2 * P) / (e.length - 1), y = k => H - P - (k - lo) / (hi - lo) * (H - 2 * P);
  const pts = e.map((p, i) => `${x(i).toFixed(1)},${y(p.kg).toFixed(1)}`).join(' ');
  return `<svg class="weight-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gewichtsverlauf">
    <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    ${e.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.kg).toFixed(1)}" r="3" fill="currentColor"/>`).join('')}
    <text x="${P}" y="${H - 4}" font-size="10" fill="currentColor" opacity=".6">${fmtD(e[0].week)}</text>
    <text x="${W - P}" y="${H - 4}" font-size="10" fill="currentColor" opacity=".6" text-anchor="end">${fmtD(e[e.length - 1].week)}</text>
    <text x="4" y="${y(hi - 0.5) + 3}" font-size="10" fill="currentColor" opacity=".6">${fmt(hi - 0.5)}</text>
    <text x="4" y="${y(lo + 0.5) + 3}" font-size="10" fill="currentColor" opacity=".6">${fmt(lo + 0.5)}</text>
  </svg>`;
}

export function renderWeight(el, on) {
  if (!el) return;
  if (!on) { el.innerHTML = ''; el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const e = weightEntries().slice(-26), cur = load()[weekStart()];
  el.innerHTML = `<div class="weight-card">
    <div class="budget-top"><b>⚖️ Gewicht</b><span class="muted tiny">einmal pro Woche, nur für dich</span></div>
    ${chart(e)}
    ${e.length ? `<p class="tiny muted">${e.slice(-4).reverse().map(x => `Woche ab ${fmtD(x.week)}: ${fmt(x.kg)} kg`).join(' · ')}</p>` : '<p class="tiny muted">Noch keine Einträge.</p>'}
    <button type="button" id="weight-add" class="${cur ? '' : 'primary'}">${cur ? `Diese Woche: ${fmt(cur)} kg ändern` : 'Gewicht für diese Woche eintragen'}</button>
  </div>`;
}
