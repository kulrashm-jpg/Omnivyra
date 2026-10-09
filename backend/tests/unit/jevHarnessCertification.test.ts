/**
 * Harness Certification Matrix conformance (OMNI-32 / S2).
 *
 * scripts/jev-flow/HARNESS-CERTIFICATION.md is a claim about evidence. This suite keeps
 * the claim from drifting away from the evidence:
 *   - every H / N / B row exists exactly once, with all 13 columns;
 *   - every Result is in the certification vocabulary;
 *   - every PASS row cites at least one test, and every cited test still exists in its file;
 *   - every non-PASS row explains itself;
 *   - the preserved findings (H-13 Integrate, N-12 / N-13 service identities, N-14, N-18, B1–B4)
 *     cannot be quietly upgraded;
 *   - the report sections exist and the harness is never claimed to be fully governed.
 * Static only: no network, no git, no Jira, no JEV.
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(__dirname, '../../..');
const DOC_FILE = path.join(REPO, 'scripts', 'jev-flow', 'HARNESS-CERTIFICATION.md');
const TEST_DIR = path.join(REPO, 'backend', 'tests', 'unit');
const DOC = fs.readFileSync(DOC_FILE, 'utf8').replace(/\r\n/g, '\n');

const COLUMNS = ['ID', 'Path', 'Classification', 'Authority', 'Command/API', 'Deterministic Evidence', 'JEV Role', 'Human Gate', 'Negative Test', 'Result', 'Evidence Hash', 'Commit', 'Notes'];
const RESULTS = ['PASS', 'FAIL', 'DEFERRED', 'INSUFFICIENT_EVIDENCE'];
const SNAPSHOT_WORKFLOWS = 'sha256:55df064f31399df81991e09239018c9b91328762d194328371da0ac9c50a9210';
const SNAPSHOT_IDENTITIES = 'sha256:51a65c56511a298ab74cca9cbdc235d9aae65fe82e15cf5914eb3635464f35fe';
const PACKET_IDS = ['jev.unit', 'scripts.typecheck', 'backend-tests.typecheck'];

const pad = (n: number) => String(n).padStart(2, '0');
const EXPECTED_IDS = [
  ...Array.from({ length: 14 }, (_, i) => `H-${pad(i + 1)}`),
  'H-06b',
  'H-06c',
  ...Array.from({ length: 22 }, (_, i) => `N-${pad(i + 1)}`),
  'B1',
  'B2',
  'B3',
  'B4',
];

type Row = Record<string, string>;

/** Splits one markdown table line into trimmed cells (no cell contains a pipe). */
function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function parseRows(doc: string): { rows: Row[]; headers: string[][]; malformed: string[] } {
  const rows: Row[] = [];
  const headers: string[][] = [];
  const malformed: string[] = [];
  for (const line of doc.split('\n')) {
    if (!line.startsWith('|')) continue;
    const c = cells(line);
    if (c[0] === 'ID') {
      headers.push(c);
      continue;
    }
    if (!/^(H-\d{2}[a-z]?|N-\d{2}|B\d)$/.test(c[0])) continue;
    if (c.length !== COLUMNS.length) {
      malformed.push(`${c[0]}: ${c.length} cells`);
      continue;
    }
    rows.push(Object.fromEntries(COLUMNS.map((k, i) => [k, c[i]])));
  }
  return { rows, headers, malformed };
}

const { rows, headers, malformed } = parseRows(DOC);
const byId = new Map(rows.map((r) => [r.ID, r]));
const row = (id: string): Row => {
  const r = byId.get(id);
  if (!r) throw new Error(`row ${id} missing`);
  return r;
};

