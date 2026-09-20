/* ---- e4e_assistant.js ---- */

/* ==================================================================
   DESIGN ASSISTANT — wired to the live layout.
   Every answer is read from STATE.layout / STATE.wants / STATE.budget
   at the moment the question is asked; nothing here is precomputed
   copy. "Add to Layout" runs the same placement rules as a manual
   drag: the new item must clear the door, the walk and every other
   fixture, and nothing already in the room is moved to make way for
   it — except a loose accessory that would now sit inside a body,
   which is stood aside exactly as a manual move would rehome it.
   ================================================================== */

/* ---------------- what the catalogue actually charges ---------------- */
function catalogPriceFor(kind){
  const aes = AES[STATE.aesthetic];
  const id = aes.products && aes.products[kind];
  const p = id && PRODUCTS.find(x => x.id === id);
  return p ? p.price : null;
}
function priceOfAdding(key){
  if(key === 'vanity'){
    const v = catalogPriceFor('vanity'), f = catalogPriceFor('faucet');
    return (v === null && f === null) ? null : (v||0) + (f||0);
  }
  if(key === 'decor') return 0;                 // planter and stool aren't sold pieces here
  return catalogPriceFor(key);
}
function priceLabel(key){
  const p = priceOfAdding(key);
  if(p === null) return 'no catalogue price on file';
  return p === 0 ? 'no extra cost' : inr(p);
}
const SPACE_OF = {
  toilet:'about 20×26 in against a wall', shower:'about 36×36 in, plus the door swing clear of it',
  bath:'about 60×30 in along one wall', vanity:'about 36–48 in of wall, 20 in deep',
  storage:'about 20×18 in of floor, or a slim 14 in run', mirror:'the width of the basin, on the wall above it',
  towel:'an 18–24 in run of wall near the wet zone', fan:'ceiling-mounted, no floor space',
  decor:'a 13 in corner for a stool, plus a small patch for a planter'
};
const WHY_OF = {
  toilet:'the room has no WC yet', shower:'gives the room a wet zone to bathe in',
  bath:'lets you soak, not just rinse', vanity:'the room has nowhere to wash up yet',
  storage:'somewhere for towels and toiletries besides the vanity drawers',
  mirror:'needed above the basin for shaving and makeup', towel:'keeps a towel within reach of the shower',
  fan:'clears steam and damp air after a shower', decor:'softens the room without eating floor space'
};

/* ---------------- probing, without touching the real layout ---------------- */
function tryAddFixture(L, kind){
  if(L.items.some(i => i.kind === kind)) return {ok:false, reason:'already in the room'};
  const cfg = L._cfg, spec = FIX[kind];
  const sizes = sizesFor(kind, cfg);
  const tmp = {kind};
  for(const size of sizes){
    let best = null;
    for(const wall of WALLS){
      const wi = wallInfo(wall, L.room), maxT = wi.along - size.w;
      if(maxT < -0.01) continue;
      for(let t = 0; t <= maxT + 0.01; t += 1.5){
        const c = makeCandidate(kind, wall, Math.min(t, maxT), size, L.room, spec);
        if(!checkFixture(L, tmp, c, false, null).ok) continue;
        const sc = scoreCandidate(c, kind, {items:L.items}, L.door, cfg, L.room, spec, sizes.indexOf(size));
        if(!best || sc > best.score){ best = c; best.score = sc; }
      }
    }
    if(best) return {ok:true, c:best};
  }
  return {ok:false, reason:'no spot holds the door, the walk and every clearance at once'};
}
function cloneLayoutForProbe(L){
  return {
    room: L.room, door: L.door, window: L.window, faceDeg: L.faceDeg, vastu: L.vastu,
    items: L.items.map(i => ({...i})), acc: [], notices: [], _entry: null
  };
}
const ACC_KINDS_OF = {mirror:['mirror'], towel:['towel'], fan:['fan'], decor:['stool','plant']};
function probeAddAccessory(L, key){
  if(key === 'mirror' && !L.items.some(i => i.kind === 'vanity'))
    return {ok:false, reason:'needs a vanity underneath it first'};
  const trial = cloneLayoutForProbe(L);
  const cfg = {...L._cfg, wants: new Set([...L._cfg.wants, key])};
  placeAccessories(trial, cfg);
  const want = ACC_KINDS_OF[key] || [key];
  const got = want.filter(k => trial.acc.some(a => a.kind === k));
  if(got.length === want.length) return {ok:true};
  const warn = trial.notices.find(n => n.level === 'warn');
  return {ok:false, reason: warn ? warn.text.replace(/^[^:]+:\s*/, '').replace(/\.$/, '') : 'no clear spot left for it'};
}
function probeAdd(L, key){
  const meta = AMENITY.find(a => a.k === key);
  if(!meta) return {ok:false, reason:'not something this planner catalogues'};
  if(STATE.wants.has(key)) return {ok:false, reason:'already in the room'};
  return meta.kind === 'fixture' ? tryAddFixture(L, key) : probeAddAccessory(L, key);
}

