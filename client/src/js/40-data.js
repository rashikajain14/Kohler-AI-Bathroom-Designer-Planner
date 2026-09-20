/* ---- e1_data.js ---- */

/* ==================================================================
   PARAMETRIC BATHROOM PLANNER
   One state object drives the solver, the floor plan and the 3D room.
   All internal geometry is in INCHES. Plan axes: x = along length,
   y = across width, y = W is always the back wall.
   ================================================================== */

const STATE = {
  room:   { L: 96, W: 72, H: 108 },      // inches
  face:   'South',                        // compass direction the back wall faces
  doorWall: 'auto',
  vastu:  true,
  aesthetic: 'modern',
  budget: 200000,
  wants:  new Set(['toilet','shower','vanity','mirror','towel','fan','storage']),
  prefer: [],                             // shortlisted product ids: preferred over the style default
  layout: null,
  view:   'orbit',
  autoWalls: true,
  showClear: true,
  showDims: true,
  arrange: false                          // drag fixtures directly in the 3D view
};

/* ---------------- compass ---------------- */
const DIR_DEG = { 'North':0,'North-East':45,'East':90,'South-East':135,'South':180,'South-West':225,'West':270,'North-West':315 };
const DIR_SHORT = { 'North':'N','North-East':'NE','East':'E','South-East':'SE','South':'S','South-West':'SW','West':'W','North-West':'NW' };
const shortOf = d => DIR_SHORT[d] || d;
const degOf   = d => DIR_DEG[d] ?? 180;
function dirFromDeg(deg){
  deg = ((deg % 360) + 360) % 360;
  let best='North', bd=999;
  for(const k in DIR_DEG){ const d=Math.abs(((DIR_DEG[k]-deg+540)%360)-180); if(d<bd){bd=d;best=k;} }
  return best;
}

/* ---------------- fixture specifications (inches) ----------------
   w = width measured along the wall, d = depth out from the wall.
   clearFront = the comfortable clear floor space in front,
   minFront   = the hard minimum before the layout is rejected,
   side       = clear space required either side of the body.       */
const FIX = {
  shower: { label:'Shower enclosure', prio:1, side:2, clearFront:26, minFront:21, corner:true, std:{w:36,d:36},
            sizes:[{w:48,d:36},{w:42,d:42},{w:40,d:36},{w:36,d:36},{w:34,d:34},{w:32,d:32}] },
  bath:   { label:'Bathtub', prio:2, side:0, clearFront:26, minFront:21, corner:true, std:{w:60,d:30},
            sizes:[{w:66,d:32},{w:60,d:30},{w:54,d:28},{w:48,d:28}] },
  toilet: { label:'Toilet', prio:3, side:5, clearFront:24, minFront:21, std:{w:20,d:26},
            sizes:[{w:20,d:28},{w:20,d:26},{w:19,d:24},{w:18,d:22}] },
  vanity: { label:'Vanity and basin', prio:4, side:1, clearFront:30, minFront:21, std:{w:48,d:21},
            sizes:[{w:60,d:22},{w:48,d:21},{w:42,d:20},{w:36,d:19},{w:30,d:18},{w:24,d:17}] },
  storage:{ label:'Storage unit', prio:5, side:0, clearFront:18, minFront:12, corner:true, std:{w:20,d:18},
            sizes:[{w:20,d:18},{w:16,d:15},{w:14,d:13}] }
};
const FIX_HEIGHT = { shower:78, bath:23, toilet:31, vanity:35, storage:72 };

/* ---------------- Vastu placement rules ----------------
   Bearings are absolute compass degrees of the zone a fixture sits in. */
const VASTU = {
  toilet: { good:[270,315], bad:[45,0],      say:'west or north-west' },
  shower: { good:[90,45,0], bad:[135,225],   say:'east or north-east' },
  bath:   { good:[90,45,0], bad:[135,225],   say:'east or north-east' },
  vanity: { good:[0,45,90], bad:[225,180],   say:'north or east' },
  storage:{ good:[225,180,270], bad:[45],    say:'south-west, south or west' },
  door:   { good:[0,90,45,315], bad:[225,135], say:'north or east' },
  drain:  { good:[45,0,90], bad:[225],       say:'north-east' },
  window: { good:[90,45,0], bad:[225],       say:'east' }
};
const angDiff = (a,b) => Math.abs((((a-b) % 360) + 540) % 360 - 180);
function vastuScore(kind, bearing){
  const v = VASTU[kind]; if(!v) return 0;
  const g  = Math.min(...v.good.map(b => angDiff(bearing,b)));
  const bd = v.bad.length ? Math.min(...v.bad.map(b => angDiff(bearing,b))) : 180;
  let s = (1 - g/180) * 100;
  if(bd < 34) s -= (34 - bd) * 2.2;
  return s;
}

