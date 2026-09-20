/* =================== BRAND LOGO ANIMATION =================== */
(function(){
  const el=document.getElementById('logo');
  "KOHLER".split("").forEach((c,i)=>{
    const s=document.createElement('span');
    s.textContent=c;
    s.style.cssText=`opacity:0;transform:translateY(10px);animation:fade .5s ${0.05*i}s forwards, rise .6s ${0.05*i}s cubic-bezier(.16,1,.3,1) forwards`;
    el.appendChild(s);
  });
})();

/* =================== THEME =================== */
const root=document.documentElement;
document.getElementById('themeBtn').onclick=()=>{
  const cur=root.getAttribute('data-theme')||'light';
  root.setAttribute('data-theme',cur==='light'?'dark':'light');
};

/* =================== ROUTER =================== */
const pages=['home','designer','products'];
function route(){
  let h=(location.hash||'#/home').replace('#/','');
  if(!pages.includes(h))h='home';
  pages.forEach(p=>document.getElementById('page-'+p).classList.toggle('live',p===h));
  document.querySelectorAll('.nav-links a').forEach(a=>a.classList.toggle('on',a.getAttribute('href')==='#/'+h));
  window.scrollTo({top:0,behavior:'instant'});
  paintTray();
  track('page',{page:h});
  setTimeout(observeAll,60);
  if(h==='designer')setTimeout(()=>render(true),80);
  if(h==='products')paintCompare();
}
addEventListener('hashchange',route);

/* =================== SCROLL REVEAL =================== */
const io=new IntersectionObserver(es=>{
  es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');
    if(e.target.id==='statBlock')countUp();
    io.unobserve(e.target);}});
},{threshold:.18});
function observeAll(){document.querySelectorAll('.reveal:not(.in),.tl:not(.in)').forEach(n=>io.observe(n));}

function countUp(){
  document.querySelectorAll('.stat .n').forEach(n=>{
    const to=+n.dataset.to, suf=n.dataset.suf||'', plain=n.dataset.plain;
    let t0=null;
    const step=ts=>{
      if(!t0)t0=ts;
      const p=Math.min((ts-t0)/1400,1), e=1-Math.pow(1-p,3);
      n.textContent=(plain?Math.round(to*e):Math.round(to*e).toLocaleString('en-IN'))+suf;
      if(p<1)requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/* =================== MARQUEE =================== */
(function(){
  const words=["Gracious Living","The Bold Look","Kohler, Wisconsin","Veil Intelligent Toilet","Awaken Shower System","Artifacts","Verdera","Since 1873","Come All Creators"];
  const t=document.getElementById('mq');
  t.innerHTML=[...words,...words].map(w=>`<span>${w}</span>`).join('');
})();

/* =================== RIPPLES =================== */
document.addEventListener('click',e=>{
  const b=e.target.closest('.btn');
  if(!b)return;
  const r=document.createElement('span');
  const rect=b.getBoundingClientRect(), d=Math.max(rect.width,rect.height);
  r.className='ripple';
  r.style.cssText=`width:${d}px;height:${d}px;left:${e.clientX-rect.left-d/2}px;top:${e.clientY-rect.top-d/2}px`;
  b.appendChild(r); setTimeout(()=>r.remove(),620);
});

