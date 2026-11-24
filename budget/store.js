// Datenhaltung der Haushaltskasse. Zwei Varianten mit gleicher Schnittstelle:
//   supabaseStore: gemeinsamer Haushalt über Supabase (gleiche Anmeldung und gleicher Haushalt wie die Speisekammer)
//   demoStore:     nur auf diesem Gerät (localStorage) mit Beispieldaten, zum Ausprobieren ohne Konto
// Beträge sind in der App Cent (ganze Zahl), in der Datenbank numeric(12,2) in Euro.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { toCents, fromCents, todayIso, addDays, addMonths, nthDue, bookDueLocal, nextFrom } from './logic.js';

const uid = () => crypto.randomUUID?.() ?? 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2);

const toTx = r => ({ id: r.id, date: r.date, amount: toCents(r.amount), kind: r.kind, category: r.category, note: r.note ?? '', source: r.source,
  recurringId: r.recurring_id ?? null, dueDate: r.due_date ?? null, createdBy: r.created_by ?? null, createdAt: r.created_at, potId: r.pot_id ?? null, extRef: r.ext_ref ?? null, owner: r.owner ?? null, accountId: r.account_id ?? null });
const fromTx = (t, hh) => ({ id: t.id, household_id: hh, date: t.date, amount: fromCents(t.amount), kind: t.kind, category: t.category, note: t.note || null,
  source: t.source || 'manual', pot_id: t.potId || null, ext_ref: t.extRef || null, owner: t.owner || null, account_id: t.accountId || null, ...(t.recurringId !== undefined ? { recurring_id: t.recurringId } : {}), ...(t.dueDate !== undefined ? { due_date: t.dueDate } : {}) });
const toRec = r => ({ id: r.id, name: r.name, amount: toCents(r.amount), kind: r.kind, category: r.category, freq: r.freq, startDate: r.start_date, nextDue: r.next_due,
  n: r.n, endDate: r.end_date ?? null, contractEnd: r.contract_end ?? null, noticeMonths: r.notice_months ?? null, active: r.active, policyId: r.policy_id ?? null, note: r.note ?? '', potId: r.pot_id ?? null, owner: r.owner ?? null, accountId: r.account_id ?? null, cashId: r.cash_id ?? null });
const fromRec = (r, hh) => ({ id: r.id, household_id: hh, name: r.name, amount: fromCents(r.amount), kind: r.kind, category: r.category, freq: r.freq, start_date: r.startDate,
  next_due: r.nextDue, n: r.n ?? 0, end_date: r.endDate || null, contract_end: r.contractEnd || null, notice_months: r.noticeMonths ?? null, active: r.active !== false,
  policy_id: r.policyId || null, note: r.note || null, pot_id: r.potId || null, owner: r.owner || null, account_id: r.accountId || null, cash_id: r.cashId || null });
const toPot = r => ({ id: r.id, name: r.name, icon: r.icon || '🐷', goal: r.goal == null ? null : toCents(r.goal), targetDate: r.target_date ?? null,
  startBalance: toCents(r.start_balance) ?? 0, autoRest: !!r.auto_rest, archived: !!r.archived, owner: r.owner ?? null,
  kind: r.kind || 'pot', isin: r.isin ?? '', marketValue: r.market_value == null ? null : toCents(r.market_value), marketValueAt: r.market_value_at ?? null });
const fromPot = (p, hh) => ({ id: p.id, household_id: hh, name: p.name, icon: p.icon || '🐷', goal: p.goal ? fromCents(p.goal) : null, target_date: p.targetDate || null,
  start_balance: fromCents(p.startBalance ?? 0), auto_rest: !!p.autoRest, archived: !!p.archived, owner: p.owner || null,
  kind: p.kind || 'pot', isin: p.isin || null, market_value: p.marketValue == null ? null : fromCents(p.marketValue), market_value_at: p.marketValueAt || null });
const DEFAULT_SHARE = { tx: 'none', fixed: 'none', pots: 'none', policies: 'none', contracts: 'none' };
const toMember = r => ({ userId: r.user_id, displayName: r.display_name || '', share: { ...DEFAULT_SHARE, ...(r.share ?? {}) }, defaultPrivate: !!r.default_private });
const toAcc = r => ({ id: r.id, name: r.name, owner: r.owner ?? null, icon: r.icon || '💳', archived: !!r.archived });
// Summen-Zeilen (Freigabe „nur Summen“) in Cent
const toSum = r => ({ owner: r.owner, area: r.area, month: r.month, kind: r.kind, category: r.category, total: toCents(r.total) });
const toCash = r => ({ id: r.id, name: r.name, icon: r.icon || '💶', amount: toCents(r.amount), category: r.category, owner: r.owner ?? null, active: r.active !== false, potId: r.pot_id ?? null,
  freq: r.freq || 'monthly', startMonth: r.start_month ?? null, withdrawDay: r.withdraw_day ?? null, overrides: Object.fromEntries(Object.entries(r.overrides ?? {}).map(([k, v]) => [k, toCents(v)])) });
