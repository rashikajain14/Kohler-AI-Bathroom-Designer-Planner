/* ---- e4a_three.js ---- */

/* ==================================================================
   3D ROOM — every mesh is generated from the solved layout.
   World units are inches, matching the plan exactly.
   ================================================================== */
const V = { ok:false, scene:null, camera:null, renderer:null, root:null, walls:[], pickable:[], ceiling:null, env:null, raf:0 };

/* ---------- deterministic noise so a room looks the same twice ---------- */
function rng(seed){ let s = seed >>> 0 || 1; return () => (s = (s*1664525 + 1013904223) >>> 0) / 4294967296; }

/* ---------- procedural tile / material canvases ---------- */
function patternCanvas(type, o, px){
  const c = document.createElement('canvas');
  c.width = c.height = px || 512;
  const g = c.getContext('2d');
  const R = rng(type.length*7919 + (o.tw|0)*131 + (o.th|0)*17 + (o.c1||'').length*53);
  const W = c.width, H = c.height;
  const grout = o.grout || '#d8d3ca';
  const fillNoise = (a) => {
    const img = g.getImageData(0,0,W,H), dd = img.data;
    for(let i=0;i<dd.length;i+=4){ const n = (R()-0.5)*a; dd[i]+=n; dd[i+1]+=n; dd[i+2]+=n; }
    g.putImageData(img,0,0);
  };
  const soft = (x,y,r,col,alpha) => {
    const grd = g.createRadialGradient(x,y,0,x,y,r);
    grd.addColorStop(0, col); grd.addColorStop(1,'rgba(0,0,0,0)');
    g.globalAlpha = alpha; g.fillStyle = grd; g.fillRect(x-r,y-r,r*2,r*2); g.globalAlpha = 1;
  };

  g.fillStyle = o.c1; g.fillRect(0,0,W,H);

  if(type === 'largeformat' || type === 'marble' || type === 'stone'){
    const gl = g.createLinearGradient(0,0,W,H);
    gl.addColorStop(0, o.c1); gl.addColorStop(.5, o.c2); gl.addColorStop(1, o.c1);
    g.fillStyle = gl; g.fillRect(0,0,W,H);
    if(type === 'marble'){
      for(let i=0;i<9;i++){
        g.beginPath();
        let x = R()*W, y = -10;
        g.moveTo(x,y);
        while(y < H+10){ x += (R()-0.5)*W*0.28; y += H*0.12 + R()*H*0.1; g.quadraticCurveTo(x+(R()-0.5)*40, y-20, x, y); }
        g.strokeStyle = o.vein || '#9a9287';
        g.globalAlpha = 0.10 + R()*0.22; g.lineWidth = 0.7 + R()*3.4; g.stroke(); g.globalAlpha = 1;
      }
    }
    if(type === 'stone'){
      for(let i=0;i<40;i++) soft(R()*W, R()*H, 20+R()*70, 'rgba(0,0,0,.35)', .12);
    }
    fillNoise(type==='largeformat' ? 7 : 12);
    g.strokeStyle = grout; g.lineWidth = Math.max(2, W*0.012);
    g.strokeRect(0,0,W,H);
  }
  else if(type === 'subway' || type === 'plank'){
    /* running bond: the canvas holds two rows, the second offset by half */
    const rows = 2, rh = H/rows;
    for(let r=0;r<rows;r++){
      const off = r%2 ? -W/2 : 0;
      for(let k=-1;k<=1;k++){
        const x = off + k*W, y = r*rh;
        const tint = 0.9 + R()*0.2;
        const gl = g.createLinearGradient(x,y,x+W,y+rh);
        gl.addColorStop(0, o.c1); gl.addColorStop(1, o.c2);
        g.fillStyle = gl; g.globalAlpha = tint; g.fillRect(x+1.5, y+1.5, W-3, rh-3); g.globalAlpha = 1;
        if(type === 'subway'){ soft(x+W*0.3, y+rh*0.35, rh*0.7, 'rgba(255,255,255,.75)', .30); }
        else for(let i=0;i<7;i++){ g.strokeStyle='rgba(90,60,25,.13)'; g.lineWidth=1+R()*2;
          g.beginPath(); g.moveTo(x, y+rh*R()); g.bezierCurveTo(x+W*.3,y+rh*R(),x+W*.7,y+rh*R(),x+W,y+rh*R()); g.stroke(); }
      }
      g.fillStyle = grout; g.fillRect(0, r*rh, W, 2.5); g.fillRect(0, (r+1)*rh-2.5, W, 2.5);
      g.fillRect((r%2? W/2 : 0)-1.2, r*rh, 2.5, rh);
      g.fillRect((r%2? 0 : W)-1.2, r*rh, 2.5, rh);
    }
    fillNoise(6);
  }
  else if(type === 'slat'){
    const gapw = W*0.16;
    g.fillStyle = o.grout; g.fillRect(0,0,W,H);
    const gl = g.createLinearGradient(0,0,W-gapw,0);
    gl.addColorStop(0, o.c2); gl.addColorStop(.35, o.c1); gl.addColorStop(1, o.c2);
    g.fillStyle = gl; g.fillRect(0,0,W-gapw,H);
    for(let i=0;i<26;i++){
      g.strokeStyle = 'rgba(70,45,20,.16)'; g.lineWidth = 0.8 + R()*2.2;
      g.beginPath(); const x = R()*(W-gapw);
      g.moveTo(x, 0); g.bezierCurveTo(x+(R()-.5)*14, H*.35, x+(R()-.5)*14, H*.7, x+(R()-.5)*8, H); g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,.30)'; g.fillRect(W-gapw, 0, gapw*0.55, H);
    fillNoise(5);
  }
  else if(type === 'plaster' || type === 'microcement' || type === 'concrete'){
    for(let i=0;i<120;i++) soft(R()*W, R()*H, 30+R()*130, R()>0.5? 'rgba(255,255,255,.5)':'rgba(0,0,0,.35)', type==='concrete'? .10 : .06);
    if(type === 'concrete'){
      g.strokeStyle='rgba(0,0,0,.14)'; g.lineWidth=2;
      g.beginPath(); g.moveTo(0,H*0.5); g.lineTo(W,H*0.5); g.stroke();
      for(let i=0;i<4;i++){ g.beginPath(); g.arc(W*0.12+ i*W*0.25, H*0.5, 4, 0, 7); g.fillStyle='rgba(0,0,0,.2)'; g.fill(); }
    }
    fillNoise(type==='concrete'? 12 : 8);
  }
  else if(type === 'terrazzo'){
    const chips = ['#8b8578','#cfc6b4','#6f6a5f','#e6e0d2','#a99a80'];
    for(let i=0;i<620;i++){
      g.save(); g.translate(R()*W, R()*H); g.rotate(R()*6.283);
      g.fillStyle = chips[(R()*chips.length)|0]; g.globalAlpha = .55 + R()*0.4;
      const s = 3 + R()*11;
      g.beginPath(); g.moveTo(-s,-s*0.6); g.lineTo(s*0.8,-s*0.5); g.lineTo(s*0.6,s*0.7); g.lineTo(-s*0.7,s*0.5); g.closePath(); g.fill();
      g.restore();
    }
    g.globalAlpha = 1; fillNoise(6);
  }
  else if(type === 'hex'){
    const r = W/4, hx = Math.sqrt(3)*r/2;
    g.fillStyle = o.grout; g.fillRect(0,0,W,H);
    const hex = (cx,cy) => {
      g.beginPath();
      for(let i=0;i<6;i++){ const a = Math.PI/180*(60*i-90); const x=cx+Math.cos(a)*(r-1.6), y=cy+Math.sin(a)*(r-1.6); i?g.lineTo(x,y):g.moveTo(x,y); }
      g.closePath();
      const gl = g.createLinearGradient(cx-r,cy-r,cx+r,cy+r);
      gl.addColorStop(0,o.c1); gl.addColorStop(1, R()>.5?o.c2:o.c1);
      g.fillStyle = gl; g.fill();
    };
    for(let j=-1;j<6;j++) for(let i=-1;i<6;i++) hex(i*hx*2 + (j%2? hx:0), j*r*1.5);
    fillNoise(6);
  }
  return c;
}
function makeMap(type, o, blockW, blockH, sRGB){
  const t = new THREE.CanvasTexture(patternCanvas(type, o));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1/blockW, 1/blockH);          // UVs are in inches everywhere
  t.anisotropy = 8;
  if(sRGB !== false) t.encoding = THREE.sRGBEncoding;
  return t;
}

