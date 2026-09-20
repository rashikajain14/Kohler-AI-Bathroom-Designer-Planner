import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { HttpError, type Ctx } from './ctx.js';
import { adminRoutes } from './routes/admin.js';
import { aiRoutes } from './routes/ai.js';
import { participantRoutes } from './routes/participant.js';
import { publicRoutes } from './routes/public.js';

export function createApp(ctx: Ctx) {
  const { config } = ctx;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],   // the UI sets many inline style attributes
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  if (config.logRequests) {
    app.use((req, res, next) => {
      const t0 = process.hrtime.bigint();
      res.on('finish', () => {
        if (req.path === '/healthz') return;
        console.log(JSON.stringify({ t: new Date().toISOString(), m: req.method, p: req.path, s: res.statusCode, ms: Number((process.hrtime.bigint() - t0) / 1_000_000n) }));
      });
      next();
    });
  }

  app.use(publicRoutes(ctx));
  app.use(aiRoutes(ctx));                                   // owns its own (larger) JSON parser for the image route
  app.use('/api', express.json({ limit: '256kb' }));
  app.use(participantRoutes(ctx));
  app.use(adminRoutes(ctx));

  /* ---------- static app ---------- */
  const pub = config.publicDir;
  if (existsSync(join(pub, 'index.html'))) {
    app.use(express.static(pub, {
      index: false,
      setHeaders(res, path) {
        if (/\/app\.[0-9a-f]{10}\.(js|css)$/.test(path)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else if (path.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        else res.setHeader('Cache-Control', 'public, max-age=604800');
      },
    }));
    app.get('/', (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(join(pub, 'index.html')));
  }

  app.use('/api', (_req, res) => { res.status(404).json({ error: 'not found', code: 'not_found' }); });
  app.use((_req, res) => { res.status(404).type('text').send('Not found'); });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) { res.status(err.status).json({ error: err.message, code: err.code }); return; }
    const e = err as { type?: string; status?: number; message?: string };
    if (e.type === 'entity.too.large') { res.status(413).json({ error: 'request too large', code: 'too_large' }); return; }
    if (e.type === 'entity.parse.failed') { res.status(400).json({ error: 'malformed JSON', code: 'invalid' }); return; }
    console.error(JSON.stringify({ t: new Date().toISOString(), level: 'error', message: e.message }));
    res.status(500).json({ error: 'internal error', code: 'internal' });
  });

  return app;
}
