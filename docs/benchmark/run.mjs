// Reproducible benchmark of the layout solver.
//   npm run benchmark            default grid, about a minute and a half
//   npm run benchmark -- --full  every room size from 5x4 to 12x9 ft (several times longer)
// Factorial grid over room size, orientation, style, Vastu, fixture profile and budget. Every 4th run is solved
// twice (every run with --full) to prove determinism. runs.csv contains no timings, so it is byte-identical on every machine;
// timings go to timing.json. Hashes of both the solver source and the catalogue are recorded in SUMMARY.md.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const S = createRequire(import.meta.url)(join(root, 'dist/solver.cjs'));
const out = join(root, 'benchmark/results');
mkdirSync(out, { recursive: true });

const FULL = process.argv.includes('--full');
const ROOMS = [];
for (const L of FULL ? [5, 6, 7, 8, 9, 10, 11, 12] : [5, 6, 7, 8, 10, 12]) for (const W of FULL ? [4, 5, 6, 7, 8, 9] : [4, 5, 6, 7, 9]) ROOMS.push([L, W]);
const FACES = Object.keys(S.DIR_DEG);
const PROFILES = {
  essential: ['toilet', 'shower', 'vanity', 'mirror'],
  family: ['toilet', 'shower', 'vanity', 'mirror', 'towel', 'storage', 'fan'],
  full: ['toilet', 'shower', 'bath', 'vanity', 'mirror', 'towel', 'storage', 'fan', 'decor'],
};
const BUDGETS = [150000, 250000];
const sha = (s) => createHash('sha256').update(s).digest('hex');
const KINDS = ['toilet', 'shower', 'bath', 'vanity', 'storage'];

const rows = [], times = [];
let runNo = 0;
let nondeterministic = 0, conflicts = 0, outOfBounds = 0, silentLoss = 0, unflagged = 0, unpriced = 0, crashes = 0;

for (const [l, w] of ROOMS) for (const face of FACES) for (const aes of S.AES_KEYS) for (const vastu of [true, false])
  for (const [pname, wants] of Object.entries(PROFILES)) for (const budget of BUDGETS) {
    const st = { ...S.STATE, room: { L: l * 12, W: w * 12, H: 108 }, face, doorWall: 'auto', vastu, aesthetic: aes, budget, wants: new Set(wants), prefer: [] };
    let L1, L2;
    try {
      const t0 = performance.now(); L1 = S.solve(st); times.push(performance.now() - t0);
      L2 = FULL || runNo++ % 4 === 0 ? S.solve({ ...st, wants: new Set(wants) }) : null;
    } catch (e) { crashes++; continue; }
    const core = (L) => JSON.stringify([L.items.map((i) => [i.kind, i.wall, i.t, i.w, i.d, i.zone, i.vastu]), L.products.map((p) => [p.id, p.why]), L.total, L.score, L.fit, L.dropped, L.notices.map((n) => n.text)]);
    const h1 = sha(core(L1)); if (L2 && h1 !== sha(core(L2))) nondeterministic++;
    if (L1.conflicts.length) conflicts++;
    for (const it of L1.items) if (it.foot.x < -0.5 || it.foot.y < -0.5 || it.foot.x + it.foot.w > l * 12 + 0.5 || it.foot.y + it.foot.h > w * 12 + 0.5) { outOfBounds++; break; }
    for (const k of KINDS) {
      if (wants.includes(k) && !L1.items.some((i) => i.kind === k) && !L1.dropped.includes(k)) silentLoss++;
      if (L1.items.some((i) => i.kind === k) && !L1.products.some((p) => p.why === k)) unpriced++;
    }
    if (L1.total > budget && !L1.notices.some((n) => n.level === 'warn' && /over your ceiling/.test(n.text))) unflagged++;
    const M = L1.metrics, v = L1.vastuStats;
    rows.push({
      room: `${l}x${w}`, area_sqft: l * w, face, style: aes, vastu: vastu ? 1 : 0, profile: pname, budget,
      requested: wants.filter((k) => KINDS.includes(k)).length, placed: L1.items.length, dropped: L1.dropped.length,
      placement_rate: M.placementRate.toFixed(4), comfort_rate: M.comfortRate.toFixed(4), vastu_rate: M.vastuRate === null ? '' : M.vastuRate.toFixed(4),
      vastu_avoided: v ? v.avoid : '', total_inr: L1.total, within_budget: M.budgetOK ? 1 : 0, utilisation: M.budgetUtilization.toFixed(4),
      clear_square_in: M.clearSquare, free_pct: M.freePct, warnings: L1.notices.filter((n) => n.level === 'warn').length,
      layout_score: L1.score, space_fit: L1.fit, layout_hash: h1.slice(0, 12),
    });
  }

const cols = Object.keys(rows[0]);
const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => r[c]).join(','))].join('\n') + '\n';
writeFileSync(join(out, 'runs.csv'), csv);

