/*
 * MOVING HOUSE HAS ITS OWN DOOR
 *
 * Addie, 2026-09-10: "changing gate code or phone number should not notify us",
 * and "you should have to apply changes in order for it to go to requote."
 *
 * ⚠ WHAT WAS WRONG, because every claim below is shaped by it. The My Info save
 * decided a customer had MOVED from nothing more than the address STRING having
 * changed. So adding an apartment number or fixing a spelling raised a real
 * re-quote card somebody had to answer, emailed the office, and parked the
 * customer in `needs_changes` / `address_changed` — a state resolved only by
 * answering a quote. Correcting a typo is not a move, and no comparison of two
 * typed strings can tell the two apart. That is why this is a BUTTON.
 *
 * ⭐ AND THE MOVE IS RECORDED AS PENDING, NEVER APPLIED. There is no geocoder on
 * the server, and the town is what a crew-day is grouped by — so writing the new
 * address here would leave the customer at the new house with the old house's pin,
 * on the old town's day, with the new address already pushed onto a frozen route
 * stop the crew is holding. The office applying it is what commits it, through the
 * Edit Customer save that already re-geocodes, raises the re-quote and re-syncs
 * upcoming stops.
 *
 * ⚠ THE CENTRAL CLAIM IS A NEGATIVE — `address`, `city`, `lat` and `lng` are NOT
 * written — and a negative is exactly what a green run cannot show you. So the
 * callable is RUN against a fake Firestore and the update object is read back,
 * rather than its source being searched for field names.
 *
 * Its own file per R-018.
 */
const fs = require('fs');
const path = require('path');
const fns = fs.readFileSync(path.join(__dirname, 'functions', 'index.js'), 'utf8');
const idx = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const adm = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, why) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (why ? '\n        ' + why : '')); }
}

/* Comments stripped before any source claim. The explanations inside these
   functions NAME the fields they promise not to write — "IT DOES NOT WRITE
   `address`, `city`, `lat` OR `lng`" — so a plain search reads the prose as the
   code it describes and passes on a file that is wrong. Suites 58, 274, 275 and
   300 each learned this separately; §7 has the general form. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/* Slices to the matching closing brace, never a character count — §7 bans fixed
   windows by name. ⚠ STARTS AT THE BODY, not the first brace: these are declared
   `onCall({ cors: true }, async (request) => {`, so the first brace pair is the
   OPTIONS OBJECT and closes immediately, handing back four words instead of the
   callable. gate-code.test.js records the same trap costing it six false failures. */
