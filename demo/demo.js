// Demo-Modus: eigene Datenablage (Präfix "demo:"), Beispieldaten, Hinweisleiste, Zurücksetzen.
// Wird als klassisches Script VOR app.js geladen. Echte Daten werden nie gelesen oder geschrieben.
(function () {
  const P = 'demo:';
  const S = Storage.prototype, get = S.getItem, set = S.setItem, rem = S.removeItem;
  S.getItem = function (k) { return get.call(this, P + k); };
  S.setItem = function (k, v) { return set.call(this, P + k, v); };
  S.removeItem = function (k) { return rem.call(this, P + k); };
  S.clear = function () { for (const k of Object.keys(this)) if (k.startsWith(P)) rem.call(this, k); };
  // Keine echten Benachrichtigungen/Hintergrunddienste in der Demo
  try { if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.resolve({}); } catch {}

  const day = 86400000;
  const iso = n => { const d = new Date(Date.now() + n * day); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const at = n => new Date(Date.now() + n * day).toISOString();
  const untilWed = (() => { const d = new Date(); return iso((3 - d.getDay() + 7) % 7 || 7); })();
  const untilSat = (() => { const d = new Date(); return iso((6 - d.getDay() + 7) % 7 || 7); })();
  let n = 0; const id = () => 'demo-' + (++n);

  function seed() {
    const it = (name, category, location, expiry, price, size, extra = {}) =>
      ({ id: id(), name, category, location, expiry: iso(expiry), price, size, qty: 1, unit: 'Stk', addedAt: at(-3), ...extra });
    const items = [
      it('Rinderhackfleisch 500 g', 'Fleisch & Fisch', 'Gefrierschrank', 110, 5.49, '500 g', { frozenAt: iso(-10), origExpiry: iso(-8) }),
      it('Hähnchenbrustfilet', 'Fleisch & Fisch', 'Kühlschrank', 1, 4.79, '400 g'),
      it('Joghurt natur 3,5 %', 'Milchprodukte', 'Kühlschrank', 0, 0.79, '500 g'),
      it('Fettarme Milch 1,5 %', 'Milchprodukte', 'Kühlschrank', 3, 1.09, '1 l'),
      it('Gouda jung', 'Milchprodukte', 'Kühlschrank', 12, 2.29, '400 g'),
      it('Butter', 'Milchprodukte', 'Kühlschrank', 25, 2.39, '250 g'),
      it('Eier Freiland', 'Eier', 'Kühlschrank', 16, 2.69, '10 Stk', { qty: 10, unit: 'Stk' }),
      it('Paprika rot', 'Gemüse', 'Kühlschrank', 4, 1.99, '500 g'),
      it('Dinkel-Vollkorn-Toast', 'Brot & Backwaren', 'Vorratsschrank', 5, 1.49, '500 g'),
      it('Äpfel Elstar', 'Obst', 'Vorratsschrank', 9, 2.49, '1 kg'),
      it('Vollkorn-Spaghetti', 'Trockenware', 'Vorratsschrank', 290, 0.99, '500 g'),
      it('Lachsfilet TK', 'Tiefkühl', 'Gefrierschrank', 140, 4.99, '250 g'),
      it('Spinat TK', 'Tiefkühl', 'Gefrierschrank', 200, 1.19, '750 g'),
    ];
    const log = [];
    const buy = (ago, itemName, category, price, size) => log.push({ id: id(), type: 'bought', itemName, category, qty: 1, unit: 'Stk', size, price, at: at(-ago) });
    // Einkäufe der letzten ~7 Wochen (für Bilanz, „Wieder kaufen?“ und Preisvergleich)
    for (const w of [2, 9, 16, 23, 30, 37, 44]) {
      buy(w, 'Rinderhackfleisch 500g', 'Fleisch & Fisch', 5.49, '500 g');
      buy(w, 'Fettarme Milch 1,5%', 'Milchprodukte', 1.09, '1 l');
      buy(w, 'Dinkel-Vollkorn-Toast', 'Brot & Backwaren', 1.49, '500 g');
      if (w % 2) buy(w, 'Butter 250g', 'Milchprodukte', 2.39, '250 g');
      if (w < 30) buy(w + 1, 'Lachsfilet', 'Fleisch & Fisch', 4.99, '250 g');
      buy(w, 'Paprika rot', 'Gemüse', 1.99, '500 g');
      buy(w + 1, 'Äpfel Elstar', 'Obst', 2.49, '1 kg');
      if (w % 3 === 0) buy(w, 'Mozzarella', 'Milchprodukte', 0.99, '125 g');
      if (w % 2 === 0) buy(w + 2, 'Joghurt natur 3,5%', 'Milchprodukte', 0.79, '500 g');
    }
    buy(3, 'Pfand Mehrweg', 'Pfand', 0.75, null);
    const use = (ago, type, itemName, category, value) => log.push({ id: id(), type, itemName, category, qty: 1, unit: 'Stk', value, at: at(-ago) });
    use(4, 'eaten', 'Rinderhackfleisch 500g', 'Fleisch & Fisch', 5.49);
    use(6, 'eaten', 'Fettarme Milch 1,5%', 'Milchprodukte', 1.09);
    use(8, 'wasted', 'Joghurt natur 3,5%', 'Milchprodukte', 0.79);
    use(12, 'wasted', 'Paprika rot', 'Gemüse', 0.99);
    use(26, 'wasted', 'Dinkel-Vollkorn-Toast', 'Brot & Backwaren', 0.75);
    localStorage.setItem('speisekammer.v1', JSON.stringify({ items, log }));

    const shop = ['Rinderhackfleisch', 'Butter', 'Toastbrot', 'Mozzarella', 'Gurke', 'Bananen'];
    localStorage.setItem('speisekammer.shopping', JSON.stringify(shop.map(name => ({ id: id(), name, done: false }))));
    localStorage.setItem('speisekammer.offers', JSON.stringify([
      { id: id(), source: 'manual', chain: 'rewe', name: 'Rinderhackfleisch', price: 3.99, regular: 5.99, until: untilSat },
      { id: id(), source: 'manual', chain: 'rewe', name: 'Deutsche Markenbutter', price: 1.79, regular: 2.49, until: untilSat },
      { id: id(), source: 'manual', chain: 'lidl', name: 'Mozzarella', price: 0.79, regular: 0.99, until: untilSat },
      { id: id(), source: 'manual', chain: 'aldi-nord', name: 'Lachsfilet', price: 3.49, regular: 4.99, until: untilSat },
      { id: id(), source: 'manual', chain: 'kaufland', name: 'Dinkel-Vollkorn-Toast', price: 1.19, regular: 1.49, until: untilWed },
    ]));
    localStorage.setItem('demo.seeded', '1');
  }
  if (!localStorage.getItem('demo.seeded')) seed();

  const SAMPLE_BON = `Lidl
Fettarme Milch 1,5%        1,09 A
Bio Bananen                1,49 A
Rinderhackfleisch 500g     5,49 A
Gurke                      0,69 A
Mozzarella                 0,99 A
  2 x 0,99
Dinkel Vollkorn Brot       1,79 A
Pfand 0,25 EUR             0,25 B
Summe                     12,77`;

  // Zweimal tippen statt Bestätigungsdialog (Dialoge sind in der Vorschau gesperrt)
  let armed = null;
  function reset(e) {
    const b = e.currentTarget;
    if (!armed) { b.textContent = 'Wirklich? Nochmal tippen'; armed = setTimeout(() => { armed = null; b.textContent = 'Zurücksetzen'; }, 4000); return; }
    localStorage.clear(); location.reload();
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.body.insertAdjacentHTML('afterbegin', `<div id="demo-bar">🧪 <b>Demo</b> mit Beispieldaten. Probier alles aus, nichts geht kaputt.
      <button id="demo-help" class="chip">Rundgang</button> <button id="demo-reset" class="chip">Zurücksetzen</button></div>
      <dialog id="demo-intro"><form method="dialog">
        <h2>Willkommen in der Speisekammer 👋</h2>
        <p class="muted">Das ist eine Demo mit ausgedachten Beispieldaten. Du kannst alles antippen, ändern und löschen. Mit „Zurücksetzen“ oben ist alles wieder wie am Anfang.</p>
        <ul class="demo-tour">
          <li><b>🥫 Vorrat:</b> Was zu Hause ist. Oben die Warnungen für bald ablaufende Sachen. Artikel antippen zum Verbrauchen, Einfrieren oder Wegwerfen. Mit ＋ etwas Neues anlegen; bei Fleisch fragt die App, ob es eingefroren wird.</li>
          <li><b>🧾 Bon:</b> Kassenbon fotografieren oder Text einfügen. In der Demo gibt es einen Beispiel-Bon zum Ausprobieren.</li>
          <li><b>📅 Plan:</b> Beispiel-Wochenplan (Vorschau): Frühstück und Abendessen, passend zum Vorrat und zu bald ablaufenden Sachen. Gericht tauschen, als gekocht markieren oder Fehlendes auf die Einkaufsliste setzen.</li>
          <li><b>🛒 Einkauf:</b> Einkaufsliste mit Tipps (z. B. beim Toast), Angeboten der Läden und dem Einkaufs-Check: lohnt sich ein zweiter Laden?</li>
          <li><b>📊 Verlauf:</b> Was gekauft, gegessen und weggeworfen wurde, mit Monatsbilanz in Euro.</li>
          <li><b>⚙️ Einstellungen:</b> Erinnerungen, Tipps, Stammladen und mehr. Alles per Antippen.</li>
        </ul>
        <p class="tiny muted">Der Essensplan ist hier eine Vorschau mit Beispielgerichten; der richtige Planer mit euren Lieblingsgerichten kommt später. Die automatische Angebotssuche braucht den Server, die Angebote hier sind Beispiele.</p>
        <button value="ok" class="primary">Los geht's</button>
      </form></dialog>`);
    const intro = document.getElementById('demo-intro');
    document.getElementById('demo-help').onclick = () => intro.showModal();
    document.getElementById('demo-reset').onclick = reset;
    if (!localStorage.getItem('demo.introSeen')) { intro.showModal(); localStorage.setItem('demo.introSeen', '1'); }
    // Beispiel-Bon im Bon-Tab
    const parse = document.getElementById('scan-parse');
    if (parse) {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'primary', textContent: '🧾 Beispiel-Bon ausprobieren' });
      b.onclick = () => { const t = document.getElementById('scan-text'); t.value = SAMPLE_BON; t.closest('details').open = true; parse.click(); };
      document.getElementById('scan-status').before(b);
    }
  });
})();
