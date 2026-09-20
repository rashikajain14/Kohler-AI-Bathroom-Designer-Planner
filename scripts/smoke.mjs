// End-to-end check in a real browser (Playwright + Chromium) against the built server.
// A local mock of the Anthropic Messages API stands in for Claude, so the real SDK, the
// tool loop and the photo-analysis path are all exercised without a key.
//   npx playwright install chromium   (once)     then:   npm run build && npm run smoke
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const PORT = 3457, MOCK = 3458, base = `http://127.0.0.1:${PORT}`;
const shots = process.env.SHOTS_DIR || join(tmpdir(), 'kbd-shots');
import { mkdirSync } from 'node:fs'; mkdirSync(shots, { recursive: true });
const failures = [], notes = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log((cond ? '  ok   ' : '  FAIL ') + msg); };

/* ---------- mock Anthropic ---------- */
const analysis = { style: 'Japanese Zen', closestPreset: 'zen', colors: ['Beige', 'Oak'], tiles: 'stone', flooring: 'oak', vanity: 'floating oak', toilet: 'not visible', shower: 'walk-in', bathtub: 'not visible', mirror: 'round', lighting: 'warm', finishes: 'Brushed brass', accessories: ['Plant', 'Towel rail'] };
const mockCalls = []; let chatN = 0;
const mock = createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const j = JSON.parse(body || '{}'); mockCalls.push(j);
    const last = j.messages[j.messages.length - 1];
    const isImage = Array.isArray(j.messages[0].content) && j.messages[0].content.some((b) => b.type === 'image');
    let content, stop = 'end_turn';
    if (isImage) content = [{ type: 'text', text: JSON.stringify(analysis) }];
    else if (Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result'))
      content = [{ type: 'text', text: 'Done. I have reported what the solver said.' }];
    else { const key = chatN++ === 0 ? 'bath' : 'fan'; content = [{ type: 'text', text: `Adding the ${key}.` }, { type: 'tool_use', id: 'toolu_smoke' + chatN, name: 'add_amenity', input: { key } }]; stop = 'tool_use'; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_smoke', type: 'message', role: 'assistant', model: j.model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }));
  });
}).listen(MOCK);

