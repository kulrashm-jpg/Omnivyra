/**
 * Unit tests for the applied-SQL equivalence tooling:
 *   scripts/release/semantic-compare-catalog.js  (comparator)
 *   scripts/release/catalog-fingerprint-build.js (generator of catalog-fingerprint.sql)
 * Pure file/string logic; no database.
 */
import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cmp = require('../../../scripts/release/semantic-compare-catalog.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const gen = require('../../../scripts/release/catalog-fingerprint-build.js');

const ROOT = path.resolve(__dirname, '..', '..', '..');

const BASE: Array<[string, string, string, string]> = [
  ['meta', 'session', 'fingerprint_format', 'catalog-fingerprint/2'],
  ['meta', 'session', 'server_version_num', '170006'],
  ['meta', 'session', 'transaction_read_only', 'on'],
  ['scope', 'rel:public.content', 'candidates', 'fix3:aux,revoke8:table'],
  ['scope', 'rel:public.feature_flags', 'candidates', 'close_anon:table'],
  ['scope', 'fn:public.omnivyra_touch_updated_at()', 'candidates', 'fix3:updated_at_executor'],
  ['rel', 'rel:public.content', 'owner', 'postgres'],
  ['rel', 'rel:public.content', 'relrowsecurity', 'true'],
  ['rel', 'rel:public.feature_flags', 'relrowsecurity', 'true'],
  ['acl', 'rel:public.content', 'grantee:<owner>', 'DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE'],
  ['acl', 'rel:public.content', 'grantee:service_role', 'DELETE,INSERT,SELECT,UPDATE'],
  ['eff', 'rel:public.content', 'role:authenticated', 'DELETE=f,INSERT=f,REFERENCES=f,SELECT=f,TRIGGER=f,TRUNCATE=f,UPDATE=f'],
  ['policy', 'rel:public.content', 'policy:content_company_rw:qual', '(company_id IN ( SELECT 1\\n   FROM x))'],
  ['policy', 'rel:public.content', 'policy:content_company_rw:expr_md5', 'aaaa'],
  ['fn', 'fn:public.omnivyra_touch_updated_at()', 'def_md5', 'b6c3'],
  ['fn', 'fn:public.omnivyra_touch_updated_at()', 'owner', 'postgres'],
  ['defacl', 'defacl:postgres:*:f', 'grantee:postgres', 'EXECUTE'],
  ['ledger', 'version:20261212000000', 'n_statements', '0'],
];

type Row = [string, string, string, string];

function render(rows: Row[]): string {
  return rows.map((r) => r.join('\t')).join('\n') + '\n';
}

function mutate(rows: Row[], match: (r: Row) => boolean, value: string | null): Row[] {
  const out: Row[] = [];
  let hit = false;
  for (const r of rows) {
    if (match(r)) {
      hit = true;
      if (value !== null) out.push([r[0], r[1], r[2], value]);
    } else out.push(r);
  }
  if (!hit) throw new Error('fixture mutation matched nothing');
  return out;
}

const prop = (section: string, object: string, property: string) => (r: Row) =>
  r[0] === section && r[1] === object && r[2] === property;

describe('semantic-compare-catalog', () => {
  const base = render(BASE as Row[]);

  it('reports identical fingerprints as equal with no differences', () => {
    const res = cmp.compareFingerprints(base, base);
    expect(res.equal).toBe(true);
    expect(res.counts).toMatchObject({ semantic: 0, noise: 0, info: 0, left_facts: BASE.length });
    expect(res.warnings).toEqual([]);
  });

  it('reports a re-granted table privilege (ACL + effective privilege) as semantic', () => {
    let rows = [...BASE, ['acl', 'rel:public.content', 'grantee:authenticated', 'SELECT']] as Row[];
    rows = mutate(rows, prop('eff', 'rel:public.content', 'role:authenticated'),
      'DELETE=f,INSERT=f,REFERENCES=f,SELECT=t,TRIGGER=f,TRUNCATE=f,UPDATE=f');
    const res = cmp.compareFingerprints(base, render(rows));
    expect(res.equal).toBe(false);
    expect(res.semantic.map((d: any) => `${d.section}|${d.property}|${d.kind}`).sort()).toEqual([
      'acl|grantee:authenticated|only_right',
      'eff|role:authenticated|changed',
    ]);
    expect(res.semantic[0].candidates).toBe('fix3:aux,revoke8:table');
  });

  it('reports a changed policy expression as semantic', () => {
    let rows = mutate(BASE as Row[], prop('policy', 'rel:public.content', 'policy:content_company_rw:qual'), 'true');
    rows = mutate(rows, prop('policy', 'rel:public.content', 'policy:content_company_rw:expr_md5'), 'bbbb');
    const res = cmp.compareFingerprints(base, render(rows));
    expect(res.semantic).toHaveLength(2);
    const qual = res.semantic.find((d: any) => d.property.endsWith(':qual'));
    expect(qual.left).toBe('(company_id IN ( SELECT 1\n   FROM x))'); // escapes decoded
    expect(qual.right).toBe('true');
  });

  it('reports a changed function body as semantic', () => {
    const rows = mutate(BASE as Row[], prop('fn', 'fn:public.omnivyra_touch_updated_at()', 'def_md5'), 'ffff');
    const res = cmp.compareFingerprints(base, render(rows));
    expect(res.semantic).toEqual([expect.objectContaining({
      section: 'fn', property: 'def_md5', kind: 'changed', candidates: 'fix3:updated_at_executor',
    })]);
  });

  it('reports a flipped RLS flag as semantic', () => {
    const rows = mutate(BASE as Row[], prop('rel', 'rel:public.feature_flags', 'relrowsecurity'), 'false');
    const res = cmp.compareFingerprints(base, render(rows));
    expect(res.semantic).toEqual([expect.objectContaining({
      object: 'rel:public.feature_flags', property: 'relrowsecurity', left: 'true', right: 'false', candidates: 'close_anon:table',
    })]);
  });

  it('reports a missing object fact (removed grant / default privilege) as semantic', () => {
    const rows = mutate(BASE as Row[], prop('defacl', 'defacl:postgres:*:f', 'grantee:postgres'), null);
    const res = cmp.compareFingerprints(base, render(rows));
    expect(res.semantic).toEqual([expect.objectContaining({ section: 'defacl', kind: 'only_left' })]);
  });

  it('classifies the server version as noise', () => {
    const rows = mutate(BASE as Row[], prop('meta', 'session', 'server_version_num'), '170009');
    const res = cmp.compareFingerprints(base, render(rows));
    expect(res.equal).toBe(true);
    expect(res.noise).toHaveLength(1);
  });

  // F-1: an owner holds every privilege, bypasses non-forced RLS and is the run-as
  // identity of SECURITY DEFINER functions / owner-rights views.
  it('reports an owner change (table and function) as semantic', () => {
    let rows = mutate(BASE as Row[], prop('rel', 'rel:public.content', 'owner'), 'supabase_admin');
    rows = mutate(rows, prop('fn', 'fn:public.omnivyra_touch_updated_at()', 'owner'), 'g5_bypassrls_role');
    const res = cmp.compareFingerprints(base, render(rows));
    expect(res.equal).toBe(false);
    expect(res.semantic.map((d: any) => `${d.section}|${d.property}`).sort()).toEqual(['fn|owner', 'rel|owner']);
    expect(res.semantic[0].reason).toMatch(/owner changed/);
  });

  it('accepts an owner difference only for a pair declared with --owner-map, and warns', () => {
    let rows = mutate(BASE as Row[], prop('rel', 'rel:public.content', 'owner'), 'supabase_admin');
    rows = mutate(rows, prop('fn', 'fn:public.omnivyra_touch_updated_at()', 'owner'), 'g5_other');
    const ownerMap = new Map([['postgres', 'supabase_admin']]);
    const res = cmp.compareFingerprints(base, render(rows), { ownerMap });
    expect(res.noise).toEqual([expect.objectContaining({ object: 'rel:public.content', property: 'owner' })]);
    expect(res.noise[0].reason).toMatch(/declared owner equivalence/);
    expect(res.semantic).toEqual([expect.objectContaining({ section: 'fn', property: 'owner', right: 'g5_other' })]);
    expect(res.warnings.join(' ')).toMatch(/owner equivalence declared: postgres \(left\) = supabase_admin \(right\)/);
    expect(() => cmp.compareFingerprints(base, base, { ownerMap: new Map([['postgres', 'anon']]) })).toThrow(/owner map/);
  });

  // F-2: MAINTAIN is a real PG17 privilege (VACUUM/ANALYZE/CLUSTER/REINDEX/LOCK TABLE).
  it('reports MAINTAIN granted to a client role as semantic when both sides are PostgreSQL 17', () => {
    const left = render([...BASE, ['eff', 'rel:public.content', 'role:anon', 'DELETE=f,INSERT=f,MAINTAIN=f']] as Row[]);
    const right = render([...BASE,
      ['acl', 'rel:public.content', 'grantee:anon', 'MAINTAIN'],
      ['eff', 'rel:public.content', 'role:anon', 'DELETE=f,INSERT=f,MAINTAIN=t']] as Row[]);
    const res = cmp.compareFingerprints(left, right);
    expect(res.equal).toBe(false);
    expect(res.semantic.map((d: any) => `${d.section}|${d.property}`).sort()).toEqual(['acl|grantee:anon', 'eff|role:anon']);
  });

  it('reports a MAINTAIN-only change on the owner entry as semantic when both sides are PostgreSQL 17', () => {
    const rows = mutate(BASE as Row[], prop('acl', 'rel:public.content', 'grantee:<owner>'),
      'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE');
    expect(cmp.compareFingerprints(base, render(rows)).equal).toBe(false);
  });

  it('treats MAINTAIN as noise only on the owner entry when the sides straddle PostgreSQL 17', () => {
    let rows = mutate(BASE as Row[], prop('acl', 'rel:public.content', 'grantee:<owner>'),
      'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE');
    rows = mutate(rows, prop('meta', 'session', 'server_version_num'), '160004');
    let res = cmp.compareFingerprints(base, render(rows));
    expect(res.equal).toBe(true);
    expect(res.noise.find((d: any) => d.section === 'acl').reason).toMatch(/owner MAINTAIN/);
    expect(res.warnings.join(' ')).toMatch(/differ across 17/);
    // a non-owner MAINTAIN grant stays semantic even across versions
    const left = render([...BASE, ['acl', 'rel:public.content', 'grantee:anon', 'MAINTAIN']] as Row[]);
    res = cmp.compareFingerprints(left, render(rows));
    expect(res.semantic).toEqual([expect.objectContaining({ property: 'grantee:anon', kind: 'only_left' })]);
  });

  it('reports ledger differences as info, not semantic', () => {
    const rows = mutate(BASE as Row[], prop('ledger', 'version:20261212000000', 'n_statements'), '1');
    const res = cmp.compareFingerprints(base, render(rows));
    expect(res.equal).toBe(true);
    expect(res.info).toHaveLength(1);
  });

  it('warns when a fingerprint was not taken read-only', () => {
    const rows = mutate(BASE as Row[], prop('meta', 'session', 'transaction_read_only'), 'off');
    const res = cmp.compareFingerprints(base, render(rows));
    expect(res.warnings.join(' ')).toMatch(/right: fingerprint was not taken in a read-only transaction/);
  });

  // F-3: role maps rewrite role positions only, refuse merges, and announce every rewrite.
  it('applies a one-side role map to role positions (defacl role + grantee) and lists every rewrite', () => {
    const rows = mutate(BASE as Row[], prop('defacl', 'defacl:postgres:*:f', 'grantee:postgres'), null);
    rows.push(['defacl', 'defacl:w6super:*:f', 'grantee:w6super', 'EXECUTE']);
    expect(cmp.compareFingerprints(base, render(rows)).equal).toBe(false);
    const roleMapRight = new Map([['w6super', 'postgres']]);
    const res = cmp.compareFingerprints(base, render(rows), { roleMapRight });
    expect(res.equal).toBe(true);
    expect(res.mapped).toEqual([
      expect.objectContaining({ side: 'right', from: 'w6super', to: 'postgres', object: 'defacl:w6super:*:f', property: 'grantee:w6super' }),
      expect.objectContaining({ side: 'right', from: 'w6super', to: 'postgres', object: 'defacl:w6super:*:f', property: 'grantee:w6super' }),
    ]);
    expect(res.counts.mapped).toBe(2);
    expect(res.warnings.join(' ')).toMatch(/role map applied \(right: w6super -> postgres\) to 2 fact/);
    expect(cmp.renderText(res, 'l', 'r')).toMatch(/WARNING: role map applied/);
  });

  it('never rewrites non-role tokens (column, policy, schema names) or values', () => {
    const left = render([...BASE,
      ['colacl', 'rel:public.content', 'col:g5_x:grantee:g5_x', 'SELECT'],
      ['policy', 'rel:public.content', 'policy:g5_x:roles', 'g5_x']] as Row[]);
    const res = cmp.compareFingerprints(left, left, { roleMapLeft: new Map([['g5_x', 'g5_y']]) });
    expect(res.mapped).toEqual([expect.objectContaining({ property: 'col:g5_x:grantee:g5_x', from: 'g5_x', to: 'g5_y' })]);
    // after the left-only rewrite the column grant differs; the policy row (name + value) is untouched
    expect(res.semantic.map((d: any) => `${d.kind}|${d.property}`).sort()).toEqual([
      'only_left|col:g5_x:grantee:g5_y',
      'only_right|col:g5_x:grantee:g5_x',
    ]);
  });

  it('refuses maps that would merge two roles, touch API roles, or do nothing', () => {
    const left = render([...BASE, ['acl', 'rel:public.feature_flags', 'grantee:g5_r1', 'SELECT']] as Row[]);
    const right = render([...BASE, ['acl', 'rel:public.feature_flags', 'grantee:g5_r2', 'SELECT']] as Row[]);
    // without a map: two semantic facts
    expect(cmp.compareFingerprints(left, right).semantic).toHaveLength(2);
    // both-side map g5_r2=g5_r1: refused because g5_r1 already appears on the left side
    expect(() => cmp.compareFingerprints(left, right, { roleMap: new Map([['g5_r2', 'g5_r1']]) })).toThrow(/already appears/);
    // a one-side map can still equate them — but never silently
    const res = cmp.compareFingerprints(left, right, { roleMapRight: new Map([['g5_r2', 'g5_r1']]) });
    expect(res.equal).toBe(true);
    expect(res.mapped).toHaveLength(1);
    expect(res.warnings.join(' ')).toMatch(/role map applied \(right: g5_r2 -> g5_r1\)/);
    for (const bad of [['anon', 'g5_x'], ['g5_x', 'authenticated'], ['service_role', 'g5_x'], ['g5_x', 'PUBLIC'], ['g5_x', 'public']]) {
      expect(() => cmp.compareFingerprints(base, base, { roleMap: new Map([bad as [string, string]]) })).toThrow(/never be mapped/);
    }
    expect(() => cmp.compareFingerprints(base, base, { roleMapLeft: new Map([['g5_x', 'g5_x']]) })).toThrow(/no-op/);
  });

  // N4: two roles mapped onto one target on the same side would merge them silently.
  it('refuses a many-to-one role map on one side', () => {
    const left = render([...BASE,
      ['acl', 'rel:public.feature_flags', 'grantee:g6_a', 'SELECT'],
      ['acl', 'rel:public.content', 'grantee:g6_b', 'SELECT']] as Row[]);
    const right = render([...BASE,
      ['acl', 'rel:public.feature_flags', 'grantee:g6_x', 'SELECT'],
      ['acl', 'rel:public.content', 'grantee:g6_x', 'SELECT']] as Row[]);
    const roleMapLeft = new Map([['g6_a', 'g6_x'], ['g6_b', 'g6_x']]);
    expect(() => cmp.compareFingerprints(left, right, { roleMapLeft })).toThrow(/both map to g6_x/);
    // the same pair spread across the shared map and a side map is refused too
    expect(() => cmp.compareFingerprints(left, right, {
      roleMap: new Map([['g6_a', 'g6_x']]), roleMapLeft: new Map([['g6_b', 'g6_x']]),
    })).toThrow(/would merge two distinct roles/);
  });

  it('warns when a role map entry rewrote nothing (a typo is never silent)', () => {
    const res = cmp.compareFingerprints(base, base, { roleMapRight: new Map([['g6_typo', 'g6_real']]) });
    expect(res.equal).toBe(true);
    expect(res.mapped).toHaveLength(0);
    expect(res.warnings.join(' ')).toMatch(/role map g6_typo=g6_real \(right\) rewrote nothing/);
  });

  it('judges default privileges of postgres/supabase_admin in public or global; others are info', () => {
    const right = render([...BASE,
      ['defacl', 'defacl:supabase_admin:storage:r', 'grantee:anon', 'SELECT'],
      ['defacl', 'defacl:supabase_admin:public:r', 'grantee:anon', 'SELECT']] as Row[]);
    const res = cmp.compareFingerprints(base, right);
    expect(res.info).toEqual([expect.objectContaining({ object: 'defacl:supabase_admin:storage:r' })]);
    expect(res.semantic).toEqual([expect.objectContaining({ object: 'defacl:supabase_admin:public:r' })]);
  });

  it('judges publication membership of in-scope tables; out-of-scope tables and flags are info', () => {
    const right = render([...BASE,
      ['pub', 'pub:supabase_realtime', 'flags', 'all_tables=false|insert=true|update=true|delete=true|truncate=true'],
      ['pub', 'pub:supabase_realtime', 'table:public.content', 'member|scope=fix3:aux,revoke8:table'],
      ['pub', 'pub:supabase_realtime', 'table:public.credit_transactions', 'member|scope=out_of_scope']] as Row[]);
    const res = cmp.compareFingerprints(base, right);
    expect(res.semantic).toEqual([expect.objectContaining({ property: 'table:public.content' })]);
    expect(res.info.map((d: any) => d.property).sort()).toEqual(['flags', 'table:public.credit_transactions']);
  });

  it('rejects fingerprints of the previous format', () => {
    const old = base.replace('catalog-fingerprint/2', 'catalog-fingerprint/1');
    expect(() => cmp.compareFingerprints(old, base)).toThrow(/unsupported fingerprint format catalog-fingerprint\/1/);
  });

  it('rejects malformed input and non-fingerprint files', () => {
    expect(() => cmp.parseFingerprint('a\tb\tc\n')).toThrow(/4 TAB-separated/);
    expect(() => cmp.parseFingerprint('rel\tx\ty\tz\n')).toThrow(/fingerprint_format/);
    expect(() => cmp.parseFingerprint(base + base)).toThrow(/duplicate fact/);
  });
});

describe('catalog-fingerprint-build', () => {
  const committed = fs.readFileSync(path.join(ROOT, 'scripts/release/catalog-fingerprint.sql'), 'utf8');

  it('committed catalog-fingerprint.sql equals the generator output (no drift from the migration)', () => {
    expect(committed).toBe(gen.build());
  });

  it('derives every close_anon object from the migration', () => {
    const t = gen.extractTargets();
    expect(t.protectedTables).toHaveLength(177);
    expect(t.definerFunctions).toHaveLength(29);
    expect(t.ownerRightsViews.length + t.invokerViews.length).toBe(37);
    expect(t.retargetedTables).toHaveLength(9);
    expect(t.publicReadTables).toHaveLength(4);
    expect(t.policies).toHaveLength(11);
    for (const name of [...t.protectedTables, ...t.ownerRightsViews, ...t.invokerViews, ...t.definerFunctions]) {
      expect(committed).toContain(`'${name}'`);
    }
    for (const name of [...gen.FIX3_TABLES, ...gen.PHASE_A_TABLES, ...gen.FIX3_FUNCTIONS]) {
      expect(committed).toContain(`'${name}'`);
    }
  });

  it('records MAINTAIN (PG17+), view definitions and publication membership, and states what it does not cover', () => {
    expect(committed).toMatch(/SELECT 'MAINTAIN' WHERE current_setting\('server_version_num'\)::int >= 170000/);
    expect(committed).toMatch(/'viewdef_md5', md5\(pg_get_viewdef\(c\.oid\)\)/);
    expect(committed).toMatch(/FROM pg_publication_tables pt/);
    expect(committed).toMatch(/'catalog-fingerprint\/2'/);
    expect(committed).toMatch(/NOT COVERED here \(by design\): the orchestration stack/);
  });

  it('is wrapped read-only and contains no write statements', () => {
    expect(committed).toMatch(/^BEGIN TRANSACTION READ ONLY;$/m);
    expect(committed).toMatch(/^ROLLBACK;\s*$/m);
    expect(committed).not.toMatch(/^\s*COMMIT\b/im);
    const code = committed.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
    expect(code).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE\s+TABLE|CREATE\s|ALTER\s|DROP\s|GRANT\s|REVOKE\s|COPY\s)/i);
  });
});
