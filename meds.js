// „Essen und Medikamente“: allgemeine Info-Bibliothek (Luca 22./23.11.2026).
// Grundregel: Die App informiert nur. Sie ändert den Essensplan nie selbst wegen Medikamenten oder Erkrankungen.
// Ausschlüsse wirken erst, wenn die Person selbst auf den Knopf auf einer Karte tippt (wie „kein Schwein“).
// Rechtliche Einordnung: recherche/reports/Medikamenten-Infos rechtlich absichern.md (Stand 22.11.2026, keine Rechtsberatung).
// Nicht bauen: persönliche Warnungen, Bewertung von Wechselwirkungen, Dosis, Einnahme-Erinnerungen, Präparatsuche.
//
// Inhalt in eigenen Worten nach: Verbraucherzentrale, „Tabletten, Tropfen & Co: Vertragen die sich mit dem Essen?“, Stand 25.07.2025,
// https://www.verbraucherzentrale.de/wissen/lebensmittel/gesund-ernaehren/tabletten-tropfen-co-vertragen-die-sich-mit-dem-essen-48717 (abgerufen 23.11.2026).
// Gewählte Wirkstoffgruppen liegen nur auf diesem Gerät ('speisekammer.meds', wird nicht abgeglichen).

export const MEDS_SOURCE = { label: 'Verbraucherzentrale, „Tabletten, Tropfen & Co“', stand: '25.07.2025', checked: '23.11.2026',
  url: 'https://www.verbraucherzentrale.de/wissen/lebensmittel/gesund-ernaehren/tabletten-tropfen-co-vertragen-die-sich-mit-dem-essen-48717' };

// Wirkstoffgruppen in Alltagssprache (Beispiele laut Quelle)
export const GROUPS = {
  statine: 'Cholesterinsenker (Statine, z. B. Simvastatin, Atorvastatin)',
  calciumkanal: 'Blutdrucksenker vom Typ Calciumkanalblocker',
  benzo: 'Beruhigungsmittel (Benzodiazepine, z. B. Diazepam, Lorazepam)',
  pde5: 'PDE-5-Hemmer (Potenzmittel)',
  bisphos: 'Osteoporose-Mittel (Bisphosphonate, z. B. Alendronsäure)',
  antibio: 'Antibiotika (Tetrazykline, Fluorchinolone)',
  schmerz: 'Schmerzmittel dauerhaft (Ibuprofen, Diclofenac, ASS)',
  mao: 'MAO-Hemmer (z. B. Tranylcypromin)',
  vka: 'Gerinnungshemmer vom Typ Vitamin-K-Antagonist (z. B. Phenprocoumon/Marcumar, Warfarin)',
  psycho: 'Antidepressiva und andere Psychopharmaka',
  koffein: 'Ciprofloxacin, Cimetidin oder Prednison',
  diuretika: 'Entwässerungsmittel (Schleifen-/Thiazid-Diuretika, z. B. Furosemid, Hydrochlorothiazid)',
  metformin: 'Metformin oder Digoxin',
  levodopa: 'Parkinson-Mittel mit Levodopa',
  schilddruese: 'Schilddrüsenhormon (L-Thyroxin/Levothyroxin)',
  fett: 'Spironolacton, Hydrochlorothiazid, Lovastatin, Propranolol, Lercanidipin oder Ciclosporin',
};

