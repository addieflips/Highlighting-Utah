/* GENERATES connections.html AND connections.json
 * ==============================================
 * Built to Addie's mockup, `connections/mockup.html` — one tab, two views. Her
 * instruction with it: "build to it, do not redesign it." The CSS is that file's,
 * copied; the behaviour below is that file's, with the invented data replaced by real
 * data. If the look needs to change, change the mockup first.
 *
 * ⚠ THE PAGE IS GENERATED AND COMMITTED. `connections.test.js` fails if the committed
 * page no longer matches what the manifest declares, because a stale map reads as a
 * current one — which is worse than no map.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { check } = require('./engine');
const grid = require('./grid');
const rules = require('./rules');

const ROOT = path.join(__dirname, '..');
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ⚠ THE COMMIT DATE, NOT THE CLOCK AND NOT THE HASH. Wall-clock makes the file differ on
   every run so it can never be committed clean; the hash names the commit BEFORE the one
   containing it, which is the same problem wearing a different hat. */
function builtFrom() {
  try { return execSync('git log -1 --format=%cs', { cwd: ROOT }).toString().trim(); }
  catch (e) { return ''; }
}

/* ⚠ `write:false` IS FOR THE GATE, NOT A CONVENIENCE. connections.test.js has to
   regenerate the page and compare it with the committed one; letting it call build()
   would have it overwrite the very file it is checking, and the comparison would pass
   for ever. */
