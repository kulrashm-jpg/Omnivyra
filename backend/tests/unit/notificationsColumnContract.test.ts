/**
 * notifications column contract (6f). Five writers inserted columns that do not exist (company_id / body / read;
 * organization_id / category) and every insert was refused and silently dropped - alerts never delivered. This scans
 * EVERY `.from('notifications').insert({...})` / `Table('notifications').insert({...})` object literal in backend/
 * and pages/ and refuses a top-level key that is not a real column (baseline + 20270217000035), and an insert with
 * no user_id (NOT NULL). A writer that builds its rows elsewhere (a mapped array) is listed and must name its
 * columns in the helper it uses (notifyCompanyEvent is unit-tested for exactly that).
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const COLUMNS = new Set(['id', 'user_id', 'company_id', 'type', 'title', 'message', 'metadata', 'is_read', 'created_at']);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'tests' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Top-level keys of the object literal starting at `start` (the `{`). */
function topKeys(src: string, start: number): string[] {
  const keys: string[] = [];
  let depth = 0;
  let i = start;
  let token = '';
  for (; i < src.length; i += 1) {
    const c = src[i];
    if (c === '{' || c === '[' || c === '(') { depth += 1; if (depth === 1) { token = ''; continue; } }
    if (c === '}' || c === ']' || c === ')') { depth -= 1; if (depth === 0) break; }
    if (depth === 1) {
      if (c === ',') { token = ''; continue; }
      if (c === ':' ) { const k = token.trim(); if (/^[A-Za-z_]\w*$/.test(k)) keys.push(k); token = '\u0000'; continue; }
      if (token !== '\u0000') token += c;
    }
  }
  return keys;
}

const SITES = files(path.join(ROOT, 'backend')).concat(files(path.join(ROOT, 'pages'))).flatMap((file) => {
  const src = fs.readFileSync(file, 'utf8');
  const out: Array<{ file: string; line: number; keys: string[] | null }> = [];
  const re = /(?:from|Table)\(\s*'notifications'\s*\)\s*\.insert\(\s*/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const at = m.index + m[0].length;
    const line = src.slice(0, m.index).split('\n').length;
    let keys: string[] | null = null;
    if (src[at] === '{') keys = topKeys(src, at);
    else {
      // A mapped array: `insert(xs.map((x) => ({...})))` inline, or `insert(rows)` where `const rows = xs.map(... => ({...}))`.
      const ident = /^([A-Za-z_]\w*)\s*\)/.exec(src.slice(at));
      const from = ident ? src.lastIndexOf(`const ${ident[1]} =`, at) : at;
      const arrow = from >= 0 ? src.indexOf('=> ({', from) : -1;
      if (arrow >= 0 && arrow - from < 1500) keys = topKeys(src, arrow + 4);
    }
    out.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), line, keys });
  }
  return out;
});

it('finds the notification writers (the scan is not vacuous) and reads EVERY one of them', () => {
  expect(SITES.length).toBeGreaterThanOrEqual(12);
  // Every insert's columns were found - a writer the scanner cannot read fails here, never passes silently.
  // (notifyCompanyEvent's own insert(rows) is the one exception: its row shape is unit-tested in notifyCompanyEvent.)
  expect(SITES.filter((s) => !s.keys && s.file !== 'backend/services/userNotificationService.ts').map((s) => `${s.file}:${s.line}`)).toEqual([]);
  expect(SITES.map((s) => s.file)).toEqual(expect.arrayContaining(['backend/services/userNotificationService.ts']));
});

it.each(SITES.filter((s) => s.keys).map((s) => [`${s.file}:${s.line}`, s.keys as string[]]))(
  '%s inserts only real columns, with user_id',
  (_where, keys) => {
    expect(keys.filter((k) => !COLUMNS.has(k))).toEqual([]);
    expect(keys).toContain('user_id');
  },
);

it('CONTROL: the scanner flags the old broken payload shapes', () => {
  const broken = "x.from('notifications').insert({ company_id: c, type: 't', title: 'x', body: 'b', read: false })";
  const keys = topKeys(broken, broken.indexOf('insert(') + 7);
  expect(keys.filter((k) => !COLUMNS.has(k))).toEqual(['body', 'read']);
  expect(keys).not.toContain('user_id');
});

// 05: the column contract prevents the CAUSE; this prevents the INVISIBILITY. Every notifications insert must READ its
// result - a destructured `{ error ... } = await ...insert(...)` or a `.then(({ error }) => ...)` - because an insert
// can still fail on RLS, a constraint, an FK or a dropped connection, and an unread failure is silent.
const READS = files(path.join(ROOT, 'backend')).concat(files(path.join(ROOT, 'pages'))).flatMap((file) => {
  const src = fs.readFileSync(file, 'utf8');
  const out: Array<{ where: string; reads: boolean }> = [];
  const re = /(?:from|Table)\(\s*'notifications'\s*\)\s*\.insert\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const stmtStart = Math.max(src.lastIndexOf(';', m.index), src.lastIndexOf('{\n', m.index), src.lastIndexOf('}\n', m.index));
    const before = src.slice(stmtStart, m.index);
    let depth = 0;
    let j = m.index + m[0].length - 1;
    for (; j < src.length; j += 1) {
      if (src[j] === '(') depth += 1;
      else if (src[j] === ')') { depth -= 1; if (depth === 0) break; }
    }
    const after = src.slice(j + 1, j + 40);
    const reads = /const\s*\{\s*error\b[^}]*\}\s*=\s*await\b/.test(before) || /^\s*\.then\(/.test(after);
    out.push({ where: `${path.relative(ROOT, file).replace(/\\/g, '/')}:${src.slice(0, m.index).split('\n').length}`, reads });
  }
  return out;
});

it('every notifications insert READS its result (no unread failure)', () => {
  expect(READS.length).toBeGreaterThanOrEqual(13);
  expect(READS.filter((r) => !r.reads).map((r) => r.where)).toEqual([]);
});