function lift(src, name) {
  let i = src.indexOf('exports.' + name + ' =');
  if (i === -1) i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('cannot find ' + name);
  /* ⚠ THE TWO SHAPES NEED OPPOSITE ANSWERS, and getting it wrong is silent both ways.
     `exports.x = onCall({ cors: true }, async (request) => {` opens with the OPTIONS
     OBJECT, so the first brace pair closes immediately and a brace balancer hands back
     four words — gate-code.test.js records that costing it six false failures. But a
     plain `function f(a, b) {` has no arrow at all, and searching the rest of the FILE
     for `=> {` finds one hundreds of lines away and slices something that is not the
     function — a SyntaxError pointing at nothing, which cost this file two runs.
     ⚠ AND SCOPING THE ARROW SEARCH "BEFORE THE FIRST BRACE" FIXES ONLY THE SECOND: for
     an onCall the arrow is AFTER that brace, so it silently reverted every callable to
     the options-object slice. A vacuous `infoBody` came out of exactly that and passed
     while the trap it guards was reinstated — the red-check is what said so. Dispatch
     on the DECLARATION, which is the thing that actually differs. */
  let bodyStart;
  if (src.startsWith('exports.', i)) {
    bodyStart = src.indexOf('=> {', i);
    if (bodyStart === -1) throw new Error('no arrow body on exports.' + name);
    bodyStart += 3;
  } else {
    bodyStart = src.indexOf('{', i);
  }
  let depth = 0, started = false;
  for (let j = bodyStart; j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces lifting ' + name);
}

console.log('\n=== Moving house: its own door, and it applies nothing ===\n');

// ==========================================================================
// 1. THE SERVER, RUN
// ==========================================================================

/* ⚠ lift() STOPS AT THE BODY'S CLOSING BRACE, which is right for reading and wrong
   for RUNNING: `exports.x = onCall({...}, async (request) => { ... })` still owes a
   `)` and a `;`, so the slice is a syntax error the moment it is evaluated. It cost
   this file its first run. Balanced on parens as well as braces, so the statement
   comes back whole however the options object is written. */
function liftCallable(src, name) {
  /* ⚠ COMMENTS FIRST. The prose in these functions is full of brackets — "(2026-09-10)",
     "(MSG-07)", "(see the markup)" — and any balancer counts them. */
  const s = stripComments(src);
  const i = s.indexOf('exports.' + name + ' =');
  if (i === -1) throw new Error('cannot find exports.' + name);
  /* ⚠ AND THE BODY, NOT THE FIRST BRACE. `onCall({ cors: true }, async (request) => {`
     opens with the OPTIONS OBJECT, which closes immediately — so a balancer started at
     `i` returns `exports.x = onCall({ cors: true }` and nothing else. gate-code.test.js
     records the same trap costing it six confident failures against good code; it cost
     this file two runs. */
  const bodyStart = s.indexOf('=> {', i);
  if (bodyStart === -1) throw new Error('no arrow body on exports.' + name);
  let depth = 0;
  for (let j = bodyStart + 3; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}') {
      depth--;
      /* The body's own closing brace. What follows in the file is `);` — rebuilt
         rather than searched for, so the statement evaluates. */
      if (depth === 0) return s.slice(i, j + 1) + ');';
    }
  }
  throw new Error('unbalanced lifting exports.' + name);
}

const moveSrc = liftCallable(fns, 'portalChangeAddress');
check('portalChangeAddress exists', /exports\.portalChangeAddress\s*=/.test(fns),
  'the portal has nowhere to send a move, so the info save is the only route and ' +
  'it cannot tell a move from a typo');

/* The real helper, lifted rather than stubbed (§3). Stamping seasonStatusAt is
   what puts the move on the customer's history at all — historySeasonWords
   already reads address_changed — so a stub here would keep this file green
   through the stamp being dropped, which is the one thing it is checking. */
const stampSrc = lift(fns, 'stampSeasonStatusServer');

function runMove(data, opts) {
  const o = opts || {};
  const record = o.record === undefined
    ? { name: 'Dana Cole', phone: '8015550111', email: 'dana@example.com',
        address: '1 Elm St, Lehi 84043', seasonStatus: 'confirmed' }
    : o.record;
  const wrote = { updates: null, messages: [] };
  const fakeDb = {
    collection: function (c) {
      return {
        doc: function () {
          return { update: function (u) { wrote.updates = u; return Promise.resolve(); } };
        },
        add: function (m) {
          if (o.notesThrow) return Promise.reject(new Error('messages refused'));
          wrote.messages.push(m); return Promise.resolve({ id: 'm1' });
        }
      };
    }
  };
  const sandbox = {
    db: fakeDb,
    /* A real class, so `throw new HttpsError(...)` carries its code the way the
       runtime's does and the refusal checks can read it. */
    HttpsError: class extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    },
    findByToken: function (t) {
      return Promise.resolve(t === 'goodtoken' ? { id: 'cust1', data: record } : null);
    },
    admin: { firestore: { FieldValue: { serverTimestamp: function () { return '<<now>>'; } } } },
    console: { error: function () {} }
  };
  const body =
    'const { db, HttpsError, findByToken, admin, console } = __sb;\n' +
    stampSrc + '\n' +
    'let __captured = null;\n' +
    'const onCall = (opts, fn) => { __captured = fn; return fn; };\n' +
    'const exports = {};\n' +
    moveSrc + '\n' +
    'return __captured;';
  const fn = new Function('__sb', body)(sandbox);
  return fn({ data: data }).then(
    (res) => ({ ok: true, res: res, wrote: wrote }),
    (err) => ({ ok: false, err: err, wrote: wrote })
  );
}

