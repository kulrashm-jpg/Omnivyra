/**
 * Migration-quality gate, RULE 6b — applied-above-boundary immutability
 * (owner decision #18, 2026-11-10; design: virality-05 REGISTRY-AND-ATTESTATION-DESIGN.md).
 *
 * Tests 1-10 are the design's §6 table, in order. Every test calls the gate's
 * pure functions: no filesystem, database or git repository is needed, except
 * test 7b, which reads the committed attestation to prove today's file is
 * unaffected.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { aboveBoundaryViolations, immutabilityViolations } = require('../../../scripts/check-migration-quality.js');

const sha = (s: string | Buffer): string => crypto.createHash('sha256').update(s).digest('hex');
const LEDGER_MAX = '20270111000003';
const APPLIED = '20270202000000_pi_contact_governance_read_at.sql';
const BODY = 'BEGIN;\nCREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;\nCOMMIT;\n';

const entry = (overrides: Record<string, unknown> = {}) => ({
  sha256: sha(BODY),
  applied_at: '2026-11-09T00:00:00Z',
  operator: 'virality-83 (owner-instructed)',
  method: 'management_api_database_query_read_only_false',
  project_ref: 'klkiseupptzbecbxwrky',
  cluster_system_identifier: '7550817586112808987',
  ledger_row: false,
  record: 'closure-r15-d1-pack-20261110/D1-EXECUTION-RECORD.json',
  evidence_class: 'PRODUCTION_CATALOG_VERIFIED',
  ...overrides,
});
const boundary = (above: Record<string, unknown>, digests: Record<string, string> = {}) => ({
  schema_version: 2,
  ledger_max: LEDGER_MAX,
  digests,
  applied_above_boundary: above,
});
const files: Record<string, string> = { [APPLIED]: BODY };
const reader = (map: Record<string, string>) => (f: string): Buffer => Buffer.from(map[f], 'utf8');
const run = (b: unknown, top: string[] = [APPLIED], map = files): string[] =>
  aboveBoundaryViolations(top, b, reader(map)).violations;

describe('RULE 6b — applied-above-boundary immutability', () => {
  it('baseline: a complete, matching entry above the boundary passes', () => {
    const r = aboveBoundaryViolations([APPLIED], boundary({ [APPLIED]: entry() }), reader(files));
    expect(r.violations).toEqual([]);
    expect(r.checked).toBe(1);
  });

  it('1. editing one byte of an applied above-boundary file fails A1', () => {
    const v = run(boundary({ [APPLIED]: entry() }), [APPLIED], { [APPLIED]: BODY.replace('SELECT 1', 'SELECT 2') });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('APPLIED MIGRATION MODIFIED (above boundary)');
  });

  it('2. renaming it fails A2, and nothing else fires for the new name', () => {
    const renamed = '20270202000000_pi_contact_governance_read_at_v2.sql';
    const v = run(boundary({ [APPLIED]: entry() }), [renamed], { [renamed]: BODY });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('APPLIED MIGRATION DELETED OR RENAMED (above boundary)');
    expect(v[0]).toContain(APPLIED);
  });

  it('3. deleting it fails A2', () => {
    const v = run(boundary({ [APPLIED]: entry() }), []);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('APPLIED MIGRATION DELETED OR RENAMED (above boundary)');
  });

  it('4. an entry with operator missing or empty fails A3', () => {
    const { operator: _drop, ...noOperator } = entry();
    void _drop;
    for (const e of [noOperator, entry({ operator: '' }), entry({ operator: '   ' })]) {
      const v = run(boundary({ [APPLIED]: e }));
      expect(v).toHaveLength(1);
      expect(v[0]).toContain('APPLIED-OUT-OF-BAND ENTRY INCOMPLETE');
      expect(v[0]).toContain('operator');
    }
  });

  it('4b. A3 checks every field: ledger_row must be a boolean, sha256 must be 64 hex', () => {
    const v = run(boundary({ [APPLIED]: entry({ ledger_row: 'false', sha256: 'abc' }) }));
    expect(v.join('\n')).toContain('ledger_row');
    expect(v.join('\n')).toContain('sha256');
  });

  it('5. the same filename in digests AND applied_above_boundary fails A4', () => {
    const v = run(boundary({ [APPLIED]: entry() }, { [APPLIED]: sha(BODY) }));
    expect(v.some((x) => x.includes('APPLIED RECORD INCONSISTENT') && x.includes('both digests'))).toBe(true);
  });

  it('6. an applied_above_boundary version at or below ledger_max fails A4 (it belongs in digests)', () => {
    const below = '20261127000000_pi_prospect_lists.sql';
    const v = run(boundary({ [below]: entry() }), [below], { [below]: BODY });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('APPLIED RECORD INCONSISTENT');
    expect(v[0]).toContain('belongs in digests');
    const atMax = `${LEDGER_MAX}_tip.sql`;
    expect(run(boundary({ [atMax]: entry() }), [atMax], { [atMax]: BODY })[0]).toContain('APPLIED RECORD INCONSISTENT');
  });

  it('7. no applied_above_boundary key at all: rule 6b is silent and rule 6 is unchanged', () => {
    const v1 = { schema_version: 1, ledger_max: LEDGER_MAX, digests: { '20260101000000_a.sql': sha('a') } };
    expect(aboveBoundaryViolations(['20260101000000_a.sql'], v1, reader({ '20260101000000_a.sql': 'a' })))
      .toEqual({ violations: [], checked: 0 });
    const r = immutabilityViolations(['20260101000000_a.sql'], v1, () => sha('a'));
    expect(r.violations).toEqual([]);
  });

  it('7b. the committed attestation (schema_version 1, no new key) produces no rule-6b violation', () => {
    const real = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../scripts/migrations/applied-boundary.json'), 'utf8'),
    );
    expect(real.applied_above_boundary).toBeUndefined();
    expect(aboveBoundaryViolations([], real, () => Buffer.from('')).violations).toEqual([]);
  });

  it('7c. schema_version 1 and 2 are both accepted; an unknown version fails closed', () => {
    expect(run({ ...boundary({ [APPLIED]: entry() }), schema_version: 1 })).toEqual([]);
    expect(run(boundary({ [APPLIED]: entry() }))).toEqual([]);
    const v = run({ ...boundary({ [APPLIED]: entry() }), schema_version: 3 });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('unknown schema_version');
  });

  it('8. an unparseable attestation still fails closed (rule 6), and rule 6b adds nothing', () => {
    const broken = { __parseError: 'Unexpected token' };
    expect(immutabilityViolations([APPLIED], broken, () => '').violations[0]).toContain('must fail, not pass');
    expect(aboveBoundaryViolations([APPLIED], broken, reader(files)).violations).toEqual([]);
  });

  it('9. a CRLF checkout of an applied file still passes A1 (digest basis is LF bytes)', () => {
    const crlf = BODY.replace(/\n/g, '\r\n');
    expect(crlf).not.toEqual(BODY);
    expect(sha(crlf)).not.toEqual(sha(BODY));
    expect(run(boundary({ [APPLIED]: entry() }), [APPLIED], { [APPLIED]: crlf })).toEqual([]);
    // A genuine content change in a CRLF checkout is still caught.
    const changed = BODY.replace('SELECT 1', 'SELECT 9').replace(/\n/g, '\r\n');
    expect(run(boundary({ [APPLIED]: entry() }), [APPLIED], { [APPLIED]: changed })[0])
      .toContain('APPLIED MIGRATION MODIFIED (above boundary)');
  });

  it('10. adding 20261127000000 to digests clears its "NOT in the attestation" violation; editing it then fails', () => {
    const lists = '20261127000000_pi_prospect_lists.sql';
    const before = { schema_version: 2, ledger_max: LEDGER_MAX, digests: {} };
    const v0 = immutabilityViolations([lists], before, () => sha('lists')).violations;
    expect(v0).toHaveLength(1);
    expect(v0[0]).toContain('NOT in the attestation');
    const after = { ...before, digests: { [lists]: sha('lists') } };
    expect(immutabilityViolations([lists], after, () => sha('lists')).violations).toEqual([]);
    const edited = immutabilityViolations([lists], after, () => sha('lists edited')).violations;
    expect(edited).toHaveLength(1);
    expect(edited[0]).toContain('APPLIED MIGRATION MODIFIED');
  });

  it('hazard: an above-boundary file placed in digests (the wrong map) is still reported deleted by rule 6', () => {
    // Documents WHY applied_above_boundary exists; rule 6 is intentionally unchanged.
    const b = { schema_version: 2, ledger_max: LEDGER_MAX, digests: { [APPLIED]: sha(BODY) } };
    expect(immutabilityViolations([APPLIED], b, () => sha(BODY)).violations[0]).toContain('DELETED OR RENAMED');
  });
  it('counter: an entry whose sha256 is malformed is NOT counted as verified (A1 never ran)', () => {
    const r = aboveBoundaryViolations([APPLIED], boundary({ [APPLIED]: entry({ sha256: 'not-a-hash' }) }), reader(files));
    expect(r.checked).toBe(0);
    expect(r.violations.join('\n')).toContain('APPLIED-OUT-OF-BAND ENTRY INCOMPLETE');
  });

  it('LF basis is byte-level: non-UTF-8 bytes survive and CRLF still folds to LF', () => {
    const latin1 = Buffer.from([0xe9, 0xff]);
    const lf = Buffer.concat([Buffer.from('SELECT 1;\n-- latin1: '), latin1, Buffer.from('\n')]);
    const crlf = Buffer.concat([Buffer.from('SELECT 1;\r\n-- latin1: '), latin1, Buffer.from('\r\n')]);
    const b = boundary({ [APPLIED]: entry({ sha256: sha(lf) }) });
    expect(aboveBoundaryViolations([APPLIED], b, () => crlf).violations).toEqual([]);
    expect(aboveBoundaryViolations([APPLIED], b, () => lf).violations).toEqual([]);
    // A lone CR is real content: it is NOT folded away (fail-safe direction).
    const loneCr = Buffer.concat([Buffer.from('SELECT 1;\r-- latin1: '), latin1, Buffer.from('\n')]);
    expect(aboveBoundaryViolations([APPLIED], b, () => loneCr).violations[0]).toContain('APPLIED MIGRATION MODIFIED (above boundary)');
  });
});

describe('RULE 6 — LF digest basis (virality-05 follow-up b)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { lfSha256 } = require('../../../scripts/check-migration-quality.js');
  it('lfSha256 equals the plain sha256 of LF content, for both LF and CRLF checkouts', () => {
    const lf = Buffer.from('CREATE TABLE IF NOT EXISTS t (id int);\nCOMMIT;\n');
    const crlf = Buffer.from('CREATE TABLE IF NOT EXISTS t (id int);\r\nCOMMIT;\r\n');
    expect(lfSha256(lf)).toBe(sha(lf));
    expect(lfSha256(crlf)).toBe(sha(lf));
  });
  it('rule 6 fed through lfSha256: a CRLF checkout of an unchanged applied file passes, a real edit still fails', () => {
    const f = '20260101000000_a.sql';
    const lf = Buffer.from('SELECT 1;\n');
    const b = { schema_version: 2, ledger_max: LEDGER_MAX, digests: { [f]: sha(lf) } };
    expect(immutabilityViolations([f], b, () => lfSha256(Buffer.from('SELECT 1;\r\n'))).violations).toEqual([]);
    expect(immutabilityViolations([f], b, () => lfSha256(Buffer.from('SELECT 2;\r\n'))).violations[0])
      .toContain('APPLIED MIGRATION MODIFIED');
  });
});