/** `file: exact text` citations in a Negative Test cell. */
function citations(cell: string): Array<{ file: string; text: string }> {
  return [...cell.matchAll(/`([A-Za-z0-9]+\.test\.ts): ([^`]+)`/g)].map((m) => ({ file: m[1], text: m[2] }));
}

describe('matrix structure', () => {
  it('all three tables use the 13 required columns, in order', () => {
    expect(headers.length).toBe(3);
    for (const h of headers) expect(h).toEqual(COLUMNS);
    expect(malformed).toEqual([]);
  });

  it('every H, N and B row is present exactly once (H-01..H-14, H-06b/c, N-01..N-22, B1..B4)', () => {
    const ids = rows.map((r) => r.ID);
    expect([...ids].sort()).toEqual([...EXPECTED_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every Result is in the certification vocabulary', () => {
    for (const r of rows) expect({ id: r.ID, result: r.Result, ok: RESULTS.includes(r.Result) }).toEqual({ id: r.ID, result: r.Result, ok: true });
  });
});

describe('PASS is backed by evidence that exists', () => {
  const pass = rows.filter((r) => r.Result === 'PASS');

  it('there are PASS rows to check (the parser is not vacuous)', () => {
    expect(pass.length).toBeGreaterThanOrEqual(20);
  });

  it.each(pass.map((r) => [r.ID, r] as const))('%s cites at least one test, and every cited test exists in its file', (_id, r) => {
    const cited = citations(r['Negative Test']);
    expect(cited.length).toBeGreaterThan(0);
    for (const c of cited) {
      const file = path.join(TEST_DIR, c.file);
      expect({ file: c.file, exists: fs.existsSync(file) }).toEqual({ file: c.file, exists: true });
      const source = fs.readFileSync(file, 'utf8');
      expect({ file: c.file, text: c.text, found: source.includes(c.text) }).toEqual({ file: c.file, text: c.text, found: true });
    }
  });

  it.each(pass.map((r) => [r.ID, r] as const))('%s names an evidence hash: this Story’s registry item or a full sha256 artifact', (_id, r) => {
    const refs = r['Evidence Hash'].split(';').map((s) => s.trim()).filter(Boolean);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const ok = /^sha256:[0-9a-f]{64}$/.test(ref) || (/^S[24]:/.test(ref) && PACKET_IDS.includes(ref.slice(3)));
      expect({ ref, ok }).toEqual({ ref, ok: true });
    }
  });

  it.each(pass.map((r) => [r.ID, r] as const))('%s names the commit that carries the boundary', (_id, r) => {
    expect(r.Commit).toMatch(/^(S2 HEAD|S4 HEAD|[0-9a-f]{8,40})$/);
  });

  it('every H row reports live operation separately (Live: …) so PASS never silently means "observed live"', () => {
    for (const r of rows.filter((x) => x.ID.startsWith('H-') && x.Result === 'PASS')) expect({ id: r.ID, live: /Live: (PASS|NOT RUN)/.test(r.Notes) }).toEqual({ id: r.ID, live: true });
  });
});

describe('non-PASS rows explain themselves', () => {
  it.each(rows.filter((r) => r.Result !== 'PASS').map((r) => [r.ID, r] as const))('%s has a substantive note', (_id, r) => {
    expect(r.Notes.length).toBeGreaterThanOrEqual(40);
  });

  it('DEFERRED rows name the decision or the Story they are deferred to', () => {
    for (const r of rows.filter((x) => x.Result === 'DEFERRED')) expect({ id: r.ID, named: /(decision A\d|S4)/.test(r.Notes) }).toEqual({ id: r.ID, named: true });
  });
});

describe('preserved findings cannot be quietly upgraded', () => {
  it('H-13: Integrate has no transition condition — FAIL, citing the live workflow snapshot', () => {
    const r = row('H-13');
    expect(r.Result).toBe('FAIL');
    expect(r.Notes).toMatch(/Integrate \(51\) has no transition condition/);
    expect(r['Evidence Hash']).toContain(SNAPSHOT_WORKFLOWS);
  });

  it('N-12 / N-13: the zero-transition service-identity snapshot is cited, with its sampling limits', () => {
    for (const id of ['N-12', 'N-13']) {
      const r = row(id);
      expect(r['Evidence Hash']).toContain(SNAPSHOT_IDENTITIES);
      expect(r.Notes).toMatch(/F-2/);
    }
    expect(row('N-12').Notes).toMatch(/Not sampled/);
  });

  it('N-14 is detection-only: it cites audit-branch and says it is NOT prevented; B1 stays DEFERRED', () => {
    const r = row('N-14');
    expect(citations(r['Negative Test']).some((c) => c.file === 'jevFlowAuditBranch.test.ts')).toBe(true);
    expect(r.Notes).toMatch(/NOT prevented/);
    expect(row('B1').Result).toBe('DEFERRED');
  });

  it('N-18 and B2 (deployment) are DEFERRED, never PASS', () => {
    expect(row('N-18').Result).toBe('DEFERRED');
    expect(row('B2').Result).toBe('DEFERRED');
    expect(row('N-18').Notes).toMatch(/Not PASS/);
  });

  it('B3 / N-07: the protected-path closure cites the S2 enforcement tests', () => {
    for (const id of ['B3', 'N-07']) {
      expect(row(id).Result).toBe('PASS');
      expect(citations(row(id)['Negative Test']).some((c) => c.file === 'jevFlowProtectedPaths.test.ts')).toBe(true);
    }
  });

  it('B4 (user-level plugin flag) is not claimed as covered', () => {
    expect(row('B4').Result).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('H-06 does not claim a live JEV run', () => {
    expect(row('H-06').Notes).toMatch(/Live: NOT RUN/);
  });

  it('H-14 and N-19..N-22 are PASS only on the OMNI-38 admission tests and S4 evidence, and F-9 keeps the process-start limit', () => {
    for (const id of ['H-14', 'N-19', 'N-20', 'N-21', 'N-22']) {
      const r = row(id);
      expect({ id, result: r.Result }).toEqual({ id, result: 'PASS' });
      expect({ id, admission: citations(r['Negative Test']).length > 0 && citations(r['Negative Test']).every((c) => c.file === 'jevFlowAdmission.test.ts') }).toEqual({ id, admission: true });
      expect({ id, evidence: r['Evidence Hash'], commit: r.Commit }).toEqual({ id, evidence: 'S4:jev.unit', commit: 'S4 HEAD' });
      expect(r.Notes).toMatch(/OMNI-38/);
    }
    expect(row('H-14').Notes).toMatch(/F-9/);
    expect(DOC).toMatch(/\n- \*\*F-9: `gov admit` does not compare the actual process start/);
  });
});

describe('report', () => {
  it.each([
    '### Supported entry paths',
    '### Certified continuation paths',
    '### Prohibited / bypass paths',
    '### Deterministic evidence coverage',
    '### JEV boundary proof',
    '### Jira authority proof',
    '### T1 / T2 / T3 authority proof',
    '### Findings (preserved, not fixed here)',
    '### Remaining gaps',
    '### Deliberate deferrals',
    '### Certification SHA',
  ])('has the section %s', (heading) => {
    expect(DOC).toContain(`\n${heading}\n`);
  });

  it('every preserved finding F-1..F-9 is listed', () => {
    for (let i = 1; i <= 9; i++) expect(DOC).toMatch(new RegExp(`\\n- \\*\\*F-${i}[ :]`));
  });

  it('never claims the harness is fully governed (the only occurrence is the explicit negation)', () => {
    const hits = [...DOC.matchAll(/fully governed/gi)];
    expect(hits.length).toBe(1);
    expect(DOC).toContain('**This harness is NOT certified as fully governed.**');
  });

  it('every sha256 artifact reference is a full 64-hex hash (no truncated hash stands as evidence)', () => {
    const cellsWithHashes = rows.map((r) => r['Evidence Hash']).join(';');
    for (const m of cellsWithHashes.matchAll(/sha256:[0-9a-f]*/g)) expect(m[0]).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
