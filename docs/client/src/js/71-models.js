/* ---- e4b_models.js ---- */

/* ==================================================================
   FIXTURE MODELS
   Each returns a Group whose origin is on the floor at the centre of
   its footprint, facing +Z, with its back (the wall side) at -Z.
   ================================================================== */
function extrudeFlat(shape, t, seg){
  return new THREE.ExtrudeGeometry(shape, {depth:t, bevelEnabled:false, curveSegments:seg||24, steps:1});
}
function roundRectPath(w,d,r){
  r = Math.max(0.01, Math.min(r, Math.min(w,d)/2 - 0.01));
  const p = new THREE.Path();
  const x = -w/2, y = -d/2;
  p.moveTo(x+r, y);
  p.lineTo(x+w-r, y); p.absarc(x+w-r, y+r, r, -Math.PI/2, 0);
  p.lineTo(x+w, y+d-r); p.absarc(x+w-r, y+d-r, r, 0, Math.PI/2);
  p.lineTo(x+r, y+d);   p.absarc(x+r, y+d-r, r, Math.PI/2, Math.PI);
  p.lineTo(x, y+r);     p.absarc(x+r, y+r, r, Math.PI, Math.PI*1.5);
  return p;
}
function ringShape(rx, ry, t, cy){
  const s = new THREE.Shape(); s.absellipse(0, cy||0, rx, ry, 0, Math.PI*2, false, 0);
  const h = new THREE.Path(); h.absellipse(0, cy||0, rx-t, ry-t, 0, Math.PI*2, true, 0);
  s.holes.push(h); return s;
}
function bowlLathe(depth, rTop, mat, segs){
  const pts = [];
  const n = 9;
  for(let i=0;i<=n;i++){
    const u = i/n;
    const r = rTop * Math.pow(u, 0.55);
    const y = -depth * Math.pow(1-u, 1.7);
    pts.push(new THREE.Vector2(Math.max(0.35, r), y));
  }
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, segs||36), mat);
  m.castShadow = false; m.receiveShadow = true; return m;
}

/* ---------------- toilet ---------------- */
function buildToilet(aes, M, w, d){
  const g = new THREE.Group();
  const style = aes.toilet;
  const bw = Math.min(w - 1.5, 18.5);
  if(style === 'wallhung'){
    const panel = boxR(w + 12, 42, 7, 1, M.feat, 0.2);
    at(panel, 0, 0, -d/2 + 3.5); g.add(panel);
    const cap = plate(w + 12, 1.4, 7.4, M.top); at(cap, 0, 42.7, -d/2 + 3.5); g.add(cap);
    const plateF = plate(7, 4.6, 0.7, M.metal); at(plateF, 0, 33, -d/2 + 7.2); g.add(plateF);
    const bowl = new THREE.Mesh(extrudeUp(roundRectShape(bw, d - 8, bw/2 - 0.6), 8, 1.1), M.porc);
    bowl.castShadow = true; at(bowl, 0, 14.5, 2.2); g.add(bowl);
    const neck = plate(bw - 3, 7, 5, M.porc); at(neck, 0, 15.5, -d/2 + 8); g.add(neck);
    const seat = new THREE.Mesh(extrudeUp(ringShape(bw/2 - 0.4, (d-8)/2 - 0.4, 2.3), 1.1, 0.25), M.seat);
    at(seat, 0, 22.7, 2.2); g.add(seat);
    const lid = new THREE.Mesh(extrudeUp(ellipseShape(bw/2 - 0.2, (d-8)/2 - 0.2), 1.1, 0.35), M.seat);
    at(lid, 0, 23.9, 2.2); g.add(lid);
  } else {
    const skirtH = style === 'onepiece' ? 15.5 : 14.5;
    const skirt = new THREE.Mesh(extrudeUp(roundRectShape(bw, d - 1.5, 5.5), skirtH, 1.0), M.porc);
    skirt.castShadow = true; at(skirt, 0, 0, 0.5); g.add(skirt);
    const foot = new THREE.Mesh(extrudeUp(roundRectShape(bw - 2.5, d - 5, 4), 1.2, 0.3), M.porcSoft);
    at(foot, 0, 0, 0.5); g.add(foot);
    const rim = new THREE.Mesh(extrudeUp(ringShape(bw/2 - 0.3, (d - 9)/2, 2.6), 1.5, 0.3), M.porc);
    at(rim, 0, skirtH, 2.6); g.add(rim);
    const seat = new THREE.Mesh(extrudeUp(ringShape(bw/2 - 0.7, (d - 9)/2 - 0.4, 2.2), 1.1, 0.25), M.seat);
    at(seat, 0, skirtH + 1.5, 2.6); g.add(seat);
    const lid = new THREE.Mesh(extrudeUp(ellipseShape(bw/2 - 0.5, (d - 9)/2 - 0.2), 1.1, 0.35), M.seat);
    at(lid, 0, skirtH + 2.6, 2.6); g.add(lid);
    const tankH = style === 'onepiece' ? 14 : 16;
    const tank = boxR(bw + 0.6, tankH, 7.6, 2.2, M.porc, 0.6);
    at(tank, 0, skirtH + 1.2, -d/2 + 4.2); g.add(tank);
    const lidT = plate(bw + 1.6, 1.2, 8.4, M.porc); at(lidT, 0, skirtH + tankH + 1.6, -d/2 + 4.2); g.add(lidT);
    const btn = cyl(1.3, 1.3, 0.6, M.metal, 18); at(btn, 0, skirtH + tankH + 2.5, -d/2 + 4.2); g.add(btn);
  }
  return g;
}

