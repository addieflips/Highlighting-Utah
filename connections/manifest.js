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
    title: 'Does this house need a bundle made?',
    plain: 'Set when a house needs lights built. Cleared by the warehouse pressing Mark Done.',
    /* Route and plan documents carry a needsLightBuild of their own in fixtures and
       exports; those are not the customer record. Narrowed so amber stays readable. */
    ignore: ['^hlxRowXml$'],
    sets: [
      { file: 'admin', near: 'needsGeocode: pinFailed', where: 'Customers › Add a Customer', when: 'a customer is created',
        rules: ['Every new house is flagged, colours or no colours.'] },
      { file: 'admin', fn: 'rbApplyTickedAdds', where: 'Customers › Bulk Updates › Sync', when: 'the sheet adds a house',
        rules: ['Ungated — questions map WH-20.'] },
      { file: 'admin', el: 'rbImportBtn', where: 'Customers › Bulk Updates', when: 'the raw importer adds a house',
        rules: ['Add branch only. The update branch must never re-queue — WH-21.'] },
      { file: 'admin', el: 'ibImportBtn', where: 'Invoices › Import / Export', when: 'the invoice importer adds a house',
        rules: ['Carries no colours, so these land in the blocked block by design.'] },
      { file: 'admin', el: 'editCustBuildStayBtn', where: 'Edit Customer', when: 'Build Them A New Set is pressed',
        rules: ['Must NOT also set the recycle flag — the two buttons were split on purpose.'] },
      { file: 'admin', near: 'if(warehouseRebuildFields(item.data, addrUpdates).length)', where: 'Edit Customer › Save', when: 'the wire or timer changed',
        rules: ['Only ever turns the flag ON.'] },
      { file: 'server', fn: 'seasonYesUpdates', where: 'RSVP / quote approval', when: 'somebody rejoins after a recycle',
        rules: ['Re-queues only when a recycle actually happened.'] }
    ],
    reads: [
      { file: 'admin', fn: 'whBuildQueueGroups', where: 'Warehouse › build queue', when: 'the queue is drawn',
        rules: ['A flagged house with no colours goes to the blocked block, never dropped — WH-18.'] },
      { file: 'admin', fn: 'printNeedsBuildList', where: 'Printing › Needs Building', when: 'the sheet prints',
        rules: ['Must list the same people as the Warehouse tab.'] },
      { file: 'admin', fn: 'computeColorDemand', where: 'Warehouse › colour totals', when: 'bulbs are ordered',
        rules: ['The costly reader. A phantom house here means glass ordered for nobody.'] },
      { file: 'admin', fn: 'computePendingHouseCount', where: 'Warehouse › pending count', when: 'the tab header is drawn' },
      { file: 'admin', fn: 'whHouseBuildStatus', where: 'Warehouse › ask about one house', when: 'the office searches a name' }
    ]
  },

  {
    field: 'needsLightRecycle',
    title: 'Does this house have a bundle to fetch back?',
    plain: 'Set when lights need collecting. Cleared by Mark Recycled, or by rejoining the season.',
    sets: [
      { file: 'admin', el: 'editCustRecycleStayBtn', where: 'Edit Customer', when: 'Recycle Their Old Set is pressed',
        rules: ['Must NOT also set the build flag.'] },
      { file: 'admin', near: 'addrUpdates.needsLightRecycle', where: 'Edit Customer › Save', when: 'the RSVP answer changes' },
      { file: 'server', fn: 'portalRsvp', where: 'Member Portal › RSVP', when: 'a customer answers no',
        rules: ['The status alone is written by the portal — the flag half is why isOutForSeason reads both.'] },
      { file: 'server', fn: 'seasonYesUpdates', where: 'RSVP / quote approval', when: 'somebody says yes',
        rules: ['Cancels a queued recycle. Must not clobber a re-quote that set it deliberately.'] }
    ],
    reads: [
      { file: 'admin', fn: 'whRecycleGroups', where: 'Warehouse › recycle queue', when: 'the queue is drawn' },
      { file: 'admin', fn: 'printRecycleList', where: 'Printing › Recycle sheet', when: 'the sheet prints' },
      { file: 'admin', fn: 'isOutForSeason', where: 'everywhere', when: 'anything asks who is in the season',
        rules: ['A house queued for recycle is out. A mover (recycleKeepingCustomer) is not.'] }
    ]
  },

  {
    field: 'completed',
    title: 'Has the crew hung this house?',
    plain: 'The customer-record fact the nightly invoice run bills on. Not the plan flag.',
    /* ⚠ NARROWED, AND THIS IS THE DIFFERENCE BETWEEN A USEFUL AMBER AND NOISE. Route
       stops, plan days and schedule rows all carry a `completed` of their own — the
       prototype returned 28 undeclared touches for this field, nearly all of them that.
       Narrowing to the customer-record readers is what keeps amber worth reading. */
    ignore: ['^(stopProblem|renderRouteOrderedList|renderRouteAddressList|runGenerateInstallRoute|findNearbyMissedHouses|nextVisitFor|visitBadgeType|renderTakedownsList|reconcileUpcomingRoutes|renderOverviewMap|isOctoberUrgent|isNewHangUrgent|isBeforeThanksgivingUrgent|derivedDoneFor|houseBillingRow)$'],
    sets: [
      { file: 'admin', fn: 'planTickCustomer', where: 'Schedule › tick a stop', when: 'one house is marked done',
        rules: ['Ticking ONE stop marks that customer complete. It is what makes the nightly run bill them.'] },
      { file: 'admin', near: 'const HLX_DONE_KINDS', where: 'the one done-marker', when: 'any of five doors marks a job done',
        rules: ['Install, takedown and fix are independent. None may nest under another.'] }
    ],
    reads: [
      { file: 'server', fn: 'runInvoiceBatch', where: 'Nightly invoicing', when: '7 PM Mountain',
        rules: ['A multi-house bill waits until every house on it is completed.'] },
      { file: 'server', fn: 'houseIsOnTheBillServer', where: 'Nightly invoicing', when: 'deciding who is on a bill',
        rules: ['completed is tested FIRST, ahead of every status. Hung is hung — Q-013.'] },
      { file: 'admin', fn: 'houseIsOnTheBill', where: 'Invoices', when: 'deciding who is on a bill',
        rules: ['Must give the same answer as the server copy. money-parity sweeps both.'] },
      { file: 'admin', fn: 'allCustRouteStatus', where: 'All Customers › Route Status filter', when: 'the Install Complete filter runs',
        rules: ['This is the reader the original brief could not locate.'] },
      { file: 'admin', fn: 'etRenderRecipientList', where: 'Automation Emails', when: 'an audience is counted' }
    ]
  }
];
