// Passende Stellen aus Versicherungspolicen finden (ohne Server, ohne KI).
// Policen haben oft 30–80 Seiten. Die KI bekommt nicht alles, sondern die Seite 1 (Versicherungsschein mit Leistungsübersicht)
// und die Abschnitte, die am besten zur Frage passen. So bleibt die Anfrage klein, und jede Antwort kann eine Seite nennen.
import { norm } from './logic.js';

const STOP = new Set(('der die das den dem des ein eine einer eines einem einen und oder aber ist sind war wird werden wurde bin bist '
  + 'ich du er sie es wir ihr mein meine meiner meinem meinen mir mich dir dich sich uns euch was wer wie wo wann warum welche welcher '
  + 'welches welchen ob auch noch schon nur nicht kein keine mit von vom zu zum zur im in an am auf aus bei fur uber unter nach vor '
  + 'durch gegen ohne um bis als so da dann denn wenn weil dass habe hat haben hatte kann konnen muss mussen soll sollte darf gibt '
  + 'versicherung versichert versicherungen police abgedeckt gedeckt zahlt zahlen bezahlt eigentlich bitte mal gilt').split(' '));

// Begriffe, die in Bedingungen anders heißen als im Alltag
const SYN = {
  marder: ['marderbiss', 'tierbiss', 'kurzschluss'], tier: ['tierbiss', 'wild', 'haarwild'], wild: ['wildschaden', 'haarwild', 'zusammenstoss'],
  scheibe: ['glas', 'glasbruch', 'verglasung'], glas: ['glasbruch', 'scheibe', 'verglasung'], steinschlag: ['glas', 'glasbruch'],
  selbstbeteiligung: ['selbstbehalt', 'sb'], selbstbehalt: ['selbstbeteiligung'], eigenanteil: ['selbstbeteiligung', 'selbstbehalt'],
  ausland: ['geltungsbereich', 'europa', 'weltweit'], urlaub: ['ausland', 'reise', 'geltungsbereich', 'erholungsurlaub', 'urlaubsanspruch'],
  diebstahl: ['entwendung', 'einbruchdiebstahl', 'raub'], geklaut: ['diebstahl', 'entwendung'], gestohlen: ['diebstahl', 'entwendung'],
  fahrrad: ['fahrraddiebstahl', 'fahrrader'], rad: ['fahrrad'], einbruch: ['einbruchdiebstahl'],
  kundigen: ['kundigung', 'kundigungsfrist', 'vertragsdauer', 'laufzeit', 'beendigung'], kundigung: ['kundigungsfrist', 'vertragsdauer'],
  kosten: ['beitrag', 'pramie'], beitrag: ['pramie', 'zahlungsweise'], preis: ['beitrag', 'pramie'],
  unfall: ['unfallschaden', 'kollision', 'vollkasko'], kasko: ['teilkasko', 'vollkasko'], schutzbrief: ['pannenhilfe', 'abschleppen'],
  panne: ['pannenhilfe', 'schutzbrief', 'abschleppen'], abschleppen: ['schutzbrief', 'pannenhilfe'],
  wasser: ['leitungswasser', 'nasse'], sturm: ['hagel', 'elementar'], hochwasser: ['elementar', 'uberschwemmung', 'starkregen'],
  blitz: ['uberspannung', 'blitzschlag'], schlussel: ['schlusselverlust'], geliehen: ['geliehene', 'gemietete', 'fremde'],
  mietwohnung: ['mietsachschaden', 'mietsachen'], wohnung: ['mietsachschaden', 'wohnung'], handy: ['smartphone', 'elektronik'],
  summe: ['deckungssumme', 'versicherungssumme'], deckung: ['deckungssumme', 'leistung', 'umfang'], ausgeschlossen: ['ausschluss', 'ausschlusse', 'nicht versichert'],
  wartezeit: ['wartezeit', 'karenz'],
  urlaubstage: ['urlaub', 'erholungsurlaub', 'urlaubsanspruch', 'arbeitstage'], urlaubsgeld: ['sonderzahlung', 'gratifikation', 'urlaubsgeld'],
  weihnachtsgeld: ['sonderzahlung', 'gratifikation', 'weihnachtsgeld'], gehalt: ['vergutung', 'entgelt', 'bruttomonatsgehalt', 'gehalt'], lohn: ['vergutung', 'entgelt'],
  stunden: ['arbeitszeit', 'wochenarbeitszeit', 'stunden'], arbeitszeit: ['wochenarbeitszeit', 'stunden'], uberstunden: ['mehrarbeit', 'uberstunden', 'abgegolten'],
  probezeit: ['probezeit', 'erprobung'], homeoffice: ['mobiles', 'arbeiten', 'homeoffice', 'telearbeit'], krank: ['arbeitsunfahigkeit', 'entgeltfortzahlung', 'krankheit'],
  kaution: ['mietsicherheit', 'kaution'], haustier: ['tierhaltung', 'haustiere', 'tiere'], haustiere: ['tierhaltung', 'tiere'], renovieren: ['schonheitsreparaturen', 'renovierung'],
  schonheitsreparaturen: ['schonheitsreparaturen', 'renovierung'], untervermieten: ['untervermietung', 'gebrauchsuberlassung', 'dritte'], nebenkosten: ['betriebskosten', 'nebenkosten'],
  roaming: ['ausland', 'eu', 'roaming'], datenvolumen: ['datenvolumen', 'gb', 'daten'], preisgarantie: ['preisgarantie', 'preisanpassung'], zahn: ['zahnersatz', 'zahnbehandlung'], brille: ['sehhilfe'], rucktransport: ['rucktransport', 'krankentransport'],
};