/* ---------- shared material library for one aesthetic ---------- */
function buildMaterials(aes){
  const M = {};
  const wallMap = makeMap(aes.wall.type, aes.wall, aes.wall.tw, aes.wall.th);
  const featMap = makeMap(aes.feat.type, aes.feat, aes.feat.tw, aes.feat.th);
  const floorMap= makeMap(aes.floor.type, aes.floor, aes.floor.tw, aes.floor.th);
  M.wall  = new THREE.MeshStandardMaterial({map:wallMap, roughness:.62, metalness:.02});
  M.feat  = new THREE.MeshStandardMaterial({map:featMap, roughness:aes.feat.type==='slat'?.72:.55, metalness:.02});
  M.floor = new THREE.MeshStandardMaterial({map:floorMap, roughness:aes.floor.type==='plank'?.55:.38, metalness:.03});
  M.ceil  = new THREE.MeshStandardMaterial({color:0xF3F1EC, roughness:.95});
  M.metal = new THREE.MeshStandardMaterial({color:aes.metal.c, roughness:aes.metal.r, metalness:1});
  M.metalDark = new THREE.MeshStandardMaterial({color:aes.metal.c, roughness:Math.min(1,aes.metal.r+.2), metalness:.9});
  M.porc  = new THREE.MeshStandardMaterial({color:aes.porcelain, roughness:.12, metalness:.02});
  M.porcSoft = new THREE.MeshStandardMaterial({color:aes.porcelain, roughness:.3, metalness:.02});
  M.cab   = new THREE.MeshStandardMaterial({color:aes.cab.c, roughness:aes.cab.style==='steel'?.5:.45, metalness:aes.cab.style==='steel'?.6:.05});
  M.top   = new THREE.MeshStandardMaterial({color:aes.cab.top, roughness:.3, metalness:.04});
  M.glass = new THREE.MeshStandardMaterial({color:aes.glass.c, roughness:.04, metalness:.0, transparent:true, opacity:aes.glass.op+0.06, side:THREE.DoubleSide});
  M.mirror= new THREE.MeshStandardMaterial({color:0xE9EEF2, roughness:.02, metalness:1});
  M.glow  = new THREE.MeshBasicMaterial({color:aes.light.c});
  M.towel = new THREE.MeshStandardMaterial({color:aes.towel, roughness:.95});
  M.textile=new THREE.MeshStandardMaterial({color:aes.textile, roughness:.95});
  M.leaf  = new THREE.MeshStandardMaterial({color:aes.plant, roughness:.8});
  M.pot   = new THREE.MeshStandardMaterial({color:0xD9D2C6, roughness:.7});
  M.dark  = new THREE.MeshStandardMaterial({color:0x22262A, roughness:.6});
  M.wood  = new THREE.MeshStandardMaterial({color:aes.cab.c, roughness:.5});
  M.seat  = new THREE.MeshStandardMaterial({color:aes.porcelain, roughness:.22});
  return M;
}

