/*
 * Marking ONE customer as already asked
 * Highlighting Utah
 *
 * WHY THIS IS ITS OWN GATE
 * Addie, 2026-09-10, asked what she can actually get out of EmailJS for the
 * customers she is re-sending to: individual error emails only. No list, nowhere.
 *
 * That answer rules out both of the things that existed:
 *   - a paste box is useless, because there is nothing to paste;
 *   - `rsvpMarkAllAsked` is WRONG, because it stamps everybody the planner would
 *     write to and she has emailed SOME of them.
 *
 * ⚠ THE COST OF GETTING THIS WRONG IS NOT A DUPLICATE EMAIL. A customer wrongly
 * marked as asked is never asked again this season; `SEASON_ELIGIBILITY` is
 * `confirmed-only`, so somebody who never answers is dropped by `isOutForSeason`
 * from the routes, the build queue and the schedule. One mistaken tick is a house
 * no crew is ever sent to. That asymmetry is why the marked row stays on screen
 * with an Undo instead of vanishing, and most of what this file checks.
 *
 * ⚠ IT RUNS THE SHIPPED CODE, IT DOES NOT MATCH ITS SOURCE. Every claim here is
 * about who ends up on a list and what reaches Firestore, and this repo has been
 * caught repeatedly by a regex that was green over behaviour which could never
 * happen (the ledger renderer, the recycle "bin says" box, the colour-change fee
 * written after its own save).
 *
 * ⚠ AND THE PLAN IS LIFTED, NEVER RE-IMPLEMENTED. `rsvpWholePlan` is the one rule
 * for who is waiting to be asked; a second opinion written here would agree with
 * itself and prove nothing about what ships. Its own dependencies ARE stubbed —
 * they are the fixture dial, not the thing under test — and each is named below.
 *
 * R-018: one file, one job, wired into `npm test`.
 *
 * Run:  node rsvp-mark-one.test.js      (or: npm run test:markone)
 */

const fs = require('fs');
const path = require('path');

const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; } else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); }
}

/* Lifts a function by name, slicing to its closing brace at column 0 — the same
   terminator every other harness in this repo relies on. `async` first, because
   matching only `function NAME(` hands back a body full of bare `await`, which is
   a parse error that kills the whole file as one unattributable crash (CLAUDE.md §5). */
function lift(name) {
  for (const opener of ['async function ' + name + '(', 'function ' + name + '(']) {
    const at = admin.indexOf(opener);
    if (at === -1) continue;
    const end = admin.indexOf('\n}', at);
    if (end === -1) return '';
    return admin.slice(at, end + 2);
  }
  return '';
}
function liftOk(src) {
  if (!src) return false;
  try { new Function(src + '\nreturn 1;'); return true; } catch (e) { return false; }
}
/* Match the code, never the prose describing the code. Every name checked below
   also appears in the comments explaining it — Suites 58, 274, 275 and 300 each
   learned this separately and §7 has the general form. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const LIFTS = ['rsvpWholePlan', 'rsvpMarkOneRows', 'rsvpMarkOneRender', 'rsvpMarkOneAsked'];
LIFTS.forEach(function (n) {
  check('lifted ' + n + ' and it parses', liftOk(lift(n)),
    'a truncated lift answers confidently and wrongly while the suite reports green');
});

/* ------------------------------------------------------------------
   The sandbox.
   ------------------------------------------------------------------ */
const { JSDOM } = require('jsdom');

/* Builds a fresh world per scenario. Returns the sandbox's own globals so a test
   can read what reached "Firestore" and what the local cache now says. */
