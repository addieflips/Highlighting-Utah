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
const NAMES = ['MSG_TYPE_MEMBER','SYSTEM_NOTICE_TOPICS','MSG_CATEGORIES','MSG_TOPIC_CATEGORIES',
  'MSG_TEXT_CATEGORIES','MSG_STATUS','MSG_STATUS_LABEL','MSG_PRIORITY','MSG_PRIORITY_LABEL',
  'MSG_SEVERITY_LABEL','COMM_ACTIVITY_TOPICS'];
/* ⚠ commRowMatches CALLS BOTH OF THESE NOW ([[MSG-15]]) — lifted, never stubbed. A stub for
   commSectionByKey would decide for itself which sections exist, which is exactly the thing
   under test; and the suite dies with a bare ReferenceError rather than skipping, which is
   the extraction-list trap CLAUDE.md describes working as intended. */
const SRC = NAMES.map(liftConst).join('') +
  liftFn('msgTypeOf') + liftFn('msgCategories') + liftFn('msgStatusOf') +
  liftFn('msgPriorityOf') + liftFn('msgSeverityOf') + liftFn('msgFacets') +
  liftFn('commFilterMatches') + liftFn('commSectionByKey') + liftFn('commRowMatches');
const sb = {};
new Function('MEMBER_ERROR_TOPIC', 'ADMIN_ERROR_TOPIC', 'commSections',
  'let __cs = commSections;' + SRC.replace(/\bcommSections\b(?!\s*[,)])/g, '__cs') +
  'this.facets = msgFacets; this.matches = commRowMatches; this.filter = commFilterMatches;' +
  'this.setSections = function(v){ __cs = v; };')
  .call(sb, 'Member Error', 'Admin Error', {custom: [], hidden: []});

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
  liftConst('MSG_TYPE_MEMBER') + liftConst('SYSTEM_NOTICE_TOPICS') +
  liftFn('esc') + liftFn('fmtPhone') + liftFn('msgTypeOf') +
  liftFn('msgErrorTokenTail') + liftFn('msgErrorWhoIs') +
  liftFn('msgContactCustomer') + liftFn('msgContactFor') + liftFn('msgContactLineHtml');
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
  check('a message that carries both shows both, as links you can press',
    /href="tel:8015550999"/.test(html) && /href="mailto:ada@example\.com"/.test(html),
    html);
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
    /mailto:ada@example\.com/.test(html), html);
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
    /href="tel:8015550111"/.test(o.line({topic:'General Question', phone:'(801) 555-0111', message:'x'})),
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
    /tel:8015550111/.test(html) && /mailto:dana@example\.com/.test(html),
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
    !/mailto:/.test(html), html);
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
  check('punctuation is stripped out of the tel: link but kept in what is shown',
    /href="tel:\+18015550999"/.test(html) && /\+1 \(801\) 555-0999 ext 4/.test(html), html);
  /* ⚠ THIS CHECK FOUND A REAL ONE. Stripping punctuation alone turned that number into
     tel:+180155509994 — the 4 of "ext 4" welded on the end. Eleven digits, dials
     perfectly, and reaches a stranger. */
  check('an extension is not welded onto the end of the number',
    !/8015550999\d/.test(html), html);
}
{
  const html = withBook([]).line({topic:'General Question', phone:'801-55', message:'x'});
  check('a number too short to ring is shown but not made a link',
    /801-55/.test(html) && !/href="tel:/.test(html),
    'a link that dials four digits is a wrong call somebody makes by accident: ' + html);
}

