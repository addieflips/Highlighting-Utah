/* =============================================================================
 * ⭐ THE COMMUNICATION CENTRE — TYPE, STATUS, CATEGORY, PRIORITY
 * `npm run test:comm`. Its own file per R-018.
 *
 * Addie's blueprint, 2026-09-09: "Do NOT simply create more folders. Instead, create a
 * system based on MESSAGE TYPE → STATUS → CATEGORY → PRIORITY", and the test she set for
 * the whole thing — the office should answer, in seconds: who contacted us, what do they
 * need, do I need to respond, is somebody waiting on us, is the system having problems,
 * is any of it urgent, what is already handled.
 *
 * ⚠ IT RUNS THE CLASSIFIER, IT DOES NOT READ IT. Every claim here is about what a row
 * COMES OUT AS, which a regex over the source cannot see — the lesson this repo has
 * relearned in four different places.
 * ============================================================================= */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
/* ⚠ ANY CHECK THAT SCORES AFTER THE SUMMARY CAN NEVER FAIL THE BUILD. The delete path is
   async — it awaits a write per message before the section is removed — so its checks are
   pushed here and the summary waits on the list. Same rule Suite 10's `pendingAsync` follows
   in run-all.js, and for the same reason. */
const pendingChecks = [];
function check(name, ok, why){
  if(ok){ passed++; console.log('  PASS  ' + name); }
  else { failed++; failures.push({name, why}); console.log('  FAIL  ' + name + (why ? '\n          ' + why : '')); }
}

function liftFn(n){
  const a = admin.indexOf('function ' + n + '(');
  if(a === -1) throw new Error('could not find ' + n + '()');
  let i = admin.indexOf('{', a), d = 0;
  for(; i < admin.length; i++){
    const c = admin[i];
    if(c === '{') d++;
    else if(c === '}'){ d--; if(!d) return admin.slice(a, i + 1) + '\n'; }
  }
  throw new Error('could not lift ' + n + '() whole');
}
/* ⚠ THE REAL TABLES, LIFTED, NEVER RETYPED. A copy of the category map here would agree
   with itself and prove nothing about the screen — §3's "lift, not stub". */
function liftConst(n){
  const m = new RegExp('const ' + n + '\\s*=\\s*[\\s\\S]*?;\\r?\\n').exec(admin);
  if(!m) throw new Error('could not find const ' + n);
  return m[0];
}
/* ⭐ COMM_SECTIONS NO LONGER STANDS ALONE ([[RS-60]]). The No RSVPs section builds a
   folder per decline reason from `RSVP_DECLINE_REASONS` rather than typing the tabs out,
   so every lift of the sections table needs that list in front of it — lift the table by
   itself and the file dies on a bare ReferenceError, which is the extraction-list trap
   working exactly as documented. It bit FOUR sandboxes here at once, so it is one helper
   rather than four places to remember.
   ⚠ LIFTED, NEVER STUBBED: a stubbed list would let this gate stay green while the tabs
   and the customer's picker offered different folders — and these strings ARE the folder
   names. */
const commSectionsSrc = () => liftConst('RSVP_DECLINE_REASONS') + liftConst('COMM_SECTIONS');
/* ⚠ THREE COMPUTED ENTRIES NOW LEAD THIS LIST, AND TWO BRANCHES FOUND THE SAME TRAP IN THE
   SAME WEEK. `SYSTEM_NOTICE_TOPICS` stopped being a table of plain strings: [[FIX-02]] gave
   it `FIX_NOTICE_TOPIC` and [[RS-59]] gave it `RSVP_NO_TOPIC` / `RSVP_BNY_TOPIC`, so lifting
   the array alone dies on a bare ReferenceError and takes the whole file with it.
   ⚠ DECLARED FIRST, or the array references them before they exist — main's own note, and
   it applies to all three. Lifted, never stubbed. */
const NAMES = ['FIX_NOTICE_TOPIC','RSVP_NO_TOPIC','RSVP_BNY_TOPIC','MSG_TYPE_MEMBER','SYSTEM_NOTICE_TOPICS','MSG_CATEGORIES','MSG_TOPIC_CATEGORIES',
  'MSG_TEXT_CATEGORIES','MSG_STATUS','MSG_STATUS_LABEL','MSG_PRIORITY','MSG_PRIORITY_LABEL',
  'MSG_SEVERITY_LABEL','COMM_ACTIVITY_TOPICS'];
/* ⚠ commRowMatches CALLS BOTH OF THESE NOW ([[MSG-15]]) — lifted, never stubbed. A stub for
   commSectionByKey would decide for itself which sections exist, which is exactly the thing
   under test; and the suite dies with a bare ReferenceError rather than skipping, which is
   the extraction-list trap CLAUDE.md describes working as intended. */
/* ⚠ AND THREE MORE ARRIVED WITH [[MSG-19]] — lifted, never stubbed, for the same reason.
   `commBuiltInExtras` decides which folders she has added to a built-in section,
   `messageFolderOf` decides where a message actually IS (it reads filedByHand before the
   topic table, which is the whole distinction between filing and an automatic home folder),
   and `msgIsFiledAway` is what empties a filed row out of the Inbox. A stub for any of the
   three would answer the question under test. The suite died with a bare
   `commBuiltInExtras is not defined` the moment commRowMatches started asking it, which is
   the extraction-list trap CLAUDE.md describes working exactly as intended. */
const SRC = NAMES.map(liftConst).join('') +
  /* ⚠ AND MESSAGE_HOME_FOLDER'S OWN TWO CONSTANTS, or the table dies on a bare
     ReferenceError while it is being built — the same trap one level down. */
  liftConst('ERROR_FOLDER_MEMBER') + liftConst('ERROR_FOLDER_ADMIN') +
  liftConst('MESSAGE_HOME_FOLDER') +
  liftFn('msgTypeOf') + liftFn('msgCategories') + liftFn('msgStatusOf') +
  liftFn('msgPriorityOf') + liftFn('msgSeverityOf') + liftFn('msgFacets') +
  liftFn('messageFolderOf') + liftFn('msgIsFiledAway') + liftFn('commBuiltInExtras') +
  liftFn('commFilterMatches') + liftFn('commSectionByKey') + liftFn('commRowMatches');
const sb = {};
new Function('MEMBER_ERROR_TOPIC', 'ADMIN_ERROR_TOPIC', 'commSections',
  'let __cs = commSections;' + SRC.replace(/\bcommSections\b(?!\s*[,)])/g, '__cs') +
  'this.facets = msgFacets; this.matches = commRowMatches; this.filter = commFilterMatches;' +
  'this.setSections = function(v){ __cs = v; };')
  .call(sb, 'Member Error', 'Admin Error', {custom: [], hidden: [], builtIn: {}});

console.log('');
console.log('--- what kind of thing is this ---');

const memberQ = {topic:'General Question', read:true,
  message:'Can I change my lights to red and green and move my installation to November 20?'};
const notice  = {topic:'Routes Kept Up To Date', folder:'System', read:true, message:'29 moved, 29 removed'};
const memErr  = {topic:'Member Error', read:false,
  message:'What they were doing: Answering Back Next Year from the RSVP email. Whatever they were trying to do did NOT save'};
const payErr  = {topic:'Admin Error', read:false, message:'Payment confirmation failed for Bryant Smith'};

check('a customer asking for something is a MEMBER message',
  sb.facets(memberQ).type === 'member');
check('a route notice the app wrote itself is a SYSTEM message',
  sb.facets(notice).type === 'system',
  'a notice sitting in the member queue is how five real questions get buried under four hundred');
check('a failure report is an ERROR, not a message',
  sb.facets(memErr).type === 'error' && sb.facets(payErr).type === 'error');

console.log('');
console.log('--- her worked example, which is the acceptance test she wrote ---');
/* Addie: "Can I change my lights to red and green and move my installation to November 20?"
   → MEMBER MESSAGE / LIGHT COLOR / SCHEDULING / NEEDS REPLY. */
{
  const f = sb.facets(memberQ);
  check('it is tagged Lights / Colors AND Scheduling, from one sentence',
    f.categories.indexOf('Lights / Colors') !== -1 && f.categories.indexOf('Scheduling') !== -1,
    'this is the example in the blueprint and the whole argument for tags over folders — ' +
    'no folder can hold it twice. Got: ' + f.categories.join(' + '));
  check('and it needs a reply',
    f.status === 'needs_reply');
  /* ⚠ "General Question" is the subject the PORTAL offered, not a finding. Left on, every
     row in her example wears a shrug beside two real answers. */
  check('the General Question fallback drops away once something real is found',
    f.categories.indexOf('General Question') === -1,
    'got: ' + f.categories.join(' + '));
}

console.log('');
console.log('--- do I need to respond ---');
check('unread is unread',
  sb.facets({topic:'Billing / Payment Question', read:false, message:'why is my bill 400'}).status === 'unread');
check('read and unanswered needs a reply',
  sb.facets({topic:'Report an Issue', read:true, message:'two strands out'}).status === 'needs_reply');
/* ⛔ THE ONE THAT WOULD RELABEL HER WHOLE INBOX. "Mark Responded" has always meant dealt
   with; reading it as Waiting On Member would move every message she has ever ticked into
   a queue she is waiting on somebody else for. */
check('a message she already marked responded reads Resolved, not Waiting',
  sb.facets({topic:'Report an Issue', read:true, responded:true, message:'x'}).status === 'resolved',
  'that button has always meant handled — Waiting on Member is a new answer she sets herself');
check('and Waiting on Member is stored, never guessed',
  sb.facets({topic:'General Question', read:true, status:'waiting', message:'x'}).status === 'waiting');
/* ⚠ A NOTICE NOBODY TICKED IS NOT A QUESTION. */
check('a read system notice never asks for a reply',
  sb.facets(notice).status !== 'needs_reply',
  'route notices outnumber real questions hundreds to one; calling them Needs Reply ' +
  'buries the queue this whole redesign exists to surface');

console.log('');
console.log('--- is any of it urgent ---');
check('a payment failure is Critical and Urgent',
  sb.facets(payErr).severity === 'critical' && sb.facets(payErr).priority === 'urgent');
check('an RSVP that never saved is Critical too',
  sb.facets(memErr).severity === 'critical',
  'to that customer it looks like they already answered — that is the whole reason ' +
  'Member Errors exists');
/* ⛔ HER OWN WARNING: "Do not make every message feel urgent." */
check('an ordinary question is Normal',
  sb.facets(memberQ).priority === 'normal');
