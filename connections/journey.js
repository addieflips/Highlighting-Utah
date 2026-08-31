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
    /* ⚠ `createdAt` IS THE ONLY DATE THESE PEOPLE HAVE AT THE START, which is why it is
     * named here as well as on the quote. Somebody who arrived without a quote has no
     * quote-raised day and no approval day — their record simply exists from a moment, and
     * until 2026-08-29 the history read this field off the QUOTE alone, so that moment was
     * invisible for most of the book. */
    records: ['createdAt'],
    next: [{ to: 'converted', label: 'they are a customer from the moment they are saved' }] },

  { id: 'imported', title: 'Arrived from the master sheet', start: true,
    plain: 'Brought in by Bulk Updates or the sheet sync. Hundreds at a time, and the same ' +
      'as above from here on — no quote, no email, no approval.',
    records: ['createdAt'],
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
    records: ['quoteLastNudgedAt'],
    next: [
      { to: 'pending',      label: 'still nothing' },
      { to: 'approved',     label: 'they approve' },
      { to: 'declined',     label: 'they say not right now' },
      { to: 'backnextyear', label: 'they say back next year' }
    ] },

  /* ⚠ IT WAS DRAWN AS AN ENDING AND IT IS NOT ONE. Declining a re-quote asks the customer
   * about last year rather than closing anything: `declineAsksAboutLastYear` sets
   * `askSameAsLastYear`, marks their changes settled, and they keep their route, their
   * build and their place in the season. A page that stopped here would say a no to a
   * price is a no to the season, which is the opposite of what the code does. */
  { id: 'declined', title: 'Not right now',
    plain: 'They have said no to THIS QUOTE. It is not a no to the season — an existing ' +
      'customer who declines keeps their route, their build and their place.',
    /* ⚠ A DECLINE IS DATED BY THE SAME TWO FIELDS AS AN APPROVAL, and it is worth naming
     * here rather than leaving the page looking as though only a yes gets recorded:
     * `quoteRespond` stamps `approvalRespondedAt` alongside the status BEFORE it branches
     * on the action, so approve, decline and maybe all carry it. `quoteRespondedAt` is the
     * office recording an answer it was told — which of the two happened is the question
     * behind every argument about a quote, and it applies to a no as much as a yes. */
    records: ['approvalRespondedAt', 'quoteRespondedAt'],
    next: [
      { to: 'asklastyear', label: 'they are already a customer, so we ask about last year' },
      { to: 'addondeclined', label: 'it was only an add-on they turned down' },
      { to: 'nolead', label: 'they were never a customer, so that is the end of it' }
    ] },

  { id: 'asklastyear', title: 'Asked if they want the same as last year',
    plain: 'A no to a new price is not a no to lights. Their changes are marked settled ' +
      'and the office is asked to check whether they want what they had.',
    records: ['askSameAsLastYearAt'],
    next: [
      { to: 'scheduled', label: 'yes, the same again' },
      { to: 'rsvpasked', label: 'we leave it to the RSVP' }
    ] },

  /* ⚠ A NO THAT IS NOT A NO. Turning down an add-on leaves everything else exactly as it
   * was — and the code's own comment records that it leaves no other trace anywhere,
   * which is why it is worth a step of its own rather than being folded into declined. */
  { id: 'addondeclined', title: 'They turned down the add-on only',
    plain: 'They said no to the extra, not to their lights. Nothing else changes and their ' +
      'season carries on exactly as it was.',
    next: [{ to: 'scheduled', label: 'and their own house carries on as normal' }] },

  { id: 'nolead', title: 'That is the end of it', end: true,
    plain: 'Somebody who was never a customer said no to a price. Nothing else was in ' +
      'flight, so nothing else changes.' },

  { id: 'backnextyear', title: 'Back next year',
    plain: 'Out for this season and on the Contact 2027 list. No routes, no build, no bill — ' +
      'and their bin stays made up.',
    /* ⚠ TWO WAYS OF BEING OUT, AND THEY DISAGREE OFTEN. `rsvpRespondedAt` is what the
     * customer answered through the link; `maybeNextYearAt` is the badge the office raised,
     * usually from a conversation. Which of the two happened is exactly what somebody is
     * asking when they open the record. */
    records: ['rsvpRespondedAt', 'maybeNextYearAt'],
    /* ⚠ IT FORKS, AND IT USED TO GO ONLY TO `quote`. Somebody who is ALREADY a customer
       and says back next year is still a customer — next season they get the RSVP with
       everybody else, not a fresh quote, and drawing it the old way sent a returning
       customer round the whole first-season path again. A LEAD who says it was never
       converted, so for them a new quote really is the next thing. Two different people
       in one step, which is exactly the kind of branch this page is for. */
    next: [
      { to: 'rsvpasked', label: 'they are already a customer, so next season they get the RSVP' },
      { to: 'quote',     label: 'they were only ever a lead, so next season we quote them again' }
    ] },

  { id: 'approved', title: 'They approve',
    plain: 'The price is agreed. What happens next depends on whether they are already a customer. ' +
      'Three different things can record it: the office marking it approved, the customer ' +
      'pressing the button in their own email, and the office typing in an answer given on ' +
      'the phone — and which of the three happened is the question behind every argument ' +
      'about a quote.',
    /* ⚠ THREE FIELDS, THREE ACTORS. `approvedByOfficeAt` is the office deciding,
     * `approvalRespondedAt` is the customer pressing the button in their email, and
     * `quoteRespondedAt` is the office recording an answer it was told. Collapsing them
     * would leave the page unable to say whether they actually replied. */
    records: ['approvedByOfficeAt', 'approvalRespondedAt', 'quoteRespondedAt'],
    next: [
      { to: 'form',         label: 'they are new, so they fill in the details form' },
      { to: 'memberchange', label: 'they are already a customer' }
    ] },

  { id: 'form', title: 'They fill in the details form',
    records: ['formCompletedAt'],
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
      { to: 'colourchange', label: 'they want different colours or a different wire' },
      { to: 'requote',   label: 'they want more of the house lit' },
      { to: 'moved',     label: 'they have moved house' },
      { to: 'converted', label: 'nothing changes, they carry on' }
    ] },

  /* ⭐ THE COMMONEST CHANGE OF ALL, AND THE PAGE DID NOT HAVE IT (added 2026-08-29).
   * Addie's list of what she wanted dated opened with "asked for different lights on this
   * date" — and `lightsChangedAt` was written in three places, read by the Color Changes
   * tab and the warehouse badge, and drawn on no path anywhere. A field written everywhere
   * and named on no route is the exact shape of hole these censuses exist to catch, and it
   * stayed invisible because nothing was ever red about it.
   *
   * ⚠ IT IS NOT `changedafter`, WHICH IS THE LATE ONE. Both are somebody picking different
   * colours; the difference is whether a crew is already holding a printed card for the old
   * pattern. Drawing only the late one, as the page did, makes the ordinary case look like
   * an emergency and hides the fee question entirely.
   *
   * ⚠ AND THE MONEY IS THE REASON IT NEEDS ITS OWN BOX. Inside the 48-hour window a change
   * is free; outside it, it is $30 — the fee has its own field, its own note and its own
   * parity test, and it is the one thing a customer asks about afterwards. A route drawn
   * straight from "they want changes" to "sent to the warehouse" says nothing about it. */
  { id: 'colourchange', title: 'They ask for different lights',
    plain: 'New colours, or a new wire. A new bundle has to be made, and outside their ' +
      '48-hour window there is a $30 change fee. The record keeps whether they did it ' +
      'themselves in their portal or the office typed it in after a call.',
    records: ['lightsChangedAt'],
    next: [
      { to: 'queued', label: 'a new bundle is made for the new colours' },
      { to: 'invoiced', label: 'and outside the 48-hour window a $30 fee goes on the bill' }
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
    /* ⚠ RAISED AND APPLIED ARE DIFFERENT DAYS. `requotedAt` is the day the office decided
     * the price had to change; `requoteAppliedAt` is the day the customer agreed and it
     * landed on their record. A re-quote sitting between the two for three weeks is exactly
     * what somebody is looking for. */
    records: ['requotedAt', 'requoteAppliedAt'],
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
      /* ⚠ A CHANGE MADE HERE IS STILL THE ORDINARY ONE. Nobody is holding a card for this
         house yet, so it is `colourchange` and not `changedafter` — the crew-sheet step
         below is where that stops being true, and drawing both from one place would lose
         the only difference between them. */
      { to: 'colourchange', label: 'they change their mind about the colours' },
      { to: 'cancelrequest', label: 'they ask to cancel through their portal' }
    ] },

  { id: 'assigned', title: 'On a crew sheet',
    plain: 'A named crew, on a named day. This is when the booking was made, not the day ' +
      'they are booked for.',
    records: ['assignedCrewAt'],
    next: [
      { to: 'hung', label: 'the crew hangs them' },
      { to: 'changedafter', label: 'they change their colours after the crew has the card' }
    ] },

  /* ⚠ THE CREW IS HOLDING A CARD THAT NO LONGER MATCHES THE HOUSE. Changing colours after
   * the booking sets `lightsChangedAfterAssign` and raises a message flagged for
   * reassignment — a genuinely different state from an ordinary colour change, because
   * somebody is already on their way. */
  { id: 'changedafter', title: 'Colours changed after they were booked',
    plain: 'Their sheet is already printed and the crew has the old pattern. The office is ' +
      'told, and the house has to be re-done or re-assigned before anybody drives out.',
    records: ['lightsChangedAfterAssignAt'],
    next: [
      { to: 'queued', label: 'a new bundle is made for the new colours' },
      { to: 'hung', label: 'the crew is caught in time and hangs the new pattern' }
    ] },

  { id: 'hung', title: 'Lights up',
    plain: 'Marked complete. This is what makes them billable.',
    records: ['completedAt'],
    next: [
      { to: 'invoiced', label: 'the 7pm run bills them that night' },
      { to: 'fixraised', label: 'something is wrong with them' },
      { to: 'noemail', label: 'there is no email anywhere on the bill' }
    ] },

  /* ⚠ WORK DONE, MATERIALS OUT, AND NO BILL CAN BE SENT. The nightly run flags a house it
   * cannot email and moves on. It is dated, and it clears itself the moment an address is
   * added — but nothing chases it, so it is drawn as the dead end it is until somebody
   * notices. */
  { id: 'noemail', title: 'Finished, but there is nobody to send the bill to',
    plain: 'Their lights are up and the nightly run has no email address anywhere on the ' +
      'bill. It is flagged and skipped. Adding an address anywhere on that bill clears it ' +
      'and they are billed on the next run.',
    records: ['cannotBillNoEmailAt'],
    next: [{ to: 'invoiced', label: 'somebody adds an address and the next run bills them' }] },

  { id: 'fixraised', title: 'Fault reported',
    plain: 'A strand out, a fallen run. They go on a fixer route.',
    records: ['fixRaisedAt'],
    next: [{ to: 'fixdone', label: 'somebody goes and mends it' }] },

  { id: 'fixdone', title: 'Fault mended',
    plain: 'Off the fix list. Their bill is untouched — a fix is not a charge.',
    records: ['fixDoneAt'],
    next: [{ to: 'invoiced', label: 'billing carries on as normal' }] },

  { id: 'invoiced', title: 'Invoice sent',
    plain: 'The nightly run at 7pm bills every house marked done that has not been billed yet. ' +
      'The bill being worked out and the email actually leaving are two different moments, ' +
      'on two different documents.',
    /* ⚠ "I never got my bill" is answered by `invoiceEmailSentAt` and by nothing else.
     * `invoicedAt` is stamped on the INVOICE when the amount is worked out; the email
     * leaving is stamped on the CUSTOMER. Drawing only the first reads as proof of
     * something it does not prove. */
    /* ⚠ THE JOIN FEE IS DATED HERE, not on `paid`. It is folded straight into `install`
       rather than listed like the change fee, so this stamp is the only record of WHEN a
       customer was charged their $30 — and that is the question asked when they query the
       bill. Start New Season clears the flag, so it answers "this season" each year. */
    records: ['invoicedAt', 'invoiceEmailSentAt', 'newMemberFeeAppliedAt'],
    next: [
      { to: 'paid',      label: 'they pay it all' },
      { to: 'partpaid',  label: 'they pay some of it' },
      { to: 'unmatched', label: 'their card is charged but the bill cannot be found' },
      { to: 'chase1',    label: '30 days pass and nothing has come in' }
    ] },

  /* ⚠ PART PAID IS NOT PAID AND NOT UNPAID, and the difference reaches the money: the
     late fee is $25 for somebody who has paid something and $40 for somebody who has
     paid nothing. Folded into "paid" the page would lose the distinction the fee turns on. */
  /* ⚠ A REAL PAYMENT THAT LANDS NOWHERE, and every part of it checked rather than assumed
   * (2026-08-29). When a card is captured and the invoice document cannot be found — the
   * usual cause is the customer changing the phone or email their bill is keyed on — the
   * money is filed in `unmatchedPayments` and an SMS goes to the office, if an alert
   * number is set.
   * ⚠ THREE THINGS ARE TRUE AT ONCE AND EACH WAS VERIFIED: nothing anywhere writes
   * `resolved: true`; no screen in the admin reads that collection at all; and
   * firestore.rules says `allow write: if false`, so even a screen that existed could not
   * mark one resolved. The customer's own portal reads Paid in Full throughout.
   * ⚠ IT IS DRAWN AS AN ENDING BECAUSE THAT IS WHAT IT IS TODAY — money in, nothing out.
   * Drawing a route onward would describe a repair nobody has built. */
  { id: 'unmatched', title: 'Paid, but the money found no bill', built: false,
    notBuilt: 'There is no way out of this state. Nothing writes resolved:true, no screen ' +
      'reads the collection, and firestore.rules forbids writing to it — so even a screen ' +
      'that existed could not clear one. All three were checked, not assumed.',
    plain: 'The card was charged and no invoice could be found to apply it to — usually ' +
      'because the phone or email the bill is keyed on has changed. It is filed under ' +
      'unmatched payments and the office is texted, if an alert number is set. Nothing ' +
      'can mark it dealt with: no screen shows these, and the rules forbid writing to them.',
    records: ['capturedAt'],
    end: true },

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
    notBuilt: 'Nothing chases an unpaid bill on a timer today. Two things run on a ' +
      'schedule — the 7pm invoice, and the nudge, which chases an unanswered QUOTE. ' +
      'Chasing a bill is a manual send from Automation Emails.',
    plain: 'A text asking them to pay. The system tells the office when one is due; ' +
      'a person sends it.',
    next: [
      { to: 'paid',   label: 'they pay' },
      { to: 'chase2', label: 'another 30 days pass' }
    ] },

  { id: 'chase2', title: 'Email them with a fee — 60 days', built: false,
    notBuilt: 'Nothing sends this. The fee rule exists in the page as a preview marked ' +
      '"not built" — $25 if they have paid something, $40 if they have paid nothing — ' +
      'and no code charges it.',
    plain: 'Sends by itself, with a new invoice carrying the late fee. The rule is already ' +
      'written down: $25 if they have paid something, $40 if they have paid nothing.',
    next: [{ to: 'paid', label: 'they pay' }] },

  /* ⚠ `newMemberFeeAppliedAt` USED TO BE ON THIS STEP AND IT IS WRONG. `runInvoiceBatch`
     stamps it when the invoice is BUILT — the $30 is folded into `install`, so the date
     belongs to the bill going out, not to somebody settling it. Drawn here the page said
     a customer is charged the join fee at the moment they pay, which is the one place
     somebody querying that charge would look. It has moved to `invoiced`. */
  { id: 'paid', title: 'Paid',
    plain: 'The bill is settled. Their part of the season is over.',
    records: ['lastPaymentAt'],
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
    /* ⚠ ASKED BACK AND ACTUALLY BACK ARE DIFFERENT DAYS, and the gap between them is the
     * whole question: a set asked back in October and still not on the shelf in November is
     * somebody's bundle that cannot be rebuilt. */
    records: ['lightsRecycleRequestedAt', 'lightsRecycledAt'] },

  { id: 'done', title: 'Season over',
    plain: 'Their bin stays made up. When Start New Season runs it clears the flags and ' +
      'keeps every date, so their history keeps last year rather than losing it.',
    /* ⚠ THE LINE BETWEEN SEASONS, and it is why the history does not run two years
     * together. Start New Season clears `completed`, `invoiceEmailSent`, `scheduled` and
     * the rest while leaving every date standing, so without this marker last season's
     * install reads as this season's. */
    records: ['seasonResetAt'],
    next: [{ to: 'rsvpasked', label: 'and next season we ask if they want lights again' }] },

  /* ⭐ THE RETURNING CUSTOMER'S PATH BEGINS HERE (2026-08-30). Addie: "for old costumers
     are starting point is just at RSVP can we work on those paths to".

     ⚠ IT WAS A THROUGH-STEP, NOT A DOOR. `rsvpasked` was reachable only by walking the
     whole first-season path from a quote — so the ~960 people who are already customers
     had no starting point of their own, and their season could only be read as a footnote
     to somebody else's. It is a `start` now, beside the three first-season doors.

     ⚠ AND IT HAD NO DATE ON IT AT ALL, which is its own finding: the send stamps
     `rsvpSentAt`, that stamp is what `seasonRuleIsLive` reads to decide whether anybody
     may be dropped for not answering, and the page showed the step as leaving no trace.

     ⚠ THE RSVP IS A DIFFERENT NO FROM A DECLINED QUOTE. Declining a quote is "not at this
     price"; answering no here is "not this year at all", and it takes them off every
     route, the build queue and the bill. */
  { id: 'rsvpasked', title: 'The RSVP goes out', start: true,
    plain: 'Where a returning customer\u2019s season starts. We ask everybody who had ' +
      'lights last year whether they want them again. Only somebody who answers is ' +
      'scheduled \u2014 nobody is carried into the season on last year\u2019s yes.',
    records: ['rsvpSentAt'],
    next: [
      { to: 'rsvpyes',      label: 'they say yes' },
      { to: 'rsvpno',       label: 'they say no' },
      { to: 'backnextyear', label: 'they say back next year' },
      { to: 'officebadged', label: 'the office badges them out after a conversation' },
      { to: 'unanswered',   label: 'they never answer' }
    ] },

  /* ⭐ A YES IS NOT ONE FIELD, IT IS EIGHT — and drawing it as a straight line to the
     warehouse was the thin part Addie is pointing at. `seasonYesUpdates` is one shared
     server rule (portalRsvp and quoteRespond both call it), and it: sets the status,
     stamps the reply, CANCELS a queued recycle their earlier no created, re-queues a
     build only where that recycle had actually happened, clears the Back Next Year badge
     in both of its fields, and — for somebody who was out — stamps both the instruction
     the planner consumes and the record the office reads.

     ⚠ TWO FIELDS FOR COMING BACK, ON PURPOSE. `needsDayAssignedAt` is an instruction the
     planner eats; `cameBackThisSeasonAt` is the badge, and it has to outlive the
     instruction or it disappears the moment it does any good. */
  { id: 'rsvpyes', title: 'They say yes',
    plain: 'In for the season. If they had said no earlier, the recycle that answer ' +
      'started is cancelled and their build is put back \u2014 and if they were out, they ' +
      'are marked as having come back so the office can see it and the planner gives them ' +
      'the next day going.',
    records: ['rsvpRespondedAt', 'cameBackThisSeasonAt', 'needsDayAssignedAt'],
    next: [
      { to: 'queued',       label: 'and they go to the warehouse like anybody else' },
      { to: 'pricerequote', label: 'their price has changed since last year' },
      { to: 'memberchange', label: 'they want something different this year' }
    ] },

  /* ⚠ A PRICE RE-QUOTE IS ITS OWN THING AND THE WAREHOUSE DOES NOTHING. Addie, 2026-08-21:
     "you can also get a requote because you just changed the price and when that happens
     nothing gets added to warehouse". Same house, same lights, same feet, same street —
     building anything would put a real bundle on a real shelf for no reason. It is drawn
     here rather than folded into `requote` because on the returning path it is the
     COMMONEST kind, and the other two both imply work. */
  { id: 'pricerequote', title: 'Re-quoted on price only',
    plain: 'The number changed and nothing about the house did. The office is asked ' +
      'whether it goes back to the customer, and can type why. Nothing reaches the ' +
      'warehouse and nothing is rebuilt.',
    records: ['requoteAppliedAt'],
    next: [
      { to: 'approved',  label: 'they agree the new price' },
      { to: 'declined',  label: 'they say not at that price' },
      { to: 'queued',    label: 'the office just corrects it and carries on' }
    ] },

  /* ⚠ A SECOND DOOR OUT OF THE SEASON, and it is not the RSVP link. The office badges
     somebody Back Next Year from a conversation — `maybeNextYear` plus `maybeNextYearAt`
     — while `portalRsvp` writes the STATUS. Two writers, two fields, and reading only one
     of them is the exact bug `isOutForSeason` was fixed for: everybody who answered
     through the link stayed fully in the season, routed, scheduled and built for. */
  { id: 'officebadged', title: 'The office badges them out',
    plain: 'Somebody rang in, or said so to a crew, and the office marked them Back Next ' +
      'Year. Same outcome as answering the link \u2014 but it is a different field, and ' +
      'anything that reads only one of the two gets this customer wrong.',
    records: ['maybeNextYearAt'],
    next: [{ to: 'backnextyear', label: 'and they are out for the season' }] },

  { id: 'rsvpno', title: 'No this year', end: true,
    plain: 'Out of the season. Their old set is asked back and their number returns to the ' +
      'pool when they are removed.',
    records: ['rsvpRespondedAt'] },

  /* ⚠ NEVER ANSWERING IS ITS OWN OUTCOME, not a kind of no. It is the one the office has
     to act on, and the only one nobody chose.

     ⚠ AND IT ONLY COSTS THEM THEIR SEASON ONCE THE RULE IS LIVE — the RSVP must actually
     have gone out AND the reply window must have closed. Before that a non-replier is
     still in, which is what stops the switch emptying the book on the day it ships. */
  { id: 'unanswered', title: 'Never answered', end: true,
    plain: 'Not scheduled, because only an answer counts \u2014 but nobody has said no ' +
      'either, so they are still worth ringing. Health Check names them before the rule ' +
      'starts biting rather than after.',
    records: ['rsvpSentAt'] }
];

