/* ==================================================================
   PLATFORM LAYER — talks to the server: study session and consent,
   event tracking, tasks and questionnaire, saved designs, export.
   Nothing here changes how the solver behaves.
   ================================================================== */
const APP = { cfg: null, session: null, studyMode: false, condition: 'ai', aiOn: false };
const LS_SESSION = 'kbd.session.v1', LS_SHORT = 'kbd.shortlist.v1', LS_PROG = 'kbd.progress.v1';
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
const lsDel = k => { try { localStorage.removeItem(k); } catch (_) {} };

async function api(method, path, body){
  const headers = { 'Content-Type': 'application/json' };
  if(APP.session) headers.Authorization = 'Bearer ' + APP.session.token;
  const r = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await r.json(); } catch (_) {}
  if(!r.ok){
    const e = new Error((data && data.error) || ('HTTP ' + r.status));
    e.status = r.status; e.data = data; e.code = data && data.code;
    throw e;
  }
  return data;
}

/* ---------- toast + modal ---------- */
function toast(msg){
  const t = $('toast'); if(!t) return;
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 3000);
}
function openModal(html, opts){
  opts = opts || {};
  const root = $('modalRoot'), prev = document.activeElement;
  root.innerHTML = `<div class="modal-back" role="presentation"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle" tabindex="-1">${html}</div></div>`;
  const back = root.firstChild, box = back.firstChild;
  const close = () => {
    root.innerHTML = ''; document.removeEventListener('keydown', onKey);
    if(prev && prev.focus) try { prev.focus(); } catch (_) {}
    if(opts.onClose) opts.onClose();
  };
  const onKey = e => {
    if(e.key === 'Escape' && opts.dismissable !== false){ close(); return; }
    if(e.key !== 'Tab') return;
    const f = [...box.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea,select,a[href],[tabindex="0"]')].filter(n => !n.hidden && n.offsetParent !== null);
    if(!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if(e.shiftKey && (document.activeElement === first || document.activeElement === box)){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey);
  if(opts.dismissable !== false) back.addEventListener('mousedown', e => { if(e.target === back) close(); });
  const h = box.querySelector('h2'); if(h) { h.tabIndex = -1; h.focus(); } else box.focus();
  return { box, close };
}

/* ---------- event tracking (study mode only, and only after consent) ---------- */
const EVQ = [];
function track(type, data){
  if(!APP.studyMode || !APP.session) return;
  EVQ.push({ type, t: Date.now(), data: data || {} });
  if(EVQ.length >= 30) flushEvents();
}
function flushEvents(useBeacon){
  if(!EVQ.length || !APP.session) return;
  const batch = EVQ.splice(0, 100);
  if(useBeacon === true && navigator.sendBeacon){
    /* while the page is going away a beacon is the only transport the browser guarantees; it cannot set
       headers, so the token travels in the body (the server accepts that on this one route) */
    const sent = navigator.sendBeacon('/api/events', new Blob([JSON.stringify({ token: APP.session.token, events: batch })], { type: 'application/json' }));
    if(!sent) requeue(batch);
    return;
  }
  fetch('/api/events', {
    method: 'POST', keepalive: true,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + APP.session.token },
    body: JSON.stringify({ events: batch })
  }).then(r => { if(r.status >= 500) requeue(batch); }).catch(() => requeue(batch));
}
function requeue(batch){ EVQ.unshift(...batch); if(EVQ.length > 500) EVQ.length = 500; }
setInterval(() => flushEvents(false), 5000);
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') flushEvents(true); });
addEventListener('pagehide', () => flushEvents(true));

/* ---------- state <-> plain data ---------- */
function serializeState(){
  return {
    room: { L: STATE.room.L, W: STATE.room.W, H: STATE.room.H },
    face: STATE.face, doorWall: STATE.doorWall, vastu: !!STATE.vastu,
    aesthetic: STATE.aesthetic, budget: STATE.budget,
    wants: [...STATE.wants], prefer: [...(STATE.prefer || [])]
  };
}
function applyState(s){
  const ok = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;
  if(!s || !s.room || !ok(s.room.L, 60, 144) || !ok(s.room.W, 48, 108) || !ok(s.room.H, 96, 120)) return false;
  STATE.room = { L: s.room.L, W: s.room.W, H: s.room.H };
  if(DIR_DEG[s.face] !== undefined) STATE.face = s.face;
  STATE.doorWall = ['auto', 'front', 'left', 'right'].includes(s.doorWall) ? s.doorWall : 'auto';
  STATE.vastu = !!s.vastu;
  STATE.aesthetic = AES[s.aesthetic] ? s.aesthetic : 'modern';
  STATE.budget = ok(s.budget, 80000, 400000) ? s.budget : 200000;
  STATE.wants = new Set((s.wants || []).filter(k => AMENITY.some(a => a.k === k)));
  STATE.prefer = (s.prefer || []).filter(id => PRODUCTS.some(p => p.id === id));
  SHORT.ids = STATE.prefer.slice(); lsSet(LS_SHORT, SHORT.ids);
  syncControlsFromState();
  return true;
}
function vastuNoteText(){
  return STATE.vastu
    ? 'Each fixture is rated against a traditional orientation table. Where one cannot stand in a preferred zone, the report says so.'
    : 'Placement decided purely by clearances, daylight and the walk from the door.';
}
function syncControlsFromState(){
  $('len').value = STATE.room.L / 12; $('wid').value = STATE.room.W / 12; $('hgt').value = STATE.room.H / 12;
  $('doorwall').value = STATE.doorWall;
  syncCompass();
  $('vastuToggle').classList.toggle('on', STATE.vastu);
  $('vastuToggle').setAttribute('aria-pressed', STATE.vastu);
  $('vastuNote').textContent = vastuNoteText();
  $('budget').value = STATE.budget; $('budgetLabel').textContent = inr(STATE.budget);
  inspoSyncControlsUI();
}
const r1 = n => Math.round(n * 10) / 10;
function layoutSummary(L){
  return {
    items: L.items.map(i => ({ kind: i.kind, wall: i.wall, t: r1(i.t), w: i.w, d: i.d, zone: i.zone || null, vastu: i.vastu || null, freeFront: r1(i.freeFront) })),
    accessories: L.acc.length,
    products: L.products.map(p => ({ id: p.id, cat: p.cat, price: p.price, slot: p.why, shortlisted: !!p.preferred })),
    total: L.total, dropped: [...L.dropped], metrics: L.metrics,
    door: { wall: L.door.wall, w: L.door.w },
    notices: L.notices.map(n => ({ level: n.level, text: n.text.slice(0, 300) })),
    versions: { solver: SOLVER_VERSION, catalog: CATALOG_VERSION, catalogHash: CATALOG_HASH }
  };
}

/* ---------- design-progress stepper (reflects what you actually did) ---------- */
const PROG = { space: false, prefs: false, saved: false, base: null };
function markProgress(inp){
  const space = JSON.stringify([inp.room, inp.face, inp.doorWall]);
  const prefs = JSON.stringify([inp.aesthetic, inp.wants, inp.budget, inp.vastu, inp.prefer]);
  if(!PROG.base) PROG.base = { space, prefs };
  else { if(space !== PROG.base.space) PROG.space = true; if(prefs !== PROG.base.prefs) PROG.prefs = true; }
  paintSteps();
}
function paintSteps(){
  const done = [PROG.space, PROG.prefs, PROG.space && PROG.prefs, PROG.saved];
  const cur = done.findIndex(d => !d);
  document.querySelectorAll('.step').forEach((b, i) => {
    b.classList.toggle('done', done[i]);
    b.classList.toggle('on', i === (cur < 0 ? 3 : cur));
  });
}

/* ---------- called after every solve ---------- */
let LAST_INPUT_KEY = '';
function onLayout(L, ms){
  const inp = serializeState(), key = JSON.stringify(inp);
  markProgress(inp);
  if(key === LAST_INPUT_KEY) return;
  LAST_INPUT_KEY = key;
  track('layout', { inputs: inp, metrics: L.metrics, total: L.total, ms, solver: SOLVER_VERSION });
}

/* ---------- shortlist (drives product choice in the solver) ---------- */
const SHORT = { ids: (lsGet(LS_SHORT) || []).filter(id => PRODUCTS.some(p => p.id === id)) };
STATE.prefer = SHORT.ids.slice();
function toggleShortlist(id){
  const on = SHORT.ids.includes(id);
  SHORT.ids = on ? SHORT.ids.filter(x => x !== id) : SHORT.ids.concat(id);
  STATE.prefer = SHORT.ids.slice(); lsSet(LS_SHORT, SHORT.ids);
  track('shortlist', { id, on: !on });
  paintTray();
  return !on;
}
function paintTray(){
  const sum = SHORT.ids.reduce((a, id) => a + ((PRODUCTS.find(p => p.id === id) || {}).price || 0), 0);
  $('trayN').textContent = SHORT.ids.length; $('trayS').textContent = inr(sum);
  const b = $('trayB'); b.textContent = `of ${inr(STATE.budget)} budget`; b.classList.toggle('over', sum > STATE.budget);
  $('tray').classList.toggle('up', SHORT.ids.length > 0 && (location.hash || '').startsWith('#/products'));
}

/* ---------- session, consent, condition ---------- */
async function startSession(consented){
  const qs = new URLSearchParams(location.search);
  const r = await api('POST', '/api/session', {
    consent: !!consented, consentVersion: APP.cfg.consentVersion,
    externalId: qs.get('pid') || undefined, condition: qs.get('condition') || undefined,
    screen: `${screen.width}x${screen.height}`, viewport: `${innerWidth}x${innerHeight}`, locale: navigator.language,
    client: { catalog: CATALOG_VERSION, catalogHash: CATALOG_HASH, solver: SOLVER_VERSION }
  });
  APP.session = { id: r.id, token: r.token, code: r.code, condition: r.condition };
  lsSet(LS_SESSION, APP.session);
  lsDel(LS_PROG);
  track('session_start', { condition: r.condition, ua: navigator.userAgent.slice(0, 200) });
}
function consentFlow(){
  return new Promise(() => {
    const c = APP.cfg;
    const { box, close } = openModal(
      `<h2 id="mTitle">${esc(c.consentTitle)}</h2>
       <p class="m-sub">${esc(c.consentIntro)}</p>
       <div class="scrollbox" tabindex="0" aria-label="Consent information">${esc(c.consentText)}</div>
       <label class="agree"><input type="checkbox" id="agreeBox"><span>${esc(c.consentAgreeLabel)}</span></label>
       <div class="err" id="cErr" role="alert" hidden></div>
       <div class="m-actions"><button class="btn ghost" id="cNo">No thanks</button><button class="btn" id="cYes" disabled>Agree and start</button></div>`,
      { dismissable: false });
    const yes = box.querySelector('#cYes'), chk = box.querySelector('#agreeBox');
    chk.onchange = () => { yes.disabled = !chk.checked; };
    box.querySelector('#cNo').onclick = () => {
      box.innerHTML = `<h2 id="mTitle">You chose not to take part</h2><p class="m-sub">Nothing has been recorded. You can close this tab, or reload the page if you change your mind.</p>`;
      box.querySelector('h2').focus();
    };
    yes.onclick = async () => {
      yes.disabled = true;
      try { await startSession(true); close(); location.reload(); }
      catch (e) { const er = box.querySelector('#cErr'); er.hidden = false; er.textContent = 'Could not start the session: ' + e.message + '. Please try again.'; yes.disabled = false; }
    };
  });
}
function applyCondition(){
  const cond = APP.session ? APP.session.condition : 'ai';
  APP.condition = cond;
  APP.aiOn = !!(APP.cfg.features && APP.cfg.features.ai) && cond === 'ai' && !!APP.session;
  document.querySelectorAll('[data-feature="ai"]').forEach(n => { n.hidden = !APP.aiOn; });
  document.querySelectorAll('[data-feature="assist"]').forEach(n => { n.hidden = cond === 'manual'; });
  const pc = $('pcode');
  pc.hidden = !(APP.studyMode && APP.session);
  if(!pc.hidden) pc.textContent = 'Participant ' + APP.session.code;
  $('deleteData').hidden = !(APP.studyMode && APP.session);
  inspoPaintReady();
  paintTaskCard();
}
async function platformInit(){
  try { APP.cfg = await api('GET', '/api/config'); }
  catch (e) { APP.cfg = { studyMode: false, features: { ai: false }, tasks: [], disclaimer: 'Kohler research prototype.', offline: true }; }
  APP.studyMode = !!APP.cfg.studyMode;
  $('disclaimer').textContent = `${APP.cfg.disclaimer} Catalogue ${CATALOG_VERSION}.`;
  const saved = lsGet(LS_SESSION);
  if(saved && saved.token){
    APP.session = saved;
    try { const me = await api('GET', '/api/session'); APP.session = { ...saved, condition: me.condition, code: me.code }; }
    catch (e) { if(e.status === 401 || e.status === 404){ APP.session = null; lsDel(LS_SESSION); } }
  }
  if(!APP.session && !APP.cfg.offline){
    if(APP.studyMode){ applyCondition(); await consentFlow(); return; }
    try { await startSession(false); } catch (_) {}
  }
  applyCondition();
  track('page', { page: (location.hash || '#/home').slice(2) });
}

/* ---------- study tasks ---------- */
const taskProg = () => { const p = lsGet(LS_PROG); return p && APP.session && p.sid === APP.session.id ? p : { sid: APP.session && APP.session.id, idx: 0, startedAt: null, done: [] }; };
let TASK_TIMER = null;
const fmtClock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
function taskChips(t){
  const out = [], k = t.constraints || {};
  if(k.length && k.width) out.push(`${k.length} × ${k.width} ft`);
  if(k.budget) out.push(`Budget ${inr(k.budget)}`);
  if(k.face) out.push(`Back wall ${k.face}`);
  if(k.vastu !== undefined) out.push(k.vastu ? 'Vastu on' : 'Vastu off');
  if(k.wants && k.wants.length) out.push(k.wants.map(w => (AMENITY.find(a => a.k === w) || { label: w }).label).join(', '));
  return out;
}
function paintTaskCard(){
  const box = $('taskCard'); if(!box) return;
  clearInterval(TASK_TIMER);
  if(!APP.studyMode || !APP.session || !(APP.cfg.tasks || []).length){ box.innerHTML = ''; return; }
  const tasks = APP.cfg.tasks, p = taskProg();
  if(p.idx >= tasks.length){
    box.innerHTML = `<div class="card task"><div><h3>All tasks complete</h3><p>Thank you for taking part. Your participant code is <b>${esc(APP.session.code)}</b>. Keep it if you ever want your data removed. You can keep exploring the designer.</p></div></div>`;
    return;
  }
  const t = tasks[p.idx];
  const chips = taskChips(t).map(c => `<span>${esc(c)}</span>`).join('');
  if(!p.startedAt){
    box.innerHTML = `<div class="card task"><div><div class="t-meta">Task ${p.idx + 1} of ${tasks.length}</div><h3>${esc(t.title)}</h3><p>${esc(t.brief)}</p><div class="chips">${chips}</div></div>
      <div class="t-side"><button class="btn" id="taskStart">Start task</button></div></div>`;
    $('taskStart').onclick = startTask;
  } else {
    box.innerHTML = `<div class="card task"><div><div class="t-meta">Task ${p.idx + 1} of ${tasks.length} · in progress</div><h3>${esc(t.title)}</h3><p>${esc(t.brief)}</p><div class="chips">${chips}</div></div>
      <div class="t-side"><span class="timer" id="taskTimer" role="timer" aria-label="Time on task">00:00</span><button class="btn" id="taskFinish">Finish task</button></div></div>`;
    const tick = () => { const el = $('taskTimer'); if(el) el.textContent = fmtClock(Date.now() - p.startedAt); };
    tick(); TASK_TIMER = setInterval(tick, 1000);
    $('taskFinish').onclick = finishTask;
  }
}
function applyTaskConstraints(t){
  const k = t.constraints || {};
  if(k.length) STATE.room.L = k.length * 12;
  if(k.width) STATE.room.W = k.width * 12;
  if(k.height) STATE.room.H = k.height * 12;
  if(k.face && DIR_DEG[k.face] !== undefined) STATE.face = k.face;
  if(k.doorWall) STATE.doorWall = k.doorWall;
  if(k.vastu !== undefined) STATE.vastu = !!k.vastu;
  if(k.aesthetic && AES[k.aesthetic]) STATE.aesthetic = k.aesthetic;
  if(k.budget) STATE.budget = k.budget;
  if(Array.isArray(k.wants)) STATE.wants = new Set(k.wants.filter(w => AMENITY.some(a => a.k === w)));
  SHORT.ids = []; STATE.prefer = []; lsSet(LS_SHORT, []);
  syncControlsFromState();
  render(true, true);
}
function startTask(){
  const p = taskProg(), t = APP.cfg.tasks[p.idx];
  p.startedAt = Date.now(); lsSet(LS_PROG, p);
  applyTaskConstraints(t);
  track('task_start', { taskId: t.id, index: p.idx });
  paintTaskCard();
  $('page-designer').scrollIntoView && window.scrollTo({ top: 0, behavior: 'smooth' });
}
function finishTask(){
  const p = taskProg(), t = APP.cfg.tasks[p.idx], q = APP.cfg.questionnaire;
  if(!q || !q.items || !q.items.length) return submitTask(t, p, {}, '');
  const sc = q.scale;
  const items = q.items.map(it => `<fieldset class="q-item"><legend>${esc(it.text)}</legend>
      <div class="likert">${[1, 2, 3, 4, 5].map(n => `<label><input type="radio" name="q_${esc(it.id)}" value="${n}" required>${n}</label>`).join('')}</div>
      <div class="likert-ends"><span>${esc(sc.minLabel)}</span><span>${esc(sc.maxLabel)}</span></div></fieldset>`).join('');
  const { box, close } = openModal(
    `<h2 id="mTitle">${esc(q.title)}</h2><p class="m-sub">${esc(q.intro)}</p>
     <form id="qForm" novalidate>${items}
     <label class="lbl" for="qComment" style="margin-top:14px">${esc(q.commentPrompt || 'Anything else you want to tell us? (optional)')}</label>
     <textarea id="qComment" maxlength="2000"></textarea>
     <div class="err" id="qErr" role="alert" hidden></div>
     <div class="m-actions"><button type="button" class="btn ghost" id="qBack">Back to the design</button><button type="submit" class="btn" id="qSend" disabled>Submit answers</button></div></form>`);
  const form = box.querySelector('#qForm'), send = box.querySelector('#qSend');
  const answered = () => q.items.every(it => form.querySelector(`input[name="q_${it.id}"]:checked`));
  form.addEventListener('change', () => { send.disabled = !answered(); });
  box.querySelector('#qBack').onclick = close;
  form.addEventListener('submit', async e => {
    e.preventDefault(); if(!answered()) return;
    const answers = {}; q.items.forEach(it => { answers[it.id] = +form.querySelector(`input[name="q_${it.id}"]:checked`).value; });
    send.disabled = true;
    try { await submitTask(t, p, answers, form.querySelector('#qComment').value.trim()); close(); }
    catch (er) { const x = box.querySelector('#qErr'); x.hidden = false; x.textContent = 'Could not send your answers: ' + er.message + '. Please try again.'; send.disabled = false; }
  });
}
async function submitTask(t, p, answers, comment){
  const dur = Date.now() - p.startedAt, L = STATE.layout;
  await api('POST', '/api/responses', { taskId: t.id, durationMs: dur, answers, comment, design: { state: serializeState(), layout: layoutSummary(L) } });
  track('task_finish', { taskId: t.id, durationMs: dur, score: L.score });
  p.done.push(t.id); p.idx++; p.startedAt = null; lsSet(LS_PROG, p);
  flushEvents();
  paintTaskCard();
  if(p.idx >= APP.cfg.tasks.length){
    const m = openModal(`<h2 id="mTitle">That was the last task</h2><p class="m-sub">Thank you. Your participant code is:</p><div class="code">${esc(APP.session.code)}</div><p class="m-sub">Keep it if you ever want your data removed. ${esc(APP.cfg.completionNote || '')}</p><div class="m-actions"><button class="btn" id="mDone">Close</button></div>`);
    m.box.querySelector('#mDone').onclick = m.close;
  } else toast('Answers sent. Next task is ready.');
}

/* ---------- saved designs ---------- */
function saveDesignFlow(){
  const L = STATE.layout; if(!L) return;
  if(!APP.session){ toast('Saving needs a connection to the server.'); return; }
  const def = `${AES[STATE.aesthetic].name}, ${Math.round(L.room.L / 12)}×${Math.round(L.room.W / 12)} ft`;
  const { box, close } = openModal(
    `<h2 id="mTitle">Save this layout</h2><p class="m-sub">Give it a name so you can find it later.</p>
     <label class="lbl" for="dName">Name</label><input class="name-in" id="dName" maxlength="80" value="${esc(def)}">
     <div class="err" id="sErr" role="alert" hidden></div>
     <div class="m-actions"><button class="btn ghost" id="sNo">Cancel</button><button class="btn" id="sYes">Save layout</button></div>`);
  box.querySelector('#sNo').onclick = close;
  box.querySelector('#sYes').onclick = async () => {
    const name = box.querySelector('#dName').value.trim() || def;
    try {
      const r = await api('POST', '/api/designs', { name, state: serializeState(), layout: layoutSummary(L), clientMetrics: L.metrics });
      PROG.saved = true; paintSteps();
      track('design_saved', { id: r.id, score: L.score });
      close(); toast('Saved. Find it under My designs.');
    } catch (e) { const x = box.querySelector('#sErr'); x.hidden = false; x.textContent = 'Could not save: ' + e.message; }
  };
}
async function openDesigns(){
  if(!APP.session){ toast('Saved designs need a connection to the server.'); return; }
  let list = [];
  try { list = (await api('GET', '/api/designs')).designs; } catch (e) { toast('Could not load your designs: ' + e.message); return; }
  const rows = list.map(d => `<div class="dl-item"><div class="grow"><div class="nm">${esc(d.name)}</div>
      <div class="mt">${esc(AES[d.state.aesthetic] ? AES[d.state.aesthetic].name : d.state.aesthetic)} · ${d.state.room.L / 12}×${d.state.room.W / 12} ft · ${inr(d.total)} · layout score ${d.score}% · ${esc(new Date(d.createdAt).toLocaleDateString())}</div></div>
      <button class="btn ghost" data-load="${esc(d.id)}" style="padding:8px 14px;font-size:13px">Open</button>
      <button class="tinybtn" data-del="${esc(d.id)}" aria-label="Delete ${esc(d.name)}">Delete</button></div>`).join('');
  const { box, close } = openModal(`<h2 id="mTitle">My designs</h2>
    <p class="m-sub">Opening a design restores the room, style, budget and choices, and the room is re-solved with the current solver. Positions you dragged by hand are recorded but not replayed.</p>
    <div class="dl">${rows || '<div class="dl-empty">Nothing saved yet. Use “Save this layout” under the plan.</div>'}</div>
    <div class="m-actions"><button class="btn ghost" id="dClose">Close</button></div>`);
  box.querySelector('#dClose').onclick = close;
  box.querySelectorAll('[data-load]').forEach(b => b.onclick = () => {
    const d = list.find(x => x.id === b.dataset.load);
    if(d && applyState(d.state)){ close(); render(true, true); track('design_opened', { id: d.id }); toast('Design opened.'); }
    else toast('That design could not be restored.');
  });
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    try { await api('DELETE', '/api/designs/' + b.dataset.del); track('design_deleted', { id: b.dataset.del }); close(); openDesigns(); }
    catch (e) { toast('Could not delete: ' + e.message); }
  });
}

