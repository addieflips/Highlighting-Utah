/*
 * DELETING ONE ARCHIVED RECORD  ([[ARCH-02]], 2026-09-23)
 *
 * Addie: "can we make a place to delete people in archive on each individual one."
 *
 * ⛔ WHY THIS HAS ITS OWN FILE AND ITS OWN CARE. [[ARCH-01]] made the Archive the last
 * copy of anybody the office removes — Delete All Customers, Delete Customer, an RSVP no.
 * This adds the one button that can destroy that copy, so the whole of this gate is about
 * the cases where it must NOT.
 *
 * ⛔ THE CASE THAT CANNOT BE UNDONE BY ANYBODY is a row whose `recycled` is false. That
 * query IS the warehouse recycle queue (`whWatchArchivedPending`), the customer record is
 * already gone, and nothing anywhere else remembers that their lights are on a shelf. So
 * deleting it takes a real job off a real list with nothing to rebuild it from. It
 * REFUSES rather than warning, because there is a door to point at — Mark Recycled in the
 * Warehouse writes `recycled: true` on this very row ([[QT-42]]'s rule: a refusal is only
 * honest when it can name the way through).
 *
 * ⛔ AND IT IS RUN, NOT MATCHED. Every claim here is about which rows refuse and what a
 * press actually writes, which no source scan can see: the rule and the real delegated
 * handler are both lifted and driven against a fake list and a fake Firestore.
 *
 * Run:  node archive-delete.test.js      (or: npm run test:archdel)
 */

const fs = require('fs');
const path = require('path');

const root = __dirname;
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, why) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name + (why ? ' — ' + why : '')); console.log('  FAIL  ' + name); }
}

/* ⚠ COMMENTS STRIPPED BEFORE ANY SOURCE CHECK. Every rule below is argued in prose beside
   the code it governs, so a plain search finds the explanation and calls it the thing —
   Suites 58, 274, 275 and 300 each learned this the same way. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function lift(src, name) {
  let start = src.indexOf('async function ' + name + '(');
  if (start === -1) start = src.indexOf('function ' + name + '(');
  if (start === -1) return null;
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  return null;
}

console.log('\n=== Deleting one archived record ===\n');

const ruleSrc = lift(admin, 'archRowBlocksDelete');
/* ⛔ THE GUARD THAT STOPS EVERYTHING BELOW PASSING VACUOUSLY. An empty lift makes the
   sandbox throw on construction, which reads as one failure while a dozen behavioural
   checks never ran at all. */
check('the refusal rule was found to lift', !!ruleSrc,
  'renamed or gone — repoint this gate rather than deleting it');

if (ruleSrc) {
  const blocks = new Function(ruleSrc + ';return archRowBlocksDelete;')();

  /* ---- the rule itself ------------------------------------------------- */

  /* ⛔ THE ONE THAT MUST REFUSE. Their lights are out, this row is the only thing saying
     so, and the customer record is already gone. */
  check('a removed customer whose lights are still out cannot be deleted',
    blocks({ recycled: false }) === true,
    'this row IS their place on the warehouse recycle queue, and nothing else remembers');

  /* ⚠ ONCE THE BIN IS BACK, IT IS ORDINARY HISTORY. Mark Recycled writes this, and it is
     what makes the refusal above a door rather than a wall. */
  check('and can be deleted once the warehouse marks them recycled',
    blocks({ recycled: true }) === false,
    'Mark Recycled is the way through — if it does not open this, the refusal is a wall');

  /* ⛔ AN ABSENT FIELD IS NOT A BLOCK, AND THIS IS THE HALF THAT WOULD LOCK THE SCREEN.
     [[ARCH-01]]'s snapshots deliberately carry no `recycled` (Firestore cannot match an
     absent field, which is exactly what keeps them out of that queue), and every row
     written before this existed carries none either. Reading "unknown" as "still out"
     refuses the whole archive. */
  check('a row with no recycled field at all is not blocked',
    blocks({}) === false && blocks({ reason: 'recycled' }) === false,
    'every pre-existing row and every ARCH-01 snapshot carries none — this would lock ' +
    'the entire screen while looking like a safety feature');

  /* ⛔ AND A CUSTOMER WHO IS STILL ON THE BOOKS IS NEVER BLOCKED, whatever else the row
     says. The warehouse works from their LIVE record; this is only a snapshot of the day
     they answered, and losing it costs nobody a bin. */
  check('a Copy kept snapshot is never blocked, even carrying recycled:false',
    blocks({ stillACustomer: true }) === false &&
    blocks({ stillACustomer: true, recycled: false }) === false,
    'their live record is what the warehouse reads; blocking here refuses a delete that ' +
    'costs nothing');

  check('and a missing row answers no rather than throwing',
    blocks(null) === false && blocks(undefined) === false);
}

