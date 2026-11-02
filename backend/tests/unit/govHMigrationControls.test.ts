/**
 * GOV-H — migration and governance-control integrity.
 *
 * Covers the four rules added to the migration-quality gate (cross-branch
 * version reservations, applied-migration immutability, rollback companion
 * naming, FK/NOT NULL/CHECK contradiction) and the catalog-level actor-FK
 * compatibility detector.
 *
 * Every rule is a pure function, so these tests need no filesystem, no
 * database and no git repository — except the handful that deliberately read
 * the real committed registries and the real schema baseline, because a
 * registry that has drifted from the repository is exactly the failure these
 * controls exist to prevent.
 *
 * THE LOAD-BEARING TESTS, the ones that would have caught DEFECT-008:
 *   - 'flags the exact migration that introduced DEFECT-008'
 *   - 'flags reports.user_id from the committed schema baseline'
 *   - 'a composite FK with no column list nulls the tenant key too'
 */
import fs from 'fs';
import path from 'path';

/* eslint-disable @typescript-eslint/no-require-imports */
const gate = require('../../../scripts/check-migration-quality.js');
const actorFk = require('../../../scripts/ci/check-actor-fk-compatibility.js');
/* eslint-enable @typescript-eslint/no-require-imports */

const REPO = path.resolve(__dirname, '../../..');
const MIG = path.join(REPO, 'supabase', 'migrations');
const readMig = (f: string) => fs.readFileSync(path.join(MIG, f), 'utf8');
const sha256 = (s: string) => require('crypto').createHash('sha256').update(s).digest('hex'); // eslint-disable-line

type Viol = { line: number; table: string; column: string; kind: string; rule: string };
const kinds = (sql: string): string[] => gate.setNullContradictions(sql).map((v: Viol) => v.kind);

