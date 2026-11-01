/**
 * PI-037 — WORKFLOW EXECUTION ENGINE, T1.
 *
 * 037 added the three things 036 deliberately left out: a transition graph, the
 * relative-delay readiness rule, and one idempotent advance. The dangerous failure
 * for a scheduler is not a wrong timestamp, it is quietly becoming an executor:
 * fabricating completion, continuing past a failure, dispatching, re-reading the
 * mutable Workflow Version, or growing absolute scheduling. Each has a guard here.
 *
 * ─── READING RULES THESE GUARDS FOLLOW ────────────────────────────────────
 * Source text is matched after stripping comments and SQL string literals: the
 * closeouts proved a word ban otherwise matches the implementation's OWN prose, or
 * a postcondition's own error message, explaining why it does not do the banned
 * thing. Table and function names are anchored to their declaration position, not
 * matched with `[^;]*`, which reaches across a whole statement. Nothing asserts on
 * line endings or brace placement. No guard uses `git status`. Every ban is paired
 * with a positive assertion so it cannot pass by matching nothing.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  STEP_STATES, STEP_TRANSITIONS, SETTLED_STEP_STATES, ADVANCING_STEP_STATES,
  BLOCKING_STEP_STATES, canTransition, advancesChain, isSettledStepState,
} from '../../services/workflowExecution/stepProgressionStore';

const ROOT = process.cwd();
const read = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const sha = (rel: string): string =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 16);

const sqlCode = (s: string): string => s
  .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
  .replace(/'(?:[^']|'')*'/g, "''");
const tsCode = (s: string): string => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

const MIG_REL = 'supabase/migrations/20261228000002_pi_execution_step_scheduling.sql';
const STORE_REL = 'backend/services/workflowExecution/stepProgressionStore.ts';
const ROUTE_REL = 'pages/api/execution-instances/[id]/progression.ts';

const MIG_RAW = read(MIG_REL);
const MIG = sqlCode(MIG_RAW);
const STORE_RAW = read(STORE_REL);
const STORE = tsCode(STORE_RAW);
const ROUTE_RAW = read(ROUTE_REL);
const ROUTE = tsCode(ROUTE_RAW);

/** One function's body, by declaration, for ordering and ban checks. */
const fnBody = (name: string, raw = MIG_RAW): string => {
  const i = raw.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (i === -1) return '';
  const end = raw.indexOf('END $$;', i);
  return raw.slice(i, end === -1 ? undefined : end);
};

// ── The state machine ──────────────────────────────────────────────────────

