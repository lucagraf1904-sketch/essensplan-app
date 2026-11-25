// Kategorien der Haushaltskasse. Oberkategorie (Gruppe) → Unterkategorien.
// Buchungen speichern die ID der Unterkategorie oder der Gruppe selbst (wenn keine Unterkategorie gewählt wurde).
// IDs nie umbenennen: sie stehen so in der Datenbank.

export const EXPENSE_GROUPS = [
  { id: 'lebensmittel', label: 'Lebensmittel', icon: '🛒', subs: [
    ['lm-supermarkt', 'Supermarkt'], ['lm-baecker', 'Bäcker & Metzger'], ['lm-getraenke', 'Getränke'], ['lm-markt', 'Wochenmarkt'], ['lm-lieferung', 'Lieferung'] ] },
  { id: 'wohnen', label: 'Wohnen', icon: '🏠', subs: [
    ['wo-miete', 'Miete'], ['wo-nebenkosten', 'Nebenkosten'], ['wo-strom', 'Strom'], ['wo-heizung', 'Gas & Heizung'], ['wo-internet', 'Internet & Festnetz'],
    ['wo-rundfunk', 'Rundfunkbeitrag'], ['wo-einrichtung', 'Einrichtung'], ['wo-reparatur', 'Reparaturen'] ] },
  { id: 'mobilitaet', label: 'Mobilität', icon: '🚗', subs: [
    ['mo-sprit', 'Sprit'], ['mo-laden', 'Laden (E-Auto)'], ['mo-oepnv', 'ÖPNV & Deutschlandticket'], ['mo-bahn', 'Bahn & Fernbus'], ['mo-werkstatt', 'Werkstatt & TÜV'],
    ['mo-steuer', 'Kfz-Steuer'], ['mo-parken', 'Parken & Maut'], ['mo-waesche', 'Autowäsche'], ['mo-taxi', 'Taxi & Sharing'], ['mo-fahrrad', 'Fahrrad'] ] },
  { id: 'versicherung', label: 'Versicherungen', icon: '🛡️', subs: [
    ['vers-kfz', 'Kfz-Versicherung'], ['vers-haftpflicht', 'Privathaftpflicht'], ['vers-hausrat', 'Hausrat'], ['vers-rechtsschutz', 'Rechtsschutz'],
    ['vers-bu', 'Berufsunfähigkeit'], ['vers-kranken', 'Kranken & Zusatz'], ['vers-zahn', 'Zahnzusatz'], ['vers-leben', 'Leben & Risikoleben'],
    ['vers-unfall', 'Unfall'], ['vers-reise', 'Reise & Auslandskranken'], ['vers-gebaeude', 'Wohngebäude'], ['vers-tier', 'Tierhalter'], ['vers-handy', 'Handy & Geräte'], ['vers-sonst', 'Sonstige Versicherung'] ] },
  { id: 'gesundheit', label: 'Gesundheit', icon: '💊', subs: [
    ['ge-apotheke', 'Apotheke'], ['ge-arzt', 'Arzt & Zuzahlung'], ['ge-brille', 'Brille & Kontaktlinsen'], ['ge-fitness', 'Fitnessstudio'], ['ge-therapie', 'Therapie & Physio'] ] },
  { id: 'haushalt', label: 'Drogerie & Haushalt', icon: '🧴', subs: [
    ['hh-drogerie', 'Drogerie'], ['hh-putz', 'Putzmittel'], ['hh-waren', 'Haushaltswaren'], ['hh-elektro', 'Elektronik'] ] },
  { id: 'essen', label: 'Essen gehen', icon: '🍽️', subs: [
    ['es-restaurant', 'Restaurant'], ['es-lieferdienst', 'Lieferdienst'], ['es-cafe', 'Café & Snacks'], ['es-mensa', 'Mensa & Kantine'], ['es-bar', 'Bar & Kneipe'] ] },
  { id: 'liebe', label: 'Dates & Geschenke', icon: '🎁', subs: [
    ['li-date', 'Dates'], ['li-geschenk', 'Geschenke'], ['li-feier', 'Feiern & Anlässe'], ['li-blumen', 'Blumen'], ['li-spende', 'Spenden'] ] },
  { id: 'freizeit', label: 'Freizeit', icon: '🎟️', subs: [
    ['fr-events', 'Kino, Konzert & Events'], ['fr-hobby', 'Hobbys'], ['fr-sport', 'Sport & Verein'], ['fr-ausflug', 'Ausflüge'], ['fr-buecher', 'Bücher & Spiele'] ] },
  { id: 'urlaub', label: 'Urlaub', icon: '🏖️', subs: [
    ['ur-reise', 'Anreise'], ['ur-unterkunft', 'Unterkunft'], ['ur-vorort', 'Vor Ort'] ] },
  { id: 'abos', label: 'Abos & Handy', icon: '📱', subs: [
    ['ab-handy', 'Handyvertrag'], ['ab-streaming', 'Streaming'], ['ab-musik', 'Musik'], ['ab-software', 'Software & Cloud'], ['ab-presse', 'Zeitung & Zeitschriften'], ['ab-gaming', 'Gaming'] ] },
  { id: 'kleidung', label: 'Kleidung & Pflege', icon: '👕', subs: [
    ['kl-kleidung', 'Kleidung'], ['kl-schuhe', 'Schuhe'], ['kl-friseur', 'Friseur'], ['kl-kosmetik', 'Kosmetik'] ] },
  { id: 'bildung', label: 'Bildung & Arbeit', icon: '🎓', subs: [
    ['bi-semester', 'Semesterbeitrag'], ['bi-material', 'Bücher & Material'], ['bi-kurse', 'Kurse'], ['bi-arbeit', 'Arbeitsmittel'] ] },
  { id: 'familie', label: 'Kinder & Haustiere', icon: '🐾', subs: [
    ['fa-kinder', 'Kinder'], ['fa-betreuung', 'Betreuung'], ['fa-tierfutter', 'Tierfutter'], ['fa-tierarzt', 'Tierarzt'] ] },
  { id: 'finanzen', label: 'Finanzen & Sparen', icon: '🏦', subs: [
    ['fi-sparen', 'Sparen & Rücklagen'], ['fi-anlage', 'Geldanlage (ETF)'], ['fi-kredit', 'Kredit & Raten'], ['fi-gebuehren', 'Kontogebühren'], ['fi-steuern', 'Steuern'], ['fi-bargeld', 'Bargeld'] ] },
  { id: 'sonstiges', label: 'Sonstiges', icon: '📦', subs: [] },
];

