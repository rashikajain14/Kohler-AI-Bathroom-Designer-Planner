import { Router } from 'express';
import type { Ctx } from '../ctx.js';

export function publicRoutes(ctx: Ctx): Router {
  const r = Router();

  r.get('/healthz', (_req, res) => {
    ctx.db.prepare('SELECT 1').get();
    res.json({ ok: true, solver: ctx.solver.SOLVER_VERSION, catalog: ctx.solver.CATALOG_VERSION });
  });

  r.get('/api/config', (_req, res) => {
    const s = ctx.study;
    res.set('Cache-Control', 'no-store').json({
      studyMode: ctx.config.studyMode,
      features: { ai: !!ctx.ai },
      disclaimer: ctx.config.disclaimer,
      catalogVersion: ctx.solver.CATALOG_VERSION,
      solverVersion: ctx.solver.SOLVER_VERSION,
      ...(ctx.config.studyMode
        ? {
            consentVersion: s.consentVersion, consentTitle: s.consentTitle, consentIntro: s.consentIntro,
            consentText: s.consentText, consentAgreeLabel: s.consentAgreeLabel, completionNote: s.completionNote,
            tasks: s.tasks, questionnaire: s.questionnaire,
          }
        : { tasks: [] }),
    });
  });
  return r;
}
