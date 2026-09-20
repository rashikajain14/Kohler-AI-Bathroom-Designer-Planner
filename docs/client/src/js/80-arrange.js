/* ---- e4d_arrange.js ---- */

/* ==================================================================
   ARRANGE — direct manipulation.
   The solver still produces the first layout. From then on the user
   can pick anything up in the plan or in the 3D room and move it.
   One position store (the layout object) drives both views, so a drag
   in either place is immediately true in the other. Every move is
   checked against the door, the walk, the clearances and the walls
   before it is allowed to stick, and nothing else in the room is ever
   moved to make room for it.
   ================================================================== */

const DRAG_ACC = {bin:1, stool:1, plant:1, paperstand:1, mat:1, mirror:1, towel:1, paper:1, hook:1};
const BLOCKY   = {bin:1, stool:1, plant:1, paperstand:1};
function draggableAcc(a){
  if(!a || !DRAG_ACC[a.kind]) return false;
  if(a.mount === 'floor') return !!a.foot;
  if(a.mount === 'wall')  return !a.inShower && !!a.wall;
  return false;
}

const ARR = { sel:null, drag:null, verdict:null, base:18, tol:null };

function selById(L, sel){
  if(!L || !sel) return null;
  return sel.type === 'fixture' ? L.items.find(i => i.uid === sel.uid)
                                : L.acc.find(a => a.uid === sel.uid);
}
function isFixture(L, o){ return !!o && L.items.indexOf(o) >= 0; }
function labelOf(L, o){ return isFixture(L, o) && FIX[o.kind] ? FIX[o.kind].label : (o.label || o.kind); }

/* what the plan draws around the current selection */
function selectedTarget(L){
  const o = selById(L, ARR.sel);
  if(!o) return null;
  if(ARR.sel.type === 'fixture') return { foot:o.foot, zones:[o.ideal] };
  if(o.mount === 'floor') return { foot:o.foot, zones:[] };
  return { foot: o.foot || footOf(o.wall, o.t, o.w, 3, L.room), zones:[] };
}

/* ---------------- geometry for a move ---------------- */
const alongCoord = (wall, x, y) => (wall === 'back' || wall === 'front') ? x : y;
function nearestWall(R, x, y, current){
  const d = { back: R.W - y, front: y, left: x, right: R.L - x };
  if(current && d[current] !== undefined) d[current] -= 5;      // a little stickiness
  let best = 'back';
  for(const k in d) if(d[k] < d[best]) best = k;
  return best;
}
function fixtureAt(L, it, wall, t){
  const wi = wallInfo(wall, L.room);
  const tt = clamp(Math.round(t*2)/2, 0, Math.max(0, wi.along - it.w));
  return makeCandidate(it.kind, wall, tt, {w:it.w, d:it.d}, L.room, FIX[it.kind]);
}
function applyFixture(it, c){
  it.wall = c.wall; it.t = c.t; it.foot = c.foot; it.clear = c.clear; it.ideal = c.ideal;
  it.cx = c.cx; it.cy = c.cy; it.yaw = c.yaw; it.corner = c.corner;
}
function looseAt(L, a, cx, cy){
  const R = L.room;
  const x = clamp(cx - a.w/2, 0, Math.max(0, R.L - a.w));
  const y = clamp(cy - a.h/2, 0, Math.max(0, R.W - a.h));
  return R2(Math.round(x*2)/2, Math.round(y*2)/2, a.w, a.h);
}
function applyLoose(a, r){ a.foot = r; a.w = r.w; a.h = r.h; a.cx = r.x + r.w/2; a.cy = r.y + r.h/2; }
function wallAccAt(L, a, wall, t){
  const R = L.room, wi = wallInfo(wall, R);
  const tt = clamp(Math.round(t*2)/2, 0, Math.max(0, wi.along - a.w));
  return Object.assign({wall, t:tt}, accWorld(wall, tt, a.w, 3, R));
}
function applyWallAcc(a, c){ a.wall = c.wall; a.t = c.t; a.cx = c.cx; a.cy = c.cy; a.yaw = c.yaw; a.foot = c.foot; }

