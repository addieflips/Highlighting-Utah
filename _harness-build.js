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
const wantFb = /[?&]key=firebase/.test('');
const mapsTag = (wantFb && fbKey) ? rawMapsTag.replace(/key=[A-Za-z0-9_-]+/, 'key=' + fbKey) : rawMapsTag;
console.log('maps key: ' + (mapsTag.match(/key=([A-Za-z0-9_-]+)/)||[])[1]);

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
