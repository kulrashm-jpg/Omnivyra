/**
 * W5 — canonical person spine tenant-integrity contract lock.
 *
 * WHAT THIS PROVES: that the committed migration still declares all eleven
 * tenant-safe composite foreign keys, in the right shape, with the delete
 * action each edge had before W5.
 *
 * WHAT THIS DOES NOT PROVE: that production actually has them. Jest runs
 * against mocks here; there is no real-schema CI (finding A-5'). A future
 * migration could drop one of these constraints and this file would stay
 * green. Until A-5' lands, the live invariant is verified only by the ops
 * applier's postconditions and by manual probing.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION = join(__dirname, '../../../supabase/migrations/20260924000000_w5_person_spine_tenant_integrity.sql');
const ROLLBACK = join(__dirname, '../../../supabase/migrations/rollbacks/w5_person_spine_tenant_integrity_rollback.sql');

/** [table, person column, tenant column, constraint name, delete action] */
const EDGES: Array<[string, string, string, string, string]> = [
  ['canonical_leads', 'unified_person_id', 'company_id', 'canonical_leads_person_tenant_fk', 'SET NULL (unified_person_id)'],
  ['canonical_revenue_events', 'unified_person_id', 'company_id', 'canonical_revenue_events_person_tenant_fk', 'SET NULL (unified_person_id)'],
  ['canonical_users', 'unified_person_id', 'company_id', 'canonical_users_person_tenant_fk', 'SET NULL (unified_person_id)'],
  ['contacts', 'unified_person_id', 'organization_id', 'contacts_person_tenant_fk', 'SET NULL (unified_person_id)'],
  ['engagement_threads', 'unified_person_id', 'organization_id', 'engagement_threads_person_tenant_fk', 'SET NULL (unified_person_id)'],
  ['expected_event_instances', 'unified_person_id', 'company_id', 'expected_event_instances_person_tenant_fk', 'SET NULL (unified_person_id)'],
  ['leads', 'unified_person_id', 'company_id', 'leads_person_tenant_fk', 'SET NULL (unified_person_id)'],
  ['unified_touchpoints', 'unified_person_id', 'company_id', 'unified_touchpoints_person_tenant_fk', 'SET NULL (unified_person_id)'],
  ['visitor_sessions', 'unified_person_id', 'company_id', 'visitor_sessions_person_tenant_fk', 'SET NULL (unified_person_id)'],
  ['unified_person_merges', 'winner_person_id', 'company_id', 'unified_person_merges_winner_tenant_fk', 'CASCADE'],
  ['unified_person_merges', 'loser_person_id', 'company_id', 'unified_person_merges_loser_tenant_fk', 'CASCADE'],
];

const migration = readFileSync(MIGRATION, 'utf8');
const rollback = readFileSync(ROLLBACK, 'utf8');

describe('W5 migration declares every spine edge', () => {
  it.each(EDGES)('%s.%s is tenant-safe', (tbl, pcol, tcol, name, del) => {
    expect(migration).toContain(`'${tbl}',`);
    expect(migration).toContain(`'${name}'`);
    expect(migration).toContain(`'${del}'`);
    // the pair must be declared together for this table
    const row = migration.split('\n').join(' ');
    expect(row).toMatch(new RegExp(`'${tbl}',\\s*'${pcol}',\\s*'${tcol}'`));
  });

  it('references (id, company_id) — the key W2 created', () => {
    expect(migration).toContain('REFERENCES public.unified_persons (id, company_id)');
    expect(migration).toContain('uq_unified_persons_id_company');
  });

  it('asserts a FLOOR of 13 composite person keys: 2 inherited plus 11 from W5', () => {
    // A floor, not an equality. LI-2 added source_records and source_assertions
    // as further tenant-safe person references; an exact-count assertion would
    // have made that correct addition fail W5's own replay.
    expect(migration).toContain('v_count < 13');
    expect(migration).not.toContain('v_count <> 13');
  });
});

describe('W5 refuses to repair data', () => {
  it('aborts rather than converting an edge that already holds cross-tenant rows', () => {
    expect(migration).toContain('existing cross-tenant data blocks this migration');
  });

  it('contains no statement that could rewrite or remove a row', () => {
    const body = migration.replace(/--[^\n]*/g, '');
    expect(body).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(body).not.toMatch(/\bUPDATE\s+public\./i);
    expect(body).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(body).not.toMatch(/\bTRUNCATE\b/i);
  });
});

describe('W5 leaves the two unconvertible edges alone', () => {
  it.each(['users', 'engagement_identity_candidates'])('does not constrain %s', (tbl) => {
    expect(migration).not.toMatch(new RegExp(`ALTER TABLE public\\.${tbl}\\b`));
    expect(migration).not.toMatch(new RegExp(`'${tbl}',\\s*'`));
  });
});

describe('W5 rollback', () => {
  it('restores every simple key it removed', () => {
    for (const [tbl] of EDGES) {
      if (tbl === 'unified_person_merges') continue;
      expect(rollback).toMatch(new RegExp(`ADD CONSTRAINT [a-z_]+\\s+FOREIGN KEY \\(unified_person_id\\)`));
      expect(rollback).toContain(`ALTER TABLE public.${tbl}`);
    }
  });

  it('leaves loser_person_id unconstrained, as it was before W5', () => {
    expect(rollback).not.toMatch(/ADD CONSTRAINT[^;]*loser_person_id/);
    expect(rollback).toContain('intentionally gets NO constraint back');
  });

  it('cannot be run by accident — it reopens the tenant boundary', () => {
    expect(rollback).toContain('w5.confirm_reopen_tenant_boundary');
    expect(rollback).toContain('RAISE EXCEPTION');
  });
});
