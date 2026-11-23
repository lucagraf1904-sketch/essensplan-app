// Einkaufs-Tipps. Grundlage: Recherche „Mehlarten und Morbus-Crohn-Vorbeugung“ (Crohn-Bezüge nur über extra.crohn) (Projektordner
// recherche/reports, Nov. 2026) mit Quellen u. a. Verbraucherzentrale Thüringen, Leitsätze für Brot,
// Zimmermann et al. 2022, Ghazvini et al. 2025, Ananthakrishnan et al. 2013, Narula et al. 2021, AWMF S3 073-027.
// Fleisch/Fisch: Recherche „Fleischarten und Gesundheit“ (Nov. 2026; u. a. IARC, Lescinsky et al. 2022, Jayedi et al. 2018,
// Neuenschwander et al. 2023, BZfE, BfR). Reihenfolge der Regeln zählt: erste passende gewinnt.
// Obst/Gemüse: Recherche „Obst und Gemüse Gesundheit“ (Nov. 2026). Dort als „nicht geprüft“ markierte Tipps
// (Senfsaat auf Brokkoli, Lagerung von Beeren/Salat/Tomaten) sind weggelassen; „Ableitung“ ist im Text gekennzeichnet.
// Keine ärztliche Beratung. Neue Themen (Fleisch, mehr Obst/Gemüse) kommen mit den weiteren Recherchen.
//
// Regel: { topic, match, title, text, alts?, good?, details?, extra? }
//   topic: Schaltername aus settings.js; alts: Ersatzvorschläge zum Antippen; good: positive Bestätigung.
//   text: NEUTRAL, für jeden passend (Luca 22.11.2026). extra: { <Profil-Schlüssel>: Zusatzsatz } erscheint nur,
//   wenn in Einstellungen → Gesundheit & Vorlieben der Punkt gewählt ist (settings.health / settings.prefs).
import { getSettings } from './settings.js';
import { conditionTags } from './conditions.js';

export const SOURCE = 'Recherchen zu Mehl und Brot, Fleisch und Fisch, Obst und Gemüse sowie „Übermäßiger Verzehr“, Stand 23.11.2026 (nachgeprüft). Keine ärztliche Beratung.';

// Abgleich mit der Nachprüfung vom 23.11.2026 (recherche/reports, Abschnitte „Korrekturen“ und Abschnitt 11):
// more = Zeilen unter „Mehr dazu“ (für alle sichtbar, immer mit Arztzeile). Krankheitsbezüge nur in extra/more, nie im Kurztext.
export const ARZT = 'Bei Vorerkrankungen, in Schwangerschaft/Stillzeit oder bei regelmäßiger Medikamenteneinnahme ärztlich oder in der Apotheke abklären.';
const GICHT = 'Gicht: Fleisch und Meeresfrüchte sind in Studien mit mehr Gicht verbunden, Milchprodukte mit weniger. Bei Gicht oder hoher Harnsäure Fleisch und Schalentiere eher selten (Choi 2004).';
const GICHT_DRINK = 'Gicht: Bei Gicht oder hoher Harnsäure Zuckergetränke, Saft, Bier, Spirituosen, Innereien und Schalentiere eher selten. Milchprodukte sind in Studien günstig.';
const VITK = 'Vitamin K aus grünem Gemüse kann die Wirkung von Gerinnungshemmern vom Typ Vitamin-K-Antagonist (z. B. Phenprocoumon) abschwächen. Laut Fachinformation ist vor allem eine plötzliche Umstellung der Ernährung wichtig, also gleichmäßig essen statt meiden. Wer solche Mittel nimmt und viel an der Ernährung ändern möchte, klärt das bitte vorher ärztlich oder in der Apotheke.';
const GRAPE = 'Grapefruit, Pomelo, Limette und Bitterorange (z. B. in Orangenmarmelade) können die Wirkung mancher Medikamente verstärken, etwa bestimmter Cholesterinsenker, Blutdruckmittel, Herzrhythmusmittel und Mittel nach Transplantation. Schon kleine Mengen können reichen. Ob das eigene Medikament betroffen ist, steht im Beipackzettel oder lässt sich in der Apotheke klären (Bailey 2013).';
const CROHN_ARZT = ' Allgemeine Information, keine persönliche Beratung; bitte ärztlich besprechen.';

