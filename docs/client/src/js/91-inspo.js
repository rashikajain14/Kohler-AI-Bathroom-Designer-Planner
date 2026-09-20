/* ==================================================================
   UPLOAD INSPIRATION — a real vision call (server-side, Claude API)
   analyzes an uploaded bathroom photo, then the SAME solver used by
   "Re-solve the layout" rebuilds the room from that analysis, so 2D,
   3D, collision checks, clearances, Vastu and budget all stay exactly
   as trustworthy as they already are for a normal generate. Nothing
   about the photo is ever drawn into the plan or the 3D room — it is
   only read by Claude and shown back as a small preview/reference.
   The image is downscaled in the browser, sent once to /api/inspiration/analyze,
   and is not stored unless the study operator turns that on.
   ================================================================== */
const INSPO = { analysis:null, dataUrl:null, file:null, applied:false };
const inspoAiReady = () => !!(typeof APP !== 'undefined' && APP.aiOn);

const AES_LOOKUP = { modern:'Minimalist Modern', luxury:'Classic Luxury', zen:'Japanese Zen', industrial:'Urban Industrial', coastal:'Coastal Spa', scandi:'Scandi Warm' };

function inspoSetStatus(text, spinning){
  const t = $('inspoStatusText'), s = $('inspoSpin');
  if(t) t.textContent = text || '';
  if(s) s.classList.toggle('on', !!spinning);
}

function inspoAnalysisRow(k, v){
  if(!v) return '';
  return `<div class="spec"><span style="flex:1"><span class="k">${esc(k)}</span><div class="v">${esc(v)}</div></span></div>`;
}
function inspoPaintAnalysis(a){
  const body = $('inspoAnalysisBody');
  if(!a){ body.innerHTML = '<div class="inspo-empty">Upload a photo and analyze it to see the detected style, colors, tiles, flooring and fixtures here.</div>'; return; }
  body.innerHTML = [
    inspoAnalysisRow('Style', a.style),
    inspoAnalysisRow('Colors', Array.isArray(a.colors) ? a.colors.join(' + ') : a.colors),
    inspoAnalysisRow('Tiles', a.tiles),
    inspoAnalysisRow('Flooring', a.flooring),
    inspoAnalysisRow('Vanity', a.vanity),
    inspoAnalysisRow('Toilet', a.toilet),
    inspoAnalysisRow('Shower', a.shower),
    inspoAnalysisRow('Bathtub', a.bathtub),
    inspoAnalysisRow('Mirror', a.mirror),
    inspoAnalysisRow('Lighting', a.lighting),
    inspoAnalysisRow('Finish', a.finishes),
    inspoAnalysisRow('Accessories', Array.isArray(a.accessories) ? a.accessories.join(', ') : a.accessories)
  ].filter(Boolean).join('');
}

/* ---- status line is set by applyCondition() once the study config has loaded ---- */
function inspoPaintReady(){
  if(!inspoAiReady()) inspoSetStatus('AI analysis isn\'t available right now — you can still upload and preview a photo.', false);
  else inspoSetStatus('', false);
}

/* ---- upload + preview (always works, no capability needed) ---- */
$('inspoDrop').addEventListener('click', () => $('inspoFile').click());
$('inspoDrop').addEventListener('dragover', e => { e.preventDefault(); });
$('inspoDrop').addEventListener('drop', e => {
  e.preventDefault();
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if(f) inspoHandleFile(f);
});
$('inspoFile').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if(f) inspoHandleFile(f);
});
function inspoHandleFile(file){
  const okType = /^image\/(jpeg|jpg|png|webp)$/.test(file.type);
  if(!okType){ inspoSetStatus('Please choose a JPG, PNG or WEBP image.', false); return; }
  INSPO.file = file;
  INSPO.analysis = null;
  inspoPaintAnalysis(null);
  $('inspoApplyBtn').setAttribute('disabled','');
  $('inspoCompareBtn').setAttribute('disabled','');
  const url = URL.createObjectURL(file);
  INSPO.dataUrl = url;
  $('inspoPreviewImg').src = url;
  $('inspoPreviewWrap').classList.add('show');
  $('inspoAnalyzeBtn').removeAttribute('disabled');
  inspoSetStatus(inspoAiReady() ? 'Photo ready — click Analyze with AI.' : 'Photo ready. AI analysis isn\'t available right now, but you can still browse the room here.', false);
}

