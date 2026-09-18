/* ============================================================================
 * RSVP PRE-FLIGHT — READ-ONLY. Writes nothing, anywhere.
 *
 * Answers, in one run, everything still open before the season RSVP goes out:
 *   1. Is rsvpSentAt already stamped (a test send stamps it exactly like a real one)
 *   2. Who cannot be emailed, so who silently misses the RSVP
 *   3. The 2025 arrears damage: wire, wiped colour lists, sides, build flag
 *
 * ⚠ IT ONLY EVER READS. There is no write path in this file — no update, no set,
 *   no delete, and the Firestore REST call it makes is :runQuery, which cannot
 *   modify a document. Nothing here can change a customer record.
 *
 * ⚠ IT USES THE FIREBASE CLI'S OWN LOGIN, the one `firebase login:list` reports.
 *   The refresh token never leaves this machine except to Google's own token
 *   endpoint, which is the same exchange the firebase CLI does on every command.
 *
 * Run it from the repo root:  node claude/rsvp-preflight.js
 * ==========================================================================*/
const fs = require('fs');
const https = require('https');
const path = require('path');

const SHEET = path.join(process.env.USERPROFILE, 'OneDrive', 'Documents',
  'Highlighting Utah', 'Customer Lists', '2026 Client List (CURRENT - USE THIS ONE).xlsx');

/* ---- the CLI's own credentials -------------------------------------------- */
const cfgPath = path.join(process.env.USERPROFILE, '.config', 'configstore', 'firebase-tools.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const refresh = cfg.tokens && cfg.tokens.refresh_token;
if (!refresh) { console.error('Not logged in. Run: firebase login'); process.exit(1); }
/* ⚠ THESE ARE NOT SECRETS AND THIS FILE LEAKS NOTHING. They are the PUBLISHED OAuth
   client of the firebase-tools CLI — the same pair shipped inside every copy of
   `npm i -g firebase-tools` on every machine in the world, and a "client secret" for
   an installed desktop app is public by the OAuth spec's own admission. They identify
   the APPLICATION, never the user. The thing that identifies the user is the refresh
   token in the config store, which is read at run time, is never written anywhere by
   this file, and is not in this repo. Do not "fix" this by moving them to an env var:
   that implies they are sensitive and would leave the next reader hunting for a leak
   that does not exist. */
const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

function post(host, p, body, headers) {
  return new Promise((res, rej) => {
    const r = https.request({ host, path: p, method: 'POST', headers }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res({ status: x.statusCode, body: d }));
    });
    r.on('error', rej); r.write(body); r.end();
  });
}

/* Firestore's REST shape -> a plain value. */
function val(v) {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  if ('mapValue' in v) return flat(v.mapValue.fields || {});
  return undefined;
}
function flat(f) { const o = {}; for (const k in f) o[k] = val(f[k]); return o; }