check('and a resolved error stops being urgent',
  sb.facets({topic:'Admin Error', read:true, responded:true, message:'payment failed'}).severity === 'resolved');
check('a priority she sets by hand beats every rule above it',
  sb.facets({topic:'General Question', read:true, priority:'urgent', message:'x'}).priority === 'urgent',
  '"The admin should always be able to manually change the classification"');

console.log('');
console.log('--- the views, which are what the counts are built from ---');
check('the Inbox keeps system notices out unless All is asked for',
  sb.matches(notice, 'inbox', 'all') === false &&
  sb.matches(memberQ, 'inbox', 'all') === true,
  '"System messages should generally not appear mixed into the main member list"');
check('Unread, Needs Reply and Urgent each hold what they say',
  sb.matches({topic:'General Question', read:false, message:'x'}, 'inbox', 'unread') === true &&
  sb.matches(memberQ, 'inbox', 'needs_reply') === true &&
  sb.matches(payErr, 'inbox', 'urgent') === true);
check('System Errors → Critical holds only critical ones',
  sb.matches(payErr, 'errors', 'critical') === true &&
  sb.matches({topic:'Admin Error', read:false, message:'a template was empty'}, 'errors', 'critical') === false);
check('a member message never appears under System Errors',
  sb.matches(memberQ, 'errors', 'all') === false &&
  sb.matches(memberQ, 'system', 'all') === false);
/* ⚠ THE COUNT AND THE LIST ASK THE SAME FUNCTION. Two implementations is how a tab reads
   5 and shows 4 — which this Inbox has already done once, when the sidebar counted every
   message and the nav badge counted unread. */
check('the list and the tab counts are one rule, not two',
  /commRows\(commView\.section, commView\.tab\)/.test(admin) &&
  /function commCount\([\s\S]{0,400}commRows\(section, tab\)/.test(admin),
  'if these ever diverge a tab will say 5 and show 4, and nobody will know which is right');

console.log('');
console.log('--- and it has to reach the screen ---');
/* Suite 276's lesson: a renderer proved against a harness while the page never calls it
   is green and useless. */
/* ⚠ REPOINTED with the folder branch it named ([[MSG-12]]). The list used to choose
   between a folder and a view; there are no folders now, so it simply IS the view — which
   is the stronger claim and the one worth holding. */
check('the list is drawn from the view, and has no second source',
  /let filtered = commRows\(commView\.section, commView\.tab\)/.test(admin) &&
  !/messageFolderOf\(m\.data\) === selectedFolder/.test(admin),
  'a second way of choosing the rows is how the nav and the list start disagreeing');
check('the nav and the summary are drawn in the same pass as the list',
  /function renderMessagesList\(\)\{[\s\S]{0,600}renderCommNav[\s\S]{0,200}renderCommDash/.test(admin),
  'drawn from their own listener the counts are right only until the next thing happens');
check('every dashboard number is a button that filters',
  /data-dashsec="/.test(admin) && /querySelectorAll\('\[data-dashsec\]'\)/.test(admin),
  '"Clicking 5 Need Reply immediately filters the inbox to those five"');
check('the row wears its type, category and status as chips',
  /commChipsHtml\(d\)\+/.test(admin) && /function commChipsHtml/.test(admin));
/* ⚠ ICON AND WORD, NOT COLOUR ALONE — she asked for that by name. */
check('each type chip carries an icon AND a word',
  /Error<\/span>/.test(admin) && /System<\/span>/.test(admin) && /Member<\/span>/.test(admin),
  '"Do not rely only on color. Use icons + labels"');
/* ⛔ THE FOLDER TREE IS GONE (2026-09-09, [[MSG-12]]). Addie, once the system was in:
   "can we just get rid of your folders altogether if the system is made?" Every one of
   the eight folders the app created maps onto a category she now has, so the tree had
   become a second way of saying the same thing.
   ⚠ WHAT MATTERS IS THAT THE FIELD SURVIVED. Nothing was written to the database to take
   a message's filing away, and `msgTypeOf` still reads folder === 'System' to recognise
   notices written before the topic list existed. That is what makes this reversible, and
   it is the half worth a check. */
check('the folder-creating UI is gone, not merely hidden',
  !/id="customFolderList"/.test(admin) && !/id="addFolderBtn"/.test(admin) &&
  !/function renderFolderSidebar/.test(admin),
  'left in place it is dead code that still writes folder documents nobody can see');
check('but the folder field is still read, so old notices are still recognised',
  /folder \|\| ''\) === 'System'/.test(admin) || /d\.folder \|\| ''\)/.test(admin),
  'a notice written before SYSTEM_NOTICE_TOPICS existed is known only by its folder — ' +
  'drop that and a season of notices reads as member messages needing a reply');
{
  const sysByFolder = sb.facets({topic:'Something Nobody Listed', folder:'System', read:true, message:'x'});
  check('and it is proved by running one, not by reading the source',
    sysByFolder.type === 'system' && sysByFolder.status !== 'needs_reply',
    'got type ' + sysByFolder.type + ', status ' + sysByFolder.status);
}
/* ⛔ AND THE THREE TOP TABS ARE GONE ([[MSG-13]]) — "how can we make system messages be
   incorporated in this so that we don't need a seperate tab ... and completley get rid of
   employee messages". Customer and System were tabs across the top while the new nav has
   them as sections down the side: the same choice offered twice, in two places that could
   disagree about which was showing. */
check('the inbox no longer offers the same choice twice',
  !/data-inboxtab/.test(admin) && !/function switchInboxTab/.test(admin));
check('and employee messages are gone entirely, loader included',
  !/function loadEmployeeNotes/.test(admin) && !/employeeNotesList/.test(admin) &&
  !/function renderEmployeeNotesTab/.test(admin));

/* =============================================================================
 * ⭐ THE CONTACT DETAILS UNDER THE NAME ([[MSG-14]])
 * Addie: "on inbox can you show email and phone number under name so I can communicate
 * with them?"
 *
 * ⚠ EVERY CLAIM HERE IS ABOUT WHAT THE ROW SAYS, so every check RUNS the renderer and
 * reads the HTML back. A regex proving the words exist in the source is the failure this
 * repo has shipped three times — most memorably the ledger message that was built and
 * then overwritten by a default on the line below it.
 * ============================================================================= */
console.log('');
console.log('--- the contact line under the name ---');

const CONTACT_SRC =
  /* ⚠ ALL THREE COMPUTED TOPICS FIRST — SYSTEM_NOTICE_TOPICS references them ([[FIX-02]],
     [[RS-59]]), so lifting that table without them dies on a bare ReferenceError while it
     is being built. Same trap as above, and two branches hit it in the same week. */
  liftConst('FIX_NOTICE_TOPIC') + liftConst('RSVP_NO_TOPIC') + liftConst('RSVP_BNY_TOPIC') +
  liftConst('MSG_TYPE_MEMBER') + liftConst('SYSTEM_NOTICE_TOPICS') +
  liftFn('esc') + liftFn('fmtPhone') + liftFn('msgTypeOf') +
  liftFn('msgErrorTokenTail') + liftFn('msgErrorWhoIs') +
  liftFn('msgContactCustomer') + liftFn('msgContactFor') +
  liftFn('msgContactPreference') + liftFn('msgStaffSignedInAs') + liftFn('msgContactLineHtml');
const cb = {};
new Function('MEMBER_ERROR_TOPIC', 'ADMIN_ERROR_TOPIC', 'jobAddresses',
  CONTACT_SRC + 'this.line = msgContactLineHtml; this.contact = msgContactFor;')
  .call(cb, 'Member Error', 'Admin Error', []);

/* Rebuild the sandbox against a given book, because jobAddresses is what every fallback
   reads and each of these checks needs a different one. */
function withBook(book){
  const o = {};
  new Function('MEMBER_ERROR_TOPIC', 'ADMIN_ERROR_TOPIC', 'jobAddresses',
    CONTACT_SRC + 'this.line = msgContactLineHtml; this.contact = msgContactFor;')
    .call(o, 'Member Error', 'Admin Error', book);
  return o;
}

const DANA  = {id:'c1', data:{name:'Dana Reed',  phone:'(801) 555-0111', email:'dana@example.com',
                              portalToken:'AAAAAAw5o9tx'}};
const KYLE  = {id:'c2', data:{name:'Kyle Reed',  phone:'(801) 555-0111', email:'kyle@example.com'}};
const SOLO  = {id:'c3', data:{name:'Ada Frost',  phone:'8015550999',     email:'ada@example.com'}};

/* 1 — the ordinary case. What they typed is what she rings. */
{
  const html = withBook([SOLO]).line({topic:'General Question', name:'Ada Frost',
    phone:'8015550999', email:'ada@example.com', message:'hello'});
  /* ⚠ REPOINTED 2026-09-10, NOT WEAKENED ([[MSG-16]]). These asserted `tel:` and `mailto:`
     links, which Addie has since reversed: "I want to be able to copy and paste phone number
     and email but not a link." R-024 — the newer answer wins. What must still be true is that
     BOTH details reach the row and can be taken off it. */
  check('a message that carries both shows both, as text you can take',
    /row-contact-val">\(801\) 555-0999</.test(html) &&
    /row-contact-val">ada@example\.com</.test(html),
    html);
  check('and neither is a link',
    !/href="tel:/.test(html) && !/href="mailto:/.test(html) && !/<a /.test(html),
    'a link is what stops a drag-to-select, which is the thing she actually does with these');
  check('and each has a Copy button carrying exactly what is shown',
    /data-copyval="\(801\) 555-0999"/.test(html) && /data-copyval="ada@example\.com"/.test(html),
    'what you see is what you paste is the only rule nobody has to be told');
  check('and it does not claim they came from the record',
    !/from their record/.test(html), html);
  check('the number is shown the way the office writes it, not as ten bare digits',
    />\(801\) 555-0999</.test(html), html);
}

/* 2 — the half-filled case, which is most portal-raised messages. */
{
  const html = withBook([SOLO]).line({topic:'Light Color Change', name:'Ada Frost',
    phone:'8015550999', message:'red and green please'});
  check('an email missing from the message is filled in from their record',
    /ada@example\.com/.test(html), html);
  check('and the row says that is where it came from',
    /from their record/.test(html),
    'the office should be able to tell their own answer from one we worked out');
}

