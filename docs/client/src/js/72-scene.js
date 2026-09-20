/* ---- e4c_scene.js ---- */

/* ==================================================================
   THE 3D ROOM
   Built from exactly the same layout object the floor plan uses, so
   the two views cannot drift apart. World unit = 1 inch.
   worldX = x - L/2, worldZ = W/2 - y, worldY = height.
   ================================================================== */

const THREE_SRC = [
  '/vendor/three.min.js'
];
function loadThree(cb){
  if(window.THREE) return cb(true);
  let i = 0;
  const next = () => {
    if(i >= THREE_SRC.length) return cb(false);
    const s = document.createElement('script');
    s.src = THREE_SRC[i++];
    s.onload = () => cb(!!window.THREE);
    s.onerror = next;
    document.head.appendChild(s);
  };
  next();
}

/* ---------- world mapping ---------- */
let WX = x => x, WZ = y => y;
function setMapping(R){ WX = x => x - R.L/2; WZ = y => R.W/2 - y; }

/* wall-local x for a span starting at t, width w */
function localX(wall, along, t, w){
  const flip = (wall === 'front' || wall === 'right');
  return flip ? (along - t - w/2) - along/2 : (t + w/2) - along/2;
}
const WALL_POSE = {
  back:  (R) => ({p:[0,0,-R.W/2],  yaw:0,             n:[0,0,1]}),
  front: (R) => ({p:[0,0, R.W/2],  yaw:Math.PI,       n:[0,0,-1]}),
  left:  (R) => ({p:[-R.L/2,0,0],  yaw:Math.PI/2,     n:[1,0,0]}),
  right: (R) => ({p:[ R.L/2,0,0],  yaw:-Math.PI/2,    n:[-1,0,0]})
};

/* a rectangle in wall-local coordinates, as a Path for a hole */
function holePath(x0, y0, w, h){
  const p = new THREE.Path();
  p.moveTo(x0, y0); p.lineTo(x0+w, y0); p.lineTo(x0+w, y0+h); p.lineTo(x0, y0+h); p.lineTo(x0, y0);
  return p;
}

/* ================= renderer bootstrap ================= */
function initThree(){
  const host = document.getElementById('viewport');
  if(!host) return;
  V.renderer = new THREE.WebGLRenderer({antialias:true, alpha:false, powerPreference:'high-performance'});
  V.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  V.renderer.setSize(host.clientWidth, host.clientHeight, false);
  V.renderer.outputEncoding = THREE.sRGBEncoding;
  V.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  V.renderer.toneMappingExposure = 1.0;
  V.renderer.shadowMap.enabled = true;
  V.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(V.renderer.domElement);

  V.scene = new THREE.Scene();
  V.scene.background = new THREE.Color(0x101317);
  V.camera = new THREE.PerspectiveCamera(42, host.clientWidth/Math.max(1,host.clientHeight), 1, 3000);
  V.env = makeEnv(V.renderer, AES[STATE.aesthetic]);
  V.scene.environment = V.env;
  V.controls = makeControls(V.camera, V.renderer.domElement, () => { V.dirty = true; cullWalls(); });
  V.ok = true;
  V.dirty = true;

  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if(!w || !h) return;
    V.renderer.setSize(w, h, false);
    V.camera.aspect = w/h; V.camera.updateProjectionMatrix();
    V.dirty = true;
  };
  if(window.ResizeObserver) new ResizeObserver(resize).observe(host);
  window.addEventListener('resize', resize);

  const loop = () => {
    V.raf = requestAnimationFrame(loop);
    const live = document.getElementById('page-designer').classList.contains('live');
    if(!live) return;
    const moved = V.controls.tick();
    if(moved || V.dirty){ V.dirty = false; V.renderer.render(V.scene, V.camera); }
  };
  loop();
}

/* ================= dispose ================= */
function disposeTree(obj){
  obj.traverse(o => {
    if(o.geometry) o.geometry.dispose();
    if(o.material){
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for(const m of ms){
        for(const k of ['map','normalMap','roughnessMap','alphaMap']) if(m[k] && m[k].dispose) m[k].dispose();
        m.dispose();
      }
    }
  });
}

