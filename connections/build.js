/* GENERATE connections.html
 * =========================
 * `node connections/build.js` — writes connections.html at the repo root.
 *
 * The look is `connections-mockup-5.html`, which Addie approved. Its stylesheet is kept
 * verbatim in connections/style.css and its renderer is reproduced below; the only thing
 * that changes is that every result is REAL. The mockup's own banner said "every result
 * is invented, so you can see what a break looks like" — this replaces the invented half.
 *
 * ⚠ THE PAGE MUST STATE ITS OWN COVERAGE, and that is not decoration. A map that looks
 * complete and is not is worse than no map: somebody reads a green tab and concludes the
 * tab is fine, when all it means is that nobody has declared anything about it yet. The
 * header says how many things are watched, that nothing appears until a person adds it,
 * and — the important one — that it can only tell whether a connection EXISTS, never
 * whether it is right.
 *
 * ⚠ TABS AND SUB-TABS ARE DERIVED FROM THE `where` FIELDS, never typed twice. A spine
 * that says 'Customers › Bulk Updates' puts itself under Customers, in Bulk Updates. A
 * hand-written tab list would be a second thing to keep true, and the one that goes
 * stale is the one nobody is looking at.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { check } = require('./engine');

const ROOT = path.join(__dirname, '..');
const FILES = {
  admin: path.join(ROOT, 'admin.html'),
  server: path.join(ROOT, 'functions', 'index.js'),
  site: path.join(ROOT, 'index.html')
};

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* 'Customers › Bulk Updates' → ['Customers','Bulk Updates']. A `where` with no ›
   (the server, "everywhere") becomes its own tab with one sub-tab of the same name,
   which is honest: those really are one place. */
function split(where) {
  const bits = String(where || '').split('›').map(s => s.trim()).filter(Boolean);
  if (!bits.length) return ['Elsewhere', 'Elsewhere'];
  return bits.length === 1 ? [bits[0], bits[0]] : [bits[0], bits.slice(1).join(' › ')];
}