/* ---------- aggregation ---------- */
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const group = (key) => { const m = new Map(); for (const r of rows) { const k = key(r); (m.get(k) ?? m.set(k, []).get(k)).push(r); } return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'en', { numeric: true })); };
const agg = (rs) => ({
  n: rs.length, placement: mean(rs.map((r) => +r.placement_rate)), comfort: mean(rs.map((r) => +r.comfort_rate)),
  vastu: mean(rs.filter((r) => r.vastu_rate !== '').map((r) => +r.vastu_rate)), budget: mean(rs.map((r) => r.within_budget)),
  score: mean(rs.map((r) => r.layout_score)), fit: mean(rs.map((r) => r.space_fit)),
  allPlaced: mean(rs.map((r) => (r.dropped === 0 ? 1 : 0))),
});
const table = (title, keyName, key) => {
  const lines = [`### ${title}`, '', `| ${keyName} | Runs | All requested placed | Placement | Comfort | Vastu preferred | Within budget | Layout score | Space fit |`, '|---|---:|---:|---:|---:|---:|---:|---:|---:|'];
  for (const [k, rs] of group(key)) { const a = agg(rs); lines.push(`| ${k} | ${a.n} | ${f(a.allPlaced * 100, 1)}% | ${f(a.placement)} | ${f(a.comfort)} | ${f(a.vastu)} | ${f(a.budget * 100, 1)}% | ${f(a.score, 1)} | ${f(a.fit, 1)} |`); }
  return lines.join('\n');
};
const bucket = (a) => (a < 36 ? 'small (< 36 sq ft)' : a <= 60 ? 'medium (36–60 sq ft)' : 'large (> 60 sq ft)');
const all = agg(rows);
const timing = { runs: times.length, mean_ms: mean(times), p50_ms: pct(times, 0.5), p95_ms: pct(times, 0.95), max_ms: Math.max(...times), node: process.version };
writeFileSync(join(out, 'timing.json'), JSON.stringify(timing, null, 2) + '\n');

const md = `# Solver benchmark

Solver \`${S.SOLVER_VERSION}\` · catalogue \`${S.CATALOG_VERSION}\` (\`${S.CATALOG_HASH}\`) · \`runs.csv\` sha256 \`${sha(csv).slice(0, 16)}\`

Factorial design: ${ROOMS.length} room sizes × ${FACES.length} orientations × ${S.AES_KEYS.length} styles × Vastu on/off × ${Object.keys(PROFILES).length} fixture profiles × ${BUDGETS.length} budgets (₹${BUDGETS.map((b) => b.toLocaleString('en-IN')).join(', ₹')}) = **${rows.length.toLocaleString()} runs**${FULL ? ' (full grid)' : ' (default grid; rooms 5, 6, 7, 8, 10, 12 × 4, 5, 6, 7, 9 ft)'}. ${FULL ? 'Every run' : 'Every 4th run'} is solved twice to check determinism.

## Integrity checks (must all be zero)

| Check | Count |
|---|---:|
| Runs that threw an exception | ${crashes} |
| Non-deterministic (two solves differ) | ${nondeterministic} |
| Layouts with an overlap | ${conflicts} |
| Fixtures outside the room | ${outOfBounds} |
| Requested fixture neither placed nor reported as dropped | ${silentLoss} |
| Placed fixture with no product / price | ${unpriced} |
| Over budget without a warning | ${unflagged} |

## Outcomes (means over runs)

Rates are defined in \`docs/RESEARCH.md\`. "All requested placed" is the share of runs where nothing had to be dropped.

${table('Overall', 'Set', () => 'all runs')}

${table('By fixture profile', 'Profile', (r) => r.profile)}

${table('By room size', 'Room', (r) => bucket(r.area_sqft))}

${table('By style', 'Style', (r) => r.style)}

${table('By Vastu setting', 'Vastu', (r) => (r.vastu ? 'on' : 'off'))}

${table('By budget (₹)', 'Budget', (r) => r.budget)}

## Timing (machine-dependent, kept out of runs.csv)

Mean ${f(timing.mean_ms, 2)} ms · median ${f(timing.p50_ms, 2)} ms · p95 ${f(timing.p95_ms, 2)} ms · max ${f(timing.max_ms, 2)} ms per solve (${timing.node}).

## Reading the results

- **Vastu preferred** is the share of Vastu-ruled fixtures standing in a preferred zone. It is not 1.0 because clearances take priority over orientation; the layout report tells the user each time a fixture could not be placed in a preferred zone.
- The rule table behind it is provisional (see \`docs/RESEARCH.md\`), so treat Vastu figures as properties of this rule table, not of Vastu.
- The layout score is a documented weighted mean, not an independent measure of quality. Validate it against human ratings before treating it as one.
`;
writeFileSync(join(out, 'SUMMARY.md'), md);
console.log(md.split('## Outcomes')[0]);
console.log('overall:', JSON.stringify(Object.fromEntries(Object.entries(all).map(([k, v]) => [k, +f(v)]))));
console.log(`timing: mean ${f(timing.mean_ms, 2)} ms, p95 ${f(timing.p95_ms, 2)} ms`);
process.exit(crashes + nondeterministic + conflicts + outOfBounds + silentLoss + unpriced + unflagged ? 1 : 0);