/* 3 — THE SAFETY CHECK. Seventeen numbers in the real book are shared and fourteen of
   those are two different households. */
{
  const o = withBook([DANA, KYLE]);
  const c = o.contact({topic:'General Question', phone:'(801) 555-0111', message:'x'});
  check('a phone shared by two households resolves to nobody, rather than to one of them',
    c.email === '',
    'got ' + JSON.stringify(c) + ' — mailing the wrong half of a household is worse than mailing neither');
  check('but the number they actually gave us is still offered',
    /\(801\) 555-0111/.test(o.line({topic:'General Question', phone:'(801) 555-0111', message:'x'})),
    'refusing the lookup must not throw away what the message itself carried');
}
{
  /* ⚠ AND THE SAME REFUSAL ON A SHARED ADDRESS. One inbox between a couple, or a
     landlord's address on two tenants, is as ordinary as one phone between them —
     and the red-check is what said this had no fixture at all. */
  const a = {id:'e1', data:{name:'One Reed',  phone:'8015551001', email:'reeds@example.com'}};
  const b = {id:'e2', data:{name:'Two Reed',  phone:'8015551002', email:'reeds@example.com'}};
  const c = withBook([a, b]).contact({topic:'General Question',
    email:'reeds@example.com', message:'x'});
  check('an email shared by two records resolves to nobody either',
    c.phone === '',
    'got ' + JSON.stringify(c) + ' — ringing one of two people on one address is a guess');
}

/* 4 — the row that most needs this. A Member Error carries no name and no contact at
   all; the only thing identifying anybody is the redacted token on the link they hit. */
{
  const html = withBook([DANA]).line({topic:'Member Error',
    message:'RSVP failed at /#/?token=' + '…' + 'w5o9tx&rsvp=back'});
  check('a Member Error with no contact of its own is reached through their link',
    /\(801\) 555-0111/.test(html) && /dana@example\.com/.test(html),
    'this is the row you most want to ring, and it offered no way to: ' + html);
}
{
  /* ⚠ AND IT KEEPS THE SAME REFUSAL. Two customers whose tokens end the same way is
     not a weaker match, it is no match — msgErrorWhoIs's own rule. */
  const twin = {id:'c9', data:{name:'Other Person', phone:'8015552222',
                               email:'other@example.com', portalToken:'ZZZZZZw5o9tx'}};
  const html = withBook([DANA, twin]).line({topic:'Member Error',
    message:'RSVP failed at /#/?token=' + '…' + 'w5o9tx&rsvp=back'});
  check('two customers behind one link resolves to neither',
    !/@example\.com/.test(html), html);
}

/* 5 — a route sweep has no customer behind it, so it gets no line. */
{
  const html = withBook([SOLO]).line({topic:'Routes Kept Up To Date', folder:'System',
    message:'29 moved, 29 removed'});
  check('a System notice gets no contact line at all',
    html === '',
    '"no phone or email" under every route sweep is noise on the rows that need none');
}

/* 6 — and on a row that SHOULD have one, empty is said rather than left blank. */
{
  const html = withBook([]).line({topic:'General Question', name:'Nobody Known', message:'x'});
  check('a member message with nothing to go on says so rather than rendering blank',
    /row-contact none/.test(html) && /No phone or email/.test(html),
    'blank reads as nothing-to-do on a row sitting in the Inbox because somebody is waiting');
}

/* 7 — their own answer wins. Somebody writing in from a new address wants the reply
   there, not at the old one still on file. */
{
  /* ⚠ THE FIXTURE HAS TO REACH THE LINE. The first version gave the message BOTH details,
     so msgContactFor returned at its early guard and never ran the merge at all —
     the red-check is what said so. This one carries an email that FINDS the record and a
     phone that DISAGREES with it, which is the only shape that can tell the two apart. */
  const c = withBook([DANA]).contact({topic:'Member Error', phone:'8015551111',
    message:'RSVP failed at /#/?token=' + '\u2026' + 'w5o9tx&rsvp=back'});
  check('a phone they typed is not quietly replaced by the one on file',
    c.phone === '8015551111',
    'got ' + c.phone + ' — the record must only ever fill a GAP');
  /* ⚠ AND THE EMAIL SIDE NEEDS THE RECORD FOUND SOME OTHER WAY, or the fixture cannot
     tell an override from a match: found BY the email, the two are the same string.
     The token is the one route in that does not go through either field. */
  const c2 = withBook([DANA]).contact({topic:'Member Error', email:'typed@example.com',
    message:'RSVP failed at /#/?token=' + '\u2026' + 'w5o9tx&rsvp=back'});
  check('nor is an address they wrote in from',
    c2.email === 'typed@example.com',
    'somebody writing from a new address wants the reply there: ' + JSON.stringify(c2));
  check('and the phone still comes across from the record they were matched to',
    c2.phone === '(801) 555-0111' && c2.fromRecord === true, JSON.stringify(c2));
}

/* 8 — the links have to be pressable, which means the dialler gets digits. */
{
  const html = withBook([]).line({topic:'General Question', phone:'+1 (801) 555-0999 ext 4',
    message:'x'});
  /* ⚠ THE TRAP THESE TWO GUARDED IS GONE WITH THE LINK, and that is recorded rather than
     left as two checks that can no longer fail. The old pair proved a `tel:` href was built
     from the digits without welding "ext 4" onto the end — a number that dialled perfectly
     and reached a stranger. There is no href now ([[MSG-16]]), so there is nothing to build
     wrongly; what is left to hold is that the number reaches the row EXACTLY as stored,
     notes and all, because that is what somebody is about to copy. */
  check('a number with an extension is shown exactly as it was typed',
    /\+1 \(801\) 555-0999 ext 4/.test(html), html);
  check('and it is copied exactly as it is shown, extension included',
    /data-copyval="\+1 \(801\) 555-0999 ext 4"/.test(html),
    'pasting a number without its extension is the same wrong call by another route');
}
{
  const html = withBook([]).line({topic:'General Question', phone:'801-55', message:'x'});
  check('a half-typed number is still shown, and is still copyable',
    /801-55/.test(html) && /data-copyval="801-55"/.test(html),
    'it is what the office has: ' + html);
}

/* 9 — a contact detail is text somebody typed, so it is escaped where it is written into
   the page. An unescaped quote ends the href early and the link goes nowhere. */
{
  const html = withBook([]).line({topic:'General Question',
    email: 'a"b<script>@example.com', message:'x'});
  /* ⚠ THE ATTRIBUTE IT COULD BREAK OUT OF IS NOW data-copyval, NOT href. The risk did not
     go away with the link — it moved — and an unescaped quote there ends the attribute and
     puts the rest of the address into the markup as code. */
  check('a quote in an address cannot break out of the copy attribute',
    html.indexOf('data-copyval="a"b') === -1 && /a&quot;b/.test(html), html);
  check('and it cannot inject markup either',
    html.indexOf('<script>') === -1, html);
}

/* ⭐ HOW THEY ASKED TO BE REACHED ([[MSG-16]], 2026-09-10)
   Addie: "we can no longer see how someone prefers to be contacted. Can you make sure that
   is still shown in there request?"
   ⚠ IT WAS NEVER REMOVED AND SHE IS STILL RIGHT — [[MSG-14]] left it behind in the small
   grey meta line with the date while the contact details moved up, so the line she had
   learned to scan no longer had any contact on it and the preference went with the part she
   stopped reading. Rendered is not the same as seen. It sits ON the contact line now,
   against the detail it is an instruction about. */
{
  const book = [SOLO];
  const line = function(pref){
    return withBook(book).line({topic:'General Question', name:'Ada Frost',
      phone:'8015550999', email:'ada@example.com', contactMethod:pref, message:'x'});
  };
  check('a texting preference is shown, beside the phone',
    /Text them/.test(line('Text')), line('Text'));
  /* ⚠ CALL AND TEXT BOTH POINT AT THE PHONE AND ARE NOT THE SAME INSTRUCTION. Ringing
     somebody who asked to be texted is the mistake this exists to stop, so the WORDS have
     to travel — a highlight on the right detail cannot tell the two apart. */
  check('and a calling preference says something different',
    /Call them/.test(line('Call')) && !/Text them/.test(line('Call')));
  check('an email preference is shown too',
    /Email them/.test(line('Email')));
  /* ⚠ IT IS ON THE CONTACT LINE, NOT IN THE META LINE WITH THE DATE. That is the whole of
     what she reported: the words were there and she could not see them. */
  check('the preference is on the contact line, not by the date',
    /row-contact[^>]*>[^<]*(<[^>]+>[^<]*)*Text them/.test(line('Text')) ||
    line('Text').indexOf('Text them') < line('Text').indexOf('row-contact-src') ||
    /row-contact-pref/.test(line('Text')),
    'beside the date it was trivia; beside the number it is an instruction');
  /* ⚠ COMMENTS STRIPPED, AND SCOPED TO THE ROW. The first version searched all of admin.html
     and matched [[MSG-14]]'s own explanatory paragraph — the one describing the `rmeta` line
     that used to run "Prefers text" together with the date. It read the explanation as the
     code and failed on a file that is right: the trap Suites 58, 274, 275, 300 and the
     duplicate-prefix gate have each already learned. */
  const rowSrc = (function(){
    const a = admin.indexOf('function renderMessagesList(');
    const b = admin.indexOf("'<div class=\"rtext\">'", a);
    return admin.slice(a, b).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '');
  })();
  check('and it is not also left in the meta line',
    /rmeta/.test(rowSrc) && !/rmeta[\s\S]{0,120}Prefers/.test(rowSrc),
    'two copies of one fact is how they start disagreeing, and the grey one wins');

  /* ⚠ ANYTHING WE DO NOT RECOGNISE IS KEPT VERBATIM, never guessed at. The field is free
     text on an imported record; reading "do not ring before 6" as a phone preference is how
     somebody gets rung who asked for anything but. */
  const odd = line('do not ring before 6');
  check('an answer nobody anticipated is shown exactly as written',
    /do not ring before 6/.test(odd), odd);
  check('and is not guessed onto the phone or the email',
    !/Call them|Text them|Email them/.test(odd),
    'a guess here is a wrong call, which is the one thing this field exists to prevent');

  /* ⭐ AND A PREFERENCE WE CANNOT ACT ON IS THE ONE MOST WORTH SAYING. Somebody who asked to
     be emailed and left no email currently reads as an ordinary row with a phone number on
     it, and nothing anywhere says they did not want it used. */
  const stranded = withBook([]).line({topic:'General Question', name:'No Email',
    phone:'8015550999', contactMethod:'Email', message:'x'});
  check('asking for an email we do not have is said out loud',
    /row-contact-warn/.test(stranded) && /no email/.test(stranded), stranded);
  check('and a preference we CAN act on raises no warning',
    !/row-contact-warn/.test(line('Text')));

  check('no preference on the message says nothing at all',
    !/row-contact-pref/.test(line('')) && !/row-contact-warn/.test(line('')),
    'most portal-raised messages carry none, and a label on every one of them is noise');
}