/* ---------------- vanity ---------------- */
function buildVanity(aes, M, w, d){
  const g = new THREE.Group();
  const style = aes.cab.style, topY = 34;
  const cabW = w - 1, cabD = d - 1.5;

  if(style === 'floating-timber'){
    const slab = boxR(w, 3.4, d, 0.7, M.wood, 0.25); at(slab, 0, topY - 3.4, 0); g.add(slab);
    const bar = cyl(0.5, 0.5, w - 6, M.metal, 14); bar.rotation.z = Math.PI/2; at(bar, 0, topY - 10, d/2 - 1.5); g.add(bar);
  } else if(style === 'steel'){
    const legs = [[-cabW/2+1.2, -cabD/2+1.2],[cabW/2-1.2,-cabD/2+1.2],[-cabW/2+1.2,cabD/2-1.2],[cabW/2-1.2,cabD/2-1.2]];
    for(const [x,z] of legs){ const l = plate(1.3, topY - 1.6, 1.3, M.metalDark); at(l, x, (topY-1.6)/2, z); g.add(l); }
    const shelf = boxR(cabW - 2, 1.2, cabD - 2, 0.3, M.wood, 0.1); at(shelf, 0, 8, 0); g.add(shelf);
    const rail = plate(cabW - 2, 1, 1, M.metalDark); at(rail, 0, 26, -cabD/2 + 1.2); g.add(rail);
  } else {
    const baseY = style === 'wallhung' ? 11 : (style === 'legs' ? 6.5 : 0);
    const bodyH = topY - baseY - 1.6;
    const body = boxR(cabW, bodyH, cabD, 0.8, M.cab, 0.25); at(body, 0, baseY, 0); g.add(body);
    if(style === 'legs'){
      for(const x of [-cabW/2+3, cabW/2-3]) for(const z of [-cabD/2+2.4, cabD/2-2.4]){
        const l = cyl(0.7, 0.9, baseY, M.metal, 14); at(l, x, baseY/2, z); g.add(l);
      }
    }
    /* fronts */
    const n = cabW > 40 ? 2 : 1, fw = cabW/n - 1.2;
    for(let i=0;i<n;i++){
      const cx = -cabW/2 + cabW/(2*n) + i*cabW/n;
      if(aes.cab.front === 'fluted'){
        const flutes = Math.max(4, Math.round(fw/1.6));
        for(let k=0;k<flutes;k++){
          const fx = cx - fw/2 + (k+0.5)*fw/flutes;
          const fl = cyl(0.55, 0.55, bodyH - 2, M.cab, 10); at(fl, fx, baseY + bodyH/2, cabD/2 + 0.2); g.add(fl);
        }
      } else if(aes.cab.front === 'shaker'){
        const fr = plate(fw, bodyH - 1.6, 0.7, M.cab); at(fr, cx, baseY + bodyH/2, cabD/2 + 0.35); g.add(fr);
        const pn = plate(fw - 5, bodyH - 6.6, 0.4, M.cab); at(pn, cx, baseY + bodyH/2, cabD/2 + 0.1); g.add(pn);
      } else {
        const fr = plate(fw, bodyH - 1.6, 0.7, M.cab); at(fr, cx, baseY + bodyH/2, cabD/2 + 0.35); g.add(fr);
      }
      if(aes.cab.handle === 'bar'){
        const h = cyl(0.3, 0.3, Math.min(fw - 6, 12), M.metal, 12); h.rotation.z = Math.PI/2;
        at(h, cx, baseY + bodyH - 3.5, cabD/2 + 1.3); g.add(h);
      } else if(aes.cab.handle === 'knob'){
        const k = new THREE.Mesh(new THREE.SphereGeometry(0.75, 14, 12), M.metal);
        at(k, cx, baseY + bodyH/2, cabD/2 + 1.2); g.add(k);
      }
    }
  }

  /* counter with the basin cut into it */
  const vessel = aes.basin === 'vessel';
  const bx = Math.min(w*0.28, 10.5), bz = Math.min((d-5)/2, 7.2);
  if(style !== 'floating-timber' || vessel){
    const topShape = roundRectShape(w, d, style==='floating-timber'?0.7:0.8);
    if(!vessel){ const hole = new THREE.Path(); hole.absellipse(0, 0, bx, bz, 0, Math.PI*2, true, 0); topShape.holes.push(hole); }
    const top = new THREE.Mesh(extrudeUp(topShape, 1.7, 0.2), M.top);
    top.castShadow = true; top.receiveShadow = true; at(top, 0, style==='floating-timber'? topY : topY - 1.7, 0); g.add(top);
  }
  if(vessel){
    const b = bowlLathe(5.6, bx, M.porc); b.scale.set(1, 1, bz/bx);
    at(b, 0, topY + 6.2, 0); g.add(b);
    const rim = new THREE.Mesh(extrudeUp(ringShape(bx, bx, 0.7), 0.7, 0.15), M.porc); rim.scale.set(1,1,bz/bx);
    at(rim, 0, topY + 6.2, 0); g.add(rim);
  } else {
    const b = bowlLathe(5.2, bx - 0.3, M.porc); b.scale.set(1, 1, bz/bx);
    at(b, 0, topY, 0); g.add(b);
    const drain = cyl(0.9, 0.9, 0.3, M.metal, 16); at(drain, 0, topY - 5.1, 0); g.add(drain);
  }

  /* tap */
  const fy = vessel ? topY + 2 : topY;
  const bz0 = -d/2 + 3.2;
  const spoutY = fy + (vessel ? 13 : 9);
  g.add(tubeThrough([[0,fy,bz0],[0,fy+4,bz0],[0,spoutY,bz0+0.4],[0,spoutY+0.6,bz0+2.6],[0,spoutY-0.4,bz0+5.2],[0,spoutY-2.2,bz0+5.6]], 0.62, M.metal, 30));
  const lever = cyl(0.34, 0.34, 3.4, M.metal, 12); lever.rotation.x = -0.5;
  at(lever, 0, spoutY + 1.4, bz0 - 0.9); g.add(lever);
  const base = cyl(1.3, 1.5, 0.7, M.metal, 18); at(base, 0, fy, bz0); g.add(base);
  return g;
}