const results = [];
function step(name, promise, assertFn) { results.push({ name, promise, assertFn }); }

/* ---- it refuses before it writes ------------------------------------------ */
step('a missing token is refused', runMove({ street: '9 Oak', city: 'Lehi' }), (r) => {
  check('a missing token is refused', !r.ok && r.err.code === 'invalid-argument' && !r.wrote.updates,
    'an unauthenticated caller could write a pending move onto a record it never proved it owned');
});
step('street', runMove({ token: 'goodtoken', city: 'Lehi' }), (r) => {
  check('a move with no street is refused', !r.ok && !r.wrote.updates,
    'a town with no street is not an address, and it would badge the customer for a ' +
    'move the office cannot act on');
});
step('city', runMove({ token: 'goodtoken', street: '9 Oak St' }), (r) => {
  check('a move with no town is refused', !r.ok && !r.wrote.updates,
    'the town is what a crew-day is grouped by — a move without one is one the ' +
    'season planner can never place');
});
step('unknown', runMove({ token: 'nope', street: '9 Oak St', city: 'Lehi' }), (r) => {
  check('an unknown token throws not-found rather than resolving',
    !r.ok && r.err.code === 'not-found' && !r.wrote.updates,
    'a stale link would silently appear to work');
});

/* ---- ⭐ THE CENTRAL CLAIM: it applies nothing ----------------------------- */
step('applies-nothing', runMove({
  token: 'goodtoken', street: '9 Oak St', city: 'Springville', zip: '84663', moveDate: 'mid-October'
}), (r) => {
  const u = r.wrote.updates || {};
  check('a move is recorded', r.ok && !!u.pendingAddress,
    'the customer told us and nothing was written down');
  check('the new address is NOT applied to the record',
    !('address' in u) && !('city' in u) && !('street' in u) && !('zip' in u),
    'the record would hold the new address with the OLD pin and the OLD town — the ' +
    'crew is sent to a house nobody has geocoded, and a frozen route stop is rewritten ' +
    'underneath them. This is the whole reason the door exists.');
  check('and no pin is moved',
    !('lat' in u) && !('lng' in u),
    'there is no geocoder on this server, so any coordinate written here is a guess');
  check('the pending address carries the street, the town and the zip',
    u.pendingAddress === '9 Oak St, Springville 84663',
    'the office reads this one line; a town or zip missing from it is a move they ' +
    'have to ring the customer to complete');
  check('the town is kept on its own as well',
    u.pendingCity === 'Springville',
    'Apply fills the Town box from this — it is what a crew-day is grouped by, and ' +
    'deriving it back out of the address line is the phantom-town bug');
  check('and when they are moving in', u.pendingMoveDate === 'mid-October',
    'the office has no way to tell an urgent move from one in December');
  /* ⚠ THE BADGE IS THE OFFICE'S WHOLE ROUTE IN. It is the pill on the customer row
     and the filter they work from; without it a pending move is five fields in a
     database nobody is looking at. */
  check('the customer is badged for the office', u.seasonStatus === 'address_changed',
    'the pending move would be invisible on every screen');
  /* ⚠ THROUGH THE SHARED STAMP, NOT BY HAND. Its own note says a stamp beside any ONE
     branch misses the others, and this is the fourth writer of seasonStatus. It is
     also what puts the move on the customer's history: seasonStatusAt is a journey
     step and historySeasonWords already reads address_changed. */
  check('the status change is dated, through the shared stamp',
    u.seasonStatusAt === '<<now>>' && u.seasonStatusWas === 'confirmed',
    'seasonStatusAt is a step on the journey — unstamped, the move shows on no ' +
    'history at all, and "changed on the 4th" could not say what it changed from');
  check('and the request itself is dated', u.pendingAddressAt === '<<now>>',
    'the office cannot sort the queue by who has been waiting longest');
});

