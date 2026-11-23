// Gemeinsame Datenhaltung über Supabase. Gleiche API wie localStore in store.js.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

let household = null;

const toItem = r => ({ id: r.id, name: r.name, size: r.size ?? '', qty: +r.qty, unit: r.unit, category: r.category, location: r.location,
  expiry: r.expiry ?? '', price: r.price == null ? null : +r.price, addedAt: r.added_at,
  frozenAt: r.frozen_at ?? null, origExpiry: r.orig_expiry ?? null, barcode: r.barcode ?? null, nutrition: r.nutrition ?? null,
  pack: r.pack ?? null, openedAt: r.opened_at ?? null });
const toLog = r => ({ id: r.id, type: r.type, itemName: r.item_name, category: r.category, qty: r.qty == null ? null : +r.qty,
  unit: r.unit, size: r.size, price: r.price == null ? null : +r.price, value: r.value == null ? null : +r.value, kcal: r.kcal ?? null, at: r.at });
const fromLog = e => ({ household_id: household.id, type: e.type, item_name: e.itemName, category: e.category,
  qty: e.qty, unit: e.unit, size: e.size || null, price: e.price ?? null, value: e.value ?? null, kcal: e.kcal ?? null, ...(e.at ? { at: e.at } : {}) });
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

export const supabaseStore = {
  mode: 'supabase',

  // Rückgabe: { ready } | { needsLogin } | { needsHousehold }
  async init() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return { needsLogin: true };
    // Zuerst nur die Mitgliedschaft, dann den Haushalt getrennt (der verschachtelte Abruf lieferte bei Luca 23.11. nichts)
    const m = await sb.from('members').select('household_id').eq('user_id', session.user.id).maybeSingle();
    if (m.error) throw new Error('Mitgliedschaft lesen: ' + m.error.message);
    if (!m.data) return { needsHousehold: true };
    const h = await sb.from('households').select('*').eq('id', m.data.household_id).maybeSingle();
    if (h.error) throw new Error('Haushalt lesen: ' + h.error.message);
    if (!h.data) throw new Error('Mitglied in Haushalt ' + m.data.household_id + ', aber der Haushalt ist nicht lesbar (Zugriffsregeln, schema.sql erneut ausführen).');
    household = h.data;
    return { ready: true };
  },

  // Login per 6-stelligem Code aus der E-Mail (funktioniert auch in der installierten Homebildschirm-App,
  // wo ein Magic Link in Safari statt in der App landen würde).
  async sendCode(email) { must(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })); },
  async verifyCode(email, token) { must(await sb.auth.verifyOtp({ email, token, type: 'email' })); },
  // Login mit E-Mail + Passwort (ohne Mail; in Supabase „Confirm email“ ausschalten)
  async signIn(email, password) { must(await sb.auth.signInWithPassword({ email, password })); },
  async signUp(email, password) {
    const data = must(await sb.auth.signUp({ email, password }));
    if (!data.session) throw new Error('Konto angelegt, aber Supabase verlangt eine Bestätigungs-Mail. In Supabase unter Authentication → Sign In / Providers → Email „Confirm email“ ausschalten, dann „Anmelden“.');
  },
  async signOut() { await sb.auth.signOut(); },

  async createHousehold(name) { household = must(await sb.rpc('create_household', { p_name: name || 'Unser Haushalt' })); },
  async joinHousehold(code) { household = must(await sb.rpc('join_household', { p_code: code })); },
  household: () => household,

  onChange(cb) {
    sb.channel('hh-' + household.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items', filter: `household_id=eq.${household.id}` }, cb)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'log', filter: `household_id=eq.${household.id}` }, cb)
      .subscribe();
  },

  // Essensplan: Abendessen in meal_plan spiegeln (für die Push-Erinnerung der Edge Function „reminders“)
  async savePlanRows(days) {
    const rows = days.filter(d => d.title).map(d => ({ household_id: household.id, date: d.date, meal: 'dinner', title: d.title, method: d.method || null,
      total_minutes: d.minutes || null, status: d.status === 'gekocht' || d.status === 'uebersprungen' ? d.status : 'geplant' }));
    if (rows.length) must(await sb.from('meal_plan').upsert(rows, { onConflict: 'household_id,date,meal' }));
  },
  // Rezept per Link (Edge Function „recipe-import“, im Dashboard unter dem technischen Namen „smooth-worker“ angelegt liest die Seite und deren Rezept-Daten nach schema.org)
  async importRecipe(url) {
    const { data, error } = await sb.functions.invoke('smooth-worker', { body: { url } });
    if (error) {
      // Bei Statusfehlern steckt die eigentliche Meldung der Funktion im Response-Objekt
      let msg = error.message; const r = error.context, st = r?.status ? ` (Status ${r.status})` : '';
      try { const t = await r.clone().text(); try { const j = JSON.parse(t); msg = j.error ?? j.message ?? t; } catch { msg = t || msg; } } catch { /* Antwort nicht lesbar */ }
      msg = `${String(msg).slice(0, 300)}${st} [v37]`;
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  },

  // KI (Edge Function „ai“): Text, Gericht anpassen, Foto einlesen. Gesundheitsangaben nur, wenn body.health gesetzt ist (pro Anfrage angetippt).
  async askAi(body) {
    const { data, error } = await sb.functions.invoke('ai', { body });
    if (error) {
      let msg = error.message;
      let detail = '';
      try { const t = await error.context.clone().text(); try { const j = JSON.parse(t); msg = j.error ?? j.message ?? t; detail = j.detail ?? ''; } catch { msg = t || msg; } } catch { /* Antwort nicht lesbar */ }
      throw Object.assign(new Error(String(msg).slice(0, 300)), { detail: String(detail).slice(0, 500) });
    }
    if (data?.error) throw Object.assign(new Error(data.error), { detail: data.detail ?? '' });
    return data;
  },

  // Gemeinsame und persönliche Schlüssel-Werte (shared.js)
  async listShared() { return must(await sb.from('household_data').select('key, value')); },
  async getShared(key) { const r = must(await sb.from('household_data').select('value').eq('key', key).maybeSingle()); return r?.value ?? null; },
  async setShared(key, value) { must(await sb.from('household_data').upsert({ household_id: household.id, key, value, updated_at: new Date().toISOString() })); },
  async mergeList(key, items) { return must(await sb.rpc('merge_list', { p_key: key, p_items: items })); },
  async listMine() { return must(await sb.from('member_data').select('key, value')); },
  async setMine(key, value) { must(await sb.from('member_data').upsert({ key, value, updated_at: new Date().toISOString() })); },
  onShared(cb) {
    sb.channel('kv-' + household.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'household_data', filter: `household_id=eq.${household.id}` }, p => p.new?.key && cb('hh', p.new.key, p.new.value))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_data' }, p => p.new?.key && cb('me', p.new.key, p.new.value))
      .subscribe();
  },

  async listItems() { return must(await sb.from('items').select('*')).map(toItem); },

  async upsertItem(item) {
    const row = { name: item.name, size: item.size || null, qty: item.qty, unit: item.unit, category: item.category, location: item.location,
                  expiry: item.expiry || null, price: item.price ?? null, frozen_at: item.frozenAt || null, orig_expiry: item.origExpiry || null,
                  barcode: item.barcode || null, nutrition: item.nutrition || null, pack: item.pack || null, opened_at: item.openedAt || null };
    if (item.id) {
      must(await sb.from('items').update(row).eq('id', item.id));
      return item;
    }
    const saved = must(await sb.from('items').insert({ ...row, household_id: household.id }).select().single());
    if (item.price && !item.noLog) await this.addLog({ type: 'bought', itemName: item.name, category: item.category, qty: item.qty, unit: item.unit, size: item.size, price: item.price });
    return toItem(saved);
  },

  async deleteItem(id) { must(await sb.from('items').delete().eq('id', id)); },

  async consume(id, qty, type) { must(await sb.rpc('consume_item', { p_id: id, p_qty: qty, p_type: type })); },

  async addLog(entry) { must(await sb.from('log').insert(fromLog(entry))); },

  async listLog() { return must(await sb.from('log').select('*').order('at', { ascending: false }).limit(1000)).map(toLog); },

  async getAliases() {
    return Object.fromEntries(must(await sb.from('aliases').select('from_key,to_key')).map(r => [r.from_key, r.to_key]));
  },
  async setAlias(from, to) {
    if (from === to) { must(await sb.from('aliases').delete().eq('from_key', from)); return; }
    must(await sb.from('aliases').upsert({ household_id: household.id, from_key: from, to_key: to }, { onConflict: 'household_id,from_key' }));
    must(await sb.from('aliases').update({ to_key: to }).eq('to_key', from));
  },

  // Push-Abo samt Erinnerungszeiten speichern (eine Zeile pro Gerät, Schlüssel = endpoint)
  async savePush(sub, prefs) {
    must(await sb.from('push_subscriptions').upsert({
      household_id: household.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, tz: prefs.tz,
      remind_expiry: prefs.remindExpiry, expiry_time: prefs.expiryTime, remind_dinner: prefs.remindDinner,
      dinner_time: prefs.dinnerTime, dinner_auto: prefs.dinnerAuto, dinner_at: prefs.dinnerAt, warn_days: prefs.warnDays,
      ask_eaten_bf: prefs.askEatenBf !== false, eaten_bf_time: prefs.eatenBfTime || '12:45', ask_eaten_din: prefs.askEatenDin !== false, eaten_din_time: prefs.eatenDinTime || '18:30',
    }, { onConflict: 'endpoint' }));
  },

  // Angebote aus der Tabelle offers (automatisch über Edge Function „offers“)
  async listOffers() {
    const rows = must(await sb.from('offers').select('*').or(`valid_to.is.null,valid_to.gte.${new Date().toISOString()}`));
    return rows.map(r => ({ id: r.id, chain: r.chain, name: r.name, description: r.description, price: +r.price,
      regular: r.old_price == null ? null : +r.old_price, until: r.valid_to ? r.valid_to.slice(0, 10) : null,
      unitPrice: r.reference_price && r.unit ? { value: +r.reference_price, per: r.unit } : null, loyalty: r.loyalty, source: r.source }));
  },
  async refreshOffers(terms) {
    const { data, error } = await sb.functions.invoke('offers', { body: { terms } });
    if (error) throw new Error(error.message);
    return data;
  },

  // Bewegung aus Apple Health (Kurzbefehl → Edge Function health-ingest). Vorbereitet, siehe KURZBEFEHL.md.
  async listHealth(fromIso) {
    const [rows, people] = await Promise.all([
      sb.from('health_daily').select('user_id, date, steps, active_kcal, updated_at').gte('date', fromIso).order('date'),
      sb.rpc('health_people'),
    ]);
    const { data: { session } } = await sb.auth.getSession();
    return { me: session?.user.id, people: must(people), days: must(rows) };
  },
  async healthToken() { return must(await sb.from('health_tokens').select('label, share_household, last_used_at').maybeSingle()); },
  async createHealthToken(label) { return must(await sb.rpc('create_health_token', { p_label: label })); },
  async setHealthShare(on) { must(await sb.from('health_tokens').update({ share_household: on }).not('user_id', 'is', null)); },
  healthUrl: () => SUPABASE_URL + '/functions/v1/health-ingest',

  async exportAll() { return { items: await this.listItems(), log: await this.listLog() }; },

  // Import ergänzt (überschreibt nicht), damit lokale Daten in den Haushalt übernommen werden können.
  async importAll(data) {
    if (!Array.isArray(data?.items) || !Array.isArray(data?.log)) throw new Error('Ungültige Datei');
    if (data.items.length) must(await sb.from('items').insert(data.items.map(i => ({
      household_id: household.id, name: i.name, size: i.size || null, qty: i.qty, unit: i.unit, category: i.category, location: i.location,
      expiry: i.expiry || null, price: i.price ?? null, frozen_at: i.frozenAt || null, orig_expiry: i.origExpiry || null, barcode: i.barcode || null, nutrition: i.nutrition || null, pack: i.pack || null, opened_at: i.openedAt || null }))));
    if (data.log.length) must(await sb.from('log').insert(data.log.map(fromLog)));
  },
};
