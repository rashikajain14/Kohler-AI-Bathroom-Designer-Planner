/* ==================================================================
   CLAUDE DESIGN ASSISTANT
   Claude never places a fixture. It can only ask for one of the tools
   below; each tool runs against the same deterministic solver as every
   other control, and the result (fits / doesn't fit, cost, warnings)
   goes back to Claude so its reply is grounded in what the solver said.
   The server holds the API key and the system prompt; the browser
   keeps the conversation and executes the tools.
   ================================================================== */
const CLAUDE_CHAT = { history: [], warned: false };

function aiLayoutSummary(){
  const L = STATE.layout;
  if(!L) return null;
  const vs = L.vastuStats;
  return {
    layout_score: L.score, space_fit: L.fit, total_inr: L.total, budget_inr: STATE.budget, within_budget: L.metrics.budgetOK,
    placed: L.items.map(i => i.kind), not_placed: [...L.dropped],
    vastu: vs ? { preferred: vs.preferred, of: vs.ruled, avoided: vs.avoid } : 'off',
    warnings: L.notices.filter(n => n.level === 'warn').slice(0, 4).map(n => n.text.slice(0, 160))
  };
}
function aiContext(){
  const L = STATE.layout;
  return {
    state: serializeState(),
    summary: aiLayoutSummary(),
    items: L ? L.items.map(i => ({ kind: i.kind, wall: i.wall, w: i.w, d: i.d, zone: i.zone || null, clear_in_front_in: Math.round(i.freeFront) })) : [],
    products: L ? L.products.map(p => ({ name: p.name.replace('KOHLER ', ''), category: p.cat, price_inr: p.price })) : [],
    styles: AES_KEYS.map(k => ({ key: k, name: AES[k].name })),
    amenities: AMENITY.map(a => ({ key: a.k, label: a.label }))
  };
}

const AI_FACES = Object.keys(DIR_DEG);
function runAiTool(name, a){
  a = a || {};
  const done = (ok, extra) => {
    const out = Object.assign({ ok }, extra || {}, ok ? { now: aiLayoutSummary() } : {});
    track('ai_tool', { name, input: a, ok });
    return JSON.stringify(out);
  };
  try {
    const L = STATE.layout;
    switch (name) {
      case 'add_amenity': {
        if(!AMENITY.some(x => x.k === a.key)) return done(false, { reason: 'unknown amenity key' });
        if(STATE.wants.has(a.key)) return done(false, { reason: 'already in the design' });
        const res = applyAdd(L, a.key);
        if(!res.ok) return done(false, { reason: res.reason || 'no safe position with the clearances intact' });
        finalizeAfterAdd(L);
        inspoSyncControlsUI();
        return done(true, { note: 'Added without disturbing the other fixtures.' });
      }
      case 'remove_amenity': {
        if(!AMENITY.some(x => x.k === a.key)) return done(false, { reason: 'unknown amenity key' });
        if(!STATE.wants.has(a.key)) return done(false, { reason: 'not in the design' });
        STATE.wants.delete(a.key); syncControlsFromState(); render();
        return done(true, { note: 'Room re-solved from scratch; any hand-dragged positions were reset.' });
      }
      case 'set_style': {
        if(!AES[a.style]) return done(false, { reason: 'unknown style key' });
        STATE.aesthetic = a.style; syncControlsFromState(); render();
        return done(true, { note: 'Room re-solved from scratch; any hand-dragged positions were reset.' });
      }
      case 'set_budget': {
        const n = Math.round(Number(a.amount_inr) / 10000) * 10000;
        if(!Number.isFinite(n) || n < 80000 || n > 400000) return done(false, { reason: 'budget must be between 80,000 and 400,000 INR' });
        STATE.budget = n; syncControlsFromState(); render();
        return done(true, { note: 'Budget set to ' + n + ' INR (rounded to the nearest 10,000).' });
      }
      case 'set_room': {
        const l = Math.round(Number(a.length_ft)), w = Math.round(Number(a.width_ft));
        if(!(l >= 5 && l <= 12 && w >= 4 && w <= 9)) return done(false, { reason: 'length must be 5-12 ft and width 4-9 ft' });
        STATE.room.L = l * 12; STATE.room.W = w * 12; syncControlsFromState(); render();
        return done(true, { note: 'Room re-solved from scratch; any hand-dragged positions were reset.' });
      }
      case 'set_orientation': {
        if(!AI_FACES.includes(a.back_wall_faces)) return done(false, { reason: 'unknown direction' });
        STATE.face = a.back_wall_faces; syncControlsFromState(); render();
        return done(true);
      }
      case 'set_vastu': {
        STATE.vastu = !!a.enabled; syncControlsFromState(); render();
        return done(true);
      }
      default: return done(false, { reason: 'unknown tool' });
    }
  } catch (e) {
    return JSON.stringify({ ok: false, reason: String(e && e.message || e).slice(0, 200) });
  }
}

function trimHistory(h){
  let out = h.slice(-24);
  while(out.length && !(out[0].role === 'user' && typeof out[0].content === 'string')) out.shift();
  return out;
}
function typingBubble(){
  const log = $('log'), d = document.createElement('div');
  d.className = 'msg ai'; d.innerHTML = '<span class="av"></span><span>Thinking…</span>';
  log.appendChild(d); log.scrollTop = log.scrollHeight;
  return d;
}

async function askClaude(q){
  const bubble = typingBubble();
  CLAUDE_CHAT.history.push({ role: 'user', content: q });
  const t0 = Date.now();
  try {
    for(let step = 0; step < 5; step++){
      const r = await api('POST', '/api/chat', { messages: trimHistory(CLAUDE_CHAT.history), context: aiContext() });
      CLAUDE_CHAT.history.push({ role: 'assistant', content: r.content });
      const text = r.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      const uses = r.content.filter(b => b.type === 'tool_use');
      if(text){ bubble.remove(); say(text); }
      if(r.stop_reason !== 'tool_use' || !uses.length){ track('chat_assistant', { text: text.slice(0, 800), ms: Date.now() - t0, mode: 'claude' }); return; }
      CLAUDE_CHAT.history.push({ role: 'user', content: uses.map(u => ({ type: 'tool_result', tool_use_id: u.id, content: runAiTool(u.name, u.input) })) });
    }
    bubble.remove();
    say('I have made those changes. Tell me if you want anything else adjusted.');
  } catch (e) {
    bubble.remove();
    CLAUDE_CHAT.history.pop();
    const msg = {
      quota: 'You have reached the assistant limit for this session, so I am switching to the built-in helper.',
      rate_limited: 'That was a bit fast. Give it a few seconds and ask again.',
    }[e.code];
    if(e.code === 'rate_limited'){ say(msg); return; }
    if(!CLAUDE_CHAT.warned){ CLAUDE_CHAT.warned = true; say(msg || 'The AI service is not reachable right now, so I am switching to the built-in helper.'); }
    track('chat_fallback', { code: e.code || e.status || 'error' });
    respond(q);
  }
}

/* one entry point for every typed or quick-action message */
function handleUserMessage(q){
  say(q, true);
  track('chat_user', { text: q.slice(0, 500), mode: APP.aiOn ? 'claude' : 'rules' });
  if(APP.aiOn) return askClaude(q);
  setTimeout(() => respond(q), 340);
}