/* ---------------- is the walk still there? ---------------- */
function circulationOK(L, o){
  const items = [];
  for(const it of L.items){ if(it === o.skipItem) continue; items.push({kind:it.kind, foot:it.foot, clear:it.clear}); }
  if(o.addItem) items.push(o.addItem);
  for(const a of L.acc){
    if(a === o.skipAcc || a.mount !== 'floor' || !a.foot || !BLOCKY[a.kind]) continue;
    items.push({kind:'_loose', foot:a.foot, clear:a.foot});
  }
  if(o.addAcc) items.push({kind:'_loose', foot:o.addAcc, clear:o.addAcc});
  const P = { room:L.room, door:L.door, acc:[], items };
  const grid = buildGrid(P, 3);
  const seen = reachable(P, grid);
  for(const it of items){
    if(it.kind === '_loose' || !FIX[it.kind]) continue;
    if(zoneReach(it.clear, grid, seen) < 0.45) return false;
  }
  if(largestFreeSquare(grid).size < Math.min(18, ARR.base) - 0.01) return false;
  return true;
}

/* ---------------- the rules a position has to pass ----------------
   Each failure carries a rule key. The solver is allowed to ship a
   layout that already bends one of these — a storage unit pushed flush
   against the toilet, say — so whatever is already bent where a thing
   currently stands is tolerated while the user moves it. Without that,
   the plan would call its own AI layout illegal the moment you touched
   it. Bodies overlapping is never tolerated. */
const NEVER_TOLERATED = {body:1, room:1};
function currentGeom(L, o){
  if(isFixture(L, o)) return fixtureAt(L, o, o.wall, o.t);
  if(o.mount === 'floor') return o.foot;
  return wallAccAt(L, o, o.wall, o.t);
}
function baselineTol(L, o){
  const tol = new Set();
  const g = currentGeom(L, o);
  for(let k = 0; k < 8; k++){
    const v = checkAny(L, o, g, tol);
    if(v.ok || !v.rule || NEVER_TOLERATED[v.rule]) break;
    tol.add(v.rule);
  }
  return tol;
}
const nope = (rule, why, tol) => (tol && tol.has(rule)) ? null : {ok:false, rule, why};

function checkFixture(L, it, c, skipCirc, tol){
  const R = L.room, spec = FIX[it.kind];
  let f;
  if(!insideRoom(R, c.foot)) return {ok:false, rule:'room', why:'falls outside the room'};
  if(ov(c.foot, L.door.landing) && (f = nope('door', 'stands in the doorway', tol))) return f;
  if(swingHits(c.foot, L.door, R) && (f = nope('swing', 'sits in the door swing', tol))) return f;
  for(const o of L.items){
    if(o === it) continue;
    const other = FIX[o.kind].label.toLowerCase();
    if(ov(c.foot, o.foot)) return {ok:false, rule:'body', why:`overlaps the ${other}`};
    if(spec.side > 0 && ov(inflateAlong(c.foot, c.wall, spec.side), o.foot)
       && (f = nope('side', `leaves no elbow room beside the ${other}`, tol))) return f;
    if(ov(c.foot, o.clear) && (f = nope('clear', `stands in the ${other}'s clear floor`, tol))) return f;
    if(ov(c.clear, o.foot) && (f = nope('clear', `the ${other} eats its clear floor`, tol))) return f;
  }
  /* a bin or a stool standing where the fixture wants to go is not a
     reason to refuse the position — it is a reason to move the bin,
     which happens once the fixture has landed. */
  const bodies = L.items.filter(i => i !== it).map(i => i.foot).concat([L.door.foot]);
  if(freeDepth(c.foot, c.wall, bodies, R) < spec.minFront - 0.5
     && (f = nope('front', `has under ${spec.minFront} in of clear floor in front`, tol))) return f;
  if(!skipCirc && !circulationOK(L, {skipItem:it, addItem:{kind:it.kind, foot:c.foot, clear:c.clear}})
     && (f = nope('circ', 'blocks the walk to another fixture', tol))) return f;
  return {ok:true};
}
function checkLoose(L, a, r, skipCirc, tol){
  const R = L.room;
  let f;
  if(!insideRoom(R, r)) return {ok:false, rule:'room', why:'falls outside the room'};
  if(ov(r, L.door.landing) && (f = nope('door', 'stands in the doorway', tol))) return f;
  if(swingHits(r, L.door, R) && (f = nope('swing', 'sits in the door swing', tol))) return f;
  if(!a.soft && ov(entryZone(L), r, 0.6) && (f = nope('entry', 'blocks the way in from the door', tol))) return f;
  for(const it of L.items)
    if(ov(r, it.foot)) return {ok:false, rule:'body', why:`overlaps the ${FIX[it.kind].label.toLowerCase()}`};
  for(const o of L.acc){
    if(o === a || o.mount !== 'floor' || !o.foot || o.kind === 'drain' || o.soft || a.soft) continue;
    if(ov(r, o.foot)) return {ok:false, rule:'body', why:`overlaps the ${(o.label||o.kind).toLowerCase()}`};
  }
  if(!a.soft){
    for(const it of L.items)
      if(ov(r, it.clear) && (f = nope('clear', `stands in the ${FIX[it.kind].label.toLowerCase()}'s clear floor`, tol))) return f;
    if(!skipCirc && !circulationOK(L, {skipAcc:a, addAcc:r})
       && (f = nope('circ', 'blocks the walking space', tol))) return f;
  }
  return {ok:true};
}
function touchesWallRect(R, r, wall){
  if(wall === 'back')  return Math.abs((r.y + r.h) - R.W) < 2;
  if(wall === 'front') return Math.abs(r.y) < 2;
  if(wall === 'left')  return Math.abs(r.x) < 2;
  return Math.abs((r.x + r.w) - R.L) < 2;
}
/* two runs along the same wall clash only if they genuinely overlap —
   sitting flush is how the solver packs a wall, and is allowed */
