import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

const dataDir = resolve(process.env.DZIENNIK_DATA_DIR || './portable-data');
const databasePath = resolve(process.env.DZIENNIK_DB_PATH || join(dataDir, 'dziennik-robot.sqlite'));
const filesDir = resolve(process.env.DZIENNIK_FILES_DIR || join(dataDir, 'files'));
mkdirSync(dirname(databasePath), { recursive: true });
mkdirSync(filesDir, { recursive: true });
const database = new DatabaseSync(databasePath);

function assertSafeKey(key) {
  const normalized = key.replaceAll('\\', '/');
  if (!normalized || normalized.split('/').some((part) => part === '..' || part === '.')) throw new Error('Unsafe object key');
  const target = resolve(filesDir, normalized);
  if (target !== filesDir && !target.startsWith(`${filesDir}${sep}`)) throw new Error('Unsafe object key');
  return target;
}

class D1Statement {
  constructor(sql, params = []) { this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.sql, params); }
  async run() {
    const result = database.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes ?? 0), last_row_id: Number(result.lastInsertRowid ?? 0) } };
  }
  async first() { return database.prepare(this.sql).get(...this.params) ?? null; }
  async all() { return { results: database.prepare(this.sql).all(...this.params) }; }
}

const DB = {
  prepare(sql) { return new D1Statement(sql); },
  async batch(statements) {
    database.exec('BEGIN');
    try {
      for (const statement of statements) database.prepare(statement.sql).run(...statement.params);
      database.exec('COMMIT');
      return statements.map(() => ({ success: true }));
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  },
};

const FILES = {
  async put(key, body) {
    const target = assertSafeKey(String(key));
    await mkdir(dirname(target), { recursive: true });
    const value = body instanceof Uint8Array || body instanceof ArrayBuffer
      ? Buffer.from(body)
      : Buffer.from(await new Response(body).arrayBuffer());
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    try { await writeFile(temporary, value); await rename(temporary, target); }
    finally { await unlink(temporary).catch(() => {}); }
  },
  async get(key) {
    const target = assertSafeKey(String(key));
    try {
      const value = await readFile(target);
      const body = Readable.toWeb(Readable.from(value));
      return { body, arrayBuffer: async () => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) };
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  },
  async delete(key) {
    try { await unlink(assertSafeKey(String(key))); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  },
};

export const env = { DB, FILES, TRANSLATOR_URL: process.env.DZIENNIK_TRANSLATOR_URL || '' };