const slug = s => 'n' + String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function build() {
  const report = check(FILES, require('./manifest'));

  const nodes = {};          // id -> node object, as the mockup's N{}
  const tabs = {};           // tab name -> { subs: {subName: [thingIds]} }
  const flags = [];          // what is broken, for the top bar

  const tabFor = (tab, sub) => {
    tabs[tab] = tabs[tab] || { subs: {} };
    tabs[tab].subs[sub] = tabs[tab].subs[sub] || [];
    return tabs[tab].subs[sub];
  };

  /* ⚠ check() returns {spine, rows, undeclared, undeclaredTotal} — the declaration is
     NESTED, not the result itself. Reading `.field` off the wrapper gave every node an
     id of "nundefined" and silently collapsed all three spines into one box. It looked
     like a rendering bug and was a destructuring one. */
  report.forEach(result => {
    const spine = result.spine;
    const sets = result.rows.filter(r => r.side === 'sets');
    const reads = result.rows.filter(r => r.side === 'reads');
    const redRows = result.rows.filter(r => !r.found);

    /* Each READER becomes a destination box. A reader that is declared and found is a
       place this really lands; one that is declared and NOT found is drawn as
       "never reaches", which is the whole point of the picture. */
    /* ⚠ ONE BOX PER PLACE, NOT PER READER. Four functions read needsLightBuild inside
       Warehouse › Build — the queue, the colour totals and the pending count among them
       — and a box each drew "Warehouse › Build" four times in a column, which reads as
       four destinations when it is one. Merged by WHERE, with each reader's `when` kept
       so the drawer can still say what happens there. A place is red if ANY reader
       declared for it is missing: one broken reader means that destination is not fully
       reached, and averaging it away is how a break hides. */
    const byPlace = {};
    reads.forEach(r => {
      const id = slug(spine.field + '_to_' + r.where);
      if (!byPlace[id]) {
        byPlace[id] = {
          id, t: r.where, kids: [], whens: [], rules: [], missing: []
        };
      }
      const p = byPlace[id];
      if (r.when) p.whens.push(r.when);
      (r.rules || []).forEach(x => p.rules.push(x));
      if (!r.found) p.missing.push(r.why);
    });
    const kids = Object.keys(byPlace).map(id => {
      const p = byPlace[id];
      const broken = p.missing.length > 0;
      nodes[id] = {
        id, t: p.t, k: broken ? 'never reaches' : 'lands in',
        s: broken ? 'brk' : null, kids: [],
        when: p.whens.join(' · '), why: p.missing.join(' · '), rules: p.rules
      };
      return id;
    });

    /* One "watched thing" node per spine, hung under the sub-tab of its FIRST declared
       writer — that is where somebody would go looking for it. */
    const thingId = slug(spine.field);
    const anyRed = redRows.length > 0;
    nodes[thingId] = {
      id: thingId, t: spine.title || spine.field, k: anyRed ? 'should set' : 'sets',
      kids, st: anyRed ? 'brk' : (result.undeclared.length ? 'wrn' : 'ok'),
      also: sets.length > 1 ? sets.length + ' places' : null,
      where: sets.length ? sets[0].where : 'Elsewhere',
      field: spine.field,
      plain: spine.plain,
      on: sets.map(r => [r.where, r.when, r.found ? '' : 'bad']),
      off: [],
      rules: [].concat.apply([], result.rows.map(r => r.rules || [])).slice(0, 6),
      undeclared: result.undeclared,
      bad: anyRed
        ? redRows.map(r => r.where + ' — ' + r.why).join(' · ')
        : null,
      src: 'declared by hand, checked against the code on every run'
    };

    if (anyRed) {
      redRows.forEach(r => {
        const [tab] = split(r.where);
        flags.push({ kind: 'brk', tab, title: spine.field + ' — ' + r.why, path: r.where });
      });
    }

    /* Place the thing under every sub-tab that writes or reads it, so a tab shows what
       it actually touches rather than only what it originates. */
    result.rows.forEach(r => {
      const [tab, sub] = split(r.where);
      const list = tabFor(tab, sub);
      if (list.indexOf(thingId) === -1) list.push(thingId);
    });
  });

  /* Sub-tab nodes, then roots.
     ⚠ ORDERED THE WAY THE ADMIN SIDEBAR IS, not alphabetically. A–Z put Automation
     Emails first and Customers fourth, which is nobody's mental model of this business
     and made the page open on a corner of it. Anything not on this list keeps its
     alphabetical place at the end rather than being dropped. */
  const TAB_ORDER = ['Customers', 'Quote Requests', 'Routes', 'Schedule', 'Warehouse',
                     'Customer Numbers', 'Invoices', 'Automation Emails', 'Member Portal'];
  const tabRank = t => { const i = TAB_ORDER.indexOf(t); return i === -1 ? TAB_ORDER.length : i; };
  const roots = {};
  Object.keys(tabs).sort((a, b) => tabRank(a) - tabRank(b) || a.localeCompare(b)).forEach(tab => {
    const subIds = [];
    Object.keys(tabs[tab].subs).sort().forEach(sub => {
      const id = slug(tab + '__' + sub);
      nodes[id] = { id, t: sub, k: 'sub-tab', subtab: true, kids: tabs[tab].subs[sub] };
      subIds.push(id);
    });
    roots[slug(tab)] = { t: tab, kids: subIds };
  });

  const watched = report.length;
  const amber = report.reduce((a, s) => a + s.undeclaredTotal, 0);
  const red = flags.filter(f => f.kind === 'brk').length;

  return { nodes, roots, flags, watched, amber, red, report };
}

