/* ---- p_js_scene.js ---- */
/* =================== SCENE RENDERER =================== */
let _sid=0;
function scene(p,variant){
  const U='_'+(++_sid);
  const slats=Array.from({length:9},(_,i)=>`<rect x="${632+i*11}" y="40" width="6" height="360" fill="${p.wood}" opacity="${.55+((i%3)*.14)}"/>`).join('');
  const shelf=`<rect x="120" y="150" width="120" height="7" fill="${p.glow}" opacity=".85"/><rect x="120" y="230" width="120" height="7" fill="${p.glow}" opacity=".85"/>`;
  return `<svg viewBox="0 0 760 520" preserveAspectRatio="xMidYMid slice" class="scene">
  <defs>
    <linearGradient id="w1${U}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.wall}"/><stop offset="1" stop-color="${p.wall2}"/></linearGradient>
    <linearGradient id="f1${U}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.wall2}"/><stop offset="1" stop-color="${p.floor}"/></linearGradient>
    <linearGradient id="gl${U}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.glass}" stop-opacity=".34"/><stop offset="1" stop-color="#ffffff" stop-opacity=".07"/></linearGradient>
    <radialGradient id="lamp${U}"><stop offset="0" stop-color="${p.glow}" stop-opacity=".95"/><stop offset="1" stop-color="${p.glow}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="760" height="520" fill="url(#w1${U})"/>
  <rect y="380" width="760" height="140" fill="url(#f1${U})"/>
  <!-- ceiling cove -->
  <rect x="0" y="0" width="760" height="34" fill="#000" opacity=".2"/>
  <ellipse cx="380" cy="38" rx="330" ry="52" fill="url(#lamp${U})" opacity=".55"><animate attributeName="opacity" values=".4;.68;.4" dur="7s" repeatCount="indefinite"/></ellipse>
  <!-- window -->
  <rect x="452" y="118" width="74" height="150" fill="#cfe3e6" opacity=".82"/>
  <rect x="452" y="118" width="74" height="150" fill="none" stroke="#2b2b2b" stroke-width="5"/>
  <path d="M452 118h74v150" fill="#eaf4f2" opacity=".45"/>
  <!-- timber slat wall -->
  ${slats}
  <!-- niche shelves -->
  ${shelf}
  <!-- shower enclosure -->
  <rect x="40" y="70" width="330" height="330" fill="url(#gl${U})" stroke="#232323" stroke-width="5"/>
  <line x1="205" y1="70" x2="205" y2="400" stroke="#232323" stroke-width="4"/>
  <rect x="120" y="86" width="90" height="10" rx="4" fill="#2a2a2a"/>
  <line x1="165" y1="96" x2="165" y2="120" stroke="#2a2a2a" stroke-width="4"/>
  ${Array.from({length:7},(_,i)=>`<line x1="${132+i*11}" y1="100" x2="${132+i*11}" y2="${190+ (i%3)*26}" stroke="#ffffff" stroke-opacity=".5" stroke-width="2">
    <animate attributeName="y2" values="${170+(i%3)*20};${240+(i%3)*20};${170+(i%3)*20}" dur="${2.4+i*0.19}s" repeatCount="indefinite"/></line>`).join('')}
  <!-- towel -->
  <rect x="246" y="196" width="34" height="112" rx="5" fill="#f2efe8" opacity=".92"/>
  <!-- toilet -->
  <g transform="translate(380,236)">
    <rect x="-6" y="-30" width="74" height="42" rx="12" fill="#fbfaf7"/>
    <path d="M2 10c0 62 12 84 34 84s34-22 34-84z" fill="#fdfcfa"/>
    <ellipse cx="36" cy="12" rx="35" ry="13" fill="#eeeae2"/>
    <rect x="12" y="92" width="48" height="16" rx="6" fill="#efeae1"/>
  </g>
  <!-- vanity -->
  <g transform="translate(556,250)">
    <rect x="0" y="0" width="176" height="60" rx="5" fill="#25282c"/>
    <rect x="0" y="60" width="176" height="34" rx="4" fill="#1c1f22"/>
    <rect x="10" y="66" width="60" height="22" rx="3" fill="${p.wood}" opacity=".5"/>
    <rect x="30" y="-24" width="92" height="26" rx="10" fill="#fdfcfa"/>
    <rect x="132" y="-52" width="6" height="54" rx="3" fill="#2a2a2a"/>
    <rect x="112" y="-52" width="28" height="6" rx="3" fill="#2a2a2a"/>
    <rect x="-4" y="94" width="184" height="6" fill="#000" opacity=".22"/>
  </g>
  <!-- mirror -->
  <rect x="580" y="96" width="130" height="126" rx="4" fill="${p.glass}" opacity=".5" stroke="${p.glow}" stroke-width="3"/>
  <rect x="576" y="92" width="138" height="134" rx="6" fill="none" stroke="${p.glow}" stroke-width="2" opacity=".8">
    <animate attributeName="opacity" values=".35;.95;.35" dur="5.5s" repeatCount="indefinite"/></rect>
  <!-- plant -->
  <g transform="translate(700,196)"><path d="M0 40c-8-22 2-40 10-46 4 16 2 34-10 46z" fill="#4f6b4a"/><path d="M6 42c10-18 26-20 32-18-8 12-20 20-32 18z" fill="#617f58"/><rect x="-6" y="40" width="30" height="16" rx="3" fill="#d8d2c6"/></g>
  <!-- rug -->
  <ellipse cx="430" cy="446" rx="150" ry="28" fill="#000" opacity=".22"/>
  <rect x="300" y="428" width="240" height="40" rx="6" fill="${p.wood}" opacity=".4"/>
  <!-- floor reflection -->
  <rect y="380" width="760" height="140" fill="url(#gl${U})" opacity=".18"/>
  </svg>`;
}

