import type { ZodType } from 'zod';
import type { Config, StudyConfig } from './config.js';
import type { DB } from './db.js';
import type { Solver } from './solver.js';
import type { AiClient } from './ai.js';

export interface Ctx {
  config: Config;
  db: DB;
  secret: string;
  solver: Solver;
  study: StudyConfig;
  ai: AiClient | null;
  stateSchema: ZodType;
}

/** Runs fn inside one SQLite transaction. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
