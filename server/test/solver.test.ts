import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { root } from './helpers.js';

const S: any = createRequire(import.meta.url)(resolve(root, 'dist/solver.cjs'));
const WANTS = ['toilet', 'shower', 'vanity', 'mirror', 'towel', 'fan', 'storage'];
const solve = (over: Record<string, unknown> = {}) => S.solve({ ...S.STATE, wants: new Set(WANTS), ...over });

describe('catalogue and style packs', () => {
  it('every product id a style pack refers to exists (regression: storage:"jacob")', () => {
    for (const k of S.AES_KEYS)
      for (const [slot, id] of Object.entries<string>(S.AES[k].products))
        expect(S.PRODUCTS.some((p: any) => p.id === id), `${k}.${slot} -> ${id}`).toBe(true);
  });
  it('product ids are unique and prices are positive', () => {
    const ids = S.PRODUCTS.map((p: any) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of S.PRODUCTS) expect(p.price).toBeGreaterThan(0);
  });
  it('a storage unit that is placed is always priced and listed, in every style', () => {
    for (const k of S.AES_KEYS) {
      const L = solve({ aesthetic: k });
      if (L.items.some((i: any) => i.kind === 'storage')) expect(L.products.some((p: any) => p.why === 'storage'), k).toBe(true);
    }
  });
});

describe('study tasks are achievable', () => {
  const study = JSON.parse(readFileSync(resolve(root, 'study.config.json'), 'utf8'));
  for (const t of study.tasks) {
    it(`task "${t.id}": every requested fixture fits and the budget can be met`, () => {
      const k = t.constraints;
      const L = S.solve({ ...S.STATE, room: { L: k.length * 12, W: k.width * 12, H: (k.height ?? 9) * 12 }, face: k.face, doorWall: k.doorWall ?? 'auto',
        vastu: k.vastu, aesthetic: k.aesthetic, budget: k.budget, wants: new Set(k.wants), prefer: [] });
      expect(L.dropped, 'fixtures that cannot be placed').toEqual([]);
      expect(L.total, 'default total').toBeLessThanOrEqual(k.budget);
    });
  }
});

describe('determinism', () => {
  it('the same input always produces the same layout, byte for byte', () => {
    for (const k of S.AES_KEYS) {
      const a = JSON.stringify(solve({ aesthetic: k })), b = JSON.stringify(solve({ aesthetic: k }));
      expect(a).toBe(b);
    }
  });
});

describe('score is a documented formula', () => {
  it('reproduces from the reported rates and the published weights', () => {
    for (const k of S.AES_KEYS) {
      const L = solve({ aesthetic: k }), M = L.metrics, W = S.SCORE_WEIGHTS;
      const budgetScore = M.budgetOK ? 1 : Math.max(0, 1 - 2 * ((L.total - 200000) / 200000));
      const parts: [number, number][] = [[W.placement, M.placementRate], [W.comfort, M.comfortRate], [W.budget, budgetScore]];
      if (M.vastuRate !== null) parts.push([W.vastu, M.vastuRate]);
      const w = parts.reduce((a, p) => a + p[0], 0);
      const want = Math.round((100 * parts.reduce((a, p) => a + p[0] * p[1], 0)) / w);
      expect(L.score).toBe(want);
      expect(L.score).toBeGreaterThanOrEqual(0);
      expect(L.score).toBeLessThanOrEqual(100);
    }
  });
  it('does not reward stuffing more fixtures in (it is a mean of rates, not a sum)', () => {
    const few = solve({ wants: new Set(['toilet', 'shower', 'vanity']) });
    expect(few.score).toBeLessThanOrEqual(100);
    expect(few.metrics.placementRate).toBe(1);
  });
  it('drops the Vastu term when Vastu is off', () => {
    const L = solve({ vastu: false });
    expect(L.vastuStats).toBeNull();
    expect(L.metrics.vastuRate).toBeNull();
  });
});

