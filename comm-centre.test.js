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
const SRC = NAMES.map(liftConst).join('') +
  liftFn('msgTypeOf') + liftFn('msgCategories') + liftFn('msgStatusOf') +
  liftFn('msgPriorityOf') + liftFn('msgSeverityOf') + liftFn('msgFacets') +
  liftFn('commRowMatches');
const sb = {};
new Function('MEMBER_ERROR_TOPIC', 'ADMIN_ERROR_TOPIC', SRC +
  'this.facets = msgFacets; this.matches = commRowMatches;')
  .call(sb, 'Member Error', 'Admin Error');

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
check('the list is drawn from the view',
  /let filtered = commView\.section === 'folder'/.test(admin));
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
/* ⛔ NOTHING SHE FILED BY HAND IS THROWN AWAY. The blueprint moves folders out of first
   place; it does not delete the folders, and deleting them to honour a redesign would be
   destroying her own filing to make a point. */
check('the folder tree is still rendered, under its own heading',
  /id="customFolderList"/.test(admin) && /comm-yours/.test(admin) &&
  /function renderFolderSidebar/.test(admin));
check('and picking a folder hands the list back to that folder',
  /commView = \{section:'folder', tab:'all'\}/.test(admin),
  'without it the tree highlights one thing while the list shows another');

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
