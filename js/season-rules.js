/* ===========================================================================
   WHO IS IN FOR THIS SEASON — one definition, in a file that can be imported.

   ⭐ WHY THIS IS ITS OWN FILE (2026-08-24). It used to live inline in admin.html
   at around line 21,500, which meant nothing could import it. Every test that
   needed it had to find it by REGEX, cut it out of the HTML as text, glue the
   SEASON_ELIGIBILITY line back on by hand and eval the result — seven places did
   exactly that (run-all.js x6, season-state.test.js x1). A regex can confirm the
   words are on the page. It cannot confirm the function runs. That gap is where a
   broken rule hides while every check reports green, and this file closes it: the
   tests now import the real thing.

   ⚠ BEHAVIOUR IS UNCHANGED BY THE MOVE. Same answers, same order, same comments.
   The only difference is that the setting is now a PARAMETER instead of a
   hard-coded const, so it can be flipped from Firestore settings without a code
   change — see setSeasonEligibility below.

   ⚠ THE ORDER OF THE TESTS IS THE RULE. The hard exclusions run first and apply in
   EVERY mode; the mode only ever decides what happens to somebody who has said
   NOTHING. Reordering so the mode runs first would let a "confirmed" badge
   override a queued recycle and send a crew to a house whose bundle is already
   being taken apart.
   =========================================================================== */


/* ---------------------------------------------------------------------------
   Provenance: did this customer come in through a quote?

   ⭐ THIS NEEDED A REAL FIELD (2026-08-24). Owner: "if not RSVP Yes or converted to
   a costumer for quotes they will not be assigned out for the season." Converting
   a quote writes rsvpStatus 'yes' with NO rsvpRespondedAt — the office knows they
   want lights, nobody has asked them about this season — so up to now the only way
   to recognise a converted quote was the ABSENCE of a reply date. That is an
   inference, not a fact, and it cannot be told apart from a record that got a yes
   some other way.

   convertedFromQuoteAt is written on the CUSTOMER at conversion time. Note that
   convertedToCustomerAt already exists but is written on the QUOTE document, which
   the scheduler never reads — so it could not answer this question.

   ⚠ THE LEGACY FALLBACK IS DELIBERATE AND IS NARROW. Every customer converted
   before this field existed has no stamp, and dropping all of them out of the
   season would be exactly the silent mass-exclusion this file exists to prevent.
   A bulk import writes no rsvpStatus at all (blank), and every route that takes a
   real answer now stamps rsvpRespondedAt, so "yes with no reply date" is the
   signature of a conversion and of essentially nothing else.
   --------------------------------------------------------------------------- */
export function cameFromQuote(d) {
  if (!d) return false;
  if (d.convertedFromQuoteAt) return true;
  /* legacy: converted before convertedFromQuoteAt was written — see above */
  return String(d.rsvpStatus || '').trim().toLowerCase() === 'yes' && !d.rsvpRespondedAt;
}

/* A reply we actually received, from any of the routes that take one: the RSVP
   link and the portal button (portalRsvp), approving a quote by email
   (quoteRespond), and the office marking it for them on the Edit Customer
   dropdown — an answer taken over the phone is still an answer.

   ⚠ SAME TEST AS THE Yes SHEET, deliberately. Two places answering "is this
   customer confirmed" two different ways is how the office and the crew end up
   holding different lists. */
export function hasConfirmedYes(d) {
  if (!d) return false;
  return String(d.rsvpStatus || '').trim().toLowerCase() === 'yes' && !!d.rsvpRespondedAt;
}


/* ---------------------------------------------------------------------------
   THE MODES — a table, not a chain of ifs.

   Each mode answers ONE question: what happens to a customer who has not said
   anything either way? The hard exclusions below are not part of this and are not
   negotiable by any mode.

   Adding a mode is data, not code. That is what "not hard-coded" means here.
   --------------------------------------------------------------------------- */
