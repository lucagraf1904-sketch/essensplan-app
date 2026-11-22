// Datenhaltung. Aktuell lokal im Browser (localStorage).
// Die API ist absichtlich asynchron, damit später Supabase (geteilte Daten für zwei Handys)
// ohne Änderungen an app.js eingesetzt werden kann.
const KEY = 'speisekammer.v1';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? { items: [], log: [] }; }
  catch { return { items: [], log: [] }; }
}
function save(db) { localStorage.setItem(KEY, JSON.stringify(db)); }
const uid = () => crypto.randomUUID?.() ?? String(Date.now() + Math.random());

export const localStore = {
  mode: 'local',
  async init() { return { ready: true }; },
  onChange() {},
  async listItems() { return load().items; },

  async upsertItem(item) {
    const db = load();
    const noLog = item.noLog; delete item.noLog;
    if (!item.id) {
      item.id = uid();
      item.addedAt = new Date().toISOString();
      db.items.push(item);
      if (item.price && !noLog) db.log.push({ id: uid(), type: 'bought', itemName: item.name, category: item.category, qty: item.qty, unit: item.unit, size: item.size || null, price: item.price, at: item.addedAt });
    } else {
      const i = db.items.findIndex(x => x.id === item.id);
      if (i >= 0) db.items[i] = { ...db.items[i], ...item };
    }
    save(db);
    return item;
  },

  async deleteItem(id) {
    const db = load();
    db.items = db.items.filter(x => x.id !== id);
    save(db);
  },

  // type: 'eaten' | 'wasted'
  async consume(id, qty, type) {
    const db = load();
    const it = db.items.find(x => x.id === id);
    if (!it) return;
    const used = Math.min(qty, it.qty);
    const share = it.qty > 0 ? used / it.qty : 1;
    db.log.push({ id: uid(), type, itemName: it.name, category: it.category, qty: used, unit: it.unit, size: it.size || null,
                  value: it.price ? +(it.price * share).toFixed(2) : null, at: new Date().toISOString() });
    if (it.price) it.price = +(it.price * (1 - share)).toFixed(2);
    it.qty = +(it.qty - used).toFixed(3);
    if (it.qty <= 0) db.items = db.items.filter(x => x.id !== id);
    save(db);
  },

  async addLog(entry) {
    const db = load();
    db.log.push({ id: uid(), at: new Date().toISOString(), ...entry });
    save(db);
  },

  async listLog() { return load().log; },

  async getAliases() { return load().aliases ?? {}; },
  async setAlias(from, to) {
    const db = load();
    db.aliases = { ...(db.aliases ?? {}), [from]: to };
    // Ketten auflösen: wer bisher auf `from` zeigte, zeigt jetzt auf `to`
    for (const k in db.aliases) if (db.aliases[k] === from) db.aliases[k] = to;
    if (from === to) delete db.aliases[from];
    save(db);
  },

  async savePush() {}, // nur mit Supabase
  async listOffers() { return []; },
  async refreshOffers() { throw new Error('Automatische Angebote brauchen Supabase'); },

  async listHealth() { return null; }, // Bewegung nur mit Supabase
  async exportAll() { return load(); },
  async importAll(data) {
    if (!Array.isArray(data?.items) || !Array.isArray(data?.log)) throw new Error('Ungültige Datei');
    save(data);
  },
};
