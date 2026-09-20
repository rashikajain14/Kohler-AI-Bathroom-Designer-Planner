/* ---- e5_ui.js ---- */

/* ==================================================================
   UI — every control writes to STATE, then the room is re-solved and
   the 3D view, the floor plan and the report are rebuilt from scratch.
   ================================================================== */
const $ = id => document.getElementById(id);
const DIRS = ['North-West','North','North-East','West','','East','South-West','South','South-East'];

/* ---------- aesthetic thumbnail ---------- */
function styleThumb(key){
  const a = AES[key], p = a.pal;
  const joints = [];
  if(a.wall.type === 'subway') for(let r=0;r<5;r++) for(let c=0;c<5;c++)
    joints.push(`<rect x="${(c*22)+(r%2?-11:0)}" y="${r*11}" width="20" height="9" fill="${r%2?a.wall.c2:a.wall.c1}" opacity=".9"/>`);
  else if(a.wall.type === 'slat') for(let c=0;c<14;c++)
    joints.push(`<rect x="${c*8}" y="0" width="5" height="56" fill="${c%2?a.feat.c1:a.feat.c2}"/>`);
  else for(let c=0;c<4;c++)
    joints.push(`<rect x="${c*28}" y="0" width="27" height="56" fill="${c%2?a.wall.c2:a.wall.c1}"/>`);
  return `<svg viewBox="0 0 110 88" preserveAspectRatio="xMidYMid slice">
    <rect width="110" height="88" fill="${a.wall.c1}"/>
    <g>${joints.join('')}</g>
    <rect y="56" width="110" height="32" fill="${a.floor.c1}"/>
    <rect y="56" width="110" height="32" fill="${a.floor.c2}" opacity=".45"/>
    <rect x="8" y="40" width="34" height="14" rx="2" fill="${'#'+a.cab.c.toString(16).padStart(6,'0')}"/>
    <rect x="18" y="36" width="14" height="5" rx="2.5" fill="${'#'+a.porcelain.toString(16).padStart(6,'0')}"/>
    <rect x="14" y="16" width="22" height="17" rx="${a.mirror.shape==='round'?8.5:2}" fill="${p.glass}" opacity=".85"/>
    <rect x="66" y="12" width="36" height="46" rx="2" fill="${p.glass}" opacity=".4" stroke="#fff" stroke-opacity=".5"/>
    <circle cx="84" cy="20" r="4" fill="${'#'+a.metal.c.toString(16).padStart(6,'0')}"/>
    <rect x="50" y="46" width="9" height="12" rx="3" fill="${'#'+a.porcelain.toString(16).padStart(6,'0')}"/>
    <ellipse cx="54" cy="70" rx="26" ry="5" fill="${p.glow}" opacity=".22"/></svg>`;
}

