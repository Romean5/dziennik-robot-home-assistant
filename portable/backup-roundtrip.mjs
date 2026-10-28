#!/usr/bin/env node

// Export an admin's data from one instance and optionally import it into
// another. The JSON file contains PIN hashes and photo bytes; protect it like
// a password backup and delete it after a verified transfer.
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const source = process.env.DR_SOURCE_URL || process.argv[2] || 'http://127.0.0.1:3000';
const target = process.env.DR_TARGET_URL || process.argv[3] || '';
const name = process.env.DR_ADMIN_NAME;
const pin = process.env.DR_ADMIN_PIN;
const file = process.env.DR_BACKUP_FILE || 'dziennik-robot-backup.json';

if (!name || !pin) {
  console.error('Ustaw DR_ADMIN_NAME i DR_ADMIN_PIN. Opcjonalnie DR_SOURCE_URL, DR_TARGET_URL oraz DR_BACKUP_FILE.');
  process.exit(2);
}

async function login(baseUrl) {
  const response = await fetch(new URL('/api/auth', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, pin }),
  });
  if (!response.ok) throw new Error(`Logowanie nieudane (${response.status})`);
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  if (!cookie) throw new Error('Instancja nie zwróciła sesji');
  return cookie;
}

function verifyBackup(backup) {
  if (backup?.manifest?.format !== 'dziennik-robot-backup' || backup.manifest.schemaVersion !== 1 || !backup.payload) throw new Error('Nieprawidłowy format backupu');
  const actual = createHash('sha256').update(JSON.stringify(backup.payload)).digest('hex');
  if (actual !== backup.manifest.payloadSha256) throw new Error('Nieprawidłowa suma kontrolna backupu');
  return backup;
}

function canonicalPayload(payload) {
  const sortRows = (rows) => rows.map((row) => ({ ...row })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify({
    teams: sortRows(payload.teams),
    users: sortRows(payload.users),
    projects: sortRows(payload.projects),
    entries: sortRows(payload.entries),
    photos: sortRows(payload.photos),
  });
}

const sourceCookie = await login(source);
const exportResponse = await fetch(new URL('/api/admin/backup', source), { headers: { cookie: sourceCookie } });
if (!exportResponse.ok) throw new Error(`Eksport nieudany (${exportResponse.status})`);
const backup = verifyBackup(await exportResponse.json());
await writeFile(file, JSON.stringify(backup, null, 2), { mode: 0o600 });
console.log(`Eksport zapisany: ${file}`);
console.log(`Rekordy: ${JSON.stringify(backup.manifest.counts)}; wygenerowano ${backup.manifest.generatedAt}`);

if (target) {
  const targetCookie = await login(target);
  const importResponse = await fetch(new URL('/api/admin/backup', target), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: targetCookie },
    body: JSON.stringify(backup),
  });
  const result = await importResponse.json().catch(() => ({}));
  if (!importResponse.ok) throw new Error(`Import nieudany (${importResponse.status}): ${JSON.stringify(result)}`);
  console.log(`Import zakończony: ${JSON.stringify(result.imported)}`);
  const verifyResponse = await fetch(new URL('/api/admin/backup', target), { headers: { cookie: targetCookie } });
  if (!verifyResponse.ok) throw new Error(`Weryfikacja po imporcie nieudana (${verifyResponse.status})`);
  const restored = verifyBackup(await verifyResponse.json());
  if (JSON.stringify(restored.manifest.counts) !== JSON.stringify(backup.manifest.counts)) throw new Error('Liczność po imporcie nie zgadza się z backupem');
  if (canonicalPayload(restored.payload) !== canonicalPayload(backup.payload)) throw new Error('Dane po imporcie nie zgadzają się z backupem');
  console.log('Weryfikacja po imporcie: liczności i suma kontrolna są poprawne.');
}
