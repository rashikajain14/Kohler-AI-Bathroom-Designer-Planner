/* =================== COLLECTION PAGE =================== */
const CAT_ORDER = ['Smart Toilet','Rain Shower','Bathtub','Faucet','Vanity','Mirror','Storage','Accessories','Ventilation'];
const CATS = ['All', ...CAT_ORDER.filter(c => PRODUCTS.some(p => p.cat === c)), ...[...new Set(PRODUCTS.map(p => p.cat))].filter(c => !CAT_ORDER.includes(c))];
const filters = document.getElementById('filters');
CATS.forEach((c, i) => {
  const b = document.createElement('button');
  b.className = 'fchip' + (i === 0 ? ' on' : ''); b.textContent = c;
  b.setAttribute('aria-pressed', i === 0);
  b.onclick = () => {
    [...filters.children].forEach(x => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
    b.classList.add('on'); b.setAttribute('aria-pressed', 'true');
    document.querySelectorAll('.bigcard').forEach(card => {
      const show = (c === 'All' || card.dataset.cat === c);
      card.classList.toggle('hidden', !show);
      if(show){ card.style.animation = 'none'; void card.offsetWidth; card.style.animation = 'pagein .5s cubic-bezier(.2,.8,.3,1)'; }
    });
    track('catalog_filter', { category: c });
  };
  filters.appendChild(b);
});
document.getElementById('catCount').textContent = PRODUCTS.length;

const productFig = p => p.image
  ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" style="width:78%;height:78%;object-fit:contain;position:relative;z-index:2">`
  : `<div style="width:66%;height:66%;position:relative;z-index:2">${ART[p.art].replace('<svg', '<svg class="art" style="width:100%;height:100%" role="img" aria-label="' + esc(p.name) + '"')}</div>`;
document.getElementById('catalog').innerHTML = PRODUCTS.map(p => `
 <article class="bigcard reveal" data-cat="${esc(p.cat)}">
   <div class="fig">${productFig(p)}</div>
   <div class="body">
     <div class="cat">${esc(p.cat)}</div>
     <h4>${esc(p.name)}</h4>
     <p>${esc(p.desc)}</p>
     <div class="specs">${p.specs.map(s => `<span>${esc(s)}</span>`).join('')}</div>
     <div class="price-row"><span class="p">${inr(p.price)}</span>
       <button class="addbtn" data-id="${esc(p.id)}" aria-pressed="false">Shortlist</button></div>
   </div>
 </article>`).join('');

function paintShortlistButtons(){
  document.querySelectorAll('.addbtn').forEach(b => {
    const on = SHORT.ids.includes(b.dataset.id);
    b.textContent = on ? 'Shortlisted ✓' : 'Shortlist';
    b.classList.toggle('added', on); b.setAttribute('aria-pressed', on);
  });
}
document.querySelectorAll('.addbtn').forEach(b => b.onclick = () => { toggleShortlist(b.dataset.id); paintShortlistButtons(); });
paintShortlistButtons();

/* ---------- three designs side by side: every number is a real solve of the CURRENT room ---------- */
const CMP_LABEL = { 'Smart Toilet':'Toilet', 'Rain Shower':'Shower', 'Bathtub':'Bathtub', 'Faucet':'Faucet', 'Vanity':'Vanity', 'Mirror':'Mirror', 'Storage':'Storage', 'Accessories':'Accessories', 'Ventilation':'Ventilation' };
function paintCompare(){
  const designs = AES_KEYS.slice(0, 3).map(k => ({ k, name: AES[k].name, L: solve({ ...STATE, aesthetic: k, prefer: [] }) }));
  const cats = CAT_ORDER.filter(c => designs.some(d => d.L.products.some(p => p.cat === c)));
  const muted = 'style="color:var(--muted);font-size:12px"';
  const rows = cats.map(cat => `<tr><td ${muted}>${CMP_LABEL[cat] || cat}</td>${designs.map(d => {
    const ps = d.L.products.filter(p => p.cat === cat);
    return `<td>${ps.map(p => `${esc(p.name.replace('KOHLER ', ''))}<div ${muted}>${inr(p.price)}</div>`).join('') || '—'}</td>`;
  }).join('')}</tr>`).join('');
  const w = STATE.room;
  document.getElementById('cmpNote').textContent =
    `Same ${w.L / 12} × ${w.W / 12} ft room, back wall facing ${STATE.face.toLowerCase()}, ${inr(STATE.budget)} budget — the room and choices you set in the designer. Each column is a full solve, so the totals include everything the layout specifies. What changes is the material story and where the money goes.`;
  document.getElementById('cmp').innerHTML = `
   <thead><tr><th>Element</th>${designs.map(d => `<th>${esc(d.name)}</th>`).join('')}</tr></thead>
   <tbody>${rows}
    <tr><td ${muted}>Fixture total</td>${designs.map(d => `<td><b>${inr(d.L.total)}</b><div ${muted}>${d.L.metrics.budgetOK ? 'within budget' : 'over budget'}</div></td>`).join('')}</tr>
    <tr><td ${muted}>Layout score</td>${designs.map(d => `<td>${d.L.score}%</td>`).join('')}</tr>
    <tr><td ${muted}>Space fit</td>${designs.map(d => `<td>${d.L.fit}%</td>`).join('')}</tr>
    <tr><td ${muted}>Vastu</td>${designs.map(d => `<td>${d.L.vastuStats ? `${d.L.vastuStats.preferred} of ${d.L.vastuStats.ruled} in preferred zones` : 'Off'}</td>`).join('')}</tr>
   </tbody>`;
}