export const INCOME_GROUPS = [
  { id: 'einkommen', label: 'Einnahmen', icon: '💶', subs: [
    ['ei-gehalt', 'Gehalt'], ['ei-nebenjob', 'Nebenjob'], ['ei-bafoeg', 'BAföG & Stipendium'], ['ei-kindergeld', 'Kindergeld'], ['ei-erstattung', 'Erstattung'],
    ['ei-verkauf', 'Verkauf'], ['ei-geschenk', 'Geschenkt bekommen'], ['ei-zinsen', 'Zinsen & Dividenden'], ['ei-sonst', 'Sonstige Einnahme'] ] },
];

const ALL = [...EXPENSE_GROUPS, ...INCOME_GROUPS];
const index = new Map();
function reindex(custom = []) {
  index.clear();
  for (const g of ALL) {
    index.set(g.id, { id: g.id, label: g.label, icon: g.icon, group: g.id, isGroup: true });
    for (const [id, label] of g.subs) index.set(id, { id, label, icon: g.icon, group: g.id, isGroup: false });
  }
  // Umbuchung zwischen Konten: keine Ausgabe, keine Einnahme, daher in keiner Gruppe der Auswahl
  index.set('umbuchung', { id: 'umbuchung', label: 'Umbuchung', icon: '🔁', group: 'umbuchung', isGroup: true });
  for (const c of custom) if (c?.id && c?.label && index.has(c.group)) index.set(c.id, { id: c.id, label: c.label, icon: index.get(c.group).icon, group: c.group, isGroup: false, custom: true });
}
reindex();

// Eigene Unterkategorien aus den Einstellungen übernehmen
export function setCustomCategories(custom) { reindex(custom); }
export const customSubs = groupId => [...index.values()].filter(c => c.custom && c.group === groupId).map(c => [c.id, c.label]);

export const cat = id => index.get(id) ?? { id, label: id ? 'Unbekannt (' + id + ')' : 'Ohne Kategorie', icon: '❔', group: 'sonstiges', isGroup: false };
export const groupOf = id => cat(id).group;
export const group = gid => ALL.find(g => g.id === gid);
export const subsOf = gid => [...(group(gid)?.subs ?? []), ...customSubs(gid)];
export const catLabel = id => { const c = cat(id); return c.isGroup ? c.label : c.label; };
export const catPath = id => { const c = cat(id); return c.isGroup ? c.label : `${group(c.group)?.label ?? ''} · ${c.label}`; };
export const isInsurance = id => groupOf(id) === 'versicherung';
export const groupsFor = kind => kind === 'income' ? INCOME_GROUPS : EXPENSE_GROUPS;

