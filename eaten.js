// „Was wurde gegessen?“ mit Teilmengen je Packung (Luca 23.11.): Toast 20 Scheiben, Eier 10 Stück, Reis 500 g usw.
// Die Teile je Packung gelten pro Artikelname im Haushalt ('speisekammer.parts'). Gegessene Teile verringern die Menge im Vorrat
// (qty bleibt in Packungen, auch als Bruchteil, damit Preis-Anteil, Bilanz und Ablauf wie gewohnt weiterlaufen).
import { parseSize } from './balance.js';
import { isoLocal } from './categories.js';

const KEY = 'speisekammer.parts';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nameKey = n => String(n ?? '').trim().toLowerCase();
const loadMap = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } };
// Vorbelegung (Annahme, änderbar): übliche Packungsgrößen
const DEFAULTS = [[/toast/, 20, 'Scheiben'], [/\beier\b|^eier/, 10, 'Stück']];
const UNIT_STEP = { Gramm: 50 };
let ctx = null;

export function partsOf(item) {
  if (!item || item.category === 'Reste' || item.frozenAt) return null;
  const k = nameKey(item.name), own = loadMap()[k];
  if (own) return own.per > 0 ? { ...own, step: UNIT_STEP[own.unit] ?? 1 } : null;
  const d = DEFAULTS.find(([re]) => re.test(k) && !/nudel|salat|likör/.test(k));
  return d ? { per: d[1], unit: d[2], step: 1, assumed: true } : null;
}
export const partsLeft = item => { const p = partsOf(item); return p ? Math.max(0, Math.round(item.qty * p.per)) : null; };
const setParts = (item, per, unit) => { const m = loadMap(); m[nameKey(item.name)] = { per, unit }; localStorage.setItem(KEY, JSON.stringify(m)); };
export const partsLabel = item => {
  const p = partsOf(item), l = partsLeft(item); if (!p) return null;
  return `${l} ${p.unit} übrig${item.qty > 1.05 ? ` · ${+item.qty.toFixed(2)} Packungen` : ''}`;
};

// Teile je Packung festlegen (Zahl + Einheit per Antippen)
export async function configureParts(item) {
  const sz = parseSize(item.size || item.name), sug = partsOf(item)?.per ?? (sz?.unit === 'g' ? sz.amount : sz?.unit === 'Stk' ? sz.amount : '');
  const v = await ctx.askInput(`${item.name}: Teile je Packung`, 'Wie viele Scheiben, Stück oder Gramm sind in einer Packung?', sug || '', 'number'); if (!v) return null;
  const per = parseFloat(String(v).replace(',', '.')); if (!(per > 0)) return null;
  const unit = await ctx.ask('Wovon?', `${esc(per)} je Packung ${esc(item.name)}`, [
    { value: 'Scheiben', label: 'Scheiben', cls: sug && partsOf(item)?.unit === 'Scheiben' ? 'primary' : '' }, { value: 'Stück', label: 'Stück' }, { value: 'Gramm', label: 'Gramm' }]);
  if (!unit) return null;
  setParts(item, per, unit); return partsOf(item);
}

async function bookParts(item, n) {
  const p = partsOf(item); if (!p || !(n > 0)) return;
  const left = partsLeft(item);
  if (n >= left) return ctx.store.consume(item.id, item.qty, 'eaten');
  await ctx.store.consume(item.id, +(n / p.per).toFixed(4), 'eaten');
}

