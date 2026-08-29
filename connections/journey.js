/* THE PATH A CUSTOMER TAKES — clickable, and branching.
 * ====================================================
 * Addie, 2026-08-29, having described the whole chain in one paragraph and then said what
 * it was for: "my example was just meant so we could figure out how to do Were things go
 * differently". Then the shape she wanted: "I was thinking we push on quotes than approve
 * and it will show the different routes in can go from there. So we can figure out the
 * different navigations by clicking on how things can go. So for example Quote, Sent
 * email, pending, send nudge, they approve, decide they want lights on mult. places on
 * house we requote. Then a different route is quote, send email, approve, convert to
 * costumer".
 *
 * So it is a GRAPH you walk, not a list you read. You start at the beginning, and every
 * step offers the things that can happen next; clicking one takes you there and keeps the
 * trail behind you. Two routes out of the same step is the normal case, not the exception,
 * which is exactly what a grid of field × destination could never show.
 *
 * ⚠ THE GRID IS NOT REPLACED, IT IS PUT UNDERNEATH. Each step names the fields that RECORD
 * it, and those are the same fields the manifest already declares — so clicking a step
 * still gets you to "who writes this and who reads it", one level in, where it always was.
 * What changes is that you arrive there through the journey rather than down a list.
 *
 * ⚠ HAND-WRITTEN, LIKE THE MANIFEST, AND FOR THE SAME REASON. The code can say what it
 * DOES; it cannot say what order it was meant to happen in. Only a person knows that this
 * step comes after that one. What IS checked mechanically: every edge points at a real
 * step, every step is reachable, and every dated step of the path appears here — so the
 * graph cannot quietly stop describing the system.
 *
 * ⚠ A STEP THAT IS NOT BUILT SAYS SO. The two payment chases are Addie's own spec and only
 * one of them exists today; drawing them as though they ran would make this page a wish
 * rather than a map, and the whole value of it is that it is true.
 */
'use strict';

/* ⭐ `records` NAMES THE FIELD, and it is what ties this page to the other one. A step with
   no field is a real thing that happens and leaves no trace — worth seeing, and marked
   rather than hidden, because "we do this and never write it down" is a finding. */
