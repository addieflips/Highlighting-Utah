/* Builds a standalone page that runs the REAL Measure Roof code against real
   Google data, with no login and no deploy. Not part of the site - never
   committed, never linked. It exists so a change can be tried on an actual
   house in seconds instead of a merge and a deploy each time.

   Everything it runs is lifted verbatim out of admin.html. Nothing is
   re-implemented here, because a harness that reimplements the thing it is
   testing tests the harness. */
const fs = require('fs');
const src = fs.readFileSync('admin.html', 'utf8');

function between(startMarker, endMarker, label) {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a + 1);
  if (a === -1 || b === -1) throw new Error('could not find ' + label + ' (' + a + ',' + b + ')');
  return src.slice(a, b);
}

/* --- the overlay markup, balanced by counting divs --- */
function elementAt(startIdx) {
  let i = src.indexOf('>', startIdx) + 1, depth = 1;
  const re = /<(\/?)div\b/g;
  re.lastIndex = i;
  let m;
  while ((m = re.exec(src))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return src.slice(startIdx, src.indexOf('>', m.index) + 1);
  }
  throw new Error('unbalanced overlay markup');
}
const overlay = elementAt(src.indexOf('<div class="editcust-popup-overlay" id="roofMeasureOverlay"'));

/* --- the styles the overlay leans on --- */
const styles = (src.match(/<style[\s\S]*?<\/style>/g) || []).join('\n');

/* --- the code --- */
const measure = between('/* ================= MEASURE ROOF (from a quote) =====',
                        '/* ---------------- DASHBOARD & EXPENSES ----------------', 'measure block');

function fnNamed(name) {
  const re = new RegExp('(?:^|\\n)(?:async )?function ' + name + '\\s*\\(', 'g');
  const m = re.exec(src);
  if (!m) throw new Error('no function ' + name);
  let i = src.indexOf('{', m.index + m[0].length - 1), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(m.index, j + 1); }
  }
  throw new Error('unterminated ' + name);
}
/* Pull in what the measure block calls, then what THOSE call, until nothing
   new turns up. Naming the helpers by hand is how the first build shipped
   without getGeocoder and then reported "could not find that address" - a
   harness gap wearing a product bug's clothes, which is the one thing a
   harness must never do. */