/* ---- the actual AI vision call: downscale, then POST to our own server ---- */
function inspoToJpegBase64(file, maxEdge){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(Object.assign(new Error('unreadable image'), {code:'image_rejected'})); };
    img.src = url;
  });
}
async function analyzeInspirationImage(file){
  const b64 = await inspoToJpegBase64(file, 1568);
  try{
    const r = await api('POST', '/api/inspiration/analyze', { image: b64, mediaType: 'image/jpeg' });
    return r.analysis;
  }catch(e){ e.code = (e.data && e.data.code) || e.code; throw e; }
}
$('inspoAnalyzeBtn').addEventListener('click', async () => {
  if(!INSPO.file) return;
  if(!inspoAiReady()){ inspoSetStatus('AI analysis isn\'t available right now.', false); return; }
  $('inspoAnalyzeBtn').setAttribute('disabled','');
  inspoSetStatus('Analyzing your inspiration…', true);
  try{
    const data = await analyzeInspirationImage(INSPO.file);
    INSPO.analysis = data;
    track('inspiration_analyzed', { style: data.style, preset: data.closestPreset });
    inspoPaintAnalysis(data);
    inspoSetStatus('Analysis complete.', false);
    $('inspoApplyBtn').removeAttribute('disabled');
    $('inspoCompareBtn').removeAttribute('disabled');
    say(`Read your inspiration photo — looks like ${data.style || 'a style'} with ${Array.isArray(data.colors)?data.colors.join(' and '):data.colors} tones. Click "Apply to my room" and I'll re-solve your ${STATE.room.L/12}×${STATE.room.W/12} ft room to match, or ask me anything about it.`);
  }catch(e){
    $('inspoAnalyzeBtn').removeAttribute('disabled');
    const copy = {
      ai_unavailable: 'AI analysis isn\'t available right now.',
      forbidden_condition: 'AI analysis isn\'t part of your study condition.',
      image_rejected: 'That image couldn\'t be read — try a different JPG, PNG or WEBP under 5 MB.',
      rate_limited: 'Too many requests right now — wait a moment and try again.',
      quota: 'You\'ve reached the analysis limit for this session.',
      invalid_json: 'The analysis came back in an unexpected format — try Analyze again.',
      refused: 'That image couldn\'t be analyzed — try a clearer bathroom photo.',
      upstream_error: 'Something went wrong reaching the AI service — try again in a moment.'
    };
    inspoSetStatus(copy[e.code] || ('Analysis failed: ' + (e.message || 'unknown error')), false);
  }
});

/* ---- apply the analysis to the actual room: aesthetic + wants,
   then the real solver re-runs exactly as "Re-solve the layout" does ---- */