const STEPS = [
  { id: 'quote', title: 'A quote comes in', start: true,
    plain: 'Somebody asks for a price, through the website form or typed in by the office.',
    records: ['createdAt'],
    next: [{ to: 'emailed', label: 'we price it and send it' }] },

  /* ⚠ A QUOTE IS NOT THE ONLY DOOR, and drawing it as the only one was the first thing
     Addie asked about ("you are currently adding all routes... Right?"). Somebody typed
     into Add a Customer, or arriving through the master sheet, has no quote, no email and
     no approval — they join at "converted" and skip the first six steps entirely. A map
     with one way in quietly claims everybody came through it. */
  { id: 'addedbyhand', title: 'Typed in by the office', start: true,
    plain: 'Added straight into Add a Customer — somebody who rang up, or a job taken in ' +
      'person. There is no quote, so nothing was emailed and nothing was approved.',
    next: [{ to: 'converted', label: 'they are a customer from the moment they are saved' }] },

  { id: 'imported', title: 'Arrived from the master sheet', start: true,
    plain: 'Brought in by Bulk Updates or the sheet sync. Hundreds at a time, and the same ' +
      'as above from here on — no quote, no email, no approval.',
    next: [{ to: 'converted', label: 'the import creates their record' }] },

  { id: 'emailed', title: 'Quote emailed to them',
    plain: 'The price goes out with three buttons on it — approve, not right now, back next year.',
    records: ['quoteSentAt'],
    next: [{ to: 'pending', label: 'and we wait' }] },

  { id: 'pending', title: 'Waiting on them',
    plain: 'Nobody has pressed anything yet.',
    next: [
      { to: 'nudged',       label: 'they go quiet, so we nudge' },
      { to: 'approved',     label: 'they approve' },
      { to: 'declined',     label: 'they say not right now' },
      { to: 'backnextyear', label: 'they say back next year' },
      { to: 'approved',     label: 'we mark it approved for them, on the phone' }
    ] },

  { id: 'nudged', title: 'Nudge sent',
    plain: 'The automatic reminder to anyone who has not answered. Runs nightly, stops on 1 November.',
    next: [
      { to: 'pending',      label: 'still nothing' },
      { to: 'approved',     label: 'they approve' },
      { to: 'declined',     label: 'they say not right now' },
      { to: 'backnextyear', label: 'they say back next year' }
    ] },

  { id: 'declined', title: 'Not right now', end: true,
    plain: 'They have said no to this quote. It is not a no to the season.' },

  { id: 'backnextyear', title: 'Back next year',
    plain: 'Out for this season and on the Contact 2027 list. No routes, no build, no bill — ' +
      'and their bin stays made up.',
    records: ['rsvpRespondedAt'],
    next: [{ to: 'quote', label: 'and next season we ask them again' }] },

  { id: 'approved', title: 'They approve',
    plain: 'The price is agreed. What happens next depends on whether they are already a customer.',
    records: ['approvedByOfficeAt'],
    next: [
      { to: 'form',         label: 'they are new, so they fill in the details form' },
      { to: 'memberchange', label: 'they are already a customer' }
    ] },

  { id: 'form', title: 'They fill in the details form',
    plain: 'Colours, wire, timer, gate code, sides of the house — everything we need to build it. ' +
      'Only a customer we have not converted yet sees this.',
    next: [{ to: 'converted', label: 'it comes back to us and we convert them' }] },

  /* ⭐ THE BIGGEST SINGLE OMISSION, added 2026-08-29. A customer can ask to be let out of
   * the season from their own portal — a Cancel tab of its own, which sets
   * `seasonStatus: 'cancellation_requested'`, queues a recycle, and pulls them off every
   * upcoming route. It is a different door out from declining a quote and from answering
   * the RSVP no, and the graph had no node for it at all.
   * ⚠ AND UNTIL THIS WEEK IT HAD NO DATE, so the office queue could not be sorted by how
   * long anybody had been waiting — a request made in October read exactly like one made
   * this morning, with a crew still notionally coming to the house either way. */
  { id: 'cancelrequest', title: 'They ask to cancel',
    plain: 'Asked through the Cancel tab of their own portal. Their old set is queued to ' +
      'come back and they come off every upcoming route straight away — but they are still ' +
      'a customer until somebody in the office acts on it.',
    records: ['seasonStatusAt'],
    next: [
      { to: 'recycled', label: 'the office lets them out and their set comes back' },
      { to: 'scheduled', label: 'they change their mind before anybody acts on it' }
    ] },

  { id: 'memberchange', title: 'Asked what is changing',
    plain: 'An existing customer is asked "do you want anything changed with your lights this ' +
      'year?" rather than the form — we already hold their colours and wire.',
    next: [
      { to: 'requote',   label: 'they want more of the house lit' },
      { to: 'moved',     label: 'they have moved house' },
      { to: 'converted', label: 'nothing changes, they carry on' }
    ] },

  /* ⚠ MOVING IS NOT AN ORDINARY RE-QUOTE. The old set comes back AND a new one is built,
     the address is re-geocoded, and any route stop already saved points at the wrong
     house. Drawn as a plain re-quote the page would hide the half that costs money. */
  { id: 'moved', title: 'They have moved house',
    plain: 'A new roofline, so a new price — and their old set has to come back before a ' +
      'new one is built. They stay a customer and keep their number.',
    records: ['requoteKind'],
    next: [
      { to: 'requote',  label: 'we re-quote the new house' },
      { to: 'recycled', label: 'and their old set is asked back' }
    ] },

  { id: 'requote', title: 'Re-quote raised',
    plain: 'More feet, a new address, or just a corrected price. It is a quote of its own, ' +
      'filed under Re-quotes, and it goes back round the same loop.',
    records: ['requoteAppliedAt'],
    next: [{ to: 'emailed', label: 'we price the change and send it' }] },

  { id: 'converted', title: 'Converted to a customer',
    plain: 'They get a record, a customer number, and a bin.',
    records: ['convertedToCustomerAt'],
    next: [{ to: 'queued', label: 'and their lights are ordered from the warehouse' }] },

  { id: 'queued', title: 'Sent to the warehouse',
    plain: 'Their bundle is on the build list.',
    records: ['lightsQueuedAt'],
    next: [{ to: 'built', label: 'the warehouse makes it' }] },

  { id: 'built', title: 'Bundle built',
    plain: 'The lights for that house exist and are in their bin.',
    records: ['lightsMarkedBuiltAt'],
    next: [{ to: 'scheduled', label: 'now they can be scheduled' }] },

  { id: 'scheduled', title: 'On the schedule',
    plain: 'They are in the season and waiting for a day. Nobody reaches here until their ' +
      'bundle is built.',
    records: ['needsDayAssignedAt'],
    next: [
      { to: 'assigned', label: 'a day is picked and a crew takes them' },
      { to: 'cancelrequest', label: 'they ask to cancel through their portal' }
    ] },

  { id: 'assigned', title: 'On a crew sheet',
    plain: 'A named crew, on a named day. This is when the booking was made, not the day ' +
      'they are booked for.',
    records: ['assignedCrewAt'],
    next: [{ to: 'hung', label: 'the crew hangs them' }] },

  { id: 'hung', title: 'Lights up',
    plain: 'Marked complete. This is what makes them billable.',
    records: ['completedAt'],
    next: [
      { to: 'invoiced', label: 'the 7pm run bills them that night' },
      { to: 'fixraised', label: 'something is wrong with them' }
    ] },

  { id: 'fixraised', title: 'Fault reported',
    plain: 'A strand out, a fallen run. They go on a fixer route.',
    records: ['fixRaisedAt'],
    next: [{ to: 'fixdone', label: 'somebody goes and mends it' }] },

  { id: 'fixdone', title: 'Fault mended',
    plain: 'Off the fix list. Their bill is untouched — a fix is not a charge.',
    records: ['fixDoneAt'],
    next: [{ to: 'invoiced', label: 'billing carries on as normal' }] },

  { id: 'invoiced', title: 'Invoice sent',
    plain: 'The nightly run at 7pm bills every house marked done that has not been billed yet.',
    records: ['invoicedAt'],
    next: [
      { to: 'paid',     label: 'they pay it all' },
      { to: 'partpaid', label: 'they pay some of it' },
      { to: 'chase1',   label: '30 days pass and nothing has come in' }
    ] },

  /* ⚠ PART PAID IS NOT PAID AND NOT UNPAID, and the difference reaches the money: the
     late fee is $25 for somebody who has paid something and $40 for somebody who has
     paid nothing. Folded into "paid" the page would lose the distinction the fee turns on. */
  { id: 'partpaid', title: 'Paid part of it',
    plain: 'Money has come in and a balance is left. They still show as owing.',
    next: [
      { to: 'paid',   label: 'they pay the rest' },
      { to: 'chase1', label: '30 days pass and the rest has not come in' }
    ] },

  /* ⚠ ADDIE'S OWN SPEC, 2026-08-29, AND ONLY THE SHAPE OF IT EXISTS TODAY: "a text 30
     days after we send them invoice and they didn't pay or only partial pay and than
     after another 30 days we should send an email with a fee asking them to pay again.
     The text should notify us when we need to send that. The last email with a fee should
     automatically send with new invoice."
     ⚠ NEITHER IS BUILT. Two things run on a schedule — the 7pm invoice and the quote
     nudge, which chases an unanswered QUOTE, not an unpaid bill. Chasing a bill is a
     manual send from Automation Emails today. Drawn as built, this page would be a wish. */
  { id: 'chase1', title: 'Text them — 30 days', built: false,
    plain: 'A text asking them to pay. The system tells the office when one is due; ' +
      'a person sends it.',
    next: [
      { to: 'paid',   label: 'they pay' },
      { to: 'chase2', label: 'another 30 days pass' }
    ] },

  { id: 'chase2', title: 'Email them with a fee — 60 days', built: false,
    plain: 'Sends by itself, with a new invoice carrying the late fee. The rule is already ' +
      'written down: $25 if they have paid something, $40 if they have paid nothing.',
    next: [{ to: 'paid', label: 'they pay' }] },

  { id: 'paid', title: 'Paid',
    plain: 'The bill is settled. Their part of the season is over.',
    records: ['newMemberFeeAppliedAt'],
    next: [{ to: 'takedown', label: 'and after Christmas the lights come down' }] },

  { id: 'takedown', title: 'Lights taken down',
    plain: 'Removal is included in the price — taking them down is never a charge.',
    records: ['removalDoneAt'],
    next: [
      { to: 'recycled', label: 'their set comes back to the warehouse' },
      { to: 'done',     label: 'they keep their bin for next year' }
    ] },

  { id: 'recycled', title: 'Old set asked back', end: true,
    plain: 'Their bundle is pulled apart and the number goes back in the pool when they leave.',
    records: ['lightsRecycleRequestedAt'] },

  { id: 'done', title: 'Season over',
    plain: 'Their bin stays made up.',
    next: [{ to: 'rsvpasked', label: 'and next season we ask if they want lights again' }] },

  /* ⚠ THE RSVP IS A DIFFERENT NO FROM A DECLINED QUOTE, and this is where it lives.
     Declining a quote is "not at this price"; answering no here is "not this year at all",
     and it takes them off every route, the build queue and the bill. */
  { id: 'rsvpasked', title: 'Asked again next season',
    plain: 'The RSVP goes out. Only somebody who answers is scheduled — nobody is carried ' +
      'into the season on last year’s yes.',
    next: [
      { to: 'queued',       label: 'they say yes' },
      { to: 'rsvpno',       label: 'they say no' },
      { to: 'backnextyear', label: 'they say back next year' },
      { to: 'unanswered',   label: 'they never answer' }
    ] },

  { id: 'rsvpno', title: 'No this year', end: true,
    plain: 'Out of the season. Their old set is asked back and their number returns to the ' +
      'pool when they are removed.',
    records: ['rsvpRespondedAt'] },

  /* ⚠ NEVER ANSWERING IS ITS OWN OUTCOME, not a kind of no. It is the one the office has
     to act on, and the only one nobody chose. */
  { id: 'unanswered', title: 'Never answered', end: true,
    plain: 'Not scheduled, because only an answer counts — but nobody has said no either, ' +
      'so they are still worth ringing.' }
];

module.exports = { STEPS };