// Sehr einfache Stammformbildung für deutsche Wörter (Endungen abschneiden), damit „Fahrräder“ auch „Fahrrad“ findet
export function stem(w) {
  w = w.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
  for (const suf of ['ungen', 'heiten', 'keiten', 'ung', 'en', 'er', 'es', 'e', 'n', 's']) if (w.length - suf.length >= 4 && w.endsWith(suf)) return w.slice(0, -suf.length);
  return w;
}
const words = s => norm(s).replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u').split(/[^a-z0-9]+/).filter(Boolean);

export function queryTerms(q) {
  const base = words(q).filter(w => w.length >= 3 && !STOP.has(w));
  const out = new Map(); // Stamm → Gewicht (Synonyme zählen halb)
  for (const w of base) {
    out.set(stem(w), 1);
    for (const s of SYN[w] ?? SYN[stem(w)] ?? []) for (const x of words(s)) if (!out.has(stem(x))) out.set(stem(x), 0.5);
  }
  return out;
}

// Seiten in Abschnitte teilen (ca. 900 Zeichen, an Absätzen bzw. Sätzen getrennt)
export function chunkPages(pages, meta, size = 900) {
  const out = [];
  pages.forEach((text, i) => {
    const clean = String(text ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!clean) return;
    const parts = clean.split(/(?<=[.!?:;])\s+|\n+/);
    let buf = '';
    for (const p of parts) {
      if (buf && (buf.length + p.length) > size) { out.push({ ...meta, page: i + 1, text: buf.trim() }); buf = ''; }
      buf += (buf ? ' ' : '') + p;
      while (buf.length > size * 1.6) { out.push({ ...meta, page: i + 1, text: buf.slice(0, size).trim() }); buf = buf.slice(size); }
    }
    if (buf.trim()) out.push({ ...meta, page: i + 1, text: buf.trim() });
  });
  return out;
}

// Abschnitte nach Passung bewerten (BM25-ähnlich, aber mit Teilwort-Treffern für zusammengesetzte Wörter wie „Marderbissschäden“)
export function rank(chunks, question) {
  const terms = queryTerms(question);
  if (!terms.size || !chunks.length) return [];
  const docs = chunks.map(c => ' ' + words(c.text).join(' ') + ' ');
  const avg = docs.reduce((a, d) => a + d.length, 0) / docs.length;
  const df = new Map();
  for (const t of terms.keys()) df.set(t, docs.filter(d => d.includes(t)).length);
  const N = docs.length, k1 = 1.2, b = 0.75;
  return chunks.map((c, i) => {
    let score = 0, hits = 0;
    for (const [t, wgt] of terms) {
      const d = docs[i]; let tf = 0, pos = d.indexOf(t);
      while (pos >= 0) { tf += d[pos - 1] === ' ' ? 1 : 0.6; pos = d.indexOf(t, pos + t.length); } // Wortanfang zählt mehr als Wortmitte
      if (!tf) continue;
      hits++;
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
      score += wgt * idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * d.length / avg));
    }
    if (hits > 1) score *= 1 + 0.15 * (hits - 1); // mehrere Fragewörter im selben Abschnitt
    return { ...c, score };
  }).filter(c => c.score > 0).sort((a, b) => b.score - a.score);
}

// Auswahl für die KI: Seite 1 jeder betroffenen Police (gekürzt) plus die besten Treffer, zusammen höchstens maxChars
export function selectExcerpts(policies, question, { maxChars = 11000, first = 1400, top = 10 } = {}) {
  const all = policies.flatMap(p => chunkPages(p.pages ?? [], { policyId: p.id, policy: p.name }));
  const ranked = rank(all, question);
  const picked = [], seen = new Set();
  let used = 0;
  const add = c => {
    const key = c.policyId + '|' + c.page + '|' + c.text.slice(0, 40);
    if (seen.has(key) || used + c.text.length > maxChars) return false;
    seen.add(key); picked.push(c); used += c.text.length; return true;
  };
  // Versicherungsschein (Seite 1) der Policen, die Treffer haben, oder aller, wenn es nur eine ist
  const relevant = new Set(ranked.slice(0, top).map(c => c.policyId));
  for (const p of policies) {
    if (policies.length > 1 && !relevant.has(p.id)) continue;
    const p1 = (p.pages?.[0] ?? '').replace(/\s+/g, ' ').trim();
    if (p1) add({ policyId: p.id, policy: p.name, page: 1, text: p1.slice(0, first), score: 0, cover: true });
  }
  for (const c of ranked.slice(0, top * 2)) { if (picked.length >= top + policies.length) break; add(c); }
  return { excerpts: picked, matched: ranked.length };
}
