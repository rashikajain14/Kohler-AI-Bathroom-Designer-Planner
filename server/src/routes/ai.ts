import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { AiError, CHAT_TOOLS, ChatRequestSchema, analyseImage, chatSystem } from '../ai.js';
import { requireSession } from '../auth.js';
import { HttpError, type Ctx } from '../ctx.js';
import { uuid } from '../db.js';

function sniff(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export function aiRoutes(ctx: Ctx): Router {
  const { db, config } = ctx;
  const r = Router();
  const auth = requireSession(db, ctx.secret);
  const keyFor = (req: Request) => req.sess?.id ?? ipKeyGenerator(req.ip ?? '');
  const analyzeLimit = rateLimit({ windowMs: 60_000, limit: 6, keyGenerator: keyFor, standardHeaders: true, legacyHeaders: false, message: { error: 'too many analyses, wait a moment', code: 'rate_limited' } });
  const chatLimit = rateLimit({ windowMs: 60_000, limit: 20, keyGenerator: keyFor, standardHeaders: true, legacyHeaders: false, message: { error: 'too many messages, wait a moment', code: 'rate_limited' } });

  /** The AI must exist, the participant's study condition must include it, and the per-session budget must not be spent. */
  const gate = (req: Request, _res: Response, next: NextFunction) => {
    if (!ctx.ai) throw new HttpError(503, 'ai_unavailable', 'AI features are not configured on this server');
    const s = req.sess!;
    if (config.studyMode && s.condition !== 'ai') throw new HttpError(403, 'forbidden_condition', 'AI features are not part of your study condition');
    const took = db.prepare('UPDATE sessions SET ai_calls = ai_calls + 1 WHERE id = ? AND ai_calls < ?').run(s.id, config.aiCallsPerSession);
    if (!took.changes) throw new HttpError(429, 'quota', 'the AI limit for this session has been reached');
    next();
  };
  const refund = (id: string) => db.prepare('UPDATE sessions SET ai_calls = MAX(0, ai_calls - 1) WHERE id = ?').run(id);

  const upstream = (e: unknown, sessionId: string): never => {
    refund(sessionId);                                 // a failed call should not use up the participant's allowance
    if (e instanceof HttpError) throw e;
    if (e instanceof AiError) {
      throw new HttpError(e.code === 'upstream_error' ? 502 : 422, e.code, e.message);
    }
    const status = (e as { status?: number }).status;
    if (status === 400) throw new HttpError(400, 'bad_messages', 'the conversation could not be processed');
    throw new HttpError(502, 'upstream_error', 'the AI service could not be reached');
  };

  /* ---------- inspiration photo ---------- */
  const maxB64 = Math.ceil((config.maxImageBytes * 4) / 3) + 1024;
  const AnalyzeSchema = z.object({ image: z.string().max(maxB64), mediaType: z.string().max(40).optional() });
  r.post('/api/inspiration/analyze', express.json({ limit: maxB64 + 4096 }), auth, analyzeLimit, gate, async (req, res) => {
    const s = req.sess!;
    try {
      const b = AnalyzeSchema.safeParse(req.body);
      if (!b.success) throw new HttpError(400, 'image_rejected', 'send { image: <base64>, mediaType }');
      const buf = Buffer.from(b.data.image, 'base64');
      if (!buf.length || buf.length > config.maxImageBytes) throw new HttpError(413, 'image_rejected', `image must be under ${Math.round(config.maxImageBytes / 1048576)} MB`);
      const type = sniff(buf);                          // trust the bytes, not the label
      if (!type) throw new HttpError(415, 'image_rejected', 'only JPEG, PNG or WEBP images are accepted');
      const analysis = await analyseImage(ctx.ai!, buf.toString('base64'), type);
      let stored: string | undefined;
      if (config.storeImages && s.consent) {
        const dir = join(dirname(config.dbPath), 'uploads', s.id);
        mkdirSync(dir, { recursive: true });
        stored = `${uuid()}.${type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'}`;
        writeFileSync(join(dir, stored), buf);
      }
      if (config.studyMode && s.consent)
        db.prepare('INSERT INTO events (session_id, ts_client, ts_server, type, data) VALUES (?,?,?,?,?)')
          .run(s.id, null, new Date().toISOString(), 'inspiration_analysis', JSON.stringify({ analysis, stored: stored ?? null }));
      res.json({ analysis });
    } catch (e) { upstream(e, s.id); }
  });

  /* ---------- design assistant ---------- */
  r.post('/api/chat', express.json({ limit: '64kb' }), auth, chatLimit, gate, async (req, res) => {
    const s = req.sess!;
    try {
      const b = ChatRequestSchema.safeParse(req.body);
      if (!b.success) throw new HttpError(400, 'invalid', 'invalid request: ' + b.error.issues.slice(0, 2).map((i) => `${i.path.join('.')} ${i.message}`).join('; '));
      const ctxJson = JSON.stringify(b.data.context);
      if (ctxJson.length > 12_000) throw new HttpError(413, 'invalid', 'design context too large');
      const first = b.data.messages[0]!;
      if (first.role !== 'user' || typeof first.content !== 'string') throw new HttpError(400, 'invalid', 'the conversation must start with a user message');
      const out = await ctx.ai!.complete({ system: chatSystem(ctxJson), messages: b.data.messages, tools: CHAT_TOOLS, maxTokens: 700 });
      res.json({ content: out.content, stop_reason: out.stopReason });
    } catch (e) { upstream(e, s.id); }
  });

  return r;
}
