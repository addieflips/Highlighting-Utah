/*
 * A NEW FAULT ANNOUNCES ITSELF, AND THE NOTICE GOES AWAY WHEN IT IS MENDED
 *
 * [[FIX-02]]. Addie, asked how a new fix should surface: a System inbox note with
 * a link to the customer card, and the note disappears when it's done.
 *
 * ⚠ IT RUNS THE CODE rather than matching its source. Every claim here is about a
 * DOCUMENT THAT GETS WRITTEN, a document that gets DELETED, or a BUTTON THAT
 * EXISTS on screen — none of which a regex can see. This repo has been caught
 * three times by a check that matched the source of a message that could never
 * reach the page.
 *
 * ⚠ AND THE WIRING IS ASSERTED SEPARATELY FROM THE MECHANISM. The suite calls
 * raiseFixNotice and clearFixNotice from its own harness, so deleting the two
 * calls out of hlxMarkJobDone would leave every behavioural check green while
 * nothing whatsoever happened in the real page — the miss that Suite 276 and
 * [[MSG-14]] each had to learn.
 *
 * Its own file per R-018.
 */
const fs = require('fs');
const path = require('path');
const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, why) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (why ? '\n        ' + why : '')); }
}

/* ⚠ async-AWARE ON PURPOSE. A plain search for `function NAME(` starts its cut
   AFTER the `async` keyword, so an async function arrives as a plain one full of
   bare `await` — a parse error that kills the whole file as one unattributable
   crash. CLAUDE.md §5 records this costing three separate suites a run. */
