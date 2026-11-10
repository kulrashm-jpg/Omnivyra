/**
 * Static contract for 20270111100012_extension_dispatch_safety.sql and its
 * rollback. No database is started here; the integration owner verifies the
 * migration on a disposable real PostgreSQL. These assertions pin the safety
 * properties the application code relies on.
 */
import { readFileSync } from 'fs';
import { createHash } from 'crypto';

const MIG = 'supabase/migrations/20270111100012_extension_dispatch_safety.sql';
const RB = 'supabase/migrations/rollbacks/extension_dispatch_safety_rollback.sql';
const sql = readFileSync(MIG, 'utf8');
const rb = readFileSync(RB, 'utf8');

/** Body of one CREATE OR REPLACE FUNCTION ... $$ ... $$ block. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = src.indexOf('AS $$', start);
  const close = src.indexOf('$$;', open + 5);
  return src.slice(open, close);
}

/** One `WITH reaped AS ( UPDATE ... )` phase of the reaper, by error code. */
function reaperPhase(code: string): string {
  const body = fnBody(sql, 'reap_community_ai_action_leases');
  const at = body.indexOf(`'${code}'`);
  const start = body.lastIndexOf('WITH reaped AS', at);
  const end = body.indexOf('GET DIAGNOSTICS', at);
  return body.slice(start, end);
}

describe('preconditions and idempotency', () => {
  it('requires the uncertain status (20261231000002) and every column it uses', () => {
    expect(sql).toMatch(/v_def NOT LIKE '%''uncertain''%'/);
    for (const c of ['cancel_requested_at', 'approved_at', 'requires_human_approval', 'risk_level', 'dispatch_lease_holder_id']) {
      expect(sql).toContain(`'${c}'`);
    }
    expect(sql).toContain("to_regclass('public.community_ai_platform_policy') IS NULL");
  });

  it('is re-runnable: replace/if-not-exists only, no destructive DDL', () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|FUNCTION|COLUMN|CONSTRAINT)\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.rpa_auth_token_redemptions');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS');
  });

  it('does not edit the 20260713 reaper migration (content hash pinned to base 721fb8fe)', () => {
    const base = readFileSync('supabase/migrations/20260713_fix_reap_lease_returning.sql');
    expect(createHash('sha256').update(base).digest('hex'))
      .toBe('a0af306e0e16c1ddd24ab62f9916ce7a2fc8169d6a6f2a5f792e58cf41013039');
  });
});

describe('reaper: possibly-delivered rows become uncertain, never failed', () => {
  const body = fnBody(sql, 'reap_community_ai_action_leases');

  it.each(['DISPATCH_LEASE_EXPIRED', 'DISPATCH_LEASE_EXPIRED_IN_FLIGHT', 'EXECUTING_TIMEOUT'])(
    '%s phase sets status uncertain + may_have_acted, keeps the error code',
    (code) => {
      const phase = reaperPhase(code);
      expect(phase).toMatch(/SET\s+status\s*=\s*'uncertain'/);
      expect(phase).toContain("'may_have_acted',         true");
      expect(phase).not.toMatch(/status\s*=\s*'failed'/);
    },
  );

  it('no phase writes status failed anywhere in the function', () => {
    expect(body).not.toMatch(/status\s*=\s*'failed'/);
  });

  it('lease id / holder are KEPT on reaped rows (late-result authentication)', () => {
    for (const code of ['DISPATCH_LEASE_EXPIRED', 'DISPATCH_LEASE_EXPIRED_IN_FLIGHT']) {
      const phase = reaperPhase(code);
      expect(phase).not.toContain('dispatch_lease_id          = NULL');
      expect(phase).not.toMatch(/dispatch_lease_holder_id\s*=\s*NULL/);
    }
  });

  it('the lease-clearing sweep never touches uncertain rows', () => {
    const cleared = body.slice(body.indexOf('WITH cleared AS'), body.indexOf('SELECT COUNT(*) INTO v_lease_cleared'));
    expect(cleared).toContain("status IN ('executed', 'sent_unverified', 'failed', 'skipped', 'blocked')");
    expect(cleared).not.toContain('uncertain');
  });

  it('keeps the RPC contract cron.ts reads (counter keys)', () => {
    for (const k of ['reaped_pending', 'reaped_dispatched', 'reaped_executing', 'lease_cleared']) {
      expect(body).toContain(`'${k}'`);
    }
  });

  it('postcondition refuses a failed-marking reaper body', () => {
    expect(sql).toMatch(/IF v_src ~ 'status\\s\*=\\s\*''failed'''/);
  });
});

