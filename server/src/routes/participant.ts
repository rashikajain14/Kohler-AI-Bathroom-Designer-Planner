import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { requireSession, signToken } from '../auth.js';
import { HttpError, tx, type Ctx } from '../ctx.js';
import { assignCondition, newParticipantCode, uuid } from '../db.js';
import { EVENT_DATA_MAX, EventsSchema, LAYOUT_MAX, SessionCreateSchema, boundedJson } from '../schemas.js';
import { susScore } from '../study.js';

const now = () => new Date().toISOString();
const parse = <T extends z.ZodType>(schema: T, body: unknown): z.infer<T> => {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, 'invalid', 'invalid request: ' + r.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'body'} ${i.message}`).join('; '));
  return r.data;
};

export function participantRoutes(ctx: Ctx): Router {
  const { db, config, study, solver } = ctx;
  const r = Router();
  const auth = requireSession(db, ctx.secret);
  const authEvents = requireSession(db, ctx.secret, true);

  const sessionLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 300, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => ipKeyGenerator(req.ip ?? '') });
  const perSession = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.sess?.id ?? ipKeyGenerator(req.ip ?? '') });

  /* ---------- sessions ---------- */
  r.post('/api/session', sessionLimiter, (req, res) => {
    const b = parse(SessionCreateSchema, req.body);
    if (config.studyMode && !b.consent) throw new HttpError(400, 'consent_required', 'consent is required to take part');
    let condition = config.studyMode ? assignCondition(db, config.conditions) : 'ai';
    if (config.allowConditionOverride && b.condition && config.conditions.includes(b.condition)) condition = b.condition;
    const id = uuid(), code = newParticipantCode(db);
    db.prepare(
      `INSERT INTO sessions (id, code, external_id, condition, consent, consent_version, created_at, user_agent, screen, viewport, locale, catalog_version, catalog_hash, solver_version)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, code, b.externalId ?? null, condition, config.studyMode ? 1 : 0, config.studyMode ? study.consentVersion : null, now(),
      config.studyMode ? String(req.headers['user-agent'] ?? '').slice(0, 300) : null,
      config.studyMode ? b.screen ?? null : null, config.studyMode ? b.viewport ?? null : null, config.studyMode ? b.locale ?? null : null,
      solver.CATALOG_VERSION, solver.CATALOG_HASH, solver.SOLVER_VERSION,
    );
    res.status(201).json({ id, code, condition, token: signToken(ctx.secret, id) });
  });

  r.get('/api/session', auth, perSession, (req, res) => {
    const s = req.sess!;
    res.json({ id: s.id, code: s.code, condition: s.condition });
  });

  r.post('/api/session/delete', auth, (req, res) => {
    const s = req.sess!;
    db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id);      // events, designs, responses cascade
    rmSync(join(dirname(config.dbPath), 'uploads', s.id), { recursive: true, force: true });
    res.json({ deleted: true });
  });

  /* ---------- events (study mode + consent only) ---------- */
  r.post('/api/events', authEvents, perSession, (req, res) => {
    const s = req.sess!;
    const b = parse(EventsSchema, req.body);
    if (!config.studyMode || !s.consent) { res.json({ accepted: 0, rejected: b.events.length }); return; }
    const ins = db.prepare('INSERT INTO events (session_id, ts_client, ts_server, type, data) VALUES (?,?,?,?,?)');
    let accepted = 0;
    const ts = now();
    tx(db, () => {
      for (const e of b.events) {
        const data = JSON.stringify(e.data);
        if (data.length > EVENT_DATA_MAX) continue;
        ins.run(s.id, e.t ?? null, ts, e.type, data);
        accepted++;
      }
    });
    res.json({ accepted, rejected: b.events.length - accepted });
  });

  /* ---------- designs ---------- */
  const DesignSchema = z.object({
    name: z.string().trim().min(1).max(80),
    state: ctx.stateSchema,
    layout: boundedJson(LAYOUT_MAX),
    clientMetrics: boundedJson(4000).optional(),
  });
  const recompute = (state: any) => {
    const L = solver.solve({ ...solver.STATE, ...state, wants: new Set(state.wants), prefer: state.prefer });
    return { metrics: { ...L.metrics, score: L.score, fit: L.fit, total: L.total }, total: L.total, score: L.score };
  };

  r.post('/api/designs', auth, perSession, (req, res) => {
    const s = req.sess!;
    const b = parse(DesignSchema, req.body) as any;
    const n = (db.prepare('SELECT COUNT(*) AS n FROM designs WHERE session_id = ?').get(s.id) as { n: number }).n;
    if (n >= 50) throw new HttpError(409, 'limit', 'you have reached the limit of 50 saved designs; delete one first');
    const c = recompute(b.state);
    const id = uuid();
    db.prepare(
      `INSERT INTO designs (id, session_id, name, state, layout, server_metrics, client_metrics, total, score, solver_version, catalog_hash, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, s.id, b.name, JSON.stringify(b.state), JSON.stringify(b.layout), JSON.stringify(c.metrics),
      b.clientMetrics ? JSON.stringify(b.clientMetrics) : null, c.total, c.score, solver.SOLVER_VERSION, solver.CATALOG_HASH, now());
    res.status(201).json({ id, metrics: c.metrics });
  });

  r.get('/api/designs', auth, perSession, (req, res) => {
    const rows = db.prepare('SELECT id, name, state, total, score, created_at FROM designs WHERE session_id = ? ORDER BY created_at DESC LIMIT 100').all(req.sess!.id) as any[];
    res.json({ designs: rows.map((d) => ({ id: d.id, name: d.name, state: JSON.parse(d.state), total: d.total, score: d.score, createdAt: d.created_at })) });
  });

  r.get('/api/designs/:id', auth, perSession, (req, res) => {
    const d = db.prepare('SELECT * FROM designs WHERE id = ? AND session_id = ?').get(String(req.params.id), req.sess!.id) as any;
    if (!d) throw new HttpError(404, 'not_found', 'design not found');
    res.json({ id: d.id, name: d.name, state: JSON.parse(d.state), layout: JSON.parse(d.layout), metrics: JSON.parse(d.server_metrics), createdAt: d.created_at });
  });

  r.delete('/api/designs/:id', auth, perSession, (req, res) => {
    const info = db.prepare('DELETE FROM designs WHERE id = ? AND session_id = ?').run(String(req.params.id), req.sess!.id);
    if (!info.changes) throw new HttpError(404, 'not_found', 'design not found');
    res.json({ deleted: true });
  });

  /* ---------- task responses (study mode) ---------- */
  const ResponseSchema = z.object({
    taskId: z.string().regex(/^[\w-]{1,40}$/),
    durationMs: z.number().int().min(0).max(8 * 3600_000),
    answers: z.record(z.string(), z.number().int().min(1).max(5)),
    comment: z.string().max(2000).default(''),
    design: z.object({ state: ctx.stateSchema, layout: boundedJson(LAYOUT_MAX) }),
  });
  r.post('/api/responses', auth, perSession, (req, res) => {
    const s = req.sess!;
    if (!config.studyMode || !s.consent) throw new HttpError(403, 'study_off', 'responses are only recorded in study mode');
    const b = parse(ResponseSchema, req.body) as any;
    if (!study.tasks.some((t) => t.id === b.taskId)) throw new HttpError(400, 'invalid', 'unknown task');
    const q = study.questionnaire;
    for (const it of q.items) if (!(it.id in b.answers)) throw new HttpError(400, 'invalid', `missing answer for ${it.id}`);
    const sus = susScore(b.answers, q);
    const c = recompute(b.design.state);
    try {
      db.prepare(
        `INSERT INTO responses (session_id, task_id, duration_ms, answers, comment, sus_score, design_state, design_layout, server_metrics, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(s.id, b.taskId, b.durationMs, JSON.stringify(b.answers), b.comment, sus, JSON.stringify(b.design.state), JSON.stringify(b.design.layout), JSON.stringify(c.metrics), now());
    } catch (e) {
      if (String((e as Error).message).includes('UNIQUE')) throw new HttpError(409, 'already_submitted', 'this task was already submitted');
      throw e;
    }
    res.status(201).json({ ok: true, sus });
  });

  return r;
}
