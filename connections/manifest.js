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
  ['measuredFeet', 'the footage that decides bins, number series and bundle count'],
  ['difficulty', 'the easy / medium / hard grade'],
  ['quotePhotos → housePhotos', 'the pictures that reach a crew sheet'],
  ['gateCode', 'how a crew gets in'],
  ['outletTimer', 'whether a house asked for a timer'],
  ['rsvpStatus / rsvpRespondedAt', 'who answered, and what they said'],
  ['maybeNextYear / isOutForSeason', 'who is in the season at all'],
  ['lightsLockedUntil', 'the 48-hour route lock and free-change window']
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

  {
    field: 'needsLightRecycle',
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
      { file: 'server', fn: 'portalRsvp', where: 'Member Portal › RSVP', when: 'a customer answers no',
        rules: ['Answering through the link and the office button must agree.'] },
      { file: 'server', fn: 'seasonYesUpdates', where: 'Member Portal › RSVP', when: 'somebody says yes',
        rules: ['Saying yes again cancels a queued recycle.'] }
    ],
    reads: [
      { file: 'admin', fn: 'whRecycleGroups', where: 'Warehouse › Recycle', when: 'the queue is drawn' },
      { file: 'admin', fn: 'printRecycleList', where: 'Schedule › Printing', when: 'the sheet prints' },
      { file: 'admin', fn: 'isOutForSeason', where: 'Schedule › Scheduling', when: 'anything asks who is in the season',
        rules: ['A house queued for recycle is out of the season. Somebody who moved is not.'] }
    ]
  },

  {
    field: 'completed',
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
    ignore: ['^(stopProblem|renderRouteOrderedList|renderRouteAddressList|runGenerateInstallRoute|findNearbyMissedHouses|nextVisitFor|visitBadgeType|renderTakedownsList|reconcileUpcomingRoutes|renderOverviewMap|isOctoberUrgent|isNewHangUrgent|isBeforeThanksgivingUrgent|derivedDoneFor|houseBillingRow)$'],
    sets: [
      { file: 'admin', fn: 'planTickCustomer', where: 'Schedule › Scheduling', when: 'one house is marked done',
        rules: ['Ticking one stop marks that one customer, never the whole day.'] },
      { file: 'admin', near: 'const HLX_DONE_KINDS', where: 'Routes › Install', when: 'any of five doors marks a job done',
        rules: ['Install, takedown and fix are separate. One never implies another.'] }
    ],
    reads: [
      { file: 'server', fn: 'runInvoiceBatch', where: 'Invoices › Nightly Automation', when: '7 PM Mountain',
        rules: ['A shared bill waits for every house on it.'] },
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
    title: 'The £30 colour-change fee',
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
    title: 'The £30 join fee',
    plain: 'Charged once, to somebody who joined this year through a quote.',
    guard: 'run-all.js has 63 checks, and season-state.test.js touches it — the every-season overcharge is specifically guarded.',
    states: [
      ['Joined through a quote this year', 'Charged once'],
      ['Added by an import', 'Never charged — it is not set by bulk'],
      ['A new member who also changes colours late', 'Pays both fees, £60'],
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
  }
];

module.exports.NOT_WATCHED = NOT_WATCHED;
