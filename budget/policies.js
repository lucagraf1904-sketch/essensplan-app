// Versicherungspolicen: PDF im Browser auslesen (pdf.js liegt in vendor/), eingescannte Seiten per KI abschreiben,
// und der Chat „Police fragen“. Die Suche nach passenden Stellen läuft auf dem Gerät (retrieval.js);
// an die KI gehen nur die gefundenen Auszüge, nie die ganze Datei.
import { selectExcerpts } from './retrieval.js';
import { POLICY_QUESTIONS, cat, contractType } from './categories.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let pdfjs = null;
async function loadPdfJs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import('./vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
  return pdfjs;
}

// Text je Seite. Zeilenumbrüche aus der Lage der Textstücke ableiten, damit Absätze erhalten bleiben.
export async function extractPdfText(file, onProgress = () => {}) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let out = '', lastY = null;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = it.transform?.[5];
      if (lastY != null && y != null && Math.abs(y - lastY) > 2) out += '\n';
      else if (out && !out.endsWith(' ') && !out.endsWith('\n') && it.str && !it.str.startsWith(' ')) out += ' ';
      out += it.str; if (it.hasEOL) out += '\n';
      lastY = y;
    }
    pages.push(out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/-\n(?=[a-zäöüß])/g, '').trim());
    onProgress(i / doc.numPages);
  }
  return { pages, numPages: doc.numPages, doc };
}

// Seiten eines PDFs als Bild (für eingescannte Policen ohne Text)
export async function renderPdfPage(doc, n, max = 1600) {
  const page = await doc.getPage(n);
  const v0 = page.getViewport({ scale: 1 });
  const scale = Math.min(2.5, max / Math.max(v0.width, v0.height));
  const vp = page.getViewport({ scale });
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(vp.width), height: Math.round(vp.height) });
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  return c.toDataURL('image/jpeg', 0.82);
}

export async function photoToDataUrl(file, max = 1400, quality = 0.82) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('Das Foto konnte nicht gelesen werden.');
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

// Datei lesen → { pages, source, note }. Eingescannte PDFs: bis zu maxScan Seiten über die KI abschreiben lassen (kostet Foto-Kontingent).
export async function readPolicyFile(file, store, { onProgress = () => {}, confirmScan = async () => false, maxScan = 6 } = {}) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    onProgress(0.2);
    const r = await store.askAi({ action: 'parse', kind: 'doc', image: await photoToDataUrl(file) });
    onProgress(1);
    const t = String(r?.data?.text ?? '').trim();
    if (!t) throw new Error('Auf dem Foto wurde kein Text erkannt.');
    return { pages: [t], source: 'photo', note: 'Foto per KI abgeschrieben. Bitte bei wichtigen Punkten mit dem Original vergleichen.' };
  }
  const { pages, numPages, doc } = await extractPdfText(file, p => onProgress(p * 0.9));
  const chars = pages.reduce((a, p) => a + p.length, 0);
  if (chars / Math.max(1, numPages) >= 80) { onProgress(1); return { pages, source: 'pdf', note: `${numPages} Seiten gelesen.` }; }
  // Kaum Text: wahrscheinlich eingescannt
  const n = Math.min(numPages, maxScan);
  if (!(await confirmScan(numPages, n))) return { pages, source: 'pdf', note: 'Die PDF enthält kaum lesbaren Text (vermutlich eingescannt). Fragen funktionieren erst, wenn Text vorhanden ist: Seiten per KI abschreiben lassen oder Text selbst einfügen.' };
  const out = [];
  let stop = null;
  for (let i = 1; i <= n; i++) {
    try {
      const r = await store.askAi({ action: 'parse', kind: 'doc', image: await renderPdfPage(doc, i) });
      out.push(String(r?.data?.text ?? '').trim());
    } catch (e) { stop = e; break; }
    onProgress(0.9 + 0.1 * i / n);
  }
  if (!out.some(Boolean)) throw stop ?? new Error('Auf den Seiten wurde kein Text erkannt.');
  const why = stop ? ` Abgebrochen bei Seite ${out.length + 1}: ${stop.message}` : numPages > n ? ` Mehr als ${n} Seiten werden nicht auf einmal abgeschrieben (Tageslimit für Fotos).` : '';
  return { pages: out, source: 'photo', note: `${out.length} von ${numPages} Seiten per KI abgeschrieben.${why} Bei wichtigen Punkten mit dem Original vergleichen.` };
}