/* ---------- panels built once ---------- */
function buildControls(){
  const comp = $('compass');
  comp.innerHTML = DIRS.map((d,i) => i===4
    ? `<div class="cmid">back<br>wall</div>`
    : `<button class="cbtn" data-dir="${d}">${shortOf(d)}</button>`).join('');
  comp.querySelectorAll('.cbtn').forEach(b => b.onclick = () => {
    STATE.face = b.dataset.dir; syncCompass(); render();
  });
  syncCompass();

  $('styleGrid').innerHTML = AES_KEYS.map(k =>
    `<button class="sty${k===STATE.aesthetic?' on':''}" data-k="${k}">
       <div class="thumb">${styleThumb(k)}</div>
       <div class="nm">${AES[k].name}<small>${AES[k].metal.name}</small></div></button>`).join('');
  $('styleGrid').querySelectorAll('.sty').forEach(b => b.onclick = () => {
    STATE.aesthetic = b.dataset.k;
    $('styleGrid').querySelectorAll('.sty').forEach(x => x.classList.toggle('on', x === b));
    render();
  });

  const tick = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.6"><path d="M4 12l6 6L20 6"/></svg>`;
  $('checks').innerHTML = AMENITY.map(a =>
    `<button class="chk${STATE.wants.has(a.k)?' on':''}" data-k="${a.k}"><span class="box">${tick}</span>${a.label}</button>`).join('');
  $('checks').querySelectorAll('.chk').forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    STATE.wants.has(k) ? STATE.wants.delete(k) : STATE.wants.add(k);
    b.classList.toggle('on', STATE.wants.has(k));
    render();
  });

  for(const [id, key] of [['len','L'],['wid','W'],['hgt','H']])
    $(id).onchange = () => { STATE.room[key] = (+$(id).value) * 12; render(); };
  $('doorwall').onchange = () => { STATE.doorWall = $('doorwall').value; render(); };

  $('vastuToggle').onclick = () => {
    STATE.vastu = !STATE.vastu;
    $('vastuToggle').classList.toggle('on', STATE.vastu);
    $('vastuToggle').setAttribute('aria-pressed', STATE.vastu);
    $('vastuNote').textContent = vastuNoteText();
    render();
  };
  $('budget').oninput = () => {
    STATE.budget = +$('budget').value;
    $('budgetLabel').textContent = inr(STATE.budget);
  };
  $('budget').onchange = () => render();
  $('generate').onclick = () => render(false, true);

  document.querySelectorAll('.vchip[data-view]').forEach(b => b.onclick = () => {
    document.querySelectorAll('.vchip[data-view]').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); setView(b.dataset.view);
  });
  $('wallToggle').onclick = () => {
    STATE.autoWalls = !STATE.autoWalls;
    $('wallToggle').classList.toggle('on', STATE.autoWalls);
    $('wallToggle').textContent = STATE.autoWalls ? 'Walls auto' : 'Walls all';
    cullWalls();
  };
  $('clrToggle').onclick = () => { STATE.showClear = !STATE.showClear; $('clrToggle').classList.toggle('on', STATE.showClear); drawPlan(); };
  $('dimToggle').onclick = () => { STATE.showDims = !STATE.showDims; $('dimToggle').classList.toggle('on', STATE.showDims); drawPlan(); };
  $('rotBtn').onclick = () => rotateSelection();
  $('arrToggle').onclick = () => {
    STATE.arrange = !STATE.arrange;
    $('arrToggle').classList.toggle('on', STATE.arrange);
    const h = document.querySelector('.vhint');
    if(h) h.textContent = STATE.arrange
      ? 'Arrange on — drag a fixture to move it · the plan follows'
      : 'Drag to orbit · scroll to zoom · right-drag or two fingers to pan';
  };

  $('sendBtn').onclick = sendChat;
  $('chatIn').addEventListener('keydown', e => { if(e.key === 'Enter') sendChat(); });
  $('saveB').onclick = saveDesignFlow;
  $('myDesigns').onclick = openDesigns;
  $('printB').onclick = printPlan;
  $('exportB').onclick = exportJson;
  $('deleteData').onclick = deleteMyData;
  $('skipLink').onclick = e => { e.preventDefault(); const pg = document.querySelector('.page.live'); if(pg) pg.focus(); };
  document.querySelectorAll('.step').forEach(b => b.onclick = () => {
    (b.dataset.s === '4' ? $('plan') : $('viewport')).scrollIntoView({behavior:'smooth', block:'center'});
  });
}
function syncCompass(){
  document.querySelectorAll('#compass .cbtn').forEach(b => b.classList.toggle('on', b.dataset.dir === STATE.face));
}

/* ================= the one place everything is regenerated ================= */
let solving = false;
function render(snap, showVeil){
  if(solving) return;
  solving = true;
  const vp = $('viewport');
  const lab = $('vlabel');
  lab.querySelector('span').textContent = 'Solving…';

  const run = () => {
    try {
    const t0 = performance.now();
    ARR.sel = null; ARR.drag = null; ARR.verdict = null;
    STATE.layout = solve(STATE);
    const ms = Math.round(performance.now() - t0);
    const L = STATE.layout;
    L._ms = ms;

    buildRoom();
    setView(STATE.view, snap === true);
    drawPlan();
    paintSummary(L, ms);
    paintReport(L);
    paintStrip(L);

    const bad = L.notices.filter(n => n.level === 'warn').length;
    lab.querySelector('i').classList.toggle('warn', bad > 0);
    lab.querySelector('span').textContent =
      `${Math.round(L.room.L/12)}×${Math.round(L.room.W/12)} ft · back wall ${shortOf(L.face)} · ${L.items.length} fixtures`;
    $('footNote').textContent =
      `Solved in ${ms} ms · ${L.items.length} fixtures, ${L.acc.length} accessories, ${L.conflicts.length ? L.conflicts.length + ' overlap(s)' : 'no overlaps'} · ${AES[STATE.aesthetic].name}`;
    onLayout(L, ms);
    } finally { solving = false; }
  };

  if(showVeil){
    vp.classList.add('gen');
    setTimeout(() => { run(); vp.classList.remove('gen'); }, 260);
  } else run();
}

