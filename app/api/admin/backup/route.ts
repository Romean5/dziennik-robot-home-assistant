import { env } from 'cloudflare:workers';

import { currentUser, json } from '../../_lib';

type Row = Record<string, unknown>;

type BackupPayload = {
  teams: Row[];
  users: Row[];
  projects: Row[];
  entries: Row[];
  photos: Row[];
};

function toBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function payloadDigest(payload: BackupPayload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function counts(payload: BackupPayload) {
  return {
    teams: payload.teams.length,
    users: payload.users.length,
    projects: payload.projects.length,
    entries: payload.entries.length,
    photos: payload.photos.length,
  };
}

const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

function validId(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && /^[A-Za-z0-9_-]+$/.test(value);
}

function validatePayload(payload: BackupPayload, teamId: string) {
  if (!payload || !Array.isArray(payload.teams) || !Array.isArray(payload.users) || !Array.isArray(payload.projects) || !Array.isArray(payload.entries) || !Array.isArray(payload.photos)) return 'invalid_arrays';
  const allIds = new Set<string>();
  const checkRows = (rows: Row[], requireTeam = true) => {
    for (const row of rows) {
      if (!row || typeof row !== 'object' || !validId(row.id) || allIds.has(String(row.id))) return false;
      if (requireTeam && String(row.teamId) !== teamId) return false;
      allIds.add(String(row.id));
    }
    return true;
  };
  if (payload.teams.length !== 1 || !checkRows(payload.teams, false) || String(payload.teams[0].id) !== teamId) return 'invalid_team';
  if (!checkRows(payload.users) || !checkRows(payload.projects) || !checkRows(payload.entries) || !checkRows(payload.photos)) return 'invalid_rows';
  const userIds = new Set(payload.users.map((row) => String(row.id)));
  const entryIds = new Set(payload.entries.map((row) => String(row.id)));
  for (const row of payload.entries) {
    if (!userIds.has(String(row.userId)) || typeof row.project !== 'string' || typeof row.workDate !== 'string') return 'invalid_entry_reference';
  }
  let photoBytes = 0;
  for (const row of payload.photos) {
    const key = String(row.objectKey ?? '');
    if (!entryIds.has(String(row.entryId)) || !key.startsWith(`${teamId}/`) || key.includes('..') || typeof row.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(row.data)) return 'invalid_photo';
    photoBytes += Math.floor(row.data.length * 3 / 4);
    if (photoBytes > MAX_BACKUP_BYTES || photoBytes > MAX_PHOTO_BYTES * payload.photos.length) return 'backup_too_large';
  }
  return null;
}

async function adminUser(request: Request) {
  const user = await currentUser(request);
  return user && user.role === 'admin' ? user : null;
}

async function existingById(table: string, id: string) {
  return env.DB.prepare(`SELECT id,team_id AS teamId FROM ${table} WHERE id=?`).bind(id).first<Row>();
}

async function validateDatabaseCollisions(payload: BackupPayload, teamId: string) {
  for (const [table, rows] of [['users', payload.users], ['projects', payload.projects], ['entries', payload.entries], ['photos', payload.photos]] as const) {
    for (const row of rows) {
      const existing = await existingById(table, String(row.id));
      if (existing && String(existing.teamId) !== teamId) return 'id_collision';
    }
  }
  for (const row of payload.photos) {
    const existing = await env.DB.prepare('SELECT id,team_id AS teamId FROM photos WHERE object_key=?').bind(String(row.objectKey)).first<Row>();
    if (existing && (String(existing.teamId) !== teamId || String(existing.id) !== String(row.id))) return 'object_key_collision';
  }
  for (const row of payload.users) {
    const existing = await env.DB.prepare('SELECT id FROM users WHERE team_id=? AND name_key=?').bind(teamId, row.nameKey).first<Row>();
    if (existing && String(existing.id) !== String(row.id)) return 'user_name_collision';
  }
  for (const row of payload.projects) {
    const existing = await env.DB.prepare('SELECT id FROM projects WHERE team_id=? AND name=?').bind(teamId, row.name).first<Row>();
    if (existing && String(existing.id) !== String(row.id)) return 'project_name_collision';
  }
  return null;
}

/**
 * A cross-team restore is allowed only during the first-run migration of a
 * freshly installed add-on.  This prevents a backup from ever replacing a
 * working team's data by accident.
 */
async function isFreshBootstrap(user: { id: string; teamId: string }) {
  const [teams, users, projects, entries, photos, current] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS count FROM teams').first<Row>(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<Row>(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM projects').first<Row>(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM entries').first<Row>(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM photos').first<Row>(),
    env.DB.prepare('SELECT id,team_id AS teamId,role FROM users WHERE id=?').bind(user.id).first<Row>(),
  ]);
  return Number(teams?.count ?? 0) === 1
    && Number(users?.count ?? 0) === 1
    && Number(projects?.count ?? 0) === 0
    && Number(entries?.count ?? 0) === 0
    && Number(photos?.count ?? 0) === 0
    && current?.id === user.id
    && current?.teamId === user.teamId
    && current?.role === 'admin';
}

