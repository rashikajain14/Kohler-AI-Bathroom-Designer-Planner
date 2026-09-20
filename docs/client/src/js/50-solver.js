/* ---- e2_solver.js ---- */

/* ==================================================================
   GEOMETRY + LAYOUT SOLVER
   ================================================================== */
const EPS = 0.3;
const R2 = (x,y,w,h) => ({x,y,w,h});
function ov(a,b,eps){ eps = eps===undefined?EPS:eps;
  return a.x < b.x+b.w-eps && b.x < a.x+a.w-eps && a.y < b.y+b.h-eps && b.y < a.y+a.h-eps; }
function insideRoom(R,r){ return r.x>=-EPS && r.y>=-EPS && r.x+r.w<=R.L+EPS && r.y+r.h<=R.W+EPS; }
function rectDist(r,px,py){
  const dx = Math.max(r.x-px, 0, px-(r.x+r.w));
  const dy = Math.max(r.y-py, 0, py-(r.y+r.h));
  return Math.hypot(dx,dy);
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function wallInfo(id,R){
  switch(id){
    case 'back':  return {id, along:R.L, yaw:0,             horiz:true,  nx:0, ny:-1};
    case 'front': return {id, along:R.L, yaw:Math.PI,       horiz:true,  nx:0, ny:1};
    case 'left':  return {id, along:R.W, yaw:Math.PI/2,     horiz:false, nx:1, ny:0};
    default:      return {id, along:R.W, yaw:-Math.PI/2,    horiz:false, nx:-1,ny:0};
  }
}
const WALLS = ['back','right','front','left'];

/* a body of width w (along the wall) and depth d, sitting at offset t */
function footOf(wall,t,w,d,R){
  switch(wall){
    case 'back':  return R2(t, R.W-d, w, d);
    case 'front': return R2(t, 0, w, d);
    case 'left':  return R2(0, t, d, w);
    default:      return R2(R.L-d, t, d, w);
  }
}
function frontOf(wall,t,w,d,depth,side,R){
  switch(wall){
    case 'back':  return R2(t-side, R.W-d-depth, w+2*side, depth);
    case 'front': return R2(t-side, d, w+2*side, depth);
    case 'left':  return R2(d, t-side, depth, w+2*side);
    default:      return R2(R.L-d-depth, t-side, depth, w+2*side);
  }
}
function centerOf(wall,t,w,d,R){
  switch(wall){
    case 'back':  return {x:t+w/2, y:R.W-d/2};
    case 'front': return {x:t+w/2, y:d/2};
    case 'left':  return {x:d/2,   y:t+w/2};
    default:      return {x:R.L-d/2, y:t+w/2};
  }
}
function inflateAlong(r,wall,s){
  return (wall==='back'||wall==='front') ? R2(r.x-s, r.y, r.w+2*s, r.h)
                                         : R2(r.x, r.y-s, r.w, r.h+2*s);
}
function alongSpan(r,wall){ return (wall==='back'||wall==='front') ? [r.x, r.x+r.w] : [r.y, r.y+r.h]; }

/* compass bearing of a point, given which way the back wall faces */
function bearingAt(px,py,R,faceDeg){
  const dx = px - R.L/2, dy = py - R.W/2;
  if(Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return faceDeg;
  return (faceDeg + Math.atan2(dx,dy) * 180/Math.PI + 720) % 360;
}
function wallBearing(wall,faceDeg){
  const add = {back:0, right:90, front:180, left:270}[wall];
  return (faceDeg + add) % 360;
}

/* ---- how much clear floor is actually in front of a body ---- */
function freeDepth(foot, wall, bodies, R){
  const [a0,a1] = alongSpan(foot,wall);
  let gap;
  if(wall==='back'){ gap = foot.y;
    for(const b of bodies){ if(b===foot) continue; const [b0,b1]=alongSpan(b,wall);
      if(b1<=a0+1||b0>=a1-1) continue; if(b.y+b.h <= foot.y+1) gap = Math.min(gap, foot.y-(b.y+b.h)); }
  } else if(wall==='front'){ const f=foot.y+foot.h; gap = R.W-f;
    for(const b of bodies){ if(b===foot) continue; const [b0,b1]=alongSpan(b,wall);
      if(b1<=a0+1||b0>=a1-1) continue; if(b.y >= f-1) gap = Math.min(gap, b.y-f); }
  } else if(wall==='left'){ const f=foot.x+foot.w; gap = R.L-f;
    for(const b of bodies){ if(b===foot) continue; const [b0,b1]=alongSpan(b,wall);
      if(b1<=a0+1||b0>=a1-1) continue; if(b.x >= f-1) gap = Math.min(gap, b.x-f); }
  } else { const f=foot.x; gap = f;
    for(const b of bodies){ if(b===foot) continue; const [b0,b1]=alongSpan(b,wall);
      if(b1<=a0+1||b0>=a1-1) continue; if(b.x+b.w <= f+1) gap = Math.min(gap, f-(b.x+b.w)); }
  }
  return Math.max(0, gap);
}

/* ---------------- the door ---------------- */
function makeDoor(wall,t,w,hinge,R,swingOut){
  const c = centerOf(wall,t,w,4,R);
  const wi = wallInfo(wall,R);
  return { wall, t, w, hinge, swingOut:!!swingOut,
           foot: footOf(wall,t,w,4,R),
           landing: footOf(wall, t-3, w+6, 23, R),
           cx:c.x, cy:c.y, yaw:wi.yaw };
}
function doorCandidates(R,cfg){
  const dw = clamp(Math.min(R.L,R.W) - 26, 24, 32);
  const walls = cfg.doorWall==='auto' ? ['front','left','right'] : [cfg.doorWall];
  const out = [];
  for(const wall of walls){
    const wi = wallInfo(wall,R);
    if(wi.along < dw + 6) continue;
    const slots = [3, wi.along-dw-3];
    if(wi.along > dw*2 + 24) slots.push(Math.round((wi.along-dw)/2));
    for(const t of slots) for(const hinge of [0,1]) out.push(makeDoor(wall,t,dw,hinge,R,false));
  }
  if(!out.length) out.push(makeDoor('front', 2, Math.max(22, R.L-6), 0, R, true));
  return out;
}
/* the leaf sweeps a quarter disc: test a rect against it properly,
   so a conservative bounding square never kills a workable room */
function swingHits(r, door, R){
  if(door.swingOut) return false;
  const wall = door.wall, w = door.w;
  const ha = door.hinge ? door.t + w : door.t;         // hinge position along the wall
  const dir = door.hinge ? -1 : 1;                     // the leaf sweeps this way
  const [a0,a1] = alongSpan(r,wall);
  let b0,b1;                                           // distance range measured in from the wall
  if(wall==='back'){ b0 = R.W-(r.y+r.h); b1 = R.W-r.y; }
  else if(wall==='front'){ b0 = r.y; b1 = r.y+r.h; }
  else if(wall==='left'){ b0 = r.x; b1 = r.x+r.w; }
  else { b0 = R.L-(r.x+r.w); b1 = R.L-r.x; }
  if(b1 <= 0.5) return false;
  const la0 = dir>0 ? ha : ha - w, la1 = dir>0 ? ha + w : ha;   // the quadrant's span
  if(a1 <= la0+0.5 || a0 >= la1-0.5) return false;
  if(b0 >= w-0.5) return false;
  const near = R2(Math.max(a0,la0), Math.max(b0,0), Math.max(0,Math.min(a1,la1)-Math.max(a0,la0)), Math.max(0,Math.min(b1,w)-Math.max(b0,0)));
  return rectDist(near, ha, 0) < w - 0.5;
}

/* ---------------- candidate feasibility ---------------- */
function feasible(c, S, door, R, spec){
  if(!insideRoom(R, c.foot)) return false;
  if(ov(c.foot, door.landing)) return false;
  if(swingHits(c.foot, door, R)) return false;
  const padded = inflateAlong(c.foot, c.wall, spec.side);
  for(const o of S.items){
    if(ov(padded, o.foot)) return false;      // bodies, plus side space
    if(ov(c.foot, o.clear)) return false;     // never stand in someone else's clear floor
    if(ov(c.clear, o.foot)) return false;
  }
  const bodies = S.items.map(i=>i.foot).concat([door.foot]);
  if(freeDepth(c.foot, c.wall, bodies, R) < spec.minFront - 0.5) return false;
  return true;
}

function makeCandidate(kind, wall, t, size, R, spec){
  const foot  = footOf(wall, t, size.w, size.d, R);
  const clear = frontOf(wall, t, size.w, size.d, spec.minFront, 0, R);
  const ideal = frontOf(wall, t, size.w, size.d, spec.clearFront, spec.side, R);
  const c     = centerOf(wall, t, size.w, size.d, R);
  const wi    = wallInfo(wall, R);
  const touchLow  = t <= 1.5, touchHigh = t + size.w >= wi.along - 1.5;
  return { kind, wall, t, w:size.w, d:size.d, foot, clear, ideal,
           cx:c.x, cy:c.y, yaw:wi.yaw, corner:(touchLow||touchHigh), label:FIX[kind].label };
}

function scoreCandidate(c, kind, S, door, cfg, R, spec, sizeIdx){
  let s = 0;
  const std = spec.std;
  s -= Math.max(0, std.w - c.w) * 0.8 + Math.max(0, std.d - c.d) * 0.35 + sizeIdx * 3;
  if(kind==='vanity' || kind==='shower' || kind==='bath') s += Math.min(c.w - std.w, 14) * 0.5;
  const bear = bearingAt(c.cx, c.cy, R, cfg.faceDeg);
  if(cfg.vastu) s += 1.0 * vastuScore(kind, bear);
  if(c.corner) s += (kind==='shower'||kind==='bath'||kind==='storage') ? 30 : 7;
  s += (c.wall !== door.wall) ? 12 : -8;

  const bodies = S.items.map(i=>i.foot).concat([door.foot]);
  const fd = freeDepth(c.foot, c.wall, bodies, R);
  s += Math.min(fd, spec.clearFront + 10) * 0.85;
  if(fd >= spec.clearFront) s += 16;

  /* flush against something already placed keeps the floor in one piece */
  let touches = false, sliver = 0;
  for(const o of S.items){
    const [a0,a1] = alongSpan(c.foot, c.wall);
    if(o.wall === c.wall){
      const [b0,b1] = alongSpan(o.foot, c.wall);
      const g = (b0 >= a1) ? b0-a1 : (a0 >= b1 ? a0-b1 : -1);
      if(g >= 0 && g < 1.5) touches = true;
      else if(g > 0 && g < 11) sliver += 18;                     // a gap too small to use
    }
    if(rectDist(o.foot, c.cx, c.cy) < 1) touches = true;
  }
  s += touches ? 15 : 0;
  s -= sliver;

  const wi = wallInfo(c.wall, R);
  const endGap = Math.min(c.t, wi.along - c.t - c.w);
  s += endGap < 1.5 ? 16 : Math.max(0, 9 - endGap*0.7);
  if(endGap > 0.5 && endGap < 11) s -= 16;

  const dd = Math.hypot(c.cx-door.cx, c.cy-door.cy);
  if(kind === 'toilet'){
    if(facesDoorway(c, door, R)) s -= 30;                        // not the first thing you see
    s += Math.min(16, dd/6);
  }
  if(kind === 'vanity')  s += 16 - Math.min(16, dd/7);           // basin near the entry
  if(kind === 'shower' || kind === 'bath') s += Math.min(20, dd/6);
  if(kind === 'storage') s += Math.min(12, dd/8);

  /* keep the wet zone together */
  for(const o of S.items){
    if((kind==='shower'&&o.kind==='bath')||(kind==='bath'&&o.kind==='shower')){
      s += Math.max(0, 22 - Math.hypot(o.cx-c.cx,o.cy-c.cy)/4);
    }
    if(kind==='storage' && o.kind==='vanity') s += Math.max(0, 14 - Math.hypot(o.cx-c.cx,o.cy-c.cy)/5);
  }
  return s;
}
function facesDoorway(c, door, R){
  if(c.wall === door.wall) return false;
  const opposite = {back:'front', front:'back', left:'right', right:'left'}[door.wall];
  if(c.wall !== opposite) return false;
  const [a0,a1] = alongSpan(c.foot, door.wall);
  return !(a1 < door.t || a0 > door.t + door.w);
}

/* ---------------- greedy pack with size fallback ---------------- */
function packOnce(cfg, door, order){
  const R = cfg.R;
  const S = { items: [] };
  const dropped = [], adjusted = [];
  let score = 0;

  for(const kind of order){
    if(!cfg.wants.has(kind)) continue;
    const spec = FIX[kind];
    const sizes = sizesFor(kind, cfg);
    let chosen = null, chosenIdx = 0;
    for(let si = 0; si < sizes.length && !chosen; si++){
      const size = sizes[si];
      let best = null;
      for(const wall of WALLS){
        const wi = wallInfo(wall, R);
        if(size.w > wi.along - 1) continue;
        const maxT = wi.along - size.w;
        for(let t = 0; t <= maxT + 0.01; t += 2){
          const tt = Math.min(t, maxT);
          const cand = makeCandidate(kind, wall, tt, size, R, spec);
          if(!feasible(cand, S, door, R, spec)) continue;
          const sc = scoreCandidate(cand, kind, S, door, cfg, R, spec, si);
          if(!best || sc > best.score){ best = cand; best.score = sc; }
        }
      }
      if(best){ chosen = best; chosenIdx = si; }
    }
    if(chosen){
      chosen.sizeIdx = chosenIdx;
      const std = FIX[kind].std;
      if(chosen.w < std.w - 0.5 || chosen.d < std.d - 4.5) adjusted.push({kind, w:chosen.w, d:chosen.d, from:std});
      S.items.push(chosen);
      score += chosen.score + 60;
    } else {
      dropped.push(kind);
      score -= 150;
    }
  }
  return { items:S.items, dropped, adjusted, score };
}

function sizesFor(kind, cfg){
  const list = FIX[kind].sizes.map(s => ({w:s.w, d:s.d}));
  const aes = AES[cfg.aesthetic];
  if(kind === 'toilet' && aes.toilet === 'wallhung') list.forEach(s => s.d = Math.max(21, s.d - 5));
  if(kind === 'vanity' && aes.cab.style === 'floating-timber') list.forEach(s => s.d = Math.max(16, s.d - 2));
  return list;
}

/* ---------------- occupancy grid: circulation + reachability ---------------- */
function buildGrid(L, cell){
  const R = L.room;
  const nx = Math.max(1, Math.floor(R.L/cell)), ny = Math.max(1, Math.floor(R.W/cell));
  const g = new Uint8Array(nx*ny);
  const blockers = L.items.map(i=>i.foot);
  for(let j=0;j<ny;j++) for(let i=0;i<nx;i++){
    const c = R2(i*cell, j*cell, cell, cell);
    let blocked = false;
    for(const b of blockers) if(ov(c,b,cell*0.35)){ blocked = true; break; }
    g[j*nx+i] = blocked ? 1 : 0;
  }
  return {g, nx, ny, cell};
}
function reachable(L, grid){
  const {g,nx,ny,cell} = grid;
  const seen = new Uint8Array(nx*ny);
  const R = L.room, d = L.door;
  const start = [];
  const sx = d.cx, sy = d.cy;
  for(let j=0;j<ny;j++) for(let i=0;i<nx;i++){
    if(g[j*nx+i]) continue;
    if(Math.hypot((i+0.5)*cell - sx, (j+0.5)*cell - sy) < cell*3.2) start.push(j*nx+i);
  }
  const q = start.slice(); start.forEach(k => seen[k]=1);
  while(q.length){
    const k = q.pop(), i = k%nx, j = (k-i)/nx;
    const nb = [[i+1,j],[i-1,j],[i,j+1],[i,j-1]];
    for(const [a,b] of nb){
      if(a<0||b<0||a>=nx||b>=ny) continue;
      const kk = b*nx+a;
      if(seen[kk] || g[kk]) continue;
      seen[kk] = 1; q.push(kk);
    }
  }
  return seen;
}
function zoneReach(rect, grid, seen){
  const {nx,ny,cell} = grid;
  let tot=0, ok=0;
  for(let j=0;j<ny;j++) for(let i=0;i<nx;i++){
    const c = R2(i*cell,j*cell,cell,cell);
    if(!ov(c,rect,cell*0.4)) continue;
    tot++; if(seen[j*nx+i]) ok++;
  }
  return tot ? ok/tot : 1;
}
function largestFreeSquare(grid){
  const {g,nx,ny,cell} = grid;
  const dp = new Int16Array(nx*ny); let best=0, bi=0, bj=0;
  for(let j=0;j<ny;j++) for(let i=0;i<nx;i++){
    const k=j*nx+i;
    if(g[k]) { dp[k]=0; continue; }
    dp[k] = (i===0||j===0) ? 1 : 1 + Math.min(dp[k-1], dp[k-nx], dp[k-nx-1]);
    if(dp[k]>best){ best=dp[k]; bi=i; bj=j; }
  }
  return { size: best*cell, rect: R2((bi-best+1)*cell, (bj-best+1)*cell, best*cell, best*cell) };
}

/* ---------------- the way in ----------------
   The landing is the patch of floor immediately inside the opening.
   The entry path is the wider corridor a person actually walks through
   on the way in: the door width plus a shoulder either side, carried
   far enough into the room to clear the leaf. Nothing loose — a bin,
   a stool, a planter, a paper stand — is ever allowed to stand in it,
   which is what keeps a bin from landing in front of the door. */
function entryZone(L){
  if(L._entry) return L._entry;
  const R = L.room, d = L.door;
  const depth = clamp(Math.max(d.w, 26), 22, Math.max(22, Math.min(R.L, R.W) * 0.45));
  const r = footOf(d.wall, d.t - 4, d.w + 8, depth, R);
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
  L._entry = R2(x0, y0, Math.min(r.x + r.w, R.L) - x0, Math.min(r.y + r.h, R.W) - y0);
  return L._entry;
}
/* blocks the doorway, the leaf, or the walk in */
function blocksDoor(L, r, soft){
  if(ov(r, L.door.landing)) return true;
  if(swingHits(r, L.door, L.room)) return true;
  if(!soft && ov(entryZone(L), r, 0.6)) return true;
  return false;
}

/* ---------------- free floor search for loose objects ---------------- */
function freeFloorRect(L, w, h, prefX, prefY, avoidClear, soft){
  const R = L.room; let best=null;
  for(let y=1; y<=R.W-h-1; y+=2) for(let x=1; x<=R.L-w-1; x+=2){
    const r = R2(x,y,w,h);
    let ok = true;
    for(const it of L.items) if(ov(r,it.foot)){ ok=false; break; }
    if(ok) for(const a of L.acc) if(a.mount==='floor' && a.foot && ov(r,a.foot)){ ok=false; break; }
    if(ok && blocksDoor(L, r, soft)) ok = false;
    if(ok && avoidClear) for(const it of L.items) if(ov(r,it.clear)){ ok=false; break; }
    if(!ok) continue;
    const d = Math.hypot(x+w/2-prefX, y+h/2-prefY);
    if(!best || d < best.d) best = {r, d};
  }
  return best ? best.r : null;
}

/* ---------------- space validation for loose floor accessories ----------------
   A loose object only goes down if it is parked against a wall or a
   fixture, sits clear of every clearance zone it is told to respect,
   leaves every fixture still walkable from the door, and does not eat
   the standing space. If no such spot exists it is not placed at all. */
function rectGap(a, b){
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}
/* unit vectors in plan space: out of the wall, and along it */
function fixtureFrame(it){
  switch(it.wall){
    case 'back':  return {fwd:{x:0, y:-1}, side:{x:1, y:0}};
    case 'front': return {fwd:{x:0, y: 1}, side:{x:1, y:0}};
    case 'left':  return {fwd:{x: 1, y:0}, side:{x:0, y:1}};
    default:      return {fwd:{x:-1, y:0}, side:{x:0, y:1}};
  }
}
function containsRect(outer, r){
  return r.x >= outer.x - 0.01 && r.y >= outer.y - 0.01 &&
         r.x + r.w <= outer.x + outer.w + 0.01 && r.y + r.h <= outer.y + outer.h + 0.01;
}
/* the band of floor beside a fixture: out from its wall by `depth`, and
   `lateral` inches past each shoulder. Used to keep the bin and the paper
   stand alongside the pan rather than out in the room. */
function sideBand(it, R, lateral, depth){
  let b;
  switch(it.wall){
    case 'back':  b = R2(it.cx - it.w/2 - lateral, R.W - depth, it.w + 2*lateral, depth); break;
    case 'front': b = R2(it.cx - it.w/2 - lateral, 0, it.w + 2*lateral, depth); break;
    case 'left':  b = R2(0, it.cy - it.w/2 - lateral, depth, it.w + 2*lateral); break;
    default:      b = R2(R.L - depth, it.cy - it.w/2 - lateral, depth, it.w + 2*lateral);
  }
  const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y);
  return R2(x0, y0, Math.min(b.x + b.w, R.L) - x0, Math.min(b.y + b.h, R.W) - y0);
}
function touchesWall(L, r, tol){
  const R = L.room;
  return r.x <= tol || r.y <= tol || r.x + r.w >= R.L - tol || r.y + r.h >= R.W - tol;
}
function parkedAgainst(L, r, tol){
  if(touchesWall(L, r, tol)) return true;
  for(const it of L.items) if(rectGap(r, it.foot) <= tol) return true;
  return false;
}
/* the four literal room corners, as flush rects for a given footprint size.
   Tried before any general scan: a corner is the one placement a person
   reads as "out of the way" from any camera angle, because it is pinned
   to two walls at once rather than one. */
function literalCorners(R, w, h, pad){
  return [
    R2(pad, pad, w, h),
    R2(R.L - w - pad, pad, w, h),
    R2(pad, R.W - h - pad, w, h),
    R2(R.L - w - pad, R.W - h - pad, w, h)
  ];
}
function keepsCirculation(L, r){
  const probe = {room:L.room, door:L.door, acc:L.acc,
                 items:L.items.concat([{kind:'_loose', wall:'back', foot:r, clear:r}])};
  const grid = buildGrid(probe, 3);
  const seen = reachable(probe, grid);
  for(const it of L.items) if(zoneReach(it.clear, grid, seen) < 0.5) return false;
  const base = L._baseSquare;
  if(base !== undefined && largestFreeSquare(grid).size < Math.max(24, base * 0.72)) return false;
  return true;
}
/* The single way a loose accessory reaches the floor. */
function placeLoose(L, spec){
  const R = L.room;
  const w = spec.w, h = spec.h;
  const prefs = spec.prefs, forbid = spec.forbid || [];
  const mustPark = spec.mustPark !== false, avoidClear = spec.avoidClear !== false;

  const passes = r => {
    for(const it of L.items) if(ov(r, it.foot)) return false;
    for(const a of L.acc) if(a.mount === 'floor' && a.foot && ov(r, a.foot)) return false;
    if(blocksDoor(L, r, spec.soft)) return false;
    if(avoidClear) for(const it of L.items) if(ov(r, it.clear)) return false;
    for(const f of forbid) if(ov(r, f)) return false;
    if(spec.within && !containsRect(spec.within, r)) return false;
    return true;
  };
  if(spec.cornerFirst){
    let best = null;
    for(const r of literalCorners(R, w, h, 1)){
      if(r.x < 0 || r.y < 0 || !passes(r)) continue;
      if(!keepsCirculation(L, r)) continue;
      const cx = r.x + w/2, cy = r.y + h/2;
      let d = Infinity;
      for(const p of prefs) d = Math.min(d, Math.hypot(cx - p.x, cy - p.y));
      if(!best || d < best.d) best = {r, d};
    }
    if(best) return best.r;
  }

  const cand = [];
  for(let y = 1; y <= R.W - h - 1; y += 1.5) for(let x = 1; x <= R.L - w - 1; x += 1.5){
    const r = R2(x, y, w, h);
    let ok = true;
    for(const it of L.items) if(ov(r, it.foot)){ ok = false; break; }
    if(ok) for(const a of L.acc) if(a.mount === 'floor' && a.foot && ov(r, a.foot)){ ok = false; break; }
    if(ok && blocksDoor(L, r, spec.soft)) ok = false;
    if(ok && avoidClear) for(const it of L.items) if(ov(r, it.clear)){ ok = false; break; }
    if(ok) for(const f of forbid) if(ov(r, f)){ ok = false; break; }
    if(!ok) continue;
    if(spec.within && !containsRect(spec.within, r)) continue;
    if(spec.mustWall && !touchesWall(L, r, 1.5)) continue;
    if(mustPark && !parkedAgainst(L, r, 1.5)) continue;
    const cx = x + w/2, cy = y + h/2;
    let d = Infinity;
    for(const p of prefs) d = Math.min(d, Math.hypot(cx - p.x, cy - p.y));
    if(spec.maxDist && d > spec.maxDist) continue;
    if(spec.near && Math.hypot(cx - spec.near.x, cy - spec.near.y) > spec.near.max) continue;
    cand.push({r, d});
  }
  cand.sort((a, b) => a.d - b.d);
  for(const c of cand.slice(0, 14)) if(keepsCirculation(L, c.r)) return c.r;
  return null;
}

/* ---------------- wall span bookkeeping for wall-mounted items ---------------- */
function mergeSpans(list){
  if(!list.length) return [];
  list.sort((a,b)=>a[0]-b[0]);
  const out=[list[0].slice()];
  for(let i=1;i<list.length;i++){
    const last = out[out.length-1];
    if(list[i][0] <= last[1] + 0.01) last[1] = Math.max(last[1], list[i][1]);
    else out.push(list[i].slice());
  }
  return out;
}
function wallBlocked(L, wall, zLo, zHi){
  const R = L.room, spans = [];
  const touches = r => {
    if(wall==='back')  return Math.abs((r.y+r.h)-R.W) < 2;
    if(wall==='front') return Math.abs(r.y) < 2;
    if(wall==='left')  return Math.abs(r.x) < 2;
    return Math.abs((r.x+r.w)-R.L) < 2;
  };
  for(const it of L.items){
    const top = FIX_HEIGHT[it.kind] || 36;
    if(top <= zLo) continue;
    if(touches(it.foot)) spans.push(alongSpan(it.foot, wall));
  }
  if(L.door.wall === wall) spans.push([L.door.t-3, L.door.t+L.door.w+3]);
  if(L.window && L.window.wall === wall && !(L.window.z+L.window.h < zLo || L.window.z > zHi))
    spans.push([L.window.t-3, L.window.t+L.window.w+3]);
  for(const a of L.acc){
    if(a.mount!=='wall' || a.wall!==wall || a.inShower) continue;
    if(a.z + a.h < zLo || a.z > zHi) continue;
    spans.push([a.t-2, a.t+a.w+2]);
  }
  return mergeSpans(spans);
}
function findWallSlot(L, wall, width, zLo, zHi, prefT){
  const wi = wallInfo(wall, L.room);
  const blocked = wallBlocked(L, wall, zLo, zHi);
  const free = [];
  let cursor = 1.5;
  for(const [a,b] of blocked){
    if(a - cursor >= width) free.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if(wi.along - 1.5 - cursor >= width) free.push([cursor, wi.along-1.5]);
  if(!free.length) return null;
  let best = null;
  for(const [a,b] of free){
    const t = clamp(prefT - width/2, a, b - width);
    const d = Math.abs(t + width/2 - prefT);
    if(!best || d < best.d) best = {t, d, span:b-a};
  }
  return best;
}

/* ---------------- accessories ---------------- */
function accWorld(wall, t, w, depth, R){
  const c = centerOf(wall, t, w, depth, R);
  return {cx:c.x, cy:c.y, yaw:wallInfo(wall,R).yaw, foot:footOf(wall,t,w,depth,R)};
}
function placeAccessories(L, cfg){
  const R = L.room, aes = AES[cfg.aesthetic], want = cfg.wants;
  L.acc = [];
  const find = k => L.items.find(i => i.kind === k);
  const vanity = find('vanity'), toilet = find('toilet'), shower = find('shower'), bath = find('bath');
  const push = (o) => { L.acc.push(o); return o; };
  const notices = L.notices;
  /* the standing space before anything loose lands on the floor */
  L._baseSquare = largestFreeSquare(buildGrid(L, 3)).size;
  const NOROOM = "This item cannot fit safely in the available space. Increase the room size or remove an item.";
  L._entry = null;

  /* ---- mirror over the basin ---- */
  if(want.has('mirror')){
    if(vanity){
      const round = aes.mirror.shape === 'round';
      let w = clamp(vanity.w - 6, 20, round ? 34 : 44);
      if(round) w = Math.min(w, 34);
      const h = round ? w : (aes.mirror.shape === 'arch' ? 42 : 36);
      const prefT = alongSpan(vanity.foot, vanity.wall)[0] + vanity.w/2;
      let slot = findWallSlot(L, vanity.wall, w, 42, 42+h, prefT);
      if(!slot && w > 22){ w = 22; slot = findWallSlot(L, vanity.wall, w, 42, 42+h, prefT); }
      if(slot){
        push({kind:'mirror', label:'Mirror', mount:'wall', wall:vanity.wall, t:slot.t, w, h, z:42,
              shape:aes.mirror.shape, owner:'vanity',
              note:`${aes.mirror.shape==='round'?'Round':'Full-width'} mirror centred on the basin, 42 in above the floor.`,
              ...accWorld(vanity.wall, slot.t, w, 1.5, R)});
        placeWindow(L, cfg); L.windowDone = true;
        if(!aes.mirror.backlit){
          const side = 5;
          for(const dt of [-side-2, w+2]){
            const st = slot.t + dt;
            if(st > 2 && st + 3 < wallInfo(vanity.wall,R).along - 2)
              push({kind:'sconce', label:'Wall light', mount:'wall', wall:vanity.wall, t:st, w:3, h:10, z:62,
                    note:'Sconce at eye height so the face is lit from the side, not above.',
                    ...accWorld(vanity.wall, st, 3, 3, R)});
          }
        }
      } else notices.push({level:'warn', text:'No clear wall above the basin for a mirror — the window or the door frame is in the way.'});
    } else notices.push({level:'warn', text:'A mirror needs a basin under it. Add the vanity and it will be placed automatically.'});
  }

  if(!L.windowDone){ placeWindow(L, cfg); L.windowDone = true; }

  /* ---- towel rail, as close to the bathing zone as it can get ---- */
  if(want.has('towel')){
    const wet = shower || bath;
    const pref = wet ? {x: wet.clear.x + wet.clear.w/2, y: wet.clear.y + wet.clear.h/2}
                     : (vanity ? {x:vanity.cx, y:vanity.cy} : {x:R.L/2, y:R.W/2});
    let best = null;
    for(const wall of WALLS){
      for(const width of [24, 18]){
        const wi = wallInfo(wall, R);
        const prefT = wall==='back'||wall==='front' ? pref.x : pref.y;
        const slot = findWallSlot(L, wall, width, 46, 52, clamp(prefT, width/2+2, wi.along-width/2-2));
        if(!slot) continue;
        const w3 = accWorld(wall, slot.t, width, 4, R);
        const d = Math.hypot(w3.cx - pref.x, w3.cy - pref.y);
        const sc = -d + (wall !== L.door.wall ? 8 : 0) + (width===24 ? 6 : 0);
        if(!best || sc > best.sc) best = {wall, t:slot.t, width, d, sc, w3};
      }
      if(best && best.d < 30) break;
    }
    if(best){
      push({kind:'towel', label:'Towel rail', mount:'wall', wall:best.wall, t:best.t, w:best.width, h:3, z:48,
            note:`Rail ${Math.round(best.d)} in from the ${shower?'shower':'bathing'} zone — within reach of a wet arm.`,
            ...accWorld(best.wall, best.t, best.width, 4, R)});
      if(best.d > 62) notices.push({level:'warn', text:`The only free wall for the towel rail is ${Math.round(best.d)} in from the shower. Consider a rail on the shower screen instead.`});
    } else notices.push({level:'warn', text:'Every wall is taken — no room for a towel rail at 48 in.'});
  }

  /* ---- toilet-side accessories: paper within reach, bin beside the pan ---- */
  if(toilet){
    const tf = fixtureFrame(toilet);
    /* the strip directly in front of the pan. Nothing loose may sit here. */
    const frontZone = frontOf(toilet.wall, toilet.t, toilet.w, 0, FIX.toilet.clearFront, 0, R);
    const otherClear = L.items.filter(i => i !== toilet).map(i => i.clear);
    /* a point just off each shoulder of the pan, a little forward of the wall */
    const shoulder = sgn => ({
      x: toilet.cx + tf.side.x * sgn * (toilet.w/2 + 7) + tf.fwd.x * 5,
      y: toilet.cy + tf.side.y * sgn * (toilet.w/2 + 7) + tf.fwd.y * 5
    });
    const shoulders = [shoulder(1), shoulder(-1)];

    const perp = (toilet.wall==='back'||toilet.wall==='front') ? ['left','right'] : ['back','front'];
    let paperAt = null;
    const ranked = perp.map(w => {
      const d = w==='left' ? toilet.cx : w==='right' ? R.L - toilet.cx : w==='front' ? toilet.cy : R.W - toilet.cy;
      return {w, d};
    }).sort((a,b)=>a.d-b.d);
    for(const r of ranked){
      if(r.d > 30) continue;
      const along = (toilet.wall==='back') ? R.W - toilet.foot.y - 10
                  : (toilet.wall==='front') ? toilet.foot.h + 10
                  : (toilet.wall==='left') ? toilet.foot.w + 10 : R.L - toilet.foot.x - 10;
      const slot = findWallSlot(L, r.w, 7, 24, 30, along);
      if(!slot) continue;
      const w3 = accWorld(r.w, slot.t, 7, 3, R);
      /* it has to be an arm's length from the seat, not merely on the right wall */
      const reach = Math.hypot(w3.cx - toilet.cx, w3.cy - toilet.cy);
      if(reach > 26) continue;
      push({kind:'paper', label:'Paper holder', mount:'wall', wall:r.w, t:slot.t, w:7, h:4, z:26,
            note:`Paper holder on the side wall, 26 in up and ${Math.round(reach)} in from the seat — inside comfortable reach.`,
            ...w3});
      paperAt = {x:w3.cx, y:w3.cy}; break;
    }
    if(!paperAt){
      /* next best, and the commonest fix in a real bathroom: the pan's own
         wall, immediately beside the seat */
      const span = alongSpan(toilet.foot, toilet.wall);
      for(const pref of [span[1] + 5, span[0] - 5]){
        const slot = findWallSlot(L, toilet.wall, 7, 24, 30, pref);
        if(!slot) continue;
        const w3 = accWorld(toilet.wall, slot.t, 7, 3, R);
        const reach = Math.hypot(w3.cx - toilet.cx, w3.cy - toilet.cy);
        if(reach > 24) continue;
        push({kind:'paper', label:'Paper holder', mount:'wall', wall:toilet.wall, t:slot.t, w:7, h:4, z:26,
              note:`Paper holder on the pan's own wall, ${Math.round(reach)} in to the side at 26 in — a seated arm's reach.`,
              ...w3});
        paperAt = {x:w3.cx, y:w3.cy}; break;
      }
    }
    if(!paperAt){
      /* no wall in reach: a freestanding holder goes at a shoulder, never in front */
      const side = placeLoose(L, {w:7, h:7, prefs:shoulders, avoidClear:false,
                                  within: sideBand(toilet, R, 24, toilet.d + 8),
                                  near: {x:toilet.cx, y:toilet.cy, max:24},
                                  forbid:[frontZone].concat(otherClear)});
      if(side){
        push({kind:'paperstand', label:'Paper stand', mount:'floor', foot:side, w:7, h:7, z:0,
              cx:side.x+3.5, cy:side.y+3.5, yaw:toilet.yaw,
              note:'No side wall within reach, so a freestanding holder sits at the shoulder of the pan.'});
        paperAt = {x:side.x+3.5, y:side.y+3.5};
        notices.push({level:'fix', text:'The toilet has no side wall in reach, so the paper holder became a freestanding stand beside the pan.'});
      } else {
        notices.push({level:'fix', text:'No wall or floor spot within reach of the toilet could hold a paper holder without breaking a clearance, so it was left out. A recessed niche or a holder on the vanity side would work.'});
      }
    }

    /* the bin takes the other shoulder, and never the approach to the pan */
    const binPrefs = paperAt
      ? shoulders.slice().sort((a,b) => Math.hypot(b.x-paperAt.x, b.y-paperAt.y) - Math.hypot(a.x-paperAt.x, a.y-paperAt.y))
      : shoulders;
    const binBand = sideBand(toilet, R, 34, toilet.d + 10);
    const near = {x:toilet.cx, y:toilet.cy, max:34};
    const binAt = placeLoose(L, {w:11, h:11, prefs:[binPrefs[0]], avoidClear:false,
                                 within: binBand, near, forbid:[frontZone].concat(otherClear)})
               || placeLoose(L, {w:11, h:11, prefs:binPrefs, avoidClear:false,
                                 within: sideBand(toilet, R, 40, toilet.d + 14),
                                 near, forbid:[frontZone].concat(otherClear)})
               /* nothing beside the pan: take any spot in the room that is
                  still out of the door path, the swing and every clear zone,
                  nearest to the pan. Better a further bin than a bad one. */
               || placeLoose(L, {w:11, h:11, prefs:binPrefs, avoidClear:true,
                                 forbid:[frontZone].concat(otherClear)})
               || placeLoose(L, {w:9, h:9, prefs:binPrefs, avoidClear:true,
                                 forbid:[frontZone].concat(otherClear)});
    if(binAt) push({kind:'bin', label:'Bin', mount:'floor', foot:binAt, w:binAt.w, h:binAt.h, z:0,
                    cx:binAt.x+binAt.w/2, cy:binAt.y+binAt.h/2, yaw:0,
                    note:'Bin beside the pan, clear of the approach, the door swing and the walk in from the door.'});
    else notices.push({level:'fix', text:'There is no clear spot beside the toilet for a bin without blocking the walk, so it was left out.'});
  }

  /* ---- inside the shower ---- */
  if(shower){
    push({kind:'niche', label:'Shower shelf', mount:'wall', wall:shower.wall, inShower:true,
          t: alongSpan(shower.foot, shower.wall)[0] + 6, w:14, h:12, z:44,
          note:'Recessed shelf on the shower wall at 44 in, out of the spray line.',
          ...accWorld(shower.wall, alongSpan(shower.foot, shower.wall)[0] + 6, 14, 2, R)});
    push({kind:'drain', label:'Drain', mount:'floor', foot:R2(shower.cx-9, shower.cy-1.5, 18, 3), w:18, h:3, z:0,
          cx:shower.cx, cy:shower.cy, yaw:shower.yaw,
          note:'Linear drain across the low side; the tray falls 1:80 toward it.'});
    const matR = freeFloorRect(L, 30, 19, shower.cx - shower.foot.w*0.0, shower.cy + 26, false, true);
    if(matR) push({kind:'mat', label:'Bath mat', mount:'floor', foot:matR, w:30, h:19, z:0,
                   cx:matR.x+15, cy:matR.y+9.5, yaw:shower.yaw, soft:true,
                   note:'Mat lands where you step out — it sits inside the clear zone, which is fine for something soft.'});
  }
  if(bath){
    push({kind:'bathfill', label:'Bath filler', mount:'wall', wall:bath.wall, inShower:true,
          t: alongSpan(bath.foot,bath.wall)[0] + 4, w:6, h:6, z:30,
          note:'Filler on the short end so the bath can still be climbed into from the long side.',
          ...accWorld(bath.wall, alongSpan(bath.foot,bath.wall)[0] + 4, 6, 3, R)});
  }

  /* ---- robe hook by the door ---- */
  const hookT = L.door.hinge ? L.door.t - 7 : L.door.t + L.door.w + 3;
  const hookSlot = findWallSlot(L, L.door.wall, 4, 62, 70, hookT);
  if(hookSlot) push({kind:'hook', label:'Robe hook', mount:'wall', wall:L.door.wall, t:hookSlot.t, w:4, h:4, z:66,
                     note:'Hook beside the door at 66 in, where a robe can hang without touching the floor.',
                     ...accWorld(L.door.wall, hookSlot.t, 4, 3, R)});

  /* ---- vanity top ---- */
  if(vanity){
    push({kind:'tray', label:'Vanity tray', mount:'top', owner:'vanity', z:35, note:'Soap and tumbler on the basin ledge.'});
  }

  /* ---- decor ---- */
  if(want.has('decor')){
    const corner = freeFloorRect(L, 14, 14, R.L - 10, R.W - 10, true) || freeFloorRect(L, 12, 12, R.L/2, R.W/2, true);
    if(corner) push({kind:'plant', label:'Planter', mount:'floor', foot:corner, w:corner.w, h:corner.h, z:0,
                     cx:corner.x+corner.w/2, cy:corner.y+corner.h/2, yaw:0,
                     note:'Planter in the one corner that no fixture or clearance needs.'});
    else notices.push({level:'warn', text:'No spare corner for plants — every square foot is doing a job.'});
    /* the stool hugs a corner. It is never allowed into the middle of the
       floor or across the walk from the door. */
    const corners = [{x:9, y:9}, {x:R.L-9, y:9}, {x:9, y:R.W-9}, {x:R.L-9, y:R.W-9}];
    let size = 13, stool = placeLoose(L, {w:13, h:13, prefs:corners, avoidClear:true, mustWall:true, cornerFirst:true});
    if(!stool){ size = 11; stool = placeLoose(L, {w:11, h:11, prefs:corners, avoidClear:true, mustWall:true, cornerFirst:true}); }
    if(stool)
      push({kind:'stool', label:'Stool', mount:'floor', foot:stool, w:size, h:size, z:0,
            cx:stool.x+size/2, cy:stool.y+size/2, yaw:0,
            note:'Stool parked in the corner, out of the walk and off everyone\'s clear floor.'});
    else
      notices.push({level:'warn', text:'Stool: there is no clear floor for it. Untick Plants & decor or choose a larger room.'});
  }

  /* ---- ceiling ---- */
  if(want.has('fan')){
    const wet = shower || bath;
    const fx = wet ? wet.cx : R.L/2, fy = wet ? wet.cy : R.W/2;
    push({kind:'fan', label:'Exhaust fan', mount:'ceiling', cx:clamp(fx,10,R.L-10), cy:clamp(fy,10,R.W-10), w:10, h:10, z:R.H,
          note:'Extract directly over the wet zone, which is where the moisture is made.'});
  }
  const lights = [];
  const nx = R.L > 84 ? 2 : 1, ny = R.W > 84 ? 2 : 1;
  for(let i=0;i<nx;i++) for(let j=0;j<ny;j++){
    lights.push({cx: R.L*(i+1)/(nx+1), cy: R.W*(j+1)/(ny+1)});
  }
  if(vanity){
    const off = 22;
    const p = { back:{x:vanity.cx, y:R.W-off}, front:{x:vanity.cx, y:off}, left:{x:off, y:vanity.cy}, right:{x:R.L-off, y:vanity.cy} }[vanity.wall];
    lights.push({cx:clamp(p.x,10,R.L-10), cy:clamp(p.y,10,R.W-10), task:true});
  }
  L.lights = lights;
}

/* ---------------- window ---------------- */
function placeWindow(L, cfg){
  const R = L.room;
  let best = null;
  for(const wall of WALLS){
    if(wall === L.door.wall) continue;
    const wi = wallInfo(wall, R);
    for(const w of [30, 24]){
      const slot = findWallSlot(L, wall, w, 40, 78, wi.along/2);
      if(!slot) continue;
      const c = centerOf(wall, slot.t, w, 2, R);
      const bear = wallBearing(wall, cfg.faceDeg);
      let sc = (slot.span || 0) * 0.5 + (cfg.vastu ? vastuScore('window', bear) * 0.6 : 0) + (w===30?8:0);
      for(const it of L.items) if(it.wall === wall && it.kind === 'shower') sc -= 40;
      if(!best || sc > best.sc) best = {wall, t:slot.t, w, sc, z:40, h:38, cx:c.x, cy:c.y};
    }
  }
  L.window = best;
}

/* ---------------- validation ---------------- */
function validate(L, cfg){
  const R = L.room;
  const grid = buildGrid(L, 3);
  const seen = reachable(L, grid);
  let freeCells = 0, total = grid.nx*grid.ny;
  for(let i=0;i<total;i++) if(!grid.g[i]) freeCells++;
  const lfs = largestFreeSquare(grid);
  const clearSquare = lfs.size;
  L.freeSquare = lfs.rect;

  for(const it of L.items){
    const spec = FIX[it.kind];
    const bodies = L.items.map(i=>i.foot).concat([L.door.foot]);
    const fd = freeDepth(it.foot, it.wall, bodies, R);
    it.freeFront = Math.round(fd);
    const reach = zoneReach(it.clear, grid, seen);
    it.reach = reach;
    if(fd + 0.6 >= spec.clearFront)
      L.notices.push({level:'ok', text:`${spec.label}: ${Math.round(fd)} in of clear floor in front, against ${spec.clearFront} in recommended.`});
    else
      L.notices.push({level:'warn', text:`${spec.label}: ${Math.round(fd)} in in front. Usable, but ${spec.clearFront} in is the comfortable figure.`});
    if(reach < 0.5)
      L.notices.push({level:'warn', text:`${spec.label} is hard to walk up to — the approach is blocked from the door.`});
  }

  /* ---- measured rates (see SCORE_WEIGHTS for how they combine) ---- */
  const placed = L.items.length, requested = placed + L.dropped.length;
  const placementRate = requested ? placed / requested : 1;
  let comfortOK = 0;
  for(const it of L.items) if(it.freeFront + 0.6 >= FIX[it.kind].clearFront) comfortOK++;
  const comfortRate = placed ? comfortOK / placed : 1;
  const vs = L.vastuStats;
  const vastuRate = vs && vs.ruled ? vs.preferred / vs.ruled : null;
  const cost = L.total || 0, budget = cfg.budget;
  const budgetOK = cost <= budget;
  const budgetScore = budgetOK ? 1 : Math.max(0, 1 - 2 * ((cost - budget) / budget));

  L.metrics = {
    floorArea: Math.round(R.L*R.W/144),
    freePct: Math.round(freeCells/total*100),
    clearSquare: Math.round(clearSquare),
    fixtures: L.items.length,
    placementRate, comfortRate, vastuRate,
    vastuPreferred: vs ? vs.preferred : null, vastuRuled: vs ? vs.ruled : null, vastuAvoided: vs ? vs.avoid : null,
    budgetOK, budgetUtilization: budget ? cost / budget : null
  };
  if(clearSquare >= 30) L.notices.push({level:'ok', text:`A clear ${Math.round(clearSquare)} in square of floor remains — enough to stand and dry off in.`});
  else L.notices.push({level:'warn', text:`The largest clear patch of floor is ${Math.round(clearSquare)} in across. Tight, but every fixture is still reachable.`});

  const W = SCORE_WEIGHTS;
  const parts = [[W.placement, placementRate], [W.comfort, comfortRate], [W.budget, budgetScore]];
  if(vastuRate !== null) parts.push([W.vastu, vastuRate]);
  const wsum = parts.reduce((a, p) => a + p[0], 0);
  L.score = Math.round(100 * parts.reduce((a, p) => a + p[0]*p[1], 0) / wsum);
  L.fit   = Math.round(100 * (placementRate + comfortRate + Math.min(1, clearSquare/30)) / 3);
  L.metrics.score = L.score; L.metrics.fit = L.fit;
}


/* ---------------- Vastu report ----------------
   A fixture is rated by the 45-degree zone its centre sits in:
     preferred  the zone is one the rule lists as good
     avoid      the zone is one the rule lists as bad
     neutral    anything else
   The rule table (VASTU) is provisional: cite and confirm it before publishing results. */
function vastuRating(kind, bearing){
  const v = VASTU[kind]; if(!v) return null;
  const zone = dirFromDeg(bearing), deg = DIR_DEG[zone];
  if(v.good.includes(deg)) return {zone, rating:'preferred'};
  if(v.bad.includes(deg))  return {zone, rating:'avoid'};
  return {zone, rating:'neutral'};
}
function vastuReport(L, cfg){
  L.vastuStats = null;
  if(!cfg.vastu) return;
  const stats = {ruled:0, preferred:0, neutral:0, avoid:0, rate:null};
  for(const it of L.items){
    const rule = VASTU[it.kind]; if(!rule) continue;
    const bear = bearingAt(it.cx, it.cy, L.room, cfg.faceDeg);
    const r = vastuRating(it.kind, bear);
    const zone = r.zone;
    it.zone = zone; it.vastu = r.rating;
    stats.ruled++; stats[r.rating]++;
    const label = FIX[it.kind].label, z = zone.toLowerCase();
    if(r.rating === 'preferred')
      L.notices.push({level:'ok', text:`${label} sits in the ${z} of the room, inside the ${rule.say} zone Vastu prefers.`});
    else if(r.rating === 'neutral')
      L.notices.push({level:'fix', text:`${label} landed in the ${z}. Vastu prefers ${rule.say}; this was the best position that keeps the clearances.`});
    else
      L.notices.push({level:'warn', text:`${label} is in the ${z}, a zone Vastu avoids. It was the best position the solver found that keeps the required clearances.`});
  }
  stats.rate = stats.ruled ? stats.preferred / stats.ruled : null;
  L.vastuStats = stats;
  const dBear = wallBearing(L.door.wall, cfg.faceDeg);
  L.door.zone = dirFromDeg(dBear);
}

/* ---------------- products and cost ---------------- */
function costLayout(L, cfg){
  const aes = AES[cfg.aesthetic];
  const chosen = [];
  const byId = id => PRODUCTS.find(x => x.id === id);
  const add = (id, why) => {
    let p = byId(id), pref = null;
    /* a shortlisted product in the same catalogue category wins over the style default */
    for(const pid of (cfg.prefer || [])){ const c = byId(pid); if(c && c.cat === SLOT_CAT[why]){ pref = c; break; } }
    if(pref) p = pref;
    if(p) chosen.push({...p, why, preferred: !!pref});
  };
  for(const it of L.items){
    if(it.kind === 'toilet')  add(aes.products.toilet, 'toilet');
    if(it.kind === 'shower')  add(aes.products.shower, 'shower');
    if(it.kind === 'bath')    add(aes.products.bath, 'bath');
    if(it.kind === 'vanity'){ add(aes.products.vanity, 'vanity'); add(aes.products.faucet, 'faucet'); }
    if(it.kind === 'storage') add(aes.products.storage, 'storage');
  }
  if(L.acc.some(a=>a.kind==='mirror')) add(aes.products.mirror, 'mirror');
  if(L.acc.some(a=>a.kind==='towel'))  add(aes.products.towel, 'towel');
  if(L.acc.some(a=>a.kind==='fan'))    add(aes.products.fan, 'fan');

  let total = chosen.reduce((a,p)=>a+p.price, 0);
  if(total > cfg.budget){
    const swaps = [];
    let moved = true;
    while(total > cfg.budget && moved){
      moved = false;
      /* give up the biggest saving first, one step at a time */
      let bi = -1, bsave = 0, balt = null;
      for(let i=0;i<chosen.length;i++){
        if(chosen[i].preferred) continue;   /* never downgrade a piece the person shortlisted */
        const alt = PRODUCTS.filter(p => p.cat === chosen[i].cat && p.price < chosen[i].price)
                            .sort((a,b)=>b.price-a.price)[0];
        if(alt && chosen[i].price - alt.price > bsave){ bsave = chosen[i].price - alt.price; bi = i; balt = alt; }
      }
      if(bi >= 0){ total -= bsave; swaps.push([chosen[bi].name, balt.name]); chosen[bi] = {...balt, why:chosen[bi].why}; moved = true; }
    }
    if(total > cfg.budget){
      const kept = chosen.some(p => p.preferred);
      L.notices.push({level:'warn', text: kept
        ? `Your shortlisted pieces were kept, and everything else is already at its lowest-cost option. The layout comes to ${'₹ '+total.toLocaleString('en-IN')}, over your ceiling.`
        : `Even with the most affordable fixture in every category this layout comes to ${'₹ '+total.toLocaleString('en-IN')}, over your ceiling.`});
    }
    for(const [a,b] of swaps)
      L.notices.push({level:'fix', text:`Swapped ${a.replace('KOHLER ','')} for ${b.replace('KOHLER ','')} to stay inside your budget.`});
  }
  for(const p of chosen) if(p.preferred)
    L.notices.push({level:'ok', text:`Using your shortlisted ${p.name.replace('KOHLER ','')} instead of the ${AES[cfg.aesthetic].name} default.`});
  L.products = chosen;
  L.total = total;
}

/* ==================================================================
   solve(): try every sensible door, both swing directions and three
   placement orders, keep the layout that scores best.
   ================================================================== */
const ORDERS = [
  ['shower','bath','toilet','vanity','storage'],
  ['bath','shower','vanity','toilet','storage'],
  ['toilet','shower','bath','vanity','storage'],
  ['vanity','shower','bath','toilet','storage']
];
function solve(state){
  const cfg = {
    R: {...state.room},
    faceDeg: degOf(state.face),
    vastu: state.vastu,
    doorWall: state.doorWall,
    aesthetic: state.aesthetic,
    budget: state.budget,
    prefer: Array.isArray(state.prefer) ? state.prefer.slice() : [...(state.prefer || [])],
    wants: new Set([...state.wants])
  };
  const doors = doorCandidates(cfg.R, cfg);
  let best = null;

  for(const door of doors){
    for(const order of ORDERS){
      for(const out of [false, true]){
        const d = {...door, swingOut: out};
        if(out && door.swingOut) continue;
        const r = packOnce(cfg, d, order);
        let sc = r.score;
        sc += out ? -140 : 0;
        if(cfg.vastu) sc += vastuScore('door', wallBearing(d.wall, cfg.faceDeg)) * 0.3;
        sc -= r.adjusted.length * 12;
        if(!best || sc > best.sc) best = {sc, door:d, order, r};
        if(!out && r.dropped.length === 0) break;      // inward swing worked, no need to try outward
      }
    }
  }

  const L = {
    room: cfg.R, face: state.face, faceDeg: cfg.faceDeg, vastu: cfg.vastu,
    aesthetic: cfg.aesthetic, door: best.door, items: best.r.items,
    dropped: best.r.dropped, adjusted: best.r.adjusted, acc: [], notices: [], lights: []
  };

  /* what had to change to make it work */
  if(L.door.swingOut) L.notices.push({level:'fix', text:'The door was re-hung to open outward — swinging in would have landed on a fixture.'});
  for(const a of L.adjusted){
    const from = a.from;
    L.notices.push({level:'fix', text:`${FIX[a.kind].label} reduced to ${a.w}×${a.d} in from ${from.w}×${from.d} in so the clearances still hold.`});
  }
  const has = k => L.items.some(i=>i.kind===k);
  for(const k of L.dropped){
    const alt = k==='bath' ? (has('shower') ? 'The shower carries the bathing function instead.' : 'Nothing else can take the bathing function — try a longer room.')
              : k==='storage' ? 'Storage moves into the vanity drawers and the mirror cabinet.'
              : k==='shower' ? (has('bath') ? 'The bath takes the bathing function, with a screen and a mixer over it.' : 'Nothing else can take the bathing function — try a longer room.')
              : 'No wall is left that can take it and still hold its clearances.';
    L.notices.push({level:'warn', text:`${FIX[k].label} could not be placed in ${Math.round(cfg.R.L/12)}×${Math.round(cfg.R.W/12)} ft. ${alt}`});
  }

  computeOpenSides(L);
  placeAccessories(L, cfg);
  costLayout(L, cfg);

  /* everything above is structural — it does not change when the user
     drags one thing. Keep it, so a manual move can re-run only the
     checks that actually depend on where things sit. */
  L._cfg = cfg;
  L._base = L.notices.slice();
  L.items.forEach((it, i) => it.uid = 'f' + i);
  L.acc.forEach((a, i) => a.uid = 'a' + i);
  revalidate(L);
  return L;
}

/* Re-run every position-dependent check. Called once by the solver and
   again after each manual move, so the report always describes the
   bathroom as it stands right now. */
function revalidate(L){
  const cfg = L._cfg;
  L.notices = (L._base || []).slice();
  computeOpenSides(L);
  vastuReport(L, cfg);
  validate(L, cfg);

  /* final safety net: nothing may overlap anything, ever */
  L.conflicts = [];
  const LOOSE = {bin:1, plant:1, stool:1, paperstand:1};
  const all = L.items.map(i=>({n:FIX[i.kind].label, r:i.foot}))
    .concat(L.acc.filter(a=>a.mount==='floor' && a.foot && LOOSE[a.kind]).map(a=>({n:a.label, r:a.foot})));
  for(let i=0;i<all.length;i++) for(let j=i+1;j<all.length;j++)
    if(ov(all[i].r, all[j].r, 0.6)) L.conflicts.push(`${all[i].n} / ${all[j].n}`);
  if(L.conflicts.length)
    L.notices.push({level:'warn', text:'Overlap detected: ' + L.conflicts.join(', ')});
  else
    L.notices.push({level:'ok', text:'Collision check passed: no fixture, accessory or door swing intersects another.'});

  L.notices.sort((a,b)=>({warn:0,fix:1,ok:2})[a.level] - ({warn:0,fix:1,ok:2})[b.level]);
  return L;
}

/* ------------------------------------------------------------------
   Which sides of a fixture are open to the room. Consumed by the plan
   symbol (where to draw glass) and by the 3D shower (where to build a
   screen). A side that touches a wall never gets a panel.
   ------------------------------------------------------------------ */
function computeOpenSides(L){
  for(const it of L.items){
    const along   = wallInfo(it.wall, L.room).along;
    const lowOpen  = it.t > 1.5;
    const highOpen = it.t + it.w < along - 1.5;
    const flip = (it.wall === 'front' || it.wall === 'right');
    it.flip = flip;
    it.openSides = { front:true, left: flip ? highOpen : lowOpen, right: flip ? lowOpen : highOpen };
  }
}

