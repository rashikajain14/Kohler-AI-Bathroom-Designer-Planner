import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import type { AiClient, AiRequest, AiResult } from '../src/ai.js';
import { loadConfig, loadStudyConfig, type Config } from '../src/config.js';
import { openDb, tokenSecret } from '../src/db.js';
import { makeStateSchema } from '../src/schemas.js';
import { loadSolver } from '../src/solver.js';

export const root = resolve(import.meta.dirname, '../..');

export class FakeAi implements AiClient {
  calls: AiRequest[] = [];
  queue: (AiResult | Error)[] = [];
  async complete(req: AiRequest): Promise<AiResult> {
    this.calls.push(req);
    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    return next ?? { content: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn' };
  }
}

export async function startServer(over: Partial<Config> = {}, ai: AiClient | null = null) {
  const config: Config = {
    ...loadConfig({}), dbPath: ':memory:', publicDir: resolve(root, 'dist/public'), solverPath: resolve(root, 'dist/solver.cjs'),
    studyConfigPath: resolve(root, 'study.config.json'), logRequests: false, adminPassword: 'secret-pass', allowConditionOverride: true, ...over,
  };
  const solver = loadSolver(config.solverPath);
  const study = loadStudyConfig(config.studyConfigPath);
  const db = openDb(config.dbPath);
  const app = createApp({ config, db, secret: tokenSecret(db), solver, study, ai, stateSchema: makeStateSchema(solver) });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) {
    const r = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text, headers: r.headers };
  }
  async function session(consent = true, extra: Record<string, unknown> = {}) {
    const r = await call('POST', '/api/session', { consent, ...extra });
    return { ...r.json, status: r.status } as { id: string; code: string; condition: string; token: string; status: number };
  }
  const close = () => new Promise<void>((res) => server.close(() => { db.close(); res(); }));
  return { base, call, session, close, db, config, solver, study };
}

export const goodState = {
  room: { L: 96, W: 72, H: 108 }, face: 'South', doorWall: 'auto', vastu: true, aesthetic: 'modern', budget: 200000,
  wants: ['toilet', 'shower', 'vanity', 'mirror', 'towel', 'fan', 'storage'], prefer: [] as string[],
};
export const jpegBase64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]).toString('base64');
export const readJson = (p: string) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