const toPol = r => ({ id: r.id, name: r.name, category: r.category, insurer: r.insurer ?? '', policyNo: r.policy_no ?? '', contractEnd: r.contract_end ?? null,
  noticeMonths: r.notice_months ?? null, notes: r.notes ?? '', filePath: r.file_path ?? null, fileName: r.file_name ?? null,
  pageCount: r.page_count ?? (Array.isArray(r.pages) ? r.pages.length : 0), pages: Array.isArray(r.pages) ? r.pages : null, textSource: r.text_source ?? null, owner: r.owner ?? null });
const fromPol = (p, hh) => ({ id: p.id, household_id: hh, name: p.name, category: p.category, insurer: p.insurer || null, policy_no: p.policyNo || null,
  contract_end: p.contractEnd || null, notice_months: p.noticeMonths ?? null, notes: p.notes || null, owner: p.owner || null });

// Fehlermeldung einer Edge Function lesbar machen
async function fnError(error) {
  let msg = error.message, detail = '';
  try { const t = await error.context.clone().text(); try { const j = JSON.parse(t); msg = j.error ?? j.message ?? t; detail = j.detail ?? ''; } catch { msg = t || msg; } } catch { /* nicht lesbar */ }
  return Object.assign(new Error(String(msg).slice(0, 300)), { detail: String(detail).slice(0, 500) });
}
const friendly = e => {
  const m = String(e?.message ?? e);
  if (/row-level security/i.test(m)) return Object.assign(new Error('Das geht nicht: Der Eintrag gehört jemand anderem oder ist inzwischen privat. Die Ansicht wird neu geladen.'), { stale: true });
  if (/relation .*budget_|budget_book_due|schema cache/i.test(m)) return new Error('Die Datenbank für die Haushaltskasse ist noch nicht eingerichtet: supabase/budget.sql im Supabase SQL Editor ausführen (siehe anleitung/budget-setup.md).');
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return Object.assign(new Error('Keine Verbindung zum Server.'), { offline: true });
  return e instanceof Error ? e : new Error(m);
};

const POL_COLS = 'id,name,category,insurer,policy_no,contract_end,notice_months,notes,file_path,file_name,text_source,page_count,owner';