function lift(name) {
  let i = admin.indexOf('async function ' + name + '(');
  if (i === -1) i = admin.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('cannot find ' + name + ' in admin.html');
  let depth = 0, started = false;
  for (let j = admin.indexOf('{', i); j < admin.length; j++) {
    if (admin[j] === '{') { depth++; started = true; }
    else if (admin[j] === '}') { depth--; if (started && depth === 0) return admin.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces lifting ' + name);
}
/* The whole declaration of a top-level const, so a table is read rather than
   copied. A copy here would agree with itself and say nothing about the app. */
function liftConst(name) {
  const i = admin.indexOf('const ' + name + ' =');
  if (i === -1) throw new Error('cannot find const ' + name);
  const end = admin.indexOf('\n};', i);
  const endLine = admin.indexOf('\n', i);
  /* A one-line const (FIX_NOTICE_TOPIC) has no closing brace of its own. */
  if (end === -1 || (endLine !== -1 && admin.slice(i, endLine).indexOf('{') === -1
      && admin.slice(i, endLine).indexOf('[') === -1)) {
    return admin.slice(i, endLine + 1);
  }
  const arrEnd = admin.indexOf('\n];', i);
  const stop = (arrEnd !== -1 && (end === -1 || arrEnd < end)) ? arrEnd + 3 : end + 3;
  return admin.slice(i, stop);
}

/* ------------------------------------------------------------------ *
 * A fake Firestore. It records what was written, to which document id,
 * and what was deleted — because the id is half the design here and a
 * stub that only counted calls could not see it.
 * ------------------------------------------------------------------ */
function makeDb() {
  const docs = new Map();
  const log = [];
  return {
    docs, log,
    doc: (_db, col, id) => ({ col, id }),
    getDoc: async (ref) => {
      log.push({ op: 'get', id: ref.id });
      const key = ref.col + '/' + ref.id;
      return { exists: () => docs.has(key), data: () => docs.get(key) };
    },
    setDoc: async (ref, data) => {
      log.push({ op: 'set', id: ref.id, data });
      docs.set(ref.col + '/' + ref.id, data);
    },
    deleteDoc: async (ref) => {
      log.push({ op: 'delete', id: ref.id });
      docs.delete(ref.col + '/' + ref.id);
    }
  };
}

function makeFns(db, opts) {
  const o = opts || {};
  const sandbox = new Function(
    'db', 'doc', 'getDoc', 'setDoc', 'deleteDoc', 'serverTimestamp', 'console',
    `
    ${liftConst('FIX_NOTICE_TOPIC')}
    ${lift('fixNoticeId')}
    ${lift('raiseFixNotice')}
    ${lift('clearFixNotice')}
    return { fixNoticeId, raiseFixNotice, clearFixNotice, FIX_NOTICE_TOPIC };
    `
  );
  return sandbox(
    {}, db.doc,
    o.getDocThrows ? async () => { throw new Error('read refused'); } : db.getDoc,
    o.setDocThrows ? async () => { throw new Error('write refused'); } : db.setDoc,
    o.deleteThrows ? async () => { throw new Error('delete refused'); } : db.deleteDoc,
    () => 'TS', { error: () => {} }
  );
}

const CUST = { name: 'Ashley Wray', phone: '8015550123', email: 'a@x.com',
               address: '209 S 850 W, Lehi, UT' };

(async function run() {
  console.log('\n=== A fix raises a System notice, and mending it takes the notice away ===\n');

  /* ---------- the id ---------- */
  {
    const db = makeDb();
    const f = makeFns(db);
    check('the notice id is derived from the customer id',
      f.fixNoticeId('abc123') === 'fix-abc123',
      'got ' + f.fixNoticeId('abc123'));
    check('no customer id means no notice id (nothing is written to "fix-")',
      f.fixNoticeId('') === '' && f.fixNoticeId(null) === '' && f.fixNoticeId(undefined) === '',
      'a blank id would collide every customer onto one document');
  }

  /* ---------- raising ---------- */
  {
    const db = makeDb();
    const f = makeFns(db);
    await f.raiseFixNotice('c1', CUST);
    const wrote = db.log.filter(e => e.op === 'set');
    check('raising a fix writes one notice', wrote.length === 1, wrote.length + ' writes');
    check('it is written at the derived id, not an auto id',
      wrote[0] && wrote[0].id === 'fix-c1', wrote[0] && wrote[0].id);
    const d = wrote[0] ? wrote[0].data : {};
    check('it carries the fix topic', d.topic === f.FIX_NOTICE_TOPIC, String(d.topic));
    check('it is a System notice, not a customer message', d.folder === 'System', String(d.folder));
    check('it carries the customerId the Open-their-card button reads',
      d.customerId === 'c1', String(d.customerId));
    check('it arrives unread', d.read === false, String(d.read));
    check('it names the customer and the house',
      String(d.message).indexOf('Ashley Wray') !== -1 &&
      String(d.message).indexOf('209 S 850 W') !== -1, String(d.message).slice(0, 80));
    /* ⚠ The one thing the office must not have to guess is whether the row goes
       away by itself, because a notice that lingers reads as a fault still open. */
    check('it says the notice clears itself when the fix is done',
      /disappears by itself|clears itself/i.test(String(d.message)),
      'the row has to say it will go, or nobody trusts that it did');
    check('a raise with no customer writes nothing at all',
      (await f.raiseFixNotice('', CUST)).ok === false && wrote.length === 1);
  }

  /* ---------- raising twice ---------- */
  {
    const db = makeDb();
    const f = makeFns(db);
    await f.raiseFixNotice('c1', CUST);
    /* The office reads it. */
    db.docs.get('messages/fix-c1').read = true;
    const res = await f.raiseFixNotice('c1', CUST);
    const wrote = db.log.filter(e => e.op === 'set');
    check('raising the same fix twice does not stack a second notice',
      wrote.length === 1, wrote.length + ' writes — toggling Needs Fix would pile them up');
    check('and it does not re-mark a notice she has already read',
      db.docs.get('messages/fix-c1').read === true,
      'a notice that springs back to unread on every toggle is the cries-wolf failure');
    check('the second raise reports that one was already there', res.already === true);
  }

  /* ---------- clearing ---------- */
  {
    const db = makeDb();
    const f = makeFns(db);
    await f.raiseFixNotice('c1', CUST);
    await f.clearFixNotice('c1');
    check('marking the fix done deletes the notice',
      !db.docs.has('messages/fix-c1'), 'the notice outlived the fault');
    check('it deletes the notice for THAT customer',
      db.log.filter(e => e.op === 'delete')[0].id === 'fix-c1');
    /* Two houses, one mended. */
    const db2 = makeDb();
    const f2 = makeFns(db2);
    await f2.raiseFixNotice('c1', CUST);
    await f2.raiseFixNotice('c2', { name: 'Someone Else', address: '1 Elm St' });
    await f2.clearFixNotice('c1');
    check('mending one house leaves the other house\'s notice alone',
      !db2.docs.has('messages/fix-c1') && db2.docs.has('messages/fix-c2'));
  }

  /* ---------- neither half may throw ---------- */
  {
    const f = makeFns(makeDb(), { setDocThrows: true });
    let threw = false;
    try { await f.raiseFixNotice('c1', CUST); } catch (e) { threw = true; }
    check('a refused notice write never throws (it must not cost the flag)', !threw);
  }
  {
    const db = makeDb();
    const f = makeFns(db, { getDocThrows: true });
    let threw = false;
    try { await f.raiseFixNotice('c1', CUST); } catch (e) { threw = true; }
    check('a refused read never throws', !threw);
    check('and a failed read writes nothing rather than clobbering a read notice',
      db.log.filter(e => e.op === 'set').length === 0);
  }
  {
    const f = makeFns(makeDb(), { deleteThrows: true });
    let threw = false;
    try { await f.clearFixNotice('c1'); } catch (e) { threw = true; }
    check('a refused delete never throws', !threw);
  }

  /* ---------- the wiring, asserted separately ---------- */
  {
    const src = lift('hlxMarkJobDone');
    check('hlxMarkJobDone raises the notice when a fix is raised',
      /raiseFixNotice\(/.test(src),
      'the mechanism can be perfect and never run — see Suite 276');
    check('hlxMarkJobDone clears the notice when a fix is marked done',
      /clearFixNotice\(/.test(src));
    /* ⚠ THE BRANCH, NOT JUST THE CALLS. Raising on `done` and clearing on `!done`
       is the whole rule inverted, and both calls would still be present. */
    const branch = src.slice(src.indexOf("kind === 'fix'"));
    check('the clear is on done and the raise is on not-done, not the other way round',
      branch.indexOf('clearFixNotice') < branch.indexOf('raiseFixNotice') &&
      /if\s*\(done\)\s*await clearFixNotice/.test(branch),
      'inverted, a mended house shouts and a broken one goes quiet');
    /* ⚠ IT MUST NOT FIRE FOR AN INSTALL OR A TAKEDOWN. The three kinds are
       independent everywhere else and this is no exception. */
    check('nothing is raised for an install or a takedown',
      /kind === 'fix'/.test(src) && !/raiseFixNotice\([^)]*\)\s*;?\s*$/m.test(src.split("kind === 'fix'")[0]),
      'an install would post a fix notice');
  }

  /* ---------- the topic reaches all four tables ---------- */
  {
    const topicLine = liftConst('FIX_NOTICE_TOPIC');
    const topic = /'([^']+)'/.exec(topicLine)[1];
    check('the topic is declared once, as a constant, not typed out per table',
      (admin.split("'" + topic + "'").length - 1) === 1,
      'a second spelling is a notice written to one table and read by none');
    check('it types as a system notice (SYSTEM_NOTICE_TOPICS)',
      /FIX_NOTICE_TOPIC\s*\n?\s*\]/.test(liftConst('SYSTEM_NOTICE_TOPICS')) ||
      liftConst('SYSTEM_NOTICE_TOPICS').indexOf('FIX_NOTICE_TOPIC') !== -1);
    /* ⚠ AN UNLISTED TOPIC FALLS THROUGH TO "Everything else" SILENTLY, which is
       exactly where nobody looks — so this one is about the row being findable,
       not about tidiness. */
    check('it has a section in the System tab, and it is Schedule & Routes',
      /\[FIX_NOTICE_TOPIC\]:\s*'schedule'/.test(liftConst('SYSTEM_NOTICE_SECTION_OF')),
      'unlisted, it lands in Everything else');
    check('it carries the Repair / Issue category',
      /\[FIX_NOTICE_TOPIC\]:\s*\['Repair \/ Issue'\]/.test(liftConst('MSG_TOPIC_CATEGORIES')));
    /* ⚠ NOT ROUTINE. noticeIsRoutine folds a topic behind one collapsed line and
       out of both unread badges — right for the route sweep, catastrophic here. */
    const routine = lift('noticeIsRoutine');
    check('it is never folded away as a routine sweep note',
      routine.indexOf('FIX_NOTICE_TOPIC') === -1 &&
      /ROUTINE_NOTICE_TOPIC/.test(routine),
      'folded away, the notice exists and nobody is told');
  }

  /* ---------- the row on screen ---------- */
  {
    const rowSrc = lift('systemNoticeRow');
    check('the notice row offers a link to the customer card',
      /data-noticecust=/.test(rowSrc),
      'Addie asked for "a link to the customer card"');
    /* ⚠ GATED ON THE FIELD, so a notice that names no customer does not offer a
       button that cannot work. */
    check('the link is only drawn when the notice names a customer',
      /d\.customerId\s*\?/.test(rowSrc));
    const wire = lift('systemNoticeWireRows');
    check('the link is actually wired to a handler',
      /\[data-noticecust\]/.test(wire),
      'a rendered button with no listener looks identical to a working one');
    check('the handler opens Edit Customer',
      /openEditCustomerModal\(/.test(wire));
    /* ⚠ openEditCustomerModal RETURNS SILENTLY for an id it cannot find, and a
       customer can have been removed or recycled since the notice was written. */
    check('and it says so rather than doing nothing when that customer is gone',
      /no longer on file/.test(wire),
      'otherwise this is a button that silently does nothing');
  }

  /* ---------- the notice is excluded from the customer list ---------- */
  {
    /* A System notice must not appear in the main Inbox list as well — it would be
       in two places, and the office would answer it twice. renderMessagesList's own
       filter is what does this; asserted here because the topic is new. */
    const listSrc = lift('renderMessagesList');
    check('System notices stay out of the customer message list',
      /!==\s*'System'/.test(listSrc),
      'the notice would show in both tabs');
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