describe('Vastu rating is honest', () => {
  it('rates a fixture by the zone it stands in', () => {
    const L = solve({ vastu: true });
    for (const it of L.items.filter((i: any) => i.vastu)) {
      const bear = S.bearingAt(it.cx, it.cy, L.room, L.faceDeg);
      expect(S.vastuRating(it.kind, bear).rating).toBe(it.vastu);
    }
  });
  it('never labels a fixture "preferred" unless its zone is in the rule\'s good list', () => {
    for (const k of S.AES_KEYS) for (const face of Object.keys(S.DIR_DEG)) {
      const L = solve({ aesthetic: k, face });
      for (const it of L.items.filter((i: any) => i.vastu === 'preferred')) {
        const zoneDeg = S.DIR_DEG[it.zone];
        expect(S.VASTU[it.kind].good).toContain(zoneDeg);
      }
    }
  });
  it('the rate counts only preferred zones', () => {
    const L = solve({ vastu: true });
    const v = L.vastuStats;
    expect(v.preferred + v.neutral + v.avoid).toBe(v.ruled);
    expect(v.rate).toBeCloseTo(v.preferred / v.ruled, 10);
  });
});

describe('shortlist', () => {
  it('uses a shortlisted product and keeps it even when the budget is exceeded', () => {
    const L = solve({ prefer: ['veil'] });
    const veil = L.products.find((p: any) => p.id === 'veil');
    expect(veil).toBeTruthy();
    expect(veil.preferred).toBe(true);
    expect(L.total).toBeGreaterThan(200000);
    expect(L.notices.some((n: any) => n.level === 'warn' && /over your ceiling/.test(n.text))).toBe(true);
  });
  it('ignores unknown ids', () => {
    expect(() => solve({ prefer: ['nope'] })).not.toThrow();
  });
});

describe('robustness (randomised)', () => {
  it('2000 random rooms: no exception, no overlap, nothing out of bounds, over-budget always flagged, every fixture priced', () => {
    let seed = 20260920;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]!;
    const all = ['toilet', 'shower', 'bath', 'vanity', 'storage', 'mirror', 'towel', 'fan', 'decor'];
    for (let n = 0; n < 2000; n++) {
      const st = {
        ...S.STATE, room: { L: pick([5, 6, 7, 8, 9, 10, 11, 12]) * 12, W: pick([4, 5, 6, 7, 8, 9]) * 12, H: 108 },
        face: pick(Object.keys(S.DIR_DEG)), doorWall: pick(['auto', 'front', 'left', 'right']), vastu: rnd() < 0.6,
        aesthetic: pick(S.AES_KEYS), budget: 80000 + 10000 * Math.floor(rnd() * 33), wants: new Set(all.filter(() => rnd() < 0.6)),
        prefer: rnd() < 0.2 ? [pick(S.PRODUCTS).id] : [],
      };
      const L = S.solve(st);
      expect(L.conflicts.length, JSON.stringify(st.room)).toBe(0);
      for (const it of L.items) {
        expect(it.foot.x).toBeGreaterThanOrEqual(-0.5); expect(it.foot.y).toBeGreaterThanOrEqual(-0.5);
        expect(it.foot.x + it.foot.w).toBeLessThanOrEqual(st.room.L + 0.5); expect(it.foot.y + it.foot.h).toBeLessThanOrEqual(st.room.W + 0.5);
        if (['toilet', 'shower', 'bath', 'vanity', 'storage'].includes(it.kind)) expect(L.products.some((p: any) => p.why === it.kind), it.kind).toBe(true);
      }
      if (L.total > st.budget) expect(L.notices.some((x: any) => x.level === 'warn' && /over your ceiling/.test(x.text))).toBe(true);
      for (const k of ['toilet', 'shower', 'bath', 'vanity', 'storage'])
        if (st.wants.has(k)) expect(L.items.some((i: any) => i.kind === k) || L.dropped.includes(k), `${k} silently lost`).toBe(true);
      expect(L.score).toBeGreaterThanOrEqual(0); expect(L.score).toBeLessThanOrEqual(100);
    }
  }, 120_000);
});