const spanClash = (lo, hi, b0, b1, pad) => Math.min(hi, b1 + pad) - Math.max(lo, b0 - pad) > 0.5;
function checkWallAcc(L, a, c, tol){
  const R = L.room, wi = wallInfo(c.wall, R);
  const zLo = a.z, zHi = a.z + (a.h || 4);
  const lo = c.t, hi = c.t + a.w;
  let f;
  if(lo < -0.51 || hi > wi.along + 0.51) return {ok:false, rule:'room', why:'runs past the end of the wall'};
  if(L.door.wall === c.wall && spanClash(lo, hi, L.door.t, L.door.t + L.door.w, 2)
     && (f = nope('door', 'crosses the door opening', tol))) return f;
  if(L.window && L.window.wall === c.wall && !(L.window.z + L.window.h < zLo || L.window.z > zHi)
     && spanClash(lo, hi, L.window.t, L.window.t + L.window.w, 2)
     && (f = nope('window', 'crosses the window', tol))) return f;
  for(const it of L.items){
    if((FIX_HEIGHT[it.kind] || 36) <= zLo) continue;
    if(!touchesWallRect(R, it.foot, c.wall)) continue;
    const [b0,b1] = alongSpan(it.foot, c.wall);
    if(spanClash(lo, hi, b0, b1, 0)
       && (f = nope('fixture', `runs into the ${FIX[it.kind].label.toLowerCase()}`, tol))) return f;
  }
  for(const o of L.acc){
    if(o === a || o.mount !== 'wall' || o.wall !== c.wall || o.inShower) continue;
    if(o.z + (o.h || 4) < zLo || o.z > zHi) continue;
    if(spanClash(lo, hi, o.t, o.t + o.w, 1)
       && (f = nope('acc', `runs into the ${(o.label||o.kind).toLowerCase()}`, tol))) return f;
  }
  return {ok:true};
}
function checkAny(L, o, geom, tol){
  if(isFixture(L, o)) return checkFixture(L, o, geom, false, tol);
  if(o.mount === 'floor') return checkLoose(L, o, geom, false, tol);
  return checkWallAcc(L, o, geom, tol);
}

