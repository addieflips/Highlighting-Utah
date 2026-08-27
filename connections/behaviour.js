
/* ---------------- text safety ---------------- */
/* Rule names and rule lines come out of claude/questions-map.md, which is prose Addie
   wrote — so they carry double quotes ("soft", "available", "no"), apostrophes, and the
   odd < or &. Interpolating one of those raw into an attribute ENDS the attribute:
   data-k="...still holds "available"?" truncated at the quote, dataset.k stopped matching
   the key drawRules() had built, and every block in the Rules view refused to open. That
   was the whole of "dropdown on rules is not working" — one rule name in ten carries a
   quote. Escape at every interpolation, NEVER at the source: the key has to stay the real
   name, because that is what S{} and jump() are keyed on. */
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
 .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
/* The map is markdown, so a line reads **The money follows the house.** with `fieldName`
   in backticks and ~~a superseded ruling~~ struck through. Rendered raw those markers are
   litter on the screen. Applied AFTER esc, so escaping stays the safety property and this
   is only ever decoration. */
const fmt=s=>esc(s).replace(/~~([^~]+)~~/g,'<s>$1</s>')
 .replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/`([^`]+)`/g,'<code>$1</code>');

/* ---------------- grid data ---------------- */
let gtab='Customers';
document.getElementById('picker').innerHTML=Object.keys(TABS).map((t,i)=>
 '<button data-t="'+esc(t)+'" aria-pressed="'+(t===gtab)+'">'+esc(t)+'</button>').join('');
document.getElementById('ghead').innerHTML='<th class="f">What it is</th><th class="rec">Stored on</th>'
 +DEST.map(d=>'<th>'+d.replace(' ','<br>')+'</th>').join('');
function drawGrid(){
 const T=TABS[gtab];
 document.getElementById('gnote').textContent=T.note;
 document.querySelectorAll('.picker button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.t===gtab));
 const tag={cust:['cust','Customer'],inv:['inv','Invoice']};
 document.getElementById('gbody').innerHTML=T.rows.map(r=>{
  let h='<tr><td class="f">'+fmt(r[0])+'</td><td class="rec"><span class="rt '+tag[r[1]][0]+'">'+tag[r[1]][1]+'</span></td>';
  for(let i=0;i<DEST.length;i++){const v=r[i+2]||'';
   const c=v==='s'?'set':v==='r'?'read':v==='x'?'bad':v==='w'?'wrn':'';
   h+='<td>'+(c?'<i class="cell '+c+'" data-f="'+esc(r[0])+'" data-d="'+esc(DEST[i])+'"></i>':'')+'</td>';}
  return h+'</tr>';}).join('');
 document.querySelectorAll('.cell[data-f]').forEach(c=>c.addEventListener('click',()=>{
  const d=document.getElementById('gdetail'),f=FAULTS[c.dataset.f+'|'+c.dataset.d];
  if(f){d.className='detail '+f[0];
   d.innerHTML='<b>'+fmt(f[1])+'</b><ul>'+f[2].map(x=>'<li>'+fmt(x)+'</li>').join('')+'</ul>'
    +'<button class="go" data-jf="'+esc(c.dataset.f)+'" data-jd="'+esc(c.dataset.d)+'">Open the rule this breaks →</button>';
   d.querySelector('.go').addEventListener('click',e=>jump(e.currentTarget.dataset.jf,e.currentTarget.dataset.jd));return;}
  const r=CELLRULES[c.dataset.f];d.className='detail';
  d.innerHTML=r?'<b>'+fmt(c.dataset.f)+' — '+fmt(r[0])+'</b><ul>'+r[1].map(x=>'<li>'+fmt(x)+'</li>').join('')+'</ul>'
   :'<b>'+fmt(c.dataset.f)+'</b>No rule written down for this one yet — which is itself worth knowing.';}));
}
document.getElementById('picker').addEventListener('click',e=>{const b=e.target.closest('button');if(b){gtab=b.dataset.t;drawGrid();}});

/* ---------------- rules data ---------------- */
const LABEL={new:'Not reviewed',ok:'Confirmed',flag:'Flagged as wrong',lapsed:'Changed since confirmed'};
const S={};Object.keys(RULES).forEach(a=>RULES[a].sections.forEach(s=>s[1].forEach(b=>
 S[a+'|'+b[0]]={s:b[2],proof:b[3],by:b[4],d:b[5],hi:b[6]})));
let rArea=null, rOpen={}, rHit=null;
const ks=a=>Object.keys(S).filter(k=>k.indexOf(a+'|')===0);
const c=(k,s)=>k.filter(x=>S[x].s===s).length;

function drawRules(){
 const v=document.getElementById('rules');
 if(!rArea){
  const all=Object.keys(S);
  const unread=all.filter(k=>S[k].s==='new');
  /* No unread rules is a real state — and reading unread[0] blind threw, which in a click
     handler means the whole view stops repainting with nothing on screen to say why. */
  const longest=unread.length?fmt(unread[0].split('|')[1])+', never.':'none — every rule has been read.';
  v.innerHTML='<div class="headline" style="border-color:rgba(255,255,255,.14);background:var(--panel)">'
   +'<b>Where to start</b>'+c(all,'flag')+' flagged as wrong · '+unread.length+' never read · '
   +c(all,'lapsed')+' changed since confirmed. '
   +'<span style="color:var(--dim)">Longest unread: <b style="color:var(--ink)">'+longest+'</b></span></div>'
   +'<div class="cards">'+Object.keys(RULES).map(a=>{
    const k=ks(a),p=Math.round(c(k,'ok')/k.length*100);
    const wd=k.filter(x=>S[x].proof==='words').length;
    return '<button class="areacard" data-a="'+esc(a)+'"><h3>'+esc(a)+'</h3>'
     +'<p class="of">'+c(k,'ok')+' of '+k.length+' confirmed</p><div class="trk"><i style="width:'+p+'%"></i></div>'
     +'<div class="tags">'+(c(k,'new')?'<span class="tg">'+c(k,'new')+' never read</span>':'')
     +(c(k,'lapsed')?'<span class="tg a">'+c(k,'lapsed')+' changed</span>':'')
     +(c(k,'flag')?'<span class="tg r">'+c(k,'flag')+' flagged</span>':'')
     +(wd?'<span class="tg w">'+wd+' not checkable</span>':'')+'</div></button>';}).join('')+'</div>';
 } else {
  let h='<button class="back">← All areas</button>';
  RULES[rArea].sections.forEach(sec=>{
   h+='<p class="sec">'+fmt(sec[0])+'</p>';
   sec[1].forEach(b=>{
    const key=rArea+'|'+b[0],st=S[key],o=!!rOpen[key];
    h+='<div class="block'+(o?' open':'')+(rHit===key?' hit':'')+'"><button class="blockbtn" data-k="'+esc(key)+'">'
     +'<span class="tw">'+(o?'▾':'▸')+'</span><span class="st '+st.s+'"></span><span class="nm">'+fmt(b[0])+'</span>'
     +'<span class="n">'+b[1].length+'</span></button>';
    if(o){
     h+='<div class="body"><ul class="rl">'+b[1].map(r=>'<li>'+fmt(r)+'</li>').join('')+'</ul>'
      +'<div class="prov"><b>Where this came from:</b> read out of the code by Claude, '
      +(st.proof==='code'?'and checkable — a test can prove it.':'but <b>not checkable</b> — no test can prove it.')
      +' Confirming means you checked it, not that you agree with me.</div>'
      +'<div class="rev"><span class="lab">'+LABEL[st.s]+(st.by?' · '+st.by+', '+st.d:'')+'</span>'
      +(st.hi==='high'?'<span class="locked">money rule — say what you checked against</span>':'')
      +'<button class="y" data-set="ok" data-k="'+esc(key)+'">Looks right</button>'
      +'<button class="n" data-set="flag" data-k="'+esc(key)+'">Something\u2019s wrong</button>'
      +(st.s==='flag'?'<span class="locked">→ sent back to the questions map for a new ruling</span>':'')
      +'</div></div>';}
    h+='</div>';});});
  v.innerHTML=h;
 }
 v.querySelectorAll('[data-a]').forEach(b=>b.addEventListener('click',()=>{rArea=b.dataset.a;drawRules();}));
 v.querySelectorAll('.back').forEach(b=>b.addEventListener('click',()=>{rArea=null;rHit=null;drawRules();}));
 v.querySelectorAll('.blockbtn').forEach(b=>b.addEventListener('click',()=>{rOpen[b.dataset.k]=!rOpen[b.dataset.k];drawRules();}));
 v.querySelectorAll('.rev button').forEach(b=>b.addEventListener('click',()=>{
  S[b.dataset.k]={...S[b.dataset.k],s:b.dataset.set,by:'Addie',d:'today'};drawRules();}));
}
function tab(which,btn){
 document.getElementById('grid').hidden=which!=='grid';
 document.getElementById('rules').hidden=which!=='rules';
 document.querySelectorAll('.subtabs button').forEach(b=>b.setAttribute('aria-selected',b===btn));
 if(which==='rules') drawRules();
}
function jump(field,dest){
 const f=FAULTS[field+'|'+dest]; if(!f) return;
 rArea=f[3]; rHit=f[3]+'|'+f[4]; rOpen[rHit]=true;
 tab('rules',document.querySelectorAll('.subtabs button')[1]);
 window.scrollTo({top:0,behavior:'smooth'});
}
drawGrid();