describe('claim: one atomic conditional UPDATE enforces every gate', () => {
  const body = fnBody(sql, 'claim_community_ai_browser_command');
  const update = body.slice(body.indexOf('UPDATE community_ai_actions a'), body.indexOf('RETURNING a.id'));

  it.each([
    ['tenant', 'a.organization_id     = p_organization_id'],
    ['pending', "a.status              = 'pending'"],
    ['browser', "a.execution_mode      = 'browser'"],
    ['never claimed (no re-offer of a lapsed lease, any client)', 'a.dispatch_lease_id   IS NULL'],
    ['not cancelled', 'a.cancel_requested_at IS NULL'],
    ['approval: approved_at', 'a.approved_at IS NOT NULL'],
    ['approval: row requirement', 'a.requires_human_approval IS NOT TRUE'],
    ['approval: high risk', "coalesce(a.risk_level, '') <> 'high'"],
    ['approval: platform policy', 'NOT v_require_human_approval'],
  ])('%s', (_label, predicate) => {
    expect(update).toContain(predicate);
  });

  it('kill switch: policy read in the same function; disabled → returns nothing', () => {
    expect(body).toContain('FROM community_ai_platform_policy p');
    expect(body).toMatch(/IF NOT v_execution_enabled THEN\s+RETURN;/);
  });

  it('lease expiry is set by the database clock with a bounded TTL', () => {
    expect(update).toContain('NOW() + make_interval(secs => p_lease_ttl_seconds)');
    expect(body).toContain('p_lease_ttl_seconds > 600');
  });
});

describe('late-result reconciliation', () => {
  const body = fnBody(sql, 'record_community_ai_late_dispatch_result');

  it('only for the uncertain row of the same tenant, lease and holder', () => {
    for (const p of [
      'a.organization_id          = p_organization_id',
      "a.status                   = 'uncertain'",
      'a.dispatch_lease_id        = p_lease_id',
      'a.dispatch_lease_holder_id = p_holder_id',
    ]) expect(body).toContain(p);
  });

  it('never changes the status; appends to execution_result.late_results (bounded)', () => {
    const set = body.slice(body.indexOf('SET execution_result'), body.indexOf('WHERE a.id'));
    expect(set).not.toMatch(/\bstatus\s*=/);
    expect(set).toContain("'{late_results}'");
    expect(body).toContain("jsonb_array_length(coalesce(a.execution_result -> 'late_results', '[]'::jsonb)) < 20");
  });
});

describe('single-use RPA token ledger and privileges', () => {
  it('nonce is the primary key; RLS on; anon/authenticated revoked', () => {
    expect(sql).toMatch(/nonce\s+text\s+PRIMARY KEY/);
    expect(sql).toContain('ALTER TABLE public.rpa_auth_token_redemptions ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON TABLE public.rpa_auth_token_redemptions FROM anon');
    expect(sql).toContain('REVOKE ALL ON TABLE public.rpa_auth_token_redemptions FROM authenticated');
  });

  it('every function is SECURITY DEFINER with a pinned search_path, service_role only', () => {
    for (const name of ['reap_community_ai_action_leases', 'claim_community_ai_browser_command', 'record_community_ai_late_dispatch_result']) {
      const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
      const header = sql.slice(start, sql.indexOf('AS $$', start));
      expect(header).toContain('SECURITY DEFINER');
      expect(header).toContain('SET search_path = public, pg_temp');
    }
    expect(sql).toContain("EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f)");
    expect(sql).toContain("has_function_privilege('anon', to_regprocedure(f), 'EXECUTE')");
  });
});

describe('rollback refuses to lose data or silently re-enable the unsafe reaper', () => {
  it('refuses while any redeemed token is unexpired (replay window would reopen)', () => {
    expect(rb).toContain('WHERE token_expires_at > NOW()');
    expect(rb).toMatch(/RAISE EXCEPTION 'extension dispatch safety rollback: % redeemed RPA auth tokens are still unexpired/);
  });

  it('keeps the uncertain-outcome reaper unless an explicit acknowledgement is set', () => {
    expect(rb).toContain("current_setting('omnivyra.extension_dispatch_safety_restore_failed_reaper', true)");
    expect(rb).toContain("'i-accept-duplicate-send-risk'");
    const guard = rb.indexOf("'i-accept-duplicate-send-risk'");
    const restore = rb.indexOf('CREATE OR REPLACE FUNCTION public.reap_community_ai_action_leases()');
    expect(guard).toBeGreaterThan(0);
    expect(restore).toBeGreaterThan(guard);
  });

  it('never rewrites uncertain rows', () => {
    expect(rb).not.toMatch(/UPDATE\s+(public\.)?community_ai_actions[\s\S]{0,200}uncertain/);
    expect(rb).not.toMatch(/DELETE\s+FROM\s+(public\.)?community_ai_actions/i);
  });
});