/* ---------------- the nearest position that does work ---------------- */
function nearestFixtureSpot(L, it, cx, cy, onlyWall){
  const cands = [];
  for(const wall of (onlyWall ? [onlyWall] : WALLS)){
    const wi = wallInfo(wall, L.room), maxT = wi.along - it.w;
    if(maxT < -0.01) continue;
    const stops = [];
    for(let t = 0; t < maxT; t += 1.5) stops.push(t);
    stops.push(maxT);
    if(wall === it.wall) stops.push(clamp(it.t, 0, maxT));
    for(const t of stops){
      const c = fixtureAt(L, it, wall, t);
      if(!checkFixture(L, it, c, true, ARR.tol).ok) continue;
      cands.push({c, d: Math.hypot(c.cx - cx, c.cy - cy)});
    }
  }
  cands.sort((a,b) => a.d - b.d);
  for(const k of cands.slice(0, 60)) if(checkFixture(L, it, k.c, false, ARR.tol).ok) return k.c;
  return null;
}
function nearestLooseSpot(L, a, cx, cy){
  const R = L.room, cands = [];
  for(let y = 0; y <= R.W - a.h + 0.01; y += 1.5) for(let x = 0; x <= R.L - a.w + 0.01; x += 1.5){
    const r = R2(x, y, a.w, a.h);
    if(!checkLoose(L, a, r, true, ARR.tol).ok) continue;
    cands.push({r, d: Math.hypot(x + a.w/2 - cx, y + a.h/2 - cy)});
  }
  cands.sort((p,q) => p.d - q.d);
  for(const k of cands.slice(0, 50)) if(checkLoose(L, a, k.r, false, ARR.tol).ok) return k.r;
  return null;
}
function nearestWallSpot(L, a, prefWall, prefT, onlyWall){
  let best = null;
  for(const wall of (onlyWall ? [onlyWall] : WALLS)){
    const wi = wallInfo(wall, L.room), maxT = wi.along - a.w;
    if(maxT < -0.01) continue;
    const stops = [];
    for(let t = 0; t < maxT; t += 1.5) stops.push(t);
    stops.push(maxT);
    for(const t of stops){
      const c = wallAccAt(L, a, wall, t);
      if(!checkWallAcc(L, a, c, ARR.tol).ok) continue;
      const d = (wall === prefWall ? Math.abs(c.t - prefT) : 200 + Math.abs(c.t - prefT));
      if(!best || d < best.d) best = {c, d};
    }
  }
  return best ? best.c : null;
}

/* ---------------- 2D ⇄ 3D position sync ---------------- */
function sync3DFixture(it){
  if(!V.ok || !it || !it._obj) return;
  it._obj.position.set(WX(it.cx), 0, WZ(it.cy));
  it._obj.rotation.y = it.yaw;
  V.dirty = true;
}
function sync3DAcc(a){
  if(!V.ok || !a || !a._obj) return;
  const R = STATE.layout.room;
  if(a.mount === 'wall' && a._holder){
    const wi = wallInfo(a.wall, R), pose = WALL_POSE[a.wall](R);
    a._holder.position.set(pose.p[0], 0, pose.p[2]);
    a._holder.rotation.y = pose.yaw;
    a._obj.position.x = localX(a.wall, wi.along, a.t, a.w);
  } else {
    a._obj.position.set(WX(a.cx), 0, WZ(a.cy));
    a._obj.rotation.y = a.yaw || 0;
  }
  V.dirty = true;
}
function sync3D(L, o){ if(isFixture(L, o)) sync3DFixture(o); else sync3DAcc(o); }

/* ---------------- drag lifecycle ---------------- */
function planSay(t){ const n = document.getElementById('planNote'); if(n) n.textContent = t; }