/* ---- the office is told ---------------------------------------------------- */
step('note', runMove({ token: 'goodtoken', street: '9 Oak St', city: 'Springville' }), (r) => {
  const m = (r.wrote.messages || [])[0] || {};
  /* ⚠ THIS EXACT TOPIC, because messageFolderOf already routes it to Member Portal
     (MSG-07). A new spelling files the note in the main pile instead. */
  check('a note is filed under the topic that routes to Member Portal',
    m.topic === 'Existing Customer - Address Changed' && m.folder === 'Member Portal',
    'the note lands in the main Inbox pile rather than beside the other portal notices');
  check('and it names both addresses',
    /1 Elm St/.test(m.message || '') && /9 Oak St/.test(m.message || ''),
    '"they moved" with only the new address gives the office no way to tell a real ' +
    'move from a corrected flat number — which is the judgement this door exists to ' +
    'put in front of a person');
  check('and it says nothing has been applied',
    /still holds the old address/i.test(m.message || ''),
    'the office reads the record, sees the old address and files a bug about the portal');
});

/* ⚠ BEST EFFORT, AND ASSERTED AS SUCH. The write is already done by the time the
   note is attempted; a customer who has told us they moved must not be handed an
   error because an Inbox row failed. */
step('note-throws', runMove(
  { token: 'goodtoken', street: '9 Oak St', city: 'Springville' }, { notesThrow: true }
), (r) => {
  check('a failed note does not lose the move',
    r.ok && !!(r.wrote.updates || {}).pendingAddress,
    'the customer would be told it went wrong when their move was safely recorded');
});

/* ---- ⭐ ANYONE MAY REPORT A MOVE, PAID UP OR NOT (2026-09-10, QT-36) --------
 * Addie, answering Q-033: "Yes anyone can report a move but when we requote the person
 * that didn't pay for last year still can't be scheduled until they pay there balance."
 *
 * ⚠ THIS IS THE HALF THAT LOOKS LIKE AN OVERSIGHT AND IS A RULING. portalSave refuses
 * every section but `cancel` while last season is unpaid, so a future session reading
 * only these two functions would see the move door as the one that forgot its hold and
 * "fix" it — which is the opposite of what she asked for. Asserted as code so that goes
 * red instead of shipping.
 *
 * ⚠ THE SECOND HALF OF HER SENTENCE IS ENFORCED ELSEWHERE, ON PURPOSE, and is NOT
 * re-checked here (§9.1 — one claim, one place): `houseOwesFromLastSeason` inside
 * `isOutForSeason` keeps a debtor off the routes even after they approve a re-quote,
 * and arrears-hold.test.js §4d already runs the real `seasonYesUpdates` into the real
 * `isOutForSeason` to prove it. What this file owns is the DOOR being open. */
step('arrears-open', runMove(
  { token: 'goodtoken', street: '9 Oak St', city: 'Springville' },
  { record: { name: 'Owes Money', phone: '8015550111', address: '1 Elm St, Lehi',
              seasonStatus: 'confirmed' } }
), (r) => {
  check('a customer who owes for last season can still report a move',
    r.ok && !!(r.wrote.updates || {}).pendingAddress,
    'refused, the record keeps an address they have left and nobody is told the house ' +
    'is wrong — and a crew standing at the wrong door is the one mistake with no undo. ' +
    'Addie: "Yes anyone can report a move"');
});
/* ⚠ AND THE REFUSAL IS NOT SMUGGLED IN AS A SILENT NO-OP EITHER. A hold added later as
   an early return would leave every check above passing (they use a clear record) while
   a debtor's move vanished with no error — so the callable is asserted not to consult
   the arrears rule at all. Comments stripped: the explanation above the guard NAMES
   arrearsHoldBlocks to say why it is absent. */
check('and the move door does not consult the arrears hold at all',
  !/arrearsHoldBlocks|arrearsHoldError/.test(stripComments(moveSrc)),
  'portalSave holds every other section, so this reads like the one that forgot — it ' +
  'is Addie\'s exception (QT-36) and removing it silently drops a debtor\'s move');