/* 10 — ⚠ THE WIRING IS ASSERTED SEPARATELY FROM THE MECHANISM, because this suite calls
   the renderer from its own harness: delete the call from renderMessagesList and every
   check above still passes while the line never appears on the real page. That exact
   sabotage went green across a 5,162-check suite once ([[MSG-11]]'s tab strip). */
{
  const a = admin.indexOf('function renderMessagesList(');
  const rowStart = admin.indexOf('esc(msgErrorWhoLabel(d))', a);
  const rowEnd = admin.indexOf("'<div class=\"rtext\">'", rowStart);
  const row = admin.slice(rowStart, rowEnd);
  check('renderMessagesList actually draws the contact line',
    /msgContactLineHtml\(d\)/.test(row),
    'the mechanism can be perfect and still never reach the screen');
  check('and it draws it under the name, above the address',
    row.indexOf('msgContactLineHtml(d)') < row.indexOf('row-phone-line'),
    'the address is context; the phone and the email are what she opened the row to do');
  check('the meta line no longer repeats the phone and email',
    !/rmeta">'\+esc\(d\.phone\)/.test(row),
    'shown twice, the small grey copy is the one that keeps being read');
}

/* 11 — this block's own standing rule: what you can read, you can find. */
{
  const a = admin.indexOf('function renderMessagesList(');
  const searchBlock = admin.slice(admin.indexOf('const msgDigits', a),
                                  admin.indexOf('const unreadCount', a));
  check('the search box reaches the contact the row actually shows',
    /msgContactFor\(d\)/.test(searchBlock) && !/String\(d\.phone\|\|''\)\.replace/.test(searchBlock),
    'a number printed on screen that the search cannot match is worse than one never shown');
}

/* 12 — ⭐ WHO HIT AN ADMIN ERROR (2026-09-11). Addie, shown two of these rows: "can you
   update this?" Both read "No phone or email on this message, and no record matches it".
   ⚠ THAT SENTENCE DESCRIBES A SEARCH FOR A CUSTOMER WHO WAS NEVER INVOLVED. The office's
   own browser raises these and `reportAdminError` hardcodes name/phone/email empty, so the
   no-contact branch was the only one they could ever reach — and the heading above is blank
   too (`msgErrorWhoLabel` returns '' with no portal link to match), so the row named nobody
   while the address sat in its own body two lines down.
   ⚠ THESE RUN THE RENDERER rather than matching its source, because every claim here is
   about A LINE ON A ROW — the failure this repo has shipped three times is a message that
   is in the file and can never reach the screen. */
{
  /* ⚠ THE FIXTURES ARE HER TWO ACTUAL ROWS, not invented ones. A fix that cannot reach the
     case that prompted it is not finished, and these are old rows carrying the address only
     as prose — exactly what the body fallback exists for. */
  const TWILIO = {topic:'Admin Error', name:'', phone:'', email:'', message:
    'Something went wrong on the admin page.\n\nQuote text send failed: Twilio send failed: ' +
    'Authentication Error - invalid username\n\nWhere: (the dashboard)\n' +
    'Signed in as: addiechichia@gmail.com\nBrowser: Mozilla/5.0'};
  const sent = withBook([]).line(TWILIO);
  check('an admin error names who was signed in',
    /addiechichia@gmail\.com/.test(sent), sent);
  check('and it no longer claims a customer record failed to match',
    sent.indexOf('no record matches it') === -1, sent);

  /* ⚠ "nobody" IS A REAL ANSWER AND MUST SURVIVE AS ONE. reportAdminError writes that word
     when there is no signed-in user, and such a row is the signature of a timer still
     running after a sign-out — the fault `whileSignedIn` was added for. Flattened to "we do
     not know", the row stops being evidence of the thing it is evidence of. */
  const none = withBook([]).line({topic:'Admin Error', name:'', phone:'', email:'',
    message:'Something went wrong.\n\nWhere: (the dashboard)\nSigned in as: nobody'});
  check('a signed-out row says so plainly, rather than being flattened away',
    /Nobody was signed in/.test(none), none);

  /* ⚠ THE FIELD MUST WIN OVER THE BODY, or a reworded body silently changes who a row
     blames. The fixture deliberately disagrees with itself. */
  const both = withBook([]).line({topic:'Admin Error', staffEmail:'dad@example.com',
    name:'', phone:'', email:'', message:'x\nSigned in as: stale@old.example'});
  check('the stored field beats the prose in the body',
    /dad@example\.com/.test(both) && both.indexOf('stale@old.example') === -1, both);

  /* ⚠ AND NOTHING IS BETTER THAN THE OLD SENTENCE. An admin error with no signed-in line at
     all must not fall through to the customer branch it could never satisfy. */
  const bare = withBook([]).line({topic:'Admin Error', name:'', phone:'', email:'',
    message:'Something went wrong.'});
  check('an admin error with nothing to say shows nothing, not a failed lookup',
    bare === '', bare);

  /* ⛔ THE HALF THIS MUST NOT TAKE WITH IT. A MEMBER error is a real customer hitting a real
     failure, and ringing them is the entire point of [[MSG-14]]. A sabotage widening the
     admin branch to every error topic is caught here and nowhere else. */
  const mem = withBook([SOLO]).line({topic:'Member Error', name:'Ada Frost',
    phone:'8015550999', email:'ada@example.com', message:'portal failed'});
  check('a MEMBER error still shows the customer contact',
    /8015550999|801\) 555-0999/.test(mem) && /ada@example\.com/.test(mem), mem);

  /* ⚠ AND THE ADDRESS IS ESCAPED. It comes out of a message body, and `messages` is
     PUBLICLY creatable — so this string is attacker-reachable, unlike a staff email typed
     into a form. */
  const evil = withBook([]).line({topic:'Admin Error', name:'', phone:'', email:'',
    message:'x\nSigned in as: a"b<script>@example.com'});
  check('an address out of the body cannot inject markup',
    evil.indexOf('<script>') === -1 && /a&quot;b/.test(evil), evil);
}

/* =============================================================================
 * ⭐ SECTIONS SHE BUILDS HERSELF ([[MSG-15]])
 * Addie: "for inbox I have no way of adding anything deleting anything or adding a whole
 * new section with subtabs? Can we get that added so I can make it like this?"
 *
 * ⛔ THE LINE THIS MUST NOT CROSS is [[MSG-12]]: folders are not coming back. A section is
 * a SAVED FILTER over the same derived facets, so nothing is moved, a message appears
 * wherever it matches, and deleting a section cannot lose one. These checks are what hold
 * that — they RUN the matcher, because every claim here is about which rows a tab holds.
 * ============================================================================= */
console.log('');
console.log('--- sections she builds herself ---');

const MINE = {
  custom: [{
    key: 'c-1', icon: '\u{1F4CC}', label: 'Gate codes',
    filter: {types: ['member'], categories: [], statuses: [], priorities: [], severities: [], search: ''},
    tabs: [
      {key: 't-a', label: 'Unread', filter: {types: [], categories: [], statuses: ['unread'],
                                             priorities: [], severities: [], search: ''}},
      {key: 't-b', label: 'Colours', filter: {types: [], categories: ['Lights / Colors'],
                                              statuses: [], priorities: [], severities: [], search: ''}}
    ]
  }],
  hidden: []
};
sb.setSections(MINE);

const aMemberUnread = {topic: 'General Question', read: false, message: 'what is the gate code'};
const aColourRead   = {topic: 'Change My Light Colors', read: true, responded: true, message: 'red and green'};
const aNotice       = {topic: 'Routes Kept Up To Date', folder: 'System', read: true, message: '29 moved'};

check('a custom section holds what its own filter says',
  sb.matches(aMemberUnread, 'c-1', 'all') === true &&
  sb.matches(aNotice, 'c-1', 'all') === false,
  'the section filter is Member Messages, so a route sweep is not in it');
check('and a subtab narrows the section rather than replacing it',
  sb.matches(aMemberUnread, 'c-1', 't-a') === true &&
  sb.matches(aColourRead, 'c-1', 't-a') === false,
  'the Unread subtab must still be inside Member Messages, not across everything');
check('a second subtab picks a different slice of the same section',
  sb.matches(aColourRead, 'c-1', 't-b') === true &&
  sb.matches(aMemberUnread, 'c-1', 't-b') === false);

/* ⚠ THE SECTION FILTER IS AN AND, NOT A STARTING POINT. A subtab that matched on its own
   would quietly widen the section — a Payments subtab under a Member section would start
   showing system payment notices, which is the folder-shaped confusion this replaced. */
{
  const wide = {custom: [{key: 'c-2', label: 'X', icon: '\u{1F4CC}',
    filter: {types: ['member'], categories: [], statuses: [], priorities: [], severities: [], search: ''},
    tabs: [{key: 't-x', label: 'Errors', filter: {types: ['error'], categories: [], statuses: [],
                                                  priorities: [], severities: [], search: ''}}]}], hidden: []};
  sb.setSections(wide);
  const anErr = {topic: 'Member Error', read: false, message: 'RSVP failed'};
  check('a subtab can never reach outside its section',
    sb.matches(anErr, 'c-2', 't-x') === false,
    'both filters have to pass — a subtab is a narrowing, never a second opinion');
  sb.setSections(MINE);
}

/* ⚠ AN EMPTY LIST MEANS "DO NOT CARE", NOT "MATCH NOTHING". Read the other way a
   half-built section shows zero and reads as broken rather than as unnarrowed. */
check('a filter with nothing ticked matches everything',
  sb.filter(aNotice, {types: [], categories: [], statuses: [], priorities: [], severities: [], search: ''}) === true &&
  sb.filter(aMemberUnread, {}) === true);
/* ⚠ AND TICKS ACROSS TWO ROWS HAVE TO BOTH MATCH — "a colour question that is still
   unread" is the shape somebody actually wants, and it is what the built-ins already do. */
check('ticks in different rows are ANDed',
  sb.filter(aColourRead, {categories: ['Lights / Colors'], statuses: ['unread']}) === false &&
  sb.filter(aColourRead, {categories: ['Lights / Colors'], statuses: ['resolved']}) === true);
check('ticks in the same row are ORed',
  sb.filter(aColourRead, {categories: ['Payment', 'Lights / Colors']}) === true);
check('the words filter reads the topic, the message and the name',
  sb.filter(aMemberUnread, {search: 'gate code'}) === true &&
  sb.filter(aMemberUnread, {search: 'invoice'}) === false);

