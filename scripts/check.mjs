// Statische Prüfungen ohne Abhängigkeiten: node scripts/check.mjs
//  1. Syntax aller Browser-Module (Root, budget/, supabase/functions nicht – die sind TypeScript)
//  2. Service Worker: jede gelistete Datei existiert, jedes Root-Modul ist gelistet (außer Entwürfen)
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Bewusst nicht im Service Worker (Entwürfe, noch nicht aktiv)
const NOT_IN_SW = { '.': ['profile.js'], budget: [] };
const errors = [];

for (const dir of ['.', 'budget']) {
  const jsFiles = readdirSync(dir).filter(f => f.endsWith('.js'));
  // 1. Syntax: als .mjs kopieren, damit Node import/export akzeptiert
  const tmp = mkdtempSync(join(tmpdir(), 'check-'));
  for (const f of jsFiles) {
    const copy = join(tmp, f + '.mjs');
    writeFileSync(copy, readFileSync(join(dir, f)));
    try { execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' }); }
    catch (e) { errors.push(`Syntaxfehler in ${join(dir, f)}:\n${String(e.stderr).split('\n').slice(0, 6).join('\n')}`); }
  }
  rmSync(tmp, { recursive: true, force: true });

  // 2. Service Worker
  const sw = readFileSync(join(dir, 'sw.js'), 'utf8');
  const listed = [...(sw.match(/const FILES = \[([\s\S]*?)\];/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(m => m[1]);
  if (!listed.length) errors.push(`${dir}/sw.js: FILES nicht gefunden`);
  for (const f of listed) if (f !== './' && !existsSync(join(dir, f))) errors.push(`${dir}/sw.js listet fehlende Datei: ${f}`);
  for (const f of jsFiles) if (f !== 'sw.js' && !listed.includes(f) && !NOT_IN_SW[dir].includes(f)) errors.push(`${dir}/${f} fehlt in ${dir}/sw.js (offline nicht verfügbar)`);
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('Prüfungen bestanden.');