/* ---- bounded ------------------------------------------------------------- */
step('bounds', runMove({
  token: 'goodtoken', street: 'S'.repeat(400), city: 'C'.repeat(200),
  zip: 'Z'.repeat(80), moveDate: 'D'.repeat(200)
}), (r) => {
  const u = r.wrote.updates || {};
  check('every value from the browser is bounded',
    u.pendingCity.length === 60 && u.pendingZip.length === 20 &&
    u.pendingMoveDate.length === 40 && /^S{200}/.test(u.pendingAddress),
    'this callable bypasses firestore.rules, so an unbounded string from an ' +
    'unauthenticated caller goes straight onto the record');
});

// ==========================================================================
// 2. THE INFO SAVE NO LONGER GUESSES
// ==========================================================================
/* ⚠ SCOPED TO THE BRANCH, comments stripped. The branch's own explanation says
   "AN INFO SAVE NO LONGER WRITES seasonStatus AT ALL", so an unstripped search
   reads that sentence as the code and passes on a file that is wrong. */
const saveSrc = stripComments(lift(fns, 'portalSave'));
const infoBranch = saveSrc.slice(saveSrc.indexOf("if (section === 'info') {"));
const infoBody = infoBranch.slice(0, infoBranch.indexOf('\n  }'));
check('correcting your details parks nobody in the re-quote state',
  !/seasonStatus/.test(infoBody),
  'a corrected phone number or gate code sits in Needs Changes for ever, waiting on ' +
  'a quote nobody raised — Addie: "changing gate code or phone number should not notify us"');

/* ⚠ AND THE PORTAL STOPPED RAISING THE QUOTE ITSELF. This is the half that is easy
   to miss: the server could stop badging while index.html went on writing a `quotes`
   document from the same save, so a typo fix still produced a re-quote card. */