/* ⚠ A TAB SHE HAS JUST DELETED SHOWS THE SECTION, NOT AN EMPTY LIST. She can delete a
   subtab while standing on it, and zero rows there reads as the section being broken. */
check('a subtab that no longer exists falls back to the section',
  sb.matches(aMemberUnread, 'c-1', 't-gone') === true);

/* ⚠ AND AN UNKNOWN SECTION IS NOT A CUSTOM ONE. `commSectionByKey` returning null must
   drop through to the built-in branches, or hiding a section would break every view. */
check('the built-in sections still work with custom ones present',
  sb.matches(aNotice, 'system', 'all') === true &&
  sb.matches(aMemberUnread, 'member', 'questions') === true);

/* =============================================================================
 * ⭐ THE NOs GET THEIR OWN SECTION ([[RS-59]], 2026-09-11)
 *
 * Addie: "can we have no emails be there own section and it will go in the folder with the
 * response they choose", then "I mean No RSVPs."
 *
 * ⛔ NOTHING WAS WRITTEN TO THE INBOX AT ALL when somebody declined. The record changed, they
 * came off every upcoming route, their lights were queued for recycling and their referral was
 * taken back — and the one list the office reads every morning said nothing. So there was no
 * message for a section to hold, and the section is only half of this: functions/index.js
 * raises the note, and that half is checked in run-all.js where the server lives.
 * ============================================================================= */
console.log('');
console.log('--- the No RSVPs section ---');
{
  const noRow  = {topic:'RSVP — Not This Year', folder:'System', read:false, message:'x'};
  const bnyRow = {topic:'RSVP — Back Next Year', folder:'System', read:false, message:'y'};
  const other  = {topic:'Routes Kept Up To Date', folder:'System', read:true, message:'z'};

  check('both answers reach the No RSVPs section',
    sb.matches(noRow, 'rsvpno', 'all') === true &&
    sb.matches(bnyRow, 'rsvpno', 'all') === true);
  check('and nothing else does',
    sb.matches(other, 'rsvpno', 'all') === false &&
    sb.matches({topic:'General Question', read:false, message:'q'}, 'rsvpno', 'all') === false);
  /* ⭐ "IT WILL GO IN THE FOLDER WITH THE RESPONSE THEY CHOOSE" — her words, and the two are
     genuinely different decisions: Not This Year queues a recycle and puts the customer
     number back in the pool, Back Next Year keeps them on the books for the season after. One
     folder for both hides that on the screen where it is acted on. */
  check('Not This Year and Back Next Year are separate folders',
    sb.matches(noRow,  'rsvpno', 'no') === true &&
    sb.matches(bnyRow, 'rsvpno', 'no') === false &&
    sb.matches(bnyRow, 'rsvpno', 'backnextyear') === true &&
    sb.matches(noRow,  'rsvpno', 'backnextyear') === false);
  /* ⛔ AND NEITHER READS AS A MEMBER MESSAGE NEEDING A REPLY. These are the app reporting
     what a customer DID, not the customer writing to us — and on a send of ~960 they will
     outnumber real questions. Burying the reply queue under them is the complaint the whole
     Communication Centre exists to fix. */
  /* ⚠ THE FIXTURE HAS TO DROP `folder: 'System'`, or this proves nothing about the topic
     list: msgTypeOf answers off that folder first, so a row carrying it is a system notice
     whatever the topics say. The red-check reported the sabotage that removed both names
     from SYSTEM_NOTICE_TOPICS as MISSED, which is exactly what it is for. */
  check('a declined RSVP is a system notice, not a member message',
    sb.facets({topic:'RSVP — Not This Year', read:false, message:'x'}).type === 'system' &&
    sb.facets({topic:'RSVP — Back Next Year', read:false, message:'y'}).type === 'system',
    'got ' + sb.facets({topic:'RSVP — Not This Year', read:false, message:'x'}).type +
    ' — the TOPIC has to classify it, because a message written without the System folder ' +
    'would otherwise land in the reply queue');
  check('and never lands in the Inbox reply queue',
    sb.matches(noRow, 'inbox', 'all') === false &&
    sb.matches(noRow, 'inbox', 'needs_reply') === false,
    'they would outnumber the real questions and bury them');
  check('but the System Messages section still holds them',
    sb.matches(noRow, 'system', 'all') === true,
    'a notice that is in no system view either is one nobody can audit');
  /* ⚠ READ OFF THE TOPIC, never off the customer's current rsvpStatus. A message is a record
     of what somebody said on a day; re-deciding it from the record would move old notes
     between folders every time a customer changed their mind. */
  /* ⛔ AND THE SECTION EXISTS IN THE SIDEBAR. Every check above drives commRowMatches,
     which answers for the key whether or not anything offers it — so renaming the section
     out of COMM_SECTIONS left them all green while there was nowhere on screen to read
     these notes. That gap went green across a 5,162-check suite once already (the Edit
     Customer tab strip), and the red-check caught it here. */
  /* ⚠ AND `RSVP_DECLINE_REASONS` COMES WITH IT ([[RS-60]]). The No RSVPs section now
     builds a folder per reason from that list rather than typing the tabs out, so lifting
     COMM_SECTIONS alone dies on a bare ReferenceError and takes the whole file with it —
     the extraction-list trap, working exactly as documented. Lifted, never stubbed: a
     stubbed list would let this gate stay green while the tabs and the picker offered
     different folders. */
  const rsvpSec = new Function(commSectionsSrc() + 'return COMM_SECTIONS;')()
    .find(function(x){ return x.key === 'rsvpno'; });
  check('the No RSVPs section is offered in the sidebar',
    !!rsvpSec, 'the rule answers for a section nobody can open');
  check('and it carries a folder for each answer',
    !!rsvpSec && rsvpSec.tabs.some(function(t){ return t[0] === 'no'; }) &&
    rsvpSec.tabs.some(function(t){ return t[0] === 'backnextyear'; }),
    'her words: "it will go in the folder with the response they choose"');
  check('the folder is decided by what they answered, not by where they are now',
    sb.matches(Object.assign({}, noRow, {rsvpStatus: 'yes'}), 'rsvpno', 'no') === true,
    'somebody who said no in October and yes in November has two records, not one that moves');

  /* =========================================================================
     ⭐ AND A FOLDER PER REASON ([[RS-60]], 2026-09-11). Addie: "okay i need it to be
     optional choice", and her words the day before — "it will go in the folder with the
     response they choose" — are what this finishes: the answer picks the section, the
     reason picks the folder inside it.
     ⚠ THE WHOLE BRANCH WENT UNTESTED UNTIL THE RED-CHECK SAID SO. Replacing it with a
     bare `return true` passed the entire file: every check above drives the two ANSWER
     tabs, and nothing anywhere drove a `why:` one. A tab that matches everything reads as
     a working folder holding the whole season's declines.
     ========================================================================= */
  {
    const because = (reason) => Object.assign({}, noRow, {rsvpDeclineReason: reason});
    const moved = because('Moved'), broke = because('Finances'), silent = noRow;

    check('a reason files the note into that reason\'s folder',
      sb.matches(moved, 'rsvpno', 'why:Moved') === true &&
      sb.matches(broke, 'rsvpno', 'why:Finances') === true,
      'her words: "it will go in the folder with the response they choose"');
    /* ⛔ AND NOT INTO ANY OTHER. A tab that matches everything is the sabotage above. */
    check('and into no other reason\'s folder',
      sb.matches(moved, 'rsvpno', 'why:Finances') === false &&
      sb.matches(broke, 'rsvpno', 'why:Moved') === false,
      'a folder holding every decline answers nothing the All tab does not');
    /* ⚠ SOMEBODY WHO NEVER SAID WHY IS IN NO REASON FOLDER. The reason is optional, so
       this is the ordinary case rather than an edge one — and treating a blank as a match
       would put every silent decline in whichever folder sorts first. */
    check('and somebody who never said why is in none of them',
      sb.matches(silent, 'rsvpno', 'why:Moved') === false &&
      sb.matches(silent, 'rsvpno', 'why:Finances') === false,
      'the reason is optional; a blank must not read as an answer');
    /* ⚠ BUT THEY ARE STILL IN THE SECTION. A decline with no reason is still a decline,
       and dropping it off All would hide the very people the office wants to ring. */
    check('but they are still in the section, and in their answer\'s folder',
      sb.matches(silent, 'rsvpno', 'all') === true &&
      sb.matches(silent, 'rsvpno', 'no') === true,
      'a decline with no reason is still a decline');
    /* ⛔ AND A REASON NEVER DRAGS A NOTE OUT OF ITS ANSWER. The two are different
       questions — what they said, and why — so a Moved back-next-year is in the Back Next
       Year folder AND in Moved, never in Not This Year. */
    check('a reason does not move a note out of its answer folder',
      sb.matches(Object.assign({}, bnyRow, {rsvpDeclineReason: 'Moved'}), 'rsvpno', 'backnextyear') === true &&
      sb.matches(Object.assign({}, bnyRow, {rsvpDeclineReason: 'Moved'}), 'rsvpno', 'why:Moved') === true &&
      sb.matches(Object.assign({}, bnyRow, {rsvpDeclineReason: 'Moved'}), 'rsvpno', 'no') === false,
      'the answer and the reason are different questions and both are asked');
    /* ⚠ AND THE TABS OFFERED MATCH THE LIST THE PICKER DRAWS, read out of the page rather
       than typed here — these strings are folder names in three files, and a tab naming a
       reason the customer is never offered is a folder that can only ever be empty. */
    const reasons = new Function(liftConst('RSVP_DECLINE_REASONS') + 'return RSVP_DECLINE_REASONS;')();
    check('every reason the picker offers has a folder to land in',
      !!rsvpSec && reasons.every(function(r){
        return rsvpSec.tabs.some(function(t){ return t[0] === 'why:' + r; });
      }) && reasons.length > 1,
      'a reason with no folder files a real answer where nobody is looking');
  }
}

/* =============================================================================
 * ⭐ THE NAV IS HERS — NAMED SECTIONS AND FOLDERS SHE FILLS ([[MSG-19]], 2026-09-11)
 *
 * Addie, in five messages: "on inbox we need to be able to add a folder to each section not
 * just a new section"; "in what type does this belong to we should have a spot for nothing so
 * we can just move emails into it for my completed folder"; "I also don't like the filters you
 * set for me we can just put everything in inbox and we can choose what section they go in from
 * there. Then put them in completed afterward. In other words I can choose what all sections are
 * called and all folders are called"; "And I need to be able to put emails in the folders as
 * well like drag and drop."
 *
 * ⛔ THIS REVERSES [[MSG-15]], WHICH WAS ALSO HERS. R-024 — the later answer is the one to
 * trust — and these checks are the "say so when you apply it" half. The three checks above that
 * asserted the old design are repointed rather than deleted, each saying what it now claims.
 * ============================================================================= */