/* ---------- right-hand summary ---------- */
function paintSummary(L, ms){
  const aes = AES[STATE.aesthetic];
  const M = L.metrics;
  const dropped = L.dropped.length;
  const warn = L.notices.filter(n => n.level === 'warn').length;
  $('summary').innerHTML = `
    <div class="sum-head">
      <h3>${aes.name}</h3>
      <span class="badge" title="Weighted mean of placement, comfort, Vastu and budget. See the breakdown below.">Layout score ${L.score}%</span>
    </div>
    <p class="panel-sub" style="margin-top:8px">${aes.blurb}</p>

    <div class="metrics" style="margin-top:16px">
      <div class="metric"><div class="k">Floor area</div><div class="v">${M.floorArea}<small> sq ft</small></div></div>
      <div class="metric"><div class="k">Clear square</div><div class="v">${M.clearSquare}<small> in</small></div></div>
      <div class="metric"><div class="k">Walking space</div><div class="v">${M.freePct}<small> %</small></div></div>
      <div class="metric"><div class="k">Fixtures placed</div><div class="v">${M.fixtures}${dropped?`<small> of ${M.fixtures+dropped}</small>`:''}</div></div>
    </div>

    <div class="spec"><div class="ic">${ART.vanity}</div><div style="flex:1">
      <div class="k">Space fit</div><div class="v">${L.fit}%</div>
      <div class="meter"><i style="width:${L.fit}%"></i></div></div></div>
    <div class="spec"><div class="ic">${ART.toilet}</div><div style="flex:1">
      <div class="k">Vastu alignment</div><div class="v">${L.vastu ? vastuHeadline(L) : 'Not applied'}</div></div></div>
    <div class="spec"><div class="ic">${ART.faucet}</div><div style="flex:1">
      <div class="k">Door</div><div class="v">${L.door.w} in, ${L.door.wall} wall, opens ${L.door.swingOut?'out':'in'}</div></div></div>
    <div class="spec"><div class="ic">${ART.mirror}</div><div style="flex:1">
      <div class="k">Daylight</div><div class="v">${L.window ? `${L.window.w} in window, ${L.window.wall} wall` : 'No window possible'}</div></div></div>

    <div class="cost" style="margin-top:16px">
      <div class="k" style="font-size:11px;color:var(--muted)">Fixture total</div>
      <div class="big">${inr(L.total)}</div>
      <div class="bar"><i style="width:${Math.min(100, L.total/STATE.budget*100)}%;background:${L.total>STATE.budget?'#C2542F':'var(--ink)'}"></i></div>
      <div style="font-size:11.5px;color:var(--muted)">${L.total > STATE.budget
        ? `${inr(L.total - STATE.budget)} over your ceiling of ${inr(STATE.budget)}.`
        : `${inr(STATE.budget - L.total)} left under your ceiling of ${inr(STATE.budget)}.`}</div>
    </div>

    <div style="margin-top:18px">
      <div class="k" style="font-size:11px;color:var(--muted);margin-bottom:8px">The design language</div>
      ${aes.language.map(l => `<div class="benefit"><span class="c" style="color:var(--brass)">—</span><div><div class="k">${esc(l)}</div></div></div>`).join('')}
    </div>
    ${scoreFormula(L)}
    <p class="panel-sub" style="margin-top:16px">${warn ? `${warn} thing${warn>1?'s':''} the room would not allow — see the layout report.` : 'Every clearance is met and nothing overlaps.'} Re-solved in ${ms} ms.</p>`;
}
function vastuHeadline(L){
  const v = L.vastuStats; if(!v) return 'Not applied';
  return `${v.preferred} of ${v.ruled} fixtures in a preferred zone${v.avoid ? `, ${v.avoid} in a zone Vastu avoids` : ''}`;
}
/* the score is a formula, so show the formula */
function scoreFormula(L){
  const M = L.metrics, W = SCORE_WEIGHTS, pct = x => Math.round(x * 100) + '%';
  const rows = [
    ['Everything requested is placed', W.placement, M.placementRate],
    ['Each fixture has comfortable room in front', W.comfort, M.comfortRate],
    ['Fixtures in a preferred Vastu zone', W.vastu, M.vastuRate],
    ['Total is within budget', W.budget, M.budgetOK ? 1 : Math.max(0, 1 - 2 * (L.total - STATE.budget) / STATE.budget)]
  ];
  return `<details class="formula"><summary>How the ${L.score}% is worked out</summary><table>${rows.map(r =>
    `<tr><td>${r[0]}${r[2] === null ? ' (off)' : ''}</td><td>${r[2] === null ? '—' : pct(r[2])}</td><td>× ${Math.round(r[1] * 100)}%</td></tr>`).join('')}</table>
    <p style="margin:8px 0 0">Weights are re-normalised when Vastu is off. This is a planning heuristic, not a measure of taste.</p></details>`;
}