// Gewählte Profilpunkte (Gesundheit + Vorlieben) als Set
function profileKeys() { const s = getSettings(); return new Set([...conditionTags(s.health ?? []), ...(s.prefs ?? [])]); }
function compose(r, keys) {
  if (!r) return null;
  const extras = Object.entries(r.extra ?? {}).filter(([k]) => keys.has(k)).map(([, t]) => t);
  return { ...r, text: [r.text, ...extras].filter(Boolean).join(' ') };
}

const BREAD_CHECK = [
  '„Vollkorn“ steht im Namen (Vollkornbrot = mind. 90 % Vollkorn).',
  'Erste Zutat: Roggen- oder Vollkornmehl bzw. Vollkornschrot.',
  'Sauerteig steht in der Zutatenliste.',
  'Kein Zuckerrüben-, Malz- oder Karamellsirup und kein Röstmalz (macht nur dunkel).',
];

const RULES = [
  // ---- Fleisch & Fisch: zuerst die Problemfälle ----
  { topic: 'tipsMeat', match: /(gemischt|halb.?(und|&|\/).?halb|cevapcici|ćevapčići|br[äa]t\b|bratwurstbr|hacksteak|gew[üu]rzt.*hack|hack.*gew[üu]rzt)/i,
    title: 'Lieber reines, mageres Hack',
    text: 'Reines Rinderhack mit wenig Fett ist die bessere Wahl und lässt sich gut einfrieren. Fertige Cevapcici und Brät zählen als verarbeitetes Fleisch.',
    extra: { keinSchwein: 'Gemischtes Hack enthält Schweinefleisch.' }, more: [GICHT], doc: true,
    alts: ['Rinderhack (mager)'] },
  { topic: 'tipsMeat', match: /(fischst[äa]bchen|backfisch|paniert)/i,
    title: 'Panierter oder frittierter Fisch',
    text: 'Als Ausnahme okay. Besser: Fisch backen, dämpfen oder in Folie garen. TK-Fisch ist gleichwertig.',
    alts: ['Seelachsfilet (TK)', 'Lachsfilet (TK)'] },
  { topic: 'tipsMeat', match: /(thunfisch|schwertfisch|hecht|heilbutt|rotbarsch)/i,
    title: 'Große Raubfische selten',
    text: 'Fisch ist eine gute Wahl. Thunfisch, Schwertfisch, Hecht, Heilbutt und Rotbarsch enthalten mehr Quecksilber, daher lieber abwechseln: Lachs, Hering, Makrele, Seelachs oder Forelle.',
    extra: { schwanger: 'In der Schwangerschaft und Stillzeit ganz meiden.' }, more: [GICHT], doc: true,
    alts: ['Lachsfilet', 'Hering', 'Seelachsfilet'] },
  { topic: 'tipsMeat', match: /(fisch[öo]l|omega.?3.?(kapsel|caps))/i,
    title: 'Fischöl-Kapseln',
    text: 'Fisch auf dem Teller ist die erste Wahl. Für Herz und Kreislauf ist der Nutzen von Kapseln bei Gesunden nicht belegt; in einer großen Studie gab es weniger Autoimmunerkrankungen.',
    more: ['Wer Gerinnungshemmer nimmt, bespricht hochdosierte Fischöl-Präparate bitte in der Apotheke (Vorsichtshinweis, keine belegte Wechselwirkung).'], doc: true,
    alts: ['Lachsfilet', 'Hering'] },

  // ---- Obst & Gemüse: Problemfälle ----
  { topic: 'tipsProduce', match: /(gem[üu]sechips|rote.?bete.?chips|s[üu]ßkartoffel.?chips)/i,
    title: 'Gemüsechips',
    text: 'Gemüsechips enthalten viel Acrylamid. Als Snack lieber rohes Gemüse.',
    alts: ['Möhren', 'Kohlrabi'] },
  { topic: 'tipsProduce', match: /(saft|smoothie|nektar)/i,
    title: 'Saft zählt nicht als Obst',
    text: 'Ganzes Obst zählt als Portion, Saft und Smoothie nicht. Saft als Schorle (1 Teil Saft, 3 Teile Wasser) spart Zucker; ganzes Obst sättigt mehr.',
    extra: { crohn: 'Der Nutzen beim Crohn-Risiko hängt am ganzen Obst.' + CROHN_ARZT, diabetes: 'Saft lässt den Blutzucker schnell steigen.' },
    more: [GICHT_DRINK], doc: true,
    alts: ['Äpfel', 'Orangen'] },
  { topic: 'tipsProduce', match: /(obstkonserve|fruchtcocktail|kompott|(pfirsich|ananas|mandarin|birne|aprikose)\w*.*(dose|konserve)|(dose|konserve).*(pfirsich|ananas|mandarin|birne|aprikose))/i,
    title: 'Obstkonserven',
    text: 'Obstkonserven schnitten in einer großen Studie ungünstig ab. Wenn, dann ohne Zuckerzusatz (abgeleitet, nicht direkt belegt). Frisches oder TK-Obst ist besser.',
    alts: ['TK-Beeren', 'Äpfel'] },
  { topic: 'tipsProduce', match: /(curcumin|kurkuma.?kaps|sulforaphan|polyphenol|vitamin.?kaps|obst.?kaps|gem[üu]se.?kaps)/i,
    title: 'Kapseln statt Obst und Gemüse',
    text: 'Curcumin-, Sulforaphan- oder Polyphenol-Kapseln ersetzen kein Obst und Gemüse.' },

  // ---- Fertigprodukte & Wurst (vor den positiven Regeln, damit „Rindswurst“ nicht als gute Wahl gilt) ----
  { topic: 'tipsProcessed', match: /(salami|wurst|schinken|speck|bacon|leberkäse|wiener|mortadella|aufschnitt|lyoner|chorizo)/i,
    title: 'Wurst ist verarbeitetes Fleisch',
    text: 'Abwechslung aufs Brot: Frischkäse mit Kräutern, Hummus, Ei, Tomate-Mozzarella. Wurst bleibt dabei, nur nicht jeden Tag. Auch „nitritfrei“ und Geflügelwurst zählen als verarbeitetes Fleisch.',
    more: ['Verarbeitetes Fleisch ist laut IARC (Gruppe 1) mit Darmkrebs verbunden. Grob gerechnet geht täglich 50 g mit einem Lebenszeitrisiko von etwa 79 statt 67 je 1000 Männer und etwa 62 statt 53 je 1000 Frauen einher (eigene Rechnung des Berichts mit deutschen Ausgangswerten, Näherung).', GICHT], doc: true,
    alts: ['Hummus', 'Nüsse', 'Eier'] },
  { topic: 'tipsProcessed', match: /(fertiggericht|tiefkühlpizza|pizza|instant|nudelsnack|chips|softdrink|cola|limo)/i,
    title: 'Stark verarbeitet',
    text: 'Als Ausnahme okay. Schnelle Alternative: am Wochenende einmal doppelt kochen und portionsweise einfrieren. Das ist euer eigenes Fertiggericht.',
    extra: { crohn: 'Viele stark verarbeitete Lebensmittel gingen in Beobachtungsstudien mit mehr Morbus Crohn einher (Zusammenhang, Evidenz niedrig).' + CROHN_ARZT } },

  // ---- positiv ----
  { topic: 'tipsBread', good: true, match: /(roggen.*vollkorn|vollkorn.*roggen|pumpernickel|roggenvollkorn)/i,
    title: 'Gute Wahl', text: 'Roggen-Vollkorn: viele Ballaststoffe, sättigt lange.',
    extra: { diabetes: 'Flachere Blutzucker- und Insulinantwort als helles Brot.', wenigWeizen: 'Enthält keinen Weizen.' } },
  { topic: 'tipsBread', good: true, match: /(haferflocken|hafer)/i,
    title: 'Gute Wahl', text: 'Hafer: Beta-Glucan senkt das LDL-Cholesterin. Mit frischem Obst ein gutes kaltes Frühstück.',
    extra: { wenigWeizen: 'Hafer ist kein Weizen.' } },
  { topic: 'tipsMeat', good: true, match: /(lachs|hering|makrele|forelle|kabeljau|seelachs|dorsch|sardine|scholle)/i,
    title: 'Gute Wahl', text: 'Fisch 1–2× pro Woche schneidet am besten ab. Fetter Fisch liefert Omega-3, magerer Seefisch Jod.', more: [GICHT], doc: true },
  { topic: 'tipsMeat', good: true, match: /(rinderhack|rind|reh|hirsch|wildschwein|wild\b)/i,
    title: 'Gute Wahl', text: 'Mageres Rind oder Wild in Maßen: viel Eisen, Zink und B12.', more: [GICHT], doc: true },
  { topic: 'tipsMeat', match: /(h[äa]hnchen|haehnchen|huhn|pute|geflügel|chicken)/i,
    title: 'Geflügel: gut, aber nährstoffarm',
    text: 'Geflügel ist gesundheitlich neutral, hat aber wenig Eisen, Zink und B12. Etwa einmal pro Woche Rind oder Wild dazu. Beim Zubereiten: durchgaren, eigenes Schneidebrett, Hände waschen.',
    alts: ['Rinderhack (mager)', 'Rindergulasch'], add: true, more: [GICHT], doc: true },
  { topic: 'tipsProduce', good: true, match: /(apfel|äpfel|birne)/i,
    text: 'Waschen statt schälen, die Schale liefert Ballaststoffe.',
    extra: { crohn: 'Ganzes Obst hat beim Crohn-Risiko das deutlichste Schutzsignal.' + CROHN_ARZT } },
  { topic: 'tipsProduce', good: true, match: /banane/i,
    text: 'Ganzes Obst zählt zu den zwei Portionen Obst am Tag.',
    extra: { crohn: 'Ganzes Obst hat beim Crohn-Risiko das deutlichste Schutzsignal.' + CROHN_ARZT } },
  { topic: 'tipsProduce', match: /(grapefruit|pampelmuse|pomelo|bitterorange|orangenmarmelade|sevilla)/i,
    title: 'Grapefruit, Pomelo, Bitterorange',
    text: 'Grapefruit, Pomelo und Bitterorange können die Wirkung mancher Medikamente verstärken. Ob das eigene betroffen ist, steht im Beipackzettel oder klärt die Apotheke.',
    more: [GRAPE], doc: true, excl: [['grapefruit', 'Grapefruit'], ['pomelo', 'Pomelo'], ['bitterorange', 'Bitterorange']] },
  { topic: 'tipsProduce', good: true, match: /(orange|mandarine|clementine|zitrone)/i,
    text: 'Zitrusfrüchte sind in Studien mit niedrigerer Sterblichkeit verbunden.' },
  { topic: 'tipsProduce', good: true, match: /(spinat|feldsalat|mangold|gr[üu]nkohl|rucola|blattsalat)/i,
    text: 'Grünes Blattgemüse gehört zu den Gruppen mit dem größten Nutzen. Mindestens zweimal pro Woche.', more: [VITK], doc: true },
  { topic: 'tipsProduce', good: true, match: /(brokkoli|rosenkohl|wirsing|kohlrabi|blumenkohl|kohl)/i,
    text: 'Kohl und Brokkoli jede Woche. Dämpfen schont die Vitamine, z. B. mit der Dampfgar-Funktion des Ninja.', more: [VITK], doc: true },
  { topic: 'tipsProduce', good: true, match: /(m[öo]hre|karotte|k[üu]rbis|paprika|s[üu]ßkartoffel|pastinake)/i,
    text: 'Orange Sorten liefern Beta-Carotin. Mit etwas Öl garen, dann nimmt der Körper es besser auf.' },
  { topic: 'tipsProduce', good: true, match: /(zwiebel|knoblauch|pilz|champignon)/i,
    text: 'Zwiebeln, Knoblauch und Pilze bringen Geschmack und Ballaststoffe.',
    extra: { crohn: 'Sie waren in einer großen Studie (EPIC) mit weniger Morbus Crohn verbunden.' + CROHN_ARZT } },
  { topic: 'tipsProduce', good: true, match: /(beere|himbeer|heidelbeer|erdbeer)/i,
    text: 'Auch als TK-Ware gleichwertig. Bio lohnt sich bei Beeren am ehesten, ist aber keine Voraussetzung.' },
  { topic: 'tipsProduce', good: true, match: /traube/i,
    text: 'Vor dem Essen 12–15 Minuten in Natronwasser legen (1 TL auf 500 ml), dann abspülen. Bio lohnt sich hier am ehesten.' },
  { topic: 'tipsProduce', good: true, match: /(tk|tiefk[üu]hl).*(gem[üu]se|erbse|bohne|spinat)|(gem[üu]se|erbse|bohne|spinat).*(tk|tiefk[üu]hl)/i,
    text: 'TK-Gemüse ist frischer Ware ebenbürtig und deckt die zweite Wochenhälfte ab.' },
  { topic: 'tipsBread', good: true, match: /vollkorn/i,
    title: 'Gute Wahl', text: 'Vollkorn bringt deutlich mehr Ballaststoffe und Mineralstoffe als helles Mehl.' },

  { topic: 'tipsProduce', match: /(kartoffel|pommes|wedges|kroketten|r[öo]sti)/i,
    title: 'Kartoffeln zählen nicht als Gemüse',
    text: 'Kartoffeln tragen nicht zum Gemüseziel bei, also Gemüse zusätzlich einplanen. Kühl und dunkel lagern, nicht im Kühlschrank. Pommes und Wedges im Ninja oder Ofen höchstens 180 °C, goldgelb statt braun.',
    alts: ['Brokkoli', 'Möhren'], add: true },

  // ---- Brot & Mehl ----
  { topic: 'tipsBread', match: /dinkel/i,
    title: 'Dinkel ist Weizen',
    text: 'Dinkel ist botanisch eine Weizenart. Helles Dinkelbrot (Type 630) hat kaum mehr Ballaststoffe als Weizentoast. Es zählt der Vollkornanteil.',
    extra: { diabetes: 'Auch beim Blutzucker ist helles Dinkelbrot kaum besser.', wenigWeizen: 'Wer Weizen meiden will: Roggen und Hafer sind kein Weizen.' },
    alts: ['Roggen-Vollkornbrot (Sauerteig)', 'Dinkel-Vollkornbrot'], details: BREAD_CHECK },
  { topic: 'tipsBread', match: /mehrkorn/i,
    title: 'Mehrkorn ist nicht Vollkorn',
    text: '„Mehrkorn“ heißt nur: mindestens drei Getreidearten. Das kann komplett helles Mehl sein.',
    alts: ['Roggen-Vollkornbrot (Sauerteig)', 'Vollkorntoast'], details: BREAD_CHECK },
  { topic: 'tipsBread', match: /(toast|sandwich)/i,
    title: 'Toast aus hellem Mehl',
    text: 'Vollkornbrot, z. B. Roggen-Vollkorn mit Sauerteig, hat deutlich mehr Ballaststoffe und sättigt länger. Vollkorntoast ist die zweitbeste Wahl.',
    extra: { diabetes: 'Vollkorn und Sauerteig lassen den Blutzucker flacher steigen.', wenigWeizen: 'Roggenbrot enthält keinen Weizen.' },
    alts: ['Roggen-Vollkornbrot (Sauerteig)', 'Vollkorntoast'], details: BREAD_CHECK },
  { topic: 'tipsBread', match: /(croissant|laugen|brezel|brezn|baguette|ciabatta|aufback|br[öo]tchen|semmel)/i,
    title: 'Helles Weizengebäck',
    text: 'Als Ausnahme okay, etwa am Wochenende. Mit Eiweiß kombiniert, z. B. Käse oder Ei, sättigt es länger.',
    extra: { diabetes: 'Die Kombination mit Eiweiß oder Fett dämpft auch den Blutzuckeranstieg.' },
    alts: ['Roggen-Vollkornbrötchen', 'Roggen-Vollkornbrot (Sauerteig)'] },
  { topic: 'tipsBread', match: /(weizenmehl|mehl\b|type 405|405er)/i,
    title: 'Helles Mehl',
    text: 'Vollkornmehl hat gegenüber Type 405 etwa 3,6-mal so viele Ballaststoffe, 6-mal so viel Eisen und knapp 9-mal so viel Magnesium.',
    alts: ['Weizenvollkornmehl', 'Roggenvollkornmehl'] },
  { topic: 'tipsBread', match: /(cornflakes|frühstücksflocken|knusper|schoko.?m[üu]sli|crunchy|cini|choco)/i,
    title: 'Gezuckerte Frühstücksflocken',
    text: 'Haferflocken mit frischem Obst sind die bessere Wahl: weniger Zucker, Ballaststoffe aus Hafer und Obst.',
    extra: { wenigWeizen: 'Hafer ist kein Weizen.' },
    alts: ['Haferflocken', 'Haferflocken + Beeren'] },

];

