
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
  let h='<tr data-fieldrow="'+esc(r[0])+'"><td class="f">'+fmt(r[0])+'</td><td class="rec"><span class="rt '+tag[r[1]][0]+'">'+tag[r[1]][1]+'</span></td>';
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
/* ⚠ TWO DIFFERENT FACTS, AND THEY WERE ONE FIELD UNTIL 2026-08-27. `status` is the
   ruling's own standing in the questions map — Standing, Superseded, Decided-not-built,
   Closed — and it decides which SECTION a block sits under. `s` is Addie's REVIEW of it,
   which is what the pill, the labels and every count on the area cards are about. Sharing
   one field meant "8 of 22 confirmed" was really counting rulings marked Closed in the
   map, which she has never looked at. rules.js says so in as many words — "a person
   confirming a block is a separate, later fact — it is never inferred from the map" —
   and the page was inferring it. */
const S={};Object.keys(RULES).forEach(a=>RULES[a].sections.forEach(s=>s[1].forEach(b=>
 S[a+'|'+b[0]]={s:'new',status:b[2],proof:b[3],by:b[4],d:b[5],hi:b[6],id:b[7],fp:b[8]})));

/* ---------------- saving her decisions ----------------
   This page is a plain file in an iframe with no database of its own, so the admin page
   holds the one Firestore path and this asks it. Opened full screen in its own tab there
   is no parent, and it SAYS so rather than taking a decision it cannot keep — a tick that
   silently evaporates on reload is worse than a button that is honest about being off. */
const bridge=(function(){
 try{ return (window.parent && window.parent!==window && typeof window.parent.hlxRuleDecide==='function')
  ? window.parent : null; }catch(e){ return null; } /* cross-origin: treat as standalone */
})();
function applyDecision(key,dec){
 const st=S[key]; if(!st||!dec) return;
 /* ⭐ A CONFIRMATION IS ABOUT A WORDING. Ruling rewritten since she ticked it → lapsed,
    never still-confirmed and never back to never-read: "changed since confirmed" is the
    one answer that tells her there is something to re-read. */
 if(dec.fp && st.fp && dec.fp!==st.fp){ st.s='lapsed'; st.by=dec.by||''; st.d=dec.at||''; return; }
 st.s=dec.verdict==='flag'?'flag':'ok'; st.by=dec.by||''; st.d=dec.at||'';
}
function loadDecisions(){
 if(!bridge) return;
 let saved=null;
 try{ saved=bridge.hlxRuleDecisions(); }catch(e){ saved=null; }
 if(!saved) return;
 Object.keys(S).forEach(k=>{ const d=saved[S[k].id]; if(d) applyDecision(k,d); });
}
let rArea=null, rOpen={}, rHit=null, rNote={};
const ks=a=>Object.keys(S).filter(k=>k.indexOf(a+'|')===0);
const c=(k,s)=>k.filter(x=>S[x].s===s).length;

function note(key,msg){ rNote[key]=msg; drawRules(); }
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
      +(rNote[key]?'<span class="locked">'+fmt(rNote[key])+'</span>':'')
      +'</div></div>';}
    h+='</div>';});});
  v.innerHTML=h;
 }
 v.querySelectorAll('[data-a]').forEach(b=>b.addEventListener('click',()=>{rArea=b.dataset.a;drawRules();}));
 v.querySelectorAll('.back').forEach(b=>b.addEventListener('click',()=>{rArea=null;rHit=null;drawRules();}));
 v.querySelectorAll('.blockbtn').forEach(b=>b.addEventListener('click',()=>{rOpen[b.dataset.k]=!rOpen[b.dataset.k];drawRules();}));
 /* ⚠ THE WRITE COMES FIRST AND THE PILL ONLY MOVES IF IT LANDED. Painting first and
    saving afterwards is the failure this whole page exists to catch, one level up: the
    row would read Confirmed on a decision the database refused, and she would find it
    unread again tomorrow with nothing having said why. */
 v.querySelectorAll('.rev button').forEach(b=>b.addEventListener('click',async()=>{
  const key=b.dataset.k, st=S[key], verdict=b.dataset.set;
  if(!bridge){ note(key,'Decisions save only from the admin page \u2014 open Connections there '
   +'rather than in its own tab, and this will stick.'); return; }
  b.disabled=true;
  try{
   const rec=await bridge.hlxRuleDecide(st.id,verdict,st.fp,key.split('|')[1],key.split('|')[0]);
   applyDecision(key,rec); rNote={}; drawRules();
  }catch(err){
   b.disabled=false;
   note(key,'Could not save that \u2014 it is left as it was. '+(err&&err.message?err.message:''));
  }}));
}
/* ⚠ FOUND BY ITS LABEL, NOT ITS POSITION (2026-08-29). Adding "The path" as the first tab
   moved every index by one and silently sent two jumps to the wrong view — the §7 slow-fuse
   shape, pinned to where a thing happens to sit rather than to what it is. */