export const SEASON_ELIGIBILITY_MODES = {

  /* The live default since 2026-08-15. Owner: "everyone should be scheduled who
     isnt labeled maybe next year."

     ⚠ THIS IS THE SAFE ONE AND IT IS THE DEFAULT ON PURPOSE. The generator used to
     require rsvpStatus === 'yes'. Nothing sets that except converting a quote, so
     all ~945 bulk-imported houses carry a blank, the generator matched almost
     nobody, and the routes came back EMPTY. Gating on a confirmation nobody has
     been asked for is the same as gating on nothing. */
  'all-but-maybe-next-year': {
    label: 'Everyone except Maybe Next Year',
    describe: 'A blank or unanswered RSVP is IN. Only an explicit no keeps somebody out.',
    silenceIsIn: true,
    inSeason() { return true; }
  },

  /* The flip the owner planned for on 2026-08-15: "for now we want anyone who isnt
     maybe next year to be on the list but we will change it to only confirmed on
     the scheduled list eventually."

     ⚠ REQUIRES A REPLY, NOT JUST A STATUS. On the status alone this would keep in
     the season precisely the people who have never answered — converted quotes
     carry a yes with no reply date — which is the one group the mode exists to
     exclude. It would have looked like it worked. */
  'confirmed-only': {
    label: 'Only customers who replied Yes',
    describe: 'Needs a real reply. A converted quote that nobody has asked is OUT.',
    silenceIsIn: false,
    inSeason(d) { return hasConfirmedYes(d); }
  },

  /* ⭐ THE OWNER'S RULE, 2026-08-24: "if not RSVP Yes or converted to a costumer
     for quotes they will not be assigned out for the season."

     This is confirmed-only widened by one clause, and the clause matters: a
     customer the office converted from a quote has told us they want lights — they
     just have not been asked about the SEASON yet. Under confirmed-only they drop
     off the routes, which is not what was asked for. */
  'confirmed-or-converted': {
    label: 'Replied Yes, or converted from a quote',
    describe: 'A real reply OR a quote the office converted. Everybody else is OUT.',
    silenceIsIn: false,
    inSeason(d) { return hasConfirmedYes(d) || cameFromQuote(d); }
  }
};

export const DEFAULT_SEASON_ELIGIBILITY = 'all-but-maybe-next-year';

/* ---------------------------------------------------------------------------
   The current mode.

   ⚠ IT IS SETTABLE SO IT DOES NOT HAVE TO BE A CODE CHANGE. The old const meant
   flipping this was an edit to a 46,000-line HTML file, a push, a deploy and a
   Netlify publish. Reading it from settings/scheduling instead makes it a decision
   the office can take and take back.

   ⚠ AN UNKNOWN MODE FALLS BACK TO THE SAFE DEFAULT AND SAYS SO, rather than
   throwing or quietly excluding everybody. A typo in a settings document must
   never be able to empty the season — that failure would look exactly like the
   scheduler being broken, which is the hardest kind of bug to attribute. */
let CURRENT_MODE = DEFAULT_SEASON_ELIGIBILITY;

export function setSeasonEligibility(mode) {
  const key = String(mode || '').trim();
  if (!SEASON_ELIGIBILITY_MODES[key]) {
    if (key) console.warn('Unknown season eligibility mode "' + key + '" — staying on ' + CURRENT_MODE);
    return CURRENT_MODE;
  }
  CURRENT_MODE = key;
  return CURRENT_MODE;
}

export function getSeasonEligibility() { return CURRENT_MODE; }


/* ---------------------------------------------------------------------------
   THE HARD EXCLUSIONS — true in every mode.
   Each returns a REASON rather than a boolean, so the audit below can say why
   somebody is off the list instead of just that they are.
   --------------------------------------------------------------------------- */
export function seasonExclusionReason(d) {
  if (!d) return 'no record';

  const said = String(d.rsvpStatus || '').toLowerCase();

  /* ⭐ AN RSVP OF "NO" KEEPS THEM OUT UNTIL THEY SAY OTHERWISE (2026-08-22). Owner:
     "someones that says no should go to recycle. But they can change there
     decisions to Yes or back next year and it will update."

     ⚠ THIS REVERSED A DECISION FROM 2026-08-15 and the old reasoning is kept so
     nobody restores it by accident. Back then only the PHYSICAL rule below applied
     — out while their bundle is queued to be taken apart, in again the moment the
     warehouse finishes. That made "no" a temporary state: the flag is cleared when
     the job is done and the customer silently rejoined the season a week later
     having never changed their mind. The answer is what decides; the flag only
     ever backed it up.

     ⚠ AND IT UPDATES BOTH WAYS. Every route that takes a new answer rewrites
     rsvpStatus, so changing to Yes puts them straight back in. Nothing here is
     sticky; it reads the current answer every time it is asked. */
  if (said === 'no') return 'answered no';

  /* ⭐ BACK NEXT YEAR IS OUT, HOWEVER THEY SAID IT (2026-08-22). Owner: "back next
     year should be on 2027 and not split for this year on schedule."

     ⚠ BOTH HALVES ARE LOAD-BEARING. The office badge (maybeNextYear) and the RSVP
     link write DIFFERENT things — portalRsvp writes the status alone with no flag —
     so a customer who answered Back Next Year through the link carried no badge and
     read as fully IN: routed, scheduled and built for. Testing only the flag is the
     bug this pair exists to close. */
  if (d.maybeNextYear) return 'maybe next year';
  if (said === 'backnextyear') return 'back next year';

  /* NOT an RSVP rule — a physical one, which is why it survives every mode.
     Answering no queues the warehouse to take that customer's bundle apart, so by
     the time a crew arrived there would be nothing to hang. It is also what stops a
     ping-pong: the portal pulls them off upcoming routes the moment they answer,
     and without this the fill would put them straight back fifteen minutes later,
     for ever.

     ⚠ UNLESS THEY ARE STAYING. Somebody who MOVED is the opposite case: the old set
     comes back off the old house and a new one is built for the new one, so they
     are as much in the season as anybody.

     ⚠ IT IS ITS OWN FLAG AND IT HAS TO BE. The tempting shortcut is "recycling AND
     building means moving" and it is wrong: adding a customer sets needsLightBuild
     and the warehouse clears it only when the bundle is actually made, so somebody
     who answers NO before the warehouse reaches them carries both flags and would
     silently stay in the season. That is the one mistake here that sends a crew to
     a house with no lights for it. */
  if (d.needsLightRecycle && !d.recycleKeepingCustomer) return 'lights queued for recycling';

  return '';
}