/* ---------- app server ---------- */
const dataDir = mkdtempSync(join(tmpdir(), 'kbd-'));
const srv = spawn('node', ['dist/server/index.js'], { cwd: root, env: { ...process.env, PORT, DATABASE_PATH: join(dataDir, 'app.db'), ADMIN_PASSWORD: 'smoke-pass',
  ALLOW_CONDITION_OVERRIDE: 'true', ANTHROPIC_API_KEY: 'sk-ant-mock', ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK}`, LOG_REQUESTS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = ''; srv.stdout.on('data', (d) => (srvLog += d)); srv.stderr.on('data', (d) => (srvLog += d));
for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }

/* a tiny valid PNG for the upload test */
const crc = (() => { const t = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; }); return (b) => { let c = -1; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }; })();
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const W = 64, H = 48, raw = Buffer.alloc((W * 3 + 1) * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = 200; raw[o + 1] = 190 - y; raw[o + 2] = 170; }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
const pngPath = join(dataDir, 'bath.png'); writeFileSync(pngPath, png);

const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', process.env.CHROME_PATH].find((p) => p && existsSync(p));
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function newPage(cond, viewport = { width: 1360, height: 900 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  // a beacon that is still in flight when the page navigates is reported as aborted by the browser; delivery is asserted separately
  page.on('requestfailed', (r) => { if (!(/\/api\/events/.test(r.url()) && /ABORTED/.test(r.failure()?.errorText || ''))) errs.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')); });
  await page.goto(`${base}/?pid=SMOKE-${cond}&condition=${cond}`);
  return { ctx, page, errs };
}
const settle = async (page) => { await page.waitForFunction(() => { const s = document.querySelector('#vlabel span'); return s && !/Solving/.test(s.textContent); }, null, { timeout: 15000 }); await page.waitForTimeout(250); };

try {
  /* ================= AI arm ================= */
  console.log('\nAI arm');
  const { ctx, page, errs } = await newPage('ai');
  await page.waitForSelector('.modal');
  ok(/take part|bathroom-planning study/i.test(await page.textContent('.modal h2')), 'consent modal appears before anything is recorded');
  await page.screenshot({ path: join(shots, '01-consent.png') });
  ok(await page.isDisabled('#cYes'), 'agree button is disabled until the box is ticked');
  await page.check('#agreeBox'); await page.click('#cYes');
  await page.waitForFunction(() => localStorage.getItem('kbd.session.v1'));
  await page.waitForLoadState('load'); await page.waitForSelector('#pcode:not([hidden])');
  ok(/Participant P-/.test(await page.textContent('#pcode')), 'participant code is shown after consent');

  const hero = await page.textContent('#heroBadge');
  ok(/Minimalist Modern · ₹ [\d,]+ · layout score \d+%/.test(hero), `hero badge is computed by the solver: "${hero.trim()}"`);
  await page.screenshot({ path: join(shots, '02-home.png') });

  await page.goto(`${base}/#/designer`); await settle(page);
  ok(await page.isVisible('#assistCard') && await page.isVisible('#inspoCard'), 'AI arm sees the assistant and the photo-analysis card');
  const webgl = await page.evaluate(() => !document.getElementById('viewport').classList.contains('failed') && !!document.querySelector('#viewport canvas'));
  notes.push(`3D canvas rendered in headless Chromium: ${webgl}`);
  ok(await page.isVisible('#taskCard .task'), 'study task card is shown');
  ok(/Layout score \d+%/.test(await page.textContent('#summary')), 'summary shows "Layout score", not "AI match"');
  await page.click('#summary details.formula summary');
  ok(/Total is within budget/.test(await page.textContent('#summary')), 'the score formula is one click away');
  await page.screenshot({ path: join(shots, '03-designer.png'), fullPage: true });

  await page.click('#taskStart'); await settle(page);
  ok(await page.inputValue('#len') === '6' && await page.inputValue('#wid') === '5', 'starting a task applies its 6 × 5 ft room');
  ok(/1,60,000/.test(await page.textContent('#budgetLabel')), 'and its ₹1,60,000 budget');
  ok(await page.isVisible('#taskFinish') && await page.isVisible('#taskTimer'), 'timer and Finish button appear');
  await page.screenshot({ path: join(shots, '04-task.png'), fullPage: true });

  await page.click('#compass [data-dir="East"]'); await settle(page);
  await page.click('#styleGrid [data-k="luxury"]'); await settle(page);
  ok(await page.evaluate(() => document.querySelector('.step[data-s="1"]').classList.contains('done')), 'stepper marks "Your space" done only after you changed something');

  /* shortlist drives the solver */
  await page.goto(`${base}/#/products`); await page.waitForSelector('#catalog .bigcard');
  ok(await page.locator('#catalog .bigcard').count() === 22, 'collection lists all 22 products');
  ok(await page.locator('#filters .fchip').count() >= 9, 'filter chips cover every category (was 6 of 10)');
  await page.click('#filters .fchip:has-text("Bathtub")');
  ok(await page.locator('#catalog .bigcard:not(.hidden)').count() === 2, 'the Bathtub chip filters to the 2 bathtubs');
  await page.click('#filters .fchip:has-text("All")');
  await page.click('.addbtn[data-id="artshower"]');
  ok(/1/.test(await page.textContent('#trayN')) && /of ₹ [\d,]+ budget/.test(await page.textContent('#tray')), 'shortlist tray shows the running total against the budget');
  ok(await page.locator('#cmp tbody tr').count() >= 8, 'compare table lists every category the layouts use');
  ok(/Layout score/.test(await page.textContent('#cmp')) && !/AI match/.test(await page.textContent('#cmp')), 'compare table uses the honest score label');
  await page.screenshot({ path: join(shots, '05-collection.png'), fullPage: true });
  await page.goto(`${base}/#/designer`); await settle(page);
  ok(/Artifacts/.test(await page.textContent('#strip')), 'a shortlisted product now appears in the designer');

  /* Claude chat: tool call executed against the solver */
  await page.fill('#chatIn', 'Please add a bathtub'); await page.press('#chatIn', 'Enter');
  await page.waitForFunction(() => /I have reported what the solver said/.test(document.getElementById('log').textContent), null, { timeout: 15000 });
  ok(await page.evaluate(() => !document.querySelector('#checks .chk[data-k="bath"]').classList.contains('on')), 'guardrail: Claude asked for a bathtub in a 6 × 5 ft room and the solver refused it');
  const refusal = mockCalls.at(-1).messages.at(-1).content[0].content;
  ok(/"ok":false/.test(refusal), 'the refusal was reported back to Claude as a tool result: ' + refusal.slice(0, 90));
  ok(mockCalls.some((c) => c.tools && c.system.includes('design_state')), 'the API call carried the tools and the design state');
  await page.fill('#chatIn', 'and a fan please'); await page.press('#chatIn', 'Enter');
  await page.waitForFunction(() => document.querySelector('#checks .chk[data-k="fan"]').classList.contains('on'), null, { timeout: 15000 });
  ok(true, 'a request the solver accepts (extractor fan) is applied to the live layout');
  await page.screenshot({ path: join(shots, '06-chat.png'), fullPage: true });

  /* inspiration photo */
  await page.setInputFiles('#inspoFile', pngPath);
  await page.waitForSelector('#inspoPreviewWrap.show'); await page.click('#inspoAnalyzeBtn');
  await page.waitForFunction(() => /Japanese Zen/.test(document.getElementById('inspoAnalysisBody').textContent), null, { timeout: 15000 });
  await page.click('#inspoApplyBtn'); await settle(page);
  ok(await page.evaluate(() => document.querySelector('#styleGrid [data-k="zen"]').classList.contains('on')), 'photo analysis maps to the Zen preset and re-solves');

  /* save / list / open */
  await page.click('#saveB'); await page.waitForSelector('#dName'); await page.fill('#dName', 'Smoke design'); await page.click('#sYes');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('toast').textContent));
  await page.click('#myDesigns'); await page.waitForSelector('.dl-item');
  ok(/Smoke design/.test(await page.textContent('.dl')), 'a saved design is listed under My designs');
  await page.click('[data-load]'); await settle(page);
  ok(await page.evaluate(() => document.querySelector('#styleGrid [data-k="zen"]').classList.contains('on')), 'opening it restores the style');
  ok(await page.evaluate(() => document.querySelector('.step[data-s="4"]').classList.contains('done')), 'step 4 is done after saving');

  /* export */
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportB')]);
  ok(/bathroom-layout-.*\.json/.test(dl.suggestedFilename()), 'Export JSON downloads a file');


  /* finish the task with the SUS questionnaire */
  await page.click('#taskFinish'); await page.waitForSelector('#qForm');
  ok(await page.isDisabled('#qSend'), 'submit is disabled until every item is answered');
  for (let i = 1; i <= 10; i++) await page.check(`input[name="q_sus${i}"][value="${i % 2 ? 5 : 1}"]`);
  await page.fill('#qComment', 'Smoke run <b>bold</b>');
  await page.screenshot({ path: join(shots, '07-questionnaire.png') });
  await page.click('#qSend');
  await page.waitForFunction(() => /Answers sent/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
  ok(/Task 2 of 3/.test(await page.textContent('#taskCard')), 'the next task is ready');

  /* events reached the server */
  await page.evaluate(() => flushEvents()); await page.waitForTimeout(600);
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:smoke-pass').toString('base64') };
  const evCsv = await (await fetch(base + '/admin/export/events.csv', { headers: auth })).text();
  for (const t of ['session_start', 'layout', 'task_start', 'chat_user', 'ai_tool', 'shortlist', 'design_saved', 'task_finish', 'inspiration_analyzed'])
    ok(evCsv.includes(',' + t + ','), `event "${t}" was recorded`);
  const resCsv = await (await fetch(base + '/admin/export/responses.csv', { headers: auth })).text();
  ok(/,100,/.test(resCsv), 'SUS = 100 was computed on the server for the all-positive answers');
  const dash = await (await fetch(base + '/admin', { headers: auth })).text();
  ok(/Outcomes by condition/.test(dash) && !/<b>bold<\/b>/.test(dash), 'admin dashboard renders and does not echo raw HTML');

  /* delete my data */
  await page.click('#deleteData'); await page.click('#xYes');
  await page.waitForFunction(() => !localStorage.getItem('kbd.session.v1'));
  const after = await (await fetch(base + '/admin/export/sessions.csv', { headers: auth })).text();
  ok(!after.includes('SMOKE-ai'), '"Delete my study data" removed the participant from the server');

  const real = errs.filter((e) => !/favicon/.test(e));
  ok(real.length === 0, 'no console errors or failed requests in the AI arm' + (real.length ? ': ' + real.join(' | ') : ''));
  await ctx.close();

  /* ================= manual arm ================= */
  console.log('\nManual arm');
  const m = await newPage('manual');
  await m.page.check('#agreeBox'); await m.page.click('#cYes'); await m.page.waitForSelector('#pcode:not([hidden])');
  await m.page.goto(`${base}/#/designer`); await settle(m.page);
  ok(!(await m.page.isVisible('#assistCard')) && !(await m.page.isVisible('#inspoCard')), 'manual arm sees neither the assistant nor the photo card');
  const before = mockCalls.length;
  const tok = await m.page.evaluate(() => JSON.parse(localStorage.getItem('kbd.session.v1')).token);
  const forced = await fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], context: {} }) });
  ok(forced.status === 403 && mockCalls.length === before, 'and the server refuses AI calls from it');
  /* delivery on unload: an event queued right before the page goes away must still reach the server */
  await m.page.evaluate(() => track('unload_probe', { n: 1 })); await m.page.goto('about:blank'); await new Promise((r) => setTimeout(r, 800));
  const evNow = await (await fetch(base + '/admin/export/events.csv', { headers: auth })).text();
  ok(evNow.includes(',unload_probe,'), 'an event queued as the page unloads still reaches the server (sendBeacon)');
  await m.page.goto(`${base}/#/designer`); await settle(m.page);
  await m.page.click('#arrToggle'); ok(await m.page.evaluate(() => document.getElementById('arrToggle').classList.contains('on')), 'arrange mode toggles');
  await m.page.goto(`${base}/`); await m.page.waitForSelector('#skipLink', { state: 'attached' }); await m.page.keyboard.press('Tab');
  ok(await m.page.evaluate(() => document.activeElement.id === 'skipLink'), 'skip link is the first tab stop');
  ok(m.errs.filter((e) => !/favicon/.test(e)).length === 0, 'no console errors in the manual arm' + (m.errs.length ? ': ' + m.errs.join(' | ') : ''));
  await m.ctx.close();

  /* ================= consent declined + mobile ================= */
  console.log('\nDecline and mobile');
  const d = await newPage('ai');
  await d.page.click('#cNo');
  ok(/Nothing has been recorded/.test(await d.page.textContent('.modal')), 'declining records nothing');
  const cnt = await (await fetch(base + '/admin/export/sessions.csv', { headers: auth })).text();
  ok(!cnt.includes('SMOKE-ai'), 'no session exists for a participant who declined');
  await d.ctx.close();
  const mob = await newPage('ai', { width: 390, height: 844 });
  await mob.page.check('#agreeBox'); await mob.page.click('#cYes'); await mob.page.waitForFunction(() => localStorage.getItem('kbd.session.v1')); await mob.page.waitForTimeout(1200);
  await mob.page.goto(`${base}/#/designer`); await settle(mob.page);
  const overflow = await mob.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(overflow <= 1, `no horizontal scroll at 390 px wide (overflow ${overflow}px)`);
  ok(await mob.page.isVisible('#taskCard .task') && await mob.page.isVisible('#inspoCard'), 'phone layout shows the task card and photo card in the AI arm');
  await mob.page.screenshot({ path: join(shots, '08-mobile.png'), fullPage: false });
  await mob.ctx.close();
} catch (e) {
  failures.push('script error: ' + e.message); console.error(e);
} finally {
  await browser.close(); srv.kill('SIGTERM'); mock.close();
}
console.log('\nNotes:', notes.join('; '));
console.log(failures.length ? `\n${failures.length} FAILED\n${failures.join('\n')}\n--- server log ---\n${srvLog.slice(-1500)}` : '\nAll browser checks passed.');
process.exit(failures.length ? 1 : 0);