function subtabBtn(name){
 return Array.prototype.find.call(document.querySelectorAll('.subtabs button'),
  function(b){ return b.textContent.trim().toLowerCase().indexOf(name) === 0; });
}
function tab(which,btn){
 document.getElementById('path').hidden=which!=='path';
 document.getElementById('grid').hidden=which!=='grid';
 document.getElementById('rules').hidden=which!=='rules';
 document.querySelectorAll('.subtabs button').forEach(b=>b.setAttribute('aria-selected',b===btn));
 if(which==='rules') drawRules();
 if(which==='path'){ bindPath(); drawPath(); }
}

/* ---- THE PATH — walked by clicking, not read as a list --------------------
 * Addie: "I was thinking we push on quotes than approve and it will show the different
 * routes in can go from there. So we can figure out the different navigations by clicking
 * on how things can go."
 *
 * So the state is a TRAIL, not a selected step: every click pushes, and the whole route
 * you have walked stays on screen above you. That is what makes two routes out of one
 * step comparable — you can see how you got here, back up one, and take the other.
 *
 * ⚠ BACKING UP TRUNCATES rather than popping one. Clicking a step you have already walked
 * through means "take me back to there", and leaving the tail behind it would show a trail
 * that is no longer the route you are on.
 */
/* ⚠ THE TRAIL STARTS EMPTY, AND THE FIRST SCREEN ASKS HOW THEY ARRIVED. There are three
   ways into the business — a quote, typed in by hand, or the master sheet — and opening on
   one of them would quietly claim everybody came that way, which is the gap Addie found by
   asking whether every route was drawn. */
let trail=[];
/* ⚠ DELEGATED, NOT INLINE. A step id or a field name pasted between quotes inside an
   onclick attribute is a syntax error the moment one of them carries an apostrophe, and
   the button then dies with nothing on screen and nothing in the console anybody looks
   at — the same fault the fault-link jump was rebuilt for. One listener on the host,
   bound once, reading data attributes.
   ⚠ BOUND ON THE HOST, WHICH IS NEVER REPLACED — drawPath rewrites its innerHTML on
   every click, so a listener on any button inside it would be destroyed and re-bound
   each time, and re-binding on the host is how listeners accumulate. */
