/* ---- e3_plan.js ---- */

/* ==================================================================
   2D FLOOR PLAN — drawn from the same layout object as the 3D room
   ================================================================== */
const PLAN_ROT = { back:0, front:180, left:-90, right:90 };
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function planSymbol(it, aes){
  const w = it.w, d = it.d, hw = w/2, hd = d/2;
  const ink = 'var(--ink)', line = 'var(--line-2)';
  switch(it.kind){
    case 'toilet': {
      const tank = aes.toilet === 'wallhung' ? 6 : 8;
      const bw = Math.min(w-1, 19);
      return `<rect x="${-bw/2}" y="${-hd}" width="${bw}" height="${tank}" rx="1.5" fill="#fff" stroke="${ink}" stroke-width=".9"/>
        <ellipse cx="0" cy="${-hd+tank+(d-tank)/2}" rx="${bw/2-0.6}" ry="${(d-tank)/2-0.6}" fill="#fff" stroke="${ink}" stroke-width=".9"/>
        <ellipse cx="0" cy="${-hd+tank+(d-tank)/2}" rx="${bw/2-3}" ry="${(d-tank)/2-3}" fill="none" stroke="${line}" stroke-width=".7"/>
        <line x1="${-bw/2+2}" y1="${-hd+tank}" x2="${bw/2-2}" y2="${-hd+tank}" stroke="${line}" stroke-width=".7"/>`;
    }
    case 'shower': {
      const open = it.openSides || {front:true};
      let s = `<rect x="${-hw}" y="${-hd}" width="${w}" height="${d}" fill="${aes.pal.glass}" fill-opacity=".45" stroke="${ink}" stroke-width=".7"/>
        <line x1="${-hw+1}" y1="${-hd+1}" x2="${hw-1}" y2="${hd-1}" stroke="${line}" stroke-width=".6"/>
        <line x1="${-hw+1}" y1="${hd-1}" x2="${hw-1}" y2="${-hd+1}" stroke="${line}" stroke-width=".6"/>
        <rect x="-9" y="-1.6" width="18" height="3.2" rx="1.5" fill="none" stroke="${ink}" stroke-width=".8"/>
        <circle cx="${-hw+5}" cy="${-hd+5}" r="3" fill="none" stroke="${ink}" stroke-width=".8"/>
        <circle cx="${-hw+5}" cy="${-hd+5}" r="1" fill="${ink}"/>`;
      /* glass screen on whichever sides are open to the room */
      if(open.front) s += `<line x1="${-hw}" y1="${hd}" x2="${hw}" y2="${hd}" stroke="var(--signal)" stroke-width="1.8"/>
        <path d="M${hw-2} ${hd} A ${w*0.55} ${w*0.55} 0 0 0 ${hw-2} ${hd-w*0.55}" fill="none" stroke="var(--signal)" stroke-width=".7" stroke-dasharray="2.5 2.5"/>`;
      if(open.left)  s += `<line x1="${-hw}" y1="${-hd}" x2="${-hw}" y2="${hd}" stroke="var(--signal)" stroke-width="1.8"/>`;
      if(open.right) s += `<line x1="${hw}" y1="${-hd}" x2="${hw}" y2="${hd}" stroke="var(--signal)" stroke-width="1.8"/>`;
      return s;
    }
    case 'vanity': {
      const bw = Math.min(w-8, 22), bh = Math.min(d-5, 15);
      return `<rect x="${-hw}" y="${-hd}" width="${w}" height="${d}" rx="1" fill="#fff" stroke="${ink}" stroke-width=".9"/>
        <ellipse cx="0" cy="${0.5}" rx="${bw/2}" ry="${bh/2}" fill="${aes.pal.glass}" fill-opacity=".5" stroke="${ink}" stroke-width=".8"/>
        <circle cx="0" cy="${0.5}" r="1" fill="${ink}"/>
        <rect x="-2.6" y="${-hd+1}" width="5.2" height="3" rx="1.4" fill="${ink}" opacity=".7"/>
        ${w>34?`<line x1="${-hw+3}" y1="${hd-1.5}" x2="${-hw+w*0.3}" y2="${hd-1.5}" stroke="${line}" stroke-width=".8"/>
        <line x1="${hw-w*0.3}" y1="${hd-1.5}" x2="${hw-3}" y2="${hd-1.5}" stroke="${line}" stroke-width=".8"/>`:''}`;
    }
    case 'bath':
      return `<rect x="${-hw}" y="${-hd}" width="${w}" height="${d}" rx="2.5" fill="#fff" stroke="${ink}" stroke-width=".9"/>
        <rect x="${-hw+2.5}" y="${-hd+2.5}" width="${w-5}" height="${d-5}" rx="6" fill="${aes.pal.glass}" fill-opacity=".4" stroke="${line}" stroke-width=".8"/>
        <circle cx="${-hw+6}" cy="0" r="1.4" fill="none" stroke="${ink}" stroke-width=".8"/>
        <rect x="${-hw+3}" y="${-3.5}" width="4" height="7" rx="1.6" fill="none" stroke="${ink}" stroke-width=".7"/>`;
    case 'storage':
      return `<rect x="${-hw}" y="${-hd}" width="${w}" height="${d}" fill="#fff" stroke="${ink}" stroke-width=".9"/>
        <line x1="${-hw}" y1="${-hd}" x2="${hw}" y2="${hd}" stroke="${line}" stroke-width=".6"/>
        <line x1="${-hw}" y1="${hd}" x2="${hw}" y2="${-hd}" stroke="${line}" stroke-width=".6"/>
        <line x1="${-hw}" y1="${hd}" x2="${hw}" y2="${hd}" stroke="${ink}" stroke-width="1.2"/>`;
    default: return '';
  }
}
function accSymbol(a){
  const ink='var(--ink-soft)', br='var(--brass)';
  switch(a.kind){
    case 'mirror': return `<rect x="${-a.w/2}" y="-2.6" width="${a.w}" height="2.2" fill="var(--signal)" opacity=".55"/>`;
    case 'towel':  return `<rect x="${-a.w/2}" y="-2.2" width="${a.w}" height="1.6" fill="${br}"/>
      ${[0,.25,.5,.75,1].map(f=>`<line x1="${-a.w/2+f*a.w}" y1="-2.2" x2="${-a.w/2+f*a.w}" y2="2" stroke="${br}" stroke-width=".5" opacity=".55"/>`).join('')}`;
    case 'paper':  return `<circle cx="0" cy="1.5" r="2.4" fill="none" stroke="${ink}" stroke-width=".8"/><circle cx="0" cy="1.5" r=".7" fill="${ink}"/>`;
    case 'hook':   return `<circle cx="0" cy="1.4" r="1.5" fill="${br}"/>`;
    case 'sconce': return `<path d="M-1.8 0 L1.8 0 L0 3.4 Z" fill="${br}" opacity=".85"/>`;
    case 'niche':  return `<rect x="${-a.w/2}" y="-3" width="${a.w}" height="3" fill="none" stroke="${ink}" stroke-width=".7" stroke-dasharray="2 1.6"/>`;
    case 'bathfill': return `<circle cx="0" cy="2" r="1.8" fill="none" stroke="${ink}" stroke-width=".8"/>`;
    case 'drain':  return `<rect x="${-a.w/2}" y="-1.2" width="${a.w}" height="2.4" rx="1" fill="${ink}" opacity=".55"/>`;
    case 'mat':    return `<rect x="${-a.w/2}" y="${-a.h/2}" width="${a.w}" height="${a.h}" rx="2" fill="${ink}" opacity=".13" stroke="${ink}" stroke-width=".6" stroke-dasharray="3 2"/>`;
    case 'bin':    return `<circle cx="0" cy="0" r="${a.w/2}" fill="none" stroke="${ink}" stroke-width=".8"/>`;
    case 'paperstand': return `<circle cx="0" cy="0" r="${a.w/2}" fill="none" stroke="${ink}" stroke-width=".8"/><circle cx="0" cy="0" r="1" fill="${ink}"/>`;
    case 'plant':  return `<circle cx="0" cy="0" r="${a.w/2}" fill="#5E7A55" opacity=".55"/><circle cx="0" cy="0" r="${a.w/2-3}" fill="none" stroke="#3E5638" stroke-width=".7"/>`;
    case 'stool':  return `<rect x="${-a.w/2}" y="${-a.h/2}" width="${a.w}" height="${a.h}" rx="2" fill="none" stroke="${ink}" stroke-width=".8"/>`;
    case 'fan':    return `<circle cx="0" cy="0" r="5" fill="none" stroke="${ink}" stroke-width=".7" stroke-dasharray="2 2"/><path d="M-3 0h6M0 -3v6" stroke="${ink}" stroke-width=".6"/>`;
    default: return '';
  }
}