function build(opts) {
  const write = !opts || opts.write !== false;
  const manifest = require('./manifest');
  const report = check({ admin: path.join(ROOT, 'admin.html'), server: path.join(ROOT, 'functions', 'index.js') }, manifest);
  const G = grid.build(report, manifest);
  const R = rules.parse();

  /* ---- the grid, in the shape the mockup's renderer expects ------------- */
  const TABS = {};
  Object.keys(G.areas).forEach(area => {
    TABS[area] = {
      note: G.areas[area].rows.length + ' watched thing' + (G.areas[area].rows.length === 1 ? '' : 's') +
        ' that this part of the app touches. Every square is checked against the real code on every build.',
      rows: G.areas[area].rows.map(r => {
        const line = [r.title, r.record];
        grid.DEST.forEach(d => {
          const c = r.cells[d];
          line.push(!c ? '' : c.state === 'bad' ? 'x' : c.state === 'wrn' ? 'w' : c.state === 'set' ? 's' : 'r');
        });
        return line;
      })
    };
  });

  /* ---- the red squares, and what each one breaks ------------------------ */
  const FAULTS = {};
  Object.keys(G.areas).forEach(area => G.areas[area].rows.forEach(r => {
    Object.keys(r.cells).forEach(d => {
      const c = r.cells[d];
      if (c.state !== 'bad' && c.state !== 'wrn') return;
      FAULTS[r.title + '|' + d] = [
        c.state,
        r.title + ' does not reach ' + d,
        [c.why || 'declared here and not found in the code.',
         'Declared at ' + c.anchor + ', in ' + c.where + '.'].concat(c.rules || []),
        null, null
      ];
    });
  }));

  /* ---- what a square means when nothing is wrong with it ---------------- */
  const CELLRULES = {};
  Object.keys(G.areas).forEach(area => G.areas[area].rows.forEach(r => {
    if (CELLRULES[r.title]) return;
    const lines = (r.states || []).map(s => s[0] + ' → ' + s[1]);
    if (r.guard) lines.push('Also guarded by: ' + r.guard);
    CELLRULES[r.title] = [r.plain || '', lines];
  }));

  /* ⭐ THE FINGERPRINT IS WHAT MAKES A CONFIRMATION EXPIRE. Addie confirming a rule is
     confirming THAT WORDING — so when the ruling is later rewritten, her old tick must
     stop counting rather than silently vouching for text she has never read. Same
     mechanism as the health-check decisions, and the same reason: a decision matched by
     name alone outlives the thing it was about.
     ⚠ IT IS THE TEXT, NOT THE ID. The id (MON-01) is the doc name, so an edit LAPSES the
     confirmation instead of orphaning it — she sees "changed since confirmed" on the row
     she confirmed, rather than the row quietly going back to never-read. */
  function ruleFingerprint(b) {
    const s = String(b.name) + '\n' + (b.lines || []).join('\n');
    let h1 = 0x811c9dc5, h2 = 0x1000193;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = ((h1 ^ c) * 0x01000193) >>> 0;
      h2 = ((h2 + c) * 0x85ebca6b) >>> 0;
    }
    return ('0000000' + h1.toString(36)).slice(-7) + ('0000000' + h2.toString(36)).slice(-7);
  }

  /* ---- her rulings, grouped so the reading order means something -------- */
  const SECTIONS = [['new', 'Still standing'], ['lapsed', 'Changed since'],
                    ['unbuilt', 'Decided, not built yet'], ['ok', 'Closed']];
  const RULES = {};
  Object.keys(R.areas).sort().forEach(area => {
    const secs = [];
    SECTIONS.forEach(([st, label]) => {
      const blocks = R.areas[area].blocks.filter(b => b.state === st);
      if (!blocks.length) return;
      secs.push([label, blocks.map(b =>
        [b.name, b.lines, b.state, b.proof, '', b.when, '', b.id, ruleFingerprint(b)])]);
    });
    if (secs.length) RULES[area] = { sections: secs };
  });

  const redTotal = Object.values(FAULTS).filter(f => f[0] === 'bad').length;
  const unread = R.total;

  const behaviour = fs.readFileSync(path.join(__dirname, 'behaviour.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Connections · Highlighting Utah</title><style>' + css + '</style></head><body>' +
    '<div class="wrap"><header><p class="eyebrow">Highlighting Utah · admin</p><h1>Connections</h1>' +
    '<div class="subtabs" role="tablist">' +
    '<button role="tab" aria-selected="true" onclick="tab(\'grid\',this)">Where things go' +
      (redTotal ? '<span class="b red">' + redTotal + '</span>' : '') + '</button>' +
    '<button role="tab" aria-selected="false" onclick="tab(\'rules\',this)">Rules' +
      '<span class="b dim">' + unread + ' to read</span></button>' +
    '</div></header>' +
    '<div id="grid">' +
    '<div class="headline">' + (redTotal
      ? '<b>' + redTotal + ' connection' + (redTotal === 1 ? ' is' : 's are') + ' broken</b> — the red squares below.'
      : '<b>Everything written down is still connected.</b> ' + report.length +
        ' things watched. This cannot tell whether a connection is <i>right</i>, only whether it is <i>there</i> — ' +
        'and nothing appears here until a person adds it.') + '</div>' +
    '<div class="picker" id="picker"></div><p class="note" id="gnote"></p>' +
    '<div class="gridwrap"><table><thead><tr id="ghead"></tr></thead><tbody id="gbody"></tbody></table></div>' +
    '<div class="legend"><span><i class="cell set"></i> writes it</span><span><i class="cell read"></i> reads it</span>' +
    '<span><i class="cell bad"></i> should, doesn’t</span><span><i class="cell wrn"></i> does, never agreed</span>' +
    '<span><i class="rt cust">Customer</i> <i class="rt inv">Invoice</i> which record it is stored on</span></div>' +
    '<div class="detail" id="gdetail">Click any square to see its rules, or a red one to see what’s wrong.</div>' +
    '<p class="note" style="margin-top:18px;">Counts last rebuilt at ' +
      (builtFrom() || 'rebuild date unknown') + '.</p>' +
    '</div><div id="rules" hidden></div></div>' +
    '<script>\nconst DEST=' + JSON.stringify(grid.DEST) + ';\n' +
    'const TABS=' + JSON.stringify(TABS) + ';\n' +
    'const FAULTS=' + JSON.stringify(FAULTS) + ';\n' +
    'const CELLRULES=' + JSON.stringify(CELLRULES) + ';\n' +
    'const RULES=' + JSON.stringify(RULES) + ';\n' + behaviour + '\n</script></body></html>';

  if (write) fs.writeFileSync(path.join(ROOT, 'connections.html'), html);

  /* The couple of hundred bytes the admin badge reads. */
  if (write) fs.writeFileSync(path.join(ROOT, 'connections.json'), JSON.stringify({
    watched: report.length,
    red: redTotal,
    breaks: Object.keys(FAULTS).filter(k => FAULTS[k][0] === 'bad').map(k => ({ where: k.replace('|', ' → ') })),
    unguarded: report.filter(r => !r.spine.guard).map(r => r.spine.field),
    notWatched: (manifest.NOT_WATCHED || []).map(n => n[0]),
    rulings: R.total,
    builtFrom: builtFrom()
  }, null, 1) + '\n');

  return { report: report, grid: G, rules: R, red: redTotal, html: html };
}

if (require.main === module) {
  const r = build();
  console.log('connections.html — ' + r.report.length + ' watched, ' + r.red + ' broken, ' +
    r.rules.total + ' rulings across ' + Object.keys(r.rules.areas).length + ' areas');
  if (r.grid.unmapped.length) console.log('  ⚠ destinations with no column: ' + r.grid.unmapped.join(', '));
}
module.exports = { build: build, render: () => build({ write: false }).html };