const idxNoComments = stripComments(idx);
const infoHandler = idxNoComments.slice(idxNoComments.indexOf("getElementById('infoSaveBtn')"));
const infoHandlerBody = infoHandler.slice(0, infoHandler.indexOf('\n});'));
check('and the portal does not raise a quote from an ordinary save',
  !/addDoc\(/.test(infoHandlerBody) && !/notifyBusinessOfMessage/.test(infoHandlerBody),
  'the re-quote is raised when the office APPLIES the move, from the one path that ' +
  'also geocodes the new house — Addie: "you should have to apply changes in order ' +
  'for it to go to requote"');
check('and it no longer promises a new quote it is not sending',
  !/we'll be in touch with a new quote/i.test(idx),
  'somebody who corrected their street spelling is told to expect a re-quote that ' +
  'nobody is going to send them');

// ==========================================================================
// 3. THE PORTAL'S OWN DOOR, AND ITS WIRING
// ==========================================================================
check('the portal has a move door that calls the callable',
  /portalChangeAddress/.test(idx) && /id="movedSaveBtn"/.test(idx),
  'the fields are written by nothing, so the whole server half is unreachable');
/* ⚠ THE WIRING IS ASSERTED SEPARATELY FROM THE RENDERER, because this repo has
   shipped the other shape: Suite 276 stayed green with the house-tab calls deleted,
   and the recycle "bin says" box rendered a control whose listener never applied.
   Every behavioural claim about the banner can pass while nothing draws it. */
/* ⚠ BOUNDED AT BOTH ENDS. Sliced only from the fill site to the end of the FILE, this
   was satisfied by the call inside the movedSaveBtn handler further down — so deleting
   the one that draws the banner for a returning customer went straight through. The
   window now closes at the next line of the same fill block. */
const fillFrom = idx.indexOf("getElementById('infoAddress').value = addrDoc");
const fillRegion = idx.slice(fillFrom, idx.indexOf('if(addrDoc.phone2)', fillFrom));
check('and the pending banner is drawn when a record is loaded',
  fillFrom !== -1 && /portalRenderPendingMove\(\);/.test(fillRegion),
  'a customer who has already sent their new address sees the old one still on file ' +
  'with nothing saying why, and sends it again');
check('the banner reads the field the server actually sends',
  /pendingAddress/.test(idx) && /'pendingAddress', 'pendingMoveDate'/.test(fns),
  'a field left off PORTAL_READ_FIELDS is simply undefined in the browser, with ' +
  'nothing anywhere saying why');

// ==========================================================================
// 4. THE OFFICE READS IT, AND APPLY DOES NOT WRITE
// ==========================================================================
/* ⚠ LINE ENDINGS NORMALISED FIRST, AND THIS IS NOT COSMETIC. admin.html is CRLF —
   measured, not assumed (§7 says the claim in CLAUDE.md has flipped four times, so
   run `grep -c $'\r' admin.html` rather than believing any of them). Slicing it with
   '\n}\n' finds nothing, indexOf returns -1, and `slice(0, -1)` hands back the whole
   rest of the FILE instead of one function — so a check that Apply contains no
   updateDoc is really asking whether admin.html contains no updateDoc, which is
   false, and one asking that a block omits seasonStatus passes for no reason at all.
   Both happened here on the first run. The fix-sheet gate lost three sabotages to
   exactly this, in the red-check itself. */
const admNoComments = stripComments(adm.replace(/\r\n/g, '\n'));
check('the office has a pending-move banner',
  /id="editCustPendingMove"/.test(adm) && /function renderEditCustPendingMove/.test(adm),
  'pendingAddress is written by the portal and read by nobody — a field in the code ' +
  'and on no screen, which is §1\'s own failure');
check('and Edit Customer draws it when it is pointed at a record',
  /renderEditCustPendingMove\(d\);/.test(admNoComments),
  'the renderer exists and is never called, so the move is invisible to the office');
/* ⚠ APPLY FILLS THE BOXES AND NOTHING ELSE. A write of its own here would be a
   second authoritative writer: the Save button is what re-geocodes, raises the
   re-quote with existingCustomerId and re-syncs a saved route stop. */
const applyBlock = admNoComments.slice(admNoComments.indexOf('function renderEditCustPendingMove'));
const applyBody = applyBlock.slice(0, applyBlock.indexOf('\n}\n'));
check('Apply fills the address and the town',
  /editCustAddress'\)\.value = move\.address/.test(applyBody) &&
  /editCustCity'\)\.value = move\.city/.test(applyBody),
  'the office retypes an address the customer already gave us, which is where a ' +
  'typo gets introduced');
check('and Apply writes nothing itself',
  !/updateDoc|setDoc|addDoc/.test(applyBody),
  'a second writer would move a pin nobody had looked at and skip the re-quote, ' +
  'the geocode and the route resync the Save button does');

/* ⚠ AND THE REQUEST IS RETIRED BY THE SAVE THAT GRANTS IT. A flag with a way in
   and no way out is the sticky-field bug this repo shipped once as maybeNextYear:
   the banner would sit there for ever advertising a move already applied, and the
   next person would apply it a second time over the corrected address. */
const clearBlock = admNoComments.slice(admNoComments.indexOf('if(addressChanged && (d.pendingAddress'));
/* ⚠ THE ASSIGNMENT, NOT THE NAME. `indexOf('addrUpdates.pendingAddress')` is a PREFIX
   of `addrUpdates.pendingAddressAt`, so deleting the line that clears the address
   itself left the check green on the strength of the date line beside it. The
   substring trap, and the red-check is what found it. */
check('the save clears the pending move once it applies it',
  /addrUpdates\.pendingAddress\s*=\s*''/.test(clearBlock) &&
  /addrUpdates\.pendingCity\s*=\s*''/.test(clearBlock) &&
  /addrUpdates\.pendingMoveDate\s*=\s*''/.test(clearBlock) &&
  /addrUpdates\.pendingAddressAt\s*=\s*null/.test(clearBlock),
  'the banner never goes away, and a move gets applied twice — the sticky-field bug ' +
  'this repo already shipped once as maybeNextYear');
/* ⚠ NOT ON THE ADDRESS MATCHING pendingAddress. The office routinely tidies what a
   customer typed, and on an exact test the banner would stick on every one of those. */
check('and it clears on the address having changed, not on it matching',
  /if\(addressChanged && \(d\.pendingAddress/.test(admNoComments),
  'the office tidying "St" to "Street" would leave the request standing for ever');
check('the badge is left for the re-quote to answer',
  !/seasonStatus/.test(clearBlock.slice(0, clearBlock.indexOf('\n    }'))),
  'clearing address_changed here drops the customer off the office filter while ' +
  'the re-quote it raised is still unanswered');

// ==========================================================================
// 5. AND NOTHING ELSE MAY CLEAR THE MOVE'S BADGE  (QT-37)
// ==========================================================================
/* ⭐ Addie, shown the drift and asked whether to tighten it: "go ahead."
 *
 * ⚠ WHAT THIS IS ABOUT. `address_changed` used to have ONE writer — a re-quote
 * raised by the portal — so three places treated it as this quote's own question
 * and cleared it back to `confirmed` when the quote was answered or deleted: the
 * add-on refusal, the same-as-last-year refusal, and the office deleting a
 * re-quote. The move door made it a SECOND writer, answered only by the office
 * applying the move, and all three were clearing that too.
 *
 * ⚠ SAID ACCURATELY: nothing routed or billed. seasonStatus is read for DISPLAY
 * only, and the move itself survived either way because the banner reads
 * pendingAddress. What went was the one signal on the row saying a house we have
 * not re-quoted is not settled.
 *
 * ⚠ THE BEHAVIOUR IS PROVED WHERE IT CAN RUN — Suites 137 and 138 of run-all.js
 * already drive both decline paths against a fake Firestore, so they assert the
 * status survives and, in the other direction, that an ordinary one still clears.
 * ⚠ WHAT IS LEFT HERE IS THE HALF THOSE CANNOT SEE: that the rule is written ONCE
 * per side, that all three sites ask it, and that the two copies agree. §9.1 —
 * one claim, one place. */
const mayClearSrv = lift(fns, 'quoteAnswerMayClearStatusServer');
const mayClearAdm = lift(adm.replace(/\r\n/g, '\n'), 'quoteAnswerMayClearStatus');
check('the rule exists on both sides', !!mayClearSrv && !!mayClearAdm,
  'one side deciding what may overwrite a move and the other guessing is the ' +
  'shape this whole entry is about');

/* ⚠ RUN, NOT COMPARED AS TEXT. They keep different brace styles on purpose — the
   claim is that they DECIDE the same thing, not that they are typed alike. Same
   argument money-parity.test.js makes about the invoice maths. */
const srvFn = new Function(mayClearSrv + ';return quoteAnswerMayClearStatusServer;')();
const admFn = new Function(mayClearAdm + ';return quoteAnswerMayClearStatus;')();
const MOVE_STATES = [
  {},
  { pendingAddress: '' },
  { pendingAddress: '   ' },
  { pendingAddress: '9 Oak St, Springville 84663' },
  { pendingAddress: '9 Oak St', seasonStatus: 'address_changed' },
  { pendingAddress: '9 Oak St', seasonStatus: 'needs_changes' },
  { seasonStatus: 'address_changed' },
  { pendingMoveDate: 'mid-October' },
  null,
  undefined
];
const disagree = MOVE_STATES.filter(d => srvFn(d) !== admFn(d));
check('and the two copies agree about every shape a record can be in',
  !disagree.length,
  'the office would keep a badge the server clears, or the other way round: ' +
  JSON.stringify(disagree));

/* ⚠ THE ANSWERS ARE ASSERTED, NOT ONLY THE AGREEMENT. Two copies wrong in the
   same way agree perfectly — money-parity's own rule, applied to a badge. */
check('a pending move holds the badge, and nothing else does',
  srvFn({ pendingAddress: '9 Oak St' }) === false &&
  srvFn({ pendingAddress: '  ' }) === true &&
  srvFn({ seasonStatus: 'address_changed' }) === true &&
  srvFn({}) === true && srvFn(null) === true,
  'a blank or whitespace pendingAddress is no move at all, and an ' +
  'address_changed with nothing pending is an ordinary re-quote question — ' +
  'holding that one back reopens the hole the clearing was written to close');

/* ⚠ AND IT MUST READ pendingAddress, NEVER THE STATUS. There is only ONE
   seasonStatus field, so a move can be outstanding while the pill shows
   needs_changes because something else wrote last — a guard keyed on the word
   would be a guess about which writer put it there. */
check('the rule asks about the pending move, not about the word',
  /pendingAddress/.test(stripComments(mayClearSrv)) &&
  !/address_changed|seasonStatus/.test(stripComments(mayClearSrv)),
  'keyed on the status it answers the wrong question, and misses a move whose ' +
  'pill has since been overwritten');

/* ⚠ ALL THREE SITES, NOT THE ONE THAT PROMPTED IT. "A fix in one direction is
   half a fix" is written into CLAUDE.md by name, and the payer-name bug in this
   repo was three callers where only one was corrected. */
const fnsNoC = stripComments(fns);
const srvCalls = (fnsNoC.match(/quoteAnswerMayClearStatusServer\(/g) || []).length;
check('both server clearing sites ask it',
  srvCalls === 3,
  'expected the declaration plus two callers, found ' + srvCalls +
  ' — declineAsksAboutLastYear and declineAddOnOnly each clear the status, and ' +
  'guarding one leaves the same bug reachable the other way');
/* ⚠ ANCHORED TO WHAT MUST BE TRUE, NOT TO OPERAND ORDER. The first version of this
   matched `indexOf(was) !== -1)` with a closing paren straight after — which is the
   shape that WAS wrong, and would also fail a perfectly good site that happened to
   write the guard first. That is the §7 slow-fuse: a check pinned to where a string
   sits, going red on code that is right. It now walks each use of the list and asks
   that the guard appears in the SAME condition, whichever side of it. */
const listUses = [];
for (let k = fnsNoC.indexOf('QUOTE_RAISED_STATUSES_SERVER.indexOf(');
     k !== -1;
     k = fnsNoC.indexOf('QUOTE_RAISED_STATUSES_SERVER.indexOf(', k + 1)) {
  /* The condition this use sits in: back to its own `if (`, forward to the brace or
     semicolon that ends the statement. */
  const from = fnsNoC.lastIndexOf('if (', k);
  let to = fnsNoC.length;
  ['{', ';'].forEach(ch => {
    const at = fnsNoC.indexOf(ch, k);
    if (at !== -1 && at < to) to = at;
  });
  listUses.push(fnsNoC.slice(from === -1 ? k : from, to + 1));
}
check('every server use of the list is in a condition that also asks the rule',
  listUses.length === 2 &&
  listUses.every(c => c.indexOf('quoteAnswerMayClearStatusServer(') !== -1),
  'found ' + listUses.length + ' use(s), ' +
  listUses.filter(c => c.indexOf('quoteAnswerMayClearStatusServer(') === -1).length +
  ' with no move guard in the same condition — a bare list test is the shape that ' +
  'was wrong, and a third clearing site added later needs the guard too');
check('the office delete asks it too',
  /QUOTE_RAISED_STATUSES\.indexOf\([\s\S]{0,80}?\)\s*!==\s*-1[\s\S]{0,80}?quoteAnswerMayClearStatus\(/
    .test(stripComments(adm.replace(/\r\n/g, '\n'))),
  'deleting a stale price re-quote for somebody who has since reported a move ' +
  'would clear the badge that move is holding');

// ==========================================================================
Promise.all(results.map(r => r.promise.then(v => r.assertFn(v)))).then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  if (failed) {
    console.log('A move would be applied without a pin, or told to nobody.\n');
    process.exit(1);
  }
});
