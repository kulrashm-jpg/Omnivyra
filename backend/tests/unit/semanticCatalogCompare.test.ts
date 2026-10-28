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
  ['meta', 'session', 'fingerprint_format', 'catalog-fingerprint/1'],
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

  it('classifies owner names and server version as noise, keeping the result equal', () => {
    let rows = mutate(BASE as Row[], prop('rel', 'rel:public.content', 'owner'), 'supabase_admin');
    rows = mutate(rows, prop('fn', 'fn:public.omnivyra_touch_updated_at()', 'owner'), 'supabase_admin');
    rows = mutate(rows, prop('meta', 'session', 'server_version_num'), '150008');
    const res = cmp.compareFingerprints(base, render(rows));
    expect(res.equal).toBe(true);
    expect(res.noise).toHaveLength(3);
  });

  it('classifies an ACL difference consisting only of MAINTAIN (PG17) as noise', () => {
    const rows = mutate(BASE as Row[], prop('acl', 'rel:public.content', 'grantee:<owner>'),
      'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE');
    const res = cmp.compareFingerprints(base, render(rows));
    expect(res.equal).toBe(true);
    expect(res.noise[0].reason).toMatch(/MAINTAIN/);
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

  it('applies --role-map to object and property tokens', () => {
    const rows = mutate(BASE as Row[], prop('defacl', 'defacl:postgres:*:f', 'grantee:postgres'), null);
    rows.push(['defacl', 'defacl:w6super:*:f', 'grantee:w6super', 'EXECUTE']);
    expect(cmp.compareFingerprints(base, render(rows)).equal).toBe(false);
    const roleMap = new Map([['w6super', 'postgres']]);
    expect(cmp.compareFingerprints(base, render(rows), { roleMap }).equal).toBe(true);
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

  it('is wrapped read-only and contains no write statements', () => {
    expect(committed).toMatch(/^BEGIN TRANSACTION READ ONLY;$/m);
    expect(committed).toMatch(/^ROLLBACK;\s*$/m);
    expect(committed).not.toMatch(/^\s*COMMIT\b/im);
    const code = committed.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
    expect(code).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE\s+TABLE|CREATE\s|ALTER\s|DROP\s|GRANT\s|REVOKE\s|COPY\s)/i);
  });
});