function beginDrag(L, sel, pt, centred){
  const o = selById(L, sel); if(!o) return false;
  ARR.sel = sel;
  ARR.base = (L.metrics && L.metrics.clearSquare) || 18;
  ARR.tol = baselineTol(L, o);
  ARR.verdict = {ok:true};
  const onWall = sel.type === 'fixture' || o.mount === 'wall';
  ARR.drag = {
    sel, wall: onWall ? o.wall : null, moved:false,
    start: onWall ? {wall:o.wall, t:o.t}
                  : {foot:{x:o.foot.x, y:o.foot.y, w:o.foot.w, h:o.foot.h}, yaw:o.yaw},
    off: onWall ? (centred ? o.w/2 : alongCoord(o.wall, pt.x, pt.y) - o.t)
                : (centred ? {x:0, y:0} : {x: pt.x - o.cx, y: pt.y - o.cy})
  };
  return true;
}
function dragTo(L, pt){
  const d = ARR.drag; if(!d) return;
  const o = selById(L, d.sel); if(!o) return;
  d.moved = true;
  if(d.sel.type === 'fixture'){
    const wall = nearestWall(L.room, pt.x, pt.y, d.wall);
    if(wall !== d.wall){ d.wall = wall; d.off = o.w/2; }
    const c = fixtureAt(L, o, wall, alongCoord(wall, pt.x, pt.y) - d.off);
    applyFixture(o, c);
    ARR.verdict = checkFixture(L, o, c, false, ARR.tol);
  } else if(o.mount === 'floor'){
    const r = looseAt(L, o, pt.x - d.off.x, pt.y - d.off.y);
    applyLoose(o, r);
    ARR.verdict = checkLoose(L, o, r, false, ARR.tol);
  } else {
    const wall = nearestWall(L.room, pt.x, pt.y, d.wall);
    if(wall !== d.wall){ d.wall = wall; d.off = o.w/2; }
    const c = wallAccAt(L, o, wall, alongCoord(wall, pt.x, pt.y) - d.off);
    applyWallAcc(o, c);
    ARR.verdict = checkWallAcc(L, o, c, ARR.tol);
  }
  sync3D(L, o);
  drawPlan();
  planSay(ARR.verdict.ok
    ? `${labelOf(L, o)} — this position works. Release to place it.`
    : `${labelOf(L, o)} — cannot go here: it ${ARR.verdict.why}.`);
}
function restoreStart(L, o, d){
  if(d.sel.type === 'fixture') applyFixture(o, fixtureAt(L, o, d.start.wall, d.start.t));
  else if(o.mount === 'floor'){ applyLoose(o, d.start.foot); o.yaw = d.start.yaw; }
  else applyWallAcc(o, wallAccAt(L, o, d.start.wall, d.start.t));
}
function endDrag(L){
  const d = ARR.drag; if(!d) return;
  ARR.drag = null;
  const o = selById(L, d.sel);
  if(!L || !o){ ARR.verdict = null; drawPlan(); return; }
  if(!d.moved){ ARR.verdict = null; drawPlan(); planSay(`${labelOf(L, o)} selected — drag it, or press R to rotate it.`); return; }

  const name = labelOf(L, o);
  let msg, level = 'ok';
  if(ARR.verdict && ARR.verdict.ok){
    msg = `${name} moved.`;
  } else {
    const why = (ARR.verdict && ARR.verdict.why) || 'that spot does not work';
    let fixed = null, tight = false;
    if(d.sel.type === 'fixture') fixed = nearestFixtureSpot(L, o, o.cx, o.cy);
    else if(o.mount === 'floor'){
      const s = looseSpotFor(L, o, o.cx, o.cy);
      if(s){ fixed = s.r; tight = s.tight; }
    } else fixed = nearestWallSpot(L, o, o.wall, o.t);
    if(fixed){
      if(d.sel.type === 'fixture') applyFixture(o, fixed);
      else if(o.mount === 'floor') applyLoose(o, fixed);
      else applyWallAcc(o, fixed);
      msg = tight
        ? `${name} could not stay there — it ${why}. The only spot left for it is tight.`
        : `${name} could not stay there — it ${why}. Moved to the nearest position that holds every clearance.`;
      level = tight ? 'warn' : 'fix';
    } else {
      restoreStart(L, o, d);
      msg = `${name}: it ${why}, and no other position works. This item cannot fit safely in the available space. Increase the room size or remove an item.`;
      level = 'warn';
    }
  }
  ARR.verdict = null;
  if(!isFixture(L, o)) o.manual = true;
  afterManualChange(L, o, msg, level);
}

/* A last-resort spot for something loose: every rule relaxed except the
   ones that would make the drawing a lie — it must be in the room, out of
   the doorway, and not inside another body. Used when the polite search
   comes back empty, so nothing is ever left standing inside the vanity. */
