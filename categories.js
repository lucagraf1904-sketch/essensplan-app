// Kategorien mit Standard-Haltbarkeit (Tage) und Lagerort.
// Die Werte sind grobe Richtwerte für ungeöffnete Ware, keine Lebensmittelsicherheits-Angabe.
// Beim Bon-Scan werden sie als Vorschlag gesetzt und lassen sich pro Artikel ändern.
export const CATEGORIES = {
  'Obst':            { days: 7,   location: 'Vorratsschrank', words: ['apfel','äpfel','banane','birne','orange','zitrone','traube','beere','kiwi','mango','obst','mandarine','clementine','avocado'] },
  'Gemüse':          { days: 7,   location: 'Kühlschrank',    words: ['tomate','gurke','paprika','salat','karotte','möhre','zwiebel','kartoffel','brokkoli','zucchini','spinat','pilz','champignon','lauch','kohl','gemüse','knoblauch','rucola','radieschen'] },
  'Milchprodukte':   { days: 10,  location: 'Kühlschrank',    words: ['milch','joghurt','jogh','quark','sahne','butter','käse','kase','gouda','mozzarella','feta','frischkäse','skyr','schmand','kefir','buttermilch','h-milch'] },
  'Fleisch & Fisch': { days: 3,   location: 'Kühlschrank',    words: ['hähnchen','hahnchen','huhn','pute','rind','schwein','hack','wurst','schinken','salami','lachs','fisch','thunfisch','garnele','filet','steak','bacon','speck'] },
  'Eier':            { days: 21,  location: 'Kühlschrank',    words: ['eier','ei '] },
  'Brot & Backwaren':{ days: 4,   location: 'Vorratsschrank', words: ['brot','brötchen','toast','baguette','croissant','semmel','laugen','wrap','tortilla'] },
  'Tiefkühl':        { days: 180, location: 'Gefrierschrank', words: ['tk ','tiefk','pizza','eis ','pommes','frost'] },
  'Trockenware':     { days: 365, location: 'Vorratsschrank', words: ['nudel','pasta','spaghetti','reis','mehl','zucker','haferflocken','müsli','linsen','bohnen','kichererbsen','couscous','bulgur','quinoa'] },
  'Konserven':       { days: 540, location: 'Vorratsschrank', words: ['dose','konserve','passata','tomatenmark','mais','gehackte tomaten'] },
  'Getränke':        { days: 180, location: 'Vorratsschrank', words: ['wasser','saft','cola','limo','bier','wein','tee','kaffee','schorle','sprudel','sirup','sodastream','nektar','eistee','smoothie'] },
  'Gewürze & Öle':   { days: 365, location: 'Vorratsschrank', words: ['salz','pfeffer','öl','oel','essig','gewürz','senf','ketchup','mayo','soße','sauce','brühe'] },
  'Süßes & Snacks':  { days: 120, location: 'Vorratsschrank', words: ['schoko','chips','keks','riegel','gummi','nüsse','nuss','cracker','bonbon','lakritz','praline','marzipan','weingummi','fruchtgummi','haribo','kaugummi','süßigkeit','waffel','plätzchen','lolli','popcorn','salzstange','erdnuss'] },
  // Pfand wird nicht über Wörter erkannt, sondern direkt im Bon-Parser gesetzt (receipt.js)
  'Pfand':           { days: null, nonFood: true, location: 'Vorratsschrank', words: [] },
  // Nicht-Lebensmittel (Luca 24.11.): kein Essensplan, keine Zutaten, keine Lebensmittel-Ablaufwarnung
  'Badezimmer':      { days: null, location: 'Vorratsschrank', nonFood: true, words: ['zahnpasta','zahncreme','zahnbürste','zahnseide','mundwasser','mundspül','duschgel','duschbad','shampoo','haarspülung','haarspray','haargel','conditioner','seife','deo ','deodorant','rasier','handcreme','bodylotion','körperlotion','gesichtscreme','sonnencreme','wattepad','wattestäb','tampon','damenbinde','slipeinlage','taschentücher','feuchttücher','kosmetik','nagellack','parfum','badezusatz','schaumbad'] },
  'Haushalt':        { days: null, location: 'Vorratsschrank', nonFood: true, words: ['spül','toilettenpapier','küchenrolle','waschmittel','müllbeutel','schwamm','tücher'] },
  // Reste gekochter Gerichte: höchstens 2 Tage im Kühlschrank (Verbraucherzentrale, Speisereste, Stand 02.12.2025)
  'Reste':           { days: 2,   location: 'Kühlschrank',    words: [] },
  'Sonstiges':       { days: 30,  location: 'Vorratsschrank', words: [] },
};