function inspoWantsField(v){ return v && !/not visible|^none$|no (shower|bath|vanity|mirror)/i.test(v); }
function inspoClosestKey(a){
  if(a.closestPreset && AES_KEYS.includes(a.closestPreset)) return a.closestPreset;
  const text = [a.style, (a.colors||[]).join(' '), a.finishes].join(' ').toLowerCase();
  let best = 'modern', bestScore = -1;
  for(const k of AES_KEYS){
    const words = (AES[k].name + ' ' + AES[k].metal.name).toLowerCase().split(/\W+/).filter(Boolean);
    const score = words.reduce((s,w)=> s + (text.includes(w) ? 1 : 0), 0);
    if(score > bestScore){ bestScore = score; best = k; }
  }
  return best;
}
function inspoSyncControlsUI(){
  $('styleGrid').querySelectorAll('.sty').forEach(b => b.classList.toggle('on', b.dataset.k === STATE.aesthetic));
  $('checks').querySelectorAll('.chk').forEach(b => b.classList.toggle('on', STATE.wants.has(b.dataset.k)));
}
$('inspoApplyBtn').addEventListener('click', () => {
  const a = INSPO.analysis;
  if(!a) return;
  const key = inspoClosestKey(a);
  STATE.aesthetic = key;

  STATE.wants.add('toilet');
  const setWant = (want, k) => { want ? STATE.wants.add(k) : STATE.wants.delete(k); };
  setWant(inspoWantsField(a.shower), 'shower');
  setWant(inspoWantsField(a.bathtub), 'bath');
  setWant(a.vanity ? inspoWantsField(a.vanity) : true, 'vanity');
  setWant(inspoWantsField(a.mirror), 'mirror');
  const accText = (Array.isArray(a.accessories) ? a.accessories.join(' ') : (a.accessories||'')).toLowerCase();
  if(/towel/.test(accText)) STATE.wants.add('towel');
  if(/plant|stool|decor/.test(accText)) STATE.wants.add('decor');
  if(/storage|shelv|cabinet|linen/.test(accText)) STATE.wants.add('storage');
  if(!inspoWantsField(a.shower) && !inspoWantsField(a.bathtub)) STATE.wants.add('shower'); // every bathroom needs a wet zone

  inspoSyncControlsUI();
  $('inspoApplyBtn').setAttribute('disabled','');
  inspoSetStatus('Re-solving your room to match…', true);

  render(false, true);
  setTimeout(() => {
    $('inspoApplyBtn').removeAttribute('disabled');
    inspoSetStatus('Applied.', false);
    INSPO.applied = true;
    const L = STATE.layout;
    const warns = L.notices.filter(n => n.level === 'warn');
    const aesName = AES[key].name;
    let msg = `Matched your inspiration to ${aesName} and re-solved the ${Math.round(L.room.L/12)}×${Math.round(L.room.W/12)} ft room around it.`;
    if(warns.length){
      msg += ' Couldn\'t carry everything over as-is: ' + warns.slice(0,3).map(n=>n.text).join(' ');
    } else {
      msg += ' Everything from the brief fit without compromise.';
    }
    say(msg);
  }, 320);
});

/* ---- compare: pin the inspiration photo in the corner of the 3D view ---- */
$('inspoCompareBtn').addEventListener('click', () => {
  if(!INSPO.dataUrl) return;
  const pin = $('inspoPin');
  const showing = pin.classList.contains('show');
  if(showing){ pin.classList.remove('show'); $('inspoCompareBtn').textContent = 'Compare inspiration'; return; }
  $('inspoPinImg').src = INSPO.dataUrl;
  pin.classList.add('show');
  $('inspoCompareBtn').textContent = 'Hide comparison';
});
$('inspoPinClose').addEventListener('click', e => {
  e.stopPropagation();
  $('inspoPin').classList.remove('show');
  $('inspoCompareBtn').textContent = 'Compare inspiration';
});

/* ---- quick chat actions ---- */
$('inspoQuick').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  handleUserMessage(b.dataset.q);
}));