function anyBodyFreeSpot(L, a, cx, cy){
  const R = L.room;
  let best = null;
  for(let y = 0; y <= R.W - a.h + 0.01; y += 1.5) for(let x = 0; x <= R.L - a.w + 0.01; x += 1.5){
    const r = R2(x, y, a.w, a.h);
    let ok = true;
    for(const it of L.items) if(ov(r, it.foot)){ ok = false; break; }
    if(ok) for(const o of L.acc){
      if(o === a || o.mount !== 'floor' || !o.foot || o.kind === 'drain' || o.soft) continue;
      if(ov(r, o.foot)){ ok = false; break; }
    }
    if(!ok) continue;
    if(ov(r, L.door.landing) || swingHits(r, L.door, R)) continue;
    const d = Math.hypot(x + a.w/2 - cx, y + a.h/2 - cy);
    if(!best || d < best.d) best = {r, d};
  }
  return best ? best.r : null;
}
/* the polite search first, then the relaxed one */
function looseSpotFor(L, a, cx, cy){
  const keep = ARR.tol;
  ARR.tol = null;
  let spot = nearestLooseSpot(L, a, cx, cy);
  if(!spot){ ARR.tol = new Set(['clear','circ','entry']); spot = nearestLooseSpot(L, a, cx, cy); }
  ARR.tol = keep;
  return spot ? {r:spot, tight:false} : (s => s ? {r:s, tight:true} : null)(anyBodyFreeSpot(L, a, cx, cy));
}

/* A bin, stool or planter caught under a fixture the user has just moved
   is stood somewhere sensible again. Nothing else in the room is touched,
   and the user is told what shifted. */
function rehomeLoose(L, moved){
  const notes = [];
  for(const a of L.acc){
    if(a === moved || a.mount !== 'floor' || !a.foot || !BLOCKY[a.kind]) continue;
    if(checkLoose(L, a, a.foot, true, null).ok) continue;
    const name = (a.label || a.kind).toLowerCase();
    const spot = looseSpotFor(L, a, a.cx, a.cy);
    if(spot){
      applyLoose(a, spot.r); sync3DAcc(a);
      notes.push(spot.tight ? `the ${name} had to squeeze aside` : `the ${name} stood aside`);
    } else notes.push(`the ${name} has nowhere left to stand`);
  }
  return notes;
}

/* The room is re-checked as a whole after every manual change, and only
   the thing the user touched has moved. */
function afterManualChange(L, o, msg, level){
  sync3D(L, o);
  if(isFixture(L, o)){
    const shifted = rehomeLoose(L, o);
    if(shifted.length) msg += ' On the way, ' + shifted.join(' and ') + '.';
  }
  if(isFixture(L, o) && o.kind === 'shower') buildRoom();   // the glass depends on which sides are open
  revalidate(L);
  drawPlan();
  paintSummary(L, L._ms || 0);
  paintReport(L);
  track('manual_change', { kind: o.kind, action: msg.slice(0, 120), level, score: L.score, warnings: L.notices.filter(n => n.level === 'warn').length });
  const warns = L.notices.filter(n => n.level === 'warn');
  const lab = document.getElementById('vlabel');
  if(lab) lab.querySelector('i').classList.toggle('warn', warns.length > 0);
  const tail = warns.length
    ? ` ${warns.length} thing${warns.length > 1 ? 's' : ''} in the room still need${warns.length > 1 ? '' : 's'} attention — see the layout report.`
    : ' The bathroom still works: every clearance, the door and the walk are all clear.';
  planSay(msg + tail);
  if(level !== 'ok' || warns.length) say(msg + tail);
  const fn = document.getElementById('footNote');
  if(fn) fn.textContent = `Adjusted by hand · ${L.items.length} fixtures, ${L.acc.length} accessories, ${L.conflicts.length ? L.conflicts.length + ' overlap(s)' : 'no overlaps'} · ${AES[STATE.aesthetic].name}`;
}