// ───────────────────────────────────────────────────────────────────────────
describe('RULE 8 — FK / NOT NULL / CHECK contradiction, from migration text alone', () => {
  it('CRITICAL: flags the exact migration that introduced DEFECT-008', () => {
    // 20270105000000 created prospect_problem_observations with an ON DELETE
    // SET NULL FK into public.users on recorded_by_user_id AND the
    // ppo_origin_actor CHECK requiring it non-NULL for origin='human'. This
    // rule fails that migration from its text, with no database. Had it
    // existed, the defect would not have reached production.
    const v = gate.setNullContradictions(readMig('20270105000000_pi_prospect_problem_observations.sql'));
    const hit = v.find((x: Viol) => x.column === 'recorded_by_user_id');
    expect(hit).toBeDefined();
    expect(hit.kind).toBe('set_null_vs_check');
    expect(hit.table).toBe('prospect_problem_observations');
  });

  it('flags the three sibling defects this programme is remediating', () => {
    const cases: Array<[string, string, string]> = [
      ['20261028000000_pi_prospect_lifecycle_state.sql', 'prospect_lifecycle_transitions', 'actor_user_id'],
      ['20261030000000_pi_prospect_archive_recommendations.sql', 'prospect_archive_recommendations', 'reviewed_by_user_id'],
      ['20261122000000_pi_person_account_relationships.sql', 'source_assertions', 'asserted_by_user_id'],
    ];
    for (const [file, table, column] of cases) {
      const v = gate.setNullContradictions(readMig(file));
      expect(v.some((x: Viol) => x.table === table && x.column === column && x.kind === 'set_null_vs_check')).toBe(true);
    }
  });

  it('flags a NOT NULL column given an ON DELETE SET NULL reference', () => {
    const sql = `CREATE TABLE IF NOT EXISTS public.t (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE SET NULL
);`;
    const v = gate.setNullContradictions(sql);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe('set_null_on_not_null');
    expect(v[0].column).toBe('owner_id');
  });

  it('CRITICAL: a composite FK with no column list nulls the tenant key too', () => {
    // PostgreSQL nulls EVERY referencing column when ON DELETE SET NULL carries
    // no column list. A composite tenant FK therefore tries to null the NOT NULL
    // tenant key. This is the shape found in 20261031000000_pi_score_evaluations.sql.
    const sql = `CREATE TABLE IF NOT EXISTS public.t (
  organization_id uuid NOT NULL,
  person_id uuid
);
ALTER TABLE public.t
  ADD CONSTRAINT t_person_tenant_fk FOREIGN KEY (person_id, organization_id)
  REFERENCES public.unified_persons (id, company_id) ON DELETE SET NULL;`;
    const v = gate.setNullContradictions(sql);
    expect(v.map((x: Viol) => x.column)).toContain('organization_id');
    expect(v.find((x: Viol) => x.column === 'organization_id').kind).toBe('set_null_on_not_null');
  });

  it('a PG15 partial SET NULL column list restricts which columns are nulled', () => {
    const sql = `CREATE TABLE IF NOT EXISTS public.t (
  organization_id uuid NOT NULL,
  person_id uuid
);
ALTER TABLE public.t
  ADD CONSTRAINT t_person_tenant_fk FOREIGN KEY (person_id, organization_id)
  REFERENCES public.unified_persons (id, company_id) ON DELETE SET NULL (person_id);`;
    // person_id is nullable, organization_id is not nulled — nothing to report.
    expect(gate.setNullContradictions(sql)).toHaveLength(0);
  });

  it('CRITICAL: NOT NULL is scoped per table, not per file', () => {
    // The first implementation matched a NOT NULL `provider_id` in one table
    // against a nullable `provider_id` in another, producing two false
    // positives on origin/main (20260906000000_ai_orchestration_foundation.sql).
    const sql = `CREATE TABLE IF NOT EXISTS public.a (
  provider_id uuid NOT NULL REFERENCES public.llm_providers(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.b (
  provider_id uuid NULL REFERENCES public.llm_providers(id) ON DELETE SET NULL
);`;
    expect(gate.setNullContradictions(sql)).toHaveLength(0);
    expect(kinds(readMig('20260906000000_ai_orchestration_foundation.sql'))
      .length).toBeGreaterThanOrEqual(0); // no throw on the real file
    const real = gate.setNullContradictions(readMig('20260906000000_ai_orchestration_foundation.sql'));
    expect(real.filter((x: Viol) => x.column === 'provider_id' || x.column === 'model_id')).toHaveLength(0);
  });

  it('a CHECK requiring the column non-NULL is flagged even when the column is nullable', () => {
    const sql = `CREATE TABLE IF NOT EXISTS public.t (
  origin text NOT NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT t_origin_actor CHECK ((origin = 'human' AND actor_user_id IS NOT NULL) OR (origin = 'derived' AND actor_user_id IS NULL))
);`;
    const v = gate.setNullContradictions(sql);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe('set_null_vs_check');
  });

  it('an ON DELETE SET NULL column with no NOT NULL and no CHECK is clean', () => {
    const sql = `CREATE TABLE IF NOT EXISTS public.t (
  id uuid PRIMARY KEY,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL
);`;
    expect(gate.setNullContradictions(sql)).toHaveLength(0);
  });

  it('CASCADE and RESTRICT are never flagged — only SET NULL writes a NULL', () => {
    for (const action of ['CASCADE', 'RESTRICT', 'NO ACTION']) {
      const sql = `CREATE TABLE IF NOT EXISTS public.t (
  owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE ${action}
);`;
      expect(gate.setNullContradictions(sql)).toHaveLength(0);
    }
  });

  it('`-- set-null-ok: <reason>` suppresses the finding; a bare comment does not', () => {
    const body = (comment: string) => `CREATE TABLE IF NOT EXISTS public.t (
  ${comment}
  owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE SET NULL
);`;
    expect(gate.setNullContradictions(body('-- set-null-ok: tenant rows are never deleted'))).toHaveLength(0);
    expect(gate.setNullContradictions(body('-- this is fine, honestly'))).toHaveLength(1);
  });

  it('a column nulled inside a DO block ALTER TABLE is not invisible', () => {
    const sql = `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'x') THEN
    ALTER TABLE public.t ADD CONSTRAINT x FOREIGN KEY (a, org_id)
      REFERENCES public.o (id, org_id) ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE public.t ALTER COLUMN org_id SET NOT NULL;`;
    expect(gate.setNullContradictions(sql).map((x: Viol) => x.column)).toContain('org_id');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('RULE 5 — cross-branch version reservations', () => {
  const reg = {
    reservations: [
      { version: '20270116000001', status: 'occupied_elsewhere', owner: 'Agent B', note: 'uncommitted in another worktree' },
      { version: '20270117000002', slug: 'gov_h_control', status: 'reserved', owner: 'Agent H' },
    ],
  };

  it('CRITICAL: refuses a version occupied outside this checkout', () => {
    // The hole that let three branches each claim 20270110000000: the
    // uniqueness rule only ever saw one of them.
    const v = gate.reservationViolations(['20270116000001_my_thing.sql'], reg);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('already occupied outside this checkout');
    expect(v[0]).toContain('Agent B');
  });

  it('refuses a reserved version used with the wrong slug', () => {
    const v = gate.reservationViolations(['20270117000002_something_else.sql'], reg);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("reserved to Agent H for slug 'gov_h_control'");
  });

  it('accepts a reserved version used with its own slug, and an unreserved one', () => {
    expect(gate.reservationViolations(['20270117000002_gov_h_control.sql'], reg)).toHaveLength(0);
    expect(gate.reservationViolations(['20270118000000_anything.sql'], reg)).toHaveLength(0);
  });

  it('fails when the registry itself contains a duplicate version', () => {
    const dup = { reservations: [{ version: '20270114000000' }, { version: '20270114000000' }] };
    expect(gate.reservationViolations([], dup)[0]).toContain('registered twice');
  });

  it('an unreadable registry FAILS rather than silently passing', () => {
    expect(gate.reservationViolations([], { __parseError: 'Unexpected token' })[0]).toContain('unreadable');
  });

  it('the committed registry records every version this programme knows to be taken', () => {
    const live = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/migrations/version-reservations.json'), 'utf8'));
    const byVersion = new Map(live.reservations.map((r: { version: string }) => [r.version, r]));
    // The three-way 20270110000000 collision and its resolution.
    expect(byVersion.get('20270110000000')).toMatchObject({ status: 'merged', slug: 'pi_prospect_problem_actor_fk_removal' });
    // The uncommitted drafts — the versions no committed-refs-only check can see.
    for (const v of ['20270116000000', '20270116000001', '20270116000002', '20270116000003', '20270116000004']) {
      expect(byVersion.get(v)).toMatchObject({ status: 'occupied_elsewhere' });
    }
    // The parent's allocations for this programme.
    for (const v of ['20270117000000', '20270117000001', '20270117000002']) {
      expect(byVersion.get(v)).toMatchObject({ status: 'reserved' });
    }
    // 20270114000000 is free and must NOT be registered.
    expect(byVersion.has('20270114000000')).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('RULE 6 — historical applied-migration immutability', () => {
  const boundary = {
    ledger_max: '20270111000003',
    digests: { '20270105000000_a.sql': sha256('original'), '20260321_legacy.sql': sha256('legacy') },
  };
  const digestOf = (map: Record<string, string>) => (f: string) => map[f] ?? sha256('MISSING');

  it('CRITICAL: fails when an applied migration file is edited', () => {
    const r = gate.immutabilityViolations(
      ['20270105000000_a.sql', '20260321_legacy.sql'],
      boundary,
      digestOf({ '20270105000000_a.sql': sha256('EDITED'), '20260321_legacy.sql': sha256('legacy') }),
    );
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toContain('APPLIED MIGRATION MODIFIED');
  });

  it('fails when an applied migration is deleted or renamed', () => {
    const r = gate.immutabilityViolations(['20260321_legacy.sql'], boundary, digestOf({ '20260321_legacy.sql': sha256('legacy') }));
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toContain('APPLIED MIGRATION DELETED OR RENAMED');
  });

  it('fails a NEW migration numbered into already-applied history', () => {
    const r = gate.immutabilityViolations(
      ['20270105000000_a.sql', '20260321_legacy.sql', '20270101000000_sneaked_in.sql'],
      boundary,
      digestOf({ '20270105000000_a.sql': sha256('original'), '20260321_legacy.sql': sha256('legacy') }),
    );
    expect(r.violations.some((x: string) => x.includes('numbered into already-applied history'))).toBe(true);
  });

  it('compares a legacy 8-digit version against the 14-digit boundary on the same scale', () => {
    // '20260321' must be read as 20260321000000, i.e. BELOW the boundary.
    const r = gate.immutabilityViolations(['20260321_legacy.sql'], { ledger_max: '20270111000003', digests: {} }, () => sha256('x'));
    expect(r.checked).toBe(1);
  });

  it('passes unchanged files and reports how many versions sit above the boundary', () => {
    const r = gate.immutabilityViolations(
      ['20270105000000_a.sql', '20260321_legacy.sql', '20270116000001_new.sql'],
      boundary,
      digestOf({ '20270105000000_a.sql': sha256('original'), '20260321_legacy.sql': sha256('legacy') }),
    );
    expect(r.violations).toHaveLength(0);
    expect(r.staleVersions).toBe(1);
    expect(r.boundary).toBe('20270111000003');
  });

  it('an unreadable attestation FAILS rather than silently passing', () => {
    const r = gate.immutabilityViolations(['x.sql'], { __parseError: 'bad json' }, () => '');
    expect(r.violations[0]).toContain('unreadable');
  });

  it('the committed attestation matches every file it pins, right now', () => {
    // If this fails, either an applied migration changed or the attestation is
    // wrong. Both are exactly what the rule exists to surface.
    const att = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/migrations/applied-boundary.json'), 'utf8'));
    expect(att.ledger_max).toBe('20270111000003');
    const files = fs.readdirSync(MIG, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.sql')).map((e) => e.name);
    const r = gate.immutabilityViolations(files, att, (f: string) => sha256(fs.readFileSync(path.join(MIG, f), 'utf8')));
    expect(r.violations).toEqual([]);
    expect(r.checked).toBe(att.files_pinned);
  });

  it('does not claim the attestation is current — it carries its provenance', () => {
    const att = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/migrations/applied-boundary.json'), 'utf8'));
    expect(att.attested_at).toBeTruthy();
    expect(att.attested_from).toContain('5025f51d');
    expect(att.evidence_class).toContain('PRODUCTION_CATALOG_VERIFIED');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('RULE 7 — rollback companion naming', () => {
  it('CRITICAL: refuses two migrations sharing a slug — their rollbacks share one path', () => {
    // `<slug>_rollback.sql` has no version, so both would be the same file.
    const v = gate.rollbackViolations(
      ['20270116000001_actor_fk_removal.sql', '20270117000000_actor_fk_removal.sql'],
      [],
      ['20270117000000_actor_fk_removal.sql'],
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('would share one rollback path');
  });

  it('does not retroactively fail a historical duplicate slug', () => {
    expect(gate.rollbackViolations(
      ['20260101000000_dup.sql', '20260102000000_dup.sql'], [], [],
    )).toHaveLength(0);
  });

  it('flags an orphan rollback whose migration no longer exists', () => {
    const v = gate.rollbackViolations(['20270116000001_a.sql'], ['b_rollback.sql'], []);
    expect(v[0]).toContain('orphan rollback');
  });

  it('flags an ambiguous rollback shared by two migrations', () => {
    const v = gate.rollbackViolations(
      ['20270116000001_dup.sql', '20270117000000_dup.sql'], ['dup_rollback.sql'], [],
    );
    expect(v.some((x: string) => x.includes('ambiguous rollback'))).toBe(true);
  });

  it('flags a rollback that is not named *_rollback.sql', () => {
    expect(gate.rollbackViolations(['20270116000001_a.sql'], ['a_undo.sql'], [])[0])
      .toContain('invalid rollback name');
  });

  it('accepts the version-prefixed form, which is the unambiguous one', () => {
    // security/media-h3-fixes uses
    // 20270111000000_media_h3_storage_quarantine_policies_rollback.sql while
    // the 45 committed rollbacks on origin/main carry no version. Both forms
    // are valid; rejecting the safer one would be wrong.
    expect(gate.rollbackViolations(['20270116000001_a.sql'], ['20270116000001_a_rollback.sql'], [])).toEqual([]);
  });

  it('a version-prefixed rollback naming the WRONG version is an orphan', () => {
    const v = gate.rollbackViolations(['20270116000001_a.sql'], ['20270117000000_a_rollback.sql'], []);
    expect(v[0]).toContain('orphan rollback');
    expect(v[0]).toContain('20270117000000_a.sql');
  });

  it('the version-prefixed form resolves an otherwise ambiguous slug', () => {
    const files = ['20270116000001_dup.sql', '20270117000000_dup.sql'];
    expect(gate.rollbackViolations(files, ['20270117000000_dup_rollback.sql'], [])).toEqual([]);
    expect(gate.rollbackViolations(files, ['dup_rollback.sql'], [])[0]).toContain('ambiguous rollback');
  });

  it('accepts the real committed rollbacks directory', () => {
    const top = fs.readdirSync(MIG, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.sql')).map((e) => e.name);
    const rb = fs.readdirSync(path.join(MIG, 'rollbacks')).filter((f) => f.endsWith('.sql'));
    expect(rb.length).toBeGreaterThan(0);
    expect(gate.rollbackViolations(top, rb, [])).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('actor-FK compatibility detector — catalog level', () => {
  const parse = (sql: string) => actorFk.parseBaselineCatalog(sql, { source: 'test' });

  it('CRITICAL: flags reports.user_id from the committed schema baseline', () => {
    // reports.user_id is NOT NULL and reports_user_id_fkey is ON DELETE SET
    // NULL. The programme's own contradiction, detected with no database.
    const sql = fs.readFileSync(path.join(REPO, 'supabase/_schema/baseline.sql'), 'utf8');
    const meta = JSON.parse(fs.readFileSync(path.join(REPO, 'supabase/_schema/baseline.json'), 'utf8'));
    const cat = actorFk.parseBaselineCatalog(sql, { source: 'baseline', boundary: meta.ledgerMax });
    const r = actorFk.detect(cat, { columns: [] });
    const hit = r.findings.find((f: { table: string; column: string }) => f.table === 'reports' && f.column === 'user_id');
    expect(hit).toBeDefined();
    expect(hit.rule).toBe('set_null_on_not_null');
    expect(hit.constraint).toBe('reports_user_id_fkey');
    expect(hit.severity).toBe('error');
  });

  it('finds exactly the six contradictions the committed acknowledgement list records', () => {
    // The real run: baseline in, findings out, every error accounted for by an
    // owner-named entry. If a seventh appears, this fails and somebody must
    // classify it — the list cannot absorb a new defect silently.
    const sql = fs.readFileSync(path.join(REPO, 'supabase/_schema/baseline.sql'), 'utf8');
    const meta = JSON.parse(fs.readFileSync(path.join(REPO, 'supabase/_schema/baseline.json'), 'utf8'));
    const cat = actorFk.parseBaselineCatalog(sql, { source: 'baseline', boundary: meta.ledgerMax });
    const registry = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/migrations/actor-field-registry.json'), 'utf8'));
    const r = actorFk.detect(cat, registry, actorFk.loadKnown());
    expect(r.counts.error).toBe(0);
    expect(r.stale_known).toEqual([]);
    expect(r.known_open.map((f: { table: string; column: string }) => `${f.table}.${f.column}`).sort()).toEqual([
      'canonical_revenue_events.company_id',
      'canonical_users.company_id',
      'leads.unified_person_id',
      'page_links.company_id',
      'prospect_accounts.merged_into_id',
      'reports.user_id',
    ]);
  });

  it('a frozen catalog entry that stops reproducing FAILS as stale', () => {
    const cat = actorFk.parseBaselineCatalog('CREATE TABLE public.t (\n    a uuid\n);', { source: 'pg_catalog' });
    const r = actorFk.detect(cat, { columns: [] }, [{ key: 't.a', owner: 'x', classification: 'y' }]);
    expect(r.stale_known).toEqual(['t.a']);
    expect(r.counts.error).toBe(1);
  });

  it('a frozen entry for a table absent from a point-in-time dump is NOT called stale', () => {
    // Absence in a boundary-limited dump proves nothing.
    const cat = actorFk.parseBaselineCatalog('CREATE TABLE public.other (\n    a uuid\n);', { source: 'baseline', boundary: '20260916000000' });
    const r = actorFk.detect(cat, { columns: [] }, [{ key: 'missing_table.a', owner: 'x', classification: 'y' }]);
    expect(r.stale_known).toEqual([]);
    expect(r.counts.error).toBe(0);
  });

  it('parses the real baseline into a catalog of the expected size', () => {
    const sql = fs.readFileSync(path.join(REPO, 'supabase/_schema/baseline.sql'), 'utf8');
    const meta = JSON.parse(fs.readFileSync(path.join(REPO, 'supabase/_schema/baseline.json'), 'utf8'));
    const cat = parse(sql);
    expect(cat.tables.size).toBe(meta.tables); // 823
    expect(cat.foreignKeys.length).toBeGreaterThan(700);
    expect(cat.tables.get('reports').columns.get('user_id').notNull).toBe(true);
  });

  it('flags a SET NULL FK on a NOT NULL column', () => {
    const cat = parse(`CREATE TABLE public.t (
    id uuid NOT NULL,
    owner_id uuid NOT NULL
);
ALTER TABLE ONLY public.t
    ADD CONSTRAINT t_owner_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;`);
    const r = actorFk.detect(cat);
    expect(r.counts.error).toBe(1);
    expect(r.findings[0].rule).toBe('set_null_on_not_null');
  });

  it('flags a SET NULL FK fighting a CHECK that requires the column non-NULL', () => {
    const cat = parse(`CREATE TABLE public.t (
    status text NOT NULL,
    merged_into_id uuid,
    CONSTRAINT t_coherent CHECK (((status = 'merged'::text) = (merged_into_id IS NOT NULL)))
);
ALTER TABLE ONLY public.t
    ADD CONSTRAINT t_merged_fkey FOREIGN KEY (merged_into_id) REFERENCES public.t(id) ON DELETE SET NULL;`);
    const r = actorFk.detect(cat);
    expect(r.counts.error).toBe(1);
    expect(r.findings[0].rule).toBe('set_null_vs_check');
  });

  it('a CHECK using `IS NULL` is not a non-NULL requirement', () => {
    const cat = parse(`CREATE TABLE public.t (
    merged_into_id uuid,
    CONSTRAINT t_no_self CHECK (((merged_into_id IS NULL) OR (merged_into_id <> id)))
);
ALTER TABLE ONLY public.t
    ADD CONSTRAINT t_merged_fkey FOREIGN KEY (merged_into_id) REFERENCES public.t(id) ON DELETE SET NULL;`);
    expect(actorFk.detect(cat).counts.error).toBe(0);
  });

  it('CRITICAL: a composite FK with no column list nulls every column, tenant key included', () => {
    const cat = parse(`CREATE TABLE public.t (
    company_id uuid NOT NULL,
    campaign_id uuid
);
ALTER TABLE ONLY public.t
    ADD CONSTRAINT t_campaign_fk FOREIGN KEY (campaign_id, company_id) REFERENCES public.campaigns(id, company_id) ON DELETE SET NULL;`);
    const r = actorFk.detect(cat);
    expect(r.findings.map((f: { column: string }) => f.column)).toContain('company_id');
  });

  it('a PG15 partial SET NULL column list is respected', () => {
    const cat = parse(`CREATE TABLE public.t (
    company_id uuid NOT NULL,
    person_id uuid
);
ALTER TABLE ONLY public.t
    ADD CONSTRAINT t_person_fk FOREIGN KEY (person_id, company_id) REFERENCES public.unified_persons(id, company_id) ON DELETE SET NULL (person_id);`);
    expect(actorFk.detect(cat).counts.error).toBe(0);
  });

  it('CASCADE and NO ACTION are not this defect class', () => {
    for (const action of ['CASCADE', 'RESTRICT', '']) {
      const cat = parse(`CREATE TABLE public.t (
    owner_id uuid NOT NULL
);
ALTER TABLE ONLY public.t
    ADD CONSTRAINT t_owner_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id)${action ? ` ON DELETE ${action}` : ''};`);
      expect(actorFk.detect(cat).counts.error).toBe(0);
    }
  });

  it('splits a CREATE TABLE body without tearing an ARRAY[...] literal apart', () => {
    const items = actorFk.splitTopLevel(
      `    a text,\n    CONSTRAINT c CHECK ((s = ANY ((ARRAY['x'::text, 'y'::text])))),\n    b uuid`,
    );
    expect(items).toHaveLength(3);
    expect(items[1]).toContain("'y'");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('actor-field registry — declarative, and checked both ways', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/migrations/actor-field-registry.json'), 'utf8'));

  it('declares the four programme actor columns with their real names', () => {
    const byKey = new Map(registry.columns.map((c: { table: string; column: string }) => [`${c.table}.${c.column}`, c]));
    for (const k of [
      'prospect_problem_observations.recorded_by_user_id',
      'source_assertions.asserted_by_user_id',
      'prospect_lifecycle_transitions.actor_user_id',
      'prospect_archive_recommendations.reviewed_by_user_id',
    ]) {
      expect(byKey.get(k)).toMatchObject({ immutable_actor: true, fk_into_users: 'absent', nullable: true });
    }
  });

  it('every registered column name appears in the migration that creates it', () => {
    // A registry that names a column the repository does not have is the
    // failure mode the detector's registry_column_missing rule exists for;
    // this test catches it without needing a database.
    const all = fs.readdirSync(MIG, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.sql'))
      .map((e) => fs.readFileSync(path.join(MIG, e.name), 'utf8')).join('\n');
    for (const c of registry.columns) {
      expect(all).toContain(c.column);
      if (c.check_constraint) expect(all).toContain(c.check_constraint);
    }
  });

  it('every immutable actor column with no FK names the writer that validates the referent', () => {
    // Dropping the FK trades an erasure defect for a dangling-reference defect
    // unless something validates the referent at write time.
    for (const c of registry.columns.filter((x: { fk_into_users: string }) => x.fk_into_users === 'absent')) {
      expect(typeof c.writer_validation).toBe('string');
      expect(c.writer_validation.length).toBeGreaterThan(0);
    }
  });

  it('does not pre-empt the owner: reports.user_id is a pending decision, not a declaration', () => {
    expect(registry.columns.some((c: { table: string }) => c.table === 'reports')).toBe(false);
    const pending = registry.pending_owner_decision.map((p: { table: string }) => p.table);
    expect(pending).toContain('reports');
    expect(pending).toContain('capability_assignments');
  });

  it('flags a declared immutable actor column that still carries a SET NULL FK', () => {
    const cat = actorFk.parseBaselineCatalog(`CREATE TABLE public.t (
    actor_user_id uuid
);
ALTER TABLE ONLY public.t
    ADD CONSTRAINT t_actor_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;`, { source: 'test' });
    const r = actorFk.detect(cat, {
      columns: [{ table: 't', column: 'actor_user_id', immutable_actor: true, fk_into_users: 'absent', nullable: true }],
    });
    expect(r.findings.map((f: { rule: string }) => f.rule)).toContain('immutable_actor_set_null_fk');
  });

  it('flags a declared immutable actor column carrying a CASCADE FK (erases the record)', () => {
    const cat = actorFk.parseBaselineCatalog(`CREATE TABLE public.t (
    actor_user_id uuid
);
ALTER TABLE ONLY public.t
    ADD CONSTRAINT t_actor_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE CASCADE;`, { source: 'test' });
    const r = actorFk.detect(cat, {
      columns: [{ table: 't', column: 'actor_user_id', immutable_actor: true, fk_into_users: 'absent', nullable: true }],
    });
    expect(r.findings.map((f: { rule: string }) => f.rule)).toContain('immutable_actor_cascade_fk');
  });

  it('the good shape — no FK at all — produces no finding', () => {
    const cat = actorFk.parseBaselineCatalog('CREATE TABLE public.t (\n    actor_user_id uuid\n);', { source: 'test' });
    const r = actorFk.detect(cat, {
      columns: [{ table: 't', column: 'actor_user_id', immutable_actor: true, fk_into_users: 'absent', nullable: true }],
    });
    expect(r.counts.error).toBe(0);
  });

  it('flags a registry nullability claim the catalog contradicts', () => {
    const cat = actorFk.parseBaselineCatalog('CREATE TABLE public.t (\n    actor_user_id uuid NOT NULL\n);', { source: 'test' });
    const r = actorFk.detect(cat, {
      columns: [{ table: 't', column: 'actor_user_id', immutable_actor: true, fk_into_users: 'absent', nullable: true }],
    });
    expect(r.findings.map((f: { rule: string }) => f.rule)).toContain('registry_nullability_mismatch');
  });

  it('CRITICAL: a point-in-time dump never claims to prove a column is absent', () => {
    // source_assertions exists in baseline.sql but asserted_by_user_id was
    // added by a LATER migration. Calling that an error would be a false
    // positive produced by the coverage boundary.
    const cat = actorFk.parseBaselineCatalog('CREATE TABLE public.t (\n    other uuid\n);', { source: 'baseline', boundary: '20260916000000' });
    const r = actorFk.detect(cat, {
      columns: [{ table: 't', column: 'actor_user_id', immutable_actor: true, fk_into_users: 'absent', nullable: true }],
    });
    const hit = r.findings.find((f: { rule: string }) => f.rule === 'registry_column_missing');
    expect(hit.severity).toBe('info');
    expect(hit.detail).toContain('NOT a pass');
    // On a live catalog (no boundary) the same absence IS an error.
    const live = actorFk.parseBaselineCatalog('CREATE TABLE public.t (\n    other uuid\n);', { source: 'pg_catalog' });
    expect(actorFk.detect(live, {
      columns: [{ table: 't', column: 'actor_user_id', immutable_actor: true, fk_into_users: 'absent', nullable: true }],
    }).findings.find((f: { rule: string }) => f.rule === 'registry_column_missing').severity).toBe('error');
  });

  it('the naming heuristic is advisory only — never an error', () => {
    const cat = actorFk.parseBaselineCatalog(`CREATE TABLE public.t (
    created_by uuid
);
ALTER TABLE ONLY public.t
    ADD CONSTRAINT t_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;`, { source: 'test' });
    const r = actorFk.detect(cat);
    expect(r.counts.error).toBe(0);
    expect(r.findings[0].rule).toBe('undeclared_actor_fk');
    expect(r.findings[0].severity).toBe('info');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('pg_catalog adapter — the array-decoding regression', () => {
  // `pg_attribute.attname` is type `name`, so array_agg over it yields name[]
  // (OID 1003). node-postgres has no parser for that OID and returns the RAW
  // literal STRING '{user_id}'. Iterating that string yields characters, every
  // column lookup misses, and the detector reported a real 870-FK catalog as
  // completely clean — six contradictions it finds correctly from the committed
  // dump became ZERO findings. Fixed with `::text` casts; these tests pin it.
  it('CRITICAL: toArray decodes the raw Postgres array literal, not just a JS array', () => {
    expect(actorFk.toArray('{user_id}')).toEqual(['user_id']);
    expect(actorFk.toArray('{person_id,company_id}')).toEqual(['person_id', 'company_id']);
    expect(actorFk.toArray('{"odd name",b}')).toEqual(['odd name', 'b']);
    expect(actorFk.toArray('{}')).toEqual([]);
    expect(actorFk.toArray(null)).toEqual([]);
    expect(actorFk.toArray(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('CRITICAL: the shape the bug produced no longer yields zero findings', () => {
    const catalog = {
      tables: new Map([['reports', { columns: new Map([['user_id', { notNull: true, type: 'uuid' }]]), checks: [] }]]),
      foreignKeys: [{
        name: 'reports_user_id_fkey',
        table: 'reports',
        columns: actorFk.toArray('{user_id}'), // was the bare string before the fix
        refSchema: 'public',
        refTable: 'users',
        refColumns: actorFk.toArray('{id}'),
        onDelete: 'SET NULL',
        setNullColumns: null,
      }],
      source: 'test',
      coverage: { tables: 1, foreignKeys: 1, boundary: null },
    };
    const r = actorFk.detect(catalog);
    expect(r.counts.error).toBe(1);
    expect(r.findings[0].column).toBe('user_id');
  });

  it('a column list that decodes to nothing is caught by the hard invariant', () => {
    // Belt and braces: if a driver change breaks decoding again, the read must
    // throw rather than hand back a catalog that looks clean.
    const src = fs.readFileSync(path.join(REPO, 'scripts/ci/check-actor-fk-compatibility.js'), 'utf8');
    expect(src).toContain('pg_catalog read is malformed');
    expect(src).toContain('Refusing to report a result that would look clean');
    expect(src).toContain('array_agg(a.attname::text ORDER BY k.ord)');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('coverage limits are stated in the tool output, not left to silence', () => {
  const capture = (result: object): string => {
    let s = '';
    actorFk.reportCoverageLimits(result, { write: (x: string) => { s += x; } });
    return s;
  };

  it('CRITICAL: names the trigger-armed foreign keys it CANNOT judge, one per line', () => {
    // A SET NULL IS an UPDATE and a CASCADE IS a DELETE, so a BEFORE
    // UPDATE/DELETE guard that can RAISE or RETURN NULL refuses the referential
    // action itself. This detector models nullability and CHECKs only, so those
    // foreign keys must be named, never left to the gate's silence.
    const nm = actorFk.loadNotModelled();
    expect(nm).not.toBeNull();
    const out = capture({ coverage: { boundary: null }, not_modelled: nm });
    expect(out).toContain('TRIGGER-ARMED ACTIONS');
    expect(out).toContain('reported above as CLEAN and are NOT');
    // The one key this detector DOES find must not be claimed as unjudged.
    expect(out).not.toContain('NOT JUDGED  public.prospect_lifecycle_transitions.actor_user_id');
    for (const k of nm.keys.filter((x: { key: string }) => x.key !== 'prospect_lifecycle_transitions.actor_user_id')) {
      expect(out).toContain(`NOT JUDGED  public.${k.key}`);
    }
  });

  it('records that the deciding predicate is the guard BODY, never its presence or name', () => {
    const nm = actorFk.loadNotModelled();
    expect(nm.deciding_predicate).toMatch(/RAISE|RETURN NULL/);
    expect(nm.deciding_predicate).toMatch(/never/i);
    // Gating on guard presence over-counts fivefold. The numbers are recorded
    // so the reason no trigger rule exists here is auditable, not folklore.
    expect(nm.candidate_surface_if_gated_on_presence).toBe(60);
    expect(nm.actually_armed).toBe(12);
    expect(nm.keys).toHaveLength(12);
    expect(nm.source).toContain('Agent F');
  });

  it('states the input horizon for a dump, and its absence for a live catalog', () => {
    expect(capture({ coverage: { boundary: '20260916000000' }, not_modelled: null }))
      .toContain('INPUT HORIZON: this run read a point-in-time dump at ledger position 20260916000000');
    expect(capture({ coverage: { boundary: null }, not_modelled: null }))
      .toContain('INPUT HORIZON: none; this run read a live catalog');
  });

  it('says the blind spot is UNKNOWN rather than nothing when no list is present', () => {
    expect(capture({ coverage: { boundary: null }, not_modelled: null }))
      .toContain('the size of that blind spot is unknown');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('safety — the detector cannot be pointed at production', () => {
  const PROD = 'postgresql://u:p@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres';

  it('CRITICAL: refuses a non-loopback host', () => {
    expect(() => actorFk.assertLocalTarget(PROD)).toThrow(/non-loopback/);
  });

  it('accepts loopback targets', () => {
    for (const h of ['localhost', '127.0.0.1']) {
      expect(actorFk.assertLocalTarget(`postgresql://u:p@${h}:55441/w6_x`)).toBe(h);
    }
  });

  it('an inherited env var cannot redirect it — only an explicit opt-in can', () => {
    const prev = process.env.ACTOR_FK_ALLOW_REMOTE;
    delete process.env.ACTOR_FK_ALLOW_REMOTE;
    expect(() => actorFk.assertLocalTarget(PROD)).toThrow();
    process.env.ACTOR_FK_ALLOW_REMOTE = '1';
    expect(actorFk.assertLocalTarget(PROD)).toContain('supabase.com');
    if (prev === undefined) delete process.env.ACTOR_FK_ALLOW_REMOTE; else process.env.ACTOR_FK_ALLOW_REMOTE = prev;
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('CI wiring — the gates run, block, and are not secret-gated', () => {
  const read = (w: string) => fs.readFileSync(path.join(REPO, '.github/workflows', w), 'utf8');

  /** The YAML text of one `- name: X` step, up to the next step at the same indent. */
  const stepBlock = (yml: string, name: string): string => {
    const i = yml.indexOf(`- name: ${name}`);
    expect(i).toBeGreaterThan(-1);
    const rest = yml.slice(i + 1);
    const next = rest.search(/\n      - name: /);
    return next === -1 ? rest : rest.slice(0, next);
  };

  it('the committed baseline detector is a step of the one REQUIRED status check on main', () => {
    // "Non-regression TypeScript baseline" is a required context on main
    // (verified against the branch-protection API on 2026-11-01). Hosting the
    // check here is why it needs no new CI wiring and cannot be bypassed.
    const yml = read('typecheck-baseline.yml');
    expect(yml).toContain('name: Non-regression TypeScript baseline');
    const step = stepBlock(yml, 'Actor-FK / CHECK compatibility (committed baseline)');
    expect(step).toContain('node scripts/ci/check-actor-fk-compatibility.js');
    expect(step).not.toContain('continue-on-error');
    expect(step).not.toMatch(/\n\s+if:/);
  });

  it('that job is not secret-gated — it runs on every pull request', () => {
    const yml = read('typecheck-baseline.yml');
    expect(yml).toMatch(/on:\s*\n\s*pull_request:\s*\n\s*push:/);
    // No `secrets.` reference anywhere in the job, so no step can skip silently.
    expect(yml).not.toContain('secrets.');
  });

  it('the migration-quality gate (rules 1-8) is still a blocking step in both workflows', () => {
    for (const w of ['typecheck-baseline.yml', 'real-schema-ci.yml']) {
      const step = stepBlock(read(w), 'Migration quality gate');
      expect(step).toContain('node scripts/check-migration-quality.js');
      expect(step).not.toContain('continue-on-error');
    }
  });

  it('the replayed-catalog detector runs AFTER the replay and is blocking', () => {
    const yml = read('real-schema-ci.yml');
    const replay = yml.indexOf('bash scripts/ci/real-schema-ci.sh');
    const detect = yml.indexOf('- name: Actor-FK / CHECK compatibility (replayed catalog)');
    expect(replay).toBeGreaterThan(-1);
    expect(detect).toBeGreaterThan(replay); // order matters: the catalog must exist first
    const step = stepBlock(yml, 'Actor-FK / CHECK compatibility (replayed catalog)');
    expect(step).toContain('--db "$W6_DB_URL"');
    expect(step).not.toContain('continue-on-error');
  });

  it('the replayed-catalog step uses the localhost service container, never a secret', () => {
    const yml = read('real-schema-ci.yml');
    expect(yml).toContain('W6_DB_URL: postgres://postgres:w6@localhost:5432/w6');
    expect(yml).not.toContain('secrets.');
  });

  it('both checks are runnable locally under the same names CI uses', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    expect(pkg.scripts['check:migrations']).toBe('node scripts/check-migration-quality.js');
    expect(pkg.scripts['check:actor-fk']).toBe('node scripts/ci/check-actor-fk-compatibility.js');
    expect(pkg.scripts['check:migrations:scan-refs']).toContain('--scan-refs');
  });

  it('the cross-branch ref scan is NOT wired into CI', () => {
    // It needs the full ref graph and sibling worktrees; a shallow CI checkout
    // has neither, so it would report a false clean. It is a local
    // pre-integration tool and must stay one.
    for (const w of fs.readdirSync(path.join(REPO, '.github/workflows'))) {
      expect(read(w)).not.toContain('--scan-refs');
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("rule 8's freeze list is an acknowledgement, not a suppression", () => {
  const known = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/migrations/set-null-known-defects.json'), 'utf8'));

  it('every frozen entry still reproduces in the file it names', () => {
    // A list that no longer matches reality is a blanket suppression. The gate
    // fails on a stale entry; this test proves the committed list is current.
    for (const k of known.known) {
      const file = k.key.split(':')[0];
      const column = k.key.split(':')[1];
      const v = gate.setNullContradictions(readMig(file));
      expect(v.some((x: Viol) => x.column === column)).toBe(true);
    }
  });

  it('every frozen entry names an owner and a classification', () => {
    for (const k of [...known.known, ...known.catalog_known]) {
      expect(k.owner).toBeTruthy();
      expect(k.classification).toBeTruthy();
      expect(k.detail.length).toBeGreaterThan(40);
    }
  });

  it('every catalog_known entry carries its evidence class', () => {
    for (const k of known.catalog_known) {
      expect(k.evidence).toMatch(/CODE_VERIFIED|PRODUCTION_CATALOG_VERIFIED|LOCAL_REPRODUCED/);
    }
  });

  it("reports.user_id is acknowledged as Agent E's, never as resolved", () => {
    const r = known.catalog_known.find((k: { key: string }) => k.key === 'reports.user_id');
    expect(r.owner).toBe('Agent E');
    expect(r.classification).toContain('REAL DEFECT');
    expect(r.evidence).toContain('PRODUCTION_CATALOG_VERIFIED');
  });

  it('records DEFECT-008 itself, and that it was fixed FORWARD not by editing history', () => {
    const d8 = known.known.find((k: { key: string }) => k.key.startsWith('20270105000000_'));
    expect(d8.classification).toContain('ALREADY FIXED FORWARD');
    expect(d8.detail).toContain('20270110000000_pi_prospect_problem_actor_fk_removal.sql');
  });

  it('every frozen file is at or below the applied boundary, which is why it cannot be edited', () => {
    const att = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/migrations/applied-boundary.json'), 'utf8'));
    for (const k of known.known) {
      const version = k.key.split('_')[0];
      expect(version.padEnd(14, '0') <= att.ledger_max.padEnd(14, '0')).toBe(true);
    }
  });
});