export async function createSupabaseStore() {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  let household = null, userId = null, userEmail = '';
  const must = ({ data, error }) => { if (error) throw friendly(error); return data; };
  const must0 = r => { if (r.error) throw friendly(r.error); return r.count; };
  // 0 gelöschte Zeilen: Eintrag gehört jemand anderem oder ist schon weg
  const gone = n => { if (n === 0) throw new Error('Nicht gelöscht: Der Eintrag gehört jemand anderem oder wurde schon gelöscht.'); };
  const hh = () => household.id;

  return {
    mode: 'supabase',
    async init() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return { needsLogin: true };
      userId = session.user.id; userEmail = session.user.email ?? '';
      const m = await sb.from('members').select('household_id').eq('user_id', userId).maybeSingle();
      if (m.error) throw friendly(m.error);
      if (!m.data) return { needsHousehold: true };
      const h = await sb.from('households').select('*').eq('id', m.data.household_id).maybeSingle();
      if (h.error) throw friendly(h.error);
      if (!h.data) throw new Error('Der Haushalt ist nicht lesbar (Zugriffsregeln). supabase/schema.sql erneut ausführen.');
      household = h.data;
      return { ready: true };
    },
    me: () => userId,
    // Vorschlag für den Anzeigenamen: Teil der E-Mail vor dem @, ohne Ziffern
    suggestedName: () => { const n = userEmail.split('@')[0].replace(/[._\d-]+/g, ' ').trim().split(' ')[0] || 'Ich'; return n[0].toUpperCase() + n.slice(1); },
    household: () => household,
    // Offline-Start aus dem letzten Stand: Haushalt setzen, damit Buchungen in die Warteschlange können
    useOffline(h) { household = h; },
    async sendCode(email) { must(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })); },
    async verifyCode(email, token) { must(await sb.auth.verifyOtp({ email, token, type: 'email' })); },
    async signIn(email, password) { must(await sb.auth.signInWithPassword({ email, password })); },
    async signUp(email, password) {
      const data = must(await sb.auth.signUp({ email, password }));
      if (!data.session) throw new Error('Konto angelegt, Supabase verlangt aber eine Bestätigungs-Mail. Mail bestätigen und dann anmelden.');
    },
    async signOut() { await sb.auth.signOut(); },
    async createHousehold(name) { household = must(await sb.rpc('create_household', { p_name: name || 'Unser Haushalt' })); },
    async joinHousehold(code) { household = must(await sb.rpc('join_household', { p_code: code })); },

    async listTx(since) {
      const out = []; let from = 0;
      for (;;) { // in Seiten zu 1000 lesen (Grenze von Supabase je Abfrage)
        const rows = must(await sb.from('budget_tx').select('*').gte('date', since).order('date', { ascending: false }).order('created_at', { ascending: false }).range(from, from + 999));
        out.push(...rows.map(toTx)); if (rows.length < 1000) break; from += 1000;
      }
      return out;
    },
    async saveTx(t) {
      const row = fromTx({ ...t, id: t.id ?? uid() }, hh());
      const r = await sb.from('budget_tx').upsert(row).select().single();
      // Monatsrest oder Speisekammer-Einkauf schon übernommen (z. B. vom anderen Handy): kein Fehler, nur Hinweis
      if (r.error && /budget_tx_ext_ref/i.test(r.error.message)) throw Object.assign(new Error('Wurde schon übernommen.'), { duplicate: true });
      return toTx(must(r));
    },
    // Alle Buchungen mit Spartopf (für den Stand, unabhängig vom Zeitraum)
    async listPotTx() { return must(await sb.from('budget_tx').select('id,date,amount,kind,category,note,source,pot_id,ext_ref,recurring_id,created_at,owner,account_id').not('pot_id', 'is', null).order('date', { ascending: false }).limit(10000)).map(toTx); },
    async listPots() { return must(await sb.from('budget_pots').select('*').order('created_at')).map(toPot); },
    async savePot(p) {
      // Erst den Topf speichern (ohne Monatsrest), dann die anderen abschalten, dann hier einschalten.
      // So bleibt bei einem Fehler der bisherige Topf mit Monatsrest erhalten (nur einer darf ihn haben).
      const id = p.id ?? uid();
      let row = must(await sb.from('budget_pots').upsert(fromPot({ ...p, id, autoRest: false }, hh())).select().single());
      if (p.autoRest) {
        const q = sb.from('budget_pots').update({ auto_rest: false }).eq('auto_rest', true).neq('id', id);
        must(await (p.owner ? q.eq('owner', p.owner) : q.is('owner', null)));
        row = must(await sb.from('budget_pots').update({ auto_rest: true }).eq('id', id).select().single());
      }
      return toPot(row);
    },
    async deletePot(id) {
      const r = await sb.from('budget_pots').delete().eq('id', id);
      if (r.error && /foreign key|budget_tx_pot_id_fkey/i.test(r.error.message)) throw new Error('Der Topf hat inzwischen Buchungen (vielleicht vom anderen Handy) und kann nur aufgelöst werden. Bitte neu öffnen.');
      must(r);
    },
    // Personen im Haushalt mit Namen und Freigaben
    async listMembers() { return must(await sb.from('budget_members').select('*')).map(toMember); },
    async saveMe(m) {
      return toMember(must(await sb.from('budget_members').upsert({ user_id: userId, household_id: hh(), display_name: m.displayName || null,
        share: { ...DEFAULT_SHARE, ...(m.share ?? {}) }, default_private: !!m.defaultPrivate, updated_at: new Date().toISOString() }).select().single()));
    },
    // Wer ist im Haushalt (auch ohne Eintrag in budget_members)? Mitglieder-Tabelle der Speisekammer
    async memberIds() { return must(await sb.from('members').select('user_id')).map(r => r.user_id); },
    async listAccounts() { return must(await sb.from('budget_accounts').select('*').order('created_at')).map(toAcc); },
    async saveAccount(a) {
      const r = await sb.from('budget_accounts').upsert({ id: a.id ?? uid(), household_id: hh(), name: a.name, owner: a.owner || null, icon: a.icon || '💳', archived: !!a.archived }).select().single();
      if (r.error && /budget_accounts_name|duplicate key/i.test(r.error.message)) throw Object.assign(new Error('Ein Konto mit diesem Namen gibt es schon.'), { duplicate: true });
      return toAcc(must(r));
    },
    async listCash() { return must(await sb.from('budget_cash').select('*').order('created_at')).map(toCash); },
    async saveCash(e) { return toCash(must(await sb.from('budget_cash').upsert({ id: e.id ?? uid(), household_id: hh(), name: e.name, icon: e.icon || '💶', amount: fromCents(e.amount), category: e.category, owner: e.owner || null, active: e.active !== false, pot_id: e.potId || null, freq: e.freq || 'monthly', start_month: e.startMonth || null, withdraw_day: e.withdrawDay ?? null,
      overrides: Object.fromEntries(Object.entries(e.overrides ?? {}).map(([k, v]) => [k, fromCents(v)])), updated_at: new Date().toISOString() }).select().single())); },
    async deleteCash(id) { must(await sb.from('budget_cash').delete().eq('id', id)); },
    async sharedSums(sinceIso) { return must(await sb.rpc('budget_shared_sums', { p_since: sinceIso })).map(toSum); },
    // Einkäufe aus der Speisekammer (Tabelle log, Art 'bought', mit Preis)
    async listPantryPurchases(sinceIso) {
      const rows = must(await sb.from('log').select('id,item_name,category,price,at,by_user').eq('type', 'bought').not('price', 'is', null).gte('at', sinceIso).order('at').limit(2000));
      return rows.map(r => ({ id: r.id, name: r.item_name, category: r.category, price: toCents(r.price), at: r.at, by: r.by_user }));
    },
    async deleteTx(id) { gone(must0(await sb.from('budget_tx').delete({ count: 'exact' }).eq('id', id))); },

    async listRecurring() { return must(await sb.from('budget_recurring').select('*').order('name')).map(toRec); },
    async saveRecurring(r) { return toRec(must(await sb.from('budget_recurring').upsert(fromRec({ ...r, id: r.id ?? uid() }, hh())).select().single())); },
    async deleteRecurring(id) { gone(must0(await sb.from('budget_recurring').delete({ count: 'exact' }).eq('id', id))); },
    async bookDue() { return must(await sb.rpc('budget_book_due')); },

    // Liste ohne Seitentexte (die können groß sein), Seitenzahl wird mitgeliefert
    async listPolicies() {
      return must(await sb.from('budget_policies').select(POL_COLS).order('name')).map(toPol);
    },
    async policyPages(id) { const r = must(await sb.from('budget_policies').select('pages').eq('id', id).single()); return Array.isArray(r.pages) ? r.pages : []; },
    async savePolicy(p) { return toPol(must(await sb.from('budget_policies').upsert(fromPol({ ...p, id: p.id ?? uid() }, hh())).select(POL_COLS).single())); },
    async savePolicyPages(id, pages, source) { must(await sb.from('budget_policies').update({ pages, text_source: source }).eq('id', id)); },
    async uploadPolicyFile(id, file) {
      const safe = file.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-80) || 'police.pdf';
      const path = `${hh()}/${id}/${Date.now()}-${safe}`;
      must(await sb.storage.from('budget-policies').upload(path, file, { contentType: file.type || 'application/pdf', upsert: false }));
      const old = must(await sb.from('budget_policies').select('file_path').eq('id', id).single())?.file_path;
      must(await sb.from('budget_policies').update({ file_path: path, file_name: file.name.slice(0, 120) }).eq('id', id));
      if (old && old !== path) await sb.storage.from('budget-policies').remove([old]);
      return path;
    },
    async policyFileUrl(path) { return must(await sb.storage.from('budget-policies').createSignedUrl(path, 600)).signedUrl; },
    async deletePolicy(p) {
      // Erst die Datei (Storage erlaubt das nur bei eigener oder gemeinsamer Police), dann die Zeile (0 Zeilen = nicht erlaubt)
      if (p.filePath) await sb.storage.from('budget-policies').remove([p.filePath]);
      gone(must0(await sb.from('budget_policies').delete({ count: 'exact' }).eq('id', p.id)));
    },

    async getConfig() { const r = must(await sb.from('budget_settings').select('value').maybeSingle()); return r?.value ?? {}; },
    async setConfig(value) { must(await sb.from('budget_settings').upsert({ household_id: hh(), value, updated_at: new Date().toISOString() })); },

    async askAi(body) {
      const { data, error } = await sb.functions.invoke('ai', { body });
      if (error) throw await fnError(error);
      if (data?.error) throw Object.assign(new Error(data.error), { detail: data.detail ?? '' });
      return data;
    },

    onChange(cb) {
      const f = `household_id=eq.${hh()}`;
      sb.channel('budget-' + hh())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_tx', filter: f }, () => cb('tx'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_recurring', filter: f }, () => cb('recurring'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_policies', filter: f }, () => cb('policies'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_settings', filter: f }, () => cb('config'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_pots', filter: f }, () => cb('pots'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_members', filter: f }, () => cb('members'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_accounts', filter: f }, () => cb('accounts'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_cash', filter: f }, () => cb('cash'))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'log', filter: f }, () => cb('pantry'))
        .subscribe();
    },
  };
}

