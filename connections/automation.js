/* WHAT RUNS WITHOUT ANYBODY PRESSING ANYTHING
 * ===========================================
 * Addie, 2026-08-30: "I think where things go does not have a complete representation of
 * the automation. There is still things missing there."
 *
 * She is right, and the grid could not have shown it. That grid is FIELD × DESTINATION —
 * it answers "where does this answer land", and every column is a SCREEN. Automation is
 * not a screen. The only automatic thing with a column was the 7pm billing run, and
 * Automation Emails was folded into the Portal column with a comment in grid.js admitting
 * it and saying to speak up "if it ever carries a connection the office needs to see on
 * its own". This is that.
 *
 * ⚠ SO IT IS A LIST, NOT A COLUMN. Adding six more columns to a grid that is already
 * eight wide on a tablet would make the thing unreadable to fix a different problem. What
 * somebody actually wants to know about automation is: what runs, how often, what it
 * touches, and whether anyone would notice if it stopped.
 *
 * ⚠ HAND-WRITTEN, LIKE THE MANIFEST AND THE JOURNEY, AND FOR THE SAME REASON. The code can
 * say a timer exists; it cannot say what the timer is FOR or what it would cost if it
 * stopped. What is checked mechanically is the other half, and it is the half that rots:
 * `connections.test.js` sweeps every `onSchedule` and every `setInterval` out of the four
 * source files and fails if one is not named here. A process that appears in the code and
 * not on this list is exactly the "still things missing" she is describing, and it is the
 * only part a machine can hold.
 *
 * ⚠ AND `watched` IS AN HONEST NO MOST OF THE TIME. Saying a run is watched when the grid
 * does not watch it would make this page the thing it exists to prevent. Three of the
 * seven are genuinely unwatched, and that is worth seeing.
 */
'use strict';

/* `id` is what the gate matches against the code — the exported name for a Cloud
   Function, the timer variable for a browser interval. Changing one means changing it
   here, which is the point. */