/* ---------------- rotate ---------------- */
function rotateSelection(){
  const L = STATE.layout; if(!L) return;
  const o = selById(L, ARR.sel);
  if(!o){ planSay('Pick something in the plan first, then rotate it.'); return; }
  ARR.base = (L.metrics && L.metrics.clearSquare) || 18;
  ARR.tol = baselineTol(L, o);
  const order = ['back','right','front','left'];

  if(isFixture(L, o)){
    const start = order.indexOf(o.wall);
    for(let k = 1; k <= 3; k++){
      const wall = order[(start + k) % 4];
      const wi = wallInfo(wall, L.room);
      if(o.w > wi.along) continue;
      const pref = clamp(alongCoord(wall, o.cx, o.cy) - o.w/2, 0, wi.along - o.w);
      let c = fixtureAt(L, o, wall, pref);
      if(!checkFixture(L, o, c, false, ARR.tol).ok) c = nearestFixtureSpot(L, o, c.cx, c.cy, wall);
      if(!c) continue;
      applyFixture(o, c);
      afterManualChange(L, o, `${FIX[o.kind].label} turned to face off the ${wall} wall.`, 'ok');
      return;
    }
    planSay(`${FIX[o.kind].label} cannot turn to any other wall. This item cannot fit safely in the available space. Increase the room size or remove an item.`);
    return;
  }

  if(o.mount === 'floor'){
    const probe = looseAt(L, {w:o.foot.h, h:o.foot.w}, o.cx, o.cy);
    const v = checkLoose(L, o, probe, false, ARR.tol);
    if(!v.ok){ planSay(`${o.label} cannot turn here: it ${v.why}.`); return; }
    applyLoose(o, probe);
    o.yaw = (o.yaw || 0) + Math.PI/2;
    o.manual = true;
    afterManualChange(L, o, `${o.label} turned a quarter turn.`, 'ok');
    return;
  }

  const start = order.indexOf(o.wall);
  for(let k = 1; k <= 3; k++){
    const wall = order[(start + k) % 4];
    const c = nearestWallSpot(L, o, wall, alongCoord(wall, o.cx, o.cy), wall);
    if(!c) continue;
    applyWallAcc(o, c);
    o.manual = true;
    afterManualChange(L, o, `${o.label} moved round to the ${wall} wall.`, 'ok');
    return;
  }
  planSay(`${o.label} has no other wall to go to. This item cannot fit safely in the available space. Increase the room size or remove an item.`);
}

/* nudge with the arrow keys, one inch at a time */
function nudgeSelection(dx, dy){
  const L = STATE.layout; if(!L) return;
  const o = selById(L, ARR.sel); if(!o) return;
  ARR.base = (L.metrics && L.metrics.clearSquare) || 18;
  ARR.tol = baselineTol(L, o);
  let geom, apply;
  if(isFixture(L, o)){
    const step = alongCoord(o.wall, dx, dy);
    if(!step) return;
    geom = fixtureAt(L, o, o.wall, o.t + step);
    apply = () => applyFixture(o, geom);
  } else if(o.mount === 'floor'){
    geom = looseAt(L, o, o.cx + dx, o.cy + dy);
    apply = () => applyLoose(o, geom);
  } else {
    const step = alongCoord(o.wall, dx, dy);
    if(!step) return;
    geom = wallAccAt(L, o, o.wall, o.t + step);
    apply = () => applyWallAcc(o, geom);
  }
  const v = checkAny(L, o, geom, ARR.tol);
  if(!v.ok){ planSay(`${labelOf(L, o)} cannot move any further that way: it ${v.why}.`); return; }
  apply();
  if(!isFixture(L, o)) o.manual = true;
  afterManualChange(L, o, `${labelOf(L, o)} nudged.`, 'ok');
}

