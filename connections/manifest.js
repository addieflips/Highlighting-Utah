/* ⭐ WHAT THIS DOES NOT WATCH — and it is listed FIRST because it is the thing most
 * likely to be misread.
 *
 * Addie asked whether the map lets her "make sure everything is connected and working
 * correctly". A green page means the DECLARED things are connected. It does not mean the
 * app is fine, and a page that says "watches 8 things" without saying 8 out of WHAT
 * invites exactly that reading. A map that looks complete and is not is worse than no
 * map — so the page prints this list beside the green.
 *
 * ⚠ IT IS HAND-WRITTEN, LIKE THE SPINES, because only a person knows what matters. And
 * `connections.test.js` fails if anything on it has since been given a spine, so the two
 * cannot drift: the moment something here is really watched, this row has to go.
 */
const NOT_WATCHED = [
  ['scheduledRoutes', 'which houses a crew is sent to on a given day'],
  ['lightColors / lightsDescription', 'what colours a house gets'],
  ['difficulty', 'the easy / medium / hard grade'],
  ['quotePhotos → housePhotos', 'the pictures that reach a crew sheet'],
  ['gateCode', 'how a crew gets in'],
  ['outletTimer', 'whether a house asked for a timer'],
  ['maybeNextYear / isOutForSeason', 'who is in the season at all'],
  ['lightsLockedUntil', 'the 48-hour route lock and free-change window'],
  /* ⭐ THE FIVE DATES ADDED 2026-08-28, AND WHY THEY ARE HERE RATHER THAN ON THE GRID.
   * Addie asked whether this page had picked them up. It had not, and writing the spines
   * is how the real reason surfaced: R-010 refuses a spine with a writer and no reader,
   * and every one of these five is written and read by NOTHING. That is not an oversight
   * in the wiring — it is the customer history she asked for ("dating when everything is
   * done for each costumer through the system we have set") not being built yet. The
   * dates are the raw material; the view that reads them is the missing half.
   * ⚠ SO THE GATE WAS RIGHT AND THE SPINES WERE WRONG. The spines are written and kept
   * out of the tree deliberately rather than forced through with an invented reader — a
   * declared reader that does not exist is the false green this whole page exists to
   * prevent, in the page itself. They go in the moment the history view reads them, and
   * these five rows come out in the same change; connections.test.js fails if both are
   * ever true at once, so the two cannot drift.
   * ⚠ AND lightsMarkedBuiltAt IS ALREADY WATCHED, which is what makes this worth listing
   * rather than leaving silent: its own note says adding a companion field and not
   * watching it is exactly the shape of hole this map catches. lightsQueuedAt IS that
   * companion — asked for, then made — so the pair is currently half on the page. */
];

/* WHAT SHOULD CONNECT TO WHAT — the hand-written half.
 * ====================================================
 * Only a person knows this. The code can say what it DOES; it cannot say what it was
 * meant to do, which is why a generated-only map can never go red.
 *
 * ⚠ BATCH 1 OF 6 — THREE SPINES, EACH ANCHORED AND THEN VERIFIED ONE AT A TIME. Addie
 * asked for a few at a time so she can sanity-check each batch. Eighteen unverified
 * manifests delivered at once is how a false red gets shipped, and a false red is as
 * damaging as a missed break: somebody goes hunting a bug that is not there.
 *
 * Everything here was read out of the merged tree on 2026-08-26 while surveying every
 * writer of these flags, not inferred from notes.
 */
'use strict';

