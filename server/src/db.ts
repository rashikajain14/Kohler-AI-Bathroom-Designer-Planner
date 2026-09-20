import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';

export type DB = DatabaseSync;

const MIGRATIONS: string[] = [
  /* v1 */ `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    external_id TEXT,
    condition TEXT NOT NULL,
    consent INTEGER NOT NULL DEFAULT 0,
    consent_version TEXT,
    created_at TEXT NOT NULL,
    user_agent TEXT, screen TEXT, viewport TEXT, locale TEXT,
    catalog_version TEXT, catalog_hash TEXT, solver_version TEXT,
    ai_calls INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts_client INTEGER, ts_server TEXT NOT NULL,
    type TEXT NOT NULL, data TEXT NOT NULL
  );
  CREATE INDEX events_session ON events(session_id, id);
  CREATE INDEX events_type ON events(type);
  CREATE TABLE designs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    state TEXT NOT NULL, layout TEXT NOT NULL,
    server_metrics TEXT NOT NULL, client_metrics TEXT,
    total INTEGER, score INTEGER,
    solver_version TEXT, catalog_hash TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX designs_session ON designs(session_id, created_at);
  CREATE TABLE responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    answers TEXT NOT NULL, comment TEXT,
    sus_score REAL,
    design_state TEXT, design_layout TEXT, server_metrics TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (session_id, task_id)
  );
  `,
];

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  const cur = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = cur; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

export function getMeta(db: DB, key: string): string | undefined {
  const r = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return r?.value;
}
export function setMeta(db: DB, key: string, value: string) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
/** The signing secret lives in the database so sessions survive restarts and no env var is needed. */
export function tokenSecret(db: DB): string {
  let s = getMeta(db, 'token_secret');
  if (!s) { s = randomBytes(32).toString('hex'); setMeta(db, 'token_secret', s); }
  return s;
}

export interface SessionRow {
  id: string; code: string; external_id: string | null; condition: string; consent: number; consent_version: string | null;
  created_at: string; ai_calls: number;
}

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function newParticipantCode(db: DB): string {
  for (let i = 0; i < 50; i++) {
    let c = 'P-';
    for (let k = 0; k < 5; k++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!db.prepare('SELECT 1 FROM sessions WHERE code = ?').get(c)) return c;
  }
  throw new Error('could not allocate a participant code');
}

/** Balanced assignment: the condition with the fewest consented sessions wins; ties are broken at random. */
export function assignCondition(db: DB, conditions: string[]): string {
  const counts = new Map(conditions.map((c) => [c, 0]));
  const rows = db.prepare('SELECT condition, COUNT(*) AS n FROM sessions WHERE consent = 1 GROUP BY condition').all() as { condition: string; n: number }[];
  for (const r of rows) if (counts.has(r.condition)) counts.set(r.condition, r.n);
  const min = Math.min(...counts.values());
  const pool = [...counts.entries()].filter(([, n]) => n === min).map(([c]) => c);
  return pool[randomInt(pool.length)]!;
}
export const uuid = () => randomUUID();
