// „Essen und Medikamente“: allgemeine Info-Bibliothek (Luca 22./23.11.2026).
// Grundregel: Die App informiert nur. Sie ändert den Essensplan nie selbst wegen Medikamenten oder Erkrankungen.
// Ausschlüsse wirken erst, wenn die Person selbst auf den Knopf auf einer Karte tippt (wie „kein Schwein“).
// Rechtliche Einordnung: recherche/reports/Medikamenten-Infos rechtlich absichern.md (Stand 22.11.2026, keine Rechtsberatung).
// Nicht bauen: persönliche Warnungen, Bewertung von Wechselwirkungen, Dosis, Einnahme-Erinnerungen, Präparatsuche.
//
// Inhalt (ursprünglich) in eigenen Worten nach: Verbraucherzentrale, „Tabletten, Tropfen & Co: Vertragen die sich mit dem Essen?“, Stand 25.07.2025,
// https://www.verbraucherzentrale.de/wissen/lebensmittel/gesund-ernaehren/tabletten-tropfen-co-vertragen-die-sich-mit-dem-essen-48717 (abgerufen 23.11.2026).
// Gewählte Wirkstoffgruppen liegen nur auf diesem Gerät ('speisekammer.meds', wird nicht abgeglichen).

// Abgleich 23.11.2026 mit der Nachprüfung (recherche/reports/Übermäßiger Verzehr und Folgen.md, Abschnitt 7.2 „Kartentexte“):
// - Karten ohne Minuten- oder Stundenangaben; Abstände und Dauer stehen im Beipackzettel, Verweis auf Apotheke.
// - Geprüfte Kartentexte aus der Nachprüfung übernommen (src: 'np'); Aussagen, die dort „nicht bestätigt“ sind, stehen nicht mehr in den Karten.
// - Karten, die nur die Verbraucherzentrale nennt und die die Nachprüfung nicht behandelt, bleiben mit Quelle VZ (src: 'vz').
export const SOURCES = {
  vz: { label: 'Verbraucherzentrale, „Tabletten, Tropfen & Co“', stand: '25.07.2025', checked: '23.11.2026',
    url: 'https://www.verbraucherzentrale.de/wissen/lebensmittel/gesund-ernaehren/tabletten-tropfen-co-vertragen-die-sich-mit-dem-essen-48717' },
  bailey: { label: 'Bailey et al., CMAJ 2013', stand: '2013', checked: '23.11.2026', url: 'https://www.cmaj.ca/content/185/4/309' },
  marcumar: { label: 'Fachinformation Marcumar', stand: 'abgerufen 23.11.2026', checked: '23.11.2026', url: 'https://www.fachinfo.de/fi/detail/003056/marcumar' },
  tranyl: { label: 'Packungsbeilage Tranylcypromin (UK)', stand: 'abgerufen 23.11.2026', checked: '23.11.2026', url: 'https://www.medicines.org.uk/emc/product/101958/pil' },
  levo: { label: 'Pharmazeutische Zeitung; Fachinformation Euthyrox', stand: 'abgerufen 23.11.2026', checked: '23.11.2026', url: 'https://www.pharmazeutische-zeitung.de/levothyroxin-zum-fruehstueck-geht-das-162006/' },
  alendron: { label: 'Fachinformation Alendronsäure (UK)', stand: 'abgerufen 23.11.2026', checked: '23.11.2026', url: 'https://www.medicines.org.uk/emc/product/100151/smpc' },
  metro: { label: 'Fachinformation Metronidazol (UK)', stand: 'abgerufen 23.11.2026', checked: '23.11.2026', url: 'https://www.medicines.org.uk/emc/product/15157' },
  dkfz: { label: 'DKFZ, Wechselwirkungen von Alkohol mit Medikamenten', stand: '2023', checked: '23.11.2026', url: 'https://www.dkfz.de/de/krebspraevention/Downloads/pdf/FzA/FzA_2023_Wechselwirkungen-von-Alkohol-mit-Medikamenten.pdf' },
  bfrLakritz: { label: 'BfR, Gesundheitliche Bewertung von Lakritze', stand: 'abgerufen 23.11.2026', checked: '23.11.2026', url: 'https://www.bfr.bund.de/lebensmittel-und-futtermittelsicherheit/gesundheitliche-risikobewertung-spezieller-lebensmittelgruppen/ausgewaehlte-lebensmittel/gesundheitliche-bewertung-von-lakritze/' },
  medsafe: { label: 'Medsafe 2024', stand: '06/2024', checked: '23.11.2026', url: 'https://www.medsafe.govt.nz/profs/PUArticles/June2024/Potassium-in-dietary-supplements-hyperkalaemia.html' },
  msd: { label: 'MSD Manual, Johanniskraut', stand: 'abgerufen 23.11.2026', checked: '23.11.2026', url: 'https://www.msdmanuals.com/de/profi/spezielle-fachgebiete/nahrungserg%C3%A4nzungsmittel/johanniskraut' },
  bda: { label: 'British Dietetic Association, Phosphor bei CKD', stand: 'abgerufen 23.11.2026', checked: '23.11.2026', url: 'https://bda.uk.com/static/f14711e0-ecbe-4f5a-bb63fb859271c7f0/phosphorusinfoodsconsiderationsinchronickidneydisease.pdf' },
  ema: { label: 'EMA/PRAC 2016, SGLT2-Hemmer', stand: '2016', checked: '23.11.2026', url: 'https://www.ema.europa.eu/en/news/sglt2-inhibitors-prac-makes-recommendations-minimise-risk-diabetic-ketoacidosis' },
  mucofalk: { label: 'Gebrauchsinformation Mucofalk', stand: 'abgerufen 23.11.2026', checked: '23.11.2026', url: 'https://www.patienteninfo-service.de/gi/13570/' },
};
export const MEDS_SOURCE = SOURCES.vz; // Kompatibilität

