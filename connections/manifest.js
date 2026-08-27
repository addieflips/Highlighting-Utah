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
  }
];
