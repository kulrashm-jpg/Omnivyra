/**
 * Static contract for migration re-run safety (2026-10-28):
 *
 *  1. Re-running 20261227000000 after 20261231000004 must not narrow
 *     publish_workflow_version's channel vocabulary (it used to drop social_post).
 *  2. Re-running a frozen legacy lease reaper (20260522..20260525, 20260713) must
 *     not bring back "claimed row -> failed": 20261231000009's trigger converts it
 *     to 'uncertain', whichever reaper body is installed.
 *  3. The 20261231 rollbacks document one order and refuse the wrong ones.
 *
 * No database is started here. The same properties were proven on a disposable
 * real PostgreSQL 17 (see the commit message); these assertions pin the SQL
 * logic that proof exercised, and every one of them fails on dd320365.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const M = 'supabase/migrations/';
const R = `${M}rollbacks/`;

const M032 = read(`${M}20261227000000_pi_workflow_definitions.sql`);
const M004 = read(`${M}20261231000004_social_publish_step_channel.sql`);
const M005 = read(`${M}20261231000005_extension_dispatch_safety.sql`);
const M009 = read(`${M}20261231000009_migration_rerun_safety.sql`);
const RB009 = read(`${R}migration_rerun_safety_rollback.sql`);
const RB002 = read(`${R}community_execution_safety_rollback.sql`);
const RB003 = read(`${R}community_journey_link_rollback.sql`);
const RB004 = read(`${R}social_publish_step_channel_rollback.sql`);
const RB005 = read(`${R}extension_dispatch_safety_rollback.sql`);
const RB006 = read(`${R}community_identity_link_rollback.sql`);
const RB007 = read(`${R}identity_verification_rollback.sql`);
const RB008 = read(`${R}engagement_request_idempotency_rollback.sql`);

const REAP_CODES = ['DISPATCH_LEASE_EXPIRED', 'DISPATCH_LEASE_EXPIRED_IN_FLIGHT', 'EXECUTING_TIMEOUT'];

/** SQL without `--` comments, so prose can never satisfy a code assertion. */
const code = (s: string): string => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

/** The publish function as one file defines it: CREATE ... up to its closing `$$;`. */
function publishFn(src: string): string {
  const head = 'CREATE OR REPLACE FUNCTION public.publish_workflow_version(';
  const at = src.indexOf(head);
  expect(at).toBeGreaterThanOrEqual(0);
  return src.slice(at, src.indexOf('\n$$;', at));
}

describe('1. re-running 20261227000000 never narrows the publish vocabulary', () => {
  const c = code(M032);
  const createAt = c.indexOf('CREATE OR REPLACE FUNCTION public.publish_workflow_version(');

  // The regex the migration itself uses to read a vocabulary out of
  // pg_get_functiondef — taken FROM the SQL, so the test exercises that regex.
  const sqlRegexes = [...c.matchAll(/FROM \$re\$(.*?)\$re\$\),\s*\$re\$(.*?)\$re\$, 'g'\)/g)];
  const vocab = (fnText: string): string[] => {
    const [list, item] = [new RegExp(sqlRegexes[0][1]), new RegExp(sqlRegexes[0][2], 'g')];
    const m = list.exec(fnText);
    if (!m) return [];
    return [...new Set([...m[1].matchAll(item)].map((x) => x[1]))].sort();
  };

  it('reads the vocabulary with the SAME regex at capture, restore and postcondition', () => {
    expect(sqlRegexes).toHaveLength(3);
    for (const r of sqlRegexes) {
      expect(r[1]).toBe(sqlRegexes[0][1]);
      expect(r[2]).toBe(sqlRegexes[0][2]);
    }
  });

  it('that regex reads 032 as 11 channels and 20261231000004 as a strict superset adding social_post', () => {
    const v032 = vocab(publishFn(M032));
    const v004 = vocab(publishFn(M004));
    expect(v032).toEqual(['community', 'content', 'discord', 'email', 'github', 'internal',
      'linkedin', 'phone', 'slack', 'sms', 'whatsapp']);
    expect(v004).toEqual([...v032, 'social_post'].sort());
  });

  it('captures the installed definition BEFORE the CREATE and restores a strict superset AFTER it', () => {
    const capture = c.indexOf("pg_get_functiondef('public.publish_workflow_version(uuid, uuid, uuid)'::regprocedure);");
    expect(capture).toBeGreaterThan(0);
    expect(capture).toBeLessThan(createAt);
    expect(c).toMatch(/INSERT INTO pg_temp\.wf032_publish_prior \(prior_def, prior_channels\) VALUES \(v_def, v_ch\)/);
    const restore = c.indexOf('IF v_prior @> v_file THEN');
    expect(restore).toBeGreaterThan(createAt);
    expect(c.slice(restore, restore + 200)).toMatch(/EXECUTE v_def;/);
    // Incomparable vocabularies are refused, never silently replaced.
    expect(c).toMatch(/IF NOT \(v_file @> v_prior\) THEN\s*RAISE EXCEPTION '[^\n]*are incomparable; refusing/);
    // An unreadable installed vocabulary is refused too.
    expect(c).toMatch(/no readable channel vocabulary; refusing to replace it blindly/);
  });

  it('the postcondition requires installed ⊇ file vocabulary AND installed ⊇ prior vocabulary', () => {
    // The LAST DO block is the postcondition.
    const tail = c.slice(c.lastIndexOf('DO $$'));
    expect(tail).toMatch(/PI-WORKFLOW-DEFINITION-032 postcondition/);
    expect(tail).toMatch(/IF a IS NULL OR fc IS NULL OR NOT \(a @> fc\) THEN\s*RAISE EXCEPTION/);
    expect(tail).toMatch(/IF pc IS NOT NULL AND NOT \(a @> pc\) THEN\s*RAISE EXCEPTION '[^']*narrowed/);
  });

  it('the function body itself is unchanged (the 004 rollback still restores it verbatim)', () => {
    const fnOf = (src: string) => publishFn(src).replace(/\r/g, '');
    expect(fnOf(RB004)).toBe(fnOf(M032));
    expect(M032).not.toMatch(/SECURITY DEFINER/);
  });

  it('the scratch table is session-local and removed at the end', () => {
    expect(c).toMatch(/CREATE TEMP TABLE IF NOT EXISTS wf032_publish_prior/);
    expect(c.trimEnd().endsWith('DROP TABLE IF EXISTS pg_temp.wf032_publish_prior;')).toBe(true);
  });
});

