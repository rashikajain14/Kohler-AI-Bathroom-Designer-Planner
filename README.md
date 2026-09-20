# Kohler AI Bathroom Designer — research platform

A bathroom-planning web app built around a deterministic layout solver — not a template gallery — plus
a full study backend (consent, balanced conditions, timed tasks, SUS questionnaire, event logging, and
CSV exports for research analysis).

Give it a room size, a style, a budget, and (in the AI condition) optionally a photo, and the solver
computes a collision-free layout: every fixture's position, clearance, door swing, and Vastu bearing is
checked before anything is drawn. The 2D floor plan and the 3D room are two views of that one solved
layout, so they never drift out of sync.

> **Status:** prototype under active development for a planned usability study. Prices, consent text and
> the Vastu rule table are placeholders — see [Before running a real study](#before-running-a-real-study).

---

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [API reference](#api-reference)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security notes](#security-notes)
- [Study mode](#study-mode)
- [Before running a real study](#before-running-a-real-study)
- [Known issues](#known-issues)

---

## Features

**Room planning & solver**
- Deterministic constraint solver (`client/src/js/50-solver.js`, ~1,080 lines) — scores every candidate
  placement for clearance, circulation, door access, and cost before a layout is ever shown.
- Six style presets (Minimalist Modern, Classic Luxury, Japanese Zen, Urban Industrial, Coastal Spa,
  Scandi Warm), a budget ceiling, room dimensions, and back-wall compass orientation as inputs.
- Optional Vastu placement guidance, scored against direction bearings — not a decorative label.
- Drag, rotate, and rearrange fixtures by hand after the solver places them
  (`client/src/js/80-arrange.js`, ~630 lines) without breaking collision constraints.

**2D + 3D, one source of truth**
- SVG floor plan (`60-plan.js`) and a Three.js 3D room (`70-three.js`, `71-models.js`, `72-scene.js`)
  are both generated from the same solved layout object — changing one input re-solves both views together.

**AI, only where it's declared**
- **Design assistant** (`87-claude-chat.js` client, `/api/chat` server) — a genuine Claude tool-use loop.
  The model can only act through seven declared tools (`add_amenity`, `remove_amenity`, `set_style`,
  `set_budget`, `set_room`, `set_orientation`, `set_vastu`); it never places a fixture itself, and its
  system prompt explicitly forbids claiming a fact the tool results or current design state don't support.
- **Upload Inspiration** (`91-inspo.js` client, `/api/inspiration/analyze` server) — uploads a real
  bathroom photo, sends it to Claude for structured JSON analysis (style, colors, tiles, flooring, vanity,
  toilet, shower, bathtub, mirror, lighting, finishes, accessories), and uses that to re-solve the user's
  actual room — never as a background image.
- Everything else that talks in plain language (layout notices, "why it doesn't fit" explanations, the
  product catalog) is template text driven by the solver's own output, not a model call.

**Study infrastructure**
- Consent screen with a versioned consent text, balanced random assignment across conditions
  (`manual` / `ai`), per-session event logging, a short task list with duration tracking, and a System
  Usability Scale (SUS) questionnaire.
- Saved designs persist per session (`POST /api/designs`) and can be revisited.
- `/admin` dashboard (HTTP Basic auth, only exists if `ADMIN_PASSWORD` is set) with live counts and CSV
  exports of sessions, events, designs, and questionnaire responses.

## Quick start

Requires **Node.js 22.13+**.

```bash
npm ci
npm run build
cp .env.example .env
# edit .env: set ADMIN_PASSWORD, and ANTHROPIC_API_KEY if you want the AI condition to work
set -a; . ./.env; set +a
npm start
# → http://localhost:3000
```

Without `ANTHROPIC_API_KEY`, the app runs normally — every feature works except the design assistant and
photo analysis, which report themselves as unavailable rather than failing silently.

## Configuration

All configuration is environment variables (see `.env.example`, copied above). Everything has a safe
default except the two secrets.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATABASE_PATH` | `./data/app.db` | SQLite file (`node:sqlite`) — put it on a persistent volume in production |
| `STUDY_MODE` | `true` | `true`: consent, tasks, logging, balanced conditions. `false`: a plain product — no consent, nothing logged |
| `CONDITIONS` | `manual,ai` | Conditions participants are balanced across |
| `ALLOW_CONDITION_OVERRIDE` | `false` | Lets `?condition=manual&pid=ABC` force a condition — pilot-only, keep `false` for a real study |
| `STUDY_CONFIG` | `./study.config.json` | Path to consent text, tasks, and questionnaire |
| `ANTHROPIC_API_KEY` | *(unset)* | Without it, AI features are switched off; everything else still works |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | Model used for the chat assistant and photo analysis |
| `AI_CALLS_PER_SESSION` | `60` | Hard cap on AI calls (chat + photo analyses) per session — controls spend |
| `STORE_IMAGES` | `false` | Keep uploaded inspiration photos on disk; default keeps only the text analysis |
| `MAX_IMAGE_MB` | `5` | Upload size limit |
| `ADMIN_USER` / `ADMIN_PASSWORD` | `admin` / *(unset)* | `/admin` only exists once a password is set |
| `TRUST_PROXY` | *(unset)* | Reverse-proxy hop count (Render/Fly/Railway/nginx: `1`) — needed for correct per-IP rate limiting |
| `SITE_DISCLAIMER` | *(prototype text)* | Shown in the page footer |
| `LOG_REQUESTS` | `true` | Structured JSON access logging |

## Architecture

```
                 ┌──────────────────────────────┐
  browser  ───▶  │  client (one concatenated JS  │
                 │  bundle, no framework)        │
                 │  solver · 2D plan · 3D room ·  │
                 │  drag/arrange · catalog · chat │
                 └───────────────┬────────────────┘
                                 │ /api/*
                 ┌───────────────▼────────────────┐
                 │  server (Express + TypeScript)  │
                 │  sessions · study logging ·     │
                 │  saved designs · admin exports  │
                 └───────────────┬────────────────┘
                        only on-demand, gated by
                        study condition + quota
                                 │
                 ┌───────────────▼────────────────┐
                 │  Claude (Anthropic API)         │
                 │  tool-use chat · photo analysis │
                 └─────────────────────────────────┘
```

The solver is written **once**, in `client/src/js/{00-util,40-data,50-solver}.js`, and reused twice:
`client/build.mjs` both bundles it into the browser build *and* compiles a Node-compatible
`dist/solver.cjs`, so `POST /api/designs` can re-validate a submitted layout server-side with the exact
same logic the browser used, rather than trusting the client.

There is no client framework and no bundler beyond esbuild for minification — the app is a set of ordered
script files concatenated in filename order (the `NN-name.js` prefixes are load order, not modules).
Fonts and Three.js are vendored into the build (self-hosted), so the running app makes no third-party
requests other than the Anthropic API calls the server makes on its behalf.

## Project structure

```
client/src/js/
  00-util.js          small shared helpers
  10-shell.js         page shell / navigation
  20-art.js            SVG icon art
  40-data.js           style presets, Vastu rule table, amenities, fixture geometry
  50-solver.js         the constraint solver (shared with the server via dist/solver.cjs)
  60-plan.js           2D floor plan (SVG), driven by the solved layout
  70-three.js          Three.js scene setup
  71-models.js         procedural 3D fixture models
  72-scene.js          3D room assembly from the layout object
  73-hero.js           landing-page hero visual
  80-arrange.js        drag / rotate / rearrange interaction layer
  85-assistant.js      local (non-AI) layout helper logic
  86-platform.js       session/local-storage, toasts, app-wide plumbing
  87-claude-chat.js    design assistant — talks to /api/chat, runs the tool-use loop
  90-ui.js             general UI wiring
  91-inspo.js          Upload Inspiration — talks to /api/inspiration/analyze
  95-prodpage.js       product catalog page
  99-boot.js           entry point

server/src/
  index.ts             process entry point
  app.ts               Express app: helmet CSP, logging, routing, error handling
  config.ts            env parsing + study.config.json validation (zod)
  ai.ts                Anthropic client, analysis/chat prompts, request schemas
  auth.ts              HMAC session tokens, HTTP Basic admin auth
  db.ts                SQLite schema + migrations (sessions, events, designs, responses)
  csv.ts                RFC 4180 CSV export (with formula-injection guarding)
  solver.ts             loads dist/solver.cjs for server-side re-validation
  study.ts              study.config.json → typed tasks/consent/questionnaire
  schemas.ts             zod schemas for the solver's own state shape
  routes/
    public.ts            /healthz, /api/config
    participant.ts       session lifecycle, events, saved designs, questionnaire responses
    ai.ts                 /api/inspiration/analyze, /api/chat
    admin.ts               /admin dashboard + CSV exports

catalog/products.json    versioned product catalog (its hash is stored with every session/design)
study.config.json        consent text, task list, questionnaire
server/test/              Vitest suites (api.test.ts, solver.test.ts)
benchmark/run.mjs         solver benchmark harness
scripts/smoke.mjs          real-browser end-to-end check (Playwright)
```

## API reference

All `/api/*` routes except `/api/config` and session creation require a bearer session token
(`Authorization: Bearer <token>`, issued by `POST /api/session`).

| Method & path | Purpose |
|---|---|
| `GET /healthz` | Liveness check (`SELECT 1`) |
| `GET /api/config` | Public config: study mode, whether AI is enabled, catalog/solver versions, consent text |
| `POST /api/session` | Create a session; balances condition assignment, rate-limited |
| `GET /api/session` | Fetch the current session |
| `POST /api/session/delete` | Participant-initiated data deletion |
| `POST /api/events` | Log a UI event (also accepts a body-carried token, for `navigator.sendBeacon`) |
| `POST /api/designs` | Save a design — server re-solves and re-validates it before storing |
| `GET /api/designs` / `GET /api/designs/:id` | List / fetch saved designs |
| `DELETE /api/designs/:id` | Delete a saved design |
| `POST /api/responses` | Submit a task's questionnaire answers + SUS score |
| `POST /api/inspiration/analyze` | Upload a photo (base64 JPEG/PNG/WEBP, sniffed by magic bytes, not by label) → structured analysis |
| `POST /api/chat` | One turn of the tool-use design assistant |
| `GET /admin` | Dashboard (HTTP Basic auth) |
| `GET /admin/export/:file` | CSV export: `sessions`, `events`, `designs`, or `responses` |

`/api/inspiration/analyze` and `/api/chat` are both gated: they 503 if no `ANTHROPIC_API_KEY` is
configured, 403 if the participant's study condition doesn't include AI, and 429 once
`AI_CALLS_PER_SESSION` is spent — a failed upstream call refunds the quota it consumed.

## Testing

```bash
npm test              # builds the client, then runs the Vitest suites
npm run smoke          # real-browser end-to-end check (needs: npx playwright install chromium)
npm run benchmark       # solver benchmark
npm run typecheck
```

`npm test` currently passes **38 tests** across two suites: `api.test.ts` (22, the HTTP layer against a
fake AI client) and `solver.test.ts` (16, including a randomized robustness check across **2,000 random
rooms** asserting no exception, no overlap, nothing placed out of bounds, over-budget always flagged, and
every placed fixture priced).

## Deployment

**Docker Compose** (local or a single box):

```bash
docker compose up --build
```

Reads `.env`, keeps the SQLite file on a named volume. Mount your own `study.config.json` read-only (see
the commented line in `docker-compose.yml`) to change tasks, consent text, or the questionnaire without
rebuilding the image.

**Render**: point a Blueprint at this repo (`render.yaml`) and set `ANTHROPIC_API_KEY` and
`ADMIN_PASSWORD` in the dashboard; it provisions a persistent disk at `/data` automatically.

The production Docker image is a two-stage build (`npm ci` → `npm run build` → `npm prune --omit=dev`)
running as a non-root `node` user, with a container `HEALTHCHECK` against `/healthz`.

## Security notes

- Content-Security-Policy via `helmet`, `default-src 'self'` — no third-party script/style/font hosts,
  since fonts and Three.js are vendored into the build rather than loaded from a CDN.
- Session tokens are HMAC-signed (`id.signature`), verified with a constant-time comparison.
- `/admin` uses HTTP Basic auth with constant-time credential comparison, and **does not exist as a route
  at all** unless `ADMIN_PASSWORD` is set (returns a plain 404, not a login prompt).
- Uploaded images are validated by sniffing magic bytes server-side, not by trusting the declared
  content type.
- CSV exports escape values that a spreadsheet would interpret as a formula (leading `=`, `+`, `-`, `@`),
  since these exports routinely contain participants' free-text answers opened in Excel.
- Rate limiting on session creation, chat, photo analysis, and the admin route.

## Study mode

With `STUDY_MODE=true` (the default), a participant sees a consent screen before anything else; consent
and its version are recorded with the session. Participants are balanced across `CONDITIONS`
(`manual` = no AI features at all; `ai` = assistant + photo analysis available). Every meaningful UI
action is logged as an event; each task's duration and questionnaire answers (including a computed SUS
score) are recorded. Researchers pull `sessions`, `events`, `designs`, and `responses` as CSV from
`/admin`.

Set `STUDY_MODE=false` to run the same app as a plain product: no consent screen, nothing logged, saved
designs still work.

## Before running a real study

- [ ] Replace the placeholder consent text in `study.config.json` and bump `consentVersion`.
- [ ] Replace `catalog/products.json` prices with the real catalog. The placeholder prices make the
      cheapest complete bathroom ₹1,43,000 — keep task budgets above that, or replace them too.
- [ ] Review the Vastu rule table in `client/src/js/40-data.js` — it is currently **provisional and
      uncited**; the chat assistant is instructed to describe it as guidance, never as fact, but the table
      itself should be checked before use in a real study.
- [ ] Set `ALLOW_CONDITION_OVERRIDE=false` so participants cannot pick their own condition.
- [ ] Decide on `STORE_IMAGES` — the default keeps only the AI's text analysis of an inspiration photo,
      not the photo itself.

## Known issues

- The solver benchmark's default grid (`npm run benchmark`) is oversized and needs trimming before it's
  useful for quick iteration.
- `docs/RESEARCH.md` and `docs/DEPLOY.md` are referenced conceptually but not written yet.
- `package.json`'s `start` script pointed at a stale path (`dist/server/src/index.js`) left over from an
  earlier `tsconfig.json` layout; `tsc` actually emits to `dist/server/index.js` per the current
  `rootDir`/`outDir`. Fixed while preparing this README and re-verified (`npm run build && npm start`
  now serves `/healthz` and `/` correctly) — worth a second look if you've been invoking the compiled
  file directly elsewhere (e.g. a custom `Procfile`).