async function sameStoredPhoto(key: string, bytes: Uint8Array) {
  const object = await env.FILES.get(key);
  if (!object) return false;
  const current = new Uint8Array(await object.arrayBuffer());
  if (current.byteLength !== bytes.byteLength) return false;
  const [left, right] = await Promise.all([crypto.subtle.digest('SHA-256', current), crypto.subtle.digest('SHA-256', bytes)]);
  return [...new Uint8Array(left)].every((byte, index) => byte === new Uint8Array(right)[index]);
}

export async function GET(request: Request) {
  const user = await adminUser(request);
  if (!user) return json({ error: 'forbidden' }, 403);

  const [teams, users, projects, entries, photoRows] = await Promise.all([
    env.DB.prepare('SELECT id,name,name_key AS nameKey,created_at AS createdAt FROM teams WHERE id=?').bind(user.teamId).all(),
    env.DB.prepare('SELECT id,team_id AS teamId,name,name_key AS nameKey,pin_salt AS pinSalt,pin_hash AS pinHash,role,status,full_name AS fullName,default_company AS defaultCompany,default_project AS defaultProject,employee_number AS employeeNumber,machine,machine_number AS machineNumber,created_at AS createdAt,must_change_pin AS mustChangePin,pin_reset_expires_at AS pinResetExpiresAt,language FROM users WHERE team_id=?').bind(user.teamId).all(),
    env.DB.prepare('SELECT id,team_id AS teamId,name,created_at AS createdAt FROM projects WHERE team_id=?').bind(user.teamId).all(),
    env.DB.prepare('SELECT id,team_id AS teamId,user_id AS userId,entry_type AS entryType,company,project,description,hours,kilometers,report_slot AS reportSlot,work_date AS workDate,latitude,longitude,created_at AS createdAt,source_language AS sourceLanguage FROM entries WHERE team_id=?').bind(user.teamId).all(),
    env.DB.prepare('SELECT id,entry_id AS entryId,team_id AS teamId,object_key AS objectKey,content_type AS contentType,created_at AS createdAt FROM photos WHERE team_id=?').bind(user.teamId).all(),
  ]);

  const photos: Row[] = [];
  for (const row of photoRows.results as Row[]) {
    const object = await env.FILES.get(String(row.objectKey));
    if (!object) return json({ error: 'photo_missing', id: row.id }, 409);
    photos.push({ ...row, data: toBase64(new Uint8Array(await object.arrayBuffer())) });
  }

  const payload: BackupPayload = {
    teams: teams.results as Row[],
    users: users.results as Row[],
    projects: projects.results as Row[],
    entries: entries.results as Row[],
    photos,
  };
  const manifest = {
    format: 'dziennik-robot-backup',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    teamId: user.teamId,
    counts: counts(payload),
    payloadSha256: await payloadDigest(payload),
    note: 'Zawiera hashe PIN-ów użytkowników i dane zdjęć. Traktuj plik jak poufny backup.',
  };
  return json({ manifest, payload });
}