module.exports = [
  {
    field: 'needsLightBuild',
    areas: ['Customers', 'Warehouse'], record: 'cust',
    title: 'Needs Building',
    plain: 'A house waiting for its bundle to be made.',
    /* ⭐ STATES, NOT PROSE. Addie: "I just want it sort of like this is what connects to
       this. Than you press on it and it gives you the rules for that thing. Like nightly
       invoice. Not paid — Not paid invoice. Paid — Paid invoice." Each row is a state on
       the left and where that state lands on the right. */
    states: [
      ['Flagged', 'Shows on the Warehouse Build list'],
      ['Flagged, no colours yet', 'Shows under Waiting on light colours'],
      ['Bundle marked made', 'Comes off the list'],
      ['Sitting the season out', 'Nothing is built']
    ],
    /* Route and plan documents carry a needsLightBuild of their own in fixtures and
       exports; those are not the customer record. Narrowed so amber stays readable. */
    ignore: ['^hlxRowXml$'],
    sets: [
      { file: 'admin', near: 'needsGeocode: pinFailed', where: 'Customers › Add a Customer', when: 'a customer is created',
        rules: ['Every new house is flagged, colours or no colours.'] },
      { file: 'admin', fn: 'rbApplyTickedAdds', where: 'Customers › Bulk Updates', when: 'the sheet adds a house',
        rules: ['A house with no colours is still on the list.'] },
      { file: 'admin', el: 'rbImportBtn', where: 'Customers › Bulk Updates', when: 'the raw importer adds a house',
        rules: ['Updating an existing customer never re-queues them.'] },
      { file: 'admin', el: 'ibImportBtn', where: 'Invoices › Import / Export', when: 'the invoice importer adds a house',
        rules: ['These arrive with no colours, so they show as blocked until somebody adds them.'] },
      /* ⭐ DECLARED 2026-08-31. This flag decides whether a bundle gets MADE, so every
         writer of it is somebody deciding a crew either has lights to hang or does not.

         ⚠ THE TWO PORTAL WRITERS ARE THE ONES THE OFFICE CANNOT SEE HAPPENING. A customer
         changing their colours queues their own rebuild, and a customer saying yes again
         after a no puts the build back — both from a page nobody in the office is looking
         at. */
      { file: 'server', fn: 'portalSave', where: 'Member Portal › My Lights', when: 'a customer changes their own colours',
        rules: ['A colour change queues the rebuild itself — the office is told by the queue, not by a message.'] },
      { file: 'server', fn: 'portalRsvp', where: 'Member Portal › RSVP', when: 'a customer answers' },
      { file: 'server', fn: 'pullCustomerFromSeason', where: 'Member Portal › RSVP', when: 'they sit the season out' },
      { file: 'admin', fn: 'seasonYesUpdates', where: 'Customers › All Customers', when: 'the office marks somebody back in',
        rules: ['Coming back re-queues the build ONLY where the recycle actually happened — otherwise their bundle is still on the shelf.'] },
      { file: 'admin', fn: 'setCustomerSeason', where: 'Customers › All Customers', when: 'the office answers for them' },
      { file: 'admin', el: 'editCustSaveBtn', where: 'Customers › All Customers', when: 'a customer record is saved',
        rules: ['A blank colour field means the build cannot be DONE yet, never that it is not OWED — clearing the flag here silently un-queued houses once.'] },
      { file: 'admin', el: 'whFindNotQueuedBtn', where: 'Warehouse › Tools', when: 'the office looks for houses nobody queued' },
      { file: 'admin', fn: 'renderWarehouseQueue', where: 'Warehouse › Build', when: 'a bundle is marked built',
        rules: ['Marking one built clears only that house.'] },
      { file: 'admin', el: 'editCustBuildStayBtn', where: 'Customers › All Customers', when: 'Build Them A New Set is pressed',
        rules: ['This button never also queues a recycle.'] },
      { file: 'admin', near: 'if(warehouseRebuildFields(item.data, addrUpdates).length)', where: 'Customers › All Customers', when: 'the wire or timer changed',
        rules: ['This can only turn it on, never off.'] },
      /* ⚠ A REAL, LIVE BREAK — and the reason `never` exists. The house-details panel on
         an All Customers row DOES write this field, so an existence check calls it green
         for ever. What it writes is `: false` when the colour box is empty, which takes
         a house that is waiting to be built off the list entirely. Your own ruling
         (WH-17): blank colours mean the build cannot be DONE yet, not that it is not
         OWED. The same rule was fixed in the Edit Customer save on 2026-08-21 and this
         copy was missed. */
      { file: 'admin', fn: 'attachAddressRowHandlers', where: 'Customers › All Customers', when: 'the house-details panel is saved',
        never: {
          pattern: "needsLightBuild:[^,]*:\\s*false",
          why: 'saving with the colour box empty takes the house OFF the build list — blank colours mean the build cannot be done yet, not that it is not owed'
        },
        rules: ['Clearing the colours must never cancel the build.'] },
      { file: 'server', fn: 'seasonYesUpdates', where: 'Member Portal › RSVP', when: 'somebody rejoins after a recycle',
        rules: ['Only re-queues a build if a recycle really happened.'] }
    ],
    reads: [
      { file: 'admin', fn: 'whBuildQueueGroups', where: 'Warehouse › Build', when: 'the queue is drawn',
        rules: ['A house with no colours is shown as blocked, never hidden.'] },
      { file: 'admin', fn: 'printNeedsBuildList', where: 'Schedule › Printing', when: 'the sheet prints',
        rules: ['The printed sheet lists the same people as the screen.'] },
      { file: 'admin', fn: 'computeColorDemand', where: 'Warehouse › Build', when: 'bulbs are ordered',
        rules: ['This is what orders the bulbs, so a wrong house here costs money.'] },
      { file: 'admin', fn: 'computePendingHouseCount', where: 'Warehouse › Build', when: 'the tab header is drawn' },
      { file: 'admin', fn: 'whHouseBuildStatus', where: 'Warehouse › Tools', when: 'the office searches a name' }
    ]
  },

  /* ⭐ ADDED 2026-08-27, WITH THE FIELD ITSELF. Owner's rule: somebody who changed their
   * lights should be built, somebody who changed nothing should not. Nothing recorded a
   * build before this, so a cleared needsLightBuild read the same whether the bundle was
   * made in October or the house was never queued at all — and Check The Build Queue had
   * to say "usually already built, or cleared by mistake" because the record did not know.
   *
   * ⚠ DECLARED THE DAY IT SHIPPED, deliberately. needsLightBuild is one of the seven
   * watched things with nothing else guarding it; adding a companion field that decides
   * what a screen tells you about a build, and then not watching it, is the exact shape
   * of hole this map exists to catch.
   *
   * ⚠ TWO WRITERS, NOT THREE. whToggleLightsNew in employee.html clears the same flag and
   * does NOT stamp this — owner, 2026-08-27, is not using the crew portal this year, so
   * that file was left alone. It is also outside this map entirely: build.js scans
   * admin.html and functions/index.js only. A house ticked there reads "no build
   * recorded". If the crew portal comes back, that is the first thing to fix.
   *
   * ⚠ AND THE FIVE PLACES THAT MUST NEVER STAMP IT are not listed here as sets, because
   * they are not writers of this field and never may be — colours cleared in the portal,
   * Back Next Year, and the out-for-season paths. build-stamp.test.js holds that line;
   * a presence map cannot express "must not appear over there". */
  {
    field: 'lightsMarkedBuiltAt',
    areas: ['Warehouse'], record: 'cust',
    title: 'Marked Built On',
    plain: 'The day somebody in the warehouse said this bundle was made.',
    states: [
      ['A date on file', 'Shows as "marked built <date>" beside the name'],
      ['No date', 'Shows as "no build recorded" \u2014 which is not the same as never built'],
      ['Cleared some other way', 'Sitting the season out never stamps a build']
    ],
    sets: [
      { file: 'admin', near: 'btn.dataset.whdonehouse),', where: 'Warehouse \u203a Build', when: 'one house is marked done',
        rules: ['It records the button being pressed, not a bundle being made \u2014 so every screen says "marked built", never "built".'] },
      { file: 'admin', near: 'const missedHouses = []', where: 'Warehouse \u203a Build', when: 'a whole colour group is marked finished',
        rules: ['A house that will not save is named, and stays on the build list.'] }
    ],
    reads: [
      { file: 'admin', el: 'whFindNotQueuedBtn', where: 'Warehouse \u203a Tools', when: 'Check The Build Queue is run',
        rules: ['A missing date reads "no build recorded", never "never built" \u2014 every customer on file before this shipped has none.'] }
    ]
  },

  {
    field: 'needsLightRecycle',
    areas: ['Customers', 'Warehouse'], record: 'cust',
    title: 'Needs Recycling',
    plain: 'A house whose lights have to be collected back in.',
    states: [
      ['Flagged', 'Shows on the Warehouse Recycle list'],
      ['Marked recycled', 'Comes off the list'],
      ['They say yes again', 'Comes off the list, nothing is collected'],
      ['They moved', 'Stays a customer, and is built again']
    ],
    sets: [
      { file: 'admin', el: 'editCustRecycleStayBtn', where: 'Customers › All Customers', when: 'Recycle Their Old Set is pressed',
        rules: ['This button never also queues a build.'] },
      { file: 'admin', near: 'addrUpdates.needsLightRecycle', where: 'Customers › All Customers', when: 'the RSVP answer changes' },
      { file: 'admin', fn: 'renderWarehouseRecycleQueue', where: 'Warehouse › Recycle', when: 'a set is marked recycled',
        rules: ['Marking one recycled clears only that house, and keeps their number.'] },
      { file: 'admin', fn: 'seasonYesUpdates', where: 'Customers › All Customers', when: 'the office marks somebody back in',
        rules: ['A yes cancels a queued recycle — the same rule the server applies, written twice.'] },
      { file: 'server', fn: 'portalRsvp', where: 'Member Portal › RSVP', when: 'a customer answers no',
        rules: ['Answering through the link and the office button must agree.'] },
      { file: 'server', fn: 'seasonYesUpdates', where: 'Member Portal › RSVP', when: 'somebody says yes',
        rules: ['Saying yes again cancels a queued recycle.'] }
    ],
    reads: [
      { file: 'admin', fn: 'whRecycleGroups', where: 'Warehouse › Recycle', when: 'the queue is drawn' },
      /* ⭐ DECLARED 2026-08-31. The readers that DECIDE something, rather than draw it. */
      { file: 'admin', fn: 'stopProblem', where: 'Routes › Install', when: 'the sweep decides a house should not be on a day',
        rules: ['A house whose lights are being taken apart must not be on a crew sheet — they would arrive with nothing to hang.'] },
      { file: 'admin', fn: 'seasonYesUpdates', where: 'Customers › All Customers', when: 'somebody says yes again',
        rules: ['It reads the queued recycle to know whether the build has to be put back.'] },
      { file: 'admin', fn: 'stampRecycleRequested', where: 'Warehouse › Recycle', when: 'a recycle is queued',
        rules: ['Dated on the way in, so the queue can say how long something has been waiting.'] },
      { file: 'server', fn: 'stampRecycleRequestedServer', where: 'Member Portal › RSVP', when: 'the server queues a recycle',
        rules: ['The browser and server copies stamp the same field the same way.'] },
      { file: 'server', fn: 'portalSave', where: 'Member Portal › My Lights', when: 'a customer changes something that affects their set' },
      { file: 'admin', fn: 'printRecycleList', where: 'Schedule › Printing', when: 'the sheet prints' },
      { file: 'admin', fn: 'isOutForSeason', where: 'Schedule › Scheduling', when: 'anything asks who is in the season',
        rules: ['A house queued for recycle is out of the season. Somebody who moved is not.'] }
    ]
  },

  {
    field: 'completed',
    areas: ['Customers', 'Schedule', 'Invoices'], record: 'cust',
    title: 'Installed',
    plain: 'Whether the crew has hung this house.',
    states: [
      ['Ticked', 'Billed on the next nightly run'],
      ['Not ticked', 'Not billed'],
      ['On a shared bill', 'Nobody is billed until every house on it is ticked'],
      ['Hung, then said no', 'Still billed — the work was done']
    ],
    /* ⚠ NARROWED, AND THIS IS THE DIFFERENCE BETWEEN A USEFUL AMBER AND NOISE. Route
       stops, plan days and schedule rows all carry a `completed` of their own — the
       prototype returned 28 undeclared touches for this field, nearly all of them that.
       Narrowing to the customer-record readers is what keeps amber worth reading. */
    ignore: ['^(stopProblem|renderRouteOrderedList|renderRouteAddressList|runGenerateInstallRoute|findNearbyMissedHouses|nextVisitFor|visitBadgeType|renderTakedownsList|reconcileUpcomingRoutes|renderOverviewMap|isOctoberUrgent|isNewHangUrgent|isBeforeThanksgivingUrgent|derivedDoneFor|houseBillingRow)$',
      /* ⚠ A LABEL MAP IS NOT A WRITE. `renderAllCustomersTable` holds
         `{completed:'Install Complete'}` — a key named after the field so a filter can be
         shown in words. It reads as a write to any matcher and is not one. */
      '^renderAllCustomersTable$'],
    sets: [
      { file: 'admin', fn: 'planTickCustomer', where: 'Schedule › Scheduling', when: 'one house is marked done',
        rules: ['Ticking one stop marks that one customer, never the whole day.'] },
      { file: 'admin', near: 'const HLX_DONE_KINDS', where: 'Routes › Install', when: 'any of five doors marks a job done',
        rules: ['Install, takedown and fix are separate. One never implies another.'] },
      /* ⭐ DECLARED 2026-08-31. Two more writers, and both matter for money: this field is
         what the nightly run bills on.

         ⚠ THE ALL CUSTOMERS ROW TICK IS THE ONE TO WATCH. `attachAddressRowHandlers` is
         already recorded on this page as writing needsLightBuild with the WRONG VALUE, so
         it is a handler with a history — and here it decides whether somebody is invoiced
         tonight. */
      { file: 'admin', fn: 'attachAddressRowHandlers', where: 'Customers › All Customers', when: 'the Install Complete box on a row is ticked',
        rules: ['Ticking this bills them on the next nightly run, so it must never be set as a side effect of another box on the same row.'] },
      { file: 'admin', el: 'ssnRunBtn', where: 'Customers › All Customers', when: 'Start New Season runs',
        rules: ['Clearing this is what stops last season\'s work being billed again in the new one — and it is why the hung-is-hung rule is safe.'] }
    ],
    reads: [
      { file: 'server', fn: 'runInvoiceBatch', where: 'Invoices › Nightly Automation', when: '7 PM Mountain',
        rules: ['A shared bill waits for every house on it.'] },
      { file: 'admin', fn: 'buildAddressRowHtml', where: 'Customers › All Customers', when: 'a customer row is drawn',
        rules: ['A house that is installed is what makes a takedown due, so one row shows both.'] },
      { file: 'admin', fn: 'memberExportStatus', where: 'Customers › Bulk Updates', when: 'the workbook is written back',
        rules: ['Removed beats installed — the export says where they are NOW, not everything true of them.'] },
      { file: 'admin', el: 'generateRemovalBtn', where: 'Routes › Install', when: 'a takedown route is generated',
        rules: ['Only a house that was actually hung can have its lights taken down.'] },
      { file: 'server', fn: 'houseIsOnTheBillServer', where: 'Invoices › Nightly Automation', when: 'deciding who is on a bill',
        rules: ['A house that was hung is charged, whatever they said afterwards.'] },
      { file: 'admin', fn: 'houseIsOnTheBill', where: 'Invoices › Invoice List', when: 'deciding who is on a bill',
        rules: ['The office screen and the nightly run always agree.'] },
      { file: 'admin', fn: 'allCustRouteStatus', where: 'Customers › All Customers', when: 'the Install Complete filter runs',
        rules: ['Feeds the Install Complete filter on All Customers.'] },
      { file: 'admin', fn: 'etRenderRecipientList', where: 'Automation Emails › Recipients', when: 'an audience is counted' }
    ]
  },

  /* ═══════════════ BATCH 2 — the money spines ═══════════════
     Addie chose these next: "the money ones first". A break here costs real money and
     nobody notices, which is the invoice-key bug from earlier this week exactly.

     ⭐ EACH SPINE SAYS WHAT ALREADY GUARDS IT — her answer to "show everything, marked
     which is which". A box that is connected AND covered by a test is a different fact
     from one that is connected and watched by nothing, and flattening the two is how a
     page stops being worth reading. `guard: null` means nothing else is watching. */

  {
    field: 'housePrice',
    areas: ['Quote Requests', 'Customers', 'Invoices'], record: 'cust',
    title: 'The price',
    plain: 'What the customer agreed to pay for their house.',
    guard: 'run-all.js covers this heavily — 126 checks mention it.',
    states: [
      ['Agreed on a quote', 'Becomes the price on their record'],
      ['Edited on the record', 'The invoice is rebuilt from it'],
      ['Never re-derived from feet', 'They are billed what they agreed, not a recalculation']
    ],
    sets: [
      { file: 'admin', near: 'needsGeocode: pinFailed', where: 'Customers › Add a Customer', when: 'a customer is created',
        rules: ['The agreed price is copied across, never worked out again.'] },
      { file: 'admin', fn: 'rbApplyTickedAdds', where: 'Customers › Bulk Updates', when: 'the sheet adds a house' }
    ],
    reads: [
      { file: 'admin', fn: 'syncPayerInvoice', where: 'Invoices › Invoice List', when: 'the invoice is rebuilt',
        rules: ['The invoice total is the sum of the house prices on the bill.'] },
      { file: 'admin', fn: 'buildInvoiceDocHtml', where: 'Invoices › Invoice List', when: 'the invoice is printed or emailed' },
      { file: 'server', fn: 'houseBillingRow', where: 'Invoices › Nightly Automation', when: 'the nightly run bills' }
    ]
  },

  {
    field: 'billToPhone',
    areas: ['Customers', 'Invoices'], record: 'cust',
    title: 'Whose bill this is on',
    plain: 'Set when one person pays for another house as well as their own.',
    guard: 'run-all.js has 72 checks touching it, including the who-pays-for-whom grouping.',
    states: [
      ['Not set', 'They pay for their own house'],
      ['Set to somebody else', 'Their house joins that person\'s bill'],
      ['Set, and they had already paid', 'What they paid follows the house onto the new bill']
    ],
    sets: [
      { file: 'admin', fn: 'rbResolveBillTo', where: 'Customers › Bulk Updates', when: 'the sheet says bill somebody else',
        rules: ['A payer who is not a customer is left as a note, never invented.'] }
    ],
    reads: [
      { file: 'admin', fn: 'billingGroupsByPayer', where: 'Customers › Who Pays for Whom', when: 'the screen is drawn',
        rules: ['Two houses on one phone are already one bill, even with nothing set.'] },
      { file: 'admin', fn: 'getLiveInvoiceStatus', where: 'Customers › All Customers', when: 'a row shows Paid or Unpaid' },
      { file: 'server', fn: 'billedHousesByKey', where: 'Invoices › Nightly Automation', when: 'the nightly run groups a bill',
        rules: ['A house with no Bill To whose own key matches is already on that bill.'] }
    ]
  },

  {
    field: 'changeFees',
    areas: ['Invoices'], record: 'inv',
    title: 'The $30 colour-change fee',
    plain: 'Added when a member changes their colours outside the free 48 hours.',
    guard: 'money-parity.test.js runs the browser and server copies side by side over ~1,100 combinations — the strongest guard in the repo.',
    states: [
      ['Inside the free 48 hours', 'No fee'],
      ['Outside it, invoice not sent', 'Added to this year\'s invoice'],
      ['Outside it, invoice already sent', 'Carried to next season instead'],
      ['The office waives it', 'No fee, but the route still locks for 48 hours']
    ],
    sets: [
      { file: 'server', fn: 'portalSave', where: 'Member Portal › My Lights', when: 'a member changes colours late',
        rules: ['The office is always asked first. Never charged silently.'] }
    ],
    reads: [
      { file: 'admin', fn: 'balanceDueAmount', where: 'Invoices › Invoice List', when: 'a balance is worked out',
        rules: ['The office screen and the nightly run must always agree.'] },
      { file: 'admin', fn: 'getLiveInvoiceStatus', where: 'Customers › All Customers', when: 'a row shows Paid or Unpaid' },
      { file: 'server', fn: 'paypalCaptureOrder', where: 'Member Portal › Pay', when: 'a card is charged',
        rules: ['The fee is part of what the card is charged, not an extra afterwards.'] },
      { file: 'admin', fn: 'buildInvoiceDocHtml', where: 'Invoices › Invoice List', when: 'the invoice is printed',
        rules: ['It is its own line, so the total adds up on the page.'] }
    ]
  },

  {
    field: 'chargeNewMemberFee',
    areas: ['Quote Requests', 'Customers', 'Invoices'], record: 'cust',
    title: 'The $30 join fee',
    plain: 'Charged once, to somebody who joined this year through a quote.',
    guard: 'run-all.js has 63 checks, and season-state.test.js touches it — the every-season overcharge is specifically guarded.',
    states: [
      ['Joined through a quote this year', 'Charged once'],
      ['Added by an import', 'Never charged — it is not set by bulk'],
      ['A new member who also changes colours late', 'Pays both fees, $60'],
      ['Next season', 'Cleared by Start New Season, so it is never charged twice']
    ],
    sets: [
      { file: 'admin', near: 'addCustNewMemberFee', where: 'Quote Requests', when: 'a quote becomes a customer',
        rules: ['By quote, never by bulk, and it expires — a 2026 quote is not new in 2027.'] }
    ],
    reads: [
      { file: 'server', fn: 'looksLikeNewMember', where: 'Invoices › Nightly Automation', when: 'the nightly run bills' },
      { file: 'admin', fn: 'whBuildReasonKey', where: 'Warehouse › Build', when: 'the NEW badge is drawn' },
      { file: 'admin', fn: 'audienceNeverAsked', where: 'Automation Emails › Recipients', when: 'the RSVP audience is chosen',
        rules: ['A first-year customer is never asked if they want lights AGAIN.'] }
    ]
  },

  {
    field: 'carryoverCharge',
    areas: ['Invoices'], record: 'cust',
    title: 'A fee held over to next season',
    plain: 'A charge that arrived after this year\'s invoice had already gone out.',
    guard: null,
    states: [
      ['Invoice not yet sent', 'The fee goes on this year\'s invoice instead'],
      ['Invoice already sent', 'Held here until next season'],
      ['Next season\'s first bill', 'Collected, then cleared']
    ],
    sets: [
      { file: 'server', fn: 'portalSave', where: 'Member Portal › My Lights', when: 'a late fee lands after the bill went out',
        rules: ['It lives on the customer, not the invoice — Start New Season wipes invoices.'] }
    ],
    reads: [
      { file: 'server', fn: 'runInvoiceBatch', where: 'Invoices › Nightly Automation', when: 'next season\'s first bill is built',
        rules: ['Summed across the whole bill, not just the payer.'] }
    ]
  },

  /* ═══════════════ BATCH 3 — ranked by how likely they are to disagree ═══════════════
     Addie, on scope: "what are most important most likely to fail. For example quotes,
     invoices, costumers, schedule, and routes" — and then "oh and warehouse".

     ⭐ "MOST LIKELY TO FAIL" IS MEASURABLE, NOT A GUESS. Every bug found this week had
     one shape: ONE RULE WITH SEVERAL WRITERS, and one of them disagreeing. The blank-
     colours hole was two writers with one fixed. The invoice key was four. So the fields
     were ranked by how many DISTINCT WRITERS each has inside her six areas — 82 have
     more than one — and these are taken off the top of that list.

     ⚠ The ranking validated itself before it was used: it put `needsLightBuild` at six
     writers across two files, which is precisely where the real hole turned out to be. */

  {
    field: 'deposit',
    areas: ['Invoices'], record: 'inv',
    title: 'Money recorded as paid',
    plain: 'What a customer has actually paid against their bill.',
    guard: 'money-parity.test.js sweeps the balance maths that reads it, but nothing checks the ten places that WRITE it agree.',
    ignore: ['^(applyQuoteLinkLabel|esc)$'],
    states: [
      ['A payment is captured', 'Added to the deposit on their invoice'],
      ['Typed in by the office', 'Same field, same effect'],
      ['Equal to the total', 'The bill reads Paid in Full'],
      ['They move onto somebody else\'s bill', 'What they paid follows the house across']
    ],
    sets: [
      { file: 'admin', fn: 'syncPayerInvoice', where: 'Invoices › Invoice List', when: 'the invoice is rebuilt',
        rules: ['A rebuild must never wipe a payment already recorded.'] },
      { file: 'server', fn: 'recordPaypalPayment', where: 'Member Portal › Pay', when: 'a card payment clears',
        rules: ['Added to what is there, never overwritten — two payments must both land.'] }
    ],
    reads: [
      { file: 'admin', fn: 'balanceDueAmount', where: 'Invoices › Invoice List', when: 'the balance is worked out' },
      { file: 'admin', fn: 'buildInvoiceDocHtml', where: 'Invoices › Invoice List', when: 'the invoice is printed or emailed' },
      { file: 'server', fn: 'runInvoiceBatch', where: 'Invoices › Nightly Automation', when: 'the nightly run bills' }
    ]
  },

  {
    field: 'stops',
    areas: ['Schedule'], record: 'route',
    title: 'The route a crew drives',
    plain: 'The frozen list of houses on one crew day, in the order they are driven.',
    guard: null,
    states: [
      ['Generated', 'Saved as a snapshot — it does not re-shuffle under the crew'],
      ['A customer is added', 'Slotted into an upcoming day if there is room'],
      ['A house is evicted', 'Comes off, and is reported rather than dropped silently'],
      ['Printed', 'The paper matches the screen, in the same order']
    ],
    sets: [
      { file: 'admin', fn: 'generateAllRoutes', where: 'Schedule › Scheduling', when: 'the season is recalculated',
        rules: ['Ordered inside a crew, never across the day — one list sends each crew into the other\'s town.'] },
      { file: 'admin', fn: 'autoScheduleNewCustomer', where: 'Customers › Add a Customer', when: 'a new customer is slotted in' },
      /* ⭐ DECLARED 2026-08-31, working the five areas Addie picked. `stops` is the one
         field on this page where an undeclared writer is somebody driving to the wrong
         house: it is the FROZEN list a crew is handed, so anything that rewrites it after
         the sheet is printed has to be visible.

         ⚠ THE SWEEP IS THE BIGGEST OF THEM and runs every fifteen minutes with nobody
         watching — it evicts, refreshes, caps and tops up, all by rewriting this array. */
      { file: 'admin', fn: 'reconcileUpcomingRoutes', where: 'Routes › Install', when: 'the sweep runs, every 15 minutes',
        rules: ['A day inside 48 hours is never re-ordered — the truck is loaded the night before.',
                'Anything it moves is reported, never dropped silently.'] },
      { file: 'admin', fn: 'resyncSavedRouteStops', where: 'Routes › Install', when: 'a customer record is corrected',
        rules: ['A stop is a snapshot, so a corrected address has to be pushed onto it — upcoming days only, never history.'] },
      { file: 'admin', fn: 'removeCustomerFromUpcomingRoutes', where: 'Routes › Install', when: 'a customer is deleted or pulled from the season',
        rules: ['Leaving the stop behind sends a crew to a house that is not in the book any more.'] },
      { file: 'server', fn: 'removeCustomerFromUpcomingRoutes', where: 'Member Portal › My Lights', when: 'a customer takes themselves out',
        rules: ['The browser and the server both have to be able to do this — the customer is not signed into the office.'] },
      { file: 'server', fn: 'portalSave', where: 'Member Portal › My Lights', when: 'a customer changes something that affects their stop',
        rules: ['A change inside 48 hours of a printed day must not silently rewrite the sheet.'] },
      { file: 'admin', fn: 'dayMapRoutes', where: 'Routes › Map View', when: 'a day is dragged into a new order' },
      { file: 'admin', fn: 'hcFixRow', where: 'Customers › All Customers', when: 'the health check repairs a route fault' },
      { file: 'admin', el: 'markScheduledBtn', where: 'Routes › Install', when: 'a route is saved as scheduled' }
    ],
    reads: [
      { file: 'admin', fn: 'evenOutDays', where: 'Schedule › Scheduling', when: 'a day is over the cap' },
      { file: 'admin', fn: 'fillDays', where: 'Schedule › Scheduling', when: 'a thin day is topped up' },
      /* ⚠ NOT crewSheetRows. It reads `day.houses` off the season PLAN, which is a
         different shape from a saved route's `stops` — declaring it here was a false
         red on correct code. The map view is what really reads the stops. */
      { file: 'admin', fn: 'dayMapDraw', where: 'Routes › Map View', when: 'the day is drawn on the map' },
      { file: 'admin', fn: 'renderCalendar', where: 'Schedule › Scheduling', when: 'the calendar counts what is on each day' },
      { file: 'admin', fn: 'renderDayMaps', where: 'Routes › Map View', when: 'the day maps are drawn' }
    ],
    /* ⚠ THE TEST SWEEP AND THE DUPLICATE TOOLS READ STOPS FOR THEIR OWN REASONS, not as
       a connection. The duplicate finders check whether a copy is on a route before
       deleting it — real and important, but it is a SAFETY CHECK on a delete, not a
       route being built; and the test sweep exists to take throwaway records back out.
       Declared as exceptions rather than left as amber, so the reasoning is written down
       instead of the rows just sitting there unexplained. */
    ignore: ['^(testSweepFind|testSweepDelete|dupFindBtn handler|dupExactBtn handler)$']
  },

  {
    field: 'status',
    areas: ['Quote Requests'], record: 'quote',
    title: 'Where a quote sits',
    plain: 'New, priced, sent, approved or closed — which decides the folder it appears in.',
    guard: 'run-all.js covers the quote card and the folders, but the writers are spread across three files.',
    ignore: ['^(computeInvoiceStatus|renderInvoicesList|syncPayerInvoice|hcRunChecks|etRenderRecipientList|allCustRouteStatus|buildAddressRowHtml|attachAddressRowHandlers|balanceDueAmount|buildInvoiceDocHtml|getLiveInvoiceStatus|paypalCaptureOrder|runInvoiceBatch|sendPaymentReceipt|houseBillingRow)$'],
    states: [
      ['New', 'Waiting to be priced'],
      ['Approved by the customer', 'Ready to convert'],
      ['Converted', 'Closed, and the customer exists'],
      ['A re-quote', 'Its own folder, so it is never built as a new house']
    ],
    sets: [
      /* ⚠ NOT quoteRespond — that writes `approvalStatus`, which is a different field
         answering a different question (what the customer said, versus where the quote
         sits). Conflating them was a false red. `status` is written when a quote is
         converted or archived. */
      /* ⚠ REPOINTED 2026-08-29 — IT WAS MATCHING A COMMENT. The real writes are
         `status: 'closed'` WITH a space; the three unspaced occurrences in this file are
         all prose describing them. The anchor landed on one of those, and the range around
         it happened to contain a real write, so the row read green while pointing at
         nothing. It only surfaced when a scanner fix shortened the ranges — a green built
         on a mistake in the scanner, which is exactly the false green this page exists to
         prevent, in the page itself. */
      { file: 'admin', near: "status: 'closed', convertedToCustomerAt", where: 'Quote Requests', when: 'a quote is converted or archived',
        rules: ['A quote can never be CREATED already priced or already approved — firestore.rules refuses it.'] }
    ],
    reads: [
      { file: 'admin', fn: 'quoteStage', where: 'Quote Requests', when: 'a card is drawn' },
      /* quoteFolder asks quoteStage rather than reading the field itself, which is
         right — one rule, one reader — so it is not declared as a reader of `status`. */
      { file: 'admin', fn: 'closedQuoteFor', where: 'Quote Requests', when: 'a house is checked for a closed quote' }
    ]
  },
  /* ------------------------------------------------------------------------
   * BATCH 4 (2026-08-27). Addie: "I want to start getting our connection sections
   * together so we can work on getting all website connections in one spot."
   * Three fields chosen by how many separate places WRITE them, inside the six areas
   * she named — the shape every bug found this week had: one rule, several writers,
   * one of them out of step.
   * ---------------------------------------------------------------------- */
  {
    field: 'rsvpStatus',
    areas: ['Customers', 'Schedule', 'Invoices'], record: 'cust',
    /* ⚠ THE TEST-RECORD BUILDERS TOUCH THE RIGHT RECORD AND ARE NOT CONNECTIONS. They
       mint a throwaway customer so somebody can walk a flow; declaring them would put a
       row on the map for a house that is deleted the same afternoon. The record-aware
       filter cannot work this out — they really are writing jobAddresses — so it stays a
       hand-written exception, which is what `ignore` is for. */
    ignore: ['^(buildTestPerson|qBuildTestBtn handler)$'],
    title: 'What they said about this season',
    plain: 'Their answer to "are you having lights again this year".',
    guard: 'season-state.test.js runs every answer through the five lists it lands on.',
    states: [
      ['Yes, and they replied', 'Routed, scheduled, built for and billed'],
      ['No', 'Out of the season, and their lights are collected back in'],
      ['Back Next Year', 'Out this season, on the 2027 list — still billed for work already done'],
      ['Nothing yet', 'In the season until the RSVP goes out, out of it afterwards'],
      ['Yes with no reply behind it', 'Not an answer — an import or a hand-edit, and distrusted']
    ],
    /* The office dropdown, the portal and the quote link all write this, and the
       important part is that the OFFICE one stamps a date too — an answer taken over
       the phone is still an answer (Addie, 2026-08-22: "We should be able to approve
       for them in costumers as well"). */
    sets: [
      { file: 'server', fn: 'portalRsvp', where: 'Member Portal › RSVP', when: 'a customer answers the RSVP',
        rules: ['Answering through the link and the office button must land in the same place.'] },
      { file: 'server', fn: 'seasonYesUpdates', where: 'Member Portal › RSVP', when: 'somebody says yes',
        rules: ['One yes cancels a queued recycle and clears a Maybe Next Year badge.'] },
      { file: 'server', fn: 'pullCustomerFromSeason', where: 'Member Portal › RSVP', when: 'they ask to sit the season out' },
      { file: 'admin', fn: 'setCustomerSeason', where: 'Customers › All Customers', when: 'the office marks the answer for them',
        rules: ['This is one of the three ways to say yes, so it stamps a reply date like the others.'] },
      /* ⭐ DECLARED 2026-08-31, working the five areas Addie picked. Everything below was
         a real writer the map could not see — and the browser copy of `seasonYesUpdates`
         is the one that matters most: it is a SECOND implementation of what a yes does,
         beside the server's, and two copies of a rule about who is in the season is
         exactly the shape money-parity exists for. */
      { file: 'admin', fn: 'seasonYesUpdates', where: 'Customers › All Customers', when: 'the office marks somebody in for the season',
        rules: ['The browser and server copies of what a yes does must agree — one cancels a queued recycle, re-queues a build only where that recycle happened, and clears the badge in BOTH its fields.'] },
      { file: 'admin', el: 'editCustSaveBtn', where: 'Customers › All Customers', when: 'a customer record is saved',
        rules: ['Editing a record must not quietly change what they answered about the season.'] },
      { file: 'admin', el: 'rsvpResetBtn', where: 'Customers › All Customers', when: 'everybody is moved to Unanswered before an RSVP goes out',
        rules: ['A reset touches the ANSWER only — a queued recycle is work the warehouse has already done, and a Maybe Next Year badge is a decision rather than a reply, so both survive.'] },
      { file: 'admin', el: 'routeAddressForm', where: 'Customers › Add a Customer', when: 'a customer is typed in' },
      /* ⚠ A LOCAL MIRROR, NOT A FIRESTORE WRITE, and it is declared BECAUSE of that. The
         quote card repaints from `jobAddresses` rather than re-reading the database, so
         approving a quote has to put the answer into the cache as well as send it — and a
         mirror that falls out of step with what was actually written is a screen
         confidently showing something that is not in the record. */
      { file: 'admin', fn: 'renderQuoteRows', where: 'Quote Requests', when: 'approving a quote marks them in for the season',
        rules: ['Approving is one of the ways to say yes, so the card must mirror exactly what the shared rule wrote.'] }
    ],
    reads: [
      { file: 'admin', fn: 'isOutForSeason', where: 'Schedule › Scheduling', when: 'anything asks who is in the season',
        rules: ['Only somebody who actually replied yes is in, once the RSVP has gone out.'] },
      /* ⭐ THE READERS, DECLARED 2026-08-31. `stopProblem` is the one worth reading twice:
         it is what takes a house OFF a crew day, and until 2026-08-26 it and the two
         passes that put houses back on disagreed about who was in the season — a house
         evicted and re-placed every fifteen minutes, for ever. */
      { file: 'admin', fn: 'stopProblem', where: 'Routes › Install', when: 'the sweep decides a house should not be on a day',
        rules: ['Eviction and the passes that fill a day must ask the same question — a disagreement is a loop nobody sees.'] },
      { file: 'admin', fn: 'etRsvpAnswered', where: 'Automation Emails › Recipients', when: 'an RSVP audience is counted',
        rules: ['Unanswered is its own state, not a blank — after a reset a filter on "no answer yet" must still find everybody.'] },
      { file: 'admin', fn: 'etRenderRecipientList', where: 'Automation Emails › Recipients', when: 'a send audience is drawn' },
      { file: 'admin', fn: 'historyRsvpWords', where: 'Customers › All Customers', when: 'a customer history is drawn',
        rules: ['Which of the ways they answered is the question somebody has when they open the record.'] },
      { file: 'admin', fn: 'whHouseBuildStatus', where: 'Warehouse › Build', when: 'the office asks why a house is not on the build list',
        rules: ['Sitting the season out is one of the four reasons a house is missing, and the answer has to say which.'] },
      { file: 'admin', fn: 'hcRunChecks', where: 'Customers › All Customers', when: 'the health check runs' },
      { file: 'admin', fn: 'ssnScopeHouses', where: 'Customers › All Customers', when: 'Start New Season works out who it is about',
        rules: ['Start New Season rewrites every customer in one press with no undo, so who is in scope is the whole of it.'] },
      { file: 'admin', fn: 'housesForInvoiceKey', where: 'Invoices › Invoice List', when: 'the houses on one bill are listed',
        rules: ['A house that said no is off the bill, so naming it would print a list that does not add up to the amount under it.'] },
      { file: 'admin', fn: 'openEditCustomerModal', where: 'Customers › All Customers', when: 'a record is opened for editing' },
      { file: 'admin', fn: 'editCustHouseholdHouses', where: 'Customers › All Customers', when: 'the house tabs on one bill are drawn' },
      { file: 'admin', fn: 'hcSharedPhoneGroups', where: 'Customers › All Customers', when: 'households sharing a phone are grouped' },
      { file: 'admin', fn: 'effectiveRsvpStatus', where: 'Customers › All Customers', when: 'a status is shown anywhere',
        rules: ['A stored yes with no reply date behind it is not an answer.'] },
      { file: 'admin', fn: 'houseIsOnTheBill', where: 'Invoices › Nightly Automation', when: 'the bill is built',
        rules: ['A house that was hung is billed whatever they have said since.'] },
      { file: 'server', fn: 'houseIsOnTheBillServer', where: 'Invoices › Nightly Automation', when: 'the nightly run bills' }
    ]
  },
  {
    field: 'rsvpRespondedAt',
    areas: ['Customers', 'Schedule'], record: 'cust',
    title: 'When they actually answered',
    plain: 'The date that turns a stored "yes" into a real reply.',
    guard: 'season-state.test.js runs it through every list an answer lands on.',
    states: [
      ['Stamped', 'They really answered — routed, scheduled and built for'],
      ['Missing, with a yes on file', 'Not an answer. An import, a hand-edit, or the assumed yes written at conversion'],
      ['Missing, and new this year', 'In anyway — they were never sent an RSVP, and converting the quote was the approval']
    ],
    /* ⚠ THIS IS THE FIELD THAT MAKES A YES REAL, and it is why the office dropdown had
       to be taught to stamp it (Addie, 2026-08-22: "We should be able to approve for
       them in costumers as well" — an answer taken over the phone is still an answer).
       A writer that sets the status and forgets the date is writing a yes nothing will
       believe. */
    sets: [
      { file: 'server', fn: 'portalRsvp', where: 'Member Portal › RSVP', when: 'a customer answers' },
      { file: 'server', fn: 'seasonYesUpdates', where: 'Member Portal › RSVP', when: 'somebody says yes',
        rules: ['Every route that takes a yes stamps this, or the yes is not believed.'] },
      { file: 'admin', fn: 'setCustomerSeason', where: 'Customers › All Customers', when: 'the office answers for them' },
      /* ⭐ DECLARED 2026-08-31. Five more writers, and the point of listing them is that
         this field is what makes a yes REAL — a writer that sets the status and forgets
         the date has written an answer nothing downstream will believe. */
      { file: 'admin', fn: 'seasonYesUpdates', where: 'Customers › All Customers', when: 'the office marks somebody in',
        rules: ['The browser copy stamps the reply date exactly as the server copy does — a yes without it is not an answer.'] },
      { file: 'server', fn: 'pullCustomerFromSeason', where: 'Member Portal › RSVP', when: 'they ask to sit the season out',
        rules: ['A no is an answer too, and is dated like one.'] },
      { file: 'admin', el: 'editCustSaveBtn', where: 'Customers › All Customers', when: 'a record is saved' },
      { file: 'admin', el: 'rsvpResetBtn', where: 'Customers › All Customers', when: 'everybody is moved to Unanswered',
        rules: ['The reset clears the ANSWER and its date together — a date left behind would make an emptied status read as a real reply.'] },
      { file: 'admin', el: 'routeAddressForm', where: 'Customers › Add a Customer', when: 'a customer is typed in' }
    ],
    reads: [
      { file: 'admin', fn: 'effectiveRsvpStatus', where: 'Customers › All Customers', when: 'a status is shown',
        rules: ['A yes with no date behind it is emptied before anything else is decided.'] },
      { file: 'admin', fn: 'isOutForSeason', where: 'Schedule › Scheduling', when: 'anything asks who is in the season' },
      { file: 'admin', fn: 'renderDashRsvpPanel', where: 'Customers › All Customers', when: 'the RSVP list is drawn' },
      /* ⚠ REPOINTED 2026-08-29 — IT NAMED THE WRONG FUNCTION. The Yes sheet's rule lives
         in that tab's own `holds` predicate, which is an anonymous function inside a table
         at top level, not in `hlxReadSheet`. The row read green because a scanner bug gave
         `hlxReadSheet` a range far longer than the function, and the real read happened to
         fall inside it. Fixing the scanner is what exposed it — a declaration pointing at
         the wrong place, reporting a connection as present for the wrong reason. */
      { file: 'admin', near: "if(said === 'yes' && d.rsvpRespondedAt) return true;",
        where: 'Customers › Bulk Updates', when: 'the Yes tab of the workbook is filled',
        rules: ['The Yes sheet holds people who ANSWERED, never people we assumed.'] }
    ]
  },
  {
    field: 'measuredFeet',
    areas: ['Quote Requests', 'Customers', 'Warehouse'], record: 'cust',
    title: 'How many feet of roofline',
    plain: 'The measurement the whole job is sized from.',
    guard: null,
    states: [
      ['Up to 260 ft', 'One bin, and a regular customer number'],
      ['Over 260 ft', 'Another bin for every 260, and a 5000-series number'],
      ['Changed', 'Raises a re-quote, and the bin count is worked out again'],
      ['Blank', 'The price is divided back into a guess, and nothing says so loudly']
    ],
    /* ⚠ FOUR WRITERS AND NO SERVER ONE. Everything that can change this number is in
       the office: the form, the measuring tool, the sheet sync and the bulk importer.
       That is why it is worth watching — one of them writing a different number from
       the others is invisible until a crew is short of glass. */
    sets: [
      { file: 'admin', el: 'editCustSaveBtn', where: 'Customers › All Customers', when: 'a customer is saved',
        rules: ['Changing this raises a re-quote by itself — the house is measurably different.'] },
      /* ⚠ NOT rmCommitPayload, WHICH IS WHAT I DECLARED FIRST AND THE GATE REFUSED.
         The measuring tool writes `estimatedFeet` on the QUOTE — a different field on a
         different record. `measuredFeet` is the customer's, and it only gets there when
         the quote is converted or the office types it. That is the whole point of the
         two lists: the declaration was plausible, wrong, and went red in seconds. */
      { file: 'admin', el: 'routeAddressForm', where: 'Customers › Add a Customer', when: 'a customer is created' },
      { file: 'admin', el: 'whFillFeetFromPriceBtn', where: 'Warehouse › Tools', when: 'the feet are worked back out of the price',
        rules: ['A figure derived from the price is a guess — the warehouse builds to it all the same.'] },
      { file: 'admin', fn: 'rbApplyTickedAdds', where: 'Customers › Bulk Updates', when: 'the master sheet adds somebody' },
      { file: 'admin', el: 'rbImportBtn', where: 'Customers › Bulk Updates', when: 'a bulk import runs' }
    ],
    reads: [
      { file: 'admin', fn: 'whBinsForHouse', where: 'Warehouse › Build', when: 'the bins are counted',
        rules: ['260 ft per bin, and the rule lives in one place.'] },
      { file: 'admin', fn: 'houseBundleNeed', where: 'Warehouse › Build', when: 'the bundles are counted' },
      { file: 'admin', fn: 'buildInvoiceDocHtml', where: 'Invoices › Invoice List', when: 'an invoice is printed or emailed' },
      { file: 'server', fn: 'feetLineFor', where: 'Invoices › Nightly Automation', when: 'the nightly email is built' }
    ]
  },
  /* ⭐ THE FIVE DATES, DECLARED THE DAY AFTER THEY SHIPPED (2026-08-29). Addie, looking
   * at this page: "you added on connections members and dates that things were changed
   * right?" Half of it was true — the Rules tab is built from her own questions map, so
   * both new rulings were already on it — and this half was not. Five date fields had
   * gone in the day before and none of them was watched.
   *
   * ⚠ THE ASYMMETRY IS WHAT MADE IT WORTH DOING NOW. lightsMarkedBuiltAt was already
   * watched, and its own note says why: "adding a companion field that decides what a
   * screen tells you about a build, and then not watching it, is the exact shape of hole
   * this map exists to catch." lightsQueuedAt IS that companion — asked for, then made —
   * and it went in unwatched. The rule was already written down; it just was not applied.
   *
   * ⚠ AND EVERY ONE OF THEM IS WRITTEN AND READ BY NOTHING. That is not an accident and
   * it is not a bug: they are the raw material for the customer history Addie asked for
   * ("dating when everything is done for each costumer through the system we have set"),
   * and that view is not built. So each carries its sets and NO reads — which is the
   * honest picture, and is what makes the gap visible on the page rather than only in
   * somebody's memory. When the history is built, its reader goes in the reads list and
   * this note comes out.
   *
   * ⚠ THE WRITERS ARE DECLARED IN FULL, not sampled. Anything touching a watched field
   * outside a declared anchor lands in amber, so a partial list would report the honest
   * remainder as unagreed — and amber carrying rows that are actually fine is amber
   * nobody reads. queue-date.test.js holds the census that keeps the list complete. */
  {
    field: 'lightsQueuedAt',
    areas: ['Warehouse'], record: 'cust',
    title: 'Sent To The Warehouse On',
    plain: 'The day somebody asked for this bundle to be made.',
    states: [
      ['A date on file', 'How long the warehouse has been sitting on this job'],
      ['No date', 'Queued before this shipped — not the same as never queued'],
      ['Queued again', 'A new date, because the warehouse waits on the newest request'],
      ['Bundle marked built', 'The date STAYS — "queued on the 2nd, built on the 9th" is the point']
    ],
    sets: [
      { file: 'admin', fn: 'stampBuildQueued', where: 'Warehouse › Build', when: 'the flag goes from off to on',
        rules: ['On the transition only. Two callers write the flag on EVERY save keeping whatever it held, so stamping there would reset the clock whenever anybody opened a record to fix a phone number.',
          'Every caller places the call LAST, after every branch that can move the flag — including Maybe Next Year, which cancels a build. The first version sat inside the re-quote branch and missed every other way in. queue-date.test.js holds that census; a map of writers cannot see WHERE inside a handler a call sits.'] },
      { file: 'server', fn: 'stampBuildQueuedServer', where: 'Member Portal › My Lights', when: 'the flag goes from off to on',
        rules: ['The same rule, second copy. Change one and change the other in the same push.'] },
      { file: 'admin', el: 'qBuildTestBtn', where: 'Quote Requests', when: 'a test quote is built' },
      { file: 'admin', fn: 'buildTestPerson', where: 'Customers › All Customers', when: 'a test person is created' },
      { file: 'admin', el: 'routeAddressForm', where: 'Customers › Add a Customer', when: 'a customer is created' },
      { file: 'admin', fn: 'rbApplyTickedAdds', where: 'Customers › Bulk Updates', when: 'the master sheet adds somebody' },
      { file: 'admin', el: 'rbImportBtn', where: 'Customers › Bulk Updates', when: 'the importer adds somebody' },
      { file: 'admin', el: 'ibImportBtn', where: 'Invoices › Import / Export', when: 'the invoice importer adds somebody' },
      { file: 'admin', el: 'whFindNotQueuedBtn', where: 'Warehouse › Tools', when: 'a missed house is queued by hand' },
      { file: 'admin', el: 'editCustBuildStayBtn', where: 'Customers › All Customers', when: 'Build Them A New Set is pressed' }
    ],
    reads: [
      /* ⚠ ANCHORED ON THE STEP TABLE, NOT ON customerHistory. That function reads every
         date through `rec[step.field]` — one dynamic lookup for all eighteen — so the
         field name appears nowhere inside it and a scanner correctly finds no read
         there. The row in HISTORY_STEPS is what actually puts this field on the page,
         and it is the only place the name is written down. */
      { file: 'admin', near: "field: 'lightsQueuedAt'", where: 'Customers › All Customers', when: 'their history is opened',
        rules: ['One line on the customer’s own history. Until this existed the field was written everywhere and read nowhere, which R-010 rightly refuses to declare.'] }
    ]
  },

  {
    field: 'lightsRecycleRequestedAt',
    areas: ['Warehouse'], record: 'cust',
    title: 'Asked Back On',
    plain: 'The day somebody asked for this house’s old set to be collected.',
    states: [
      ['A date on file', 'How long the bin has been waiting to be fetched'],
      ['No date', 'Asked for before this shipped'],
      ['Asked again', 'A new date, same rule as a re-queued build']
    ],
    sets: [
      { file: 'admin', fn: 'stampRecycleRequested', where: 'Warehouse › Recycle', when: 'the flag goes from off to on' },
      { file: 'server', fn: 'stampRecycleRequestedServer', where: 'Member Portal › My Lights', when: 'the flag goes from off to on' },
      { file: 'admin', el: 'editCustRecycleStayBtn', where: 'Customers › All Customers', when: 'Recycle Their Old Set is pressed' }
    ],
    reads: [
      /* ⚠ ANCHORED ON THE STEP TABLE, NOT ON customerHistory. That function reads every
         date through `rec[step.field]` — one dynamic lookup for all eighteen — so the
         field name appears nowhere inside it and a scanner correctly finds no read
         there. The row in HISTORY_STEPS is what actually puts this field on the page,
         and it is the only place the name is written down. */
      { file: 'admin', near: "field: 'lightsRecycleRequestedAt'", where: 'Customers › All Customers', when: 'their history is opened',
        rules: ['One line on the customer’s own history. Until this existed the field was written everywhere and read nowhere, which R-010 rightly refuses to declare.'] }
    ]
  },

  {
    field: 'assignedCrewAt',
    areas: ['Schedule'], record: 'cust',
    title: 'Put On A Crew Sheet On',
    plain: 'The day the booking was made — which is not the day they are booked for.',
    states: [
      ['A date on file', 'The gap between this and the install is how long they waited'],
      ['No date', 'Booked before this shipped, or not booked at all'],
      ['Taken off the sheet', 'Cleared with the crew, because the booking no longer exists']
    ],
    /* ⚠ scheduledDate IS A DIFFERENT THING and the pair is the whole point: one is the
       day they are booked FOR, this is the day somebody booked them. The gap between the
       two is where a house sits and gets forgotten, and until this shipped nothing
       measured it. */
    sets: [
      { file: 'admin', fn: 'scheduledFieldForType', where: 'Schedule › Scheduling', when: 'a house is put on a crew’s day' },
      { file: 'admin', fn: 'freeUpFieldForType', where: 'Schedule › Scheduling', when: 'a house comes off a crew’s day',
        rules: ['Cleared with the booking. A date left behind would claim a crew is going.'] }
    ],
    reads: [
      /* ⚠ ANCHORED ON THE STEP TABLE, NOT ON customerHistory. That function reads every
         date through `rec[step.field]` — one dynamic lookup for all eighteen — so the
         field name appears nowhere inside it and a scanner correctly finds no read
         there. The row in HISTORY_STEPS is what actually puts this field on the page,
         and it is the only place the name is written down. */
      { file: 'admin', near: "field: 'assignedCrewAt'", where: 'Customers › All Customers', when: 'their history is opened',
        rules: ['One line on the customer’s own history. Until this existed the field was written everywhere and read nowhere, which R-010 rightly refuses to declare.'] }
    ]
  },

  {
    field: 'fixRaisedAt',
    areas: ['Fixes'], record: 'cust',
    title: 'Fault Reported On',
    plain: 'The day somebody said this house needed fixing.',
    states: [
      ['A date on file', 'How long the fault has been outstanding'],
      ['No date', 'Reported before this shipped'],
      ['Mended', 'The date SURVIVES beside fixDoneAt — the pair is how long they waited']
    ],
    /* ⚠ IT MUST NOT BE CLEARED BY THE MEND. fixDoneAt already recorded the repair, so
       nobody could tell a fault outstanding three weeks from one reported that morning;
       clearing this on the mend would put that back exactly as it was. */
    sets: [
      { file: 'admin', near: 'off: function (ts) { return {needsFix: true, fixRaisedAt: ts}; }',
        where: 'Routes › Install', when: 'a house is flagged for a fix' }
    ],
    reads: [
      /* ⚠ ANCHORED ON THE STEP TABLE, NOT ON customerHistory. That function reads every
         date through `rec[step.field]` — one dynamic lookup for all eighteen — so the
         field name appears nowhere inside it and a scanner correctly finds no read
         there. The row in HISTORY_STEPS is what actually puts this field on the page,
         and it is the only place the name is written down. */
      { file: 'admin', near: "field: 'fixRaisedAt'", where: 'Customers › All Customers', when: 'their history is opened',
        rules: ['One line on the customer’s own history. Until this existed the field was written everywhere and read nowhere, which R-010 rightly refuses to declare.'] }
    ]
  },

  {
    field: 'newMemberFeeAppliedAt',
    areas: ['Money'], record: 'inv',
    title: 'Join Fee Charged On',
    plain: 'The day the $30 new member fee went onto their bill.',
    states: [
      ['A date on file', 'Answers "when was I charged this?" from the record'],
      ['No date', 'Charged before this shipped, or never charged'],
      ['New season', 'The fee guard resets, so a new charge carries a new date']
    ],
    /* ⚠ THE JOIN FEE IS FOLDED STRAIGHT INTO `install` rather than listed as its own
       line, which is why it was the one fee with no date of its own while the referral
       credit, the change fee and the carryover charge all carried one on their note. */
    sets: [
      { file: 'server', fn: 'runInvoiceBatch', where: 'Invoices › Nightly Automation', when: 'the join fee is added' }
    ],
    reads: [
      /* ⚠ ANCHORED ON THE STEP TABLE, NOT ON customerHistory. That function reads every
         date through `rec[step.field]` — one dynamic lookup for all eighteen — so the
         field name appears nowhere inside it and a scanner correctly finds no read
         there. The row in HISTORY_STEPS is what actually puts this field on the page,
         and it is the only place the name is written down. */
      { file: 'admin', near: "field: 'newMemberFeeAppliedAt'", where: 'Customers › All Customers', when: 'their history is opened',
        rules: ['One line on the customer’s own history. Until this existed the field was written everywhere and read nowhere, which R-010 rightly refuses to declare.'] }
    ]
  },

  {
    field: 'customerNumber',
    /* ⚠ THREE FAMILIES ARE EXCLUDED, AND EACH IS A DIFFERENT KIND OF NOT-A-CONNECTION.
       Declaring them one by one would add sixty rows that tell nobody anything, while
       leaving them as amber leaves sixty rows nobody can explain. Named here with the
       reason is the honest middle.

       1. A ROUTE STOP CARRIES A COPY. `nearestNeighborOrder`, `pickClustered`,
          `pickClusteredSimple` and `findNearbyMissedHouses` build a stop and copy the
          number onto it — that is the `stops` spine's business, and it is declared there.
          A number is not CHANGING here.
       2. PRINTING AND DRAWING IT. The crew sheets, the warehouse sheets, the exports,
          the chips and the panels all show the number. A screen that shows a number is
          not a connection anybody needs to police; a screen that DECIDES something with
          it is, and those are declared above.
       3. A RANK TABLE NAMED AFTER FIELDS. `rbCollectMissingCustomers` holds
          `{street: 1, housePrice: 2, customerNumber: 4, …}` to sort the comparison — a
          key named after a field, which reads as a write to any matcher and is not one.
       And the test-record builder, as everywhere else. */
    ignore: ['^(nearestNeighborOrder|pickClustered|pickClusteredSimple|findNearbyMissedHouses)$',
             '^(print|render|cnPrint|cnBuildPrintTable|wh(Sheet|Refresh|House|PutInto)|custNumChip|numOf|add)',
             '^(rbCollectMissingCustomers|rbCustomerToSheetRow|rbCompareFindCustomer|rbCollectNameFixes|rbCollectNumberFixes)$',
             '^(buildTestPerson|testSweepFind)$',
             'ExportBtn handler$'],
    areas: ['Customers', 'Warehouse'], record: 'cust',
    title: 'The number on their bin',
    plain: 'How the warehouse finds this house’s lights on a shelf.',
    guard: null,
    states: [
      ['Regular series', 'One bin'],
      ['5000 series', 'More than one bin'],
      ['Customer removed', 'The number goes back into the pool for somebody new'],
      ['Moved to another series', 'The bin on the shelf still wears the OLD number']
    ],
    /* ⚠ THE LAST STATE IS THE ONE THAT CATCHES PEOPLE. Re-measuring can move somebody
       from a regular number to the 5000 series, but nobody has walked to the shelf, so
       the box still says the old one. `binLabelNumber` records what the bin SAYS;
       this field is what the record says, and the recycle list has to ask for the
       first (Addie, 2026-08-21: "we need the old one in the recycle section because
       thats how they find it"). */
    sets: [
      /* ⭐ DECLARED 2026-08-31. Everything that puts a number ON a customer, which is what
         a bin gets labelled with — two houses wearing one label is the mistake this field
         exists to prevent. */
      { file: 'admin', el: 'routeAddressForm', where: 'Customers › Add a Customer', when: 'a customer is typed in',
        rules: ['A number is taken from the pool, never invented — and the series follows the bin count.'] },
      { file: 'admin', el: 'rbImportBtn', where: 'Customers › Bulk Updates', when: 'the raw importer writes a row' },
      { file: 'admin', el: 'rbFixNumbersBtn', where: 'Customers › Bulk Updates', when: 'the sheet\'s numbers are pushed onto the records',
        rules: ['The office controls the numbers, so the sheet wins here — but a collision must be refused rather than resolved.'] },
      { file: 'admin', el: 'whAddExtraBtn', where: 'Warehouse › Build', when: 'buffer stock is added',
        rules: ['Buffer stock belongs to nobody, so it carries no customer number of its own.'] },
      { file: 'admin', el: 'cnAssignBtn', where: 'Customer Numbers', when: 'a number is handed out' },
      { file: 'admin', el: 'cnBulkAssignBtn', where: 'Customer Numbers', when: 'numbers are assigned in bulk' },
      { file: 'admin', el: 'editCustSaveBtn', where: 'Customers › All Customers', when: 'a customer is saved',
        rules: ['Crossing 260 ft moves them to the 5000 series, and the office is told which number changed.'] },
      { file: 'admin', fn: 'rbApplyTickedAdds', where: 'Customers › Bulk Updates', when: 'the master sheet adds somebody' }
    ],
    reads: [
      /* ⭐ THE READERS THAT DECIDE SOMETHING, declared 2026-08-31 — as opposed to the
         several dozen that print it, which are excluded below with the reason. */
      { file: 'admin', fn: 'cnNumberIsHeld', where: 'Customer Numbers', when: 'the pool is asked whether a number is free',
        rules: ['A number somebody still holds is not available, however the pool was told otherwise — the list and the next-number picker must read one rule.'] },
      { file: 'admin', fn: 'cnHighestAssigned', where: 'Customer Numbers', when: 'the next number is worked out' },
      { file: 'admin', fn: 'hlxRemoveCustomerToRecycle', where: 'Warehouse › Recycle', when: 'a customer is archived',
        rules: ['Their number goes back to the pool with its series, or it is lost to everybody.'] },
      { file: 'admin', fn: 'whFindCustomerByLabel', where: 'Warehouse › Recycle', when: 'somebody looks up the house a bin belongs to',
        rules: ['The number painted on the box is not always the number on the record — a move leaves the old label standing.'] },
      { file: 'admin', fn: 'whBinNumberMoved', where: 'Warehouse › Recycle', when: 'the queue asks which number to look for' },
      { file: 'admin', fn: 'findExistingAddressMatch', where: 'Customers › Bulk Updates', when: 'an import decides whether this row is somebody we have',
        rules: ['A failed match writes a duplicate — this is the path that duplicated the whole book once.'] },
      { file: 'admin', fn: 'rebuildCustomerIndexes', where: 'Customers › All Customers', when: 'the lookup indexes are rebuilt' },
      { file: 'admin', fn: 'noticeCustomerNumberStuck', where: 'Customer Numbers', when: 'a number cannot be released' },
      { file: 'admin', fn: 'requoteOnFile', where: 'Quote Requests', when: 'a re-quote card shows what the house already has',
        rules: ['Read live off the customer, because the copy on the quote can only ever be blank when the portal raised it.'] },
      { file: 'server', fn: 'payerSort', where: 'Invoices › Nightly Automation', when: 'the payer on a shared bill is chosen',
        rules: ['The lowest customer number wins — the longest-standing account, and the same answer however the houses arrive.'] },
      { file: 'admin', fn: 'cnBulkAnalyze', where: 'Customer Numbers', when: 'Assign in Bulk dry-runs',
        rules: ['The dry run is what makes a 960-row assignment safe, so it has to read exactly what the real run would.'] },
      { file: 'admin', el: 'cnFindConflictsBtn', where: 'Customer Numbers', when: 'the office looks for two houses on one number',
        rules: ['Two records on one number is two bins wearing one label.'] },
      { file: 'admin', el: 'cnFindGapsBtn', where: 'Customer Numbers', when: 'the office looks for numbers nobody holds' },
      { file: 'admin', fn: 'findDuplicateCustomers', where: 'Customers › All Customers', when: 'duplicates are grouped',
        rules: ['The number groups them, but a name that disagrees outranks it — a collision would delete a customer silently.'] },
      { file: 'admin', fn: 'houseFromCustomer', where: 'Schedule › Scheduling', when: 'a customer is turned into a house on the plan' },
      { file: 'admin', fn: 'billingGroupMatches', where: 'Customers › Who Pays for Whom', when: 'the who-pays list is searched' },
      { file: 'admin', fn: 'bulkFindCustomer', where: 'Customers › Bulk Updates', when: 'an import row is matched to a customer' },
      { file: 'admin', fn: 'hcRunChecks', where: 'Customers › All Customers', when: 'the health check runs' },
      { file: 'admin', fn: 'archRender', where: 'Warehouse › Recycle', when: 'the archive is drawn' },
      { file: 'admin', fn: 'wireWhFind', where: 'Warehouse › Build', when: 'the warehouse search box looks a house up' },
      { file: 'admin', fn: 'whExtraSync', where: 'Warehouse › Build', when: 'buffer stock is matched to a house' },
      { file: 'admin', fn: 'editCustRenderHouseTabs', where: 'Customers › All Customers', when: 'the house tabs on one bill are drawn' },
      { file: 'admin', fn: 'openEditCustomerModal', where: 'Customers › All Customers', when: 'a record is opened for editing' },
      { file: 'admin', fn: 'rmPushToCustomer', where: 'Quote Requests', when: 'a measurement is pushed onto the customer' },
      { file: 'admin', el: 'editCustDeleteBtn', where: 'Customers › All Customers', when: 'a customer is deleted',
        rules: ['Their number has to be released, or it is held by nobody and handed to nobody.'] },
      { file: 'admin', el: 'editCustRecycleStayBtn', where: 'Customers › All Customers', when: 'their old set is asked back but they stay',
        rules: ['They still hold the number — pooling it here would hand a live label to somebody new.'] },
      { file: 'admin', el: 'deleteAllAddressesBtn', where: 'Customers › All Customers', when: 'Delete All Customers runs' },
      { file: 'admin', fn: 'whBinNumberFor', where: 'Warehouse › Recycle', when: 'somebody is sent to fetch a bin',
        rules: ['This asks what the BIN says, which is not always what the record says.'] },
      { file: 'admin', fn: 'payerHouseOf', where: 'Customers › Who Pays for Whom', when: 'a shared bill picks a name',
        rules: ['The lowest customer number pays — the longest-standing account.'] },
      { file: 'admin', fn: 'whWhoLabel', where: 'Warehouse › Build', when: 'a build row is named' },
      { file: 'admin', fn: 'customerToStop', where: 'Routes › Install', when: 'a house is frozen onto a route' }
    ]
  },
];


module.exports.NOT_WATCHED = NOT_WATCHED;