// Beispielfragen je Versicherungsart für den Police-Chat
export const POLICY_QUESTIONS = {
  'vers-kfz': ['Ist Marderbiss abgedeckt?', 'Wie hoch ist meine Selbstbeteiligung?', 'Zahlt die Versicherung bei Glasbruch?', 'Bin ich im Ausland versichert?', 'Habe ich einen Schutzbrief?'],
  'vers-haftpflicht': ['Sind geliehene Sachen versichert?', 'Ist Schlüsselverlust abgedeckt?', 'Bin ich als Mieter für Schäden an der Wohnung versichert?', 'Wie hoch ist die Deckungssumme?'],
  'vers-hausrat': ['Ist Fahrraddiebstahl versichert?', 'Was gilt bei Einbruch?', 'Sind Überspannungsschäden durch Blitz abgedeckt?', 'Wie hoch ist die Versicherungssumme?'],
  'vers-rechtsschutz': ['Welche Bereiche sind versichert?', 'Gibt es eine Wartezeit?', 'Wie hoch ist die Selbstbeteiligung?'],
  'vers-reise': ['Ist ein Rücktransport versichert?', 'Wie lange darf eine Reise dauern?', 'Gilt der Schutz weltweit?'],
  'vers-bu': ['Ab wann gelte ich als berufsunfähig?', 'Wie hoch ist die Rente?', 'Verzichtet der Versicherer auf abstrakte Verweisung?'],
  'ei-gehalt': ['Wie viele Urlaubstage habe ich?', 'Wie lang ist meine Kündigungsfrist?', 'Wie viele Stunden muss ich pro Woche arbeiten?', 'Gibt es Weihnachts- oder Urlaubsgeld?', 'Sind Überstunden mit dem Gehalt abgegolten?', 'Wie lange ist die Probezeit?'],
  'ei-nebenjob': ['Wie viele Stunden darf ich arbeiten?', 'Wie lang ist die Kündigungsfrist?', 'Bekomme ich bezahlten Urlaub?'],
  'wo-miete': ['Wie lang ist meine Kündigungsfrist?', 'Darf ich Haustiere halten?', 'Wer zahlt Schönheitsreparaturen?', 'Wie hoch ist die Kaution?', 'Darf ich untervermieten?'],
  'ab-handy': ['Wann kann ich kündigen?', 'Wie viel Datenvolumen habe ich?', 'Was kostet Roaming im Ausland?'],
  'wo-strom': ['Wann kann ich kündigen?', 'Gibt es eine Preisgarantie?', 'Wie hoch ist der Arbeitspreis pro kWh?'],
  default: ['Was ist versichert?', 'Was ist ausgeschlossen?', 'Wie hoch ist die Selbstbeteiligung?', 'Wie kann ich kündigen?'],
  defaultContract: ['Wie kann ich kündigen?', 'Wie lange läuft der Vertrag?', 'Was kostet der Vertrag?'],
};

// Vertragsarten im Bereich „Verträge“ (gespeichert wird nur die Kategorie, daraus ergibt sich die Art)
export const CONTRACT_TYPES = [
  { id: 'ins', label: 'Versicherungen', icon: '🛡️', cats: EXPENSE_GROUPS.find(g => g.id === 'versicherung').subs,
    provider: 'Versicherer', amount: 'Beitrag (€)', next: 'Nächste Abbuchung', number: 'Versicherungsnummer', doc: 'Police', freq: 'yearly', notice: 1 },
  { id: 'work', label: 'Arbeit', icon: '💼', income: true, cats: [['ei-gehalt', 'Arbeitsvertrag'], ['ei-nebenjob', 'Nebenjob / Minijob']],
    provider: 'Arbeitgeber', amount: 'Nettogehalt (€)', next: 'Nächster Zahltag', number: 'Personalnummer', doc: 'Vertrag', freq: 'monthly', notice: null, private: true },
  { id: 'home', label: 'Wohnen & Energie', icon: '🏠', cats: [['wo-miete', 'Mietvertrag'], ['wo-strom', 'Stromvertrag'], ['wo-heizung', 'Gas & Heizung'], ['wo-internet', 'Internet & Festnetz']],
    provider: 'Vermieter / Anbieter', amount: 'Kosten (€)', next: 'Nächste Abbuchung', number: 'Vertrags- oder Kundennummer', doc: 'Vertrag', freq: 'monthly', notice: null },
  { id: 'subs', label: 'Handy & Abos', icon: '📱', cats: [['ab-handy', 'Handyvertrag'], ['ab-streaming', 'Streaming'], ['ab-software', 'Software & Cloud'], ['ge-fitness', 'Fitnessstudio'], ['ab-presse', 'Zeitung & Zeitschriften']],
    provider: 'Anbieter', amount: 'Kosten (€)', next: 'Nächste Abbuchung', number: 'Kundennummer', doc: 'Vertrag', freq: 'monthly', notice: 1 },
  { id: 'other', label: 'Sonstige Verträge', icon: '📄', cats: [['fi-kredit', 'Kredit & Raten'], ['sonstiges', 'Sonstiger Vertrag']],
    provider: 'Vertragspartner', amount: 'Kosten (€)', next: 'Nächste Abbuchung', number: 'Vertragsnummer', doc: 'Vertrag', freq: 'monthly', notice: null },
];
export const contractType = category => CONTRACT_TYPES.find(t => t.cats.some(([id]) => id === category)) ?? (groupOf(category) === 'versicherung' ? CONTRACT_TYPES[0] : CONTRACT_TYPES[4]);
export const contractLabel = category => contractType(category).cats.find(([id]) => id === category)?.[1] ?? cat(category).label;