// Wirkstoffgruppen in Alltagssprache (Beispiele laut Quellen)
export const GROUPS = {
  statine: 'Cholesterinsenker (Statine, z. B. Simvastatin, Atorvastatin)',
  calciumkanal: 'Blutdrucksenker vom Typ Calciumkanalblocker (z. B. Felodipin)',
  rhythmus: 'Herzrhythmusmittel (z. B. Amiodaron, Dronedaron)',
  transplant: 'Mittel nach Transplantation (z. B. Ciclosporin, Tacrolimus)',
  benzo: 'Schlaf- und Beruhigungsmittel (z. B. Benzodiazepine)',
  pde5: 'PDE-5-Hemmer (Potenzmittel)',
  bisphos: 'Osteoporose-Mittel (Bisphosphonate, z. B. Alendronsäure)',
  metro: 'Antibiotikum Metronidazol',
  schmerz: 'Schmerzmittel (z. B. Paracetamol, Ibuprofen, Diclofenac, ASS)',
  mao: 'MAO-Hemmer (z. B. Tranylcypromin)',
  vka: 'Gerinnungshemmer vom Typ Vitamin-K-Antagonist (z. B. Phenprocoumon/Marcumar)',
  psycho: 'Antidepressiva und andere Psychopharmaka',
  pille: 'Antibabypille',
  raas: 'Blutdruckmittel wie ACE-Hemmer oder Sartane',
  diuretika: 'Entwässerungsmittel (z. B. Furosemid, Hydrochlorothiazid, Spironolacton)',
  diabetes: 'Diabetes-Medikamente (z. B. SGLT2-Hemmer)',
  metformin: 'Metformin oder Digoxin',
  levodopa: 'Parkinson-Mittel mit Levodopa',
  schilddruese: 'Schilddrüsenhormon (L-Thyroxin/Levothyroxin)',
  fett: 'Spironolacton, Hydrochlorothiazid, Lovastatin, Propranolol, Lercanidipin oder Ciclosporin',
};