const AUTOMATION = [
  {
    id: 'sendNightlyInvoices',
    title: 'The nightly bill',
    where: 'Cloud Function, on a cron',
    when: 'every night at 7 PM Mountain',
    does: 'Bills every house that is finished and not yet invoiced, adds the $30 join fee ' +
      'and any carried charge, takes credits off, emails the invoice and texts the office ' +
      'a summary.',
    touches: ['invoices', 'jobAddresses', 'messages', 'nightlyInvoiceLog'],
    watched: true,
    /* ⚠ THE ONE THAT COSTS MONEY IF IT STOPS, which is why it is the only automatic run
       that reports to a person every time rather than only when something is wrong. */
    ifItStopped: 'Nobody is billed, and the only sign is a text that does not arrive. ' +
      'The stale-run banner on the Dashboard is what catches it.'
  },
  {
    id: 'sendQuoteNudges',
    title: 'The quote nudge',
    where: 'Cloud Function, on a cron',
    when: 'every morning at 10 AM Mountain',
    does: 'Chases quotes nobody has answered — one email, rendered on the server with the ' +
      'same photo and link rules the office’s own Nudge button uses.',
    touches: ['quotes'],
    /* ⚠ NOT WATCHED, AND `quoteLastNudgedAt` IS WHY IT IS WORTH SAYING. The date it
       stamps is on the customer history, so a nudge that stopped going out would show as
       an absence on a page nobody reads looking for absences. */
    watched: false,
    ifItStopped: 'Quotes go quiet and nothing says so. The only trace is a nudge date ' +
      'that stops appearing on the history.'
  },
  {
    id: 'sendArrearsRsvpEmails',
    title: 'The unpaid-last-season chase',
    where: 'Cloud Function, on a cron',
    when: 'every morning at 10 AM Mountain — but only if somebody has switched it on',
    does: 'Emails the "Not Paid RSVP" template to customers who still owe for a previous ' +
      'season and have never answered the RSVP. Once per customer per season, ever.',
    touches: ['jobAddresses', 'invoices', 'emailTemplates', 'settings/arrearsRsvpAutomation'],
    /* ⛔ IT SHIPS OFF, AND THAT IS THE POINT OF THE ENTRY. MON-34 is Addie's ruling that
       she would send these herself, so the schedule returns immediately unless
       settings/arrearsRsvpAutomation.enabled is true and an absent document is off. Anyone
       reading this list should know it is here and doing nothing, rather than wonder later
       why customers are being chased. */
    watched: false,
    ifItStopped: 'Nothing, today — it is switched off and sends nobody anything. Turned ' +
      'on and then stopped, held customers would quietly stop being chased, and the only ' +
      'trace would be arrearsRsvpEmailAt no longer appearing on new records.'
  },
  {
    id: 'reconcileTimer',
    title: 'The route sweep',
    where: 'admin.html, while the dashboard is open',
    when: 'every 15 minutes',
    does: 'Takes houses off days they should not be on, refreshes stops whose customer ' +
      'record has moved on, caps days over the crew limit, tops up short ones and builds ' +
      'days that are missing.',
    touches: ['scheduledRoutes', 'jobAddresses', 'settings/routeDigest', 'messages'],
    /* ⚠ IT WRITES CUSTOMER RECORDS, NOT ONLY ROUTES, and that is the part people are
       surprised by: moving a house changes `scheduled`, `scheduledDate` and
       `assignedCrew` on the customer as well as the route document. */
    watched: false,
    ifItStopped: 'Routes drift from the customer records and nobody is told. It only runs ' +
      'while somebody has the dashboard open, so a quiet week is a week of no sweeping.'
  },
  {
    id: '__syncTimer',
    title: 'The schedule sync',
    where: 'admin.html, while the Schedule tab has a plan loaded',
    when: 'every 5 minutes',
    does: 'Pulls corrected towns, timings, names, addresses, phones and notes across from ' +
      'the customer records onto the saved season, adds customers who were never on it, ' +
      'and moves anybody scheduled before the month they asked for.',
    touches: ['routeSchedule'],
    /* ⚠ A BLANK NEVER WIPES WHAT THE PLAN HOLDS, and timings are compared by MEANING
       rather than spelling — "OCT" and "October" are the same thing, and treating them as
       different would rewrite every house on every tick. */
    watched: false,
    ifItStopped: 'A town corrected in All Customers never reaches the season, so a crew is ' +
      'sent to the wrong day and the screen that sent them still looks right.'
  },
  {
    id: 'hcAutoTimer',
    title: 'The health check',
    where: 'admin.html, while the dashboard is open',
    when: 'every 10 minutes',
    does: 'Re-runs every health check and updates the sidebar badge. Reads only — it ' +
      'changes nothing.',
    touches: [],
    watched: false,
    ifItStopped: 'The badge goes stale. Nothing is lost, because opening the panel re-runs ' +
      'the checks.'
  },
  {
    id: 'nightlyHealthTimer',
    title: 'The stale-run banner',
    where: 'admin.html, while the dashboard is open',
    when: 'every 10 minutes',
    does: 'Re-reads the nightly billing log so the Dashboard can say when the 7pm run last ' +
      'worked. Reads only.',
    touches: [],
    /* ⚠ THIS IS THE WATCHER FOR THE ONE ABOVE IT, which is the only reason a read-only
       timer earns a row here: if this stops, the thing that tells you billing stopped
       stops too, and both failures are silent. */
    watched: false,
    ifItStopped: 'The one alarm on the most expensive automatic run goes quiet, and its ' +
      'silence looks exactly like everything being fine.'
  },
  {
    id: 'etRenderRecipientList',
    title: 'Automation Emails',
    where: 'admin.html, Automation Emails',
    when: 'when the office presses send — not on a timer',
    does: 'Builds the audience for a template (RSVP, chase-the-unpaid, a seasonal note) ' +
      'and sends it. The RSVP is the send this whole season turns on.',
    touches: ['jobAddresses'],
    /* ⭐ IT HAD NO COLUMN AND WAS FOLDED INTO "Portal", WHICH IS SIMPLY WRONG: an
       automation email lands in a customer’s inbox, not on the portal. grid.js’s own
       comment said to speak up if it ever carried a connection the office needed to see
       on its own, and the RSVP audience is that connection — who is in the season is
       decided by who this send reaches.
       ⚠ AND IT IS NOT ON A TIMER, which is why it is here rather than left out: "runs
       without anybody pressing anything" is about who DECIDES the audience, and nobody
       picks these names by hand. */
    watched: true,
    ifItStopped: 'The RSVP never goes out, so nothing in the season starts — which is ' +
      'loud, and the one automatic failure here that would be noticed the same day.'
  }
];

module.exports = { AUTOMATION };
