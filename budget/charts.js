// Kleine SVG-Diagramme ohne Bibliothek. Regeln: eine Achse, dünne Säulen (max. 24 px) mit 4 px runder Kante am Datenende,
// Gitterlinien leise, Werte nur an ausgewählten Stellen beschriftet, Tooltip bei Zeigen/Tippen, Tabelle als Alternative.
import { eurShort, eur } from './logic.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Säule mit runder Kante nur am Datenende (oben bei positiven, unten bei negativen Werten)
function bar(x, y0, y1, w, r = 4) {
  const h = Math.abs(y1 - y0); r = Math.min(r, h, w / 2);
  if (h < 0.5) return '';
  if (y1 < y0) return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}
// Saubere Achsenschritte (1, 2, 2,5, 5 × 10^n)
function niceTicks(min, max, count = 4) {
  if (max === min) max = min + 1;
  const raw = (max - min) / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v));
  return out;
}
const axisEur = c => { const e = c / 100; return Math.abs(e) >= 10000 ? (e / 1000).toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' Tsd. €' : e.toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' €'; };

function attachTips(root, items) {
  const tip = document.createElement('div'); tip.className = 'tip hidden'; root.appendChild(tip);
  const show = (i, ev) => {
    const it = items[i]; if (!it) return;
    tip.innerHTML = `<b>${esc(it.title)}</b>${esc(it.text)}`;
    const box = root.getBoundingClientRect(), svg = root.querySelector('svg').getBoundingClientRect();
    const k = svg.width / +root.querySelector('svg').getAttribute('viewBox').split(' ')[2];
    tip.style.left = Math.min(box.width - 60, Math.max(60, it.x * k)) + 'px';
    tip.style.top = Math.max(0, it.y * k - 8) + 'px';
    tip.classList.remove('hidden');
    root.querySelectorAll('.mark').forEach((m, j) => m.classList.toggle('active', j === i));
  };
  const hide = () => { tip.classList.add('hidden'); root.querySelectorAll('.mark.active').forEach(m => m.classList.remove('active')); };
  root.querySelectorAll('.hit').forEach(h => {
    const i = +h.dataset.i;
    h.addEventListener('pointerenter', e => show(i, e));
    h.addEventListener('pointerdown', e => show(i, e));
    h.addEventListener('focus', e => show(i, e));
    h.addEventListener('blur', hide);
  });
  root.addEventListener('pointerleave', hide);
}

// Säulen für eine Reihe (z. B. Ausgaben je Monat). data: [{ label, value (Cent), title }], highlight: Index der hervorgehobenen Säule
export function columns(root, data, { highlight = data.length - 1, avg = null, height = 180, color = 'var(--bar)', dim = 'var(--bar-2)' } = {}) {
  const W = 340, H = height, L = 44, R = 6, T = 18, B = 22;
  const max = Math.max(1, ...data.map(d => d.value), avg ?? 0);
  const ticks = niceTicks(0, max, 3);
  const top = ticks[ticks.length - 1];
  const y = v => T + (H - T - B) * (1 - v / top);
  const slot = (W - L - R) / data.length, bw = Math.min(24, slot * 0.6);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Säulendiagramm">`;
  s += '<g class="grid">' + ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>`).join('') + '</g>';
  s += '<g class="axis">' + ticks.map(t => `<text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${axisEur(t)}</text>`).join('') + '</g>';
  const tips = [];
  data.forEach((d, i) => {
    const x = L + slot * i + (slot - bw) / 2;
    s += `<rect class="hit" role="img" data-i="${i}" x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - B}" tabindex="0" aria-label="${esc(d.title)}: ${esc(eur(d.value))}"/>`;
    s += `<path class="mark" d="${bar(x, y(0), y(d.value), bw)}" fill="${i === highlight ? color : dim}"/>`;
    s += `<text class="lbl" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>`;
    if (i === highlight && d.value > 0) s += `<text class="val" x="${x + bw / 2}" y="${y(d.value) - 5}" text-anchor="middle">${esc(eurShort(d.value).replace(/,\d\d\s/, ' '))}</text>`;
    tips.push({ x: x + bw / 2, y: y(d.value), title: d.title, text: eur(d.value) + (d.extra ? ' · ' + d.extra : '') });
  });
  if (avg != null && avg > 0) s += `<line class="avg" x1="${L}" x2="${W - R}" y1="${y(avg)}" y2="${y(avg)}"/>`;
  s += '</svg>';
  root.innerHTML = s; root.classList.add('chart');
  attachTips(root, tips);
}

// Plus/Minus je Monat (Einnahmen − Ausgaben): positive Säulen nach oben (blau), negative nach unten (orange), Null-Linie in der Mitte
export function diverging(root, data, { height = 170 } = {}) {
  const W = 340, H = height, L = 44, R = 6, T = 14, B = 22;
  const lo = Math.min(0, ...data.map(d => d.value)), hi = Math.max(0, ...data.map(d => d.value), 1);
  const ticks = niceTicks(lo, hi, 3), a = ticks[0], b = ticks[ticks.length - 1];
  const y = v => T + (H - T - B) * (b - v) / (b - a || 1);
  const slot = (W - L - R) / data.length, bw = Math.min(24, slot * 0.6);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Plus und Minus je Monat">`;
  s += '<g class="grid">' + ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" ${t === 0 ? 'style="stroke:var(--muted);opacity:.6"' : ''}/>`).join('') + '</g>';
  s += '<g class="axis">' + ticks.map(t => `<text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t > 0 ? '+' : ''}${axisEur(t)}</text>`).join('') + '</g>';
  const tips = [];
  data.forEach((d, i) => {
    const x = L + slot * i + (slot - bw) / 2;
    s += `<rect class="hit" role="img" data-i="${i}" x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - B}" tabindex="0" aria-label="${esc(d.title)}: ${d.value >= 0 ? 'plus' : 'minus'} ${esc(eur(Math.abs(d.value)))}"/>`;
    s += `<path class="mark" d="${bar(x, y(0), y(d.value), bw)}" fill="${d.value >= 0 ? 'var(--pos)' : 'var(--neg)'}"/>`;
    s += `<text class="lbl" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>`;
    tips.push({ x: x + bw / 2, y: Math.min(y(d.value), y(0)), title: d.title, text: (d.value >= 0 ? '+' : '−') + eur(Math.abs(d.value)) });
  });
  s += '</svg>';
  root.innerHTML = s; root.classList.add('chart');
  attachTips(root, tips);
}

// Monatsband: ausgegeben | Fixkosten noch offen | frei, mit Markierung „heute“ (Anteil des Monats). Als HTML, damit es scharf bleibt.
export function band({ spent, pending, saved = 0, total, progress }) {
  const sum = Math.max(total, spent + pending + saved, 1);
  const ps = Math.max(0, Math.min(100, 100 * spent / sum)), pp = Math.max(0, Math.min(100 - ps, 100 * pending / sum)), pv = Math.max(0, Math.min(100 - ps - pp, 100 * saved / sum));
  return `<div class="bandbar" aria-hidden="true"><i class="s" style="width:${ps.toFixed(2)}%"></i><i class="p" style="width:${pp.toFixed(2)}%"></i><i class="v" style="width:${pv.toFixed(2)}%"></i>`
    + (progress != null ? `<b class="today" style="left:${(100 * Math.max(0, Math.min(1, progress))).toFixed(2)}%"></b>` : '') + '</div>';
}
