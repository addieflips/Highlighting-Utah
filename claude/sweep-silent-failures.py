import io, re, sys, json

def scripts(path):
    s = io.open(path, encoding='utf-8').read()
    return '\n;\n'.join(re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', s, re.S))

def strip_noise(js):
    """Blank out strings, template literals, regexes and comments so brace
    matching is not fooled by a '}' inside a string. Length is preserved so
    offsets still map back to the original."""
    out = list(js)
    i, n = 0, len(js)
    while i < n:
        c = js[i]
        if c in '"\'`':
            q = c; j = i + 1
            while j < n:
                if js[j] == '\\': j += 2; continue
                if js[j] == q: break
                j += 1
            for k in range(i, min(j + 1, n)):
                if js[k] != '\n': out[k] = ' '
            i = j + 1; continue
        if c == '/' and i + 1 < n and js[i+1] == '/':
            j = js.find('\n', i)
            j = n if j < 0 else j
            for k in range(i, j): out[k] = ' '
            i = j; continue
        if c == '/' and i + 1 < n and js[i+1] == '*':
            j = js.find('*/', i)
            j = n if j < 0 else j + 2
            for k in range(i, j):
                if js[k] != '\n': out[k] = ' '
            i = j; continue
        i += 1
    return ''.join(out)

def block_after(clean, start):
    """Given an index at or before a '{', return (open, close) of that block."""
    o = clean.find('{', start)
    if o < 0: return None
    depth, i, n = 0, o, len(clean)
    while i < n:
        if clean[i] == '{': depth += 1
        elif clean[i] == '}':
            depth -= 1
            if depth == 0: return (o, i)
        i += 1
    return None

def enclosing_fn(js, pos):
    best = None
    for m in re.finditer(r'(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(', js[:pos]):
        best = m.group(1)
    return best or '(top level)'

def scan(path, label):
    js = scripts(path) if path.endswith('.html') else io.open(path, encoding='utf-8').read()
    clean = strip_noise(js)
    rows = []
    for m in re.finditer(r'\bcatch\b\s*(\([^)]*\))?\s*\{', clean):
        span = block_after(clean, m.end() - 1)
        if not span: continue
        o, c = span
        body_clean = clean[o+1:c]
        body_real  = js[o+1:c]
        stripped   = body_clean.strip()
        has_console = 'console.' in body_clean
        tells = any(t in body_clean for t in
                    ('toast(', 'alert(', 'statusEl', '.textContent', 'showBanner',
                     'addDoc(', 'setStatus', 'innerHTML'))
        if not stripped:
            kind = 'EMPTY'
        elif tells:
            kind = 'TELLS'
        elif has_console:
            kind = 'CONSOLE'
        else:
            kind = 'OTHER'          # e.g. sets a flag, increments a counter, rethrows
        rows.append({
            'file': label,
            'line': js[:o].count('\n') + 1,
            'fn': enclosing_fn(js, o),
            'kind': kind,
            'body': ' '.join(body_real.split())[:90],
        })
    return rows

def early_returns(path, label):
    js = scripts(path) if path.endswith('.html') else io.open(path, encoding='utf-8').read()
    clean = strip_noise(js)
    out = []
    for m in re.finditer(r'if\s*\(([^;{}]{1,90})\)\s*return\b([^;]{0,40});', clean):
        cond = m.group(1).strip()
        # only the ones that look like "something was missing", not ordinary logic
        if not re.search(r'^\s*!|\.length\s*(===|==)\s*0|==\s*null|===\s*undefined|^!\w', cond):
            continue
        out.append({'file': label, 'line': js[:m.start()].count('\n') + 1,
                    'fn': enclosing_fn(js, m.start()), 'cond': cond[:70]})
    return out

# ⚠ THE PATHS WERE HARD-CODED TO /tmp COPIES when this was written, so running it
# from a clean checkout scanned nothing and printed "missing" three times — which is
# indistinguishable from a clean repo. It reads the real files beside it now, and
# employee.html was added: the silent-failure map deliberately left it out because it
# is dormant this season, and dormant is not the same as exempt (there was a pool
# return in there losing a customer number outright).
#
# ⭐ THIS IS THE EXPLORATORY TOOL, NOT THE GATE. silent-failures.test.js is the gate
# and runs on every `npm test`; this one prints the shape of the whole problem —
# every catch classified, plus the silent early returns, which no gate touches. Kept
# so the numbers in silent-failures.md can be re-derived rather than believed.
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

if __name__ == '__main__':
    targets = [(os.path.join(ROOT, 'admin.html'), 'admin.html'),
               (os.path.join(ROOT, 'index.html'), 'index.html'),
               (os.path.join(ROOT, 'employee.html'), 'employee.html'),
               (os.path.join(ROOT, 'functions/index.js'), 'functions/index.js')]
    allrows, allret = [], []
    for p, lab in targets:
        try:
            r = scan(p, lab); allrows += r
            e = early_returns(p, lab); allret += e
        except FileNotFoundError:
            print('missing', p); continue
    print('=== CATCH BLOCKS, brace-matched ===')
    for lab in ['admin.html', 'index.html', 'employee.html', 'functions/index.js']:
        rs = [r for r in allrows if r['file'] == lab]
        if not rs: continue
        from collections import Counter
        c = Counter(r['kind'] for r in rs)
        print('%-20s total %3d   EMPTY %3d   CONSOLE %3d   TELLS %3d   OTHER %3d'
              % (lab, len(rs), c['EMPTY'], c['CONSOLE'], c['TELLS'], c['OTHER']))
    print()
    print('=== SILENT EARLY RETURNS (missing-thing guards) ===')
    for lab in ['admin.html', 'index.html', 'employee.html', 'functions/index.js']:
        n = len([e for e in allret if e['file'] == lab])
        print('%-20s %d' % (lab, n))
    out = os.environ.get('SWEEP_OUT', os.path.join(ROOT, 'sweep.json'))
    json.dump({'catches': allrows, 'returns': allret}, io.open(out, 'w'), indent=1)
    print('\nwritten ' + out)