/* ---------- geometry helpers ---------- */
function roundRectShape(w, d, r){
  r = Math.max(0.01, Math.min(r, Math.min(w,d)/2 - 0.01));
  const s = new THREE.Shape();
  const x = -w/2, y = -d/2;
  s.moveTo(x+r, y);
  s.lineTo(x+w-r, y); s.absarc(x+w-r, y+r, r, -Math.PI/2, 0);
  s.lineTo(x+w, y+d-r); s.absarc(x+w-r, y+d-r, r, 0, Math.PI/2);
  s.lineTo(x+r, y+d);   s.absarc(x+r, y+d-r, r, Math.PI/2, Math.PI);
  s.lineTo(x, y+r);     s.absarc(x+r, y+r, r, Math.PI, Math.PI*1.5);
  return s;
}
function ellipseShape(rx, ry){
  const s = new THREE.Shape(); s.absellipse(0,0,rx,ry,0,Math.PI*2,false,0); return s;
}
function extrudeUp(shape, h, bev, seg){
  const g = new THREE.ExtrudeGeometry(shape, {depth:h, bevelEnabled: !!bev, bevelThickness: bev||0,
    bevelSize: bev||0, bevelSegments: 2, curveSegments: seg||18, steps:1});
  g.rotateX(-Math.PI/2);
  return g;
}
/* a rounded box: w across, h tall, d deep, centred on x/z, base at y=0 */
function boxR(w,h,d,r,mat,bev){
  const g = extrudeUp(roundRectShape(w,d,r), h, bev===undefined?Math.min(0.35,r/2):bev);
  const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m;
}
function plate(w,h,d,mat){
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
  m.castShadow = true; m.receiveShadow = true; return m;
}
function cyl(rt,rb,h,mat,seg){
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg||20), mat);
  m.castShadow = true; return m;
}
function tubeThrough(pts, r, mat, seg){
  const curve = new THREE.CatmullRomCurve3(pts.map(p=>new THREE.Vector3(p[0],p[1],p[2])));
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, seg||40, r, 12, false), mat);
  m.castShadow = true; return m;
}
function at(obj, x, y, z){ obj.position.set(x,y,z); return obj; }