function bindPath(){
 const host=document.getElementById('path');
 if(!host||host._jbound) return;
 host._jbound=true;
 host.addEventListener('click',function(ev){
  const go=ev.target.closest('[data-jgo]');
  if(go){ pathGo(go.getAttribute('data-jgo')); return; }
  const fld=ev.target.closest('[data-jfield]');
  if(fld){ pathField(fld.getAttribute('data-jfield')); return; }
  if(ev.target.closest('[data-jreset]')) pathReset();
 });
}
function pathGo(id){
 const at=trail.indexOf(id);
 if(at!==-1) trail=trail.slice(0,at+1); else trail.push(id);
 drawPath();
}
function pathReset(){ trail=[]; drawPath(); }
function drawPath(){
 const host=document.getElementById('path'); if(!host) return;
 if(!trail.length){
  host.innerHTML=
   '<div class="headline"><b>Follow a customer through.</b> Start with how they reached '+
    'us, then press whatever happens next — where a customer has a choice, so does this '+
    'page.</div>'+
   '<p class="jnexthead">How did this customer arrive?</p><div class="jnexts">'+
   JSTARTS.map(function(id){
    const s=JSTEPS[id]||{title:id,plain:''};
    return '<button type="button" class="jnext" data-jgo="'+esc(id)+'">'+
     '<span class="jlabel">'+esc(s.plain||'')+'</span>'+
     '<span class="jto">'+esc(s.title)+' ›</span></button>';
   }).join('')+'</div>';
  return;
 }
 const here=JSTEPS[trail[trail.length-1]];
 if(!here){ host.innerHTML='<p class="note">That step is not on the map.</p>'; return; }
 /* The route so far. Every step on it is clickable, which is how you back up. */
 const crumbs=trail.map(function(id,i){
  const s=JSTEPS[id]||{title:id};
  return '<button type="button" class="jcrumb'+(i===trail.length-1?' now':'')+
   '" data-jgo="'+esc(id)+'">'+esc(s.title)+'</button>';
 }).join('<span class="jarrow">›</span>');
 /* ⚠ THE FIELDS THAT RECORD THIS STEP ARE THE LINK BACK TO THE GRID. The one-level view
    is not thrown away — it is what you get when you click into a step. */
 const recs=(here.records||[]).map(function(f){
  return '<button type="button" class="jfield" data-jfield="'+esc(f)+'">'+esc(f)+'</button>';
 }).join(' ');
 const outs=(here.next||[]).map(function(e){
  const t=JSTEPS[e.to]||{title:e.to};
  return '<button type="button" class="jnext" data-jgo="'+esc(e.to)+'">'+
   '<span class="jlabel">'+esc(e.label)+'</span>'+
   '<span class="jto">'+esc(t.title)+' ›</span></button>';
 }).join('');
 host.innerHTML=
  '<div class="headline"><b>Follow a customer through.</b> Start at the top and press '+
   'whatever happens next — where a customer has a choice, so does this page.</div>'+
  '<div class="jtrail">'+crumbs+(trail.length>1?
   ' <button type="button" class="jreset" data-jreset="1">start again</button>':'')+'</div>'+
  '<div class="jcard'+(here.built===false?' unbuilt':'')+'">'+
   '<h2>'+esc(here.title)+'</h2>'+
   (here.built===false?'<p class="jwarn">Not built yet — this is how it should work, '+
     'not how it works today.</p>'+
     (here.notBuilt?'<p class="jwarn jwhat">'+esc(here.notBuilt)+'</p>':''):'')+
   '<p class="jplain">'+esc(here.plain||'')+'</p>'+
   (recs?'<p class="jrec">Recorded as '+recs+'</p>':
     '<p class="jrec dim">Nothing on the record marks this step.</p>')+
  '</div>'+
  (outs?'<p class="jnexthead">'+(here.next.length===1?'Then:':'From here it can go '+
    here.next.length+' ways:')+'</p><div class="jnexts">'+outs+'</div>'
   :'<p class="jnexthead">This is where the journey ends.</p>');
}
/* Clicking a field on a step takes you to that field's row on the grid — the same one
   level in it has always been, arrived at through the journey instead of down a list. */
function pathField(field){
 /* ⚠ THE GRID IS SPLIT INTO TABS, so the row may not be in the one currently showing —
    jumping without switching lands on nothing and reads as a dead button. The tab holding
    the field is found first, and a field on no tab says so rather than failing silently:
    that means it is dated on the journey and not watched on the grid, which is worth
    seeing rather than hiding. */
 let found='';
 Object.keys(TABS).forEach(function(t){
  if(!found && (TABS[t].rows||[]).some(function(r){ return r[0]===field; })) found=t;
 });
 tab('grid',subtabBtn('where things go'));
 if(!found){
  document.getElementById('gdetail').textContent=
   field+' is dated on the path but is not watched here yet.';
  return;
 }
 gtab=found; drawGrid();
 const row=document.querySelector('[data-fieldrow="'+field+'"]');
 if(row){ row.scrollIntoView({block:'center',behavior:'smooth'}); row.classList.add('flash');
  setTimeout(function(){ row.classList.remove('flash'); },1600); }
}
function jump(field,dest){
 const f=FAULTS[field+'|'+dest]; if(!f) return;
 rArea=f[3]; rHit=f[3]+'|'+f[4]; rOpen[rHit]=true;
 tab('rules',subtabBtn('rules'));
 window.scrollTo({top:0,behavior:'smooth'});
}
loadDecisions();
/* ⚠ THE PATH IS THE TAB THAT OPENS, so it has to be drawn on load — reached only through
   tab() it would render an empty panel until somebody clicked away and back, which reads
   as the page being broken. The grid is still drawn here too: it is hidden, not absent,
   and drawing it now means a jump from a step lands on a table that already has rows. */
bindPath();
drawPath();
drawGrid();

