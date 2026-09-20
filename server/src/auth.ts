import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { DB, SessionRow } from './db.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { sess?: SessionRow }
  }
}

export const signToken = (secret: string, id: string) => `${id}.${createHmac('sha256', secret).update(id).digest('base64url').slice(0, 32)}`;

export function verifyToken(secret: string, token: string): string | null {
  const i = token.lastIndexOf('.');
  if (i < 1) return null;
  const id = token.slice(0, i);
  const want = Buffer.from(signToken(secret, id));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

/** allowBodyToken: navigator.sendBeacon cannot set headers, so /api/events (only) may carry the token in the JSON body. */
export function requireSession(db: DB, secret: string, allowBodyToken = false) {
  const find = db.prepare('SELECT id, code, external_id, condition, consent, consent_version, created_at, ai_calls FROM sessions WHERE id = ?');
  return (req: Request, res: Response, next: NextFunction) => {
    const h = req.headers.authorization || '';
    let token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (!token && allowBodyToken && typeof req.body?.token === 'string') token = req.body.token;
    const id = token ? verifyToken(secret, token) : null;
    const row = id ? (find.get(id) as SessionRow | undefined) : undefined;
    if (!row) { res.status(401).json({ error: 'session not found or token invalid', code: 'no_session' }); return; }
    req.sess = row;
    next();
  };
}

const sha = (s: string) => createHash('sha256').update(s).digest();
const same = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

/** HTTP Basic auth for /admin. With no ADMIN_PASSWORD set the admin area does not exist. */
export function requireAdmin(user: string, password: string | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!password) { res.status(404).json({ error: 'not found' }); return; }
    const h = req.headers.authorization || '';
    if (h.startsWith('Basic ')) {
      const [u = '', ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
      const p = rest.join(':');
      if (same(u, user) && same(p, password)) { next(); return; }
    }
    res.set('WWW-Authenticate', 'Basic realm="Study admin", charset="UTF-8"').status(401).send('Authentication required');
  };
}