/* ---------------- shower ---------------- */
function buildShower(aes, M, w, d, open){
  const g = new THREE.Group();
  const GH = 76, trayH = 2.8;
  const tray = new THREE.Mesh(extrudeUp(roundRectShape(w, d, 1.2), trayH, 0.4), M.porcSoft);
  tray.receiveShadow = true; g.add(tray);
  const inner = new THREE.Mesh(extrudeUp(roundRectShape(w-2.4, d-2.4, 1), 0.35, 0.1), M.porc);
  at(inner, 0, trayH - 0.3, 0); g.add(inner);
  const drain = plate(Math.min(w-8, 20), 0.36, 1.8, M.metal); at(drain, 0, trayH + 0.06, 0); g.add(drain);

  const post = (x,z) => { const p = plate(0.9, GH, 0.9, M.metal); at(p, x, trayH, z); p.position.y = trayH + GH/2; g.add(p); };
  const panel = (wd, x, z, ry) => {
    const pl = plate(wd, GH, 0.42, M.glass);
    at(pl, x, trayH + GH/2, z); pl.rotation.y = ry || 0; g.add(pl);
    const topBar = plate(wd, 0.7, 0.9, M.metal); at(topBar, x, trayH + GH, z); topBar.rotation.y = ry || 0; g.add(topBar);
  };
  if(open.front){
    panel(w, 0, d/2 - 0.4);
    const hx = w/2 - 5;
    const hb = cyl(0.42, 0.42, 9, M.metal, 12); at(hb, hx, trayH + 42, d/2 + 0.6); g.add(hb);
    for(const dy of [-4.2, 4.2]){ const sp = cyl(0.38,0.38,1.6,M.metal,10); sp.rotation.x = Math.PI/2; at(sp, hx, trayH + 42 + dy, d/2 + 0.1); g.add(sp); }
  }
  if(open.left)  panel(d, -w/2 + 0.4, 0, Math.PI/2);
  if(open.right) panel(d,  w/2 - 0.4, 0, Math.PI/2);
  if(open.front && open.left)  post(-w/2 + 0.5, d/2 - 0.5);
  if(open.front && open.right) post( w/2 - 0.5, d/2 - 0.5);

  /* fittings on the wall side */
  const backZ = -d/2 + 0.5;
  if(aes.head === 'column'){
    const col = boxR(4.6, 58, 2.2, 0.6, M.metalDark, 0.2); at(col, -w/2 + 9, 24, backZ + 1.1); g.add(col);
    const arm = plate(2, 2, 9, M.metalDark); at(arm, -w/2 + 9, 80, backZ + 5.4); g.add(arm);
    const head = boxR(9, 1.2, 9, 0.6, M.metalDark, 0.15); at(head, -w/2 + 9, 79.2, backZ + 10.5); g.add(head);
    const face = plate(8, 0.3, 8, M.dark); at(face, -w/2 + 9, 79.1, backZ + 10.5); g.add(face);
    const hs = cyl(1.1, 0.7, 4.2, M.metalDark, 14); hs.rotation.x = 0.5; at(hs, -w/2 + 9, 48, backZ + 3.4); g.add(hs);
  } else {
    const arm = cyl(0.55, 0.55, 12, M.metal, 14); arm.rotation.x = Math.PI/2;
    at(arm, -w/2 + Math.min(w/2, 12), 84, backZ + 6); g.add(arm);
    const hx = -w/2 + Math.min(w/2, 12);
    const head = cyl(5.2, 5.2, 1.1, M.metal, 30); at(head, hx, 83.4, backZ + 12); g.add(head);
    const face = cyl(4.6, 4.6, 0.3, M.dark, 30); at(face, hx, 82.8, backZ + 12); g.add(face);
    const rail = cyl(0.42, 0.42, 26, M.metal, 12); at(rail, hx + (w > 40 ? 16 : 9), 52, backZ + 1.4); g.add(rail);
    const hs = cyl(1.2, 0.8, 4.6, M.metal, 14); hs.rotation.x = 0.45; at(hs, hx + (w > 40 ? 16 : 9), 56, backZ + 3.2); g.add(hs);
  }
  const valve = boxR(5.4, 7.6, 1.4, 0.8, M.metal, 0.25); at(valve, 0, 42, backZ + 0.7); g.add(valve);
  const lev = cyl(0.42, 0.42, 3.2, M.metal, 12); lev.rotation.z = Math.PI/2; at(lev, 1.6, 45.8, backZ + 2.2); g.add(lev);
  return g;
}