/* ---- the handler, RUN ------------------------------------------------- *
 * ⛔ THE RULE BEING RIGHT IS HALF OF IT. The press has to ask it too — a button that is
 * merely disabled is still reachable by keyboard, and the row may have been drawn before
 * somebody else marked them recycled. [[WH-43]]'s two handlers re-ask for the same reason.
 * ---------------------------------------------------------------------- */

const handlerStart = admin.indexOf("document.getElementById('archList')?.addEventListener('click'");
const handlerEnd = admin.indexOf('\r\n});', handlerStart);
const handlerSrc = handlerStart === -1 || handlerEnd === -1
  ? '' : admin.slice(handlerStart, handlerEnd + 5);

check('the Archive delete handler was found', !!handlerSrc && /data-archdel/.test(handlerSrc),
  'renamed or moved — every check below runs it');

if (handlerSrc && ruleSrc) {
  /* Drives the REAL handler against a fake row list and a fake Firestore.
     ⚠ `archCache` IS DECLARED INSIDE THE SANDBOX, NOT PASSED IN. The handler drops the
     deleted row by REASSIGNING it, and a reassigned parameter is invisible to the caller —
     so passing it would make "the row leaves the screen" unobservable, and the check would
     pass whether the line is there or not. */
  function press(rowData, opts) {
    const o = opts || {};
    const log = { deleted: [], toasts: [], alerts: [], confirms: [], activity: [], rendered: 0 };
    let listener = null;
    const btn = { dataset: { archdel: 'a1' }, disabled: false, closest: () => btn };
    const ctx = {
      document: {
        getElementById: (id) => id === 'archList'
          ? { addEventListener: (_evt, fn) => { listener = fn; } }
          : { addEventListener: () => {} }
      },
      __seed: [{ id: 'a1', data: rowData }],
      archRender: () => { log.rendered++; },
      db: {}, doc: (db, col, id) => ({ col: col, id: id }),
      deleteDoc: async (ref) => {
        if (o.writeThrows) throw new Error('permission-denied');
        log.deleted.push(ref);
      },
      toast: (t) => log.toasts.push(t),
      alert: (t) => log.alerts.push(t),
      confirm: (t) => { log.confirms.push(t); return o.confirm !== false; },
      logActivity: (t) => log.activity.push(t),
      archRowBlocksDelete: new Function(ruleSrc + ';return archRowBlocksDelete;')()
    };
    const names = Object.keys(ctx);
    const readCache = new Function(...names,
      'let archCache = __seed;\n' + handlerSrc + '\nreturn function(){ return archCache; };'
    )(...names.map(n => ctx[n]));
    return Promise.resolve(listener({ target: btn }))
      .then(() => ({ log: log, btn: btn, cache: readCache() }));
  }

  (async () => {
    /* ---- the ordinary case ------------------------------------------- */
    {
      const r = await press({ recycled: true, customer: { name: 'Liz Frome' } });
      check('deleting an ordinary archived record removes that one row',
        r.log.deleted.length === 1 && r.log.deleted[0].col === 'archivedCustomers' &&
        r.log.deleted[0].id === 'a1',
        'got ' + JSON.stringify(r.log.deleted));
      /* ⛔ NOTHING BUT THIS ROW. Their number went back to the pool when they were removed
         and may since have been handed to somebody new, so pooling it again here would put
         a live label on a second bin. */
      check('and touches no other collection at all',
        r.log.deleted.every(d => d.col === 'archivedCustomers'),
        'their number, invoice and routes are already settled — a second pooling here ' +
        'would label two bins the same');
      check('and it names them in the confirmation and the activity log',
        /Liz Frome/.test(r.log.confirms[0] || '') && /Liz Frome/.test(r.log.activity[0] || ''),
        '"Delete this item?" on a screen of names is a question nobody can answer safely');
      /* ⚠ THE LIST REDRAWS FROM THE CACHE rather than refetching — a row still on screen
         after a delete reads as the button not working. */
      check('and the row leaves the screen without a refetch',
        r.cache.length === 0 && r.log.rendered === 1,
        'cache ' + r.cache.length + ', renders ' + r.log.rendered);
    }

    /* ---- the refusal -------------------------------------------------- */
    {
      const r = await press({ recycled: false, customer: { name: 'Ashley Wray' } });
      check('a press on a row whose lights are still out deletes nothing',
        r.log.deleted.length === 0 && r.log.confirms.length === 0,
        'a disabled button is still reachable by keyboard, and the row may have been ' +
        'drawn before somebody marked them recycled');
      /* ⛔ AND IT NAMES THE WAY THROUGH. A refusal with no route out is indistinguishable
         from the button not working — [[QT-42]]'s rule. */
      check('and it says to mark them recycled in the Warehouse first',
        /recycled/i.test(r.log.alerts[0] || '') && /Warehouse/i.test(r.log.alerts[0] || ''),
        'got ' + JSON.stringify(r.log.alerts));
      check('and the button is left usable for afterwards',
        r.btn.disabled === false,
        'disabling it on a refusal strands the row even once the warehouse is done');
    }

    /* ---- the confirmation says what is actually lost ------------------ */
    {
      const kept = await press({ stillACustomer: true, customer: { name: 'Dana Byrd' } });
      /* ⚠ TWO DIFFERENT LOSSES AND ONE SENTENCE CANNOT COVER BOTH. Telling somebody "this
         is the last copy of them" about a customer who is still on the books is the screen
         frightening her out of a delete that costs nothing. */
      check('deleting a Copy kept snapshot says they are still a customer',
        /STILL A CUSTOMER/i.test(kept.log.confirms[0] || '') &&
        !/last copy/i.test(kept.log.confirms[0] || ''),
        'got ' + JSON.stringify(kept.log.confirms));
      const gone = await press({ recycled: true, customer: { name: 'Gone' } });
      check('and a removed customer is told it is the last copy',
        /last copy/i.test(gone.log.confirms[0] || ''),
        'their address, phone, price and colours go with it — that has to be said');
    }

    /* ---- saying no, and a refused write ------------------------------- */
    {
      const r = await press({ recycled: true, customer: { name: 'Nope' } }, { confirm: false });
      check('answering no to the confirmation writes nothing',
        r.log.deleted.length === 0 && r.cache.length === 1);
    }
    {
      const r = await press({ recycled: true, customer: { name: 'Boom' } }, { writeThrows: true });
      /* ⚠ A REFUSED WRITE PUTS THE BUTTON BACK AND SAYS SO. Left disabled with the row
         still there, it reads as a delete that half happened. */
      check('a refused write keeps the row, re-enables the button and says why',
        r.cache.length === 1 && r.btn.disabled === false && r.log.toasts.length === 1 &&
        /permission-denied|try again/i.test(r.log.toasts[0]),
        'got ' + JSON.stringify(r.log.toasts) + ' disabled=' + r.btn.disabled);
    }

    /* ---- the wiring, asserted separately ------------------------------ *
     * ⛔ EVERY CHECK ABOVE CALLS THE LISTENER DIRECTLY. Delete the button from the row and
     * all of them stay green while nothing on screen can reach it — the
     * mechanism-without-wiring trap this repo has shipped twice.
     * ------------------------------------------------------------------ */
    const bare = stripComments(admin);
    const renderSrc = lift(bare, 'archRender') || '';
    check('archRender was found to lift', !!renderSrc);
    check('the row actually draws a Delete button',
      /data-archdel="' \+\s*esc\(r\.id\)/.test(renderSrc),
      'the handler is reachable only from a button that exists');
    /* ⚠ AND THE ROW SAYS WHY IT CANNOT BE DELETED rather than only greying out. A control
       that refuses on press with no reason on screen is one somebody presses again. */
    check('and a blocked row explains itself, on the row',
      /archRowBlocksDelete\(r\.data\)/.test(renderSrc) &&
      /Mark them recycled in the Warehouse/.test(renderSrc),
      'greyed out with no reason is indistinguishable from broken');
    /* ⚠ DELEGATED ON THE CONTAINER, BOUND ONCE. `archRender` rebuilds #archList wholesale
       on every search keystroke, so a bind per row inside it would stack a listener per
       render — the Inbox drop that fired 2815 Firestore writes, in a new place. */
    check('the listener is bound once, on the container, outside the renderer',
      (bare.split("getElementById('archList')?.addEventListener").length - 1) === 1 &&
      !/addEventListener/.test(renderSrc),
      'a bind inside archRender accumulates one listener per keystroke');

    console.log('');
    failures.forEach(f => console.log('  FAIL  ' + f + '\n'));
    console.log(pass + ' passed, ' + fail + ' failed\n');
    if (fail) {
      console.log('The Archive is the last copy of anybody the office removed. A delete that');
      console.log('reaches a row whose lights are still out loses a warehouse job for good.\n');
    }
    process.exit(fail ? 1 : 0);
  })();
}