// Datum als JJJJ-MM-TT in lokaler Zeit (toISOString wäre UTC und kurz nach Mitternacht einen Tag zu früh)
export const isoLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Nicht-Lebensmittel (Badezimmer, Haushalt, Pfand): nie im Essensplan, nie als Zutat
export const isFoodCat = c => !CATEGORIES[c]?.nonFood;
export function guessCategory(name) {
  const n = ' ' + name.toLowerCase() + ' ';
  // Badezimmer zuerst („Mundwasser“ ist kein Getränk, „Haarspülung“ kein Spülmittel)
  if (CATEGORIES['Badezimmer'].words.some(w => n.includes(w))) return 'Badezimmer';
  // Getränke vor Obst prüfen („Orangensaft“ ist ein Getränk, kein Obst)
  if (/(saft|nektar|smoothie|sirup|schorle|limo|cola|sprudel|mineralwasser|eistee)/.test(n)) return 'Getränke';
  for (const [cat, def] of Object.entries(CATEGORIES)) {
    if (def.words.some(w => n.includes(w))) return cat;
  }
  return 'Sonstiges';
}

export function defaultExpiry(category, from = new Date()) {
  const d = CATEGORIES[category]?.days;
  if (d == null) return '';
  const dt = new Date(from);
  dt.setDate(dt.getDate() + d);
  return isoLocal(dt);
}

// ---------- Einfrieren ----------
// Empfohlene maximale Lagerdauer im Tiefkühler (-18 °C) in Monaten.
// Quellen:
//  VZ  = Verbraucherzentrale NRW, „Kalt gemacht – Wie du Lebensmittel richtig einfrierst“ (Stand 22.12.2025):
//        Fleisch und Fisch etwa 6 Monate, Obst und Gemüse bis zu 1 Jahr.
//  HB  = Lebensmittelüberwachung Bremen (LMTVet), Infoblatt 21 „Tiefkühlen von Lebensmitteln“ (2014):
//        Hackfleisch innerhalb von 3 bis 4 Monaten verarbeiten.
// Werte ohne Quelle sind Annahmen und als solche markiert.
const SRC_VZ = 'Verbraucherzentrale NRW';
const SRC_HB = 'Lebensmittelüberwachung Bremen';
export const FREEZE = {
  hack:              { months: 4,  source: SRC_HB },
  'Fleisch & Fisch': { months: 6,  source: SRC_VZ },
  'Gemüse':          { months: 12, source: SRC_VZ },
  'Obst':            { months: 12, source: SRC_VZ },
  'Brot & Backwaren':{ months: 3,  source: null },
  'Milchprodukte':   { months: 3,  source: null, hint: 'Käse und Sahne werden nach dem Auftauen oft wässrig oder krümelig.' },
  default:           { months: 3,  source: null },
};

export function freezeRule(item) {
  if (/hack/i.test(item.name)) return FREEZE.hack;
  return FREEZE[item.category] ?? FREEZE.default;
}

export function freezeExpiry(item, from = new Date()) {
  const r = freezeRule(item);
  const dt = new Date(from);
  dt.setMonth(dt.getMonth() + r.months);
  return { ...r, date: isoLocal(dt) };
}

// ---------- Getränke: Haltbarkeit je Verpackung (ungeöffnet) ----------
// Quelle: Verbraucherzentrale, „Fruchtsaft und Nektar: Haltbarkeit und Lagerung“ (Stand 20.07.2026):
// Glasflasche 18–36 Monate, Kartonverbund 9–12, Einweg-PET 6–9, kühlpflichtige PET (2–8 °C) etwa 2 Monate.
// Die App nimmt jeweils den unteren Wert. Gilt laut Quelle für Saft und Nektar; das MHD auf der Packung geht vor.
export const PACKS = {
  glas:    { label: 'Glasflasche', months: 18, range: '18–36 Monate' },
  karton:  { label: 'Karton', months: 9, range: '9–12 Monate' },
  pet:     { label: 'PET-Flasche', months: 6, range: '6–9 Monate' },
  petKuehl:{ label: 'PET gekühlt (2–8 °C)', months: 2, range: 'etwa 2 Monate', location: 'Kühlschrank' },
};
export const PACK_SOURCE = 'Verbraucherzentrale (Saft und Nektar, Stand 20.07.2026)';
export function packExpiry(pack, from = new Date()) {
  const p = PACKS[pack]; if (!p) return '';
  const d = new Date(from); d.setMonth(d.getMonth() + p.months); return isoLocal(d);
}
// Geöffnet: VZ sagt nur „wenige Tage gekühlt“. 4 Tage sind ein Richtwert (Annahme).
export const OPENED_DAYS = 4;