/* ---- teach the existing design assistant about the inspiration ---- */
function inspoRespond(s, L){
  if(/more like (my |the )?inspiration|match(es)? my inspiration|copy my inspiration/.test(s)){
    if(!INSPO.analysis){ say('Upload an inspiration photo and analyze it first — then I can match your room to it.'); return true; }
    if(!INSPO.applied){ $('inspoApplyBtn').click(); return true; }
    const a = INSPO.analysis, key = STATE.aesthetic;
    sayRich(`Already matched to <b>${esc(AES[key].name)}</b> from your inspiration (${esc(a.style||'')}, ${esc(Array.isArray(a.colors)?a.colors.join(' + '):a.colors||'')}). Ask "what can I add from my inspiration" for anything still missing.`);
    return true;
  }
  if(/what can i add from (my |the )?inspiration|add.*from.*inspiration/.test(s)){
    if(!INSPO.analysis){ say('Upload and analyze an inspiration photo first.'); return true; }
    const a = INSPO.analysis;
    const wanted = [];
    if(inspoWantsField(a.shower) && !STATE.wants.has('shower')) wanted.push('shower');
    if(inspoWantsField(a.bathtub) && !STATE.wants.has('bath')) wanted.push('bath');
    if(inspoWantsField(a.mirror) && !STATE.wants.has('mirror')) wanted.push('mirror');
    if(/towel/i.test((a.accessories||[]).join(' ')) && !STATE.wants.has('towel')) wanted.push('towel');
    if(/storage|shelv|cabinet/i.test((a.accessories||[]).join(' ')) && !STATE.wants.has('storage')) wanted.push('storage');
    if(!wanted.length){ say('Everything your inspiration showed is already in the room, or was ruled out and explained in the layout report.'); return true; }
    const fits = wanted.filter(k => probeAdd(L, k).ok);
    if(!fits.length){ say(`Your inspiration also had ${wanted.map(k=>AMENITY.find(a2=>a2.k===k).label.toLowerCase()).join(' and ')}, but there's no safe spot left for ${fits.length?'':'any of it'} — try a larger room or remove something first.`); return true; }
    sayRich('From your inspiration, this still fits:' + fits.map(k => suggestionRow(k)).join(''));
    return true;
  }
  if(/why (couldn.?t|can.?t|wasn.?t) you copy|why (wasn.?t|couldn.?t).*(added|copied|included|kept)/.test(s)){
    if(!INSPO.analysis){ say('Upload and analyze an inspiration photo first — then ask this again if something looks missing.'); return true; }
    const warns = L.notices.filter(n => n.level === 'warn');
    if(!warns.length){ say('Nothing was dropped — everything the analysis picked up made it into the room.'); return true; }
    sayRich('Here\'s what couldn\'t carry over exactly, and why:' + `<ul style="margin:6px 0 0 18px;padding:0">${warns.map(n=>`<li>${esc(n.text)}</li>`).join('')}</ul>`);
    return true;
  }
  if(/matching kohler products|show.*products?.*inspiration|products? (like|for) (my |this )?inspiration/.test(s)){
    const aes = AES[STATE.aesthetic];
    const rows = ['toilet','shower','faucet','vanity','mirror','bath'].map(k => aes.products && aes.products[k]).filter(Boolean)
      .map(id => P(id)).map(p => `<div class="fixline"><span class="sw">${ART[p.art].replace('<svg','<svg width="15" height="15"')}</span><span class="nm"><b>${esc(p.name.replace('KOHLER ',''))}</b><span>${esc(p.cat)}</span></span><span class="dim">${inr(p.price)}</span></div>`).join('');
    sayRich(`${esc(aes.name)} product set, closest to your inspiration:${rows}`);
    return true;
  }
  return false;
}
/* wire inspoRespond into the existing chat dispatcher without editing its body */
const _respond = respond;
respond = function(q){
  const L = STATE.layout;
  if(L){
    const s = q.toLowerCase().trim();
    if(inspoRespond(s, L)) return;
  }
  return _respond(q);
};

/* ================= boot ================= */
function bootPlanner(){
  buildControls();
  $('len').value = STATE.room.L/12; $('wid').value = STATE.room.W/12; $('hgt').value = STATE.room.H/12;
  $('budgetLabel').textContent = inr(STATE.budget);
  say('The room is solved from scratch, then it\'s yours to adjust. Drag anything in the plan, or ask me what fits, what\'s within budget, or what\'s wrong with the layout.');
  bindChatActions();
  bindArrangeKeys();
  loadThree(ok => {
    if(ok){ try { initThree(); } catch(e){ console.warn(e); } }
    if(!V.ok) document.getElementById('viewport').classList.add('failed');
    bind3DDrag();
    render(true);
  });
}