function world(records, opts) {
  const o = opts || {};
  const dom = new JSDOM(
    '<div id="rsvpMarkOneStatus"></div>' +
    '<input id="rsvpMarkOneFilter" value="' + ((o.filter || '').replace(/"/g, '&quot;')) + '">' +
    '<div id="rsvpMarkOneList"></div>');

  const writes = [];
  const api = {
    document: dom.window.document,
    console: { error: function () {}, warn: function () {}, log: function () {} },
    jobAddresses: records,
    esc: function (s) {
      return ('' + s).replace(/[&<>"]/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
      });
    },
    /* ⚠ STUBBED ON PURPOSE, AND THESE ARE THE FIXTURE DIAL. Each one is a
       question the plan asks ABOUT a record; driving them from fields on the
       fixture is what lets one book express every bucket. The plan itself — the
       thing under test — is the real lifted code. */
    isTestRecordData: function (d) { return d.isTest === true; },
    audienceNeverAsked: function (d) { return d.neverAsked === true; },
    effectiveRsvpStatus: function (d) { return d.rsvpStatus || ''; },
    etNoAutomationEmails: function (d) { return d.noAuto === true; },
    houseOwesFromLastSeason: function (d) { return d.owes === true; },
    audienceHasLastSeason: function () { return o.invoicesLoaded !== false; },
    /* A fake Firestore that records what it was asked to write, and can refuse. */
    doc: function (_db, coll, id) { return { coll: coll, id: id }; },
    db: {},
    serverTimestamp: function () { return 'SERVER_TS'; },
    updateDoc: async function (ref, payload) {
      if (o.writeFails) throw new Error('permission denied');
      writes.push({ id: ref.id, coll: ref.coll, payload: payload });
      return true;
    },
    rsvpWholeRenderBreakdown: function () {}
  };

  const names = Object.keys(api);
  const body =
    'const rsvpMarkOneRecent = new Set();\n' +
    'const RSVP_MARK_ONE_SHOWN = ' + (o.shown || 50) + ';\n' +
    LIFTS.map(lift).join('\n') + '\n' +
    'return { rsvpWholePlan, rsvpMarkOneRows, rsvpMarkOneRender, rsvpMarkOneAsked,' +
    '         rsvpMarkOneRecent, doc: document };\n';

  const made = new Function(names.join(','), body).apply(null, names.map(function (k) { return api[k]; }));
  made.writes = writes;
  made.records = records;
  return made;
}

const cust = function (id, over) {
  return { id: id, data: Object.assign({ name: id, email: id + '@x.com' }, over || {}) };
};

/* One book carrying every bucket the plan can produce. */
const BOOK = function () {
  return [
    cust('anna'),                                   // waiting, ordinary
    cust('brian', { owes: true }),                  // waiting, arrears
    cust('cara'),                                   // waiting, ordinary
    cust('dan', { rsvpStatus: 'yes' }),             // answered
    cust('erin', { noAuto: true }),                 // do-not-send
    cust('fred', { email: '' }),                    // no email
    cust('gina', { rsvpEmailedAt: 'a-date' }),      // already emailed
    cust('hank', { neverAsked: true }),             // new this year
    cust('iris', { isTest: true })                  // test record
  ];
};

(function main() {

  /* ---------------------------------------------------------------------
     1. WHO IS OFFERED A TICK. The bulk button's own rule, per person.
     --------------------------------------------------------------------- */
  {
    const w = world(BOOK());
    const ids = w.rsvpMarkOneRows().rows.map(function (r) { return r.item.id; }).sort();
    check('offers exactly the people the send would go to',
      JSON.stringify(ids) === JSON.stringify(['anna', 'brian', 'cara']),
      'got ' + JSON.stringify(ids));
    /* ⚠ EACH OF THESE IS A DIFFERENT WAY TO RECORD A LIE. Stamping somebody
       opted out or with no email records that we wrote to a person we cannot
       write to; stamping an answered customer overwrites a real reply. */
    check('never offers the do-not-send list', ids.indexOf('erin') === -1);
    check('never offers somebody with no email on file', ids.indexOf('fred') === -1);
    check('never offers somebody who already answered', ids.indexOf('dan') === -1);
    check('never offers a customer already marked as emailed', ids.indexOf('gina') === -1);
    check('never offers somebody who has never had lights', ids.indexOf('hank') === -1);
    check('never offers a test record', ids.indexOf('iris') === -1);
    /* Arrears customers are waiting to be asked exactly like anybody else — they
       get a different TEMPLATE, not a different answer to "has this person been
       asked". Leaving them out would make them unmarkable and permanently unasked. */
    check('includes an arrears customer', ids.indexOf('brian') !== -1,
      'they get the Not Paid email, but they are still waiting to be asked');
  }

  /* ⚠ NOT READY IS NOT EMPTY. The plan refuses until the invoices have loaded.
     Reporting an empty list then would read as "nobody is waiting" on a screen
     whose whole job is to say who still is. */
  {
    const w = world(BOOK(), { invoicesLoaded: false });
    const got = w.rsvpMarkOneRows();
    check('says why rather than showing an empty list before invoices load',
      got.ready === false && !!got.why && got.rows.length === 0,
      'ready=' + got.ready + ' why=' + JSON.stringify(got.why));
  }

  /* ---------------------------------------------------------------------
     2. THE WRITE. One record, the right field.
     --------------------------------------------------------------------- */
  {
    const w = world(BOOK());
    return w.rsvpMarkOneAsked('anna', true).then(function () {
      check('marks exactly one customer', w.writes.length === 1,
        'wrote ' + w.writes.length);
      check('and it is the one named', w.writes[0] && w.writes[0].id === 'anna');
      check('writes to jobAddresses', w.writes[0] && w.writes[0].coll === 'jobAddresses');
      check('sets rsvpEmailedAt to a server timestamp',
        w.writes[0] && w.writes[0].payload.rsvpEmailedAt === 'SERVER_TS');
      check('and writes nothing else on that record',
        w.writes[0] && Object.keys(w.writes[0].payload).length === 1,
        'got ' + JSON.stringify(w.writes[0] && w.writes[0].payload));

      /* The optimistic mirror, so the plan recomputes before the listener returns. */
      const anna = w.records.find(function (r) { return r.id === 'anna'; });
      check('mirrors into the local cache so the counts move at once',
        !!anna.data.rsvpEmailedAt);
      check('and the marked customer leaves the waiting list',
        w.rsvpMarkOneRows().rows.filter(function (r) { return r.item.id === 'anna' && !r.marked; }).length === 0);

      return rest();
    });
  }

  function rest() { return Promise.resolve()

    /* ---------------------------------------------------------------------
       3. THE UNDO STAYS REACHABLE. The point of the whole design.
       --------------------------------------------------------------------- */
    .then(function () {
      const w = world(BOOK());
      return w.rsvpMarkOneAsked('anna', true).then(function () {
        const rows = w.rsvpMarkOneRows().rows;
        const annaRow = rows.filter(function (r) { return r.item.id === 'anna'; })[0];
        /* ⚠ THIS IS THE CHECK THE FEATURE EXISTS FOR. The stamp moves that customer
           out of `standard` and into `alreadyEmailed` the instant it lands, so a
           plain redraw drops the row — and the Undo with it, one frame after a
           press that may have been a mistake. A mistaken tick is a house no crew
           is sent to, so the way back must survive the redraw. */
        check('a customer marked in this session stays on screen',
          !!annaRow, 'the Undo vanishes with the row, one frame after the press');
        check('and is shown as marked, not as still waiting',
          !!annaRow && annaRow.marked === true);
        check('while everybody else is still waiting',
          rows.filter(function (r) { return !r.marked; }).map(function (r) { return r.item.id; }).sort().join(',') === 'brian,cara');
      });
    })

    .then(function () {
      const w = world(BOOK());
      return w.rsvpMarkOneAsked('anna', true)
        .then(function () { return w.rsvpMarkOneAsked('anna', false); })
        .then(function () {
          check('undo writes a second time', w.writes.length === 2);
          /* ⚠ `null`, NOT a deleted field — that is what Start New Season writes
             and what `rsvpWholePlan` tests for. Two spellings of "not asked" is
             how one of them quietly stops counting. */
          check('undo clears the stamp with null',
            w.writes[1] && w.writes[1].payload.rsvpEmailedAt === null,
            'got ' + JSON.stringify(w.writes[1] && w.writes[1].payload));
          const anna = w.records.find(function (r) { return r.id === 'anna'; });
          check('and the local cache is cleared too', !anna.data.rsvpEmailedAt);
          check('so they are back on the list to be asked',
            w.rsvpMarkOneRows().rows.filter(function (r) { return r.item.id === 'anna' && !r.marked; }).length === 1);
        });
    })

    /* ---------------------------------------------------------------------
       4. A REFUSED WRITE CHANGES NOTHING AND SAYS SO.
       --------------------------------------------------------------------- */
    .then(function () {
      const w = world(BOOK(), { writeFails: true });
      return w.rsvpMarkOneAsked('anna', true).then(function () {
        const anna = w.records.find(function (r) { return r.id === 'anna'; });
        /* ⚠ THE MIRROR MUST COME AFTER THE WRITE. The other order shows her a
           customer marked as asked that was never written — and because nothing
           will ever ask them again, that silence costs a house. */
        check('a refused write leaves the record unmarked', !anna.data.rsvpEmailedAt,
          'mirroring before the await shows a stamp that does not exist');
        check('and does not pretend it was marked',
          w.rsvpMarkOneRows().rows.filter(function (r) { return r.item.id === 'anna' && r.marked; }).length === 0);
        const st = w.doc.getElementById('rsvpMarkOneStatus').textContent;
        check('and says nothing was saved — nothing fails quietly',
          /nothing was saved/i.test(st), 'status read: ' + JSON.stringify(st));
      });
    })

    /* ---------------------------------------------------------------------
       5. THE SEARCH. What the job actually looks like: one address, in an
          error email, to be found among hundreds.
       --------------------------------------------------------------------- */
    .then(function () {
      const w = world(BOOK(), { filter: 'brian@x.com' });
      w.rsvpMarkOneRender();
      const html = w.doc.getElementById('rsvpMarkOneList').innerHTML;
      /* ⚠ BY EMAIL IS THE ONE THAT MATTERS. The name in an error email is ours and
         may be spelled any number of ways; the ADDRESS is the customer's own and
         is what EmailJS names. Matching only on name would miss the real job. */
      check('finds a customer by the exact address an error email names',
        html.indexOf('data-rsvpmarkone="brian"') !== -1);
      check('and shows nobody else', html.indexOf('data-rsvpmarkone="anna"') === -1
        && html.indexOf('data-rsvpmarkone="cara"') === -1);
    })

    .then(function () {
      const w = world(BOOK(), { filter: 'anna' });
      w.rsvpMarkOneRender();
      const html = w.doc.getElementById('rsvpMarkOneList').innerHTML;
      check('finds a customer by name too', html.indexOf('data-rsvpmarkone="anna"') !== -1);
      check('and still shows nobody else', html.indexOf('data-rsvpmarkone="brian"') === -1);
    })

    .then(function () {
      const w = world(BOOK(), { filter: 'BRIAN@X.COM' });
      w.rsvpMarkOneRender();
      check('the search ignores case — an address is not typed the way it is stored',
        w.doc.getElementById('rsvpMarkOneList').innerHTML.indexOf('data-rsvpmarkone="brian"') !== -1);
    })

    .then(function () {
      const w = world(BOOK(), { filter: 'nobody@nowhere.com' });
      w.rsvpMarkOneRender();
      const st = w.doc.getElementById('rsvpMarkOneStatus').textContent;
      /* ⚠ AN EMPTY RESULT HAS TWO INNOCENT CAUSES — they answered, or they are
         already marked — and one alarming one. Saying which stops her marking
         somebody twice or hunting a bug that is not there. */
      check('an address that matches nobody explains itself',
        /matches/i.test(st) && /answered|marked/i.test(st),
        'status read: ' + JSON.stringify(st));
      check('and draws no rows',
        w.doc.getElementById('rsvpMarkOneList').innerHTML.indexOf('data-rsvpmarkone') === -1);
    })

    /* The cap keeps ~950 rows of buttons off the page. It must never silently
       hide people — the count says how many matched, not how many are drawn. */
    .then(function () {
      const many = [];
      for (let i = 0; i < 12; i++) many.push(cust('c' + i));
      const w = world(many, { shown: 5 });
      w.rsvpMarkOneRender();
      const drawn = (w.doc.getElementById('rsvpMarkOneList').innerHTML.match(/data-rsvpmarkone=/g) || []).length;
      check('draws at most the cap', drawn === 5, 'drew ' + drawn);
      const st = w.doc.getElementById('rsvpMarkOneStatus').textContent;
      check('and says how many really matched, not how many are drawn',
        st.indexOf('12') !== -1, 'status read: ' + JSON.stringify(st));
    })

    /* Both buttons come off the same row, and the flag is what tells the click
       handler which way to write. Reversed, Undo would re-mark them. */
    .then(function () {
      const w = world(BOOK(), { filter: 'anna' });
      w.rsvpMarkOneRender();
      const html = w.doc.getElementById('rsvpMarkOneList').innerHTML;
      check('an unmarked row offers Mark as asked, set to mark',
        /data-rsvpmarkone="anna" data-rsvpmarkoneon="1"/.test(html) && /Mark as asked/.test(html),
        html.slice(0, 300));
      return w.rsvpMarkOneAsked('anna', true).then(function () {
        const after = w.doc.getElementById('rsvpMarkOneList').innerHTML;
        check('and once marked it offers Undo, set to clear',
          /data-rsvpmarkone="anna" data-rsvpmarkoneon="0"/.test(after) && /Undo/.test(after),
          after.slice(0, 300));
      });
    })

    /* ---------------------------------------------------------------------
       6. THE WIRING, asserted apart from the mechanism — because this repo has
          shipped a working renderer nothing ever called.
       --------------------------------------------------------------------- */
    .then(function () {
      const src = stripComments(admin);

      check('the search box is wired to redraw the list',
        /getElementById\('rsvpMarkOneFilter'\)\?\.addEventListener\('input'/.test(src),
        'a filter nothing listens to is a box that does nothing');
      check('the list is wired with ONE delegated handler',
        /getElementById\('rsvpMarkOneList'\)\?\.addEventListener\('click'/.test(src),
        'per-button listeners are re-bound on every redraw and left on detached nodes');
      /* ⚠ A REAL POINTER LANDS ON WHATEVER IS INSIDE THE BUTTON. Reading
         e.target.dataset would look right in the source and no-op on a click. */
      check('and that handler walks up from whatever was clicked',
        /closest\(['"]\[data-rsvpmarkone\]['"]\)/.test(src));
      /* ⚠ THIS ONE IS RUN, NOT MATCHED, AND THE RED-CHECK IS WHY. The first version
         asked whether the source contained `rsvpMarkOneRender();` — which is still
         perfectly true after the guard around it is changed to `if(false)`, so a
         sabotage that stopped the list ever refreshing sailed straight through. The
         same `if(false)` trap this repo has recorded at least four times. Calling the
         real renderer with a spy is the only version that can see it. */
      check('the breakdown refreshes the list, so Check first brings both up to date',
        (function () {
          const body = lift('rsvpWholeRenderBreakdown');
          if (!liftOk(body)) return false;
          const dom = new JSDOM('<div id="rsvpWholeBreakdown"></div>');
          let called = 0;
          const deps = {
            document: dom.window.document,
            esc: function (s) { return '' + s; },
            rsvpWholeTemplates: function () { return { standard: null, arrears: null }; },
            referralOfferPlacement: function () { return 'none'; },
            rsvpMarkOneRender: function () { called++; }
          };
          const names = Object.keys(deps);
          try {
            new Function(names.join(','), body + '\nreturn rsvpWholeRenderBreakdown;')
              .apply(null, names.map(function (k) { return deps[k]; }))
              ({ ready: true, standard: [], arrears: [], noEmail: [], optedOut: [],
                 alreadyEmailed: [], answered: 0, newThisYear: 0 });
          } catch (e) { return false; }
          return called === 1;
        })(),
        'the list would never appear until something else happened to draw it');
      check('the markup carries all three ids the renderer reads',
        admin.indexOf('id="rsvpMarkOneList"') !== -1
        && admin.indexOf('id="rsvpMarkOneFilter"') !== -1
        && admin.indexOf('id="rsvpMarkOneStatus"') !== -1);

      /* ⚠ ONE RULE DECIDES WHO IS WAITING. A second opinion here is how this list
         and the "Ordinary RSVP" count start disagreeing about the same customers
         — the fault `commRowMatches` exists to prevent for the Inbox tabs. */
      const rows = stripComments(lift('rsvpMarkOneRows'));
      check('the list asks rsvpWholePlan rather than scanning the book itself',
        /rsvpWholePlan\(\)/.test(rows) && !/jobAddresses\s*\|\|\s*\[\]/.test(rows),
        'a second definition of "waiting to be asked" would disagree with the counts above it');

      /* The bulk button must stay all-or-nothing and keep its typed confirm — this
         is an addition beside it, not a replacement, and softening that guard is
         how ~950 records get stamped by accident. */
      const bulk = stripComments(lift('rsvpMarkAllAsked'));
      check('the all-or-nothing button still asks for a typed word',
        /ASKED/.test(bulk) && /prompt\(/.test(bulk),
        'the bulk write stamps the whole planner list and must keep its lock');

      /* Only three things may ever write this field: the send loop, the bulk
         button, and this. A fourth is a rule nobody is watching. */
      const writers = (stripComments(admin).match(/rsvpEmailedAt:\s*(serverTimestamp\(\)|null|asked)/g) || []).length;
      check('the ways to write rsvpEmailedAt are still countable', writers >= 3 && writers <= 6,
        'found ' + writers + ' — if this grew, a new writer needs a reason and a check');
    })

    .then(function () {
      console.log('');
      console.log('rsvp-mark-one — marking ONE customer as already asked');
      console.log('  ' + pass + ' passed, ' + fail + ' failed');
      if (fail) {
        console.log('');
        failures.forEach(function (f) { console.log('  - ' + f); });
        process.exitCode = 1;
      }
      console.log('');
    });
  }
})();