describe('2. 20261231000009 — a legacy reaper can never mark a claimed row failed', () => {
  const c = code(M009);
  const guardAt = c.indexOf('CREATE OR REPLACE FUNCTION public.community_ai_actions_reap_uncertain_guard()');
  const fn = guardAt < 0 ? '' : c.slice(guardAt, c.indexOf('\n$$;', guardAt));

  it('every frozen legacy reaper body writes failed with only the codes the guard converts', () => {
    const legacy = [
      '20260522_community_ai_execution_integrity.sql',
      '20260523_community_ai_execution_phase2.sql',
      '20260524_community_ai_execution_centralization.sql',
      '20260525_community_ai_execution_phase4.sql',
      '20260713_fix_reap_lease_returning.sql',
    ];
    const seen = new Set<string>();
    for (const f of legacy) {
      const src = read(M + f);
      const at = src.indexOf('FUNCTION reap_community_ai_action_leases()');
      expect(at).toBeGreaterThan(0);
      const body = src.slice(at, src.indexOf('$$;', src.indexOf('AS $$', at) + 5));
      expect(body).toMatch(/status\s*=\s*'failed'/);
      for (const m of body.matchAll(/'error_code',\s*'([A-Z_]+)'/g)) seen.add(m[1]);
    }
    expect([...seen].sort()).toEqual([...REAP_CODES].sort());
    // …and they are exactly the codes the 005 reaper writes as uncertain.
    for (const k of REAP_CODES) expect(M005).toContain(`'${k}'`);
  });

  it('the guard converts exactly those codes, on claimed rows only, keeping the lease', () => {
    expect(fn).toMatch(/v_code NOT IN \('DISPATCH_LEASE_EXPIRED', 'DISPATCH_LEASE_EXPIRED_IN_FLIGHT', 'EXECUTING_TIMEOUT'\)/);
    expect(fn).toMatch(/OLD\.status IN \('dispatched', 'acknowledged', 'executing'\)/);
    expect(fn).toMatch(/OLD\.dispatch_lease_id\s+IS NOT NULL/);
    expect(fn).toMatch(/NEW\.status\s+:= 'uncertain';/);
    for (const col of ['dispatch_lease_id', 'dispatch_lease_expires_at', 'dispatch_lease_holder_id', 'dispatch_acknowledged_at']) {
      expect(fn).toMatch(new RegExp(`NEW\\.${col}\\s+:= OLD\\.${col};`));
    }
    expect(fn).toMatch(/'may_have_acted',\s+true/);
    expect(fn).toMatch(/'prior_status',\s+OLD\.status/);
    expect(fn).toMatch(/'prior_execution_result', OLD\.execution_result/);
    expect(fn).not.toMatch(/RAISE EXCEPTION/);       // converts; never aborts the reaper
    expect(fn).toMatch(/SECURITY INVOKER/);
  });

  it('is a BEFORE UPDATE row trigger, replaced in place (no unguarded window on re-run)', () => {
    expect(c).toMatch(/CREATE OR REPLACE TRIGGER trg_community_ai_actions_reap_uncertain_guard\s+BEFORE UPDATE ON public\.community_ai_actions\s+FOR EACH ROW\s+WHEN \(NEW\.status = 'failed' AND OLD\.status IS DISTINCT FROM 'failed'\)/);
    expect(c).not.toMatch(/DROP TRIGGER/);
  });

  it('legitimate executor failures are untouched: no application code writes a reaper code', () => {
    for (const f of ['backend/services/communityAiActionExecutorRuntime.ts',
      'backend/services/communityAiExecutionResultService.ts']) {
      const src = read(f);
      for (const k of REAP_CODES) expect(src).not.toContain(k);
    }
  });

  it('hygiene: precondition on the uncertain vocabulary, static REVOKE, strict postconditions', () => {
    expect(c).toMatch(/status CHECK does not allow ''uncertain'' \(apply 20261231000002 first\)/);
    expect(c).toMatch(/REVOKE EXECUTE ON FUNCTION public\.community_ai_actions_reap_uncertain_guard\(\) FROM PUBLIC, anon, authenticated;/);
    expect(c).not.toMatch(/GRANT /);
    expect(c).toMatch(/is missing, disabled or not BEFORE UPDATE FOR EACH ROW/);
    expect(c).toMatch(/the guard body is not the uncertain-converting version/);
    expect(M009).toMatch(/rollbacks\/migration_rerun_safety_rollback\.sql/);
  });
});