/* ---------------- picking up in the 2D plan ---------------- */
function planPoint(e){
  if(!PLANV || !PLANV.svg) return null;
  const svg = PLANV.svg, ctm = svg.getScreenCTM(); if(!ctm) return null;
  const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
  const q = p.matrixTransform(ctm.inverse());
  return { x: (q.x - PLANV.ox)/PLANV.S, y: PLANV.R.W - (q.y - PLANV.oy)/PLANV.S };
}
let _dragRAF = 0, _dragPt = null;
function queueDrag(pt){
  _dragPt = pt;
  if(_dragRAF) return;
  _dragRAF = requestAnimationFrame(() => { _dragRAF = 0; if(ARR.drag && _dragPt) dragTo(STATE.layout, _dragPt); });
}
function startPointerDrag(getPt){
  const move = ev => { const p = getPt(ev); if(p) queueDrag(p); };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if(_dragRAF){ cancelAnimationFrame(_dragRAF); _dragRAF = 0; }
    if(_dragPt && ARR.drag && ARR.drag.moved) dragTo(STATE.layout, _dragPt);
    _dragPt = null;
    endDrag(STATE.layout);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
function bindPlanDrag(host){
  if(!host || host._arrBound) return;
  host._arrBound = true;
  host.style.touchAction = 'none';
  host.addEventListener('pointerdown', e => {
    const L = STATE.layout; if(!L || e.button === 2) return;
    const g = e.target && e.target.closest ? e.target.closest('g.grab') : null;
    const pt = planPoint(e);
    if(!g || !pt){
      if(ARR.sel){ ARR.sel = null; ARR.verdict = null; drawPlan(); planSay('Drag any fixture or accessory to move it · R rotates the selection'); }
      return;
    }
    const uid = g.dataset.uid;
    const type = L.items.some(i => i.uid === uid) ? 'fixture' : 'acc';
    e.preventDefault();
    if(!beginDrag(L, {type, uid}, pt)) return;
    drawPlan();
    startPointerDrag(planPoint);
  });
}

/* ---------------- picking up in the 3D room ---------------- */
function ndc(e){
  const r = V.renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(((e.clientX - r.left)/r.width)*2 - 1, -((e.clientY - r.top)/r.height)*2 + 1);
}
function ray3D(e){
  const ray = V._ray || (V._ray = new THREE.Raycaster());
  ray.setFromCamera(ndc(e), V.camera);
  return ray;
}
function pick3D(e){
  if(!V.ok || !V.pickable || !V.pickable.length) return null;
  const hits = ray3D(e).intersectObjects(V.pickable, true);
  if(!hits.length) return null;
  let o = hits[0].object;
  while(o && !o.userData.pick) o = o.parent;
  return o ? {type:o.userData.pick.type, uid:o.userData.pick.uid} : null;
}
function floorPoint(e){
  if(!V.ok || !STATE.layout) return null;
  const plane = V._plane || (V._plane = new THREE.Plane(new THREE.Vector3(0,1,0), 0));
  const p = new THREE.Vector3();
  if(!ray3D(e).ray.intersectPlane(plane, p)) return null;
  const R = STATE.layout.room;
  return { x: p.x + R.L/2, y: R.W/2 - p.z };
}
function bind3DDrag(){
  const host = document.getElementById('viewport');
  if(!host || host._arrBound) return;
  host._arrBound = true;
  /* capture, so the orbit controls on the canvas never see the event
     when the user is actually grabbing something */
  host.addEventListener('pointerdown', e => {
    if(!STATE.arrange || !V.ok || e.button === 2) return;
    const L = STATE.layout; if(!L) return;
    const hit = pick3D(e); if(!hit) return;
    const pt = floorPoint(e); if(!pt) return;
    e.preventDefault(); e.stopPropagation();
    if(!beginDrag(L, hit, pt, true)) return;
    drawPlan();
    startPointerDrag(floorPoint);
  }, true);
}

/* ---------------- keys ---------------- */
function bindArrangeKeys(){
  if(document._arrKeys) return;
  document._arrKeys = true;
  document.addEventListener('keydown', e => {
    if(!ARR.sel || !STATE.layout) return;
    const tag = (e.target && e.target.tagName) || '';
    if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if(e.key === 'r' || e.key === 'R'){ e.preventDefault(); rotateSelection(); }
    else if(e.key === 'Escape'){ ARR.sel = null; ARR.verdict = null; drawPlan(); }
    else if(e.key === 'ArrowLeft'){ e.preventDefault(); nudgeSelection(-1, 0); }
    else if(e.key === 'ArrowRight'){ e.preventDefault(); nudgeSelection(1, 0); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); nudgeSelection(0, 1); }
    else if(e.key === 'ArrowDown'){ e.preventDefault(); nudgeSelection(0, -1); }
  });
}