/* ------------------------------------------------------------------------- */
function render(m) {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  const headline = m.red
    ? m.red + (m.red === 1 ? ' connection is missing' : ' connections are missing')
    : 'Nothing declared is missing';

  const flagList = m.flags.length
    ? m.flags.map(f =>
        '<li><button data-go="' + esc(slug(f.tab)) + '"><b>' + esc(f.title) + '</b>' +
        '<span class="path">' + esc(f.path) + '</span></button></li>').join('')
    : '<li><button class="wrn" data-go="' + esc(Object.keys(m.roots)[0]) + '"><b>' +
      'Every declared connection was found in the code</b><span class="path">' +
      m.amber + ' undeclared touches are listed on each box &mdash; amber, not a failure' +
      '</span></button></li>';

  const railTabs = Object.keys(m.roots).map(function (k) {
    const r = m.roots[k];
    const worst = r.kids.reduce(function (w, id) {
      const st = worstOf(m.nodes, id);
      return st === 'brk' ? 'brk' : (st === 'wrn' && w !== 'brk' ? 'wrn' : w);
    }, null);
    const dot = worst === 'brk' ? 'bad' : worst === 'wrn' ? 'warn' : 'ok';
    const subs = r.kids.map(function (id) {
      const st = worstOf(m.nodes, id);
      return '<li class="' + (st === 'brk' ? 'bad' : st === 'wrn' ? 'wrn' : '') + '">' +
        esc(m.nodes[id].t) + '</li>';
    }).join('');
    return '<button class="tabbtn" data-go="' + esc(k) + '">' +
      '<span class="dot ' + dot + '"></span>' + esc(r.t) + '</button>' +
      '<ul class="subs">' + subs + '</ul>';
  }).join('');

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>Connections — Highlighting Utah</title>\n' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=Public+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">\n' +
    '<style>\n' + css + '\n</style>\n</head>\n<body>\n' +
    '<div class="mock">Watches ' + m.watched + ' thing' + (m.watched === 1 ? '' : 's') +
      ' · nothing appears here until a person declares it · ' +
      'it can tell whether a connection EXISTS, never whether it is right</div>\n' +
    '<div class="flag"><h2>' + esc(headline) + '</h2><ul>' + flagList + '</ul></div>\n' +
    '<div class="shell">\n<nav class="rail">\n<h1>Connections</h1>\n' +
    '<p class="sub">Pick a tab. Click a box for its rules.</p>\n' +
    '<div class="sec">Watched</div>\n' + railTabs + '\n</nav>\n' +
    '<main class="stage"><div class="stagehead"><h2 id="title"></h2>' +
    '<span class="hint">tab › sub-tab › what it sets › where it lands</span></div>' +
    '<ul class="chart" id="chart"></ul></main>\n' +
    '<aside class="drawer" id="drawer"></aside>\n</div>\n' +
    '<script>\nconst N=' + JSON.stringify(m.nodes) + ';\n' +
    'const ROOTS=' + JSON.stringify(m.roots) + ';\n' +
    RUNTIME + '\n</script>\n</body>\n</html>\n';
}

function worstOf(nodes, id) {
  const o = nodes[id];
  if (!o) return null;
  if (o.st === 'brk' || o.s === 'brk') return 'brk';
  let w = (o.st === 'wrn' || o.s === 'wrn') ? 'wrn' : null;
  (o.kids || []).forEach(function (k) {
    const b = worstOf(nodes, k);
    if (b === 'brk') w = 'brk'; else if (b === 'wrn' && w !== 'brk') w = 'wrn';
  });
  return w;
}

/* The mockup's own renderer, unchanged in behaviour — inlined so the page is one
   self-contained file with no fetch. */