// Zähler-Dialog. meal: 'bf' | 'din' | 'cook' | 'manual'; list: Artikel (leer = alle mit bekannten Teilen)
export async function openEaten(meal = 'manual', list = null, title = '') {
  const all = await ctx.store.listItems();
  const rows = (list ?? all.filter(i => i.qty > 0 && partsOf(i))).filter(i => i.qty > 0);
  const sub = { bf: 'Antippen, wie viel gegessen wurde. Die Packungen im Vorrat werden entsprechend kleiner.', din: 'Zum Beispiel Brot oder Beilagen. Gekochtes aus dem Plan buchst du dort mit „Gekocht“.',
    cook: 'Wie viel wurde verbraucht?', manual: 'Wie viel wurde entnommen?' }[meal];
  const heading = title || ({ bf: 'Was hast du gefrühstückt?', din: 'Was wurde zum Abendessen gegessen?' }[meal] ?? 'Teile entnehmen');
  const d = Object.assign(document.createElement('dialog'), { className: 'sheet' }); document.body.appendChild(d);
  const counts = {}; let result = 'later';
  const rowHtml = i => { const p = partsOf(i), n = counts[i.id] ?? 0;
    return `<li class="eat-row" data-id="${i.id}"><div class="eat-name"><b>${esc(i.name)}</b><small class="muted">noch ${partsLeft(i)} ${esc(p.unit)}${p.assumed ? ' (angenommen)' : ''}</small></div>
      <div class="eat-ctl"><button type="button" class="chip" data-d="-${p.step}" aria-label="weniger">−</button><b>${n} ${esc(p.unit === 'Gramm' ? 'g' : '')}</b><button type="button" class="chip" data-d="${p.step}" aria-label="mehr">＋</button>
      <button type="button" class="chip" data-d="all" title="Alles">Rest</button></div></li>`; };
  const fill = () => {
    d.innerHTML = `<div class="sheet-head"><button type="button" class="link" data-x="later">${meal === 'cook' || meal === 'manual' ? 'Abbrechen' : 'Später'}</button><b>${esc(heading)}</b><span></span></div>
      <p class="tiny muted">${sub}</p>
      <ul class="eat-list">${rows.map(rowHtml).join('') || '<li class="muted tiny">Noch keine Packung mit Teilmengen. Wähle unten eine aus.</li>'}</ul>
      <div class="tip-alts"><button type="button" class="chip" data-x="more">＋ Andere Packung</button></div>
      <menu class="stack"><button type="button" class="primary" data-x="book">✅ Buchen</button>${meal === 'bf' || meal === 'din' ? '<button type="button" data-x="none">Nichts davon / nicht gegessen</button>' : ''}</menu>`;
  };
  fill(); d.showModal();
  return new Promise(resolve => {
    const done = r => { d.close(); d.remove(); resolve(r); };
    d.addEventListener('cancel', () => done('later'));
    d.addEventListener('click', async e => {
      if (e.target === d) return;
      const b = e.target.closest('button'); if (!b) return;
      const row = b.closest('.eat-row');
      if (row) {
        const i = rows.find(x => x.id === row.dataset.id), p = partsOf(i), left = partsLeft(i);
        counts[i.id] = b.dataset.d === 'all' ? left : Math.max(0, Math.min(left, (counts[i.id] ?? 0) + +b.dataset.d)); return fill();
      }
      const x = b.dataset.x;
      if (x === 'later') return done('later');
      if (x === 'none') return done('none');
      if (x === 'more') {
        const rest = all.filter(i => i.qty > 0 && !i.frozenAt && i.category !== 'Reste' && !rows.some(r => r.id === i.id)).slice(0, 40);
        const id = await ctx.ask('Welche Packung?', 'Antippen, dann die Teile je Packung festlegen (einmalig).', [...rest.map(i => ({ value: i.id, label: i.name })), { value: '', label: 'Abbrechen' }].slice(0, 41));
        const it = rest.find(i => i.id === id); if (!it) return;
        if (!partsOf(it) && !(await configureParts(it))) return;
        rows.push(it); return fill();
      }
      if (x === 'book') {
        for (const i of rows) if (counts[i.id] > 0) await bookParts(i, counts[i.id]);
        await ctx.renderPantry(); document.dispatchEvent(new Event('pantry:changed'));
        return done(Object.values(counts).some(n => n > 0) ? 'booked' : 'none');
      }
    });
  });
}

// ---------- Nachfragen zu den Essenszeiten ----------
const MEALS = { bf: { on: 'askEatenBf', at: 'eatenBfTime' }, din: { on: 'askEatenDin', at: 'eatenDinTime' } };
const flag = (m, k) => `eaten.${k}.${m}`;
const due = m => { const s = ctx.getSettings(), c = MEALS[m]; return s.askEaten !== false && s[c.on] && ctx.nowHM() >= s[c.at] && localStorage.getItem(flag(m, 'asked')) !== isoLocal(); };
export const eatenPending = () => !!ctx && (due('bf') || due('din'));
async function check() {
  if (!ctx || document.querySelector('dialog[open]')) return;
  for (const m of ['bf', 'din']) {
    if (!due(m)) continue;
    const items = await ctx.store.listItems();
    if (!items.some(i => i.qty > 0 && partsOf(i))) { localStorage.setItem(flag(m, 'asked'), isoLocal()); continue; }
    if (document.hidden) {
      if (ctx.canNotify() && localStorage.getItem(flag(m, 'note')) !== isoLocal()) { localStorage.setItem(flag(m, 'note'), isoLocal()); ctx.showNote(m === 'bf' ? 'Was hast du gefrühstückt?' : 'Was wurde zum Abendessen gegessen?', 'Kurz antippen, dann stimmt der Vorrat.', 'gegessen-' + m); }
      return;
    }
    localStorage.setItem(flag(m, 'asked'), isoLocal());
    await openEaten(m);
    ctx.afterDinnerAsk?.();
    return;
  }
}
export function initEaten(c) {
  ctx = c;
  if (document.querySelector('script[src="demo.js"]')) return; // Demo: nur per Knopf
  setInterval(check, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  setTimeout(check, 3000);
}
