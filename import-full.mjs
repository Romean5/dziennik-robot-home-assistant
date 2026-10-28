import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

// Offline migration: never opens or replaces an existing application directory.
const [input, photo, schemaPath, destination] = process.argv.slice(2);
if (!destination) throw Error('Usage: node import-full.mjs export.json photo.jpeg schema.sql NEW_DATA_DIR');
const dest = resolve(destination);
if (existsSync(dest)) throw Error('Destination already exists; refusing to replace data');
const data = JSON.parse(readFileSync(input, 'utf8'));
assert.equal(data.format, 'dziennik-full-d1-export-v1');
const tables = ['teams','users','projects','entries','photos'];
const maps = Object.fromEntries(tables.map(table => {
  assert.ok(Array.isArray(data[table]));
  const map = new Map(data[table].map(row => [row.id, row]));
  assert.equal(map.size, data[table].length, `Duplicate ID: ${table}`);
  return [table, map];
}));
for (const table of tables.slice(1)) for (const row of data[table]) assert.ok(maps.teams.has(row.team_id), `Missing team: ${table}`);
for (const row of data.entries) assert.equal(maps.users.get(row.user_id)?.team_id, row.team_id, 'Invalid entry owner');
assert.equal(data.photos.length, 1, 'This migration package requires exactly one original photo');
const original = readFileSync(photo);
assert.equal(createHash('sha256').update(original).digest('hex'), '8408286fe83272ae5c23c474f89c1b9cc1ffea08e02cdc8287bdf06069437e57');
for (const row of data.photos) {
  assert.equal(maps.entries.get(row.entry_id)?.team_id, row.team_id, 'Invalid photo owner');
  assert.equal(row.object_key, `${row.team_id}/${row.entry_id}/${row.id}`, 'Invalid object key');
  assert.ok(row.object_key.split('/').every(part => /^[\w-]+$/.test(part)));
}
for (const row of data.users) assert.ok(row.name_key && row.pin_salt && row.pin_hash, 'Incomplete account');
mkdirSync(dirname(dest), {recursive:true});
const stage = `${dest}.staging-${randomUUID()}`;
mkdirSync(stage, {mode:0o700});
const db = new DatabaseSync(join(stage,'dziennik-robot.sqlite'));
try {
  db.exec(readFileSync(schemaPath,'utf8'));
  db.exec('BEGIN');
  for (const table of tables) {
    const allowed = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    for (const row of data[table]) {
      const keys = Object.keys(row);
      assert.ok(keys.every(key => allowed.has(key)), `Unexpected column in ${table}`);
      db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(key=>row[key]));
    }
  }
  db.exec('COMMIT');
  for (const table of tables) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, data[table].length);
    for (const row of data[table]) {
      const saved = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(row.id);
      for (const key of Object.keys(row)) assert.equal(saved[key], row[key], `Mismatch: ${table}.${key}`);
    }
  }
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
  for (const row of data.photos) {
    const path = join(stage,'files',row.object_key);
    mkdirSync(dirname(path), {recursive:true, mode:0o700});
    writeFileSync(path,original,{mode:0o600});
    assert.deepEqual(readFileSync(path),original);
  }
  const report = {importedAt:new Date().toISOString(),sourceExportedAt:data.exportedAt,counts:Object.fromEntries(tables.map(t=>[t,data[t].length])),photoSha256:createHash('sha256').update(original).digest('hex'),allSourceFieldsIdentical:true,sessionsPreserved:false};
  writeFileSync(join(stage,'migration-report.json'),JSON.stringify(report,null,2),{mode:0o600});
  db.close();
  renameSync(stage,dest);
  console.log(JSON.stringify(report));
} catch(error) {
  try { db.close(); } catch {}
  // Keep the failed staging directory private for diagnosis; it is never served.
  throw error;
}
