import { Router, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAdmin } from '../auth.js';
import type { Ctx } from '../ctx.js';
import { toCsv } from '../csv.js';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const num = (v: unknown, d = 1) => (v === null || v === undefined ? '—' : Number(v).toFixed(d));

export function adminRoutes(ctx: Ctx): Router {
  const { db, study, config } = ctx;
  const r = Router();
  r.use('/admin', rateLimit({ windowMs: 15 * 60_000, limit: 300, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => ipKeyGenerator(req.ip ?? '') }));
  r.use('/admin', requireAdmin(config.adminUser, config.adminPassword));

  const q = (sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args) as Record<string, any>[];

  const tables: Record<string, () => Record<string, unknown>[]> = {
    sessions: () => q(`SELECT s.code, s.external_id, s.condition, s.created_at, s.consent_version, s.locale, s.screen, s.viewport, s.user_agent,
                        s.catalog_version, s.catalog_hash, s.solver_version, s.ai_calls,
                        (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) AS events,
                        (SELECT COUNT(*) FROM responses r WHERE r.session_id = s.id) AS tasks_done
                       FROM sessions s ORDER BY s.created_at`),
    events: () => q(`SELECT e.id, s.code AS participant, s.condition, e.ts_client, e.ts_server, e.type, e.data
                     FROM events e JOIN sessions s ON s.id = e.session_id ORDER BY e.id`),
    designs: () => q(`SELECT d.id, s.code AS participant, s.condition, d.name, d.created_at, d.total, d.score, d.solver_version, d.catalog_hash,
                        d.state, d.server_metrics, d.client_metrics, d.layout
                      FROM designs d JOIN sessions s ON s.id = d.session_id ORDER BY d.created_at`),
    responses: () => q(`SELECT s.code AS participant, s.condition, r.task_id, r.duration_ms, r.sus_score, r.answers, r.comment,
                          r.server_metrics, r.design_state, r.created_at
                        FROM responses r JOIN sessions s ON s.id = r.session_id ORDER BY r.created_at`)
      .map((row) => {
        const a = JSON.parse(row.answers || '{}');
        const flat: Record<string, unknown> = { ...row };
        for (const it of study.questionnaire.items) flat['q_' + it.id] = a[it.id] ?? null;
        const m = JSON.parse(row.server_metrics || '{}');
        flat.layout_score = m.score ?? null; flat.space_fit = m.fit ?? null; flat.within_budget = m.budgetOK ?? null; flat.vastu_rate = m.vastuRate ?? null;
        return flat;
      }),
  };
  const responseCols = () => ['participant', 'condition', 'task_id', 'duration_ms', 'sus_score',
    ...study.questionnaire.items.map((i) => 'q_' + i.id), 'layout_score', 'space_fit', 'within_budget', 'vastu_rate', 'comment', 'created_at', 'answers', 'server_metrics', 'design_state'];

  r.get('/admin/export/:file', (req, res: Response) => {
    const file = String(req.params.file);
    if (file === 'all.json') {
      const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), solver: ctx.solver.SOLVER_VERSION, catalog: ctx.solver.CATALOG_HASH };
      for (const [k, fn] of Object.entries(tables)) out[k] = fn();
      res.set('Content-Disposition', 'attachment; filename="study-export.json"').json(out);
      return;
    }
    const m = /^(sessions|events|designs|responses)\.csv$/.exec(file);
    if (!m) { res.status(404).json({ error: 'unknown export' }); return; }
    const name = m[1]!;
    const rows = tables[name]!();
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"` })
      .send('\ufeff' + toCsv(rows, name === 'responses' ? responseCols() : undefined));
  });

  r.get('/admin', (_req, res) => {
    const consented = q(`SELECT condition, COUNT(*) AS n FROM sessions WHERE consent = 1 GROUP BY condition ORDER BY condition`);
    const perCond = q(`SELECT s.condition, COUNT(*) AS n, COUNT(DISTINCT r.session_id) AS people, AVG(r.duration_ms) / 1000.0 AS dur, AVG(r.sus_score) AS sus,
                         AVG(json_extract(r.server_metrics, '$.score')) AS score, AVG(json_extract(r.server_metrics, '$.fit')) AS fit,
                         AVG(CASE WHEN json_extract(r.server_metrics, '$.budgetOK') THEN 1.0 ELSE 0.0 END) AS inbudget
                       FROM responses r JOIN sessions s ON s.id = r.session_id GROUP BY s.condition ORDER BY s.condition`);
    const perTask = q(`SELECT r.task_id, s.condition, COUNT(*) AS n, AVG(r.duration_ms) / 1000.0 AS dur, AVG(r.sus_score) AS sus,
                         AVG(json_extract(r.server_metrics, '$.score')) AS score
                       FROM responses r JOIN sessions s ON s.id = r.session_id GROUP BY r.task_id, s.condition ORDER BY r.task_id, s.condition`);
    const evTypes = q(`SELECT type, COUNT(*) AS n FROM events GROUP BY type ORDER BY n DESC LIMIT 20`);
    const recent = q(`SELECT s.code, s.condition, s.created_at, s.ai_calls,
                        (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) AS events,
                        (SELECT COUNT(*) FROM responses r WHERE r.session_id = s.id) AS tasks
                      FROM sessions s ORDER BY s.created_at DESC LIMIT 40`);
    const total = (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;

    const row = (cells: unknown[]) => `<tr>${cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`;
    const table = (head: string[], rows: string) => `<div class="scroll"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${head.length}" class="mut">No data yet.</td></tr>`}</tbody></table></div>`;

    res.set('Cache-Control', 'no-store').type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Study admin</title><style>
:root{--ink:#14181D;--mut:#5E666F;--line:#DDD8CF;--page:#F3F1ED;--brass:#A8804E}
body{margin:0;background:var(--page);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1080px;margin:0 auto;padding:36px 24px 80px}
h1{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:34px;margin:0 0 4px}
h2{font-size:15px;margin:36px 0 10px}
p{color:var(--mut);margin:4px 0 0;max-width:70ch}
.scroll{overflow-x:auto;background:#fff;border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:13.5px;font-variant-numeric:tabular-nums}
th,td{padding:9px 14px;text-align:left;border-top:1px solid var(--line);white-space:nowrap}
thead th{border-top:0;color:var(--mut);font-weight:600;font-size:12px}
.mut{color:var(--mut)}
.dl{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.dl a{padding:8px 14px;border:1px solid var(--ink);border-radius:20px;color:var(--ink);text-decoration:none;font-size:13px}
.dl a:hover{background:var(--ink);color:#fff}
.dl a:focus-visible{outline:2px solid #2563EB;outline-offset:2px}
</style></head><body><main>
<h1>Study admin</h1>
<p>${total} session${total === 1 ? '' : 's'} · study mode ${config.studyMode ? 'on' : 'off'} · solver ${esc(ctx.solver.SOLVER_VERSION)} · catalogue ${esc(ctx.solver.CATALOG_VERSION)} (${esc(ctx.solver.CATALOG_HASH)}) · consent ${esc(study.consentVersion)}</p>

<h2>Export</h2>
<div class="dl"><a href="/admin/export/sessions.csv">sessions.csv</a><a href="/admin/export/events.csv">events.csv</a><a href="/admin/export/designs.csv">designs.csv</a><a href="/admin/export/responses.csv">responses.csv</a><a href="/admin/export/all.json">all.json</a></div>

<h2>Consented participants by condition</h2>
${table(['Condition', 'Participants'], consented.map((c) => row([c.condition, c.n])).join(''))}

<h2>Outcomes by condition (completed tasks)</h2>
<p>Layout score and space fit are recomputed on the server from each submitted design. SUS above about 68 is conventionally read as above average usability.</p>
${table(['Condition', 'Tasks', 'People', 'Mean time (s)', 'Mean SUS', 'Mean layout score', 'Mean space fit', 'Within budget'],
  perCond.map((c) => row([c.condition, c.n, c.people, num(c.dur, 0), num(c.sus), num(c.score), num(c.fit), c.inbudget === null ? '—' : Math.round(c.inbudget * 100) + '%'])).join(''))}

<h2>By task</h2>
${table(['Task', 'Condition', 'Tasks', 'Mean time (s)', 'Mean SUS', 'Mean layout score'],
  perTask.map((c) => row([c.task_id, c.condition, c.n, num(c.dur, 0), num(c.sus), num(c.score)])).join(''))}

<h2>Most frequent events</h2>
${table(['Event', 'Count'], evTypes.map((e) => row([e.type, e.n])).join(''))}

<h2>Latest sessions</h2>
${table(['Participant', 'Condition', 'Started', 'Events', 'Tasks done', 'AI calls'],
  recent.map((s) => row([s.code, s.condition, s.created_at, s.events, s.tasks, s.ai_calls])).join(''))}
</main></body></html>`);
  });

  return r;
}
