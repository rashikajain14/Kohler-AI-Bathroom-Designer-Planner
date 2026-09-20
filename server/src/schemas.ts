import { z } from 'zod';
import type { Solver } from './solver.js';

const FACES = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'] as const;

/** Design state: validated against the solver's own vocabulary, so a saved design can always be re-solved. */
export function makeStateSchema(solver: Solver) {
  const styles = solver.AES_KEYS as [string, ...string[]];
  const amenities = solver.AMENITY.map((a) => a.k) as [string, ...string[]];
  const products = new Set(solver.PRODUCTS.map((p) => p.id));
  return z.object({
    room: z.object({ L: z.number().int().min(60).max(144), W: z.number().int().min(48).max(108), H: z.number().int().min(96).max(120) }),
    face: z.enum(FACES),
    doorWall: z.enum(['auto', 'front', 'left', 'right']),
    vastu: z.boolean(),
    aesthetic: z.enum(styles),
    budget: z.number().int().min(80000).max(400000),
    wants: z.array(z.enum(amenities)).max(12),
    prefer: z.array(z.string().refine((id) => products.has(id), 'unknown product id')).max(30).default([]),
  });
}
export type DesignState = z.infer<ReturnType<typeof makeStateSchema>>;

export const SessionCreateSchema = z.object({
  consent: z.boolean(),
  consentVersion: z.string().max(40).optional(),
  externalId: z.string().regex(/^[\w.:-]{1,64}$/).optional(),
  condition: z.string().max(40).optional(),
  screen: z.string().max(20).optional(),
  viewport: z.string().max(20).optional(),
  locale: z.string().max(20).optional(),
  client: z.object({ catalog: z.string().max(40), catalogHash: z.string().max(40), solver: z.string().max(40) }).partial().optional(),
});

export const EventsSchema = z.object({
  events: z.array(z.object({
    type: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
    t: z.number().int().nonnegative().optional(),
    data: z.record(z.string(), z.unknown()).default({}),
  })).max(100),
});

/** JSON stays JSON: bound the size of anything free-form we store. */
export const boundedJson = (max: number) => z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v).length <= max, `object larger than ${max} characters`);

export const EVENT_DATA_MAX = 4000;
export const LAYOUT_MAX = 60_000;