const RUNTIME = `
function bad(id){const o=N[id];if(!o)return null;
  if(o.st==='brk'||o.s==='brk')return 'brk';
  let w=(o.st==='wrn'||o.s==='wrn')?'wrn':null;
  (o.kids||[]).forEach(k=>{const b=bad(k);if(b==='brk')w='brk';else if(b==='wrn'&&w!=='brk')w='wrn';});
  return w;}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function box(o,cls,trail){
  const own=(o.st==='brk'||o.s==='brk')?' brk':(o.st==='wrn'||o.s==='wrn')?' wrn':'';
  const tr=!own&&trail==='brk'?' trail':!own&&trail==='wrn'?' trailw':'';
  return '<button class="card'+(cls||'')+own+tr+'" data-id="'+(o.id||'')+'">'
    +(o.also?'<span class="also">'+esc(o.also)+'</span>':'')
    +'<span class="kind">'+esc(o.k||'')+'</span><span class="ttl">'+esc(o.t)+'</span></button>';}
function branch(id){const o=N[id],t=bad(id);
  const own=(o.st==='brk'||o.s==='brk');
  return '<li class="'+(t==='brk'?'trail ':'')+(own?'snap ':'')+'">'+box(o,'',t)
    +(o.kids&&o.kids.length?'<ul>'+o.kids.map(branch).join('')+'</ul>':'')+'</li>';}
function rowsOf(l){return (l||[]).map(function(r){const c=r[2]?' '+r[2]:'';
  return '<tr><td><span class="chip'+c+'">'+esc(r[0])+'</span></td><td class="when">'+esc(r[1]||'')+'</td></tr>';}).join('');}
function openRules(id){
  const o=N[id],d=document.getElementById('drawer');
  document.querySelectorAll('.card').forEach(c=>c.classList.remove('sel'));
  document.querySelectorAll('.card[data-id="'+id+'"]').forEach(c=>c.classList.add('sel'));
  if(!o){d.innerHTML='';return;}
  if(!o.rules){
    d.innerHTML='<p class="dk">'+esc(o.k)+'</p><h3>'+esc(o.t)+'</h3>'
      +(o.why?'<span class="state bad">Not found</span><ul class="rules"><li class="no">'+esc(o.why)+'</li></ul>':'')
      +'<p class="empty">'+(o.subtab?'A sub-tab. Its connections branch to the right.'
        :(o.when?esc(o.when):'A screen at the end of a run.'))+'</p>';
    return;}
  const s=o.st==='brk'?['bad','Missing']:o.st==='wrn'?['wrn','Undeclared writers']:['ok','Connected'];
  d.innerHTML='<p class="dk">'+esc(o.k)+'</p><h3>'+esc(o.t)+'</h3>'
    +'<p class="where">'+esc(o.where||'')+(o.field?' \\u00b7 <code>'+esc(o.field)+'</code>':'')+'</p>'
    +'<span class="state '+s[0]+'">'+s[1]+'</span>'
    +(o.plain?'<p class="where">'+esc(o.plain)+'</p>':'')
    +(o.bad?'<ul class="rules"><li class="no">'+esc(o.bad)+'</li></ul>':'')
    +'<table><caption>Written by</caption><thead><tr><th>Where</th><th>When</th></tr></thead><tbody>'+rowsOf(o.on)+'</tbody></table>'
    +((o.rules&&o.rules.length)?'<table><caption>Rules</caption></table><ul class="rules">'
      +o.rules.map(function(r){return '<li>'+esc(r)+'</li>';}).join('')+'</ul>':'')
    +((o.undeclared&&o.undeclared.length)?'<table><caption>Touched here, never declared</caption></table><ul class="rules">'
      +o.undeclared.map(function(u){return '<li class="src">'+esc(u)+'</li>';}).join('')+'</ul>':'')
    +'<ul class="rules"><li class="src">'+esc(o.src||'')+'</li></ul>';}
function draw(key,focus){
  const r=ROOTS[key];if(!r)return;
  document.querySelectorAll('.tabbtn').forEach(function(b){
    b.setAttribute('aria-current', b.dataset.go===key?'true':'false');});
  document.getElementById('title').textContent=r.t;
  const t=r.kids.some(k=>bad(k)==='brk')?'brk':r.kids.some(k=>bad(k)==='wrn')?'wrn':null;
  document.getElementById('chart').innerHTML='<li class="'+(t==='brk'?'trail':'')+'">'
    +box({t:r.t,k:'this tab'},' root',t)
    +(r.kids.length?'<ul>'+r.kids.map(branch).join('')+'</ul>':'')+'</li>';
  document.querySelectorAll('.chart .card').forEach(function(c){
    c.addEventListener('click',function(){openRules(c.dataset.id);});});
  if(focus) openRules(focus);
  else document.getElementById('drawer').innerHTML='<p class="dk">Rules</p><h3>Click a box</h3>'
    +'<p class="empty">Where it is written, what must always be true, and anything touching it that nobody declared.</p>';}
document.querySelectorAll('[data-go]').forEach(function(b){
  b.addEventListener('click',function(){draw(b.dataset.go);});});
(function(){
  /* Open on whatever needs attention. A page that opens on a healthy corner buries the
     one thing somebody came here to see. */
  var first=Object.keys(ROOTS)[0];
  var broken=Object.keys(ROOTS).filter(function(k){
    return ROOTS[k].kids.some(function(i){return bad(i)==='brk';});})[0];
  draw(broken||first);
})();
`;

if (require.main === module) {
  const m = build();
  const out = path.join(ROOT, 'connections.html');
  fs.writeFileSync(out, render(m));
  console.log('connections.html written — ' + m.watched + ' watched, ' +
    m.red + ' red, ' + m.amber + ' undeclared touches');
}
module.exports = { build, render };