// ---------- Demo: nur dieses Gerät, mit Beispieldaten ----------
const DEMO_KEY = 'haushaltskasse.demo';
const DEMO_POLICY = [
  `Versicherungsschein Kfz-Versicherung\nVersicherungsnehmer: Max Muster\nFahrzeug: VW Golf, amtl. Kennzeichen M-XY 123\nVersicherungsbeginn: 01.01.2026, Ablauf: 01.01.2027, Hauptfälligkeit 01.01. Der Vertrag verlängert sich jeweils um ein Jahr, wenn er nicht spätestens einen Monat vor Ablauf gekündigt wird.\nUmfang: Kfz-Haftpflicht (Deckungssumme 100 Mio. EUR pauschal, je Person höchstens 15 Mio. EUR), Vollkasko mit 300 EUR Selbstbeteiligung, Teilkasko mit 150 EUR Selbstbeteiligung. Schutzbrief: nicht vereinbart.\nJahresbeitrag: 486,00 EUR, Zahlungsweise jährlich.`,
  `A.2.2 Teilkasko – welche Ereignisse sind versichert?\nA.2.2.1 Brand und Explosion. A.2.2.2 Entwendung: Versichert ist die Entwendung, insbesondere durch Diebstahl und Raub. A.2.2.3 Sturm, Hagel, Blitzschlag, Überschwemmung.\nA.2.2.4 Zusammenstoß mit Tieren: Versichert ist der Zusammenstoß des in Bewegung befindlichen Fahrzeugs mit Tieren aller Art.\nA.2.2.5 Glasbruch: Versichert sind Bruchschäden an der Verglasung des Fahrzeugs. Bei Reparatur statt Austausch der Scheibe entfällt die Selbstbeteiligung.\nA.2.2.6 Tierbiss: Versichert sind Schäden an Kabeln, Schläuchen und Leitungen durch Tierbiss, z. B. Marderbiss. Folgeschäden sind bis 3.000 EUR mitversichert.`,
  `A.2.3 Vollkasko: Versichert sind zusätzlich Unfallschäden am Fahrzeug sowie mut- oder böswillige Handlungen fremder Personen (Vandalismus).\nA.2.4 Geltungsbereich: Versicherungsschutz besteht in den geografischen Grenzen Europas sowie den außereuropäischen Gebieten, die zum Geltungsbereich der Europäischen Union gehören.\nA.2.9 Nicht versichert sind Schäden, die durch Rennen entstehen, sowie Schäden durch Abnutzung, Bremsvorgänge und reine Betriebsschäden. Bei grob fahrlässiger Herbeiführung des Schadens verzichten wir auf den Einwand der groben Fahrlässigkeit, außer bei Entwendung und bei Fahren unter Alkohol- oder Drogeneinfluss.`,
];
function demoSeed() {
  const t = todayIso(), m0 = t.slice(0, 7) + '-01';
  const tx = [], rec = [];
  const ME = 'demo', LEA = 'lea';
  const acc = { me: uid(), lea: uid(), joint: uid() };
  const accounts = [{ id: acc.me, name: 'Konto Alex', owner: ME, icon: '💳', archived: false }, { id: acc.lea, name: 'Konto Lea', owner: LEA, icon: '💳', archived: false },
    { id: acc.joint, name: 'Gemeinschaftskonto', owner: null, icon: '🏦', archived: false }];
  const members = [{ userId: ME, displayName: 'Alex', share: { tx: 'none', fixed: 'none', pots: 'none', policies: 'none' }, defaultPrivate: false },
    { userId: LEA, displayName: 'Lea', share: { tx: 'sums', fixed: 'sums', pots: 'sums', policies: 'none' }, defaultPrivate: true }];
  const mine = { owner: ME, accountId: acc.me }, joint = { owner: null, accountId: acc.joint };
  const add = (date, amount, category, note, kind = 'expense', extra = {}) => tx.push({ id: uid(), date, amount, kind, category, note, source: 'manual', recurringId: null, dueDate: null, createdAt: new Date().toISOString(), ...extra });
  const r = (name, amount, category, freq, startDate, extra = {}) => rec.push({ id: uid(), name, amount, kind: 'expense', category, freq, startDate, nextDue: startDate, n: 0, endDate: null, contractEnd: null, noticeMonths: null, active: true, policyId: null, note: '', ...extra });
  const polId = uid();
  // Fixkosten seit vier Monaten (werden beim Start automatisch gebucht)
  const s = addMonths(m0, -4);
  r('Gehalt', 265000, 'ei-gehalt', 'monthly', addDays(addMonths(s, 1), -3), { kind: 'income', ...mine });
  r('Miete warm', 98000, 'wo-miete', 'monthly', s, joint);
  r('Strom', 6500, 'wo-strom', 'monthly', addDays(s, 14), joint);
  r('Internet', 3999, 'wo-internet', 'monthly', addDays(s, 4), joint);
  r('Handyvertrag', 1499, 'ab-handy', 'monthly', addDays(s, 9), mine);
  r('Streaming', 1399, 'ab-streaming', 'monthly', addDays(s, 19), mine);
  r('Deutschlandticket', 5800, 'mo-oepnv', 'monthly', s, mine);
  r('Fitnessstudio', 2990, 'ge-fitness', 'monthly', addDays(s, 1), { contractEnd: addMonths(m0, 3), noticeMonths: 1, ...mine });
  r('Privathaftpflicht', 6890, 'vers-haftpflicht', 'yearly', addMonths(m0, 2), { contractEnd: addMonths(m0, 2), noticeMonths: 1, ...joint });
  r('Autoversicherung Golf', 48600, 'vers-kfz', 'yearly', `${+t.slice(0, 4) + 1}-01-01`, { contractEnd: `${+t.slice(0, 4) + 1}-01-01`, noticeMonths: 1, policyId: polId, ...mine });
  r('Rundfunkbeitrag', 5508, 'wo-rundfunk', 'quarterly', addDays(s, 14), joint);
  // Alltagsausgaben der letzten Monate
  // Wer zahlt was: Einkauf vom Gemeinschaftskonto, Sprit und Café privat, Essen gehen gemeinsam von meinem Konto
  const how = { Rewe: joint, Lidl: joint, 'Bäckerei': joint, dm: joint, Aral: mine, 'Café': mine, 'Geburtstagsgeschenk': mine, Pizzeria: { owner: null, accountId: acc.me }, 'Kino und Essen': { owner: null, accountId: acc.me } };
  const daily = [['lm-supermarkt', 'Rewe', 3400, 7], ['lm-supermarkt', 'Lidl', 2800, 5], ['lm-baecker', 'Bäckerei', 650, 3], ['mo-sprit', 'Aral', 6200, 9],
    ['es-restaurant', 'Pizzeria', 3800, 11], ['li-date', 'Kino und Essen', 5400, 14], ['hh-drogerie', 'dm', 2100, 10], ['es-cafe', 'Café', 900, 6], ['li-geschenk', 'Geburtstagsgeschenk', 3500, 30]];
  for (let back = 4; back >= 0; back--) {
    const ms = addMonths(m0, -back);
    for (const [cat, note, amt, every] of daily) {
      for (let d = (note.length * 3) % every; d < 28; d += every) {
        const date = addDays(ms, d); if (date > t) continue;
        add(date, Math.round(amt * (0.7 + ((d * 7 + back * 13 + note.length) % 10) / 16)), cat, note, 'expense', how[note] ?? {});
      }
    }
  }
  const pol = [{ id: polId, name: 'Autoversicherung Golf', category: 'vers-kfz', insurer: 'Muster Versicherung AG', policyNo: 'KF-123456', contractEnd: `${+t.slice(0, 4) + 1}-01-01`,
    noticeMonths: 1, owner: ME, notes: 'Vollkasko 300 € SB, Teilkasko 150 € SB', filePath: null, fileName: 'Beispielpolice (Demo).pdf', pages: DEMO_POLICY, pageCount: DEMO_POLICY.length, textSource: 'manual' }];
  // Spartöpfe: Urlaub mit Ziel und Sparrate, Notgroschen ohne Ziel
  const urlaub = uid(), notgroschen = uid();
  const pots = [
    { id: urlaub, name: 'Urlaub', icon: '🏖️', goal: 150000, targetDate: `${+t.slice(0, 4) + 1}-07-01`, startBalance: 20000, autoRest: false, archived: false, owner: null },
    { id: notgroschen, name: 'Notgroschen', icon: '🛟', goal: null, targetDate: null, startBalance: 100000, autoRest: true, archived: false, owner: ME },
  ];
  r('Sparrate Urlaub', 10000, 'fi-sparen', 'monthly', addDays(s, 2), { kind: 'save', potId: urlaub, owner: null, accountId: acc.joint });
  // ETF mit Sparplan: eingezahlt zählt die App, den Depotwert trägt man selbst ein
  const etf = uid();
  pots.push({ id: etf, name: 'MSCI World', icon: '🌍', kind: 'etf', isin: 'IE00B4L5Y983', goal: null, targetDate: null, startBalance: 320000, autoRest: false, archived: false, owner: ME,
    marketValue: 431000, marketValueAt: addDays(t, -6) });
  r('Sparplan MSCI World', 15000, 'fi-anlage', 'monthly', addDays(s, 1), { kind: 'save', potId: etf, owner: ME, accountId: acc.me });
  // Einkäufe, die in der Speisekammer per Bon erfasst wurden (zum Übernehmen)
  const at = (daysBack, h) => { const d = new Date(); d.setDate(d.getDate() - daysBack); d.setHours(h, 12, 0, 0); return d.toISOString(); };
  const pantry = [['Milch', 119, 1], ['Haferflocken', 89, 1], ['Hähnchenbrust', 699, 1], ['Paprika', 249, 1], ['Joghurt', 179, 1], ['Spülmittel', 195, 1, 'Haushalt'], ['Nudeln', 99, 3], ['Tomaten', 229, 3], ['Parmesan', 349, 3]]
    .map(([name, price, back, category], i) => ({ id: uid(), name, price, category: category ?? 'Sonstiges', at: at(back, 17), by: 'demo', i }));
  const config = { limits: { lebensmittel: 45000, essen: 12000, liebe: 15000, mobilitaet: 20000, haushalt: 5000 }, custom: [], pantrySince: addDays(t, -14) };
  // Lea gibt nur Summen frei: diese Zeilen liefert der Server in echt per budget_shared_sums
  const sums = [];
  for (let back = 3; back >= 0; back--) {
    const mk = addMonths(m0, -back).slice(0, 7);
    sums.push({ owner: LEA, area: 'tx', month: mk, kind: 'expense', category: 'kl-kleidung', total: 6000 + back * 1500 }, { owner: LEA, area: 'tx', month: mk, kind: 'expense', category: 'es-cafe', total: 2400 },
      { owner: LEA, area: 'tx', month: mk, kind: 'income', category: 'ei-gehalt', total: 210000 });
  }
  sums.push({ owner: LEA, area: 'potbal', total: 240000 }, { owner: LEA, area: 'fixed', kind: 'expense', total: 8900 });
  const cash = [{ id: uid(), name: 'Wochenmarkt', icon: '🥕', amount: 6000, category: 'lm-markt', owner: null, active: true },
    { id: uid(), name: 'Friseur', icon: '💇', amount: 2500, category: 'kl-friseur', owner: ME, active: true, freq: 'quarterly', startMonth: t.slice(0, 7), withdrawDay: 3, overrides: {} },
    { id: uid(), name: 'Kleinkram', icon: '🪙', amount: 4000, category: 'sonstiges', owner: ME, active: true }];
  // Rücklage für Versicherungen: monatlich bar zurücklegen, am Zahltag wird es aus dem Umschlag genommen
  const resPot = uid(), resEnv = uid();
  pots.push({ id: resPot, name: 'Umschlag Rücklage Versicherungen', icon: '🛡️', kind: 'reserve', goal: null, targetDate: null, startBalance: 32000, autoRest: false, archived: false, owner: ME });
  cash.push({ id: resEnv, name: 'Rücklage Versicherungen', icon: '🛡️', amount: 5000, category: 'versicherung', owner: ME, active: true, potId: resPot, freq: 'monthly', startMonth: t.slice(0, 7), withdrawDay: 1, overrides: { [addMonths(m0, 1).slice(0, 7)]: 8000 } });
  for (const x of rec) if (x.name === 'Autoversicherung Golf' && x.owner === ME) x.cashId = resEnv; // gleicher Besitzer wie der Umschlag
  return { tx, rec, pol, config, pots, pantry, accounts, members, sums, cash, files: {} };
}

