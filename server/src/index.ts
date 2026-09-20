import { existsSync } from 'node:fs';
import { createAnthropicClient } from './ai.js';
import { createApp } from './app.js';
import { loadConfig, loadStudyConfig } from './config.js';
import { openDb, tokenSecret } from './db.js';
import { makeStateSchema } from './schemas.js';
import { loadSolver } from './solver.js';

const config = loadConfig();
if (!existsSync(config.solverPath)) {
  console.error(`Solver build not found at ${config.solverPath}. Run "npm run build" first.`);
  process.exit(1);
}
const solver = loadSolver(config.solverPath);
const study = loadStudyConfig(config.studyConfigPath);
const db = openDb(config.dbPath);
const ai = config.anthropicApiKey ? createAnthropicClient(config.anthropicApiKey, config.anthropicModel) : null;

const app = createApp({ config, db, secret: tokenSecret(db), solver, study, ai, stateSchema: makeStateSchema(solver) });
const server = app.listen(config.port, () => {
  console.log(JSON.stringify({
    t: new Date().toISOString(), msg: 'listening', port: config.port, studyMode: config.studyMode, ai: ai ? config.anthropicModel : 'disabled',
    admin: config.adminPassword ? 'enabled' : 'disabled (set ADMIN_PASSWORD)', solver: solver.SOLVER_VERSION, catalog: solver.CATALOG_VERSION,
  }));
  if (!ai) console.warn('ANTHROPIC_API_KEY is not set: the AI assistant and photo analysis are turned off.');
  if (config.trustProxy === false && process.env.NODE_ENV === 'production') console.warn('TRUST_PROXY is not set. Behind a reverse proxy, set TRUST_PROXY=1 so rate limits see real client IPs.');
});

const stop = () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(1), 8000).unref(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