/* ================= build the room ================= */
function buildRoom(){
  if(!V.ok) return;
  const L = STATE.layout; if(!L) return;
  const R = L.room, aes = AES[STATE.aesthetic];
  setMapping(R);

  if(V.root){ V.scene.remove(V.root); disposeTree(V.root); }
  const root = new THREE.Group();
  V.root = root; V.scene.add(root);
  V.walls = [];
  V.pickable = [];

  const M = buildMaterials(aes);
  V.M = M;
  V.renderer.toneMappingExposure = aes.exposure || 1;

  /* ---------- floor ---------- */
  const fShape = new THREE.Shape();
  fShape.moveTo(-R.L/2, -R.W/2); fShape.lineTo(R.L/2, -R.W/2);
  fShape.lineTo(R.L/2, R.W/2);   fShape.lineTo(-R.L/2, R.W/2); fShape.lineTo(-R.L/2, -R.W/2);
  const fGeo = new THREE.ShapeGeometry(fShape);
  fGeo.rotateX(-Math.PI/2);
  const floor = new THREE.Mesh(fGeo, M.floor);
  floor.receiveShadow = true; root.add(floor);

  /* skirting-free base shadow catcher line: a thin dark reveal at the wall foot */
  const ceilGeo = new THREE.ShapeGeometry(fShape);
  ceilGeo.rotateX(Math.PI/2);
  const ceil = new THREE.Mesh(ceilGeo, M.ceil);
  ceil.position.y = R.H;
  ceil.receiveShadow = false;
  root.add(ceil); V.ceiling = ceil;

  /* ---------- walls, with the door and the window cut out ---------- */
  const DOOR_H = 80;
  for(const wallId of WALLS){
    const wi = wallInfo(wallId, R), pose = WALL_POSE[wallId](R);
    const sh = new THREE.Shape();
    sh.moveTo(-wi.along/2, 0); sh.lineTo(wi.along/2, 0);
    sh.lineTo(wi.along/2, R.H); sh.lineTo(-wi.along/2, R.H); sh.lineTo(-wi.along/2, 0);

    if(L.door.wall === wallId){
      const cx = localX(wallId, wi.along, L.door.t, L.door.w);
      sh.holes.push(holePath(cx - L.door.w/2, 0, L.door.w, DOOR_H));
    }
    if(L.window && L.window.wall === wallId){
      const cx = localX(wallId, wi.along, L.window.t, L.window.w);
      sh.holes.push(holePath(cx - L.window.w/2, L.window.z, L.window.w, L.window.h));
    }
    const geo = new THREE.ShapeGeometry(sh);
    const mat = (wallId === 'back') ? M.feat : M.wall;
    const grp = new THREE.Group();
    grp.position.set(pose.p[0], pose.p[1], pose.p[2]);
    grp.rotation.y = pose.yaw;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    grp.add(mesh);

    /* reveal thickness so the wall does not read as paper from the side */
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(wi.along, R.H), M.wall);
    edge.position.z = -3; edge.rotation.y = Math.PI;
    edge.position.x = 0; edge.position.y = R.H/2;
    grp.add(edge);

    grp.userData = { wallId, n: pose.n, centre: new THREE.Vector3(pose.p[0], R.H/2, pose.p[2]) };
    root.add(grp); V.walls.push(grp);

    if(L.door.wall === wallId) addDoor(grp, L, R, wi, M, DOOR_H);
    if(L.window && L.window.wall === wallId) addWindow(grp, L, R, wi, M);
  }

  /* ---------- fixtures ---------- */
  for(const it of L.items){
    let g = null;
    if(it.kind === 'toilet')      g = buildToilet(aes, M, it.w, it.d);
    else if(it.kind === 'vanity') g = buildVanity(aes, M, it.w, it.d);
    else if(it.kind === 'shower') g = buildShower(aes, M, it.w, it.d, it.openSides || {front:true});
    else if(it.kind === 'bath')   g = buildBath(aes, M, it.w, it.d);
    else if(it.kind === 'storage')g = buildStorage(aes, M, it.w, it.d);
    if(!g) continue;
    g.position.set(WX(it.cx), 0, WZ(it.cy));
    g.rotation.y = it.yaw;
    g.traverse(o => { if(o.isMesh){ o.castShadow = o.castShadow !== false; o.receiveShadow = true; } });
    root.add(g);
    it._obj = g;
    g.userData.pick = {type:'fixture', uid:it.uid};
    V.pickable.push(g);
  }

  /* ---------- accessories ---------- */
  for(const a of L.acc){
    let g = null;
    if(a.kind === 'mirror') g = buildMirror(aes, M, a.w, a.h, a.shape);
    else g = buildAccessory(a, aes, M);
    if(!g || !g.children.length) continue;

    a._obj = g; a._holder = null;
    if(a.mount === 'wall'){
      const wi = wallInfo(a.wall, R), pose = WALL_POSE[a.wall](R);
      const lx = localX(a.wall, wi.along, a.t, a.w);
      const hold = new THREE.Group();
      hold.position.set(pose.p[0], 0, pose.p[2]);
      hold.rotation.y = pose.yaw;
      g.position.set(lx, a.kind === 'mirror' ? a.z + a.h/2 : a.z, 0.2);
      hold.add(g); root.add(hold);
      a._holder = hold;
    } else if(a.mount === 'ceiling'){
      g.position.set(WX(a.cx), R.H - 0.2, WZ(a.cy));
      root.add(g);
    } else if(a.mount === 'top'){
      const owner = L.items.find(i => i.kind === a.owner);
      if(!owner) continue;
      const fwd = { back:[0,1], front:[0,-1], left:[1,0], right:[-1,0] }[owner.wall];
      g.position.set(WX(owner.cx + fwd[0]*0), a.z, WZ(owner.cy));
      g.rotation.y = owner.yaw;
      g.translateZ(owner.d/2 - 4.5);
      g.translateX(Math.min(owner.w/2 - 6, 16));
      root.add(g);
    } else {
      g.position.set(WX(a.cx), 0, WZ(a.cy));
      g.rotation.y = a.yaw || 0;
      root.add(g);
    }
    g.traverse(o => { if(o.isMesh && a.kind !== 'mat' && a.kind !== 'drain'){ o.castShadow = true; } });
    if(draggableAcc(a)){ g.userData.pick = {type:'acc', uid:a.uid}; V.pickable.push(g); }
  }

  addLighting(L, R, aes, M, root);
  cullWalls();
  V.dirty = true;
}