/* ---------------- keeping a hand-placed accessory where the user put it ---------------- */
function snapshotManualAcc(L){ return L.acc.filter(a => a.manual).map(a => ({...a})); }
function restoreManualAcc(L, saved){
  for(const s of saved){
    const fresh = L.acc.find(a => a.kind === s.kind && !a.manual);
    if(!fresh) continue;
    const others = L.acc.filter(a => a !== fresh);
    const held = L.acc; L.acc = others;
    let geom, ok;
    if(s.mount === 'floor'){ geom = {x:s.foot.x, y:s.foot.y, w:s.foot.w, h:s.foot.h}; ok = checkLoose(L, fresh, geom, false, null).ok; }
    else { geom = wallAccAt(L, fresh, s.wall, s.t); ok = checkWallAcc(L, fresh, geom, null).ok; }
    L.acc = held;
    if(ok){
      if(s.mount === 'floor') applyLoose(fresh, geom); else applyWallAcc(fresh, geom);
      fresh.manual = true;
    } else {
      const relocated = s.mount === 'floor' ? nearestLooseSpot(L, fresh, s.cx, s.cy) : nearestWallSpot(L, fresh, s.wall, s.t);
      if(relocated){ if(s.mount === 'floor') applyLoose(fresh, relocated); else applyWallAcc(fresh, relocated); fresh.manual = true; }
    }
  }
}

/* ---------------- actually placing what the probe found ---------------- */
function applyAdd(L, key){
  const probe = probeAdd(L, key);
  if(!probe.ok) return probe;
  const meta = AMENITY.find(a => a.k === key);
  if(meta.kind === 'fixture'){
    const it = Object.assign({uid:'f' + L.items.length}, probe.c);
    L.items.push(it);
    computeOpenSides(L);
  }
  STATE.wants.add(key); L._cfg.wants.add(key);
  const manual = snapshotManualAcc(L);
  placeAccessories(L, L._cfg);
  restoreManualAcc(L, manual);
  L.acc.forEach((a, i) => { if(!a.uid) a.uid = 'a' + i; });
  costLayout(L, L._cfg);
  L._base.push({level:'fix', text:`${meta.label} added from the design assistant.`});
  ARR.sel = null; ARR.drag = null; ARR.verdict = null;
  revalidate(L);
  return {ok:true};
}
function finalizeAfterAdd(L){
  buildRoom(); drawPlan(); paintSummary(L, L._ms || 0); paintReport(L); paintStrip(L);
  const fn = document.getElementById('footNote');
  if(fn) fn.textContent = `Added by the design assistant · ${L.items.length} fixtures, ${L.acc.length} accessories, ${L.conflicts.length ? L.conflicts.length + ' overlap(s)' : 'no overlaps'} · ${AES[STATE.aesthetic].name}`;
}