export function tipFor(name, isOn) {
  return compose(RULES.find(r => isOn(r.topic) && r.match.test(name)), profileKeys());
}

// Hinweise zur ganzen Liste (Obst/Gemüse fehlt)
const FRUIT = /(apfel|äpfel|banane|birne|orange|zitrone|traube|beere|kiwi|mango|obst|mandarine|clementine|pflaume|aprikose|pfirsich|melone|ananas)/i;
const LEAFY = /(spinat|feldsalat|mangold|gr[üu]nkohl|rucola|blattsalat|salat)/i;
const KOHL = /(brokkoli|rosenkohl|wirsing|kohlrabi|blumenkohl|kohl)/i;
const VEG = /(tomate|gurke|paprika|salat|karotte|möhre|zwiebel|brokkoli|zucchini|spinat|lauch|kohl|gemüse|aubergine|blumenkohl|bohne|erbse|kürbis|pilz|champignon|rote bete|sellerie|fenchel|spargel|rucola)/i;

const FISH = /(lachs|hering|makrele|forelle|kabeljau|seelachs|dorsch|sardine|scholle|fisch|thunfisch|garnele)/i;

export function listHints(names, isOn) {
  if (!names.length) return [];
  const out = [];
  if (isOn('tipsMeat') && names.length >= 3 && !names.some(n => FISH.test(n))) out.push({
    key: 'fisch', title: 'Noch kein Fisch auf der Liste',
    text: 'Ein bis zwei Fischabende pro Woche: einmal fett (Lachs, Hering), einmal mager (Kabeljau, Seelachs). TK-Fisch ist gleichwertig.', more: [GICHT], doc: true,
    alts: ['Lachsfilet (TK)', 'Seelachsfilet (TK)'] });
  if (!isOn('tipsProduce')) return out;
  const has = re => names.some(n => re.test(n));
  if (!has(FRUIT)) out.push({ key: 'obst',
    title: 'Noch kein Obst auf der Liste',
    text: 'Ziel sind etwa zwei Portionen Obst am Tag, am besten ganzes Obst.' + (profileKeys().has('crohn') ? ' Ganzes Obst hat beim Crohn-Risiko das deutlichste Schutzsignal, vor allem Äpfel, Birnen und Bananen (Beobachtungsstudien, Evidenz moderat bis niedrig).' + CROHN_ARZT : ''),
    alts: ['Äpfel', 'Birnen', 'Bananen', 'Orangen'] });
  if (names.length >= 3 && !has(LEAFY)) out.push({ key: 'blatt',
    title: 'Grünes Blattgemüse fehlt',
    text: 'Mindestens zweimal pro Woche Spinat, Feldsalat, Mangold oder Grünkohl. Diese Gruppe bringt mit den größten Nutzen.',
    alts: ['Spinat (TK)', 'Feldsalat', 'Mangold', 'Grünkohl'], more: [VITK], doc: true });
  if (names.length >= 3 && !has(KOHL)) out.push({ key: 'kohl',
    title: 'Kohl oder Brokkoli fehlt',
    text: 'Brokkoli, Rosenkohl, Wirsing oder Kohlrabi gehören jede Woche auf die Liste.',
    alts: ['Brokkoli', 'Kohlrabi', 'Rosenkohl', 'Wirsing'], more: [VITK], doc: true });
  return out;
}