export function createDemoStore() {
  let db = null;
  const load = () => { if (db) return db; try { db = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch { db = null; } if (!db?.tx || !db.pots || !db.accounts) { db = demoSeed(); save(); } else if (!db.cash || !db.pots.some(p => p.kind === 'etf') || !db.pots.some(p => p.kind === 'reserve')) { const fresh = demoSeed(); db.cash ??= fresh.cash; if (!db.pots.some(p => p.kind === 'etf')) { const etf = fresh.pots.find(p => p.kind === 'etf'); db.pots.push(etf); db.rec.push({ ...fresh.rec.find(r => r.potId === etf.id), accountId: db.accounts.find(a => a.owner === 'demo')?.id ?? null }); }
      if (!db.pots.some(p => p.kind === 'reserve')) { const rp = fresh.pots.find(p => p.kind === 'reserve'), re = fresh.cash.find(e => e.potId === rp.id); db.pots.push(rp); if (!db.cash.some(e => e.id === re.id)) db.cash.push(re);
        for (const x of db.rec) if (x.name === 'Autoversicherung Golf' && x.owner === 'demo') x.cashId = re.id; }
      save(); } return db; };
  const save = () => { try { const { files, ...rest } = db; localStorage.setItem(DEMO_KEY, JSON.stringify(rest)); } catch (e) { console.warn('Demo-Speicher voll', e); } };
  const files = new Map(); // hochgeladene Dateien nur für diese Sitzung (localStorage ist zu klein für PDFs)
  const delay = v => new Promise(r => setTimeout(() => r(v), 20));
  return {
    mode: 'demo',
    async init() { load(); return { ready: true }; },
    me: () => 'demo',
    household: () => ({ name: 'Demo-Haushalt', join_code: 'DEMO00' }),
    suggestedName: () => 'Alex',
    async listMembers() { return delay(load().members.map(m => structuredClone(m))); },
    async saveMe(m) { const d = load(); const i = d.members.findIndex(x => x.userId === 'demo'); const row = { userId: 'demo', ...m }; if (i >= 0) d.members[i] = row; else d.members.push(row); save(); return structuredClone(row); },
    async memberIds() { return load().members.map(m => m.userId); },
    async listAccounts() { return delay(load().accounts.map(a => ({ ...a }))); },
    async saveAccount(a) { const d = load(); if (d.accounts.some(x => x.name === a.name && x.owner === (a.owner ?? null) && x.id !== a.id)) throw Object.assign(new Error('Ein Konto mit diesem Namen gibt es schon.'), { duplicate: true });
      const row = { icon: '💳', archived: false, ...a, id: a.id ?? uid(), owner: a.owner ?? null }; const i = d.accounts.findIndex(x => x.id === row.id); if (i >= 0) d.accounts[i] = row; else d.accounts.push(row); save(); return { ...row }; },
    async listCash() { return delay(load().cash.map(e => ({ ...e }))); },
    async saveCash(e) { const d = load(); const row = { icon: '💶', active: true, ...e, id: e.id ?? uid(), owner: e.owner ?? null }; const i = d.cash.findIndex(x => x.id === row.id); if (i >= 0) d.cash[i] = row; else d.cash.push(row); save(); return { ...row }; },
    async deleteCash(id) { const d = load(); d.cash = d.cash.filter(e => e.id !== id); save(); },
    async sharedSums(since) { return delay(load().sums.filter(x => !x.month || x.month >= since.slice(0, 7)).map(x => ({ ...x }))); },
    async signOut() { localStorage.removeItem(DEMO_KEY); db = null; },
    reset() { localStorage.removeItem(DEMO_KEY); db = null; },
    async listPotTx() { return delay(load().tx.filter(t => t.potId).sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt))).map(t => ({ ...t }))); },
    async listPots() { return delay((load().pots ?? []).map(p => ({ ...p }))); },
    async savePot(p) { const d = load(); d.pots ??= []; const row = { startBalance: 0, archived: false, ...p, id: p.id ?? uid() };
      if (row.autoRest) d.pots.forEach(x => { if (x.id !== row.id && (x.owner ?? null) === (row.owner ?? null)) x.autoRest = false; });
      const i = d.pots.findIndex(x => x.id === row.id); if (i >= 0) d.pots[i] = row; else d.pots.push(row); save(); return { ...row }; },
    async deletePot(id) { const d = load(); if (d.tx.some(t => t.potId === id)) throw new Error('Der Topf hat Buchungen und kann nur aufgelöst werden.'); d.pots = d.pots.filter(p => p.id !== id); d.rec = d.rec.filter(r => r.potId !== id); save(); },
    async listPantryPurchases(since) { return delay((load().pantry ?? []).filter(r => r.at >= since).map(r => ({ ...r }))); },
    async listTx(since) { return delay(load().tx.filter(t => t.date >= since).sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt))).map(t => ({ ...t }))); },
    async saveTx(t) { const d = load();
      if (t.extRef && d.tx.some(x => x.extRef === t.extRef && x.id !== t.id)) throw Object.assign(new Error('Wurde schon übernommen.'), { duplicate: true });
      const row = { createdAt: new Date().toISOString(), source: 'manual', recurringId: null, dueDate: null, ...t, id: t.id ?? uid() };
      const i = d.tx.findIndex(x => x.id === row.id); if (i >= 0) d.tx[i] = { ...d.tx[i], ...row }; else d.tx.push(row); save(); return delay({ ...row }); },
    async deleteTx(id) { const d = load(); d.tx = d.tx.filter(t => t.id !== id); save(); },
    async listRecurring() { return delay(load().rec.map(r => ({ ...r })).sort((a, b) => a.name.localeCompare(b.name))); },
    async saveRecurring(r) { const d = load(); const row = { n: 0, active: true, ...r, id: r.id ?? uid() }; const i = d.rec.findIndex(x => x.id === row.id);
      if (i >= 0) d.rec[i] = row; else d.rec.push(row); save(); return delay({ ...row }); },
    async deleteRecurring(id) { const d = load(); d.rec = d.rec.filter(r => r.id !== id); d.tx.forEach(t => { if (t.recurringId === id) t.recurringId = null; }); save(); },
    async bookDue() {
      const d = load(), keys = new Set(d.tx.filter(t => t.recurringId).map(t => t.recurringId + '|' + t.dueDate));
      const add = bookDueLocal(d.rec, todayIso(), keys);
      for (const t of add) {
        d.tx.push({ id: uid(), createdAt: new Date().toISOString(), ...t });
        // Aus Rücklage-Umschlag bezahlt: gleichen Betrag aus dem Umschlag nehmen
        const r = d.rec.find(x => x.id === t.recurringId), env = r?.cashId && d.cash.find(e => e.id === r.cashId), pot = env?.potId && d.pots.find(p => p.id === env.potId && !p.archived);
        const ref = `cover:${r?.id}:${t.date}`;
        if (pot && r.kind === 'expense' && !d.tx.some(x => x.extRef === ref)) d.tx.push({ id: uid(), createdAt: new Date().toISOString(), date: t.date, amount: t.amount, kind: 'unsave', category: 'fi-sparen', note: `Aus Umschlag: ${r.name}`, source: 'recurring', potId: pot.id, owner: pot.owner ?? null, extRef: ref, recurringId: null, dueDate: null });
      }
      save(); return add.length;
    },
    async listPolicies() { return delay(load().pol.map(p => ({ ...p, pages: null, pageCount: p.pages?.length ?? 0 }))); },
    async policyPages(id) { return load().pol.find(p => p.id === id)?.pages ?? []; },
    async savePolicy(input) { const { pages: _p, pageCount: _c, ...p } = input; const d = load(); const i = d.pol.findIndex(x => x.id === p.id); const row = { ...(i >= 0 ? d.pol[i] : {}), ...p, id: p.id ?? uid() };
      delete row.pageCount; if (i >= 0) d.pol[i] = row; else d.pol.push(row); save(); return { ...row, pages: null, pageCount: row.pages?.length ?? 0 }; },
    async savePolicyPages(id, pages, source) { const p = load().pol.find(x => x.id === id); if (p) { p.pages = pages; p.textSource = source; save(); } },
    async uploadPolicyFile(id, file) { const p = load().pol.find(x => x.id === id); const path = 'demo/' + id + '/' + file.name; files.set(path, file); if (p) { p.filePath = path; p.fileName = file.name; save(); } return path; },
    async policyFileUrl(path) { const f = files.get(path); if (!f) throw new Error('In der Demo bleiben hochgeladene Dateien nur bis zum Neuladen erhalten. Der ausgelesene Text ist aber gespeichert.'); return URL.createObjectURL(f); },
    async deletePolicy(p) { const d = load(); d.pol = d.pol.filter(x => x.id !== p.id); d.rec.forEach(r => { if (r.policyId === p.id) r.policyId = null; }); save(); },
    async getConfig() { return structuredClone(load().config ?? {}); },
    async setConfig(v) { load().config = structuredClone(v); save(); },
    async askAi() { throw Object.assign(new Error('In der Demo ist keine KI verbunden.'), { demo: true }); },
    onChange() {},
  };
}

// Für Tests und das Formular: nächste Fälligkeit aus Startdatum
export { nextFrom, nthDue };