/* ---------------- chat rendering ---------------- */
function sayRich(html){
  const log = document.getElementById('log'); if(!log) return;
  const d = document.createElement('div');
  d.className = 'msg ai';
  d.innerHTML = `<span class="av"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z"/></svg></span><div>${html}</div>`;
  log.appendChild(d); log.scrollTop = log.scrollHeight;
}
function suggestionRow(key, tag){
  const meta = AMENITY.find(a => a.k === key);
  return `<div class="sugg">
    <div class="sugg-h"><b>${esc(meta.label)}</b><span>${esc(priceLabel(key))}</span></div>
    <div class="sugg-d">${esc(SPACE_OF[key] || '')} — ${esc(WHY_OF[key] || '')}</div>
    <button class="chip addBtn" data-add="${key}" data-tag="${tag||''}">Add to layout</button>
  </div>`;
}
function bindChatActions(){
  const log = document.getElementById('log'); if(!log || log._boundAdd) return;
  log._boundAdd = true;
  log.addEventListener('click', e => {
    const btn = e.target.closest('.addBtn'); if(!btn) return;
    const key = btn.dataset.add;
    const L = STATE.layout; if(!L) return;
    if(STATE.wants.has(key)){ btn.disabled = true; btn.textContent = 'Already added'; return; }
    const res = applyAdd(L, key);
    if(!res.ok){
      btn.disabled = true; btn.textContent = 'Could not add it';
      say(`${AMENITY.find(a=>a.k===key).label}: ${res.reason}. This item cannot fit safely in the available space. Increase the room size or remove an item.`);
      return;
    }
    finalizeAfterAdd(L);
    document.querySelectorAll(`.addBtn[data-add="${key}"]`).forEach(b => { b.disabled = true; b.textContent = 'Added ✓'; });
    const it = key === 'toilet' || key === 'shower' || key === 'bath' || key === 'vanity' || key === 'storage'
      ? L.items.find(i => i.kind === key) : null;
    const where = it ? ` It's on the ${it.wall} wall, ${it.w}×${it.d} in.` : '';
    const warns = L.notices.filter(n => n.level === 'warn').length;
    say(`Added the ${AMENITY.find(a=>a.k===key).label.toLowerCase()}.${where} ${warns ? `${warns} thing${warns>1?'s':''} now need attention — see the layout report.` : 'Everything else still clears the door, the walk and its neighbours.'}`);
  });
}

/* ---------------- understanding the question ---------------- */
const CHAT = { lastKind: null, suggestions: [] };
const AMENITY_WORDS = [
  [/\btoilets?\b|\bwc\b|\bcommode\b/, 'toilet'], [/\bshowers?\b/, 'shower'],
  [/\bbath ?tubs?\b|\btubs?\b|\bbaths?\b/, 'bath'], [/\bvanit(y|ies)\b|\bbasins?\b|\bsinks?\b/, 'vanity'],
  [/\bstorage\b|\bcabinets?\b|\blinen\b/, 'storage'], [/\bmirrors?\b/, 'mirror'],
  [/\btowel(s| rails?| bars?)?\b/, 'towel'], [/\bfans?\b|\bexhaust\b|\bventilat/, 'fan'],
  [/\bplants?\b|\bdecor\b|\bstools?\b|\bgreenery\b/, 'decor']
];
function amenityFromText(s){ for(const [re,k] of AMENITY_WORDS) if(re.test(s)) return k; return null; }
function parseMoney(s){
  const m = s.match(/(?:₹|rs\.?|inr)\s*([\d,]+)/i) || s.match(/([\d,]{4,})\s*(?:rs|rupees|inr)?/i);
  if(!m) return null;
  const n = parseInt(m[1].replace(/,/g, ''), 10);
  return Number.isFinite(n) && n > 500 ? n : null;
}
const ORDINALS = {first:0, '1st':0, second:1, '2nd':1, third:2, '3rd':2, fourth:3, '4th':3, last:-1};
function ordinalIndex(s){
  for(const k in ORDINALS) if(new RegExp('\\b'+k+'\\b','i').test(s)) return ORDINALS[k];
  return null;
}

/* the plain factual lookups the assistant already knew how to answer;
   kept, since a direct question about a specific fixture still deserves
   a direct, specific answer */