/* ---------- door leaf, frame and threshold ---------- */
function addDoor(grp, L, R, wi, M, H){
  const d = L.door;
  const cx = localX(d.wall, wi.along, d.t, d.w);
  const lx0 = cx - d.w/2, lx1 = cx + d.w/2;

  /* lining */
  const lin = new THREE.MeshStandardMaterial({color:0xF2EFE9, roughness:.6});
  for(const [x, w] of [[lx0 - 1.1, 2.2], [lx1 + 1.1, 2.2]]){
    const j = new THREE.Mesh(new THREE.BoxGeometry(w, H + 2.2, 4.4), lin);
    j.position.set(x, (H + 2.2)/2, -1.2); grp.add(j);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(d.w + 4.4, 2.2, 4.4), lin);
  head.position.set(cx, H + 1.1, -1.2); grp.add(head);
  /* the dark beyond, so the opening does not show the void */
  const beyond = new THREE.Mesh(new THREE.PlaneGeometry(d.w, H), new THREE.MeshBasicMaterial({color:0x1A1E22}));
  beyond.position.set(cx, H/2, -3.4); grp.add(beyond);

  /* leaf on its hinge */
  const hingeLocal = d.hinge ? lx1 : lx0;
  const dir = d.hinge ? -1 : 1;
  const hinge = new THREE.Group();
  hinge.position.set(hingeLocal, 0, d.swingOut ? -1.6 : 0.6);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(d.w - 0.5, H - 1, 1.5),
    new THREE.MeshStandardMaterial({color:AES[STATE.aesthetic].cab.c, roughness:.55, metalness:.05}));
  leaf.position.set(dir*(d.w/2), (H - 1)/2, 0);
  leaf.castShadow = true;
  hinge.add(leaf);
  const hx = dir*(d.w - 4);
  const handle = cyl(0.55, 0.55, 4.6, M.metal, 14);
  handle.rotation.x = Math.PI/2; handle.position.set(hx, 36, 1.6);
  hinge.add(handle);
  const open = 1.25;
  hinge.rotation.y = (d.swingOut ? 1 : -1) * dir * open;
  grp.add(hinge);
  L.door._obj = hinge;
}

/* ---------- window ---------- */
function addWindow(grp, L, R, wi, M){
  const w = L.window;
  const cx = localX(w.wall, wi.along, w.t, w.w);
  const fr = new THREE.MeshStandardMaterial({color:0xF4F1EB, roughness:.5});
  for(const [x, y, bw, bh] of [
    [cx, w.z - 1.2, w.w + 4, 2.4], [cx, w.z + w.h + 1.2, w.w + 4, 2.4],
    [cx - w.w/2 - 1.2, w.z + w.h/2, 2.4, w.h], [cx + w.w/2 + 1.2, w.z + w.h/2, 2.4, w.h]]){
    const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 4.5), fr);
    b.position.set(x, y, -1.2); grp.add(b);
  }
  const mull = new THREE.Mesh(new THREE.BoxGeometry(1.1, w.h, 1.4), fr);
  mull.position.set(cx, w.z + w.h/2, -0.6); grp.add(mull);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(w.w + 7, 1.4, 6), M.top);
  sill.position.set(cx, w.z - 2.2, 1.2); grp.add(sill);
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(w.w, w.h),
    new THREE.MeshBasicMaterial({color:0xE8F2F4}));
  pane.position.set(cx, w.z + w.h/2, -2.6); pane.rotation.y = Math.PI; grp.add(pane);
  w._local = {cx};
}

