/*
 * Recording who has already been asked — one, all, or a pasted list
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
 * ⭐ AND A THIRD ROUTE JOINED THEM (2026-09-10, EM-11). Addie pasted her own send
 * log — "Name,Sent,Times sent,Ticked off in app?" — and asked who is not ticked.
 * That retires the "nothing to paste" reasoning above on its PREMISE rather than on
 * its logic: EmailJS still gives her no list, and she is keeping one herself. The
 * paste box REPORTS; the only write it offers is the per-row button, which is
 * `rsvpMarkOneAsked` — so all three routes record "asked" exactly one way. §4 below.
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

    /* ===================================================================
       4. CHECKING A WHOLE PASTED LIST (EM-11).
       ===================================================================
       Addie pasted her own send log — "Name,Sent,Times sent,Ticked off in app?" —
       and asked who is not ticked. The third route into the same job as the two
       above, so it lives in the same gate: one file, one job (R-018).

       ⚠ EVERY CLAIM HERE IS ABOUT WHICH BUCKET A NAME LANDS IN, so all of it is
       RUN. A regex over the comparison would be green while it filed an answered
       customer as still needing a tick — which is the one outcome that costs a
       house its crew. */
    .then(async function () {
      const CHECK_LIFTS = ['dupNormName', 'rsvpWholePlan', 'rsvpCheckListNames',
        'rsvpCheckListIndex', 'rsvpCheckListCompare', 'rsvpCheckListRenderReport',
        'rsvpCheckListRefresh', 'rsvpCheckListRun'];
      CHECK_LIFTS.forEach(function (n) {
        check('lifted ' + n + ' and it parses', liftOk(lift(n)),
          'a truncated lift answers confidently and wrongly while the suite reports green');
      });

      /* ⚠ `dupNormName` IS LIFTED, NEVER STUBBED. The whole reason this report can
         match her list at all is that function's word SORT — a stub would agree with
         itself about "Meier Larna" and prove nothing about what ships (§3). */
      function checkWorld(records, opts) {
        const o = opts || {};
        const dom = new JSDOM(
          '<textarea id="rsvpCheckListPaste"></textarea>' +
          '<div id="rsvpCheckListStatus"></div>' +
          '<div id="rsvpCheckListReport"></div>');
        const api = {
          document: dom.window.document,
          console: { error: function () {}, warn: function () {}, log: function () {} },
          jobAddresses: records,
          esc: function (s) {
            return ('' + s).replace(/[&<>"]/g, function (c) {
              return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
            });
          },
          isTestRecordData: function (d) { return d.isTest === true; },
          audienceNeverAsked: function (d) { return d.neverAsked === true; },
          effectiveRsvpStatus: function (d) { return d.rsvpStatus || ''; },
          etNoAutomationEmails: function (d) { return d.noAuto === true; },
          houseOwesFromLastSeason: function (d) { return d.owes === true; },
          audienceHasLastSeason: function () { return o.invoicesLoaded !== false; }
        };
        const names = Object.keys(api);
        const body =
          'let rsvpCheckListText = "";\n' +
          'let rsvpCheckListLastTick = null;\n' +
          'const RSVP_CHECK_LIST_SHOWN = ' + (o.shown || 200) + ';\n' +
          CHECK_LIFTS.map(lift).join('\n') + '\n' +
          'return { rsvpWholePlan: rsvpWholePlan, rsvpCheckListNames: rsvpCheckListNames,\n' +
          '         rsvpCheckListIndex: rsvpCheckListIndex,\n' +
          '         rsvpCheckListCompare: rsvpCheckListCompare,\n' +
          '         rsvpCheckListRun: rsvpCheckListRun, dupNormName: dupNormName,\n' +
          '         report: function(){ return document.getElementById("rsvpCheckListReport").innerHTML; },\n' +
          '         status: function(){ return document.getElementById("rsvpCheckListStatus").textContent; } };\n';
        return new Function(names.join(','), body)
          .apply(null, names.map(function (k) { return api[k]; }));
      }

      /* ------------------------------------------------------------------
         4a. READING THE PASTE.
         ------------------------------------------------------------------ */
      {
        const w = checkWorld(BOOK());
        const got = w.rsvpCheckListNames(
          'Name,Sent,Times sent,Ticked off in app?\n' +
          'Aaron Marvel,Sep 8,1,\n' +
          '\n' +
          'Aaron Price,Sep 8,1,\n' +
          'Abby McLennan\n' +
          'Adam Casper\tSep 8\t1\n' +
          '   Adam Marshall ,Sep 8,1,\n' +
          'Aaron Marvel,Sep 10 8:54,2,\n');
        const raws = got.names.map(function (n) { return n.raw; });
        check('takes the name from before the comma',
          raws.indexOf('Aaron Marvel') !== -1 && raws.indexOf('Aaron Price') !== -1,
          'got ' + JSON.stringify(raws));
        check('reads a tab-separated paste too', raws.indexOf('Adam Casper') !== -1,
          'a spreadsheet copy arrives tab-separated as often as comma-separated');
        check('a line with no separator is all name', raws.indexOf('Abby McLennan') !== -1);
        check('trims the name', raws.indexOf('Adam Marshall') !== -1, 'got ' + JSON.stringify(raws));
        check('blank lines are skipped', raws.length === 5, 'got ' + raws.length + ': ' + JSON.stringify(raws));
        /* ⚠ COUNTED, NOT SILENTLY EATEN. A paste whose name column was never mapped
           is all headings; reporting nothing at all would read as a clean list. */
        check('the heading row is dropped and counted', got.headers === 1, 'headers=' + got.headers);
        check('a repeated name is counted once and reported', got.repeats === 1,
          'her log carries a second line for anybody re-sent to; repeats=' + got.repeats);
      }

      /* ⭐ THE BORROWED RULE. Her master sheet is "Surname First" and the website is
         "First Surname" — Addie's own ruling is that those two ARE one person and two
         genuinely different names never are. Without the word sort this report would
         call half the book unmatched, which reads as the app having lost them. */
      {
        const w = checkWorld(BOOK());
        const k = function (s) { return w.rsvpCheckListNames(s).names[0].key; };
        check('surname-first and first-surname are one name',
          k('Meier Larna') === k('Larna Meier'),
          'the sorted-word key is what makes her sheet and the app comparable');
        check('an apostrophe does not split a name',
          k("Ka'ipo Rokobuludrau") === k('Kaipo Rokobuludrau'));
        check('two genuinely different names stay different',
          k('Julie Chafffetz') !== k('Julie Chaffetz'),
          'a typo is not a match — that is how the wrong customer gets ticked off');
      }

      /* ------------------------------------------------------------------
         4b. THE PLAN NOW SAYS WHO, NOT ONLY HOW MANY.
         ------------------------------------------------------------------
         ⚠ THE COUNTS AND THE LISTS MUST AGREE. They are written a line apart, so a
         future edit that pushes to one and not the other is exactly the drift this
         pair exists to avoid — and the report would then call an answered customer
         unaccounted for. */
      {
        const w = checkWorld(BOOK());
        const plan = w.rsvpWholePlan();
        check('the plan records WHO has answered, not only how many',
          Array.isArray(plan.answeredList) && plan.answeredList.length === plan.answered
            && plan.answeredList.length === 1 && plan.answeredList[0].id === 'dan',
          'answered=' + plan.answered + ' list=' + JSON.stringify((plan.answeredList || []).map(function (i) { return i.id; })));
        check('the plan records WHO is new this year',
          Array.isArray(plan.newThisYearList) && plan.newThisYearList.length === plan.newThisYear
            && plan.newThisYearList.length === 1 && plan.newThisYearList[0].id === 'hank',
          'newThisYear=' + plan.newThisYear);
      }

      /* ------------------------------------------------------------------
         4c. WHICH BUCKET EACH PASTED NAME LANDS IN. The answer she asked for.
         ------------------------------------------------------------------ */
      {
        const w = checkWorld(BOOK());
        w.rsvpCheckListRun(
          'anna,Sep 8,1,\n' +      // waiting, ordinary
          'brian,Sep 8,1,\n' +     // waiting, arrears
          'gina,Sep 8,1,\n' +      // already recorded as asked
          'dan,Sep 8,1,\n' +       // already answered
          'erin,Sep 8,1,\n' +      // do-not-send
          'fred,Sep 8,1,\n' +      // no email on file
          'hank,Sep 8,1,\n' +      // new this year
          'iris,Sep 8,1,\n' +      // a test record
          'Nobody Here,Sep 8,1,\n');
        const plan = w.rsvpWholePlan();
        const res = w.rsvpCheckListCompare(
          w.rsvpCheckListNames(
            'anna,x\nbrian,x\ngina,x\ndan,x\nerin,x\nfred,x\nhank,x\niris,x\nNobody Here,x\n'),
          plan, w.rsvpCheckListIndex());
        const ids = function (b) { return res[b].map(function (x) { return x.raw; }).sort(); };
        check('the not-ticked bucket is exactly who the send would still go to',
          JSON.stringify(ids('waiting')) === JSON.stringify(['anna', 'brian']),
          'got ' + JSON.stringify(ids('waiting')));
        check('somebody already recorded as asked reads as ticked',
          JSON.stringify(ids('ticked')) === JSON.stringify(['gina']), 'got ' + JSON.stringify(ids('ticked')));
        /* ⚠ THE ONE THAT MATTERS MOST. Somebody who has REPLIED needs no tick, and
           filing them as waiting would put a customer who already answered at the top
           of the list of people to go and stamp. */
        check('somebody who already answered is not listed as needing a tick',
          JSON.stringify(ids('answered')) === JSON.stringify(['dan'])
            && ids('waiting').indexOf('dan') === -1, 'got ' + JSON.stringify(ids('answered')));
        check('the do-not-send list is reported separately, not as waiting',
          JSON.stringify(ids('optedOut')) === JSON.stringify(['erin']));
        check('no email on file is reported separately',
          JSON.stringify(ids('noEmail')) === JSON.stringify(['fred']));
        check('never had lights is reported separately',
          JSON.stringify(ids('newThisYear')) === JSON.stringify(['hank']));
        /* A test row is not in the plan and not in the index, so it must come back as
           unmatched rather than as a customer needing a tick. */
        check('a test record comes back unmatched rather than waiting',
          ids('unknown').indexOf('iris') !== -1 && ids('waiting').indexOf('iris') === -1);
        check('a name that is not a customer is named, not dropped',
          ids('unknown').indexOf('Nobody Here') !== -1);
        check('nothing is left out of the totals',
          ['ticked', 'answered', 'waiting', 'noEmail', 'optedOut', 'newThisYear',
           'elsewhere', 'ambiguous', 'unknown'].reduce(function (n, b) { return n + res[b].length; }, 0)
          === res.total,
          'a name in no bucket is a row she cannot check');
        check('nothing is counted twice',
          res.ticked.length + res.answered.length + res.waiting.length === 4,
          'gina, dan, anna, brian — one bucket each');
      }

      /* ⚠ TWO CUSTOMERS ON ONE NAME RESOLVE TO NOBODY. Six names in the real book
         belong to two rows. Ticking the wrong one is worse than ticking neither,
         because the one named is then believed and the other is never chased. */
      {
        const book = BOOK();
        book.push({ id: 'anna2', data: { name: 'anna', email: 'anna2@x.com' } });
        const w = checkWorld(book);
        const res = w.rsvpCheckListCompare(w.rsvpCheckListNames('anna,x\n'),
          w.rsvpWholePlan(), w.rsvpCheckListIndex());
        check('a name held by two customers is named and resolved to neither',
          res.ambiguous.length === 1 && res.ambiguous[0].count === 2
            && res.waiting.length === 0 && res.ticked.length === 0,
          'ambiguous=' + res.ambiguous.length + ' waiting=' + res.waiting.length);
      }

      /* ------------------------------------------------------------------
         4d. WHAT REACHES THE SCREEN.
         ------------------------------------------------------------------ */
      {
        const w = checkWorld(BOOK());
        w.rsvpCheckListRun('anna,Sep 8,1,\ngina,Sep 8,1,\ndan,Sep 8,1,\n');
        const html = w.report();
        check('the not-ticked person is named on screen', html.indexOf('anna') !== -1,
          'the whole point of the paste is getting these names back');
        /* ⚠ COUNTED AND NOT LISTED, on purpose. On her real log that is ~900 rows
           carrying no action, and burying the handful that need one underneath them is
           the cries-wolf failure this repo records in four other places. */
        check('the already-ticked are counted but not listed', html.indexOf('gina') === -1,
          'listing 900 rows with nothing to do buries the few that matter');
        check('the already-answered are counted but not listed', html.indexOf('dan') === -1);
        check('the not-ticked row carries a button wired to that customer',
          html.indexOf('data-rsvpmarkone="anna"') !== -1 && html.indexOf('data-rsvpmarkoneon="1"') !== -1,
          'a report with no way to act on it sends her back to searching one at a time');
        check('no button is offered for anybody already ticked',
          html.indexOf('data-rsvpmarkone="gina"') === -1);
        check('the count of not-ticked is said in words', /NOT ticked off/.test(w.status()),
          'got ' + JSON.stringify(w.status()));
        check('the not-ticked names are offered back as pasteable text',
          /<textarea readonly/.test(html),
          'her question was a spreadsheet column; the answer has to go back into one');
      }

      /* ⚠ NOT READY IS NOT AN EMPTY REPORT. Before the invoices load the plan refuses,
         and drawing "0 not ticked" then is a confident wrong answer about who has been
         asked — the same trap the mark-one list is guarded against above. */
      {
        const w = checkWorld(BOOK(), { invoicesLoaded: false });
        w.rsvpCheckListRun('anna,Sep 8,1,\n');
        check('says why rather than reporting nothing before invoices load',
          w.report() === '' && /invoice/i.test(w.status()),
          'status=' + JSON.stringify(w.status()));
      }

      /* Hostile text in a pasted cell reaches innerHTML. */
      {
        const book = BOOK();
        book.push({ id: 'x1', data: { name: '<img src=x onerror=alert(1)>', email: 'x1@x.com' } });
        const w = checkWorld(book);
        w.rsvpCheckListRun('<img src=x onerror=alert(1)>,Sep 8,1,\n');
        check('a pasted name is escaped before it is drawn',
          w.report().indexOf('<img') === -1 && w.report().indexOf('&lt;img') !== -1);
      }

      /* ------------------------------------------------------------------
         4e. THE RULES THAT KEEP IT SAFE.
         ------------------------------------------------------------------ */
      {
        /* ⚠ IT ASKS THE PLAN. Re-running the predicates here is how this report and
           the breakdown above it would start disagreeing about one customer. */
        const cmp = stripComments(lift('rsvpCheckListCompare'));
        check('the comparison asks the plan rather than re-deciding anything',
          /plan\.alreadyEmailed/.test(cmp) && /plan\.answeredList/.test(cmp)
            && !/effectiveRsvpStatus/.test(cmp) && !/audienceNeverAsked/.test(cmp)
            && !/rsvpEmailedAt/.test(cmp),
          'a second reading of "has this person been asked" is the drift this avoids');

        /* ⚠ NO BULK WRITE, AND THIS IS THE CHECK THAT HOLDS IT. A press that stamped
           every pasted name would be `rsvpMarkAllAsked`'s all-or-nothing mistake
           wearing a list, with no typed word in front of it. */
        const block = (function () {
          const at = admin.indexOf('const RSVP_CHECK_LIST_SHOWN');
          const end = admin.indexOf("document.getElementById('rsvpCheckListReport')?.addEventListener");
          return (at === -1 || end === -1) ? '' : stripComments(admin.slice(at, end));
        })();
        check('the check-a-list block was found', block.length > 500, 'length=' + block.length);
        check('nothing in the check-a-list block writes to Firestore',
          !/updateDoc\(|setDoc\(|addDoc\(|deleteDoc\(/.test(block),
          'it reports; the only write is the per-row button, which is the one above');
        check('the per-row button goes through the single existing write',
          /rsvpMarkOneAsked\(/.test(stripComments(admin.slice(
            admin.indexOf("document.getElementById('rsvpCheckListReport')?.addEventListener"),
            admin.indexOf("document.getElementById('rsvpCheckListReport')?.addEventListener") + 900))),
          'a second way to record "asked" is how the two start disagreeing');

        check('the markup carries every id the report reads',
          admin.indexOf('id="rsvpCheckListPaste"') !== -1
          && admin.indexOf('id="rsvpCheckListReport"') !== -1
          && admin.indexOf('id="rsvpCheckListStatus"') !== -1
          && admin.indexOf('id="rsvpCheckListBtn"') !== -1);

        /* ⚠ RUN WITH A SPY, NOT MATCHED — the lesson the sibling check above had to
           learn: `if(false)` leaves the call in the source and green in a regex, while
           the report never appears until something else happens to draw it. */
        check('Check first refreshes the pasted report as well',
          (function () {
            const body = lift('rsvpWholeRenderBreakdown');
            if (!liftOk(body)) return false;
            const dom = new JSDOM('<div id="rsvpWholeBreakdown"></div>');
            let called = 0, gotPlan = null;
            const deps = {
              document: dom.window.document,
              esc: function (s) { return '' + s; },
              rsvpWholeTemplates: function () { return { standard: null, arrears: null }; },
              referralOfferPlacement: function () { return 'none'; },
              rsvpMarkOneRender: function () {},
              rsvpCheckListRefresh: function (p) { called++; gotPlan = p; }
            };
            const names = Object.keys(deps);
            const plan = { ready: true, standard: [], arrears: [], noEmail: [], optedOut: [],
                           alreadyEmailed: [], answered: 0, newThisYear: 0 };
            try {
              new Function(names.join(','), body + '\nreturn rsvpWholeRenderBreakdown;')
                .apply(null, names.map(function (k) { return deps[k]; }))(plan);
            } catch (e) { return false; }
            /* Handed the SAME plan object, so the two sets of counts on one screen
               cannot be two readings taken a moment apart. */
            return called === 1 && gotPlan === plan;
          })(),
          'the report would go stale the moment anything else was marked');
      }

      /* ------------------------------------------------------------------
         4f. TICKING THE WHOLE LIST OFF AT ONCE (EM-12).
         ------------------------------------------------------------------
         Addie, reading the per-row buttons: "will this tick all the people that are
         not ticked?" It did not, and a report needing three hundred presses is one
         she stops using. This is a MASS WRITE on the field that decides who is asked
         again, so every claim below is RUN against a fake Firestore: the scope, the
         lock, and what actually reached the batch. */
      {
        /* ⚠ LIFTED BY LINE, NOT BY BRACE. `ssnChunk` is a one-liner, so the slicer
           every other lift here uses would run past it to the END of the next
           function and swallow code that has nothing to do with it. Taken out of the
           real file either way — a hand-written chunker in the harness could drop a
           target and the suite would never know. */
        const ssnChunkSrc = (admin.match(/function ssnChunk\([^\n]*/) || [''])[0];
        check('lifted ssnChunk by line and it parses', liftOk(ssnChunkSrc),
          'a stubbed chunker that drops a batch would pass silently');

        const BULK_LIFTS = ['dupNormName', 'rsvpWholePlan', 'rsvpCheckListNames',
          'rsvpCheckListIndex', 'rsvpCheckListCompare', 'rsvpCheckListRenderReport',
          'rsvpCheckListRefresh', 'rsvpCheckListRun', 'rsvpCheckListBulkTargets',
          'rsvpCheckListMarkAll', 'rsvpCheckListUndoTick'];
        BULK_LIFTS.forEach(function (n) {
          check('lifted ' + n + ' and it parses', liftOk(lift(n)));
        });

        function bulkWorld(records, opts) {
          const o = opts || {};
          const dom = new JSDOM(
            '<textarea id="rsvpCheckListPaste"></textarea>' +
            '<div id="rsvpCheckListStatus"></div>' +
            '<div id="rsvpCheckListReport"></div>');
          const writes = [], asked = [];
          /* Mutable, so a test can make a plan go unready AFTER a report is drawn —
             the only shape that can see a quiet redraw blanking one. */
          const state = { invoicesLoaded: o.invoicesLoaded !== false,
                          writeFails: !!o.writeFails };
          const api = {
            document: dom.window.document,
            console: { error: function () {}, warn: function () {}, log: function () {} },
            jobAddresses: records,
            esc: function (s) {
              return ('' + s).replace(/[&<>"]/g, function (c) {
                return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
              });
            },
            isTestRecordData: function (d) { return d.isTest === true; },
            audienceNeverAsked: function (d) { return d.neverAsked === true; },
            effectiveRsvpStatus: function (d) { return d.rsvpStatus || ''; },
            etNoAutomationEmails: function (d) { return d.noAuto === true; },
            houseOwesFromLastSeason: function (d) { return d.owes === true; },
            audienceHasLastSeason: function () { return state.invoicesLoaded; },
            /* The two gates, driven from the fixture so a test can refuse either. */
            confirm: function (msg) { asked.push(msg); return o.confirmYes !== false; },
            prompt: function () { return o.typed === undefined ? 'ASKED' : o.typed; },
            doc: function (_db, coll, id) { return { coll: coll, id: id }; },
            db: {},
            serverTimestamp: function () { return 'SERVER_TS'; },
            writeBatch: function () {
              const ops = [];
              return {
                update: function (ref, payload) { ops.push({ id: ref.id, payload: payload }); },
                commit: async function () {
                  if (state.writeFails) throw new Error('permission denied');
                  ops.forEach(function (op) { writes.push(op); });
                  return true;
                }
              };
            }
          };
          const names = Object.keys(api);
          const body =
            'let rsvpCheckListText = "";\n' +
            'let rsvpCheckListLastTick = null;\n' +
            'const RSVP_CHECK_LIST_SHOWN = ' + (o.shown || 200) + ';\n' +
            ssnChunkSrc + '\n' +
            BULK_LIFTS.map(lift).join('\n') + '\n' +
            'return { rsvpCheckListRun: rsvpCheckListRun,\n' +
            '         rsvpCheckListMarkAll: rsvpCheckListMarkAll,\n' +
            '         rsvpCheckListUndoTick: rsvpCheckListUndoTick,\n' +
            '         lastTick: function(){ return rsvpCheckListLastTick; },\n' +
            '         rsvpCheckListBulkTargets: rsvpCheckListBulkTargets,\n' +
            '         rsvpCheckListCompare: rsvpCheckListCompare,\n' +
            '         rsvpCheckListNames: rsvpCheckListNames,\n' +
            '         rsvpCheckListIndex: rsvpCheckListIndex,\n' +
            '         rsvpWholePlan: rsvpWholePlan,\n' +
            '         rsvpCheckListRefresh: rsvpCheckListRefresh,\n' +
            '         report: function(){ return document.getElementById("rsvpCheckListReport").innerHTML; },\n' +
            '         status: function(){ return document.getElementById("rsvpCheckListStatus").textContent; } };\n';
          const made = new Function(names.join(','), body)
            .apply(null, names.map(function (k) { return api[k]; }));
          made.writes = writes;
          made.asked = asked;
          made.state = state;
          made.records = records;
          return made;
        }

        /* Everything in the book, pasted in one go. */
        const ALL = 'anna,x\nbrian,x\ngina,x\ndan,x\nerin,x\nfred,x\nhank,x\niris,x\nNobody Here,x\n';

        /* ⚠ THE SCOPE IS THE WHOLE SAFETY ARGUMENT. Each excluded bucket is a different
           way to write down something untrue about a real person: that we emailed
           somebody we hold no address for, that we wrote to somebody we are forbidden
           to write to, that we sent an RSVP we deliberately never send, or that we did
           any of it to whichever of two same-named customers came back first. */
        {
          const w = bulkWorld(BOOK());
          const res = w.rsvpCheckListCompare(w.rsvpCheckListNames(ALL), w.rsvpWholePlan(), w.rsvpCheckListIndex());
          const ids = w.rsvpCheckListBulkTargets(res).map(function (i) { return i.id; }).sort();
          check('ticking all reaches exactly the not-ticked customers',
            JSON.stringify(ids) === JSON.stringify(['anna', 'brian']), 'got ' + JSON.stringify(ids));
          check('it never reaches somebody with no email on file', ids.indexOf('fred') === -1);
          check('it never reaches the do-not-send list', ids.indexOf('erin') === -1);
          check('it never reaches somebody who has never had lights', ids.indexOf('hank') === -1);
          check('it never re-stamps somebody already ticked', ids.indexOf('gina') === -1);
          check('it never overwrites somebody who has answered', ids.indexOf('dan') === -1);
          check('it never reaches a test record', ids.indexOf('iris') === -1);
          check('it returns customers, not the pasted text',
            w.rsvpCheckListBulkTargets(res).every(function (i) { return i && i.id && i.data; }));
        }

        /* ⚠ A NAME HELD BY TWO CUSTOMERS IS NOT TICKED BY THE BULK EITHER. The per-row
           path cannot reach one because it is offered no button; this path could, by
           picking a hit, which is exactly the guess the whole feature refuses. */
        {
          const book = BOOK();
          book.push({ id: 'anna2', data: { name: 'anna', email: 'anna2@x.com' } });
          const w = bulkWorld(book);
          const res = w.rsvpCheckListCompare(w.rsvpCheckListNames('anna,x\nbrian,x\n'), w.rsvpWholePlan(), w.rsvpCheckListIndex());
          const ids = w.rsvpCheckListBulkTargets(res).map(function (i) { return i.id; });
          check('an ambiguous name is not ticked by the bulk button either',
            ids.indexOf('anna') === -1 && ids.indexOf('anna2') === -1 && ids.indexOf('brian') !== -1,
            'got ' + JSON.stringify(ids));
        }

        /* ------------------------------------------------------------------
           What actually reaches Firestore.
           ------------------------------------------------------------------ */
        await (async function () {
          const w = bulkWorld(BOOK());
          w.rsvpCheckListRun(ALL);
          await w.rsvpCheckListMarkAll();
          const ids = w.writes.map(function (x) { return x.id; }).sort();
          check('the write reaches only the not-ticked customers',
            JSON.stringify(ids) === JSON.stringify(['anna', 'brian']), 'wrote ' + JSON.stringify(ids));
          check('it writes the same field the one-at-a-time button writes',
            w.writes.length > 0 && w.writes.every(function (x) {
              return Object.keys(x.payload).length === 1 && x.payload.rsvpEmailedAt === 'SERVER_TS';
            }), 'a second spelling of "asked" is how the two stop counting the same people');
          /* ⚠ THE MIRROR IS WHAT THE SCREEN READS. Without it the rows stay on the
             not-ticked list after a successful write and she presses it again. */
          check('the local record is mirrored once the write lands',
            w.records.filter(function (r) { return r.id === 'anna'; })[0].data.rsvpEmailedAt instanceof Date);
          check('and the report redraws with them gone',
            !/data-rsvpmarkone="anna"/.test(w.report()), 'the row must not survive its own tick');
          check('it says how many it ticked', /Ticked off 2 of 2/.test(w.status()), 'got ' + JSON.stringify(w.status()));
        })();

        /* ⚠ BOTH LOCKS ARE REAL, and each is checked on its own — a mass write on the
           field that decides who is asked again earns the same guard `rsvpMarkAllAsked`
           has. Answering the confirm is not consent; the word has to be typed. */
        await (async function () {
          const w = bulkWorld(BOOK(), { confirmYes: false });
          w.rsvpCheckListRun(ALL);
          await w.rsvpCheckListMarkAll();
          check('saying no to the confirm writes nothing', w.writes.length === 0);
        })();
        await (async function () {
          const w = bulkWorld(BOOK(), { typed: 'yes' });
          w.rsvpCheckListRun(ALL);
          await w.rsvpCheckListMarkAll();
          check('the wrong word writes nothing', w.writes.length === 0, 'wrote ' + w.writes.length);
          check('and says so rather than going quiet', /Cancelled/.test(w.status()));
        })();
        await (async function () {
          const w = bulkWorld(BOOK());
          w.rsvpCheckListRun(ALL);
          await w.rsvpCheckListMarkAll();
          /* The confirm has to NAME the count and what it is leaving alone, because the
             list she is looking at holds both and the button acts on one of them. */
          check('the confirm names how many it will tick', /all 2 of these/.test(w.asked[0] || ''),
            'got ' + JSON.stringify((w.asked[0] || '').slice(0, 120)));
          check('the confirm names what it is leaving alone', /left alone/.test(w.asked[0] || ''));
          check('the confirm still carries the cost of a wrong tick',
            /never asked again this season/.test(w.asked[0] || ''));
        })();

        /* ⚠ A FAILED BATCH LEAVES THEM WAITING — the safe direction — but she has to be
           TOLD, or the list looks ticked and nobody presses it again. */
        await (async function () {
          const w = bulkWorld(BOOK(), { writeFails: true });
          w.rsvpCheckListRun(ALL);
          await w.rsvpCheckListMarkAll();
          check('a refused write records nothing', w.writes.length === 0);
          check('and the local record is NOT mirrored',
            !w.records.filter(function (r) { return r.id === 'anna'; })[0].data.rsvpEmailedAt,
            'mirroring before the commit shows her a tick that was never written');
          check('and it says what failed', /could not be saved/.test(w.status()), 'got ' + JSON.stringify(w.status()));
          check('and they are still on the not-ticked list', /data-rsvpmarkone="anna"/.test(w.report()));
        })();

        /* Nothing to do is a sentence, not a silent no-op. */
        await (async function () {
          const w = bulkWorld(BOOK());
          w.rsvpCheckListRun('gina,x\ndan,x\n');
          await w.rsvpCheckListMarkAll();
          check('a list with nobody waiting writes nothing and says so',
            w.writes.length === 0 && /nothing to record/.test(w.status()));
          check('and no Tick-all button is offered', !/data-rsvpchecklistmarkall="/.test(w.report()),
            'a button that can only refuse is worse than no button');
        })();

        /* ------------------------------------------------------------------
           The button, and the list it promises to act on.
           ------------------------------------------------------------------ */
        {
          const w = bulkWorld(BOOK());
          w.rsvpCheckListRun(ALL);
          const html = w.report();
          check('a Tick-all button is offered when somebody is waiting',
            /data-rsvpchecklistmarkall="/.test(html) && /Tick all 2 off as asked/.test(html),
            'the count on the button is what she is agreeing to');
          check('the button says the word it will ask for', /type ASKED/.test(html));
        }

        /* ⭐ THE COUNT ON THE BUTTON MUST EQUAL THE ROWS ON SCREEN. Capping the waiting
           list would make Tick-all act on names she never saw — the sheet ledger's own
           bug, where everything past the 400 drawn rode on the default. The
           informational buckets stay capped, because nothing presses a button on those. */
        {
          const book = BOOK();
          for (let i = 0; i < 6; i++) book.push(cust('w' + i));
          const w = bulkWorld(book, { shown: 2 });
          w.rsvpCheckListRun('anna,x\nbrian,x\ncara,x\nw0,x\nw1,x\nw2,x\nw3,x\nw4,x\nw5,x\n');
          const html = w.report();
          const drawn = (html.match(/data-rsvpmarkone="/g) || []).length;
          check('every waiting row is drawn, however many there are', drawn === 9,
            'drew ' + drawn + ' of 9 — Tick-all would act on names she never saw');
          check('and the button count matches what is drawn', /Tick all 9 off as asked/.test(html));
        }
        {
          /* The cap really is still applied where it should be: six unmatched names,
             two drawn. Its own fixture, because the waiting list above has none. */
          const w = bulkWorld(BOOK(), { shown: 2 });
          w.rsvpCheckListRun('No One A,x\nNo One B,x\nNo One C,x\n');
          check('an informational bucket is capped and says so',
            /Showing the first 2\./.test(w.report()),
            'the cap is what keeps a 900-row paste readable');
        }

        /* ------------------------------------------------------------------
           4g. THE REPORT CORRECTS ITSELF (EM-13).
           ------------------------------------------------------------------
           Addie ticked 495 off, the result line said "Ticked off 495 of 495", and the
           list underneath still read 495 NOT ticked — so it read as a failed write. It
           was not: pressing Check this list again showed 495 recorded, 170 already
           answered, 0 not ticked. `jobAddresses` is rebuilt wholesale by its own
           listener, so the tick's optimistic mirror is discarded, and the only thing
           that redraws this report was wired to BUTTONS rather than to customer data. */
        {
          /* A snapshot landing the way the real listener does: the array is REPLACED
             with fresh objects, which is exactly what throws the mirror away. */
          const snapshotBrings = function (w, ids) {
            w.records.forEach(function (r) {
              if (ids.indexOf(r.id) !== -1) r.data = Object.assign({}, r.data, { rsvpEmailedAt: 'a-date' });
            });
          };

          const w = bulkWorld(BOOK());
          w.rsvpCheckListRun('anna,x\nbrian,x\n');
          check('the report starts by naming them as not ticked',
            /data-rsvpmarkone="anna"/.test(w.report()) && /Tick all 2 off as asked/.test(w.report()));
          const said = w.status();
          /* The write lands elsewhere and the truth arrives on the next snapshot. */
          snapshotBrings(w, ['anna', 'brian']);
          w.rsvpCheckListRefresh(null, { quiet: true });
          check('a quiet redraw corrects the list once the data catches up',
            !/data-rsvpmarkone="anna"/.test(w.report()) && !/Tick all/.test(w.report()),
            'this is the exact screen that read 495 NOT ticked straight after ticking 495');
          /* ⚠ AND IT MUST NOT WIPE WHAT THE LAST PRESS SAID. This function writes its own
             count into that same line — an automatic redraw doing so is the bug fixed one
             commit earlier, arriving from a new direction. */
          check('and leaves the result line exactly as the press left it',
            w.status() === said, 'was ' + JSON.stringify(said) + ' now ' + JSON.stringify(w.status()));
        }

        /* A press still reports, or nobody is ever told anything. */
        {
          const w = bulkWorld(BOOK());
          w.rsvpCheckListRun('anna,x\nbrian,x\n');
          w.rsvpCheckListRefresh();
          check('a refresh a PERSON asked for still writes the count',
            /NOT ticked off/.test(w.status()), 'got ' + JSON.stringify(w.status()));
        }

        /* ⚠ A QUIET REDRAW NEVER BLANKS A REPORT SHE IS READING. Firing on every customer
           change, it would otherwise clear the box on any transient — and an empty report
           is indistinguishable from one that found nothing. */
        {
          /* ⚠ THE REPORT HAS TO BE DRAWN FIRST, and the red-check is why this is written
             this way round: built unready from the start, the box is already empty, so a
             sabotage that blanks it changes nothing and the check passes on broken code.
             Draw it, THEN take the invoices away. */
          const w = bulkWorld(BOOK());
          w.rsvpCheckListRun('anna,x\n');
          const before = w.report();
          check('the report really was drawn before the plan went unready',
            before.indexOf('data-rsvpmarkone="anna"') !== -1,
            'without this the next check cannot fail');
          w.state.invoicesLoaded = false;
          w.rsvpCheckListRefresh(null, { quiet: true });
          check('a quiet redraw on an unready plan changes nothing',
            w.report() === before, 'it must not clear a report on a transient');
        }
        {
          const w = bulkWorld(BOOK());
          w.rsvpCheckListRun('');
          const before = w.report();
          w.rsvpCheckListRefresh(null, { quiet: true });
          check('a quiet redraw with nothing pasted is a no-op', w.report() === before);
        }

        /* ⚠ THE WIRING IS ASSERTED SEPARATELY FROM THE BEHAVIOUR, because the harness
           calls the refresh itself — without these two lines it would never run in the
           real page and every check above would still pass. That is the failure this
           repo has shipped before. */
        {
          const sweep = stripComments(lift('renderJobAddressPanels'));
          check('the customer-change sweep redraws the pasted report',
            /safeRender\('rsvpCheckList'/.test(sweep),
            'without this the report goes stale the moment anything else writes a customer');
          check('and it asks for it quietly',
            /rsvpCheckListRefresh\(null, *\{ *quiet: *true *\}\)/.test(sweep),
            'a loud automatic redraw wipes the line saying what the last press did');
          check('and it only draws while Automation Emails is open',
            /rsvpCheckList: 'automation'/.test(stripComments(admin)),
            'an unmapped label redraws on every customer change on every panel');
        }

        /* ------------------------------------------------------------------
           4h. TAKING A TICK-ALL BACK (EM-14).
           ------------------------------------------------------------------
           `rsvpMarkOneRecent` — the Undo behind the one-at-a-time button — is only ever
           added to by that button, so a Tick-all of 495 had NO undo anywhere: those
           customers left every waiting list at once and the way back was editing records
           one by one, having first worked out which ones. The single tick's whole safety
           argument is that a visible Undo beats a confirm nobody reads; the bulk had the
           confirm and not the Undo, on a press five hundred times the size. */
        {
          await (async function () {
            const w = bulkWorld(BOOK());
            w.rsvpCheckListRun('anna,x\nbrian,x\n');
            await w.rsvpCheckListMarkAll();
            const held = w.lastTick();
            check('the tick remembers exactly what it wrote',
              !!held && JSON.stringify(held.ids.slice().sort()) === JSON.stringify(['anna', 'brian']),
              'got ' + JSON.stringify(held && held.ids));
            check('and offers to put them back, saying how many',
              /data-rsvpchecklistundo="/.test(w.report()) && /put those 2 back/.test(w.report()));
            check('and says it only lasts the session',
              /until you reload/.test(w.report()),
              'a button that quietly stops working is worse than one that says when it will');

            w.writes.length = 0;
            await w.rsvpCheckListUndoTick();
            const ids = w.writes.map(function (x) { return x.id; }).sort();
            check('undoing writes to exactly the customers it ticked',
              JSON.stringify(ids) === JSON.stringify(['anna', 'brian']), 'wrote ' + JSON.stringify(ids));
            /* ⚠ `null`, NOT a deleted field — the spelling Start New Season and the single
               Undo both use. Two spellings of "not asked" is how one of them stops counting,
               and rsvpWholePlan would never report it; it would just keep skipping them. */
            check('and writes null, the same spelling everything else uses',
              w.writes.every(function (x) {
                return Object.keys(x.payload).length === 1 && x.payload.rsvpEmailedAt === null;
              }));
            check('they are back on the list to be asked',
              /data-rsvpmarkone="anna"/.test(w.report()) && /Tick all 2 off as asked/.test(w.report()));
            check('the undo button goes once there is nothing left to undo',
              !/data-rsvpchecklistundo="/.test(w.report()) && w.lastTick() === null);
            check('and it says how many came back', /Put 2 back/.test(w.status()),
              'got ' + JSON.stringify(w.status()));
          })();

          /* ⚠ NO TYPED WORD ON THE WAY BACK, and the asymmetry is the point rather than an
             oversight: ticking wrongly means somebody is never asked again this season and
             no crew is sent to their house; un-ticking wrongly costs one duplicate email.
             The lock belongs on the dangerous direction only. */
          await (async function () {
            const w = bulkWorld(BOOK(), { typed: 'nonsense', confirmYes: false });
            w.rsvpCheckListRun('anna,x\nbrian,x\n');
            /* Tick it with the gates open, then close them and undo. */
            const w2 = bulkWorld(BOOK());
            w2.rsvpCheckListRun('anna,x\nbrian,x\n');
            await w2.rsvpCheckListMarkAll();
            const askedBefore = w2.asked.length;
            w2.writes.length = 0;
            await w2.rsvpCheckListUndoTick();
            check('undoing asks for no confirm and no typed word',
              w2.asked.length === askedBefore && w2.writes.length === 2,
              'the lock is on the direction that loses a house, not the one that costs an email');
          })();

          /* ⚠ ONLY WHAT THE SERVER TOOK. A refused batch left those customers unticked, so
             offering to un-tick them would write null over a stamp somebody else's send put
             there. */
          await (async function () {
            const w = bulkWorld(BOOK(), { writeFails: true });
            w.rsvpCheckListRun('anna,x\nbrian,x\n');
            await w.rsvpCheckListMarkAll();
            check('a refused tick leaves nothing to undo', w.lastTick() === null);
            check('and offers no undo button', !/data-rsvpchecklistundo="/.test(w.report()));
          })();

          await (async function () {
            const w = bulkWorld(BOOK());
            w.rsvpCheckListRun('anna,x\n');
            await w.rsvpCheckListUndoTick();
            check('undoing when nothing was ticked writes nothing and says so',
              w.writes.length === 0 && /nothing to undo/.test(w.status()));
          })();

          /* ⚠ A HALF-UNDONE STATE IS THE ONE WORTH RETRYING, so a refused undo keeps what
             it was undoing. Cleared regardless, a second press would silently skip the
             remainder and she would be told nothing was left to put back. */
          await (async function () {
            const w = bulkWorld(BOOK());
            w.rsvpCheckListRun('anna,x\nbrian,x\n');
            await w.rsvpCheckListMarkAll();
            w.state.writeFails = true;
            await w.rsvpCheckListUndoTick();
            check('a refused undo can still be retried',
              !!w.lastTick() && w.lastTick().ids.length === 2,
              'clearing it here loses the only record of what to put back');
            check('and says it could not be undone', /could not be undone/.test(w.status()),
              'got ' + JSON.stringify(w.status()));
          })();
        }

        /* ------------------------------------------------------------------
           4i. AN AMBIGUOUS NAME IS NAMED, WITH ENOUGH TO ACT ON.
           ------------------------------------------------------------------
           Five of these on her real book. The report said "matches 2 customers — not
           resolved" and handed her nothing: same name on both, so the search box above
           could not tell them apart either. Carrying the candidates is not resolving
           them — it is showing her which two people they are so she can decide. */
        {
          const book = BOOK();
          book.push({ id: 'anna2', data: { name: 'anna', email: 'other@x.com', address: '9 Oak Ave' } });
          book[0].data.address = '1 Elm St';
          const w = bulkWorld(book);
          w.rsvpCheckListRun('anna,x\n');
          const html = w.report();
          check('both candidates are named', /1 Elm St/.test(html) && /9 Oak Ave/.test(html),
            'the address is what tells two people of one name apart');
          check('with the address that separates them, and their emails',
            /other@x\.com/.test(html) && /anna@x\.com/.test(html));
          check('and it still resolves to neither of them',
            !/data-rsvpmarkone="anna"/.test(html) && !/data-rsvpmarkone="anna2"/.test(html),
            'naming the wrong one is worse than naming none — showing both is not picking one');
          check('and no Tick-all is offered for them',
            !/data-rsvpchecklistmarkall="/.test(html),
            'nobody is waiting, so a button that can only refuse is worse than none');
        }
      }
    })

    .then(function () {
      console.log('');
      console.log('rsvp-mark-one — recording who has already been asked');
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