console.log('');
console.log('--- her own sections and folders ---');
{
  const filed   = {topic:'General Question', read:true, message:'x', folder:'Completed', filedByHand:true};
  const unfiled = {topic:'General Question', read:true, message:'x'};
  /* ⚠ A MESSAGE THE TOPIC TABLE FILES BY ITSELF, which is NOT somebody having filed it —
     `messageFolderOf` answers "Cancellations" for this with nobody having touched it. */
  const auto    = {topic:'Cancellation Request', read:false, message:'x'};

  check('a view she fills by hand holds what she moved into it',
    sb.filter(filed, {fill:'hand', folder:'Completed'}) === true);
  check('and holds nothing else',
    sb.filter(unfiled, {fill:'hand', folder:'Completed'}) === false &&
    sb.filter(filed,   {fill:'hand', folder:'Somewhere else'}) === false,
    'that is the whole of "a spot for nothing so we can just move emails into it"');
  /* ⛔ THE SAFE DIRECTION, and the other reading is the expensive one: "no folder set, so
     match everything" would empty the entire Inbox into a half-built section the moment she
     opened the editor and before she had typed a name. */
  check('a hand-filled view with no folder name holds nothing at all',
    sb.filter(filed, {fill:'hand', folder:''}) === false &&
    sb.filter(filed, {fill:'hand'}) === false,
    'matching everything while half-built is how a section reads as having eaten the Inbox');
  /* ⚠ AND IT IS STILL A FILTER: nothing is stored against the view, so the same message
     answers the same way for every view that asks, and deleting one strands nothing. */
  check('two views can point at one folder and both hold it',
    sb.filter(filed, {fill:'hand', folder:'Completed'}) === true &&
    sb.filter(filed, {fill:'hand', folder:'Completed'}) === true);

  /* ---- the Inbox is the pile nobody has filed yet ---- */
  check('a message she has filed leaves the Inbox',
    sb.matches(unfiled, 'inbox', 'all') === true &&
    sb.matches(filed,   'inbox', 'all') === false,
    'her words: "put everything in inbox and we can choose what section they go in from ' +
    'there. Then put them in completed afterward" — moving it has to MOVE it');
  /* ⛔ THE ONE THAT WOULD HIDE REAL WORK. messageFolderOf also answers off the TOPIC, for
     messages nobody has touched — a cancellation request files itself into Cancellations.
     Dropping those out of the Inbox would take a cancellation off the one list the office
     reads every morning, which is far worse than the untidiness this fixes. */
  check('but one the app filed by topic does not',
    sb.matches(auto, 'inbox', 'all') === true,
    'nobody moved it — it is unfiled work that happens to have a home folder');
  check('and moving something back to the Inbox returns it',
    sb.matches({topic:'General Question', read:true, message:'x',
                folder:'Inbox', filedByHand:true}, 'inbox', 'all') === true,
    'moving it back is how a mistake is undone, so Inbox itself cannot count as filed away');
  /* ⚠ AND IT IS STILL FINDABLE. A filed message is not deleted and not hidden everywhere —
     it is in its own folder view, which is what stops the Inbox rule losing anything. */
  check('a filed message is still in its folder',
    sb.matches(filed, 'folder:Completed', 'all') === true,
    'the "Your folders" line opens exactly this view, so nothing can become unreachable');
  check('and a folder view holds only that folder',
    sb.matches(unfiled, 'folder:Completed', 'all') === false);

  /* ---- folders she added to a BUILT-IN section ---- */
  sb.setSections({custom: [], hidden: [], builtIn: {member: {label: 'Members', tabs: [
    {key:'t-done', label:'Completed', filter:{fill:'hand', folder:'Completed'}}
  ]}}});
  /* ⚠ BOTH DIRECTIONS, AND THE SECOND IS THE ONE THAT BITES. With only the first, deleting
     the whole branch PASSES — an unknown tab on a built-in falls through to `return true`,
     so a member message matches either way and the check proves nothing about the folder.
     The red-check reported this sabotage as MISSED, which is what it is for. */
  check('a folder she added to a built-in section holds what she moved in',
    sb.matches(filed, 'member', 't-done') === true,
    'her first message: "add a folder to each section not just a new section"');
  check('and holds nothing she has not moved in',
    sb.matches(unfiled, 'member', 't-done') === false,
    'without this the check above passes with the whole branch deleted, because an ' +
    'unrecognised tab on a built-in section falls through to showing everything');
  /* ⛔ AND IT CAN NEVER REACH OUTSIDE ITS SECTION. A folder under Member Messages showing a
     system notice is the folder-shaped confusion all of this replaced — both filters pass,
     or neither counts. */
  check('and can never reach outside the section it is under',
    sb.matches({topic:'Routes Kept Up To Date', folder:'Completed', filedByHand:true,
                read:true, message:'x'}, 'member', 't-done') === false,
    'a system notice is not a member message however it was filed');
  check('and the built-in section itself still works untouched',
    sb.matches(unfiled, 'member', 'all') === true &&
    sb.matches({topic:'Routes Kept Up To Date', folder:'System', read:true, message:'x'},
               'member', 'all') === false,
    'she can rename it and add folders to it; what belongs in it is still code');
  sb.setSections({custom: [], hidden: [], builtIn: {}});
}
/* ⭐ AND THE LINE THAT MUST NOT BE CROSSED, asserted as code rather than left as a note:
   a section is a filter, so nothing about it can WRITE to a message. If a future change
   gives sections a membership list, this is what should go red. */
/* ⚠ SCOPED TO THE SECTION CODE, NOT THE FILE. The first version searched all of admin.html
   for `filedByHand` and failed on correct code: that field is LEGACY filing which [[MSG-12]]
   deliberately still reads, so a message somebody filed before the folders went is still
   found. What must be true is narrower — nothing in the section machinery writes to a
   message at all. */
const sectionCode = (liftFn('commEditSection') + liftFn('saveCommSections') +
                     liftFn('commFilterMatches') + liftFn('commSectionByKey') +
                     liftFn('commAllSections'))
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '');
/* ⚠ NARROWED FOR [[MSG-19]], AND THE NARROWING IS THE WHOLE RULING — say so, per R-024.
   Addie reversed the filter-only design herself: "we can just put everything in inbox and we
   can choose what section they go in from there. Then put them in completed afterward." So a
   view she fills by hand is now a real thing, and the old blanket ban would forbid it.
   ⭐ WHAT SURVIVES UNCHANGED IS THE PART THAT WAS EVER LOAD-BEARING: a section still stores
   NO list of messages. A hand-filled view asks the MESSAGE which folder it is in — the same
   `folder`/`filedByHand` pair the drag, the right-click and Move to… have always written —
   so two views cannot disagree about one message and deleting a view strands nothing.
   `messageIds` is still what must never appear. */
check('a section stores a filter, never a list of messages',
  !/messageIds/.test(sectionCode),
  'a section holding its own list of ids is folders again ([[MSG-12]]) — a message would ' +
  'live in exactly one place and deleting a section could lose it. Asking the message ' +
  'which folder it is in is not that, and is what [[MSG-19]] is built on');
/* ⚠ AND THE ONE WRITE IT IS NOW ALLOWED IS THE OPPOSITE OF FILING. Deleting a hand-filled
   section puts its messages BACK in the Inbox — which is the concrete answer to the worry
   the old blanket ban existed for, now that the Inbox shows the unfiled pile and a message
   left behind would be reachable only by search. */