function describeIntent(s, L){
  const aes = AES[STATE.aesthetic];
  const find = k => L.items.find(i => i.kind === k);
  const where = it => `on the ${it.wall} wall${it.zone ? ` (${it.zone.toLowerCase()} zone)` : ''}, ${it.w}×${it.d} in, with ${it.freeFront} in clear in front`;
  if(/toilet|wc|commode/.test(s)){
    CHAT.lastKind = 'toilet';
    const t = find('toilet');
    return t ? `The toilet is ${where(t)}. ${(L.vastu && t.zone) ? `Vastu wants it ${VASTU.toilet.say}; this run put it in the ${t.zone.toLowerCase()}.` : 'Vastu rules are off, so it went wherever the clearances were best.'}`
             : `No toilet in the room yet — I can add one if there's space. Want me to check?`;
  }
  if(/shower|bath|tub/.test(s)){
    CHAT.lastKind = find('shower') ? 'shower' : 'bath';
    const w = find('shower') || find('bath');
    return w ? `The ${FIX[w.kind].label.toLowerCase()} is ${where(w)}. Glass goes on ${Object.entries(w.openSides||{}).filter(([k,v])=>v).map(([k])=>k).join(' and ')} — the other sides are tiled wall.`
             : `No bathing fixture in the room right now — ask "will a shower fit?" and I'll check.`;
  }
  if(/vanity|basin|sink|mirror/.test(s)){
    CHAT.lastKind = 'vanity';
    const v = find('vanity'), m = L.acc.find(a => a.kind === 'mirror');
    return v ? `The vanity is ${where(v)}, in ${aes.cab.style.replace('-',' ')} form with a ${aes.cab.front} front and a ${aes.basin} basin. ${m ? `The ${m.shape} mirror sits above it at ${m.z} in.` : 'No wall was free above it for a mirror.'}`
             : `No vanity in this layout right now.`;
  }
  if(/door|swing|open/.test(s))
    return `The door is ${L.door.w} in on the ${L.door.wall} wall, hinged on the ${L.door.hinge?'far':'near'} side and opening ${L.door.swingOut?'outward — inward would have hit a fixture':'inward, with its full quarter-circle kept clear'}.`;
  if(/vastu|direction|face|orient/.test(s))
    return `The back wall faces ${L.face}. ${L.vastu ? vastuHeadline(L) + '. Change the face on the compass and the room re-solves around the new bearings.' : 'Vastu rules are currently off.'}`;
  if(/cost|price|budget|money/.test(s))
    return `${inr(L.total)} of fixtures against a ${inr(STATE.budget)} ceiling — ${inr(Math.max(0, STATE.budget - L.total))} left. ${L.total > STATE.budget ? 'Over budget — I already swapped down as far as the catalogue allows.' : 'You have room to add something.'}`;
  if(/clear|space|small|tight/.test(s))
    return `${L.metrics.freePct}% of the floor is walking space, largest clear patch ${L.metrics.clearSquare} in across. ${L.dropped.length ? `${L.dropped.map(k=>FIX[k].label).join(' and ')} had to be dropped.` : 'Everything you asked for fits.'}`;
  if(/tile|material|finish|look|style/.test(s))
    return `${aes.name}: ${aes.wall.type.replace('largeformat','large-format porcelain')} on the walls, ${aes.floor.type} underfoot, ${aes.metal.name.toLowerCase()} on every fitting, ${aes.light.temp} light.`;
  if(/window|daylight/.test(s))
    return L.window ? `A ${L.window.w} in window sits on the ${L.window.wall} wall, sill at ${L.window.z} in.`
                    : 'No wall had a clear run wide enough for a window once the fixtures and the door were placed.';
  return null;
}