// Eingefügten Text in Seiten teilen (Trenner: Zeile mit ---- oder Seitenumbruch-Zeichen)
export const splitPastedText = t => String(t ?? '').split(/\n\s*-{4,}\s*\n|\f/).map(s => s.trim()).filter(Boolean);

// ---------- Chat ----------
export function initChat(ctx) {
  const $ = s => document.querySelector(s);
  const dlg = $('#dlg-chat');
  let history = [], busy = false;
  const pageCache = new Map();

  const policiesWithText = () => ctx.state.policies.filter(p => p.pageCount > 0);
  async function pagesFor(p) {
    if (!pageCache.has(p.id + p.pageCount)) pageCache.set(p.id + p.pageCount, await ctx.store.policyPages(p.id));
    return pageCache.get(p.id + p.pageCount);
  }

  const fmt = (t, excerpts) => esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\[\]]{1,90}?),\s*S\.\s*(\d{1,3})\]/g, (m, name, page) => {
      const p = ctx.state.policies.find(x => esc(x.name) === name.trim()) ?? (ctx.state.policies.length === 1 ? ctx.state.policies[0] : null);
      return `<button type="button" class="src" data-src-pol="${p ? esc(p.id) : ''}" data-page="${page}" title="Seite ${page} öffnen">${name.trim()}, S. ${page}</button>`;
    })
    .replace(/\n/g, '<br>');

  function sourcesHtml(excerpts, open = false) {
    if (!excerpts?.length) return '';
    return `<details ${open ? 'open' : ''}><summary>Gefundene Stellen (${excerpts.length})</summary>${excerpts.map(x =>
      `<blockquote><cite>${esc(x.policy)}, S. ${x.page}${x.cover ? ' (erste Seite)' : ''}</cite>${esc(x.text.length > 700 ? x.text.slice(0, 700) + ' …' : x.text)}</blockquote>`).join('')}</details>`;
  }

  function draw() {
    const scopeId = $('#chat-scope').value;
    const pol = ctx.state.policies.find(p => p.id === scopeId);
    const withText = policiesWithText();
    let intro = '';
    if (!withText.length) intro = '<p class="muted">Noch kein Vertrag mit Text hinterlegt. Unter „Verträge“ einen Vertrag öffnen und das Dokument als PDF oder Foto hinzufügen.</p>';
    else if (!history.length) intro = `<p class="muted">Frag in eigenen Worten, z. B. ob etwas versichert ist, wie hoch die Selbstbeteiligung ist oder wie du kündigen kannst. Die Antwort nennt die Seite, auf der es steht.</p>`;
    $('#chat-msgs').innerHTML = intro + history.map(m => m.role === 'user'
      ? `<div class="msg-u">${esc(m.content)}</div>`
      : `<div class="msg-a">${m.error ? `<p>${esc(m.content)}</p>` : fmt(m.content)}${sourcesHtml(m.excerpts, m.error)}</div>`).join('')
      + (busy ? '<div class="msg-a typing">Ich lese im Dokument nach</div>' : '');
    $('#chat-msgs').scrollTop = $('#chat-msgs').scrollHeight;
    const qs = POLICY_QUESTIONS[pol?.category] ?? (pol && contractType(pol.category).id !== 'ins' ? POLICY_QUESTIONS.defaultContract : POLICY_QUESTIONS.default);
    $('#chat-chips').innerHTML = !history.length && withText.length ? qs.map(q => `<button type="button" class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('') : '';
    $('#chat-input').disabled = !withText.length;
    const ty = pol ? contractType(pol.category).id : null;
    $('#chat-input').placeholder = ty === 'work' ? 'z. B. Wie viele Urlaubstage habe ich?' : ty && ty !== 'ins' ? 'z. B. Wie kann ich kündigen?' : 'z. B. Ist Marderbiss abgedeckt?';
  }

  async function send(q) {
    q = q.trim(); if (!q || busy) return;
    const scopeId = $('#chat-scope').value;
    const scope = (scopeId ? ctx.state.policies.filter(p => p.id === scopeId) : policiesWithText()).filter(p => p.pageCount > 0);
    if (!scope.length) { ctx.toast('Für diesen Vertrag ist noch kein Text hinterlegt.'); return; }
    history.push({ role: 'user', content: q }); busy = true; $('#chat-input').value = ''; draw();
    let excerpts = [];
    try {
      const full = await Promise.all(scope.map(async p => ({ ...p, pages: await pagesFor(p) })));
      // Für Rückfragen („und bei Glas?“) die vorige Frage mit in die Suche nehmen
      const prev = history.filter(m => m.role === 'user').slice(-2, -1).map(m => m.content).join(' ');
      ({ excerpts } = selectExcerpts(full, q + ' ' + prev));
      const r = await ctx.store.askAi({ action: 'policy', messages: history.slice(-6).map(m => ({ role: m.role, content: m.content })), excerpts: excerpts.map(x => ({ policy: x.policy, page: x.page, text: x.text })) });
      history.push({ role: 'assistant', content: r.text, excerpts });
    } catch (e) {
      const why = e.demo ? 'In der Demo ist keine KI verbunden.' : `Die KI hat nicht geantwortet: ${e.message}`;
      history.push({ role: 'assistant', error: true, content: `${why} ${excerpts.length ? 'Hier sind die passendsten Stellen aus dem Dokument, damit du selbst nachlesen kannst:' : 'Es wurden auch keine passenden Stellen gefunden.'}`, excerpts });
    }
    busy = false; draw();
  }

  async function openSource(id, page) {
    const p = ctx.state.policies.find(x => x.id === id);
    if (!p?.filePath) { ctx.toast('Für diesen Vertrag ist keine Datei gespeichert, nur der Text.'); return; }
    try { const url = await ctx.store.policyFileUrl(p.filePath); window.open(url + (p.fileName?.toLowerCase().endsWith('.pdf') ? `#page=${page}` : ''), '_blank', 'noopener'); }
    catch (e) { ctx.toast(e.message); }
  }

  $('#chat-form').addEventListener('submit', e => { e.preventDefault(); send($('#chat-input').value); });
  $('#chat-chips').addEventListener('click', e => { const b = e.target.closest('[data-q]'); if (b) send(b.dataset.q); });
  $('#chat-msgs').addEventListener('click', e => { const b = e.target.closest('.src'); if (b?.dataset.srcPol) openSource(b.dataset.srcPol, b.dataset.page); });
  $('#chat-new').addEventListener('click', () => { history = []; draw(); $('#chat-input').focus(); });
  $('#chat-scope').addEventListener('change', () => { history = []; draw(); });

  return {
    open(policyId = '') {
      const list = ctx.state.policies;
      $('#chat-scope').innerHTML = `<option value="">Alle Verträge (${policiesWithText().length} mit Dokument)</option>`
        + list.map(p => `<option value="${esc(p.id)}" ${p.pageCount ? '' : 'disabled'}>${esc(cat(p.category).icon)} ${esc(p.name)}${p.pageCount ? '' : ' (kein Dokument)'}</option>`).join('');
      if ($('#chat-scope').value !== policyId) { history = []; $('#chat-scope').value = policyId; }
      draw(); dlg.showModal();
      if (matchMedia('(min-width: 700px)').matches) $('#chat-input').focus();
    },
    clearCache() { pageCache.clear(); },
  };
}