/* ---------------- bath ---------------- */
function buildBath(aes, M, w, d){
  const g = new THREE.Group();
  const H = 21, t = 5.5;
  const shell = roundRectShape(w, d, 4.5);
  shell.holes.push(roundRectPath(w - t, d - t, 5));
  const walls = new THREE.Mesh(extrudeUp(shell, H, 0.7), M.porcSoft);
  walls.castShadow = true; walls.receiveShadow = true; g.add(walls);
  const floorB = new THREE.Mesh(extrudeUp(roundRectShape(w - t, d - t, 5), 3.2, 0.5), M.porc);
  g.add(floorB);
  const water = new THREE.Mesh(extrudeUp(roundRectShape(w - t - 1.5, d - t - 1.5, 5), 0.2), M.glass);
  at(water, 0, 3.4, 0); g.add(water);
  const drain = cyl(1, 1, 0.3, M.metal, 16); at(drain, -w/2 + 9, 3.4, 0); g.add(drain);
  g.add(tubeThrough([[-w/2+7, H, -d/2+3],[-w/2+7, H+7, -d/2+3],[-w/2+7, H+9, -d/2+5.5],[-w/2+7, H+8, -d/2+9]], 0.6, M.metal, 24));
  const lev = cyl(0.34,0.34,3,M.metal,12); lev.rotation.z = Math.PI/2; at(lev, -w/2+10.6, H+5, -d/2+3); g.add(lev);
  return g;
}