describe('037 — the step transition graph', () => {
  it('adds no state: the seven are exactly 036’s', () => {
    expect([...STEP_STATES]).toEqual(
      ['pending', 'ready', 'running', 'completed', 'failed', 'skipped', 'cancelled'],
    );
  });

  it('allows exactly the transitions that have execution meaning', () => {
    expect(STEP_TRANSITIONS.pending).toEqual(['ready', 'skipped', 'cancelled']);
    expect(STEP_TRANSITIONS.ready).toEqual(['running', 'completed', 'skipped', 'cancelled']);
    expect(STEP_TRANSITIONS.running).toEqual(['completed', 'failed', 'cancelled']);
  });

  it('every settled state is terminal in the graph', () => {
    for (const s of SETTLED_STEP_STATES) {
      expect(STEP_TRANSITIONS[s]).toEqual([]);
      expect(isSettledStepState(s)).toBe(true);
    }
  });

  it('REFUSES the transitions that have no execution meaning', () => {
    // Each refusal has a reason, not a preference.
    expect(canTransition('pending', 'running')).toBe(false);   // not yet eligible
    expect(canTransition('pending', 'completed')).toBe(false);  // never ran
    expect(canTransition('pending', 'failed')).toBe(false);     // never ran
    expect(canTransition('ready', 'failed')).toBe(false);       // never started
    expect(canTransition('running', 'skipped')).toBe(false);    // already started
    expect(canTransition('running', 'ready')).toBe(false);      // no going back
    for (const s of SETTLED_STEP_STATES) {
      for (const t of STEP_STATES) expect(canTransition(s, t)).toBe(false);
    }
  });

  it('PERMITS ready → completed without a running observation', () => {
    // `running` is an optional report. An executing layer that never announces a
    // start must still be able to announce an outcome, and 036's certified
    // behaviour relies on exactly this path.
    expect(canTransition('ready', 'completed')).toBe(true);
    expect(canTransition('ready', 'running')).toBe(true);
    expect(canTransition('running', 'completed')).toBe(true);
  });

  it('the graph is enforced in the DATABASE, not only in the store', () => {
    const g = fnBody('execution_plan_steps_guard');
    expect(g).toMatch(/has no execution meaning/);
    expect(g).toMatch(/OLD\.state = 'pending' AND NEW\.state IN \('ready', 'skipped', 'cancelled'\)/);
    expect(g).toMatch(/OLD\.state = 'ready'\s+AND NEW\.state IN \('running', 'completed', 'skipped', 'cancelled'\)/);
    expect(g).toMatch(/OLD\.state = 'running' AND NEW\.state IN \('completed', 'failed', 'cancelled'\)/);
  });

  it('the superseding guard KEEPS both 036 guarantees', () => {
    const g = fnBody('execution_plan_steps_guard');
    expect(g).toMatch(/is immutable/);
    expect(g).toMatch(/cannot be re-opened/);
    for (const col of ['step_key', 'step_order', 'channel', 'instruction',
      'delay_after_previous_hours', 'created_at']) {
      expect(g).toMatch(new RegExp(`NEW\\.${col}\\s+IS DISTINCT FROM OLD\\.${col}`));
    }
    expect(MIG_RAW).toMatch(/the step guard lost a 036 guarantee/);
  });
});

// ── Skip never reads as success ────────────────────────────────────────────

describe('037 — skip advances the chain but is never success', () => {
  it('skipped advances, failed and cancelled block', () => {
    expect([...ADVANCING_STEP_STATES]).toEqual(['completed', 'skipped']);
    expect([...BLOCKING_STEP_STATES]).toEqual(['failed', 'cancelled']);
    expect(advancesChain('skipped')).toBe(true);
    expect(advancesChain('completed')).toBe(true);
    expect(advancesChain('failed')).toBe(false);
    expect(advancesChain('cancelled')).toBe(false);
  });

  it('completed_at is tied to the completed state ALONE', () => {
    // This is what stops a skip from being readable as a completion.
    expect(MIG_RAW).toMatch(/execution_plan_steps_completed_coherent/);
    expect(MIG_RAW).toMatch(/\(state = 'completed'\) = \(completed_at IS NOT NULL\)/);
    expect(MIG_RAW).toMatch(/a skip could read as success/);
  });

  it('settled_at covers every settled state, so the anchor is always present', () => {
    expect(MIG_RAW).toMatch(/execution_plan_steps_settled_coherent/);
    expect(MIG_RAW).toMatch(
      /\(state IN \('completed', 'failed', 'skipped', 'cancelled'\)\) = \(settled_at IS NOT NULL\)/,
    );
  });

  it('the anchor function accepts ONLY completed or skipped as a predecessor', () => {
    const f = fnBody('execution_step_anchor');
    expect(f).toMatch(/v_prev\.state NOT IN \('completed', 'skipped'\)/);
    expect(f).toMatch(/RETURN NULL/);
  });
});

// ── Readiness ──────────────────────────────────────────────────────────────