/* ---------- layout report ---------- */
function paintReport(L){
  const TAG = {ok:'HELD', fix:'ADJUSTED', warn:'COMPROMISE'};
  $('whyList').innerHTML = L.notices.map(n =>
    `<div class="rep ${n.level}"><span class="dot"></span><span class="tagx">${TAG[n.level]}</span><span>${esc(n.text)}</span></div>`).join('');
}

/* ---------- fixtures in this layout ---------- */
const ART_FOR = {shower:'shower', bath:'bath', toilet:'toilet', vanity:'vanity', storage:'storage'};
function paintStrip(L){
  const aes = AES[STATE.aesthetic];
  const rows = L.items.map(it => {
    const prod = L.products.find(p => p.why === it.kind);
    return `<div class="pcard"><div class="fig">${ART[ART_FOR[it.kind]]}</div>
      <div class="cat">${FIX[it.kind].label}</div>
      <div class="nm">${prod ? prod.name.replace('KOHLER ','') : FIX[it.kind].label}</div>
      <div class="pr">${prod ? inr(prod.price) : '—'}</div>
      <div class="mini">${it.w}×${it.d} in · ${it.wall} wall</div></div>`;
  }).join('');
  const extras = L.products.filter(p => !['shower','bath','toilet','vanity','storage'].includes(p.why));
  $('strip').innerHTML = rows + `
    <div class="cost">
      <div style="font-size:11px;color:var(--muted)">Also specified</div>
      ${extras.map(p => `<div class="fixline"><span class="sw">${ART[p.art].replace('<svg','<svg width="15" height="15"')}</span>
        <span class="nm"><b>${p.name.replace('KOHLER ','')}</b><span>${p.cat}</span></span>
        <span class="dim">${inr(p.price)}</span></div>`).join('') || '<div class="fixline"><span class="nm"><span>Nothing beyond the fixtures.</span></span></div>'}
      ${L.acc.filter(a => !['drain','tray','niche'].includes(a.kind)).map(a =>
        `<div class="fixline"><span class="nm"><b>${a.label}</b><span>${a.mount === 'wall' ? `${a.wall} wall at ${a.z} in` : a.mount === 'ceiling' ? 'ceiling' : 'floor standing'}</span></span></div>`).join('')}
    </div>`;
}

/* ================= chat ================= */
function say(text, mine){
  const log = $('log');
  const d = document.createElement('div');
  d.className = 'msg ' + (mine ? 'me' : 'ai');
  d.innerHTML = mine ? esc(text)
    : `<span class="av"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z"/></svg></span><span>${esc(text)}</span>`;
  log.appendChild(d); log.scrollTop = log.scrollHeight;
}
function sendChat(){
  const inp = $('chatIn'), q = inp.value.trim();
  if(!q) return;
  inp.value = '';
  handleUserMessage(q);
}