/* ---------- export and print ---------- */
function exportJson(){
  const L = STATE.layout; if(!L) return;
  const doc = { exportedAt: new Date().toISOString(), participant: APP.studyMode && APP.session ? APP.session.code : null,
                state: serializeState(), layout: layoutSummary(L) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = `bathroom-layout-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  track('export_json', { score: L.score });
}
function printPlan(){
  const L = STATE.layout; if(!L) return;
  const w = window.open('', '_blank');
  if(!w){ toast('Allow pop-ups to print the plan.'); return; }
  const css = [...document.querySelectorAll('link[rel=stylesheet]')].map(l => `<link rel="stylesheet" href="${l.href}">`).join('');
  const rows = L.products.map(p => `<tr><td>${esc(p.cat)}</td><td>${esc(p.name)}</td><td style="text-align:right">${inr(p.price)}</td></tr>`).join('');
  const notes = L.notices.filter(n => n.level !== 'ok').map(n => `<li>${esc(n.text)}</li>`).join('');
  w.document.write(`<!DOCTYPE html><html lang="en" data-theme="light"><head><meta charset="utf-8"><title>Bathroom plan</title>${css}
    <style>body{background:#fff;color:#14181D;padding:28px;max-width:900px;margin:auto;overflow:visible}
    h1{font-family:var(--serif);font-weight:500;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px}
    table{width:100%;border-collapse:collapse;font-size:13px}td{padding:6px 0;border-top:1px solid #ddd}
    .pl{max-width:640px;margin:14px 0}.pl svg{width:100%;height:auto}small{color:#5E666F}</style></head><body>
    <h1>${esc(AES[STATE.aesthetic].name)} bathroom</h1>
    <small>${Math.round(L.room.L / 12)} × ${Math.round(L.room.W / 12)} ft · back wall ${esc(L.face)} · fixture total ${inr(L.total)} · layout score ${L.score}% · catalogue ${esc(CATALOG_VERSION)} · solver ${esc(SOLVER_VERSION)}</small>
    <div class="pl">${$('plan').innerHTML}</div>
    <h2>Fixtures and prices</h2><table>${rows}<tr><td></td><td><b>Total</b></td><td style="text-align:right"><b>${inr(L.total)}</b></td></tr></table>
    ${notes ? `<h2>Points to check</h2><ul>${notes}</ul>` : ''}
    <p><small>Planning aid generated by the Kohler research prototype. Confirm dimensions and clearances on site before ordering or building.</small></p></body></html>`);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 500);
  track('print_plan', { score: L.score });
}

/* ---------- delete my data ---------- */
function deleteMyData(){
  const { box, close } = openModal(`<h2 id="mTitle">Delete my study data</h2>
    <p class="m-sub">This removes your session, every recorded action, your saved designs and your questionnaire answers from the server. It cannot be undone.</p>
    <div class="err" id="xErr" role="alert" hidden></div>
    <div class="m-actions"><button class="btn ghost" id="xNo">Keep my data</button><button class="btn" id="xYes">Delete everything</button></div>`);
  box.querySelector('#xNo').onclick = close;
  box.querySelector('#xYes').onclick = async () => {
    try { await api('POST', '/api/session/delete', {}); lsDel(LS_SESSION); lsDel(LS_PROG); lsDel(LS_SHORT); close(); location.reload(); }
    catch (e) { const x = box.querySelector('#xErr'); x.hidden = false; x.textContent = 'Could not delete: ' + e.message; }
  };
}

/* ---------- live hero badge: real solver output, not a pasted number ---------- */
function paintHero(){
  try {
    const L = solve({ ...STATE, aesthetic: 'modern', prefer: [] });
    $('heroBadgeT').textContent = `${STATE.room.L / 12} × ${STATE.room.W / 12} ft, solved`;
    $('heroBadgeS').textContent = `${AES.modern.name} · ${inr(L.total)} · layout score ${L.score}%`;
  } catch (_) {}
}