check('the only message the section machinery writes is one going back to the Inbox',
  !/msgBulkApply/.test(sectionCode) &&
  /folder: 'Inbox', filedByHand: false/.test(sectionCode) &&
  (sectionCode.match(/doc\(db,\s*'messages'/g) || []).length === 1,
  'a section that could file a message INTO itself would be filing wearing a different ' +
  'name; putting one back is the undo that stops a delete stranding anything');
check('deleting a section only ever rewrites the settings document',
  /saveCommSections/.test(liftFn('commEditSection')) &&
  /setDoc\(doc\(db, 'settings', 'commSections'\)/.test(liftFn('saveCommSections')),
  'it must not touch the messages collection at all');

/* =============================================================================
 * ⭐ AND THE EDITOR IS DRIVEN, NOT READ ([[MSG-15]])
 * ~250 lines of new UI that has never been executed is exactly what this repo has been
 * caught by four times — a message that is in the source is not a message on the screen.
 * These RUN commEditSection against jsdom and read the markup back.
 * ⚠ THE TWO SIDE EFFECTS ARE STUBBED (the Firestore write and the toast) and nothing else:
 * stubbing the filter or the counter would be stubbing the thing under test.
 * ============================================================================= */
console.log('');
console.log('--- the section editor, driven ---');
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (e) { /* reported below, never silently skipped */ }
if(!JSDOM){
  check('jsdom is installed so the editor can be driven', false,
    'run npm install — without it this whole block is skipped, which is the silent pass ' +
    'CLAUDE.md warns about by name');
} else {
  const dom = new JSDOM('<!doctype html><body></body>');
  const win = dom.window, docu = win.document;
  const ED = liftConst('MSG_TYPE_MEMBER') + liftConst('MSG_CATEGORIES') + liftConst('MSG_STATUS') +
    liftConst('MSG_STATUS_LABEL') + liftConst('MSG_PRIORITY') + liftConst('MSG_PRIORITY_LABEL') +
    liftConst('FIX_NOTICE_TOPIC') + liftConst('RSVP_NO_TOPIC') + liftConst('RSVP_BNY_TOPIC') +
    liftConst('SYSTEM_NOTICE_TOPICS') + liftConst('MSG_TOPIC_CATEGORIES') + liftConst('MSG_TEXT_CATEGORIES') +
    liftFn('esc') + liftFn('msgTypeOf') + liftFn('msgCategories') + liftFn('msgStatusOf') +
    liftFn('msgPriorityOf') + liftFn('msgSeverityOf') + liftFn('msgFacets') +
    liftConst('ERROR_FOLDER_MEMBER') + liftConst('ERROR_FOLDER_ADMIN') +
    liftConst('MESSAGE_HOME_FOLDER') + commSectionsSrc() +
    /* ⚠ [[MSG-19]]'s four, lifted not stubbed — the editor opens for a BUILT-IN now, so it
       asks which folders she has already added to one and what that section holds. */
    liftFn('messageFolderOf') + liftFn('msgIsFiledAway') + liftFn('commBuiltInExtras') +
    liftFn('commSectionByKey') + liftFn('commRowMatches') +
    liftFn('commFilterMatches') + liftFn('commEditSection');
  const ed = {};
  new Function('document', 'allMessages', 'commSections', 'saveCommSections', 'toast',
    'confirm', 'alert', 'MEMBER_ERROR_TOPIC', 'ADMIN_ERROR_TOPIC', 'messageFolders',
    'addDoc', 'collection', 'db', 'serverTimestamp', 'updateDoc', 'doc',
    ED + 'this.open = commEditSection;')
    .call(ed, docu,
      [{id: 'm1', data: {topic: 'General Question', read: false, message: 'gate code?'}},
       {id: 'm2', data: {topic: 'Routes Kept Up To Date', folder: 'System', read: true, message: 'x'}}],
      {custom: [], hidden: [], builtIn: {}},
      async function(){ /* the write is not what is under test */ },
      function(){ /* toast */ }, function(){ return true; }, function(){ /* alert */ },
      'Member Error', 'Admin Error', [],
      async function(){ /* the folder document is not what is under test */ },
      function(){ return {}; }, {}, function(){ return null; },
      async function(){ /* putting messages back is checked separately */ }, function(){ return {}; });

  ed.open(null);
  const card = docu.querySelector('.comm-editor');
  check('the editor actually renders', !!card,
    'a popup that produces no markup is the failure four other checks in this repo exist for');
  check('it offers a name and an icon',
    !!docu.getElementById('commEdLabel') && !!docu.getElementById('commEdIcon'));
  /* ⭐ REPOINTED FOR [[MSG-19]], NOT WEAKENED. A new section now starts as a FOLDER she
     fills herself — Addie: "I also don't like the filters you set for me we can just put
     everything in inbox and we can choose what section they go in from there" — so the
     facet rows are behind the other radio rather than on screen first. The claim that
     matters is unchanged and is checked below: every facet is still offered. */
  const fillBoxes = docu.querySelectorAll('[data-f="fill"]');
  check('a new section asks what goes in it, and offers "nothing" as an answer',
    fillBoxes.length === 2 &&
    Array.prototype.some.call(fillBoxes, function(b){ return b.value === 'hand' && b.checked; }),
    'her words: "we should have a spot for nothing so we can just move emails into it"');
  check('and a hand-filled section asks for the folder name, not for filters',
    !!docu.querySelector('[data-f="folder"]') && !docu.querySelector('[data-f="categories"]'),
    'a form showing both answers at once is the most confusing screen available');
  /* ⚠ A HAND-FILLED SECTION STARTS EMPTY, and that is the point rather than a bug: nothing
     lands in it by itself. The old default matched Member Messages, and the reason it was
     not an EMPTY filter is kept in the code — an empty filter matches the route sweeps too. */
  const sectionTab0 = docu.querySelector('[data-edtab="section"]');
  check('and it holds nothing until she moves something in',
    !!sectionTab0 && !/\b[12]\b/.test(sectionTab0.textContent),
    'got "' + (sectionTab0 ? sectionTab0.textContent.trim() : 'no tab') + '"');

  /* ---- and the by-rule half is still all there, one click away ---- */
  const byRule = Array.prototype.find.call(docu.querySelectorAll('[data-f="fill"]'),
    function(b){ return b.value === 'rule'; });
  byRule.checked = true;
  byRule.dispatchEvent(new win.Event('change', {bubbles: true}));
  check('it offers every facet as a row of choices',
    docu.querySelectorAll('[data-f="types"]').length > 0 &&
    docu.querySelectorAll('[data-f="categories"]').length === (new Function(liftConst('MSG_CATEGORIES') + 'return MSG_CATEGORIES.length;')()) &&
    docu.querySelectorAll('[data-f="statuses"]').length > 0 &&
    docu.querySelectorAll('[data-f="priorities"]').length > 0 &&
    !!docu.querySelector('[data-f="search"]'),
    'found ' + docu.querySelectorAll('[data-f="categories"]').length + ' category boxes');
  /* ⚠ THE LIVE COUNT IS THE HALF THAT MAKES IT USABLE, so it is checked as a number on
     screen rather than as a call in the source. Switched to by-rule with nothing ticked it
     shows everything the fixture holds — two — which is what "nothing ticked means any"
     says on the note underneath. */
  const sectionTab = docu.querySelector('[data-edtab="section"]');
  check('and a live count of what the section would hold',
    !!sectionTab && /\b2\b/.test(sectionTab.textContent),
    'got "' + (sectionTab ? sectionTab.textContent.trim() : 'no tab') + '" — the fixture has ' +
    'one member message and one system notice');
  /* ⚠ AND THE RADIO REALLY MOVED THE MODE, rather than merely redrawing: without readAll()
     reading it back before the redraw, the click would be lost and this would still be the
     folder form. That is the same "typing survives a redraw" failure one control along. */
  check('switching to by-rule sticks',
    !docu.querySelector('[data-f="folder"]'),
    'the popup redraws on every change; a mode not read back first is silently lost');

  /* ⭐ AND THE SUBTAB BUTTON IS PRESSED, because "add a whole new section with subtabs" is
     the request and a button that renders but does nothing is the exact bug the recycle
     "bin says" box shipped with. */
  const before = docu.querySelectorAll('[data-edtab]').length;
  docu.getElementById('commEdAddTab').dispatchEvent(new win.MouseEvent('click', {bubbles: true}));
  const after = docu.querySelectorAll('[data-edtab]').length;
  check('pressing ＋ Subtab really adds one',
    after === before + 1, 'went from ' + before + ' to ' + after);
  /* ⚠ REPOINTED FOR [[MSG-19]]: a new subtab is a FOLDER now, so what it offers is a name
     and a folder rather than a name and a category list. Both modes are still reachable. */
  check('and the new folder can be named, and is one she fills herself',
    !!docu.getElementById('commEdTabName') &&
    !!docu.querySelector('.comm-filter [data-f="folder"]'),
    'a subtab that starts as a filter is a folder-shaped thing that is not a folder');
  check('and deleted again',
    !!docu.getElementById('commEdDelTab'));
  docu.getElementById('commEdDelTab').dispatchEvent(new win.MouseEvent('click', {bubbles: true}));
  check('deleting the subtab takes it off the row',
    docu.querySelectorAll('[data-edtab]').length === before,
    'a delete that renders and does nothing is worse than not offering one');

  /* ⚠ AND TYPING SURVIVES A REDRAW. The popup is rebuilt wholesale on every change so the
     counts move, which destroys the inputs — without readAll() first, anything typed is
     silently gone and it reads as the field not saving. */
  docu.getElementById('commEdLabel').value = 'Gate codes';
  docu.querySelector('[data-f="categories"]').dispatchEvent(new win.Event('change', {bubbles: true}));
  check('a name typed before a redraw is still there afterwards',
    docu.getElementById('commEdLabel').value === 'Gate codes',
    'the popup redraws on every tick; anything not read back first is simply lost');
}

/* ⭐ AND THE CONTROLS REACH THE SIDEBAR ([[MSG-15]]) — asserted separately from the editor,
   because the editor passing proves nothing about anybody being able to open it. That exact
   gap went green across a 5,162-check suite once (the Edit Customer tab strip). */
if(JSDOM){
  const dom2 = new JSDOM('<!doctype html><body><div id="commCentreNav"></div></body>');
  const d2 = dom2.window.document;
  const NAV = liftConst('FIX_NOTICE_TOPIC') + liftConst('RSVP_NO_TOPIC') + liftConst('RSVP_BNY_TOPIC') +
    liftConst('MSG_TYPE_MEMBER') + liftConst('SYSTEM_NOTICE_TOPICS') +
    liftConst('MSG_CATEGORIES') + liftConst('MSG_TOPIC_CATEGORIES') + liftConst('MSG_TEXT_CATEGORIES') +
    liftConst('MSG_STATUS') + liftConst('MSG_STATUS_LABEL') + liftConst('MSG_PRIORITY') +
    liftConst('MSG_PRIORITY_LABEL') + liftConst('MSG_SEVERITY_LABEL') + liftConst('COMM_ACTIVITY_TOPICS') +
    commSectionsSrc() +
    liftFn('esc') + liftFn('msgTypeOf') + liftFn('msgCategories') + liftFn('msgStatusOf') +
    liftFn('msgPriorityOf') + liftFn('msgSeverityOf') + liftFn('msgFacets') +
    liftConst('ERROR_FOLDER_MEMBER') + liftConst('ERROR_FOLDER_ADMIN') +
    liftConst('MESSAGE_HOME_FOLDER') +
    /* ⚠ [[MSG-19]]'s five, lifted not stubbed. renderCommNav now asks which folders exist
       (commHandFolders), where a message actually is (messageFolderOf), whether a person put
       it there (msgIsFiledAway) and what she has added to a built-in (commBuiltInExtras) —
       and it died with a bare `commBuiltInExtras is not defined` the moment it did. */
    liftFn('messageFolderOf') + liftFn('msgIsFiledAway') + liftFn('commBuiltInExtras') +
    liftFn('commFilterMatches') + liftFn('commSectionByKey') + liftFn('commAllSections') +
    liftFn('commHandFolders') +
    liftFn('commRowMatches') + liftFn('commRows') + liftFn('commCount') + liftFn('renderCommNav');
  const nav = {};
  new Function('document', 'allMessages', 'commSections', 'commView', 'renderCommDash',
    'renderMessagesList', 'commEditSection', 'saveCommSections', 'confirm', 'toast',
    'MEMBER_ERROR_TOPIC', 'ADMIN_ERROR_TOPIC', 'folderUnread', 'msgBulkApply',
    NAV + 'this.draw = renderCommNav;')
    .call(nav, d2, [{id: 'm1', data: {topic: 'General Question', read: false, message: 'x'}}],
      /* ⚠ ONE OF EACH KIND, deliberately: a section that fills by rule with a by-rule
         subtab, and a folder she fills herself. A fixture with only one kind passes
         whether the two are told apart or not. */
      {custom: [{key: 'c-9', icon: '\u{1F4CC}', label: 'Gate codes',
                 filter: {types: ['member']}, tabs: [{key: 't-1', label: 'Unread',
                 filter: {statuses: ['unread']}},
                {key: 't-2', label: 'Completed', filter: {fill: 'hand', folder: 'Completed'}}]}],
       hidden: ['system'], builtIn: {}},
      {section: 'inbox', tab: 'all'},
      function(){}, function(){}, function(){}, async function(){},
      function(){ return true; }, function(){}, 'Member Error', 'Admin Error',
      /* The unread count beside a stray folder, and the write a drop makes — both stubbed,
         because neither is what this block is about. What IS under test is that the folder
         appears at all and that it accepts a drop. */
      function(){ return 0; }, async function(){});
  nav.draw();
  const host = d2.getElementById('commCentreNav');
  check('the sidebar offers a way to add a section',
    !!d2.getElementById('commAddSection'),
    'the editor is unreachable without it');
  check('her own section is drawn, with its subtabs',
    /Gate codes/.test(host.innerHTML) && /Unread/.test(host.innerHTML));
  check('and its All tab is added rather than stored',
    host.querySelectorAll('[data-commsec="c-9"][data-commtab="all"]').length === 1,
    'a section with one subtab must still have an All that agrees with it');
  /* ⭐ REVERSED BY [[MSG-19]], AND SAID OUT LOUD PER R-024. Addie: "on inbox we need to be
     able to add a folder to each section not just a new section." So EVERY section carries
     the pencil now, hers and the built-ins alike.
     ⚠ WHAT THE OLD CHECK WAS REALLY PROTECTING IS STILL PROTECTED, and it is the line below:
     a built-in can be renamed and given folders, and it can be hidden, but it can never be
     DELETED — every dashboard tile is written in terms of its key. */
  check('every section carries an edit control, hers and the built-ins alike',
    !!host.querySelector('[data-commedit="c-9"]') && !!host.querySelector('[data-commedit="inbox"]'),
    'she asked to add a folder to each section, not only to ones she made');
  check('a built-in also carries a hide control, and only a built-in',
    !!host.querySelector('[data-commhide="inbox"]') && !host.querySelector('[data-commhide="c-9"]'),
    'hiding is what "deleting" means for a list she did not make; deleting one outright ' +
    'would break the dashboard tiles pointing at it');
  /* ⚠ A HIDDEN SECTION IS NAMED, NOT FORGOTTEN. "Where did System Messages go" is a
     question the screen should answer itself. */
  /* ---- [[MSG-19]]: her folders are on screen, and they take a drop ---- */
  /* ⚠ DRIVEN, NOT MATCHED. Every claim here is about a ROW THAT EXISTS and an attribute a
     browser acts on — the exact shape this repo has been caught by four times, where the
     message was in the source and never on the screen. */
  check('a folder she made is a drop target',
    !!host.querySelector('[data-commdrop="Completed"]'),
    'her words: "I need to be able to put emails in the folders as well like drag and drop"');
  /* ⛔ AND A TAB THAT FILLS ITSELF BY RULE IS NOT ONE. Dropping a message on "Unread" could
     only lie about it or do nothing — it is a question about the message, not a place. */
  check('but a by-rule tab is not',
    !host.querySelector('[data-commsec="c-9"][data-commtab="t-1"][data-commdrop]'),
    'offering to file something into "Unread" is a control that can only mislead');
  check('and neither is a built-in section head',
    !host.querySelector('.comm-sec-head[data-commsec="inbox"][data-commdrop]'),
    'System Messages is a rule, not a shelf');

  /* ⭐ NOTHING SHE HAS FILED CAN BECOME UNREACHABLE. With the Inbox now showing the UNFILED
     pile, a folder no section points at — including everything filed before any of this
     existed — would be findable only by search. It is listed, and it is a drop target. */
  /* ⚠ ITS OWN DOCUMENT. Rendering into the shared host would overwrite what the checks
     above and below read back off it — which is exactly what happened on the first pass,
     and it failed the hidden-section check on code that was fine. */
  const dom3 = new JSDOM('<!doctype html><body><div id="commCentreNav"></div></body>');
  const d3 = dom3.window.document;
  const stray = {};
  new Function('document', 'allMessages', 'commSections', 'commView', 'renderCommDash',
    'renderMessagesList', 'commEditSection', 'saveCommSections', 'confirm', 'toast',
    'MEMBER_ERROR_TOPIC', 'ADMIN_ERROR_TOPIC', 'folderUnread', 'msgBulkApply',
    NAV + 'this.draw = renderCommNav;')
    .call(stray, d3,
      [{id: 'm9', data: {topic: 'General Question', read: false, message: 'x',
                         folder: 'Old stuff', filedByHand: true}}],
      {custom: [], hidden: [], builtIn: {}}, {section: 'inbox', tab: 'all'},
      function(){}, function(){}, function(){}, async function(){},
      function(){ return true; }, function(){}, 'Member Error', 'Admin Error',
      function(){ return 3; }, async function(){});
  stray.draw();
  const strayHost = d3.getElementById('commCentreNav');
  check('a folder no section points at is still listed',
    /Old stuff/.test(strayHost.innerHTML) &&
    !!strayHost.querySelector('[data-commfolder="Old stuff"]'),
    'with the Inbox showing the unfiled pile, a message in here would otherwise be ' +
    'reachable only by search — including everything filed before [[MSG-19]] existed');
  check('and it can be opened, and dropped into',
    !!strayHost.querySelector('[data-commfolder="Old stuff"][data-commdrop="Old stuff"]'),
    'a folder that is named and cannot be opened is a worse answer than not naming it');
  check('a hidden section is still listed, with a way back',
    !!host.querySelector('[data-commshow="system"]') &&
    !host.querySelector('[data-commsec="system"]'),
    'hidden with no route back is a feature lost rather than tidied');
}

/* ⭐ AND THE PUTTING-BACK IS DRIVEN, NOT MATCHED ([[MSG-19]]). This is the tier-1 claim of
   the whole change — deleting a folder must not strand what is in it — and the first version
   of the check above was a regex over the source, which a red-check walked straight through
   by wrapping the write in `if(false)`. Every word was still there; nothing ran. That is the
   exact failure this repo records in four other places. */
if(JSDOM){
  const domD = new JSDOM('<!doctype html><body></body>');
  const winD = domD.window, docD = domD.window.document;
  const wrote = [];
  const DEL = liftConst('MSG_TYPE_MEMBER') + liftConst('MSG_CATEGORIES') + liftConst('MSG_STATUS') +
    liftConst('MSG_STATUS_LABEL') + liftConst('MSG_PRIORITY') + liftConst('MSG_PRIORITY_LABEL') +
    /* ⚠ THE FOURTH SANDBOX, AND THE MERGE IS WHAT FOUND IT. This one is [[MSG-19]]'s and
       was written on a branch that had never heard of `FIX_NOTICE_TOPIC`; main added that
       constant to SYSTEM_NOTICE_TOPICS on a branch that had never heard of this sandbox.
       Neither side was wrong and neither side could have caught it — the file only dies
       once both exist, which is the argument for merging rather than pasting. */
    liftConst('FIX_NOTICE_TOPIC') + liftConst('RSVP_NO_TOPIC') + liftConst('RSVP_BNY_TOPIC') +
    liftConst('SYSTEM_NOTICE_TOPICS') + liftConst('MSG_TOPIC_CATEGORIES') + liftConst('MSG_TEXT_CATEGORIES') +
    liftConst('ERROR_FOLDER_MEMBER') + liftConst('ERROR_FOLDER_ADMIN') +
    liftConst('MESSAGE_HOME_FOLDER') + commSectionsSrc() +
    liftFn('esc') + liftFn('msgTypeOf') + liftFn('msgCategories') + liftFn('msgStatusOf') +
    liftFn('msgPriorityOf') + liftFn('msgSeverityOf') + liftFn('msgFacets') +
    liftFn('messageFolderOf') + liftFn('msgIsFiledAway') + liftFn('commBuiltInExtras') +
    liftFn('commSectionByKey') + liftFn('commRowMatches') +
    liftFn('commFilterMatches') + liftFn('commEditSection');
  const del = {};
  const mine = {key: 'c-done', icon: '\u{1F4CC}', label: 'Completed',
                filter: {fill: 'hand', folder: 'Completed'}, tabs: []};
  new Function('document', 'allMessages', 'commSections', 'saveCommSections', 'toast',
    'confirm', 'alert', 'MEMBER_ERROR_TOPIC', 'ADMIN_ERROR_TOPIC', 'messageFolders',
    'addDoc', 'collection', 'db', 'serverTimestamp', 'updateDoc', 'doc',
    DEL + 'this.open = commEditSection;')
    .call(del, docD,
      [{id: 'mA', data: {topic: 'General Question', read: true, message: 'x',
                         folder: 'Completed', filedByHand: true}},
       {id: 'mB', data: {topic: 'General Question', read: true, message: 'y'}}],
      {custom: [mine], hidden: [], builtIn: {}},
      async function(){}, function(){}, function(){ return true; }, function(){},
      'Member Error', 'Admin Error', [],
      async function(){}, function(){ return {}; }, {}, function(){ return null; },
      /* The write under test. Captured rather than stubbed away. */
      async function(ref, patch){ wrote.push({ref: ref, patch: patch}); },
      function(_db, _col, id){ return id; });

  del.open(JSON.parse(JSON.stringify(mine)));
  const delBtn = docD.getElementById('commEdDelete');
  check('a hand-filled section can be deleted', !!delBtn);
  if(delBtn){
    delBtn.dispatchEvent(new winD.MouseEvent('click', {bubbles: true}));
    /* The handler awaits; give the microtasks a turn before reading what it did. */
    const done = new Promise(function(r){ setTimeout(r, 0); });
    pendingChecks.push(done.then(function(){
      check('deleting it puts the messages it held back in the Inbox',
        wrote.length === 1 && wrote[0].ref === 'mA' &&
        wrote[0].patch.folder === 'Inbox' && wrote[0].patch.filedByHand === false,
        'got ' + JSON.stringify(wrote) + ' — with the Inbox showing the unfiled pile, a ' +
        'message left in a deleted folder is reachable only by search');
      check('and leaves messages it never held alone',
        !wrote.some(function(w){ return w.ref === 'mB'; }),
        'mB was never filed anywhere; touching it would be rewriting somebody else\'s row');
    }));
  }
}


Promise.all(pendingChecks).then(function(){
  console.log('');
  console.log('=== The communication centre ===');
  console.log('');
  if(failed){
    console.log('  ' + failed + ' failure(s):');
    failures.forEach(f => console.log('   - ' + f.name + (f.why ? '\n     ' + f.why : '')));
    console.log('');
  }
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
});