// Karten: allgemein, für alle gleich, ohne Zeitangaben. exclude = Lebensmittel, die die Person auf Wunsch selbst aus dem Plan nehmen kann.
export const CARDS = [
  { id: 'grapefruit', src: 'bailey', title: 'Grapefruit, Pomelo, Bitterorange', groups: ['statine', 'calciumkanal', 'rhythmus', 'transplant'],
    text: 'Grapefruit, Pomelo, Limette und Bitterorange (z. B. in Orangenmarmelade) können die Wirkung mancher Medikamente verstärken, etwa bestimmter Cholesterinsenker, Blutdruckmittel, Herzrhythmusmittel und Mittel nach Transplantation. Schon kleine Mengen können reichen. Ob das eigene Medikament betroffen ist, steht im Beipackzettel oder lässt sich in der Apotheke klären.',
    exclude: [['grapefruit', 'Grapefruit'], ['pomelo', 'Pomelo'], ['bitterorange', 'Bitterorangen-Marmelade']] },
  { id: 'vitk', src: 'marcumar', title: 'Grünes Gemüse und Gerinnungshemmer', groups: ['vka'],
    text: 'Vitamin K aus grünem Gemüse kann die Wirkung von Gerinnungshemmern vom Typ Vitamin-K-Antagonist (z. B. Phenprocoumon) abschwächen. Laut Fachinformation ist vor allem eine plötzliche Umstellung der Ernährung wichtig. Wer solche Mittel nimmt und viel an der Ernährung ändern möchte, klärt das bitte vorher ärztlich oder in der Apotheke. Alkohol kann die Wirkung von Vitamin-K-Antagonisten in beide Richtungen verändern; bitte ebenfalls dort klären.' },
  { id: 'tyramin', src: 'tranyl', title: 'Gereifter Käse, Salami & Co. (Tyramin)', groups: ['mao'],
    text: 'Bestimmte Antidepressiva (MAO-Hemmer wie Tranylcypromin) vertragen sich nicht mit tyraminreichen Lebensmitteln wie lange gereiftem Käse, Salami, Hefeextrakt oder Sojasauce. Das kann den Blutdruck stark erhöhen. Die Packungsbeilage nennt die Lebensmittel und wie lange die Einschränkung gilt, auch nach dem Absetzen. Bitte dort nachlesen oder in der Apotheke fragen.',
    exclude: [['salami', 'Salami'], ['käse', 'Käse'], ['sojasauce', 'Sojasauce'], ['hefeextrakt', 'Hefeextrakt']] },
  { id: 'schilddruese', src: 'levo', title: 'Frühstück, Soja, Calcium und Eisen', groups: ['schilddruese'],
    text: 'Schilddrüsenhormon (Levothyroxin) wird meist nüchtern vor dem Frühstück eingenommen, weil Essen die Aufnahme verändern kann. Den genauen Abstand nennt der Beipackzettel. Viel Soja (z. B. Sojadrinks, Soja-Präparate) sowie Calcium- und Eisenpräparate können die Aufnahme verringern. Wer seine Soja-Menge deutlich ändert, sagt das bitte der Ärztin oder dem Arzt; zu Präparaten bitte im Beipackzettel nachlesen oder in der Apotheke fragen.' },
  { id: 'bisphos', src: 'alendron', title: 'Osteoporose-Tabletten', groups: ['bisphos'],
    text: 'Bestimmte Osteoporose-Tabletten (Bisphosphonate) werden laut Beipackzettel nur mit Leitungswasser eingenommen, nicht mit Mineralwasser, Kaffee oder Saft, und mit Abstand zum Frühstück. Die genauen Regeln stehen im Beipackzettel.' },
  { id: 'alkohol', src: 'dkfz', title: 'Alkohol und Schmerz-, Schlaf- und Beruhigungsmittel', groups: ['schmerz', 'benzo'],
    text: 'Wer regelmäßig Alkohol trinkt, sollte Schmerzmittel wie Paracetamol vorher in der Apotheke besprechen. Alkohol zusammen mit Schmerzmitteln wie Ibuprofen kann Magen und Darm zusätzlich belasten. Alkohol kann die Wirkung von Schlaf-, Beruhigungs- und starken Schmerzmitteln gefährlich verstärken.' },
  { id: 'metro', src: 'metro', title: 'Alkohol und Metronidazol', groups: ['metro'],
    text: 'Bei dem Antibiotikum Metronidazol rät die Fachinformation, während der Einnahme und einige Tage danach auf Alkohol zu verzichten. Die genaue Dauer steht im Beipackzettel.' },
  { id: 'lakritz', src: 'bfrLakritz', title: 'Lakritz', groups: ['diuretika'],
    text: 'Lakritz kann in größeren Mengen den Blutdruck erhöhen und Kalium senken. Menschen mit Bluthochdruck oder Herzerkrankung essen ihn laut BfR besser nur selten. Wer Entwässerungs- oder Herzmedikamente nimmt, fragt bitte in der Apotheke nach.',
    exclude: [['lakritz', 'Lakritz']] },
  { id: 'kalium', src: 'medsafe', title: 'Kaliumhaltiges Ersatzsalz', groups: ['raas', 'diuretika'],
    text: 'Diät- oder Ersatzsalz enthält oft Kalium. Bei Nierenerkrankungen und unter manchen Blutdruck- und Entwässerungsmitteln kann zu viel Kalium schaden. Bitte vorher ärztlich oder in der Apotheke klären.' },
  { id: 'johanniskraut', src: 'msd', title: 'Johanniskraut', groups: ['pille', 'vka', 'psycho'],
    text: 'Johanniskraut kann die Wirkung vieler Medikamente abschwächen, zum Beispiel der Pille oder von Gerinnungshemmern. Wer Medikamente nimmt, fragt vor Johanniskraut bitte in der Apotheke.' },
  { id: 'phosphat', src: 'bda', title: 'Phosphat-Zusatzstoffe bei Nierenerkrankung', groups: [],
    text: 'Bei Nierenerkrankungen empfehlen Fachgesellschaften, auf Phosphat-Zusatzstoffe (in der Zutatenliste z. B. E338–E343, E450–E452) zu achten, weil der Körper sie fast vollständig aufnimmt. Was im Einzelfall gilt, klärt die Nierenärztin oder Ernährungsberatung.' },
  { id: 'fasten', src: 'ema', title: 'Diabetes-Medikamente und Fasten', groups: ['diabetes'],
    text: 'Wer Diabetes-Medikamente nimmt, bespricht Fasten oder sehr kohlenhydratarme Kost bitte vorher ärztlich. Bei manchen Mitteln (SGLT2-Hemmer) kann es sonst zu einer gefährlichen Übersäuerung kommen, auch bei normalem Blutzucker.' },
  { id: 'flohsamen', src: 'mucofalk', title: 'Flohsamenschalen und andere Quellstoffe', groups: [],
    text: 'Quellende Lebensmittel wie Flohsamenschalen immer mit reichlich Flüssigkeit und nie trocken essen. Sie können die Aufnahme von Medikamenten verzögern; der Beipackzettel von Flohsamen-Präparaten nennt dafür einen Abstand. Bei Schluckbeschwerden lieber verzichten oder ärztlich klären.',
    exclude: [['flohsamen', 'Flohsamen']] },
  // Nur Verbraucherzentrale (von der Nachprüfung nicht behandelt), ohne Zeitangaben
  { id: 'goji', src: 'vz', title: 'Goji-Beeren und Granatapfel', groups: ['vka', 'pde5'],
    text: 'Zu Vitamin-K-Antagonisten rät die Verbraucherzentrale, Goji-Beeren und Granatapfelsaft nicht zu verzehren. Bei Granatapfel-Produkten und PDE-5-Hemmern rät sie zu Abstand. Ob das eigene Medikament betroffen ist, steht im Beipackzettel oder klärt die Apotheke.',
    exclude: [['goji', 'Goji-Beeren'], ['granatapfel', 'Granatapfel']] },
  { id: 'kaffee', src: 'vz', title: 'Kaffee, schwarzer und grüner Tee', groups: ['psycho'],
    text: 'Gerbstoffe aus Kaffee und Tee können laut Verbraucherzentrale die Wirkung mancher Psychopharmaka abschwächen. Als Alternative nennt sie Hagebutten- oder Kamillentee. Bitte in der Apotheke klären, ob das eigene Mittel betroffen ist.' },
  { id: 'kleie', src: 'vz', title: 'Kleie und Leinsamen', groups: ['metformin'],
    text: 'Sehr ballaststoffreiche Lebensmittel wie Weizen- oder Haferkleie und Leinsamen können laut Verbraucherzentrale die Wirkung dieser Mittel abschwächen, wenn sie zusammen eingenommen werden. Ähnliches gilt für Aktivkohle (z. B. in „Detox“-Produkten). Den Abstand nennt der Beipackzettel.',
    exclude: [['kleie', 'Kleie'], ['leinsamen', 'Leinsamen']] },
  { id: 'eiweiss', src: 'vz', title: 'Eiweißreiche Mahlzeiten', groups: ['levodopa'],
    text: 'Eiweißreiche Mahlzeiten können laut Verbraucherzentrale die Aufnahme von Levodopa verringern. Wann das Mittel im Verhältnis zum Essen eingenommen wird, steht im Beipackzettel oder klärt die Ärztin bzw. der Arzt.' },
  { id: 'fett', src: 'vz', title: 'Sehr fettreiche Mahlzeiten', groups: ['fett'],
    text: 'Bei diesen Mitteln kann eine sehr fettreiche Mahlzeit laut Verbraucherzentrale verändern, wie schnell der Wirkstoff aufgenommen oder abgebaut wird. Hinweise zur Einnahme stehen im Beipackzettel.' },
  { id: 'nem', src: 'vz', title: 'Nahrungsergänzungsmittel', groups: [],
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