/* ---------- lighting ---------- */
function addLighting(L, R, aes, M, root){
  const lc = aes.light.c, li = aes.light.i;
  root.add(new THREE.HemisphereLight(0xFFFFFF, 0x9A948C, 0.42 * li));
  const amb = new THREE.AmbientLight(lc, 0.24 * li); root.add(amb);

  /* daylight through the window */
  if(L.window){
    const wi = wallInfo(L.window.wall, R);
    const n = WALL_POSE[L.window.wall](R).n;
    const c = centerOf(L.window.wall, L.window.t, L.window.w, 2, R);
    const sun = new THREE.DirectionalLight(0xFFF6E6, 0.85 * li);
    sun.position.set(WX(c.x) - n[0]*60 + 20, L.window.z + 46, WZ(c.y) - n[2]*60 + 20);
    sun.target.position.set(WX(R.L*0.45), 10, WZ(R.W*0.5));
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sp = Math.max(R.L, R.W) * 0.8;
    sun.shadow.camera.left = -sp; sun.shadow.camera.right = sp;
    sun.shadow.camera.top = sp; sun.shadow.camera.bottom = -sp;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 400;
    sun.shadow.bias = -0.0012;
    root.add(sun); root.add(sun.target);
  }

  /* ceiling downlights — the fitting and the light */
  const lights = (L.lights || []).slice(0, 4);
  let shadowed = 0;
  lights.forEach((p, i) => {
    const x = WX(p.cx), z = WZ(p.cy);
    const rim = cyl(2.1, 2.1, 0.5, M.metal, 22); rim.position.set(x, R.H - 0.35, z);
    rim.castShadow = false; root.add(rim);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(1.7, 22), M.glow);
    lens.rotation.x = Math.PI/2; lens.position.set(x, R.H - 0.62, z); root.add(lens);

    if(i < 3){
      const sl = new THREE.SpotLight(lc, (p.task ? 0.75 : 0.62) * li, 260, 1.02, 0.55, 1.4);
      sl.position.set(x, R.H - 2, z);
      sl.target.position.set(x, 0, z);
      if(shadowed < 2){ sl.castShadow = true; sl.shadow.mapSize.set(1024,1024); sl.shadow.bias = -0.0016; shadowed++; }
      root.add(sl); root.add(sl.target);
    }
  });

  /* a soft fill so the far corners are not black */
  const fill = new THREE.PointLight(0xFFFFFF, 0.2 * li, Math.max(R.L,R.W)*2.2, 2);
  fill.position.set(0, R.H * 0.62, 0); root.add(fill);

  /* mirror halo / cove glow reads as a light source too */
  const mir = (L.acc || []).find(a => a.kind === 'mirror');
  if(mir && aes.mirror.backlit){
    const pnt = new THREE.PointLight(lc, 0.35 * li, 90, 2);
    pnt.position.set(WX(mir.cx), mir.z + mir.h/2, WZ(mir.cy));
    root.add(pnt);
  }
}

/* ---------- show only the walls you can see past ---------- */
function cullWalls(){
  if(!V.ok || !V.walls.length) return;
  const cam = V.camera.position;
  for(const g of V.walls){
    if(!STATE.autoWalls){ g.visible = true; continue; }
    const n = g.userData.n, c = g.userData.centre;
    const dot = n[0]*(cam.x - c.x) + n[2]*(cam.z - c.z);
    g.visible = dot > 0;
  }
  if(V.ceiling) V.ceiling.visible = (STATE.view === 'door') || !STATE.autoWalls;
  V.dirty = true;
}

/* ---------- camera presets ---------- */
function setView(name, snap){
  if(!V.ok) return;
  STATE.view = name;
  const L = STATE.layout; if(!L) return;
  const R = L.room;
  const big = Math.max(R.L, R.W);
  if(name === 'top'){
    V.controls.goto({az:0, pol:0.14, dist:big*1.42, tx:0, ty:0, tz:0}, snap);
  } else if(name === 'door'){
    const az = { front:0, back:Math.PI, right:Math.PI/2, left:-Math.PI/2 }[L.door.wall];
    const d = (L.door.wall === 'front' || L.door.wall === 'back') ? R.W : R.L;
    V.controls.goto({az, pol:1.44, dist:d*0.92, tx:0, ty:52, tz:0}, snap);
  } else if(name === 'wet'){
    const wet = L.items.find(i => i.kind === 'shower') || L.items.find(i => i.kind === 'bath') || L.items[0];
    if(wet){
      const dx = WX(wet.cx), dz = WZ(wet.cy);
      V.controls.goto({az: Math.atan2(-dx, -dz) + Math.PI, pol:1.16, dist:Math.max(72, big*0.78),
                       tx:dx*0.55, ty:44, tz:dz*0.55}, snap);
    }
  } else {
    V.controls.goto({az:-0.72, pol:1.02, dist:big*1.62, tx:0, ty:40, tz:0}, snap);
  }
  cullWalls();
}