/* 9 — a contact detail is text somebody typed, so it is escaped where it is written into
   the page. An unescaped quote ends the href early and the link goes nowhere. */
{
  const html = withBook([]).line({topic:'General Question',
    email: 'a"b<script>@example.com', message:'x'});
  check('a quote in an address cannot break out of the href',
    html.indexOf('mailto:a"b') === -1 && /mailto:a&quot;b/.test(html), html);
  check('and it cannot inject markup either',
    html.indexOf('<script>') === -1, html);
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
check('a section stores a filter, never a list of messages',
  !/messageIds|filedByHand/.test(sectionCode),
  'that would be folders again ([[MSG-12]]) — a message would then live in exactly one ' +
  'place and deleting a section could lose it');
check('and nothing in the section machinery writes to a message',
  !/doc\(db,\s*'messages'/.test(sectionCode) && !/msgBulkApply/.test(sectionCode),
  'a saved filter that edited rows would be filing wearing a different name');
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
    liftConst('SYSTEM_NOTICE_TOPICS') + liftConst('MSG_TOPIC_CATEGORIES') + liftConst('MSG_TEXT_CATEGORIES') +
    liftFn('esc') + liftFn('msgTypeOf') + liftFn('msgCategories') + liftFn('msgStatusOf') +
    liftFn('msgPriorityOf') + liftFn('msgSeverityOf') + liftFn('msgFacets') +
    liftFn('commFilterMatches') + liftFn('commEditSection');
  const ed = {};
  new Function('document', 'allMessages', 'commSections', 'saveCommSections', 'toast',
    'confirm', 'alert', 'MEMBER_ERROR_TOPIC', 'ADMIN_ERROR_TOPIC',
    ED + 'this.open = commEditSection;')
    .call(ed, docu,
      [{id: 'm1', data: {topic: 'General Question', read: false, message: 'gate code?'}},
       {id: 'm2', data: {topic: 'Routes Kept Up To Date', folder: 'System', read: true, message: 'x'}}],
      {custom: [], hidden: []},
      async function(){ /* the write is not what is under test */ },
      function(){ /* toast */ }, function(){ return true; }, function(){ /* alert */ },
      'Member Error', 'Admin Error');

  ed.open(null);
  const card = docu.querySelector('.comm-editor');
  check('the editor actually renders', !!card,
    'a popup that produces no markup is the failure four other checks in this repo exist for');
  check('it offers a name and an icon',
    !!docu.getElementById('commEdLabel') && !!docu.getElementById('commEdIcon'));
  check('it offers every facet as a row of choices',
    docu.querySelectorAll('[data-f="types"]').length > 0 &&
    docu.querySelectorAll('[data-f="categories"]').length === (new Function(liftConst('MSG_CATEGORIES') + 'return MSG_CATEGORIES.length;')()) &&
    docu.querySelectorAll('[data-f="statuses"]').length > 0 &&
    docu.querySelectorAll('[data-f="priorities"]').length > 0 &&
    !!docu.querySelector('[data-f="search"]'),
    'found ' + docu.querySelectorAll('[data-f="categories"]').length + ' category boxes');
  /* ⚠ THE LIVE COUNT IS THE HALF THAT MAKES IT USABLE, so it is checked as a number on
     screen rather than as a call in the source. A new section starts on Member Messages,
     and the fixture holds exactly one member message and one system notice. */
  const sectionTab = docu.querySelector('[data-edtab="section"]');
  check('and a live count of what the section would hold',
    !!sectionTab && /\b1\b/.test(sectionTab.textContent),
    'got "' + (sectionTab ? sectionTab.textContent.trim() : 'no tab') + '" — the fixture has ' +
    'one member message and one system notice, and a new section starts on Member Messages');
  check('a new section does not start matching everything',
    !!sectionTab && !/\b2\b/.test(sectionTab.textContent),
    'an empty filter would show the route sweeps too, which reads as broken rather than as unnarrowed');

  /* ⭐ AND THE SUBTAB BUTTON IS PRESSED, because "add a whole new section with subtabs" is
     the request and a button that renders but does nothing is the exact bug the recycle
     "bin says" box shipped with. */
  const before = docu.querySelectorAll('[data-edtab]').length;
  docu.getElementById('commEdAddTab').dispatchEvent(new win.MouseEvent('click', {bubbles: true}));
  const after = docu.querySelectorAll('[data-edtab]').length;
  check('pressing ＋ Subtab really adds one',
    after === before + 1, 'went from ' + before + ' to ' + after);
  check('and the new subtab can be named and filtered',
    !!docu.getElementById('commEdTabName') && !!docu.querySelector('.comm-filter [data-f="categories"]'));
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
  const NAV = liftConst('MSG_TYPE_MEMBER') + liftConst('SYSTEM_NOTICE_TOPICS') +
    liftConst('MSG_CATEGORIES') + liftConst('MSG_TOPIC_CATEGORIES') + liftConst('MSG_TEXT_CATEGORIES') +
    liftConst('MSG_STATUS') + liftConst('MSG_STATUS_LABEL') + liftConst('MSG_PRIORITY') +
    liftConst('MSG_PRIORITY_LABEL') + liftConst('MSG_SEVERITY_LABEL') + liftConst('COMM_ACTIVITY_TOPICS') +
    liftConst('COMM_SECTIONS') +
    liftFn('esc') + liftFn('msgTypeOf') + liftFn('msgCategories') + liftFn('msgStatusOf') +
    liftFn('msgPriorityOf') + liftFn('msgSeverityOf') + liftFn('msgFacets') +
    liftFn('commFilterMatches') + liftFn('commSectionByKey') + liftFn('commAllSections') +
    liftFn('commRowMatches') + liftFn('commRows') + liftFn('commCount') + liftFn('renderCommNav');
  const nav = {};
  new Function('document', 'allMessages', 'commSections', 'commView', 'renderCommDash',
    'renderMessagesList', 'commEditSection', 'saveCommSections', 'confirm', 'toast',
    'MEMBER_ERROR_TOPIC', 'ADMIN_ERROR_TOPIC',
    NAV + 'this.draw = renderCommNav;')
    .call(nav, d2, [{id: 'm1', data: {topic: 'General Question', read: false, message: 'x'}}],
      {custom: [{key: 'c-9', icon: '\u{1F4CC}', label: 'Gate codes',
                 filter: {types: ['member']}, tabs: [{key: 't-1', label: 'Unread',
                 filter: {statuses: ['unread']}}]}], hidden: ['system']},
      {section: 'inbox', tab: 'all'},
      function(){}, function(){}, function(){}, async function(){},
      function(){ return true; }, function(){}, 'Member Error', 'Admin Error');
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
  check('her section carries an edit control and a built-in does not',
    !!host.querySelector('[data-commedit="c-9"]') && !host.querySelector('[data-commedit="inbox"]'),
    'Delete on a built-in would break the dashboard tiles pointing at it');
  check('a built-in carries a hide control instead',
    !!host.querySelector('[data-commhide="inbox"]'));
  /* ⚠ A HIDDEN SECTION IS NAMED, NOT FORGOTTEN. "Where did System Messages go" is a
     question the screen should answer itself. */
  check('a hidden section is still listed, with a way back',
    !!host.querySelector('[data-commshow="system"]') &&
    !host.querySelector('[data-commsec="system"]'),
    'hidden with no route back is a feature lost rather than tidied');
}

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