function respond(q){
  const L = STATE.layout;
  if(!L){ say("Still solving the room — ask again in a second."); return; }
  const s = q.toLowerCase().trim();

  /* 1. a direct "add X" instruction */
  const wantsAdd = /\badd\b|\bput in\b|\binclude\b/.test(s) && !/\?\s*$/.test(s) && !/\bcan i\b|\bwhat can\b|\bcould i\b/.test(s);
  if(wantsAdd){
    let key = amenityFromText(s);
    if(!key){
      const idx = ordinalIndex(s);
      if(idx !== null && CHAT.suggestions.length)
        key = CHAT.suggestions[idx === -1 ? CHAT.suggestions.length - 1 : idx];
      else if(/\bit\b|\bthat\b|\bthe one\b/.test(s) && CHAT.suggestions.length === 1)
        key = CHAT.suggestions[0];
    }
    if(!key){ say("Which item — a toilet, shower, bathtub, vanity, storage unit, mirror, towel rail, exhaust fan, or plants?"); return; }
    const meta = AMENITY.find(a => a.k === key);
    if(STATE.wants.has(key)){ say(`The ${meta.label.toLowerCase()} is already in the room.`); return; }
    const res = applyAdd(L, key);
    if(!res.ok){
      say(`Can't add the ${meta.label.toLowerCase()}: it ${res.reason}. Try a smaller fixture elsewhere, or increase the room size — this one won't go in without bumping the door, the walk or a neighbour.`);
      return;
    }
    finalizeAfterAdd(L);
    const it = L.items.find(i => i.kind === key);
    const where = it ? ` It's on the ${it.wall} wall, ${it.w}×${it.d} in.` : '';
    say(`Added the ${meta.label.toLowerCase()}.${where} ${priceOfAdding(key) ? `That's ${priceLabel(key)}, ${inr(Math.max(0, STATE.budget - L.total))} left of budget.` : ''}`);
    return;
  }

  /* 2. "what can I add within my budget [₹X]" */
  if(/what can i add.*budget|add.*within.*budget|budget.*(add|fit)|afford/.test(s)){
    const explicit = parseMoney(s);
    const ceiling = explicit || STATE.budget;
    const remaining = ceiling - L.total;
    const options = AMENITY.filter(a => !STATE.wants.has(a.k)).map(a => {
      const probe = probeAdd(L, a.k);
      const price = priceOfAdding(a.k);
      return {k:a.k, probe, price};
    }).filter(o => o.probe.ok && (o.price === null ? false : o.price <= Math.max(0, remaining)));
    CHAT.suggestions = options.map(o => o.k);
    if(remaining <= 0 && explicit === null){
      say(`You're already at ${inr(L.total)} against a ${inr(STATE.budget)} ceiling — nothing fits without going over.`);
      return;
    }
    if(!options.length){
      say(`With ${inr(Math.max(0,remaining))} left${explicit?` of a ${inr(explicit)} budget`:''}, nothing that still has room in the layout comes in under that. The cheapest thing that would fit space-wise is ${cheapestFittingLabel(L)}.`);
      return;
    }
    sayRich(`With ${inr(Math.max(0,remaining))} left${explicit?` of a ${inr(explicit)} budget`:''}, here's what still fits the space and the budget:` +
      options.slice(0,4).map(o => suggestionRow(o.k)).join(''));
    return;
  }

  /* 3. "what can I add" (space only) */
  if(/what (else )?can i add|what should i (add|include)|anything (else )?i can add|suggest.*(item|accessory|fixture)/.test(s)){
    const options = AMENITY.filter(a => !STATE.wants.has(a.k)).map(a => ({k:a.k, probe:probeAdd(L, a.k)}));
    const fits = options.filter(o => o.probe.ok);
    CHAT.suggestions = fits.map(o => o.k);
    if(!options.length){ say("Every fixture and accessory this planner offers is already in the room."); return; }
    if(!fits.length){
      const reasons = options.slice(0,2).map(o => `${AMENITY.find(a=>a.k===o.k).label.toLowerCase()} (${o.probe.reason})`).join(', ');
      say(`Nothing else fits safely right now — ${reasons}. Increase the room size or remove something to make space.`);
      return;
    }
    sayRich(`Here's what still fits without touching anything already placed:` + fits.slice(0,4).map(o => suggestionRow(o.k)).join(''));
    return;
  }

  /* 4. "will X fit?" */
  if(/will (a |an |the )?.*fit|can i fit|room for|space for|enough (room|space) for|does .* fit/.test(s)){
    let key = amenityFromText(s) || CHAT.lastKind;
    if(!key){ say("Fit-check what — a toilet, shower, bathtub, vanity, storage unit, mirror, towel rail, exhaust fan, or plants/decor?"); return; }
    CHAT.lastKind = key;
    const meta = AMENITY.find(a => a.k === key);
    if(STATE.wants.has(key)){ say(`The ${meta.label.toLowerCase()} is already in the room.`); return; }
    const probe = probeAdd(L, key);
    if(probe.ok){
      const dims = meta.kind === 'fixture' ? `${probe.c.w}×${probe.c.d} in on the ${probe.c.wall} wall` : SPACE_OF[key];
      sayRich(`Yes — a ${meta.label.toLowerCase()} fits, ${esc(dims)}, clear of the door and the walk. ${priceOfAdding(key)!==null?`Catalogue price: ${esc(priceLabel(key))}.`:''}` + suggestionRow(key));
      CHAT.suggestions = [key];
    } else {
      say(`No — a ${meta.label.toLowerCase()} won't fit: it ${probe.reason}. ${key==='vanity'||key==='shower'||key==='bath'||key==='storage'||key==='toilet' ? 'A smaller size might, but this room has run out of clear wall for it as things stand.' : ''} You'd need to increase the room size or remove something else first.`);
    }
    return;
  }

  /* 5. "what's wrong with my layout?" */
  if(/what.?s wrong|any problems?|issues? with|what.?s (the )?issue/.test(s)){
    const warns = L.notices.filter(n => n.level === 'warn');
    if(!warns.length){ say("Nothing's wrong — every clearance, the door and the walk all check out, and nothing overlaps."); return; }
    sayRich(`${warns.length} thing${warns.length>1?'s':''} to look at:` + `<ul style="margin:6px 0 0 18px;padding:0">${warns.slice(0,5).map(n=>`<li>${esc(n.text)}</li>`).join('')}</ul>`);
    return;
  }

  /* 6. "what should I change / improve?" */
  if(/what should i change|how (can|do) i improve|improve (my|the) (layout|room|bathroom)|make (it|this) better|upgrade/.test(s)){
    const tips = [];
    const warns = L.notices.filter(n => n.level === 'warn');
    if(warns.length) tips.push(warns[0].text);
    if(L.dropped.length) tips.push(`${L.dropped.map(k=>FIX[k].label).join(' and ')} didn't fit — a longer or wider room would let them in.`);
    if(L.total > STATE.budget) tips.push(`You're ${inr(L.total-STATE.budget)} over budget — swapping the pricier fixture in a category for a cheaper one in the same style would close the gap.`);
    if(L.metrics.clearSquare < 30) tips.push(`Only ${L.metrics.clearSquare} in of clear floor to stand in — moving the storage unit or dropping it would open that up.`);
    if(!tips.length){
      const spare = AMENITY.filter(a => !STATE.wants.has(a.k)).map(a => ({k:a.k, probe:probeAdd(L,a.k)})).find(o => o.probe.ok);
      if(spare){ CHAT.suggestions = [spare.k]; sayRich(`The layout is solid — door, walk and every clearance hold. One thing you haven't added yet that still fits:` + suggestionRow(spare.k)); return; }
      say("The layout is solid — door, walk and every clearance hold, and there's nothing obvious left to add."); return;
    }
    say(tips.slice(0,3).join(' '));
    return;
  }

  /* 7. plain factual question about a specific part of the room */
  const desc = describeIntent(s, L);
  if(desc){ say(desc); return; }

  /* fallback: state what's actually here, and what can be asked */
  say(`Ask what fits, what's within budget, what's wrong, or about the toilet, shower, vanity, door, budget, materials or Vastu zones. Right now: ${L.items.length} fixtures in ${L.metrics.floorArea} sq ft, ${L.metrics.clearSquare} in of clear floor, ${inr(L.total)}.`);
}
function cheapestFittingLabel(L){
  let best = null;
  for(const a of AMENITY){
    if(STATE.wants.has(a.k)) continue;
    const p = priceOfAdding(a.k); if(p === null) continue;
    if(!probeAdd(L, a.k).ok) continue;
    if(!best || p < best.p) best = {p, a};
  }
  return best ? `the ${best.a.label.toLowerCase()} at ${inr(best.p)}` : 'nothing left that both fits and has a catalogue price';
}