/* ---------------- storage ---------------- */
function buildStorage(aes, M, w, d){
  const g = new THREE.Group();
  const H = 70;
  const body = boxR(w, H, d, 0.6, M.cab, 0.2); at(body, 0, 2.5, 0); g.add(body);
  const kick = plate(w - 2, 2.5, d - 2, M.dark); at(kick, 0, 1.25, 0); g.add(kick);
  const n = H > 60 ? 2 : 1;
  for(let i=0;i<n;i++){
    const hh = (H - 2)/n - 1;
    const dr = plate(w - 1.6, hh, 0.7, M.cab); at(dr, 0, 3.5 + i*(hh + 1) + hh/2, d/2 + 0.35); g.add(dr);
    if(aes.cab.handle === 'knob'){ const k = new THREE.Mesh(new THREE.SphereGeometry(0.75,14,12), M.metal); at(k, w/2 - 3, 3.5 + i*(hh+1) + hh/2, d/2 + 1.2); g.add(k); }
    else { const b = cyl(0.3,0.3,Math.min(w-6,10),M.metal,12); b.rotation.z = Math.PI/2; at(b, 0, 3.5 + i*(hh+1) + hh - 3, d/2 + 1.3); g.add(b); }
  }
  return g;
}

/* ---------------- mirror ---------------- */
function buildMirror(aes, M, w, h, shape){
  const g = new THREE.Group();
  const glassMat = M.mirror;
  if(shape === 'round'){
    const r = Math.min(w,h)/2;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r - 0.8, 54), glassMat); at(disc, 0, 0, 0.5); g.add(disc);
    if(aes.mirror.frame !== null && aes.mirror.frame !== undefined){
      const fr = new THREE.Mesh(new THREE.TorusGeometry(r - 0.5, 0.75, 12, 56),
        new THREE.MeshStandardMaterial({color:aes.mirror.frame, roughness:.35, metalness:.85}));
      at(fr, 0, 0, 0.5); g.add(fr);
    }
    const back = new THREE.Mesh(new THREE.CircleGeometry(r, 48), M.dark); at(back, 0, 0, 0.1); g.add(back);
  } else if(shape === 'arch'){
    const s = new THREE.Shape();
    const hw = w/2, straight = h - hw;
    s.moveTo(-hw, -h/2); s.lineTo(hw, -h/2); s.lineTo(hw, -h/2 + straight);
    s.absarc(0, -h/2 + straight, hw, 0, Math.PI, false); s.lineTo(-hw, -h/2);
    const fr = new THREE.Mesh(extrudeFlat(s, 1.1), new THREE.MeshStandardMaterial({color:aes.mirror.frame, roughness:.32, metalness:.85}));
    g.add(fr);
    const s2 = new THREE.Shape();
    const hw2 = hw - 1.1, st2 = straight - 0.6;
    s2.moveTo(-hw2, -h/2 + 1.1); s2.lineTo(hw2, -h/2 + 1.1); s2.lineTo(hw2, -h/2 + st2);
    s2.absarc(0, -h/2 + st2, hw2, 0, Math.PI, false); s2.lineTo(-hw2, -h/2 + 1.1);
    const gl = new THREE.Mesh(extrudeFlat(s2, 0.4), glassMat); at(gl, 0, 0, 1.0); g.add(gl);
  } else {
    if(aes.mirror.frame){
      const fr = plate(w, h, 1.1, new THREE.MeshStandardMaterial({color:aes.mirror.frame, roughness:.45, metalness:.35}));
      at(fr, 0, 0, 0.55); g.add(fr);
      const gl = plate(w - 2.4, h - 2.4, 0.4, glassMat); at(gl, 0, 0, 1.25); g.add(gl);
    } else {
      const gl = plate(w, h, 0.7, glassMat); at(gl, 0, 0, 0.6); g.add(gl);
    }
  }
  if(aes.mirror.backlit){
    const halo = plate(w + 3, h + 3, 0.2, M.glow); at(halo, 0, 0, 0.15); g.add(halo);
  }
  return g;
}

