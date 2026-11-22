// Gesundheitsangaben für Einstellungen → Gesundheit & Vorlieben (Suchfeld).
// tags verbinden eine Angabe mit Zusatzhinweisen in tips.js (extra.<tag>) und später mit dem Essensplan.
// Freiwillig, nur auf dem Gerät gespeichert. Keine Diagnose, keine ärztliche Beratung.
export const CONDITIONS = [
  { id: 'crohn', label: 'Morbus Crohn', tags: ['crohn'] },
  { id: 'crohnFamilie', label: 'Morbus Crohn / CED in der Familie', tags: ['crohn'] },
  { id: 'colitis', label: 'Colitis ulcerosa', tags: ['ced'] },
  { id: 'diabetes1', label: 'Diabetes Typ 1', tags: ['diabetes'] },
  { id: 'diabetes', label: 'Diabetes Typ 2', tags: ['diabetes'] },
  { id: 'praediabetes', label: 'Prädiabetes / Insulinresistenz', tags: ['diabetes'] },
  { id: 'bluthochdruck', label: 'Bluthochdruck', tags: ['bluthochdruck'] },
  { id: 'cholesterin', label: 'Erhöhtes Cholesterin', tags: ['cholesterin'] },
  { id: 'herz', label: 'Herz-Kreislauf-Erkrankung', tags: ['herz'] },
  { id: 'gicht', label: 'Gicht / erhöhte Harnsäure', tags: ['gicht'] },
  { id: 'reizdarm', label: 'Reizdarm', tags: ['reizdarm'] },
  { id: 'reizmagen', label: 'Reizmagen', tags: ['reizmagen'] },
  { id: 'reflux', label: 'Sodbrennen / Reflux', tags: ['reflux'] },
  { id: 'divertikel', label: 'Divertikulose', tags: ['divertikel'] },
  { id: 'gallensteine', label: 'Gallensteine', tags: ['galle'] },
  { id: 'fettleber', label: 'Fettleber / Lebererkrankung', tags: ['leber'] },
  { id: 'niere', label: 'Nierenerkrankung', tags: ['niere'] },
  { id: 'laktose', label: 'Laktoseintoleranz', tags: ['laktose'] },
  { id: 'fruktose', label: 'Fruktoseintoleranz', tags: ['fruktose'] },
  { id: 'histamin', label: 'Histaminintoleranz', tags: ['histamin'] },
  { id: 'zoeliakie', label: 'Zöliakie (glutenfrei)', tags: ['gluten'] },
  { id: 'weizenallergie', label: 'Weizenallergie', tags: ['weizen'] },
  { id: 'nussallergie', label: 'Nussallergie', tags: ['nuss'] },
  { id: 'erdnussallergie', label: 'Erdnussallergie', tags: ['erdnuss'] },
  { id: 'fischallergie', label: 'Fisch- / Meeresfrüchteallergie', tags: ['fisch'] },
  { id: 'eiallergie', label: 'Eiallergie', tags: ['ei'] },
  { id: 'milchallergie', label: 'Milcheiweißallergie', tags: ['milch'] },
  { id: 'sellerieallergie', label: 'Sellerieallergie', tags: ['sellerie'] },
  { id: 'schilddruese', label: 'Schilddrüsenunterfunktion / Hashimoto', tags: ['schilddruese'] },
  { id: 'osteoporose', label: 'Osteoporose', tags: ['osteoporose'] },
  { id: 'eisenmangel', label: 'Eisenmangel / Anämie', tags: ['eisen'] },
  { id: 'uebergewicht', label: 'Übergewicht', tags: ['gewicht'] },
  { id: 'untergewicht', label: 'Untergewicht', tags: ['untergewicht'] },
  { id: 'migraene', label: 'Migräne', tags: ['migraene'] },
  { id: 'pcos', label: 'PCOS', tags: ['diabetes'] },
  { id: 'rheuma', label: 'Rheuma / Arthritis', tags: ['rheuma'] },
  { id: 'arthrose', label: 'Arthrose', tags: ['arthrose'] },
  { id: 'schwanger', label: 'Schwangerschaft', tags: ['schwanger'] },
  { id: 'stillzeit', label: 'Stillzeit', tags: ['schwanger'] },
];
const BY_ID = Object.fromEntries(CONDITIONS.map(c => [c.id, c]));
export const conditionLabel = id => BY_ID[id]?.label ?? id; // eigene Einträge: Text = id
export const conditionTags = ids => ids.flatMap(id => BY_ID[id]?.tags ?? []);

// Suche: Einträge, deren Name mit der Eingabe beginnt; ab 2 Zeichen auch Wortanfänge im Namen (z. B. „ref“ → Sodbrennen / Reflux)
export function searchConditions(q, exclude = []) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const words = l => l.toLowerCase().split(/[\s/()\-]+/).filter(Boolean);
  return CONDITIONS.filter(c => !exclude.includes(c.id))
    .map(c => ({ c, rank: c.label.toLowerCase().startsWith(q) ? 0 : q.length > 1 && words(c.label).some(w => w.startsWith(q)) ? 1 : 9 }))
    .filter(x => x.rank < 9).sort((a, b) => a.rank - b.rank || a.c.label.localeCompare(b.c.label, 'de')).map(x => x.c);
}