/* ---------------------------------------------------------------------------
   THE ONE ANSWER. Used by the route generator, the nightly fill and the Schedule
   tab, so the three can never disagree about who belongs on a route.
   --------------------------------------------------------------------------- */
export function isOutForSeason(d, mode) {
  if (!d) return true;
  if (seasonExclusionReason(d)) return true;

  const key = mode === undefined ? CURRENT_MODE : String(mode || '');
  const rule = SEASON_ELIGIBILITY_MODES[key] || SEASON_ELIGIBILITY_MODES[DEFAULT_SEASON_ELIGIBILITY];
  return !rule.inSeason(d);
}

/* The positive form, because most call sites read better that way and writing
   !isOutForSeason(x) by hand in twenty places is how one of them ends up missing
   the bang. */
export function isInForSeason(d, mode) { return !isOutForSeason(d, mode); }


/* ---------------------------------------------------------------------------
   THE GUARANTEE — what would this mode actually do to the book?

   ⭐ NO MODE MAY BE FLIPPED BLIND (2026-08-24). Owner: "make sure there will be no
   errors within the season." The single most expensive mistake available here is
   turning on a stricter mode and silently dropping most of the customers off the
   routes — which has ALREADY HAPPENED once, on 2026-08-15, when the generator
   required rsvpStatus === 'yes' and the routes came back empty. Nobody could see
   why, because an empty route list looks identical to a scheduler that is broken.

   This returns the numbers BEFORE anything changes: how many are in now, how many
   would be in after, and exactly who moves. The office decides from that.

   ⚠ IT NAMES THE PEOPLE, not just a count. "You would drop 812 customers" is a
   number nobody can check. A list of names is something the office can look at and
   recognise as wrong.
   --------------------------------------------------------------------------- */
export function seasonEligibilityAudit(customers, mode, opts) {
  const o = opts || {};
  const sample = o.sample === undefined ? 20 : o.sample;
  const from = o.from === undefined ? CURRENT_MODE : o.from;
  const list = Array.isArray(customers) ? customers : [];

  const out = {
    from,
    to: mode,
    total: list.length,
    inBefore: 0,
    inAfter: 0,
    dropped: [],
    added: [],
    excludedAnyway: 0,
    unknownMode: !SEASON_ELIGIBILITY_MODES[mode]
  };

  list.forEach(function (c) {
    /* Accept either a bare record or a {id, data} wrapper — both shapes are in use
       across admin.html, and an audit that silently reads the wrong one would
       report a confident zero. */
    const d = c && c.data ? c.data : c;
    if (!d) return;

    const before = !isOutForSeason(d, from);
    const after = !isOutForSeason(d, mode);
    if (before) out.inBefore++;
    if (after) out.inAfter++;

    if (seasonExclusionReason(d)) { out.excludedAnyway++; return; }

    if (before && !after) {
      out.dropped.push({
        id: c && c.id ? c.id : (d.customerNumber || ''),
        name: d.name || '(no name)',
        why: whyNotEligible(d, mode)
      });
    } else if (!before && after) {
      out.added.push({ id: c && c.id ? c.id : (d.customerNumber || ''), name: d.name || '(no name)' });
    }
  });

  out.droppedCount = out.dropped.length;
  out.addedCount = out.added.length;
  if (sample >= 0) {
    out.droppedSample = out.dropped.slice(0, sample);
    out.addedSample = out.added.slice(0, sample);
  }
  return out;
}

/* Why a specific customer fails a specific mode — in words the office uses. */
export function whyNotEligible(d, mode) {
  const hard = seasonExclusionReason(d);
  if (hard) return hard;
  if (!SEASON_ELIGIBILITY_MODES[mode]) return 'unknown mode';
  if (SEASON_ELIGIBILITY_MODES[mode].inSeason(d)) return '';
  const said = String((d || {}).rsvpStatus || '').trim().toLowerCase();
  if (!said) return 'never asked — no RSVP on file';
  if (said === 'unanswered') return 'asked this season, no reply yet';
  if (said === 'yes' && !d.rsvpRespondedAt) return 'yes on the record but no reply logged';
  return 'RSVP is "' + said + '"';
}