function drawPlan(){
  const L = STATE.layout; if(!L) return;
  const R = L.room, aes = AES[STATE.aesthetic];
  const host = document.getElementById('plan');
  const pad = {l:40, r:26, t:34, b:40};
  const maxW = Math.max(300, Math.min(host.clientWidth || 420, 460));
  const S = Math.min((maxW - pad.l - pad.r) / R.L, 300 / R.W);
  const W = R.L*S + pad.l + pad.r, H = R.W*S + pad.t + pad.b;
  const ox = pad.l, oy = pad.t;
  const sx = x => ox + x*S, sy = y => oy + (R.W - y)*S;
  const rectPx = r => ({x:sx(r.x), y:sy(r.y + r.h), w:r.w*S, h:r.h*S});
  const px = r => { const q = rectPx(r); return `x="${q.x.toFixed(1)}" y="${q.y.toFixed(1)}" width="${q.w.toFixed(1)}" height="${q.h.toFixed(1)}"`; };
  const P = [];

  /* floor + tile joints */
  P.push(`<rect ${px(R2(0,0,R.L,R.W))} fill="${aes.pal.floor}" fill-opacity=".14"/>`);
  const tw = aes.floor.tw, th = aes.floor.th;
  for(let x=tw; x<R.L; x+=tw) P.push(`<line x1="${sx(x)}" y1="${sy(R.W)}" x2="${sx(x)}" y2="${sy(0)}" stroke="var(--line-2)" stroke-width=".5" opacity=".7"/>`);
  for(let y=th; y<R.W; y+=th) P.push(`<line x1="${sx(0)}" y1="${sy(y)}" x2="${sx(R.L)}" y2="${sy(y)}" stroke="var(--line-2)" stroke-width=".5" opacity=".7"/>`);

  /* the largest patch of floor you can actually stand in */
  if(STATE.showClear && L.freeSquare && L.freeSquare.w > 12)
    P.push(`<rect ${px(L.freeSquare)} fill="var(--verdigris)" fill-opacity=".10" stroke="var(--verdigris)" stroke-width=".8" stroke-dasharray="4 3"/>
      <text x="${sx(L.freeSquare.x + L.freeSquare.w/2)}" y="${sy(L.freeSquare.y + L.freeSquare.h/2)+3}" text-anchor="middle" font-size="9.5" fill="var(--verdigris)" font-family="Inter">${Math.round(L.freeSquare.w)}″ clear</text>`);

  /* clearance zones */
  if(STATE.showClear) for(const it of L.items)
    P.push(`<rect ${px(it.ideal)} fill="var(--signal)" fill-opacity=".10" stroke="var(--signal)" stroke-width=".7" stroke-dasharray="3 3" opacity=".9"/>`);

  /* walls */
  P.push(`<rect ${px(R2(0,0,R.L,R.W))} fill="none" stroke="var(--ink)" stroke-width="3.4"/>`);

  /* window: break the wall line */
  if(L.window){
    const wnd = L.window, wi = wallInfo(wnd.wall, R);
    const a = footOf(wnd.wall, wnd.t, wnd.w, 3, R);
    P.push(`<g class="hot" data-n="window"><rect ${px(a)} fill="var(--page)" stroke="var(--signal)" stroke-width="1.4"/>
      <line ${wnd.wall==='back'||wnd.wall==='front'
        ? `x1="${sx(a.x)}" y1="${sy(a.y+a.h/2)}" x2="${sx(a.x+a.w)}" y2="${sy(a.y+a.h/2)}"`
        : `x1="${sx(a.x+a.w/2)}" y1="${sy(a.y)}" x2="${sx(a.x+a.w/2)}" y2="${sy(a.y+a.h)}"`} stroke="var(--signal)" stroke-width="1"/></g>`);
  }

  /* door: opening, leaf and swept arc */
  const d = L.door;
  const dOpen = footOf(d.wall, d.t, d.w, 3.6, R);
  P.push(`<rect ${px(dOpen)} fill="var(--page)" stroke="none"/>`);
  {
    const wi = wallInfo(d.wall, R);
    const hingeT = d.hinge ? d.t + d.w : d.t;
    const dir = d.hinge ? -1 : 1;
    const hp = (() => {
      switch(d.wall){
        case 'back':  return {x:hingeT, y:R.W};
        case 'front': return {x:hingeT, y:0};
        case 'left':  return {x:0, y:hingeT};
        default:      return {x:R.L, y:hingeT};
      }
    })();
    const along = (t) => {
      switch(d.wall){
        case 'back':  return {x:hingeT + dir*t, y:R.W};
        case 'front': return {x:hingeT + dir*t, y:0};
        case 'left':  return {x:0, y:hingeT + dir*t};
        default:      return {x:R.L, y:hingeT + dir*t};
      }
    };
    const into = d.swingOut ? -1 : 1;
    const inv = { back:{x:0,y:-1}, front:{x:0,y:1}, left:{x:1,y:0}, right:{x:-1,y:0} }[d.wall];
    const end = along(d.w);
    const leaf = { x: hp.x + inv.x*d.w*into, y: hp.y + inv.y*d.w*into };
    P.push(`<g class="hot" data-n="door">
      <path d="M${sx(end.x)} ${sy(end.y)} A ${d.w*S} ${d.w*S} 0 0 ${( (d.wall==='back'||d.wall==='left') ? (dir*into>0?1:0) : (dir*into>0?0:1) )} ${sx(leaf.x)} ${sy(leaf.y)}"
        fill="var(--brass)" fill-opacity=".10" stroke="var(--brass)" stroke-width=".9" stroke-dasharray="4 3"/>
      <line x1="${sx(hp.x)}" y1="${sy(hp.y)}" x2="${sx(leaf.x)}" y2="${sy(leaf.y)}" stroke="var(--brass)" stroke-width="2.6"/>
      <circle cx="${sx(hp.x)}" cy="${sy(hp.y)}" r="2.4" fill="var(--brass)"/></g>`);
  }

  /* fixtures */
  for(const it of L.items){
    const rot = PLAN_ROT[it.wall];
    P.push(`<g class="hot grab" data-n="${it.kind}" data-uid="${it.uid||''}" transform="translate(${sx(it.cx).toFixed(2)},${sy(it.cy).toFixed(2)}) rotate(${rot}) scale(${S.toFixed(4)})">${planSymbol(it, aes)}</g>`);
  }
  /* accessories */
  for(const a of L.acc){
    if(a.mount === 'top' || a.cx === undefined) continue;
    const rot = a.mount === 'wall' ? PLAN_ROT[a.wall] : 0;
    const op = a.mount === 'ceiling' ? ' opacity=".5"' : '';
    const hold = draggableAcc(a) ? ' grab' : '';
    P.push(`<g class="hot${hold}" data-n="acc:${a.kind}" data-uid="${a.uid||''}"${op} transform="translate(${sx(a.cx).toFixed(2)},${sy(a.cy).toFixed(2)}) rotate(${rot}) scale(${S.toFixed(4)})">${accSymbol(a)}</g>`);
  }

  /* selection and live drag feedback: the body outline of the thing being
     moved, plus the clear floor it needs, in green while the spot is legal
     and in red the moment it is not */
  {
    const sel = selectedTarget(L);
    if(sel){
      const bad = ARR.drag && ARR.verdict && !ARR.verdict.ok;
      const col = bad ? '#C2542F' : 'var(--verdigris)';
      const zones = sel.zones || [];
      for(const z of zones)
        P.push(`<rect ${px(z)} fill="${col}" fill-opacity=".10" stroke="${col}" stroke-width=".9" stroke-dasharray="5 4"/>`);
      P.push(`<rect ${px(sel.foot)} fill="none" stroke="${col}" stroke-width="2"/>`);
      const q = rectPx(sel.foot);
      for(const [hx,hy] of [[q.x,q.y],[q.x+q.w,q.y],[q.x,q.y+q.h],[q.x+q.w,q.y+q.h]])
        P.push(`<rect x="${(hx-2.6).toFixed(1)}" y="${(hy-2.6).toFixed(1)}" width="5.2" height="5.2" fill="${col}"/>`);
      if(ARR.drag && ARR.verdict && !ARR.verdict.ok)
        P.push(`<text x="${(q.x+q.w/2).toFixed(1)}" y="${(q.y-7).toFixed(1)}" text-anchor="middle" font-size="9.5"
                 font-family="Inter" fill="${col}">${esc(ARR.verdict.why || 'no room here')}</text>`);
    }
  }

  /* dimensions */
  if(STATE.showDims){
    const ft = v => `${Math.floor(v/12)}′ ${Math.round(v%12)}″`.replace(' 0″','');
    P.push(`<g stroke="var(--muted)" stroke-width=".9" fill="none">
      <path d="M${sx(0)} ${oy-16}H${sx(R.L)}"/><path d="M${sx(0)} ${oy-20}v8M${sx(R.L)} ${oy-20}v8"/>
      <path d="M${ox-20} ${sy(0)}V${sy(R.W)}"/><path d="M${ox-24} ${sy(0)}h8M${ox-24} ${sy(R.W)}h8"/></g>
      <text x="${(sx(0)+sx(R.L))/2}" y="${oy-21}" text-anchor="middle" font-size="10.5" fill="var(--muted)" font-family="Inter">${ft(R.L)}</text>
      <text x="${ox-27}" y="${(sy(0)+sy(R.W))/2}" text-anchor="middle" font-size="10.5" fill="var(--muted)" font-family="Inter" transform="rotate(-90 ${ox-27} ${(sy(0)+sy(R.W))/2})">${ft(R.W)}</text>`);
  }

  /* compass: which way each wall faces */
  const lab = (wall) => shortOf(dirFromDeg(wallBearing(wall, L.faceDeg)));
  P.push(`<text x="${(sx(0)+sx(R.L))/2}" y="${sy(R.W)-7}" text-anchor="middle" font-size="9.5" fill="var(--brass)" font-family="Inter" letter-spacing=".08em">BACK · ${lab('back')}</text>
    <text x="${(sx(0)+sx(R.L))/2}" y="${sy(0)+13}" text-anchor="middle" font-size="9.5" fill="var(--muted)" font-family="Inter" letter-spacing=".08em">${lab('front')}</text>
    <text x="${sx(0)+11}" y="${(sy(0)+sy(R.W))/2}" text-anchor="middle" font-size="9.5" fill="var(--muted)" font-family="Inter" transform="rotate(-90 ${sx(0)+11} ${(sy(0)+sy(R.W))/2})">${lab('left')}</text>
    <text x="${sx(R.L)-11}" y="${(sy(0)+sy(R.W))/2}" text-anchor="middle" font-size="9.5" fill="var(--muted)" font-family="Inter" transform="rotate(90 ${sx(R.L)-11} ${(sy(0)+sy(R.W))/2})">${lab('right')}</text>`);

  const cx = W - 20, cy = H - 20;
  P.push(`<g transform="translate(${cx},${cy}) rotate(${-L.faceDeg})">
    <circle r="13" fill="var(--porcelain)" stroke="var(--line-2)" stroke-width="1"/>
    <path d="M0 -10 L3.4 2 L0 -0.6 L-3.4 2 Z" fill="var(--brass)"/>
    <text y="-13.5" text-anchor="middle" font-size="8" fill="var(--muted)" font-family="Inter">N</text></g>`);

  host.innerHTML = `<svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${Math.min(W,maxW).toFixed(0)}" role="img" aria-label="Generated bathroom floor plan">${P.join('')}</svg>`;
  /* the plan's own transform, so a pointer can be read back into inches */
  PLANV = { S, ox, oy, R, svg: host.querySelector('svg') };
  bindPlanDrag(host);

  /* notes on hover */
  const note = document.getElementById('planNote');
  const NOTES = {};
  for(const it of L.items){
    const spec = FIX[it.kind];
    NOTES[it.kind] = `${spec.label}: ${it.w}×${it.d} in on the ${lab(it.wall).toLowerCase()} wall, ${it.freeFront} in of clear floor in front`
      + (it.zone ? ` · ${it.zone} zone.` : '.');
  }
  NOTES.door = `Door ${L.door.w} in wide on the ${lab(L.door.wall)} wall, opening ${L.door.swingOut?'outward':'inward'} on the ${L.door.hinge?'far':'near'} hinge.`;
  NOTES.window = L.window ? `Window ${L.window.w} in wide, sill at ${L.window.z} in, on the ${lab(L.window.wall)} wall.` : '';
  for(const a of L.acc) NOTES['acc:'+a.kind] = a.note || a.label;
  host.querySelectorAll('.hot').forEach(g => {
    const set = () => { if(!ARR.drag) note.textContent = NOTES[g.dataset.n] || ''; };
    g.addEventListener('mouseenter', set);
    g.addEventListener('click', set);
  });
}
/* the plan-to-room transform, refreshed on every draw */
let PLANV = null;