/* ---------------- small things ---------------- */
function buildAccessory(a, aes, M){
  const g = new THREE.Group();
  switch(a.kind){
    case 'towel': {
      const bar = cyl(0.42, 0.42, a.w, M.metal, 14); bar.rotation.z = Math.PI/2; at(bar, 0, 0, 2.4); g.add(bar);
      for(const x of [-a.w/2 + 0.6, a.w/2 - 0.6]){
        const p = cyl(0.55, 0.7, 2.4, M.metal, 12); p.rotation.x = Math.PI/2; at(p, x, 0, 1.2); g.add(p);
      }
      for(const x of [-a.w*0.24, a.w*0.24]){
        const t = boxR(Math.min(a.w*0.42, 11), 19, 1.5, 0.6, M.towel, 0.2);
        at(t, x, -19, 2.4); g.add(t);
      }
      break;
    }
    case 'paper': {
      const arm = cyl(0.4,0.4,3.4,M.metal,12); arm.rotation.x = Math.PI/2; at(arm,0,0,1.7); g.add(arm);
      const roll = cyl(2.2,2.2,4.4,M.porcSoft,20); roll.rotation.z = Math.PI/2; at(roll,0,-0.4,3.4); g.add(roll);
      break;
    }
    case 'paperstand': {
      const base = cyl(3.2,3.6,0.7,M.metal,20); at(base,0,0.35,0); g.add(base);
      const rod = cyl(0.35,0.35,20,M.metal,10); at(rod,0,10,0); g.add(rod);
      const roll = cyl(2.2,2.2,4.4,M.porcSoft,20); roll.rotation.z = Math.PI/2; at(roll,0,17,0); g.add(roll);
      break;
    }
    case 'hook': { const b = cyl(0.8,0.8,1,M.metal,14); b.rotation.x = Math.PI/2; at(b,0,0,0.5); g.add(b);
      const h = tubeThrough([[0,0,1],[0,-1.4,2.4],[0,-0.6,3.2]],0.35,M.metal,14); g.add(h); break; }
    case 'sconce': {
      const b = cyl(1.5,1.5,0.9,M.metal,18); b.rotation.x = Math.PI/2; at(b,0,0,0.45); g.add(b);
      const tube = cyl(1.1,1.1,a.h,M.glow,18); at(tube,0,0,2.2); g.add(tube); break;
    }
    case 'niche': {
      const box = plate(a.w, a.h, 3.2, M.feat); at(box, 0, 0, -1.4); g.add(box);
      const sh = plate(a.w - 1, 0.6, 3, M.top); at(sh, 0, -a.h/2 + 0.5, -1.3); g.add(sh);
      const b1 = cyl(0.9,0.9,3.4,M.porcSoft,14); at(b1,-2.6,-a.h/2+2.2,-1.2); g.add(b1);
      const b2 = plate(2,4.4,1.4,M.textile); at(b2,1.8,-a.h/2+2.6,-1.2); g.add(b2); break;
    }
    case 'bathfill': { const b = cyl(1.2,1.2,1,M.metal,16); b.rotation.x = Math.PI/2; at(b,0,0,0.5); g.add(b);
      g.add(tubeThrough([[0,0,1],[0,0.6,3.4],[0,-1.2,5.4]],0.55,M.metal,16)); break; }
    case 'drain': { const d = plate(a.w, 0.4, 2.2, M.metal); at(d, 0, 0.2, 0); g.add(d); break; }
    case 'mat': { const m = boxR(a.w, 1.1, a.h, 2, M.textile, 0.3); g.add(m); break; }
    case 'bin': { const b = cyl(a.w/2 - 0.6, a.w/2 - 1.4, 12, M.metalDark, 24); at(b, 0, 6, 0); g.add(b);
      const l = cyl(a.w/2 - 0.4, a.w/2 - 0.4, 0.8, M.metal, 24); at(l, 0, 12.4, 0); g.add(l); break; }
    case 'plant': {
      const pot = cyl(a.w/2 - 1.5, a.w/2 - 3, 9, M.pot, 22); at(pot, 0, 4.5, 0); g.add(pot);
      const soil = cyl(a.w/2 - 1.8, a.w/2 - 1.8, 0.4, M.dark, 20); at(soil, 0, 9, 0); g.add(soil);
      for(let i=0;i<9;i++){
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(3.4, 12, 10), M.leaf);
        leaf.scale.set(0.38, 1.5, 0.9);
        leaf.position.set(Math.cos(i*0.7)*2.6, 13 + (i%3)*4.2, Math.sin(i*0.7)*2.6);
        leaf.rotation.z = Math.cos(i)*0.5; leaf.rotation.x = Math.sin(i)*0.4;
        leaf.castShadow = true; g.add(leaf);
      }
      break;
    }
    case 'stool': {
      const top = boxR(a.w, 1.6, a.h, 1, M.wood, 0.3); at(top, 0, 15, 0); g.add(top);
      for(const x of [-a.w/2+2, a.w/2-2]) for(const z of [-a.h/2+2, a.h/2-2]){
        const l = cyl(0.7,0.55,15,M.wood,12); at(l, x, 7.5, z); g.add(l);
      }
      const t = boxR(a.w*0.5, 8, 1.2, 0.5, M.towel, 0.2); at(t, 0, 16.6, 0); g.add(t); break;
    }
    case 'fan': {
      const f = plate(a.w, 1.2, a.h, M.top); at(f, 0, -0.6, 0); g.add(f);
      const grill = plate(a.w - 2.4, 0.4, a.h - 2.4, M.dark); at(grill, 0, -1.3, 0); g.add(grill); break;
    }
    case 'tray': {
      const tr = boxR(9, 0.5, 5, 0.6, M.top, 0.15); g.add(tr);
      const soap = boxR(2.2, 5.2, 2.2, 0.9, M.porc, 0.3); at(soap, -2.4, 0.5, 0); g.add(soap);
      const sp = cyl(0.5,0.5,1.6,M.metal,12); at(sp, -2.4, 6.4, 0); g.add(sp);
      const tum = cyl(1.5,1.3,3.6,M.porcSoft,18); at(tum, 1.8, 2.3, 0); g.add(tum); break;
    }
  }
  return g;
}

