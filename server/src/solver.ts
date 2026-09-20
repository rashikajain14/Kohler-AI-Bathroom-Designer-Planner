import { createRequire } from 'node:module';

/** The exact solver the browser runs (dist/solver.cjs), so the server can recompute any layout. */
export interface Solver {
  solve(state: Record<string, unknown>): {
    score: number; fit: number; total: number; metrics: Record<string, unknown>; items: unknown[]; dropped: string[];
    products: { id: string }[]; notices: { level: string; text: string }[]; vastuStats: unknown;
  };
  STATE: Record<string, unknown>;
  AES_KEYS: string[];
  AMENITY: { k: string; label: string }[];
  PRODUCTS: { id: string; cat: string; name: string; price: number }[];
  SOLVER_VERSION: string;
  CATALOG_VERSION: string;
  CATALOG_HASH: string;
}

export function loadSolver(path: string): Solver {
  return createRequire(import.meta.url)(path) as Solver;
}