describe('037 — relative-delay readiness', () => {
  it('the first step anchors on the RUN START, not on a predecessor', () => {
    const f = fnBody('execution_step_anchor');
    expect(f).toMatch(/v_step\.step_order = 1/);
    expect(f).toMatch(/RETURN v_plan\.created_at/);
  });

  it('a later step anchors on the previous step’s settle time', () => {
    const f = fnBody('execution_step_anchor');
    expect(f).toMatch(/step_order = v_step\.step_order - 1/);
    expect(f).toMatch(/RETURN v_prev\.settled_at/);
  });

  it('eligibility is anchor + the authored delay, in hours', () => {
    const f = fnBody('advance_execution_plan');
    expect(f).toMatch(/now\(\) < v_anchor/);
    expect(f).toMatch(/v_step\.delay_after_previous_hours \* interval '1 hour'/);
  });

  it('THE DELAY COMES FROM THE PLAN SNAPSHOT, NEVER THE WORKFLOW VERSION', () => {
    // Re-reading the mutable version could retime a run already under way.
    const f = sqlCode(fnBody('advance_execution_plan'));
    expect(f).not.toMatch(/workflow_versions/);
    expect(f).toMatch(/execution_plan_steps/);
    expect(MIG_RAW).toMatch(/could retime a live run/);
  });

  it('NO ABSOLUTE, CALENDAR, BUSINESS-DAY OR CRON SCHEDULING', () => {
    const f = sqlCode(fnBody('advance_execution_plan'));
    for (const banned of ['AT TIME ZONE', 'timezone', 'business', 'cron', 'date_trunc',
      'EXTRACT(DOW', 'pg_cron', 'pg_notify']) {
      expect(f).not.toContain(banned);
    }
    // Positive counterpart, read from RAW source: `sqlCode` blanks string
    // literals, and `'1 hour'` is exactly such a literal.
    expect(fnBody('advance_execution_plan')).toMatch(/interval '1 hour'/);
    expect(MIG_RAW).toMatch(/absolute, calendar or cron scheduling leaked/);
  });

  it('readiness is RECOMPUTED from facts, not stored as a derived column', () => {
    // `ready_at` records WHEN a step was made ready; it is never the input to that
    // decision, so no derived value can drift from the steps it came from.
    const f = fnBody('advance_execution_plan');
    expect(f).toMatch(/execution_step_anchor\(/);
    expect(f).not.toMatch(/WHERE[\s\S]{0,120}ready_at <= now\(\)/);
    const cols = MIG_RAW.match(/ADD COLUMN IF NOT EXISTS[\s\S]*?completed_at timestamptz/);
    expect(cols).not.toBeNull();
  });
});

// ── Progression, and what it must not do ───────────────────────────────────

describe('037 — progression only moves state', () => {
  it('ADVANCEMENT CREATES NOTHING', () => {
    // 036 materialized every step and task up front, which is also why running an
    // advance twice cannot duplicate anything.
    const f = sqlCode(fnBody('advance_execution_plan'));
    expect(f).not.toMatch(/INSERT INTO/);
    expect(MIG_RAW).toMatch(/advancement inserts rows/);
    expect(STORE).not.toMatch(/\.insert\(/);
  });

  it('AT MOST ONE STEP BECOMES READY PER PASS', () => {
    // A linear chain has one frontier: the next step's anchor cannot exist until
    // this one settles.
    const f = fnBody('advance_execution_plan');
    expect(f).toMatch(/v_made := v_made \+ 1;\s*\n[\s\S]{0,200}?EXIT;/);
    expect(STORE_RAW).toMatch(/at most one/i);
  });

  it('A FAILED OR CANCELLED PREDECESSOR STOPS THE CHAIN', () => {
    const f = fnBody('execution_step_anchor');
    expect(f).toMatch(/NOT IN \('completed', 'skipped'\)/);
    const adv = fnBody('advance_execution_plan');
    expect(adv).toMatch(/EXIT WHEN v_anchor IS NULL/);
    expect(MIG_RAW).toMatch(/Nothing in this migration continues past a failure/);
  });

  it('a paused or terminal run advances nothing, and says so quietly', () => {
    const f = fnBody('advance_execution_plan');
    expect(f).toMatch(/lifecycle_state NOT IN \('created', 'queued', 'active'\)/);
    expect(f).toMatch(/RETURN 0/);
    expect(STORE_RAW).toMatch(/an advance is a poll/i);
  });

  it('the run lifecycle moves only where step state implies it', () => {
    const f = fnBody('advance_execution_plan');
    expect(f).toMatch(/SET lifecycle_state = 'active'/);
    expect(f).toMatch(/lifecycle_state IN \('created', 'queued'\)/);
    expect(f).toMatch(/WHEN v_blocked > 0 THEN 'failed' ELSE 'completed'/);
    // It never reopens a terminal run.
    expect(f).toMatch(/ei\.lifecycle_state IN \('created', 'queued', 'active'\)/);
  });

  it('the instance state vocabulary was NOT expanded', () => {
    const inst = read('backend/services/executionInstances/executionInstanceStore.ts');
    expect(inst).toMatch(/LIFECYCLE_STATES/);
    // Banned as STATE LITERALS, not as bare substrings: the function has a local
    // `v_blocked` counter, which an unanchored ban on "blocked" flagged.
    const raw = fnBody('advance_execution_plan');
    for (const invented of ['scheduled', 'waiting', 'blocked', 'retrying', 'stalled']) {
      expect(raw).not.toContain(`'${invented}'`);
    }
    // Positive counterpart: the states it DOES write are 033's own.
    for (const real of ['active', 'failed', 'completed']) {
      expect(raw).toContain(`'${real}'`);
    }
  });
});

// ── Concurrency and idempotency ────────────────────────────────────────────

describe('037 — concurrency rests on the database', () => {
  it('the run row is LOCKED for the duration of an advance', () => {
    expect(fnBody('advance_execution_plan')).toMatch(
      /FROM public\.execution_instances[\s\S]{0,200}?FOR UPDATE/,
    );
    expect(MIG_RAW).toMatch(/advancement does not lock the run/);
  });

  it('THE READINESS WRITE IS CONDITIONAL, NOT A READ-THEN-WRITE', () => {
    const f = fnBody('advance_execution_plan');
    expect(f).toMatch(/UPDATE public\.execution_plan_steps AS s[\s\S]{0,260}?AND s\.state = 'pending'/);
    expect(f).toMatch(/IF NOT FOUND THEN/);
    expect(MIG_RAW).toMatch(/the readiness update is not conditional on the pending state/);
  });

  it('a caller-asserted transition is also conditional on the state it decided from', () => {
    const t = STORE.slice(STORE.indexOf('export async function transitionPlanStep'));
    expect(t).toMatch(/\.eq\('state', current\.state\)/);
  });

  it('the timestamps are WRITE-ONCE and set by the transition, not the caller', () => {
    // A caller-supplied settle time could forge an anchor and retime every later step.
    const g = fnBody('execution_plan_steps_guard');
    expect(g).toMatch(/are write-once/);
    for (const col of ['ready_at', 'started_at', 'settled_at', 'completed_at']) {
      expect(g).toMatch(new RegExp(`OLD\\.${col}\\s+IS NOT NULL AND NEW\\.${col}`));
      // `\s*` before `:=`: the source aligns the assignments in columns, so a
      // single-space pattern matched none of them.
      expect(g).toMatch(new RegExp(`NEW\\.${col}\\s*:= now\\(\\)`));
    }
    // And the store never sends one.
    const t = STORE.slice(STORE.indexOf('export async function transitionPlanStep'));
    expect(t).not.toMatch(/settled_at|completed_at|ready_at|started_at/);
  });

  it('transitioning to the state a step already holds is an idempotent no-op', () => {
    expect(STORE).toMatch(/current\.state === input\.state\)\s*return current;/);
  });
});

// ── The Outreach boundary ──────────────────────────────────────────────────

describe('037 — nothing is dispatched and nothing is fabricated', () => {
  it('COMPLETION IS ALWAYS CALLER-ASSERTED, NEVER INFERRED', () => {
    // 036 prepares every task up front, so inferring completion from
    // materialization would fabricate success for work that never ran.
    const adv = sqlCode(fnBody('advance_execution_plan'));
    expect(adv).not.toMatch(/SET state = ''completed''/);
    expect(adv).not.toMatch(/execution_tasks/);
    expect(STORE_RAW).toMatch(/never infers/i);
    // Positive counterpart: an explicit transition exists for a caller to use.
    expect(STORE).toMatch(/export async function transitionPlanStep/);
  });

  it('NO PROVIDER, TRANSPORT, DISPATCH OR DELIVERY ANYWHERE', () => {
    for (const surface of [MIG, STORE, ROUTE]) {
      for (const banned of ['sendEmail', 'whatsapp', 'twilio', 'sendgrid', 'transportRegistry',
        'providerAccount', 'outreach_attempts', 'outreach_outcomes', 'outreach_tasks',
        'warmup', 'delivery']) {
        expect(surface).not.toContain(banned);
      }
      expect(surface).not.toMatch(/\b(dispatch|enqueue|schedule|setTimeout|sendMessage)\s*\(/i);
    }
  });

  it('a task is never marked sent, delivered or failed-at-provider', () => {
    const forbidden = /SET state = ''(sent|delivered|dispatched|bounced)''/;
    expect(MIG).not.toMatch(forbidden);
    // The only task state 037 writes is `cancelled`, for coherence.
    expect(MIG_RAW).toMatch(/UPDATE public\.execution_tasks AS t\s*\n\s*SET state = 'cancelled'/);
    expect(STORE).not.toMatch(/execution_tasks/);
  });

  it('NO SCHEDULER SERVICE OR BACKGROUND WORKER WAS ADDED', () => {
    const offenders: string[] = [];
    for (const root of ['backend/jobs', 'backend/workers', 'backend/queue', 'scripts']) {
      const walk = (dir: string): void => {
        let entries: string[] = [];
        try { entries = fs.readdirSync(dir); } catch { return; }
        for (const e of entries) {
          const p = path.join(dir, e);
          let st: fs.Stats;
          try { st = fs.statSync(p); } catch { continue; }
          if (st.isDirectory()) { if (e !== 'node_modules') walk(p); continue; }
          if (!e.endsWith('.ts')) continue;
          const body = tsCode(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'));
          if (/advanceExecutionRun|advance_execution_plan|execution_plan_steps/.test(body)) {
            offenders.push(path.relative(ROOT, p).split(path.sep).join('/'));
          }
        }
      };
      walk(path.join(ROOT, root));
    }
    expect(offenders).toEqual([]);
    expect(fs.existsSync(path.join(ROOT, 'backend/jobs'))).toBe(true);
    expect(STORE_RAW).toMatch(/is a poll, not a daemon/);
  });

  it('mayContact and the governance chain are neither called nor altered', () => {
    for (const surface of [MIG, STORE, ROUTE]) {
      expect(surface).not.toMatch(/mayContact\s*\(/);
      expect(surface).not.toMatch(/kill_switch|suppression|rate_limit/);
    }
    // Positive counterpart: the route DOCUMENTS that readiness is not permission,
    // which is why the bans above read comment-stripped source.
    expect(ROUTE_RAW).toMatch(/mayContact/);
    expect(ROUTE_RAW).toMatch(/not permission/i);
  });

  it('NO BRANCHING, CONDITION OR EVENT WAIT', () => {
    const f = sqlCode(fnBody('advance_execution_plan'));
    for (const banned of ['condition', 'branch', 'depends_on', 'wait_for', 'LISTEN']) {
      expect(f).not.toContain(banned);
    }
    // Positive counterpart: progression is strictly by order.
    expect(f).toMatch(/ORDER BY step_order ASC/);
  });
});

// ── Authorization and surface ──────────────────────────────────────────────

describe('037 — authorization is the interim capability, unchanged', () => {
  it('the route requires PROSPECT_ICP_MANAGE', () => {
    expect(ROUTE).toMatch(/PROSPECT_ICP_MANAGE/);
    expect(ROUTE).toMatch(/requireCapability\(/);
  });

  it('NO NEW CAPABILITY WAS INTRODUCED', () => {
    for (const banned of ['WORKFLOW_MANAGE', 'AUTOMATION_EXECUTE', 'CAMPAIGN_EXECUTE',
      'EXECUTION_MANAGE', 'WORKFLOW_EXECUTE']) {
      expect(ROUTE).not.toContain(banned);
    }
    const reg = read('shared/contracts/security/SecurityCapabilities.ts');
    expect(reg).not.toMatch(/\bWORKFLOW_MANAGE\b/);
    expect(reg).not.toMatch(/\bWORKFLOW_EXECUTE\b/);
    expect(reg).not.toMatch(/\bEXECUTION_MANAGE\b/);
    expect(reg).toMatch(/PROSPECT_ICP_MANAGE/);
  });

  it('authorization precedes the bind, and the bind precedes every mutation', () => {
    const iAuth = ROUTE.indexOf('requireCapability(');
    const iBind = ROUTE.indexOf('getExecutionInstance(');
    expect(iAuth).toBeGreaterThan(-1);
    expect(iBind).toBeGreaterThan(iAuth);
    for (const call of ['advanceExecutionRun(', 'cancelExecutionRun(', 'transitionPlanStep(']) {
      expect(ROUTE.indexOf(call)).toBeGreaterThan(iBind);
    }
  });

  it('the tenant comes from the verified session and the run from the path', () => {
    expect(ROUTE).toMatch(/organizationId:\s*companyId/);
    expect(ROUTE).toMatch(/executionInstanceId:\s*instanceId/);
  });

  it('both functions are service_role only', () => {
    for (const fn of ['advance_execution_plan', 'cancel_execution_run', 'execution_step_anchor']) {
      expect(MIG).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(uuid, uuid\\) FROM PUBLIC`));
      expect(MIG).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(uuid, uuid\\) TO service_role`));
    }
  });

  it('there is no DELETE anywhere', () => {
    expect(ROUTE).toMatch(/METHODS\s*=\s*\['GET',\s*'POST',\s*'PATCH'\]/);
    expect(ROUTE).not.toMatch(/'DELETE'/);
    expect(STORE).not.toMatch(/\.delete\(\)/);
    expect(MIG).not.toMatch(/DELETE FROM/);
  });

  it('every store read and write is tenant-scoped', () => {
    expect((STORE.match(/\.eq\('organization_id', /g) || []).length).toBeGreaterThanOrEqual(4);
    expect(STORE).toMatch(/function assertTenant/);
  });
});

// ── Isolation ──────────────────────────────────────────────────────────────

describe('037 — frozen artefacts are untouched', () => {
  // RE-PINNED 2026-10-28 to the orchestration port (see piExecutionPlan036's note).
  it('036 is byte-identical', () => {
    expect(sha('supabase/migrations/20261228000001_pi_execution_plans.sql'))
      .toBe('04de68f4eb360825');
    expect(sha('backend/services/executionPlans/executionPlanStore.ts'))
      .toBe('97b68e9c17758e81');
    expect(sha('pages/api/execution-instances/[id]/plan.ts')).toBe('d133ffc3c1cadc5e');
    // RE-PINNED 2026-10-28: 036 re-pinned the instance store (targets_not_installed mapping).
    expect(sha('backend/tests/unit/piExecutionPlan036.test.ts')).toBe('dd01c0b19f1b56fd'); // RE-PINNED 2026-10-28 (migration re-run safety): 036 re-pinned 032's migration (re-run no longer narrows the publish vocabulary)
  });

  it('033, 034 and 032 are byte-identical', () => {
    expect(sha('supabase/migrations/20261228000000_pi_execution_instances.sql'))
      .toBe('497119eb80564588'); // RE-PINNED 2026-10-28 (real-PostgreSQL verification): postcondition accepts the 20261231 target FK (re-run safe)
    expect(sha('backend/services/executionInstances/executionInstanceStore.ts'))
      .toBe('1319b7d86960f9c3'); // RE-PINNED 2026-10-28: ei_create:targets_not_installed now maps to its own code
    expect(sha('pages/api/execution-instances/[id].ts')).toBe('871dd7074f95e064');
    expect(sha('pages/api/prospect-campaigns/[id]/execution-instances.ts'))
      .toBe('6c303af15da7a4bf');
    expect(sha('supabase/migrations/20261227000000_pi_workflow_definitions.sql'))
      .toBe('71691e4328a27592'); // RE-PINNED 2026-10-28 (migration re-run safety): re-running 032 after 20261231000004 no longer narrows the publish vocabulary (function body unchanged)
    expect(sha('backend/services/workflows/workflowStore.ts')).toBe('79d1df2478d2fe7f'); // RE-PINNED 2026-10-28 (social_post): additive social_post channel + optional step reference (20261231000004)
  });

  it('the legacy outreach substrate is byte-identical', () => {
    expect(sha('backend/services/leadOutreachExecution/materialization.ts'))
      .toBe('46d4461b56be2908');
    expect(sha('backend/services/automationExecution/taskGenerator.ts'))
      .toBe('fbc7348d52c11f04');
  });

  it('037 ADDED EXACTLY ONE MIGRATION, AND NO TABLE', () => {
    const dir = path.join(ROOT, 'supabase/migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => /_pi_execution_step_scheduling\.sql$/.test(f)))
      .toEqual(['20261228000002_pi_execution_step_scheduling.sql']);
    // It alters, never creates.
    expect(MIG).not.toMatch(/CREATE\s+TABLE/i);
    expect(MIG).toMatch(/ALTER TABLE public\.execution_plan_steps/);
    // Anchored to the table-name position: a `[^;]*` form would match this
    // migration's own references.
    const BANNED = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(execution_steps?|execution_contexts?|workflow_runs?|workflow_instances?|workflow_steps?|message_versions?|message_templates?|schedules?|step_schedules?)\b/i;
    expect(files.filter((f) =>
      BANNED.test(fs.readFileSync(path.join(dir, f), 'utf8')))).toEqual([]);
    expect(BANNED.test('CREATE TABLE public.step_schedules (')).toBe(true);
  });

  it('ONLY ONE ROUTE ADVANCES A RUN', () => {
    const creators: string[] = [];
    const walk = (dir: string): void => {
      let entries: string[] = [];
      try { entries = fs.readdirSync(dir); } catch { return; }
      for (const e of entries) {
        const p = path.join(dir, e);
        let st: fs.Stats;
        try { st = fs.statSync(p); } catch { continue; }
        if (st.isDirectory()) { walk(p); continue; }
        if (!e.endsWith('.ts')) continue;
        const body = tsCode(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'));
        if (/advanceExecutionRun\s*\(|advance_execution_plan/.test(body)) {
          creators.push(path.relative(ROOT, p).split(path.sep).join('/'));
        }
      }
    };
    walk(path.join(ROOT, 'pages'));
    expect(creators).toEqual([ROUTE_REL]);
  });

  it('the route never reaches the tables directly', () => {
    expect(ROUTE).not.toMatch(/ownedDbTable|\.rpc\(/);
    expect(ROUTE).not.toMatch(/execution_plan_steps|execution_tasks|execution_plans/);
  });
});