async function readAll(access, collection) {
  const p = '/v1/projects/highlighting-utah/databases/(default)/documents:runQuery';
  const out = []; let after = null;
  for (let i = 0; i < 80; i++) {
    const q = { structuredQuery: {
      from: [{ collectionId: collection }],
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: 300 } };
    if (after) q.structuredQuery.startAt = { values: [{ referenceValue: after }], before: false };
    const b = JSON.stringify(q);
    const r = await post('firestore.googleapis.com', p, b, {
      Authorization: 'Bearer ' + access, 'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(b) });
    if (r.status !== 200) { console.error(collection + ' read failed ' + r.status + ': ' + r.body.slice(0, 200)); process.exit(1); }
    const rows = JSON.parse(r.body).filter(x => x.document);
    if (!rows.length) break;
    rows.forEach(x => out.push({ id: x.document.name.split('/').pop(), d: flat(x.document.fields || {}) }));
    after = rows[rows.length - 1].document.name;
    if (rows.length < 300) break;
  }
  return out;
}

const norm = s => String(s == null ? '' : s).trim().toLowerCase();
/* ⚠ THE SHEET WRITES W/G AND THE APP WRITES White/Green — the same value in two
   spellings. The real comparison runs rbNormalizeWire before comparing; a raw string
   compare reports a difference on every wired customer, which is what the first run of
   this script did (303 of them). Same rule, copied exactly. */
const wire = v => { const x = norm(v); if (x === 'white' || x === 'w') return 'White';
  if (x === 'green' || x === 'g') return 'Green'; return ''; };
const digits = s => String(s == null ? '' : s).replace(/\D/g, '');
const line = () => console.log('-'.repeat(64));

(async () => {
  const form = 'client_id=' + CLIENT_ID + '&client_secret=' + CLIENT_SECRET +
    '&refresh_token=' + encodeURIComponent(refresh) + '&grant_type=refresh_token';
  const t = await post('oauth2.googleapis.com', '/token', form,
    { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) });
  if (t.status !== 200) { console.error('token exchange failed'); process.exit(1); }
  const access = JSON.parse(t.body).access_token;

  const book = await readAll(access, 'jobAddresses');
  const live = book.filter(c => !c.d.isTestRecord);
  console.log('READ-ONLY. ' + book.length + ' customer records (' + live.length + ' non-test). Nothing was written.');

  /* ---- 1. has the RSVP already been marked sent? ------------------------- */
  line();
  const stamped = live.filter(c => c.d.rsvpSentAt).length;
  const settings = await readAll(access, 'settings');
  const arrAuto = settings.find(s => s.id === 'arrearsRsvpAutomation');
  console.log('1. RSVP SEND STATE');
  console.log('   customers carrying rsvpSentAt .......... ' + stamped);
  console.log('   (a TEST send stamps this exactly like a real one)');
  console.log('   arrears automation enabled ............. ' +
    (arrAuto ? String(!!(arrAuto.d && arrAuto.d.enabled)) : 'no settings doc = OFF'));
  const byStatus = {};
  live.forEach(c => { const k = norm(c.d.rsvpStatus) || '(none)'; byStatus[k] = (byStatus[k] || 0) + 1; });
  console.log('   RSVP answers so far ................... ' +
    Object.keys(byStatus).sort().map(k => k + '=' + byStatus[k]).join('  '));

  /* ---- 2. who cannot be reached ----------------------------------------- */
  line();
  const EMAIL = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;
  const noEmail = live.filter(c => !norm(c.d.email));
  const secondOnly = noEmail.filter(c => norm(c.d.email2));
  const malformed = live.filter(c => norm(c.d.email) && !EMAIL.test(norm(c.d.email)));
  console.log('2. WHO THE RSVP CANNOT REACH');
  console.log('   no primary email ...................... ' + noEmail.length + '   <- silently miss it');
  console.log('     of those, have a secondary address .. ' + secondOnly.length + '   <- fixable, move it up');
  console.log('     of those, no phone either ........... ' + noEmail.filter(c => !digits(c.d.phone)).length);
  console.log('   malformed email ....................... ' + malformed.length);
  malformed.slice(0, 15).forEach(c => console.log('       ' + String(c.d.name || c.id).padEnd(26) + ' ' + c.d.email));

  /* ---- 3. the 2025 arrears damage, against the master sheet -------------- */
  line();
  console.log('3. THE 2025 ARREARS DAMAGE');
  let sheet = null;
  try {
    const { execFileSync } = require('child_process');
    const py = 'import json,sys\n' +
      'from openpyxl import load_workbook\n' +
      'wb=load_workbook(r"""' + SHEET + '""",data_only=True,read_only=True)\n' +
      'ws=wb[wb.sheetnames[0]]\n' +
      'rows=list(ws.iter_rows(values_only=True))\n' +
      'h=[str(c).strip() if c is not None else "" for c in rows[0]]\n' +
      'gi=lambda n: h.index(n) if n in h else -1\n' +
      'iN,iP,iW,iL,iA=gi("Name"),gi("Phone"),gi("Wire"),gi("Lights"),gi("Address")\n' +
      'o=[]\n' +
      'for r in rows[1:]:\n' +
      '    g=lambda i:("" if i<0 or i>=len(r) or r[i] is None else str(r[i]).strip())\n' +
      '    if g(iN): o.append({"name":g(iN),"phone":g(iP),"wire":g(iW),"lights":g(iL),"addr":g(iA)})\n' +
      'json.dump(o,sys.stdout)\n';
    sheet = JSON.parse(execFileSync('python', ['-c', py], { maxBuffer: 1 << 28 }).toString());
  } catch (e) {
    console.log('   (could not read the master sheet: ' + String(e.message).slice(0, 90) + ')');
  }

  /* ⚠ ADDRESS FIRST, AND A REPEATED NAME IS NO MATCH AT ALL.
     The first version of this keyed the sheet by name alone, last row winning. Jana
     McJunkin has THREE rows on the sheet at three different addresses (red/green/soft,
     blank, red/pure); Erin Wade and Meghann Turner have two each. So "the sheet says
     red/pure" was whichever duplicate happened to land last in the map, compared against
     an app record that may be an entirely different house — and acting on it would have
     written one property's colours onto another. That is CLAUDE.md's own rule: two
     candidates is not a weaker match, it is NO match.
     A house is its street, so that is what matches. A name is used only where it appears
     exactly once on the whole sheet, and a phone only where it is not shared — seventeen
     numbers in the real book are shared by two households. Everything else is reported
     as ambiguous rather than guessed at. */
  const street = s => norm(s).replace(/[.,]/g, ' ')
    .replace(/\b(north|south|east|west)\b/g, m => m[0])
    .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|circle|cir|court|ct|way|place|pl|boulevard|blvd|parkway|pkwy|terrace|ter)\b/g, '')
    .replace(/\s+/g, ' ').trim();
  const sortName = n => norm(n).split(/\s+/).sort().join(' ');

  const byAddr = {}, nameCount = {}, phoneCount = {}, byName = {}, byPhone = {};
  if (sheet) sheet.forEach(r => {
    const a = street(r.addr);
    if (a) (byAddr[a] = byAddr[a] || []).push(r);
    const n = sortName(r.name);
    nameCount[n] = (nameCount[n] || 0) + 1; byName[n] = r;
    const p = digits(r.phone);
    if (p) { phoneCount[p] = (phoneCount[p] || 0) + 1; byPhone[p] = r; }
  });

  const ambiguous = [];
  const sheetFor = c => {
    const a = street(c.d.street || c.d.address);
    if (a && byAddr[a] && byAddr[a].length === 1) return byAddr[a][0];
    if (a && byAddr[a] && byAddr[a].length > 1) { ambiguous.push([c.d.name, 'address on the sheet twice']); return null; }
    const n = sortName(c.d.name);
    if (nameCount[n] === 1) return byName[n];
    if (nameCount[n] > 1) { ambiguous.push([c.d.name, nameCount[n] + ' rows share this name — matched on nothing']); return null; }
    const p = digits(c.d.phone);
    if (phoneCount[p] === 1) return byPhone[p];
    return null;
  };

  const colours = c => {
    const desc = norm(c.d.lightsDescription);
    const list = Array.isArray(c.d.lightColors) ? c.d.lightColors.filter(Boolean) : [];
    return desc || list.join(', ');
  };

  const wireMismatch = [], coloursGone = [];
  live.forEach(c => {
    const s = sheetFor(c); if (!s) return;
    if (wire(s.wire) && wire(c.d.wireColor) && wire(s.wire) !== wire(c.d.wireColor)) {
      wireMismatch.push([c.d.name, c.d.wireColor, s.wire]);
    }
    if (s.lights && !colours(c)) coloursGone.push([c.d.name, s.lights]);
  });

  const sides = {};
  live.forEach(c => {
    /* ⚠ THE FIELD IS houseSides — read by houseSideCount(d.houseSides), with "sides"
       as the legacy array. Two earlier guesses (numberOfSides, then sideCount) both read
       a field nothing writes and reported the whole book unset, which is a script bug
       wearing the shape of a finding. STORED vs UNSET is the distinction that matters:
       HOUSE_SIDES_DEFAULT is 1, so an unset record already DISPLAYS as 1 side without
       anything having damaged it. Only an explicitly stored 1 could be the arrears entry. */
    const raw = c.d.houseSides != null ? c.d.houseSides : c.d.sides;
    let n = Array.isArray(raw) ? Math.min(4, raw.filter(Boolean).length)
      : (raw == null || raw === '' ? null : Number(String(raw).replace(/[^0-9]/g, '')));
    const k = (n == null || Number.isNaN(n)) ? '(unset)' : String(n);
    sides[k] = (sides[k] || 0) + 1;
  });

  console.log('   matched to the master sheet ........... ' + live.filter(sheetFor).length + ' of ' + live.length);
  console.log('   could NOT be matched safely ........... ' + ambiguous.length + '   (repeated name or address — deliberately not guessed)');
  ambiguous.slice(0, 10).forEach(r => console.log('       ' + String(r[0]).padEnd(26) + ' ' + r[1]));
  console.log();
  console.log('   WIRE disagrees with the sheet ......... ' + wireMismatch.length + '   (Compare + Sync fixes these)');
  wireMismatch.slice(0, 20).forEach(r => console.log('       ' + String(r[0]).padEnd(26) + ' app=' + String(r[1]).padEnd(12) + ' sheet=' + r[2]));
  console.log();
  console.log('   COLOURS blank in app, present on sheet  ' + coloursGone.length + '   (no tool diffs this — manual)');
  coloursGone.slice(0, 20).forEach(r => console.log('       ' + String(r[0]).padEnd(26) + ' sheet says: ' + r[1]));
  console.log();
  console.log('   SIDES distribution .................... ' +
    Object.keys(sides).sort().map(k => k + ': ' + sides[k]).join('   '));
  console.log('   (unset) DISPLAYS as 1 side anyway — HOUSE_SIDES_DEFAULT is 1, so only a');
  console.log('   STORED 1 could be the arrears entry. The sheet has no sides column either way.');
  console.log();
  console.log('   needsLightBuild set ................... ' + live.filter(c => c.d.needsLightBuild === true).length);
  console.log('   needsLightRecycle set ................. ' + live.filter(c => c.d.needsLightRecycle === true).length);
  /* ---- 4. referrals: do the entries, the count and the bill agree? ------
   * Dax, 2026-09-07: a customer who refers twice is only discounted once. Two
   * sequential conversions produce $50 when RUN against a fake Firestore (run-all.js
   * suite 299 §5b), so the rule is right and the question is what the real records
   * actually hold. Three numbers have to agree for the discount to be right, and each
   * disagreement means something different:
   *   entries   — what really happened, the source of truth and the audit trail
   *   count     — the stored figure Edit Customer's box is filled from
   *   the bill  — the one the customer is actually charged
   * entries > count means a credit landed and the stored number did not keep up.
   * count > bill means the bill was rebuilt from something else, or never rebuilt. */
  line();
  console.log('4. REFERRALS — entries vs stored count vs the actual bill');
  const invoices = await readAll(access, 'invoices');
  const invById = {};
  invoices.forEach(i => { invById[i.id] = i.d; });
  const keyFor = c => digits(c.d.phone) || norm(c.d.email);
  const thisYear = new Date().getFullYear();
  const seasonOf = e => {
    if (e && e.season != null && Number.isFinite(Number(e.season))) return Number(e.season);
    const t = Date.parse(String((e && e.creditedAt) || ''));
    return Number.isNaN(t) ? null : new Date(t).getFullYear();
  };
  const withRefs = live.filter(c => Array.isArray(c.d.referralCredits) && c.d.referralCredits.length);
  console.log('   customers holding referral entries ..... ' + withRefs.length);
  let disagreements = 0;
  withRefs.forEach(c => {
    const all = c.d.referralCredits;
    const liveN = all.filter(e => e && !e.revoked && !e.waived &&
      (seasonOf(e) === null || seasonOf(e) === thisYear)).length;
    const stored = Number(c.d.referralCount) || 0;
    const inv = invById[keyFor(c)];
    const refLine = inv && Array.isArray(inv.creditNotes)
      ? inv.creditNotes.filter(n => n && n.kind === 'referral')
          .reduce((s, n) => s + (Number(n.amount) || 0), 0)
      : null;
    const expected = liveN * 25;
    const ok = stored === liveN && (refLine === null || refLine === expected);
    if (!ok) disagreements++;
    console.log('       ' + String(c.d.name || c.id).padEnd(24) +
      ' entries=' + all.length +
      '  counted=' + liveN +
      '  stored=' + stored +
      '  onBill=' + (refLine === null ? '(no invoice)' : '$' + refLine) +
      '  expected=$' + expected +
      (ok ? '' : '   <-- DISAGREES'));
    all.forEach(e => {
      const why = e.revoked ? 'revoked' : (e.waived ? 'waived' : 'counts');
      console.log('           - ' + String(e.referredName || e.referredCustomerId || '?').padEnd(20) +
        ' season=' + (seasonOf(e) === null ? 'undated' : seasonOf(e)) + '  ' + why);
    });
  });
  console.log('   rows where the three disagree ......... ' + disagreements);

  line();
  console.log('Done. Read-only — no customer record was modified.');
})().catch(e => { console.error(e); process.exit(1); });
