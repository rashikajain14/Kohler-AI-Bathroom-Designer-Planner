import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
const firstExisting = (paths: string[]) => paths.find((p) => existsSync(p)) ?? paths[0]!;

export interface Config {
  port: number;
  dbPath: string;
  publicDir: string;
  solverPath: string;
  studyConfigPath: string;
  studyMode: boolean;
  conditions: string[];
  allowConditionOverride: boolean;
  anthropicApiKey?: string;
  anthropicModel: string;
  aiCallsPerSession: number;
  storeImages: boolean;
  maxImageBytes: number;
  adminUser: string;
  adminPassword?: string;
  trustProxy: boolean | number | string;
  disclaimer: string;
  logRequests: boolean;
}

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const int = (v: string | undefined, d: number) => (v && Number.isFinite(+v) ? Math.trunc(+v) : d);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const trust = env.TRUST_PROXY;
  return {
    port: int(env.PORT, 3000),
    dbPath: env.DATABASE_PATH || resolve(process.cwd(), 'data/app.db'),
    publicDir: env.PUBLIC_DIR || firstExisting([resolve(here, '../public'), resolve(here, '../../dist/public')]),
    solverPath: env.SOLVER_PATH || firstExisting([resolve(here, '../solver.cjs'), resolve(here, '../../dist/solver.cjs')]),
    studyConfigPath: env.STUDY_CONFIG || resolve(process.cwd(), 'study.config.json'),
    studyMode: bool(env.STUDY_MODE, true),
    conditions: (env.CONDITIONS || 'manual,ai').split(',').map((s) => s.trim()).filter(Boolean),
    allowConditionOverride: bool(env.ALLOW_CONDITION_OVERRIDE, false),
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    anthropicModel: env.ANTHROPIC_MODEL || 'claude-sonnet-5',
    aiCallsPerSession: int(env.AI_CALLS_PER_SESSION, 60),
    storeImages: bool(env.STORE_IMAGES, false),
    maxImageBytes: int(env.MAX_IMAGE_MB, 5) * 1024 * 1024,
    adminUser: env.ADMIN_USER || 'admin',
    adminPassword: env.ADMIN_PASSWORD || undefined,
    trustProxy: trust === undefined || trust === '' ? false : /^\d+$/.test(trust) ? +trust : /^(true|false)$/i.test(trust) ? /^true$/i.test(trust) : trust,
    disclaimer: env.SITE_DISCLAIMER || 'Kohler research prototype. Prices are those in the study catalogue.',
    logRequests: bool(env.LOG_REQUESTS, true),
  };
}

/* ---------------- study configuration (tasks, consent, questionnaire) ---------------- */
const Constraints = z.object({
  length: z.number().int().min(5).max(12).optional(),
  width: z.number().int().min(4).max(9).optional(),
  height: z.number().int().min(8).max(10).optional(),
  face: z.enum(['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West']).optional(),
  doorWall: z.enum(['auto', 'front', 'left', 'right']).optional(),
  vastu: z.boolean().optional(),
  aesthetic: z.string().optional(),
  budget: z.number().int().min(80000).max(400000).optional(),
  wants: z.array(z.string()).optional(),
});
export const StudyConfigSchema = z.object({
  consentVersion: z.string().min(1).max(40),
  consentTitle: z.string(),
  consentIntro: z.string(),
  consentText: z.string(),
  consentAgreeLabel: z.string(),
  completionNote: z.string().optional().default(''),
  tasks: z.array(z.object({ id: z.string().regex(/^[\w-]{1,40}$/), title: z.string(), brief: z.string(), constraints: Constraints.optional() })),
  questionnaire: z.object({
    type: z.enum(['sus', 'custom']),
    title: z.string(),
    intro: z.string(),
    items: z.array(z.object({ id: z.string().regex(/^[\w-]{1,40}$/), text: z.string(), reverse: z.boolean().optional() })).max(40),
    scale: z.object({ minLabel: z.string(), maxLabel: z.string() }),
    commentPrompt: z.string().optional(),
  }),
});
export type StudyConfig = z.infer<typeof StudyConfigSchema>;

export function loadStudyConfig(path: string): StudyConfig {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return StudyConfigSchema.parse(raw);
}