/* ⭐ A PEDIGREE PER TAB (2026-08-30). Addie: "make a pedigree branch for each of the
 * following tabs — Quote, Costumers, Routes, Schedule, Warehouse, Invoices."
 *
 * One path start-to-finish answers "what happens to a customer". It does NOT answer the
 * question somebody standing on a tab actually has, which is: **what can happen from
 * here, and where does it go next?** Somebody in the Warehouse does not care how the
 * quote was emailed; they care that a bundle can be built, topped up or recycled and what
 * each of those does downstream.
 *
 * ⚠ THESE ARE VIEWS OF ONE GRAPH, NOT SIX NEW GRAPHS. Each names steps that already exist
 * in STEPS, so a step can never say one thing on the whole path and another on its tab —
 * which is the drift that would make six diagrams worse than one. `connections.test.js`
 * fails if a tab names a step that is not in STEPS.
 *
 * ⚠ AND A STEP APPEARS ON EVERY TAB IT BELONGS TO. A colour change is a Customers event,
 * a Warehouse event and — inside 48 hours of a crew day — a Routes one. Filing it under
 * exactly one would be the picture lying by omission, which is the same argument the grid
 * already makes about a field appearing on several areas.
 */
const TAB_ROOTS = [
  { tab: 'Quote', root: 'quote',
    blurb: 'Everything that can happen to a price before it is a customer.',
    /* Where this tab's work stops being this tab's work. Drawn as the last node so the
       hand-off is visible rather than the branch just ending. */
    handOff: 'converted' },

  { tab: 'Customers', root: 'converted',
    blurb: 'From the moment somebody is on the books. Every change they can ask for, and ' +
      'both ways out of the season.',
    handOff: 'queued' },

  { tab: 'Warehouse', root: 'queued',
    blurb: 'What puts a bundle on the list, what takes one off, and what comes back.',
    handOff: 'scheduled' },

  { tab: 'Schedule', root: 'scheduled',
    blurb: 'Being given a day, and everything that can move somebody off one.',
    handOff: 'assigned' },

  { tab: 'Routes', root: 'assigned',
    blurb: 'On a crew sheet. What the crew can report back, and what a late change does ' +
      'to a day that is already printed.',
    handOff: 'invoiced' },

  { tab: 'Invoices', root: 'invoiced',
    blurb: 'The bill going out, and every way it can be settled or not settled.',
    handOff: 'takedown' }
];

module.exports = { STEPS, TAB_ROOTS };
