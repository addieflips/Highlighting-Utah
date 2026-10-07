/* shared-plan.test.js — ONE SCHEDULE FOR EVERY COMPUTER (2026-10-07).
 * `npm run test:sharedplan`. Its own file per R-018.
 *
 * Addie: make Recalculate and Reschedule "persist and show for every account and
 * computer, not just the one that ran it". The plan was always saved, but an open copy
 * of Routes read it once and then wrote its own (older) copy back on every redraw.
 *
 * ⚠ IT RUNS THE REAL FUNCTIONS lifted out of admin.html — planBodyJson, saveIfChanged,
 * applyRemotePlan, followPlanLive, recordRecalc, paintLastRecalc — against a fake
 * Firestore listener. Every claim here is about WHICH copy wins and WHETHER a write
 * happens, which a text match cannot see.
 */
const fs = require('fs');
const path = require('path');
const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
let pass = 0, fail = 0;
function check(name, ok, why){ if(ok){ pass++; } else { fail++; console.log('  FAIL ' + name + (why ? ' — ' + why : '')); } }
function extractFn(src, name){
  const start = src.indexOf('function ' + name + '(');
  if(start === -1) return null;
  let i = src.indexOf('{', start), depth = 0;
  for(; i < src.length; i++){
    if(src[i] === '{') depth++;
    else if(src[i] === '}'){ depth--; if(depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}
const NAMES = ['planBodyJson','recalcWho','notePlanSeen','recordRecalc','paintLastRecalc','followPlanLive','applyRemotePlan','saveIfChanged'];
const parts = NAMES.map(function(n){ return extractFn(admin, n); });
NAMES.forEach(function(n, i){ check('found ' + n, !!parts[i], 'a gate that cannot find its target must never report green'); });
if(parts.some(function(p){ return !p; })){ console.log('shared-plan: ' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }

function makeWorld(){
  const W = { state: { plan: {v:1, days:['a']}, lastRecalc:null }, saves:0, mirrors:0, renders:0, toasts:[], listener:null, els:{} };
  const el = function(id){ return W.els[id] || (W.els[id] = {id:id, style:{}, textContent:'', title:''}); };
  const preamble =
    'var PLAN_TAB_ID="me"; var lastPlanJson=null, lastSeenSavedAt=null, LAST_RECALC=null, __liveStop=null, pendingRemotePlan=null;' +
    'var saveTimer=null, recalcRunning=false, preRebuild=null, forecastNoteText="", selSchedule="d1", selFix=null, selTake=null;' +
    'var auth={currentUser:{email:"addie@example.com"}};' +
    'function serialize(){ return {plan:W.state.plan, lastRecalc:LAST_RECALC, savedBy:PLAN_TAB_ID, savedAt:String(Math.random())}; }' +
    'function hydrate(o){ W.state.plan=o.plan; LAST_RECALC=o.lastRecalc||null; }' +
    'function getDay(id){ return id==="d1" ? {} : null; }' +
    'function saveNow(){ W.saves++; }' +
    'function mirrorStampsSoon(){ W.mirrors++; }' +
    'function renderAll(){ W.renders++; }' +
    'function toast(t){ W.toasts.push(t); }' +
    'function PLAN_REF(){ return "plan"; }' +
    'function onSnapshot(ref, fn){ W.listener=fn; return function(){}; }';
  const api = new Function('W','RT', preamble + parts.join('\n') +
    '; return {get lastPlanJson(){return lastPlanJson;}, set saveTimer(v){saveTimer=v;}, get pending(){return pendingRemotePlan;},' +
    ' get LAST_RECALC(){return LAST_RECALC;}, set preRebuild(v){preRebuild=v;}, get preRebuild(){return preRebuild;},' +
    ' set forecast(v){forecastNoteText=v;}, notePlanSeen:notePlanSeen, followPlanLive:followPlanLive, saveIfChanged:saveIfChanged, recordRecalc:recordRecalc};')(W, {getElementById: el});
  W.api = api;
  W.snap = function(o, pending){ W.listener({exists:function(){return true;}, metadata:{hasPendingWrites:!!pending}, data:function(){return o;}}); };
  return W;
}

/* 1. A redraw with nothing changed writes nothing. */
{
  const W = makeWorld(); W.api.notePlanSeen({savedAt:'s0'});
  W.api.saveIfChanged();
  check('an unchanged plan is not written back', W.saves === 0, 'this is how a stale computer overwrote a newer plan');
  check('...but the record mirror still runs, as it did on every save', W.mirrors === 1);
  W.state.plan = {v:1, days:['a','b']};
  W.api.saveIfChanged();
  check('a real change on this computer is saved', W.saves === 1);
  W.api.saveIfChanged();
  check('and is not saved twice', W.saves === 1);
}
/* 2. Another computer's save reaches this one. */
{
  const W = makeWorld(); W.api.notePlanSeen({savedAt:'s0'}); W.api.followPlanLive();
  check('the open copy listens to the saved plan', typeof W.listener === 'function');
  W.snap({plan:{v:1, days:['x']}, savedBy:'me', savedAt:'s1'});
  check('its own save coming back is ignored', W.renders === 0 && W.state.plan.days[0] === 'a');
  W.snap({plan:{v:1, days:['x']}, savedBy:'other', savedAt:'s0'});
  check('the copy it already shows is not re-applied', W.renders === 0);
  W.snap({plan:{v:1, days:['x']}, savedBy:'other', savedAt:'s2'}, true);
  check('an unconfirmed local echo is ignored', W.renders === 0);
  W.api.preRebuild = '{"old":1}';
  W.snap({plan:{v:1, days:['remote']}, savedBy:'other', savedAt:'s3', lastRecalc:{at:'2026-10-07T20:00:00Z', by:'dax@example.com', summary:'Rebuilt 30 days'}});
  check('another computer\'s plan is applied and redrawn', W.state.plan.days[0] === 'remote' && W.renders === 1);
  check('and the office is told', W.toasts.some(function(t){ return /another computer/.test(t); }));
  check('Undo is dropped — it would throw the other computer\'s work away', W.api.preRebuild === null);
  W.api.saveIfChanged();
  check('applying a remote plan does not write it straight back', W.saves === 0);
}
/* 3. A remote save that lands while this computer has a save queued is held, not lost. */
{
  const W = makeWorld(); W.api.notePlanSeen({savedAt:'s0'}); W.api.followPlanLive();
  W.api.saveTimer = 123;
  W.snap({plan:{v:1, days:['remote']}, savedBy:'other', savedAt:'s4'});
  check('held while a local save is queued', W.state.plan.days[0] === 'a' && !!W.api.pending);
  W.api.saveIfChanged();
  check('applied once the queued save turns out to change nothing', W.state.plan.days[0] === 'remote' && W.saves === 0 && !W.api.pending);
}
{
  const W = makeWorld(); W.api.notePlanSeen({savedAt:'s0'}); W.api.followPlanLive();
  W.api.saveTimer = 123;
  W.snap({plan:{v:1, days:['remote']}, savedBy:'other', savedAt:'s5'});
  W.state.plan = {v:1, days:['mine']};
  W.api.saveIfChanged();
  check('a real change made here still wins, as it always did', W.saves === 1 && W.state.plan.days[0] === 'mine' && !W.api.pending);
}
/* 4. The Recalculate result travels with the plan. */
{
  const W = makeWorld(); W.api.notePlanSeen({savedAt:'s0'});
  W.api.forecast = 'Laid out with the forecast';
  W.api.recordRecalc(['Rebuilt 30 days', '2 new customers added']);
  const r = W.api.LAST_RECALC;
  check('who pressed it, when, and what it said are recorded', r && r.by === 'addie@example.com' && /Rebuilt 30 days/.test(r.summary) && !isNaN(Date.parse(r.at)) && r.forecast === 'Laid out with the forecast');
  check('the result is shown on the season bar', W.els.lastRecalcNote && W.els.lastRecalcNote.style.display === '' && /by addie@example\.com/.test(W.els.lastRecalcNote.textContent));
  W.api.saveIfChanged();
  check('recording a result counts as a change and is saved', W.saves === 1);
}
/* 5. Wiring — the mechanism is worth nothing unless the page calls it. */
check('serialize saves the result and who wrote it', /lastRecalc:LAST_RECALC\?Object\.assign\(\{\},LAST_RECALC\):null,savedBy:PLAN_TAB_ID,savedAt:/.test(admin));
check('hydrate reads the result back', /LAST_RECALC=\(o\.lastRecalc&&/.test(admin));
check('scheduleSave goes through saveIfChanged', /saveTimer=setTimeout\(saveIfChanged,1500\);\}/.test(admin));
check('loading the plan starts following it', /hydrate\(s\.data\(\)\);notePlanSeen\(s\.data\(\)\);loaded=true;[^}]*followPlanLive\(\);/.test(admin));
check('Recalculate records its result', /recordRecalc\(parts\);scheduleSave\(\);/.test(admin));
check('every redraw paints the result line', /paintForecastNote\(\);paintLastRecalc\(\);if\(loaded\)scheduleSave\(\);/.test(admin));
check('the result line exists in the markup', admin.indexOf('id=\\"lastRecalcNote\\"') !== -1);
check('a failed save does not leave the copy marked as saved', /catch\(e\)\{lastPlanJson=null;RT\.getElementById\('saveNote'\)/.test(admin));

console.log('shared-plan: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