function definedFns(text) {
  const out = new Set();
  const re = /(?:^|\n)(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/g;
  let m; while ((m = re.exec(text))) out.add(m[1]);
  return out;
}
const ALL = definedFns(src);
const PROVIDED = new Set(['esc', 'showToast', 'logAudit']);
function calledNames(text) {
  const out = new Set();
  /* Skip anything preceded by a dot - obj.method() is not a global. */
  const re = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  let m; while ((m = re.exec(text))) out.add(m[1]);
  return out;
}
const picked = new Map();
let frontier = calledNames(measure);
for (let round = 0; round < 12; round++) {
  const next = new Set();
  let added = 0;
  frontier.forEach(n => {
    if (picked.has(n) || PROVIDED.has(n) || !ALL.has(n)) return;
    let body; try { body = fnNamed(n); } catch (e) { return; }
    picked.set(n, body); added++;
    calledNames(body).forEach(x => next.add(x));
  });
  if (!added) break;
  frontier = next;
}
console.log('pulled in ' + picked.size + ' helper functions');
const deps = [...picked.values()].join('\n');

const cfg = between('const firebaseConfig = {', '};', 'firebaseConfig') + '};';
/* ⚠ THE HARNESS LOADS MAPS WITH THE FIREBASE KEY, NOT THE SCRIPT-TAG KEY.
   The shipped page is untouched and still uses its own. The reason: the two
   keys carry different referrer lists, and the script-tag key does not allow
   localhost - the Maps JS API answers that by never calling your callback at
   all, so a geocode simply hangs and the page reports "could not find that
   address". The Firebase key does allow localhost, and allows the static APIs
   too, which is what makes a local loop possible at all.

   ⚠ AND EVEN THAT KEY CANNOT GEOCODE (2026-08-27). Its API restrictions no
   longer list the Geocoding API, so the address lookup is refused - see the
   OpenStreetMap fallback further down, which is why the harness still runs. */
const fbKey = (cfg.match(/apiKey:\s*"([A-Za-z0-9_-]+)"/) || [])[1];
const rawMapsTag = src.match(/<script src="https:\/\/maps\.googleapis\.com\/maps\/api\/js[^"]*"><\/script>/)[0];
/* ⚠ AND THE FIREBASE KEY LOST THE MAPS JS API ITSELF (2026-08-27):
   ApiTargetBlockedMapError, and the pane renders "Oops! Something went wrong."
   So the harness now runs the SHIPPED key by default - the same one the real
   page uses, which is the honest thing to test against anyway - and the swap
   above is kept behind ?key=firebase for when it is wanted back. */
const wantFb = true;   /* the Firebase key is the one the owner is editing (2026-08-28) */
const mapsTag = (wantFb && fbKey) ? rawMapsTag.replace(/key=[A-Za-z0-9_-]+/, 'key=' + fbKey) : rawMapsTag;

/* ⭐ AND A STAND-IN FOR GOOGLE, FOR WHEN THERE IS NO USABLE KEY. Load the
   harness with ?stub and _harness-stub.js replaces window.google with a shell
   whose GEOMETRY IS REAL - the bounds a click is read through, and the distance
   every foot is measured with. It runs after the real script tag so it wins,
   and it is what makes the flow testable at all on a machine Google refuses. */
/* ⚠ NOT ONE LITERAL closing script tag ANYWHERE IN THE OUTPUT. A closing tag
   inside a string still ends the surrounding script - the browser's tokeniser
   does not know it is in a string - so the page died with "Invalid or
   unexpected token". Both are assembled at run time so neither appears whole. */
const CLOSE = '<' + '/script>';
const stubTag = '<script>if(/[?&]stub/.test(location.search)){'
  + 'document.write("<scr"+"ipt src=\\"_harness-stub.js\\"><"+"/scr"+"ipt>");}'
  + CLOSE;
console.log('maps key: ' + (mapsTag.match(/key=([A-Za-z0-9_-]+)/)||[])[1]);

/* ⚠ WHAT admin.html IMPORTS AS A MODULE, THIS PAGE HAS TO INLINE. It is a
   classic script, so importing from ./js/money.js is not available - and
   without it rmRenderPrice threw on every dot. That did NOT look like a missing
   formatter: it threw inside rmRenderResults, which runs at the END of adding a
   peak, so "Add a peak" appeared to do nothing at all and the grade screen it
   should open never got there.

   ⭐ THE REAL FILE, WITH the export keyword STRIPPED - not a hand-copy. A harness that
   retypes the money rules tests the retyping; these functions decide what a
   customer is charged. The same goes for RM_DIFFICULTY_RATE, lifted out of
   admin.html by pattern rather than pasted, so it cannot drift from the three
   numbers the real page multiplies by. */
const moneyJs = fs.readFileSync('js/money.js', 'utf8').replace(/^export /gm, '');

/* ⭐ EVERY TOP-LEVEL CONSTANT THE MEASURE CODE ACTUALLY USES, found rather than
   listed. The function sweep above pulls helpers by name; constants were left
   behind, and each missing one threw only when the code RAN - RM_DIFFICULTY_RATE
   inside rmRenderPrice, then FEET_PER_BUNDLE inside the same render, each one
   surfacing as "the button does nothing" rather than as a missing constant.
   Adding them one at a time was whack-a-mole, so this takes the class: scan the
   bundled code for SCREAMING_CASE names, and lift the declaration of any that is
   used but not defined, verbatim out of admin.html.
   ⚠ LIFTED, NEVER RETYPED. These are prices, capacities and thresholds - a
   harness holding its own copy of RM_DIFFICULTY_RATE would quietly test numbers
   the real page does not use. */
/* NOT ONE REGEX BUILT FROM A STRING IN HERE. The first version was, and every
   escape in it was eaten on the way into this file: the s-class became a plain
   letter s, the word boundary became a literal backspace, and the newline
   became a real line break inside the pattern. It silently lifted NOTHING and
   said nothing, so "the button does nothing" came back a third time for a third
   reason. indexOf cannot be mis-escaped. */
function constsFor(code) {
  const NL = String.fromCharCode(10);
  const used = new Set(code.match(/[A-Z][A-Z0-9_]{2,}/g) || []);
  const out = [];
  used.forEach(function (name) {
    const already = ['const ', 'let ', 'var '].some(function (kw) {
      return code.indexOf(NL + kw + name + ' ') !== -1;
    });
    if (already) return;
    const at = src.indexOf(NL + 'const ' + name + ' = ');
    if (at === -1) return;
    /* ⚠ THE FIRST SEMICOLON IS NOT ALWAYS THE END OF THE DECLARATION - a
       template body or a regex can carry one - and a truncated const is a
       syntax error that takes the WHOLE page down, which is a far worse
       outcome than the missing constant it was meant to fix. So each candidate
       is parsed on its own and only kept if it stands up. */
    let end = src.indexOf(';', at), decl = null;
    while (end !== -1 && end - at < 20000) {
      const candidate = src.slice(at + 1, end + 1);
      try { new Function(candidate); decl = candidate; break; }
      catch (e) { end = src.indexOf(';', end + 1); }
    }
    if (decl) out.push(decl);
  });
  console.log('lifted ' + out.length + ' constant(s) used but not declared' +
    (out.length ? ': ' + out.map(function (c) { return c.split(' ')[1]; }).join(', ') : ''));
  return out.join(NL);
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Measure Roof harness</title>
${styles}
<style>body{margin:0;font-family:system-ui;background:#f4f1ea}
#bar{padding:10px;display:flex;gap:8px;align-items:center;background:#123}
#bar input{flex:1;padding:8px;font-size:14px}#bar button{padding:8px 14px}
#roofMeasureOverlay{display:block !important;position:static !important}
#out{white-space:pre-wrap;font:12px ui-monospace;padding:10px;background:#fff}</style>
</head><body>
<div id="bar"><input id="addr" value="209 S 850 W, Lehi, UT 84043"><button id="go">Load</button></div>
<div id="out">ready</div>
${overlay}
${mapsTag}
${stubTag}
<script>
/* A few things the measure code expects the rest of the admin page to provide. */
${cfg}
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function showToast(){}
function logAudit(){}
const db = null;
let perFootRate = 2;   /* the office setting, which lives in Firestore on the real page */
/* ⚠ getGeocoder() CACHES INTO THIS, and without the declaration it throws a
   ReferenceError inside geocodeAddress's promise - which rmLoadAddress catches
   and reports as "could not find that address". A harness missing one
   declaration looks exactly like a broken Google key from the outside, and cost
   an hour of chasing API restrictions that were never the problem. */
let geocoder = null;

/* ⚠ THE DEPTH-MAP READER IS AN ES MODULE (js/svdepth.js) and this page is a
   classic script, so it cannot be imported here. Its ONE caller already treats
   a failure as "no depth map at this panorama, the constant stands" and catches
   it - so refusing is the honest stand-in, not a behaviour change. Without it
   the harness threw ReferenceError inside a Street View event and the load
   stopped dead. */
function rmFetchPano(){ return Promise.reject(new Error('no depth map in the harness')); }
function rmDepthCameraHeight(){ return null; }

/* ⚠ GEOCODING IS BLOCKED FOR BOTH KEYS AS OF 2026-08-27, and the JS API says so
   only in the console: ApiTargetBlockedMapError, then the geocode callback is
   simply never called and the page reports "could not find that address".
   Nothing here can fix that - the API restrictions live in the owner's Google
   Cloud project. So the harness, and ONLY the harness, turns an address into a
   latitude and longitude through OpenStreetMap, which needs no key. Everything
   downstream - the tiles, Street View, Solar, the measuring - is still the real
   thing at the real coordinates. */
(function(){
  const Real = google.maps.Geocoder;
  google.maps.Geocoder = function(){
    const real = new Real();
    return {geocode: function(req, cb){
      let answered = false;
      const osm = () => {
        if(answered) return; answered = true;
        fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(req.address || ''))
          .then(r => r.json())
          .then(j => j.length
            ? cb([{geometry: {location: new google.maps.LatLng(parseFloat(j[0].lat), parseFloat(j[0].lon))},
                   formatted_address: j[0].display_name}], 'OK')
            : cb([], 'ZERO_RESULTS'))
          .catch(() => cb([], 'ERROR'));
      };
      try{
        real.geocode(req, function(res, st){
          if(answered) return;
          if(st === 'OK' && res && res.length){ answered = true; cb(res, st); }
          else osm();
        });
      }catch(e){ osm(); }
      setTimeout(osm, 2500);   /* the blocked call never comes back at all */
    }};
  };
})();
${moneyJs}
${constsFor(deps + measure)}
${deps}
${measure}
/* ---- the harness's own hooks: expose what the loop needs to read ---- */
window.H = {
  load: (a) => { document.getElementById('rmAddress').value = a; return rmLoadAddress(); },
  state: () => ({
    status: (document.getElementById('rmStatus')||{}).textContent || '',
    datumNote: (document.getElementById('rmDatumNote')||{}).textContent || '',
    datum: (typeof rmDatum === 'function') ? rmDatum() : null,
    faces: (typeof rmFaces !== 'undefined' && rmFaces) ? rmFaces.length : 0,
    runs: (typeof rmRuns !== 'undefined' ? rmRuns : []).map(r => ({
      side: r.side, on: r.on !== false, suggested: !!r.suggested,
      feet: (typeof rmRunFeet === 'function') ? Math.round(rmRunFeet(r)) : null,
      hFt: (r.path||[]).map(p => +(((p.h||0)*3.280839895).toFixed(1)))
    })),
    totals: (typeof rmTotals === 'function') ? rmTotals() : null,
    streetReady: (typeof rmStreetReady !== 'undefined') ? rmStreetReady : null,
    cam: (typeof rmCamOnRoad === 'function') ? rmCamOnRoad() : null,
    tries: (typeof rmPhotoDatumTries !== 'undefined') ? rmPhotoDatumTries : null
  })
};
/* ⚠ THE KEYBOARD HANDLER REFUSES TO RUN UNLESS THE OVERLAY IS OPEN, and it
   tests the INLINE style (ov.style.display !== 'flex') because that is what
   openRoofMeasure sets. The harness renders the overlay through a stylesheet
   override instead, so the inline style was empty and EVERY key - backspace,
   Enter, Escape, space - silently did nothing here. Backspace looked broken
   when it was fine. The CSS above still governs the layout; this is only what
   the guard reads. */
document.getElementById('roofMeasureOverlay').style.display = 'flex';

document.getElementById('go').onclick = () => {
  document.getElementById('out').textContent = 'loading...';
  window.H.load(document.getElementById('addr').value)
    .then(() => { document.getElementById('out').textContent = 'loaded'; })
    .catch(e => { document.getElementById('out').textContent = 'ERR ' + e.message; });
};
<\/script>
</body></html>`;

fs.writeFileSync('_harness.html', html);
console.log('wrote _harness.html  (' + Math.round(html.length / 1024) + ' KB)');