// Karten: allgemein, für alle gleich. exclude = Lebensmittel, die die Person auf Wunsch selbst aus dem Plan nehmen kann.
export const CARDS = [
  { id: 'grapefruit', title: 'Grapefruit und Pomelo', groups: ['statine', 'calciumkanal', 'benzo', 'pde5'],
    text: 'Grapefruit und Pomelo, auch als Saft, können die Wirkung dieser Mittel verstärken. Die Quelle rät, sie dazu gar nicht zu verzehren; ein großer zeitlicher Abstand senkt das Risiko nicht.',
    exclude: [['grapefruit', 'Grapefruit'], ['pomelo', 'Pomelo']] },
  { id: 'milch', title: 'Milch, Milchprodukte und Calcium', groups: ['bisphos', 'antibio'],
    text: 'Diese Mittel nicht mit Milch oder Milchprodukten einnehmen. Bisphosphonate außerdem nicht zusammen mit calciumreichem Mineralwasser oder mit Calcium angereichertem Saft.' },
  { id: 'alkohol', title: 'Alkohol', groups: ['schmerz'],
    text: 'Bei dauerhafter Einnahme von Ibuprofen, Diclofenac oder ASS möglichst wenig und selten Alkohol trinken; zusammen steigt das Risiko für Magengeschwüre.' },
  { id: 'tyramin', title: 'Gereifter Käse, Salami & Co. (Tyramin)', groups: ['mao'],
    text: 'Käse, Joghurt, Salami, Sojaprodukte, Rotwein, Schokolade und Trockenobst enthalten viel Tyramin. Zusammen mit MAO-Hemmern sind laut Quelle gefährliche Blutdruckkrisen möglich.',
    exclude: [['salami', 'Salami'], ['käse', 'Käse'], ['soja', 'Sojaprodukte'], ['trockenobst', 'Trockenobst']] },
  { id: 'goji', title: 'Goji-Beeren und Granatapfelsaft', groups: ['vka'],
    text: 'Zu Vitamin-K-Antagonisten rät die Quelle, Goji-Beeren und Granatapfelsaft nicht zu verzehren (Blutungsrisiko).',
    exclude: [['goji', 'Goji-Beeren'], ['granatapfel', 'Granatapfel']] },
  { id: 'vitk', title: 'Gemüse mit Vitamin K', groups: ['vka'],
    text: 'Salat, Brokkoli oder Spinat muss man bei ausgewogener Ernährung nicht meiden. Größere Umstellungen der Ernährung (z. B. eine „Salatdiät“) vorher ärztlich besprechen.' },
  { id: 'kaffee', title: 'Kaffee, schwarzer und grüner Tee', groups: ['psycho'],
    text: 'Gerbstoffe aus Kaffee und Tee können die Wirkung mancher Psychopharmaka laut Quelle um bis zu 80 Prozent senken. Als Alternative nennt sie Hagebutten- oder Kamillentee.' },
  { id: 'koffein', title: 'Koffein wirkt länger', groups: ['koffein'],
    text: 'Mit diesen Mitteln wird Koffein langsamer abgebaut; Kaffee wirkt dann stärker bzw. länger.' },
  { id: 'granatapfel', title: 'Granatapfel', groups: ['pde5', 'vka'],
    text: 'Bei Granatapfel-Produkten rät die Quelle zu PDE-5-Hemmern und Blutverdünnern zu einem größeren zeitlichen Abstand.',
    exclude: [['granatapfel', 'Granatapfel']] },
  { id: 'lakritz', title: 'Lakritz', groups: ['diuretika'],
    text: 'Lakritz nur in geringen Mengen und nicht regelmäßig essen; zusammen mit diesen Mitteln droht Kaliumverlust.',
    exclude: [['lakritz', 'Lakritz']] },
  { id: 'kleie', title: 'Kleie, Leinsamen, Flohsamen', groups: ['metformin'],
    text: 'Sehr ballaststoffreiche Lebensmittel wie Weizen- oder Haferkleie, Leinsamen und Flohsamen nicht zusammen mit diesen Mitteln einnehmen; die Wirkung kann schwächer werden. Ähnliches gilt für Aktivkohle (z. B. in „Detox“-Produkten oder schwarz gefärbten Lebensmitteln).',
    exclude: [['kleie', 'Kleie'], ['leinsamen', 'Leinsamen'], ['flohsamen', 'Flohsamen']] },
  { id: 'eiweiss', title: 'Eiweißreiche Mahlzeiten', groups: ['levodopa'],
    text: 'Levodopa laut Quelle 30 bis 60 Minuten vor einer Mahlzeit einnehmen. Geht das nicht, eiweißreiche Mahlzeiten eher auf den Abend legen. Nicht mit Quark, Joghurt oder Pudding einnehmen.' },
  { id: 'schilddruese', title: 'Mineralstoffe und Milchprodukte', groups: ['schilddruese'],
    text: 'Schilddrüsenhormon nüchtern mit Leitungswasser, 30 bis 60 Minuten vor einer Mahlzeit. Zu mineralstoffreichen Lebensmitteln und Milchprodukten zwei bis drei Stunden Abstand.' },
  { id: 'fett', title: 'Sehr fettreiche Mahlzeiten', groups: ['fett'],
    text: 'Bei diesen Mitteln verändert eine sehr fettreiche Mahlzeit, wie schnell der Wirkstoff aufgenommen oder abgebaut wird. Die Quelle empfiehlt, sie nicht zu stark fetthaltigen Mahlzeiten einzunehmen.' },
  { id: 'nem', title: 'Nahrungsergänzungsmittel', groups: [],
    text: 'Auch Nahrungsergänzungsmittel, besonders hoch dosierte oder pflanzliche, können Medikamente beeinflussen. Packungsbeilage lesen oder in der Apotheke nachfragen.' },
];

export const PURPOSE = 'Dieser Bereich zeigt allgemeine, öffentlich zugängliche Informationen darüber, welche Lebensmittel die Wirkung bestimmter Arzneimittelgruppen beeinflussen können. Er dient nur der allgemeinen Information und der Umsetzung von Essensvorlieben, die du selbst festlegst. Er erkennt, überwacht oder behandelt keine Krankheiten, wählt oder dosiert keine Arzneimittel und bewertet keine Wechselwirkungen für eine bestimmte Person.';
export const NOTICE = 'Nur zur Information. Diese Hinweise sind allgemein und ersetzen keine Beratung durch Ärztin, Arzt oder Apotheke. Sie sind nicht vollständig und berücksichtigen nicht deine persönliche Situation, Dosis oder weitere Medikamente. Ändere deine Medikamente oder deine Ernährung nicht allein aufgrund dieser App. Frag bei Unsicherheit in deiner Apotheke nach. Deine Angaben bleiben nur auf diesem Handy und werden nicht übertragen.';
export const EMERGENCY = 'Bei Beschwerden nach Einnahme eines Medikaments: ärztlicher Bereitschaftsdienst 116 117, im Notfall 112.';
export const EXCLUDE_NOTE = 'Du entscheidest selbst, welche Lebensmittel der Essensplan weglassen soll. Die App ändert den Plan nur, wenn du auf einen dieser Knöpfe tippst.';

// Nur auf diesem Gerät
const KEY = 'speisekammer.meds';
export function loadMeds() { try { return { filter: false, groups: [], ack: false, ...(JSON.parse(localStorage.getItem(KEY)) ?? {}) }; } catch { return { filter: false, groups: [], ack: false }; } }
export function saveMeds(m) { localStorage.setItem(KEY, JSON.stringify(m)); }