describe('3. rollback order is documented and wrong orders refuse', () => {
  const ORDER = '0009 -> 0008 -> 0007 -> 0006 -> 0003 -> 0004 -> 0005 -> 0002 -> 0001 -> 0000';
  const before = (src: string, refusal: RegExp, firstDrop: RegExp): void => {
    const c = code(src);
    const r = c.search(refusal);
    const d = c.search(firstDrop);
    expect(r).toBeGreaterThan(0);
    expect(d).toBeGreaterThan(r);
  };

  it('every rollback in the chain states the same order', () => {
    for (const rb of [RB009, RB008, RB007, RB006, RB003, RB004, RB005, RB002]) expect(rb).toContain(ORDER);
  });

  it('0009 refuses while a failed-marking reaper is installed (unless explicitly acknowledged)', () => {
    before(RB009, /v_src ~ 'status\\s\*=\\s\*''failed'''/, /DROP TRIGGER/);
    expect(RB009).toContain("current_setting('omnivyra.migration_rerun_safety_drop_guard', true)");
    expect(RB009).toMatch(/rollback refused: the installed lease reaper marks claimed rows failed/);
  });

  it('0002 refuses while the 0009 guard, the uncertain reaper or the 0008 table exist', () => {
    before(RB002, /trg_community_ai_actions_reap_uncertain_guard/, /DROP (CONSTRAINT|INDEX|COLUMN)/);
    before(RB002, /v_src LIKE '%''uncertain''%'/, /DROP (CONSTRAINT|INDEX|COLUMN)/);
    before(RB002, /to_regclass\('public\.engagement_request_idempotency'\) IS NOT NULL/, /DROP (CONSTRAINT|INDEX|COLUMN)/);
  });

  it('0006 refuses while 0007 is installed; 0003 refuses while 0006 is installed', () => {
    before(RB006, /community_action_journey_links_identity_proof_guard\(\)'\) IS NOT NULL/, /DROP TRIGGER/);
    expect(RB006).toMatch(/roll back 20261231000007 first/);
    before(RB003, /community_action_journey_links_identity_guard\(\)'\) IS NOT NULL/, /DROP TABLE/);
    expect(RB003).toMatch(/roll back 20261231000007 and 20261231000006 first/);
  });

  it('0005 still keeps the uncertain reaper by default (so 0002 is kept with it)', () => {
    expect(RB005).toContain("'i-accept-duplicate-send-risk'");
    expect(RB005).toMatch(/keeping the uncertain-outcome lease reaper/);
  });

  it('changed SQL carries no CR or control bytes', () => {
    for (const s of [M032, M009, RB009, RB002, RB003, RB004, RB005, RB006, RB007, RB008]) {
      expect(/[\r\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s)).toBe(false);
    }
  });
});