/* ---------- environment for reflections ---------- */
function makeEnv(renderer, aes){
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const gl = g.createLinearGradient(0,0,0,128);
  gl.addColorStop(0, '#ffffff'); gl.addColorStop(.45, '#e9e6e0'); gl.addColorStop(.52, '#cdc8c0'); gl.addColorStop(1, '#6b6862');
  g.fillStyle = gl; g.fillRect(0,0,256,128);
  g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(40,14,36,26); g.fillRect(150,10,30,30);
  const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.encoding = THREE.sRGBEncoding;
  const rt = new THREE.WebGLCubeRenderTarget(128);
  rt.fromEquirectangularTexture(renderer, t);
  return rt.texture;
}

/* ---------- camera controls ---------- */
function makeControls(camera, dom, onChange){
  const st = { az: -0.7, pol: 1.05, dist: 220, tx:0, ty:40, tz:0,
               az2:-0.7, pol2:1.05, dist2:220, tx2:0, ty2:40, tz2:0, drag:null };
  const clampP = p => Math.max(0.12, Math.min(Math.PI/2 - 0.02, p));
  const apply = () => {
    const s = Math.sin(st.pol), c = Math.cos(st.pol);
    camera.position.set(st.tx + st.dist*s*Math.sin(st.az), st.ty + st.dist*c, st.tz + st.dist*s*Math.cos(st.az));
    camera.lookAt(st.tx, st.ty, st.tz);
  };
  const tick = () => {
    const k = 0.16;
    let moved = false;
    for(const key of ['az','pol','dist','tx','ty','tz']){
      const d = st[key+'2'] - st[key];
      if(Math.abs(d) > 1e-4){ st[key] += d*k; moved = true; } else st[key] = st[key+'2'];
    }
    if(moved){ apply(); onChange && onChange(); }
    return moved;
  };
  let px=0, py=0;
  const down = e => {
    if(e.button === 1) return;
    dom.setPointerCapture && dom.setPointerCapture(e.pointerId);
    st.drag = (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
    px = e.clientX; py = e.clientY;
  };
  const move = e => {
    if(!st.drag) return;
    const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
    if(st.drag === 'orbit'){ st.az2 -= dx*0.008; st.pol2 = clampP(st.pol2 - dy*0.006); }
    else {
      const s = st.dist*0.0016;
      st.tx2 -= (dx*Math.cos(st.az2) - 0)*s; st.tz2 += dx*Math.sin(st.az2)*s;
      st.ty2 = Math.max(6, st.ty2 + dy*s);
    }
  };
  const up = () => { st.drag = null; };
  dom.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  dom.addEventListener('contextmenu', e => e.preventDefault());
  dom.addEventListener('wheel', e => { e.preventDefault(); st.dist2 = Math.max(26, Math.min(900, st.dist2 * (1 + Math.sign(e.deltaY)*0.11))); }, {passive:false});
  let pinch = 0;
  dom.addEventListener('touchstart', e => { if(e.touches.length===2) pinch = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY); }, {passive:true});
  dom.addEventListener('touchmove', e => {
    if(e.touches.length===2 && pinch){
      const d = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
      st.dist2 = Math.max(26, Math.min(900, st.dist2 * (pinch/d))); pinch = d;
    }
  }, {passive:true});
  apply();
  return { st, tick, apply,
    goto(o, snap){
      for(const k of ['az','pol','dist','tx','ty','tz']) if(o[k] !== undefined) st[k+'2'] = o[k];
      st.pol2 = clampP(st.pol2);
      if(snap) for(const k of ['az','pol','dist','tx','ty','tz']) st[k] = st[k+'2'];
      apply();
    }};
}

