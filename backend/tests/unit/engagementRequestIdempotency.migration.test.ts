/**
 * Static contract for 20261231000008_engagement_request_idempotency.sql and
 * its rollback. No database is started here; the integration owner verifies
 * the migration on a disposable real PostgreSQL. These assertions pin the
 * properties engagementRequestIdempotency.ts relies on.
 */
import { readFileSync } from 'fs';

const MIG = 'supabase/migrations/20261231000008_engagement_request_idempotency.sql';
const RB = 'supabase/migrations/rollbacks/engagement_request_idempotency_rollback.sql';
const sql = readFileSync(MIG, 'utf8');
const rb = readFileSync(RB, 'utf8');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const idem = require('../../services/engagementRequestIdempotency');

const table = (() => {
  const start = sql.indexOf('CREATE TABLE IF NOT EXISTS public.engagement_request_idempotency (');
  expect(start).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf('\n);', start));
})();

describe('preconditions, idempotency, shape', () => {
  it('requires companies, community_ai_actions and the uncertain status vocabulary', () => {
    expect(sql).toContain("to_regclass('public.companies') IS NULL");
    expect(sql).toContain("to_regclass('public.community_ai_actions') IS NULL");
    expect(sql).toMatch(/community_ai_actions_status_check[\s\S]*LIKE '%uncertain%'/);
  });

  it('every additive statement is guarded (IF NOT EXISTS)', () => {
    const creates = sql.match(/CREATE (UNIQUE )?(TABLE|INDEX)[^\n]*/g) || [];
    expect(creates.length).toBeGreaterThanOrEqual(5);
    for (const c of creates) expect(c).toMatch(/IF NOT EXISTS/);
  });

  it('the primary key is the reservation; the natural key and one-record-per-action are unique', () => {
    expect(table).toMatch(/\bid\s+uuid\s+PRIMARY KEY/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_engagement_request_idempotency_key\s+ON public\.engagement_request_idempotency \(organization_id, actor_id, scope, idempotency_key\)/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_engagement_request_idempotency_action\s+ON public\.engagement_request_idempotency \(action_id\)/);
  });

  it('tenant row: organization_id NOT NULL referencing companies, cascading on erasure', () => {
    expect(table).toMatch(/organization_id\s+uuid\s+NOT NULL REFERENCES public\.companies \(id\) ON DELETE CASCADE/);
  });

  it('action_id is deliberately NOT a foreign key (reserved before the action row exists)', () => {
    expect(table).toMatch(/action_id\s+uuid\s+NOT NULL,/);
    expect(table).not.toMatch(/action_id[^\n]*REFERENCES/);
  });

  it('the state / scope / key-source vocabularies match the application exactly', () => {
    expect(table).toContain("CHECK (state IN ('reserved', 'completed', 'failed_not_acted', 'uncertain'))");
    expect(table).toContain("CHECK (scope IN ('reply', 'like'))");
    expect(table).toContain("CHECK (key_source IN ('client', 'derived'))");
    expect(table).toContain("CHECK ((state = 'reserved') = (finalized_at IS NULL))");
    expect(table).toContain("CHECK (attempt >= 1)");
  });

  it('the key-shape CHECK accepts exactly what the application writes', () => {
    expect(table).toMatch(/key_source = 'client'\s+AND idempotency_key ~ '\^\[A-Za-z0-9\._:-\]\{8,200\}\$'/);
    expect(table).toMatch(/key_source = 'derived' AND idempotency_key ~ '\^derived:\[0-9a-f\]\{64\}\$'/);
    const fp = idem.computeRequestFingerprint({ scope: 'reply', platform: 'linkedin', messageId: 'm', text: 't', account: 'o' });
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(idem.resolveRequestKey(null, fp).key).toMatch(/^derived:[0-9a-f]{64}$/);
    expect(table).toContain("CHECK (request_fingerprint ~ '^[0-9a-f]{64}$')");
  });
});

describe('access — service role only', () => {
  it('enables RLS with no policy and revokes every privilege from PUBLIC, anon and authenticated', () => {
    expect(sql).toContain('ALTER TABLE public.engagement_request_idempotency ENABLE ROW LEVEL SECURITY;');
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(sql).toContain(`REVOKE ALL ON TABLE public.engagement_request_idempotency FROM ${role};`);
    }
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/GRANT[^\n;]*TO (anon|authenticated|PUBLIC)/i);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.engagement_request_idempotency TO service_role;/);
  });

  it('creates no functions (so no SECURITY DEFINER surface) and no schedule', () => {
    expect(sql).not.toMatch(/CREATE (OR REPLACE )?FUNCTION/i);
    expect(sql).not.toMatch(/SECURITY DEFINER/i);
    expect(sql).not.toMatch(/cron\.schedule|pg_cron/i);
  });

  it('postconditions verify RLS, absence of policies and of anon/authenticated privileges', () => {
    expect(sql).toContain('relrowsecurity');
    expect(sql).toContain("FROM pg_policies WHERE schemaname = 'public' AND tablename = 'engagement_request_idempotency'");
    expect(sql).toMatch(/has_table_privilege\(r\.rolname, 'public\.engagement_request_idempotency', p\.priv\)/);
  });
});

describe('rollback — refuses while live reservations exist', () => {
  it('refuses on reserved / uncertain rows BEFORE dropping anything', () => {
    const refuse = rb.indexOf("WHERE state IN ('reserved', 'uncertain')");
    const drop = rb.indexOf('DROP TABLE IF EXISTS public.engagement_request_idempotency');
    expect(refuse).toBeGreaterThan(0);
    expect(drop).toBeGreaterThan(refuse);
    expect(rb).toMatch(/RAISE EXCEPTION 'engagement request idempotency rollback: % live reservation/);
  });

  it('refuses while completed records are inside the replay window unless explicitly acknowledged', () => {
    expect(rb).toContain("state = 'completed' AND expires_at > now()");
    expect(rb).toContain("current_setting('omnivyra.engagement_request_idempotency_drop_replay_window', true)");
    expect(rb).toContain("'i-accept-replay-loss'");
  });
});

describe('application constants agree with the documented lifecycle', () => {
  it('24 h replay window, 15 min staleness, 7 d purge grace, bounded purge', () => {
    expect(idem.ENGAGEMENT_REQUEST_REPLAY_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    expect(idem.ENGAGEMENT_REQUEST_STALE_MS).toBe(15 * 60 * 1000);
    expect(idem.ENGAGEMENT_REQUEST_PURGE_GRACE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(idem.ENGAGEMENT_REQUEST_PURGE_MAX).toBe(500);
    expect(idem.ENGAGEMENT_REQUEST_TABLE).toBe('engagement_request_idempotency');
  });
});