/* ---------------- aesthetic packs ----------------
   Each pack is a complete design language: tiles, joinery, metal
   finish, glass, mirror shape, fixture silhouette and lighting. */
const AES = {
  modern: {
    name:'Minimalist Modern', blurb:'Large-format matte porcelain, a floating oak vanity, and light you never see the source of.',
    pal:{wall:'#CFC9C0',wall2:'#A8A198',floor:'#8C857C',wood:'#C29A6C',glow:'#F6E9CF',glass:'#DDE6E6'},
    wall:{type:'largeformat', c1:'#EFEDE8', c2:'#E7E4DE', grout:'#DED9D1', tw:24, th:48},
    feat:{type:'largeformat', c1:'#E4DFD6', c2:'#DBD5CB', grout:'#D2CCC2', tw:12, th:48},
    floor:{type:'microcement', c1:'#C3BDB4', c2:'#B2ABA1', grout:'#ADA69C', tw:36, th:36},
    metal:{c:0xC6CCD1, r:0.24, name:'Brushed nickel'},
    porcelain:0xFBFAF8,
    cab:{c:0xC49A68, top:0xEFECE6, style:'wallhung', front:'slab', handle:'bar'},
    basin:'integrated', mirror:{shape:'rect', frame:null, backlit:true},
    toilet:'wallhung', head:'rain', glass:{c:0xDDE8EA, op:0.11},
    towel:0xD9D4CA, textile:0xC9C3B8, plant:0x6E8466,
    light:{c:0xFFF1DC, i:0.95, temp:'3000K'}, exposure:1.02,
    products:{toilet:'veil', shower:'awaken', faucet:'hint', vanity:'verderaV', mirror:'verderaM', bath:'underscore', storage:'linen', towel:'railA', fan:'fan1'},
    language:['Matte 24×48 porcelain run vertically on the back wall','Wall-hung joinery so the floor reads unbroken','Nickel, not chrome — it stops the room glittering']
  },
  luxury: {
    name:'Classic Luxury', blurb:'Book-matched marble, a fluted cabinet in deep green, and unlacquered brass everywhere it is touched.',
    pal:{wall:'#D8CDBA',wall2:'#A9967B',floor:'#7A6449',wood:'#6F4E2E',glow:'#FFE0A8',glass:'#E4E2D6'},
    wall:{type:'marble', c1:'#F1EDE5', c2:'#DFD8CC', grout:'#E4DED3', vein:'#A8A093', tw:32, th:64},
    feat:{type:'marble', c1:'#EDE7DB', c2:'#D8CEBD', grout:'#DDD5C7', vein:'#9A907F', tw:32, th:64},
    floor:{type:'hex', c1:'#E9E4DB', c2:'#D6CEC1', grout:'#C4BCAE', tw:9, th:9},
    metal:{c:0xC9A45E, r:0.28, name:'Brushed brass'},
    porcelain:0xFDFCF9,
    cab:{c:0x31473D, top:0xEFE9DD, style:'legs', front:'fluted', handle:'knob'},
    basin:'undermount', mirror:{shape:'arch', frame:0xC9A45E, backlit:false},
    toilet:'onepiece', head:'rain', glass:{c:0xE3D7C2, op:0.15},
    towel:0xF0E7D6, textile:0xE2D6BE, plant:0x5F7A54,
    light:{c:0xFFE7C2, i:1.05, temp:'2700K'}, exposure:1.0,
    products:{toilet:'reve', shower:'artshower', faucet:'artfaucet', vanity:'damais', mirror:'mirrorcab', bath:'evok', storage:'linen', towel:'railB', fan:'fan1'},
    language:['Veined slab to the ceiling, no border, no listello','Fluted cabinet on legs so the marble floor carries through','Brass left unlacquered — it is supposed to change']
  },
  zen: {
    name:'Japanese Zen', blurb:'Cedar battens, a honed stone floor and a room that keeps most of its area empty on purpose.',
    pal:{wall:'#C6BFB0',wall2:'#8E8878',floor:'#5E5B52',wood:'#9C7B50',glow:'#EAE0C8',glass:'#D8DEDA'},
    wall:{type:'plaster', c1:'#DCD6C9', c2:'#CDC6B7', grout:'#D3CCBE', tw:48, th:48},
    feat:{type:'slat', c1:'#B4854F', c2:'#8A6238', grout:'#4A3826', tw:3.5, th:96},
    floor:{type:'stone', c1:'#565450', c2:'#46443F', grout:'#3A3833', tw:12, th:24},
    metal:{c:0x2C2E30, r:0.48, name:'Matte black'},
    porcelain:0xF7F5F0,
    cab:{c:0x8A6440, top:0x9A7249, style:'floating-timber', front:'slab', handle:'notch'},
    basin:'vessel', mirror:{shape:'round', frame:0x2C2E30, backlit:false},
    toilet:'wallhung', head:'column', glass:{c:0xCFDCD5, op:0.10},
    towel:0xC9C2B4, textile:0xB6AE9E, plant:0x51684A,
    light:{c:0xFFEBCB, i:0.82, temp:'2700K'}, exposure:0.96,
    products:{toilet:'karess', shower:'statement', faucet:'components', vanity:'maxispace', mirror:'essential', bath:'underscore', storage:'maxitall', towel:'railA', fan:'fan1'},
    language:['Cedar battens on one wall only, at 3½ in centres','Honed stone floor, dark enough to read as ground','Every fitting matte black so nothing reflects back at you']
  },
  industrial: {
    name:'Urban Industrial', blurb:'Dark porcelain, a terrazzo floor and a steel-framed vanity that looks like it was fabricated, not bought.',
    pal:{wall:'#8E9196',wall2:'#63666A',floor:'#57595C',wood:'#7B6B58',glow:'#E6EAF0',glass:'#B9C0C6'},
    wall:{type:'largeformat', c1:'#71757A', c2:'#65696E', grout:'#55585C', tw:24, th:24},
    feat:{type:'concrete', c1:'#7E8185', c2:'#6C7075', grout:'#63666A', tw:48, th:48},
    floor:{type:'terrazzo', c1:'#8E8C88', c2:'#A6A39D', grout:'#7A7874', tw:32, th:32},
    metal:{c:0x3B3F43, r:0.38, name:'Gunmetal'},
    porcelain:0xF4F3F0,
    cab:{c:0x34383C, top:0x9C9995, style:'steel', front:'slab', handle:'bar'},
    basin:'vessel', mirror:{shape:'rect', frame:0x2E3236, backlit:false},
    toilet:'wallhung', head:'column', glass:{c:0x8E9296, op:0.2},
    towel:0x51565B, textile:0x45494D, plant:0x5A6E52,
    light:{c:0xFFF6E8, i:1.0, temp:'4000K'}, exposure:1.06,
    products:{toilet:'karess', shower:'statement', faucet:'components', vanity:'verderaV', mirror:'essential', bath:'underscore', storage:'maxitall', towel:'railA', fan:'fan1'},
    language:['24 in porcelain squares with a deliberate dark grout','Terrazzo underfoot, chipped warm so the room is not cold','Steel frame under a concrete-look top']
  },
  coastal: {
    name:'Coastal Spa', blurb:'Hand-glazed zellige, oak-look plank flooring and chrome kept bright.',
    pal:{wall:'#DDE6E6',wall2:'#B3C4C6',floor:'#C2A47A',wood:'#C9A77A',glow:'#F2F7F6',glass:'#DDEAEC'},
    wall:{type:'subway', c1:'#F4F2ED', c2:'#E8E6DF', grout:'#DAD5CB', tw:8, th:3},
    feat:{type:'subway', c1:'#C9DBDE', c2:'#B7CDD1', grout:'#A9BEC2', tw:8, th:3},
    floor:{type:'plank', c1:'#CBA97D', c2:'#B8966B', grout:'#A5824F', tw:48, th:7},
    metal:{c:0xD7DCE1, r:0.12, name:'Polished chrome'},
    porcelain:0xFFFFFE,
    cab:{c:0xF0EDE6, top:0xE7E2D7, style:'legs', front:'shaker', handle:'knob'},
    basin:'undermount', mirror:{shape:'round', frame:0xC6A97C, backlit:false},
    toilet:'skirted', head:'rain', glass:{c:0xDFEBEC, op:0.09},
    towel:0xE7EEF0, textile:0x7FA6AE, plant:0x6B8F72,
    light:{c:0xFFF7EC, i:1.06, temp:'3500K'}, exposure:1.04,
    products:{toilet:'reve', shower:'awaken', faucet:'hint', vanity:'maxispace', mirror:'essential', bath:'underscore', storage:'maxitall', towel:'railA', fan:'fan1'},
    language:['Hand-glazed 8×3 zellige, laid in a running bond','Plank-format porcelain that behaves like oak but is not','Chrome polished bright — the one shiny thing in the room']
  },
  scandi: {
    name:'Scandi Warm', blurb:'Lime plaster, warm terrazzo and oak slab fronts with no handles at all.',
    pal:{wall:'#E4DED3',wall2:'#C2BBAE',floor:'#CFC7B8',wood:'#D2AE7E',glow:'#FBF1DF',glass:'#E6E9E4'},
    wall:{type:'plaster', c1:'#E9E3D8', c2:'#DDD6C9', grout:'#E0D9CC', tw:48, th:48},
    feat:{type:'plaster', c1:'#D3CEBF', c2:'#C5BFAF', grout:'#CAC4B4', tw:48, th:48},
    floor:{type:'terrazzo', c1:'#DFD8CB', c2:'#EFEAE0', grout:'#CFC7B8', tw:32, th:32},
    metal:{c:0xB9AE9C, r:0.42, name:'Champagne matte'},
    porcelain:0xFCFBF7,
    cab:{c:0xD2AE7E, top:0xD8B98B, style:'wallhung', front:'slab', handle:'notch'},
    basin:'integrated', mirror:{shape:'rect', frame:0xD2AE7E, backlit:true},
    toilet:'skirted', head:'rain', glass:{c:0xE6EAE5, op:0.1},
    towel:0xDCD6C8, textile:0xC8C0AE, plant:0x738A66,
    light:{c:0xFFEFD8, i:0.92, temp:'2700K'}, exposure:1.0,
    products:{toilet:'reve', shower:'awaken', faucet:'components', vanity:'verderaV', mirror:'verderaM', bath:'underscore', storage:'linen', towel:'railA', fan:'fan1'},
    language:['Lime plaster, no tile joints anywhere on the walls','Warm terrazzo with oat and chalk chips','Push-to-open oak fronts, so there is no hardware to see']
  }
};
const AES_KEYS = Object.keys(AES);

