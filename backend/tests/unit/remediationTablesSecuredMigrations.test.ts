/**
 * Contract for the two SECURED migrations that replace the unsafe originals for deployment:
 *   20261223000000_customer_readiness_snapshots_secured.sql  (supersedes 20260723000000)
 *   20261223000001_execution_approvals_secured.sql           (supersedes 20260727040000)
 *
 * Static checks only (no database): RLS on, a service-role-only policy, every client role revoked,
 * no grant to a client role, additive DDL guarded, and — for the readiness table — every column the
 * writer emits exists in the table definition.
 */
import fs from 'fs';
import path from 'path';
import { buildSnapshotRow } from '../../services/customerReadinessSnapshotService';

const MIG = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const read = (f: string) => fs.readFileSync(path.join(MIG, f), 'utf8');
const code = (sql: string) => sql.replace(/--[^\n]*/g, ''); // statements only

const CASES = [
  { file: '20261223000000_customer_readiness_snapshots_secured.sql', table: 'customer_readiness_snapshots', policy: 'customer_readiness_snapshots_service_role' },
  { file: '20261223000001_execution_approvals_secured.sql', table: 'execution_approvals', policy: 'execution_service_role' },
] as const;

describe.each(CASES)('$file', ({ file, table, policy }) => {
  const sql = code(read(file));

  it('runs in its own transaction', () => {
    expect(sql).toMatch(/^\s*BEGIN;/m);
    expect(sql).toMatch(/^\s*COMMIT;\s*$/m);
  });

  it('guards additive DDL (CREATE TABLE / INDEX IF NOT EXISTS)', () => {
    expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`));
    expect(sql).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
  });

  it('enables row level security', () => {
    expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  });

  it('has exactly one policy, for service_role only, created idempotently', () => {
    expect(sql).toMatch(new RegExp(`DROP POLICY IF EXISTS ${policy} ON public\\.${table}`));
    const creates = [...sql.matchAll(/CREATE POLICY\s+(\w+)\s+ON\s+public\.(\w+)\s+FOR\s+\w+\s+TO\s+([\w, ]+?)\s+USING/g)];
    expect(creates).toHaveLength(1);
    expect(creates[0][1]).toBe(policy);
    expect(creates[0][3].trim()).toBe('service_role');
  });

  it('revokes every client role and grants nothing to them', () => {
    expect(sql).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated;`));
    expect(sql).not.toMatch(/GRANT[^;]*TO\s+[^;]*\b(anon|authenticated|PUBLIC)\b/i);
    expect(sql).toMatch(new RegExp(`GRANT [A-Z, ]+ ON TABLE public\\.${table} TO service_role;`));
  });

  it('asserts its end state before committing (postconditions)', () => {
    expect(sql).toMatch(/postcondition: RLS is not enabled/);
    expect(sql).toMatch(/postcondition: anon\/authenticated still hold a privilege/);
  });
});

describe('customer_readiness_snapshots — writer/table agreement', () => {
  it('every column the daily writer emits is defined by the secured migration', () => {
    const sql = code(read('20261223000000_customer_readiness_snapshots_secured.sql'));
    const body = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS public.customer_readiness_snapshots'));
    const defined = new Set([...body.slice(0, body.indexOf(');')).matchAll(/^\s+([a-z_]+)\s+(uuid|timestamptz|date|text|integer)\b/gm)].map((m) => m[1]));
    const row = buildSnapshotRow({
      company_id: '00000000-0000-0000-0000-000000000001', tenant_status: 'ACTIVE', overall_readiness_score: 50,
      readiness_bucket: 'PARTIAL', priority_score: 1, priority_tier: 'LOW', opportunities: [],
      company_profile_ready: 'READY', website_ready: 'READY', ga_ready: 'READY', gsc_ready: 'READY',
      social_ready: 'READY', community_ready: 'READY', team_ready: 'READY', billing_ready: 'READY',
    } as any, '2026-10-29T00:00:00.000Z');
    const missing = Object.keys(row).filter((k) => !defined.has(k));
    expect(missing).toEqual([]);
  });

  it('keeps the unique (company_id, snapshot_date) index the writer ON CONFLICT relies on', () => {
    const sql = code(read('20261223000000_customer_readiness_snapshots_secured.sql'));
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_crs_company_day\s+ON public\.customer_readiness_snapshots \(company_id, snapshot_date\)/);
  });
});

describe('execution_approvals — upsert target', () => {
  it('keeps the unique (company_id, campaign_id, version) constraint recordApproval upserts on', () => {
    const sql = code(read('20261223000001_execution_approvals_secured.sql'));
    expect(sql).toMatch(/CONSTRAINT uq_execution_approval UNIQUE \(company_id, campaign_id, version\)/);
  });
});