export async function POST(request: Request) {
  const user = await adminUser(request);
  if (!user) return json({ error: 'forbidden' }, 403);
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BACKUP_BYTES) return json({ error: 'backup_too_large' }, 413);

  let body: { manifest?: Row; payload?: BackupPayload; allowEmptyTargetMigration?: boolean };
  try {
    body = await request.json() as { manifest?: Row; payload?: BackupPayload };
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const manifest = body.manifest;
  const payload = body.payload;
  if (!manifest || manifest.format !== 'dziennik-robot-backup' || manifest.schemaVersion !== 1 || !payload) return json({ error: 'invalid_backup' }, 400);
  const sourceTeamId = String(manifest.teamId);
  const crossTeamMigration = sourceTeamId !== user.teamId;
  if (crossTeamMigration && (!body.allowEmptyTargetMigration || !(await isFreshBootstrap(user)))) return json({ error: 'target_not_empty' }, 409);
  const validationError = validatePayload(payload, sourceTeamId);
  if (validationError) return json({ error: validationError }, validationError === 'backup_too_large' ? 413 : 400);
  const collisionError = await validateDatabaseCollisions(payload, sourceTeamId);
  if (collisionError) return json({ error: collisionError }, 409);
  const expectedCounts = counts(payload);
  const declaredCounts = manifest.counts as Row | undefined;
  if (!declaredCounts || JSON.stringify(expectedCounts) !== JSON.stringify(declaredCounts)) return json({ error: 'count_mismatch', expected: expectedCounts, declared: declaredCounts }, 409);
  if (String(manifest.payloadSha256) !== await payloadDigest(payload)) return json({ error: 'checksum_mismatch' }, 409);

  const team = payload.teams[0];
  const stagedPhotos: Array<{ row: Row; bytes: Uint8Array }> = [];
  try {
    for (const row of payload.photos) stagedPhotos.push({ row, bytes: fromBase64(String(row.data)) });
  } catch {
    return json({ error: 'invalid_photo_data' }, 400);
  }
  const createdKeys: string[] = [];
  for (const { row, bytes } of stagedPhotos) {
    if (bytes.byteLength > MAX_PHOTO_BYTES) return json({ error: 'photo_too_large', id: row.id }, 413);
    const existing = await env.DB.prepare('SELECT id FROM photos WHERE object_key=?').bind(String(row.objectKey)).first<Row>();
    if (!existing || !(await sameStoredPhoto(String(row.objectKey), bytes))) {
      if (existing) return json({ error: 'object_content_collision', id: row.id }, 409);
      await env.FILES.put(String(row.objectKey), bytes, { httpMetadata: { contentType: String(row.contentType || 'image/jpeg') } });
      createdKeys.push(String(row.objectKey));
    }
  }
  const statements = crossTeamMigration
    ? [
      env.DB.prepare('DELETE FROM photos WHERE team_id=?').bind(user.teamId),
      env.DB.prepare('DELETE FROM entries WHERE team_id=?').bind(user.teamId),
      env.DB.prepare('DELETE FROM projects WHERE team_id=?').bind(user.teamId),
      env.DB.prepare('DELETE FROM users WHERE team_id=?').bind(user.teamId),
      env.DB.prepare('DELETE FROM teams WHERE id=?').bind(user.teamId),
    ]
    : [];
  statements.push(env.DB.prepare('INSERT OR REPLACE INTO teams(id,name,name_key,created_at) VALUES(?,?,?,?)').bind(team.id, team.name, team.nameKey, team.createdAt));
  for (const row of payload.users) {
    statements.push(env.DB.prepare('INSERT OR REPLACE INTO users(id,team_id,name,name_key,pin_salt,pin_hash,role,status,full_name,default_company,default_project,employee_number,machine,machine_number,created_at,must_change_pin,pin_reset_expires_at,language) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(row.id, row.teamId, row.name, row.nameKey, row.pinSalt, row.pinHash, row.role, row.status, row.fullName ?? '', row.defaultCompany ?? '', row.defaultProject ?? '', row.employeeNumber ?? '', row.machine ?? '', row.machineNumber ?? '', row.createdAt, row.mustChangePin ?? 0, row.pinResetExpiresAt ?? null, row.language ?? 'pl'));
  }
  for (const row of payload.projects) {
    statements.push(env.DB.prepare('INSERT OR REPLACE INTO projects(id,team_id,name,created_at) VALUES(?,?,?,?)').bind(row.id, row.teamId, row.name, row.createdAt));
  }
  for (const row of payload.entries) {
    statements.push(env.DB.prepare('INSERT OR REPLACE INTO entries(id,team_id,user_id,entry_type,company,project,description,hours,kilometers,report_slot,work_date,latitude,longitude,created_at,source_language) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(row.id, row.teamId, row.userId, row.entryType, row.company ?? '', row.project ?? '', row.description ?? '', row.hours ?? '0', row.kilometers ?? '0', row.reportSlot ?? 'auto', row.workDate ?? '', row.latitude ?? null, row.longitude ?? null, row.createdAt, row.sourceLanguage ?? ''));
  }
  for (const { row } of stagedPhotos) statements.push(env.DB.prepare('INSERT OR REPLACE INTO photos(id,entry_id,team_id,object_key,content_type,created_at) VALUES(?,?,?,?,?,?)').bind(row.id, row.entryId, row.teamId, row.objectKey, row.contentType, row.createdAt));
  try {
    await env.DB.batch(statements);
  } catch {
    await Promise.all(createdKeys.map((key) => env.FILES.delete(key).catch(() => undefined)));
    return json({ error: 'import_failed' }, 500);
  }
  return json({ ok: true, imported: expectedCounts, generatedAt: manifest.generatedAt, reloginRequired: crossTeamMigration });
}