/* ---------------- layout score: documented, not magic ----------------
   Layout score = weighted mean of four measured rates, each 0..1:
     placement  fixtures placed / fixtures requested
     comfort    placed fixtures whose clear floor in front meets the comfortable figure
     vastu      Vastu-ruled fixtures standing in a preferred zone (omitted when Vastu is off,
                the remaining weights are re-normalised)
     budget     1 when the total is within budget, else 1 - 2 x (overshoot / budget), floored at 0
   Space fit    = mean of placement, comfort and min(1, clear square / 30 in).
   These weights are a research parameter; change them here and re-run the benchmark. */
const SCORE_WEIGHTS = { placement:0.35, comfort:0.25, vastu:0.20, budget:0.20 };

/* catalogue category each product slot is drawn from (used by the shortlist) */
const SLOT_CAT = { toilet:'Smart Toilet', shower:'Rain Shower', faucet:'Faucet', vanity:'Vanity', mirror:'Mirror',
                   bath:'Bathtub', storage:'Storage', towel:'Accessories', fan:'Ventilation' };

/* amenity checkboxes -> what they mean to the solver */
const AMENITY = [
  { k:'toilet',  label:'Toilet',          kind:'fixture' },
  { k:'shower',  label:'Shower',          kind:'fixture' },
  { k:'bath',    label:'Bathtub',         kind:'fixture' },
  { k:'vanity',  label:'Vanity & basin',  kind:'fixture' },
  { k:'storage', label:'Storage unit',    kind:'fixture' },
  { k:'mirror',  label:'Mirror',          kind:'accessory' },
  { k:'towel',   label:'Towel rail',      kind:'accessory' },
  { k:'fan',     label:'Exhaust fan',     kind:'accessory' },
  { k:'decor',   label:'Plants & decor',  kind:'accessory' }
];

