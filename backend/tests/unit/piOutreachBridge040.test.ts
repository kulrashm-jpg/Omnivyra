/**
 * PI-040 — OUTREACH BRIDGE, T1.
 *
 * 040 did two things: it put the ratified autonomy/approval policy inside the
 * Workflow Version step (D4-1 Option A), and it built the translation/handoff
 * into the existing certified Outreach engine (D4-2). The dangerous failures for
 * a bridge are all shapes of pretending: pretending a channel executed,
 * pretending a person resolved, pretending a retry was a new send, pretending to
 * be a second governance or approval authority. Each has a guard here.
 *
 * ─── READING RULES THESE GUARDS FOLLOW ────────────────────────────────────
 * Source text is matched after stripping comments and SQL string literals, since
 * the closeouts proved a word ban otherwise matches the implementation's own
 * prose or a postcondition's own error message. Table and function names are
 * anchored to their declaration position, never matched with `[^;]*`, which
 * reaches across a whole statement. A positive assertion about a string LITERAL
 * reads RAW source, because the stripper blanks literals. Nothing asserts on line
 * endings or brace placement. No guard uses `git status`. Every ban is paired
 * with a positive assertion so it cannot pass by matching nothing.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  WORKFLOW_EXECUTION_MODES, workflowStepRequiresApproval, resolveStepPolicy,
  validateWorkflowDefinition, WorkflowError,
} from '../../services/workflows/workflowStore';

const ROOT = process.cwd();
const read = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const sha = (rel: string): string =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 16);

/**
 * Strip `--` comments, then blank single-quoted SQL literals.
 *
 * The literal blanking is a SCANNER, not a regex. A regex like
 * `/'(?:[^']|'')*'/g` cannot tell an opening quote from a closing one, so on a
 * line with two literals it blanks the CODE BETWEEN THEM and leaves the literals
 * standing — the precise opposite of the intent. That defect made a ban here pass
 * its own postcondition's error message, which is how it was found.
 */
const sqlCode = (s: string): string => {
  const noComments = s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  let out = '';
  let inLit = false;
  for (let i = 0; i < noComments.length; i += 1) {
    const ch = noComments[i];
    if (!inLit) {
      if (ch === "'") { inLit = true; out += "''"; } else { out += ch; }
      continue;
    }
    // Inside a literal: `''` is an escaped quote, a lone `'` closes it.
    if (ch === "'") {
      if (noComments[i + 1] === "'") { i += 1; continue; }
      inLit = false;
    }
  }
  return out;
};
const tsCode = (s: string): string => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

const MIG_REL = 'supabase/migrations/20261229000000_pi_outreach_bridge.sql';
const STORE_REL = 'backend/services/outreachBridge/outreachBridgeStore.ts';
const ROUTE_REL = 'pages/api/execution-instances/[id]/outreach-bridge.ts';
const WF_REL = 'backend/services/workflows/workflowStore.ts';

const MIG_RAW = read(MIG_REL);
const MIG = sqlCode(MIG_RAW);
const STORE_RAW = read(STORE_REL);
const STORE = tsCode(STORE_RAW);
const ROUTE_RAW = read(ROUTE_REL);
const ROUTE = tsCode(ROUTE_RAW);
const WF_RAW = read(WF_REL);

const table = (name: string): string =>
  (MIG.match(new RegExp(`CREATE\\s+TABLE[^;]*\\b${name}\\b[^;]*;`, 'i')) || [''])[0];
const fnBody = (name: string): string => {
  const i = MIG_RAW.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (i === -1) return '';
  const end = MIG_RAW.indexOf('END $$;', i);
  return MIG_RAW.slice(i, end === -1 ? undefined : end);
};
const HANDOFFS = table('outreach_bridge_handoffs');

const stepOf = (over: Record<string, unknown> = {}) => ({
  key: 'intro', channel: 'email', delay_after_previous_hours: 0,
  execution_mode: 'assisted', ...over,
});

// ── D4-1: the policy contract ──────────────────────────────────────────────

describe('040 — the Workflow step policy contract', () => {
  it('the ratified modes are exactly three', () => {
    expect([...WORKFLOW_EXECUTION_MODES]).toEqual(['human', 'assisted', 'autonomous']);
  });

  it('execution_mode is REQUIRED on a newly authored step', () => {
    // A step must STATE the autonomy it was authorized with. Acquiring one by
    // omission is forbidden in both directions.
    const bare = { key: 'a', channel: 'email', delay_after_previous_hours: 0 };
    expect(() => validateWorkflowDefinition({ steps: [bare] })).toThrow(WorkflowError);
    try {
      validateWorkflowDefinition({ steps: [bare] });
    } catch (e) {
      expect((e as WorkflowError).code).toBe('missing_step_execution_mode');
    }
  });

  it('an unknown mode is refused rather than coerced', () => {
    try {
      validateWorkflowDefinition({ steps: [stepOf({ execution_mode: 'semi' })] });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as WorkflowError).code).toBe('invalid_step_execution_mode');
    }
  });

  it('each ratified mode survives validation', () => {
    for (const mode of WORKFLOW_EXECUTION_MODES) {
      const d = validateWorkflowDefinition({ steps: [stepOf({ execution_mode: mode })] });
      expect(d.steps[0].execution_mode).toBe(mode);
    }
  });

  it('requires_approval is additive, boolean-only, and only kept when true', () => {
    const on = validateWorkflowDefinition({ steps: [stepOf({ requires_approval: true })] });
    expect(on.steps[0].requires_approval).toBe(true);
    // Absent-or-false both mean "adds nothing", so false is not stored.
    const off = validateWorkflowDefinition({ steps: [stepOf({ requires_approval: false })] });
    expect(off.steps[0].requires_approval).toBeUndefined();
    try {
      validateWorkflowDefinition({ steps: [stepOf({ requires_approval: 'yes' })] });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as WorkflowError).code).toBe('invalid_step_requires_approval');
    }
  });

  it('HUMAN ALWAYS REQUIRES APPROVAL, and a lower field cannot downgrade it', () => {
    expect(workflowStepRequiresApproval({ execution_mode: 'human' })).toBe(true);
    expect(workflowStepRequiresApproval({
      execution_mode: 'human', requires_approval: false,
    })).toBe(true);
    expect(workflowStepRequiresApproval({ execution_mode: 'assisted' })).toBe(false);
    expect(workflowStepRequiresApproval({
      execution_mode: 'assisted', requires_approval: true,
    })).toBe(true);
    expect(workflowStepRequiresApproval({ execution_mode: 'autonomous' })).toBe(false);
    expect(workflowStepRequiresApproval({
      execution_mode: 'autonomous', requires_approval: true,
    })).toBe(true);
  });

  it('A PRE-POLICY VERSION FAILS CLOSED TO HUMAN + APPROVAL REQUIRED', () => {
    for (const legacy of [
      { key: 'a', channel: 'email', delay_after_previous_hours: 0 },
      {}, null, undefined, 'nonsense',
      { key: 'a', execution_mode: 'semi' },
    ]) {
      const p = resolveStepPolicy(legacy);
      expect(p.mode).toBe('human');
      expect(p.requiresApproval).toBe(true);
      expect(p.source).toBe('legacy_default');
    }
  });

  it('an AUTHORED policy is reported as authored, never as the default', () => {
    const a = resolveStepPolicy(stepOf({ execution_mode: 'autonomous' }));
    expect(a).toEqual({ mode: 'autonomous', requiresApproval: false, source: 'authored' });
    const b = resolveStepPolicy(stepOf({ execution_mode: 'autonomous', requires_approval: true }));
    expect(b).toEqual({ mode: 'autonomous', requiresApproval: true, source: 'authored' });
    const c = resolveStepPolicy(stepOf({ execution_mode: 'human' }));
    expect(c).toEqual({ mode: 'human', requiresApproval: true, source: 'authored' });
  });

  it('the policy lives in the DEFINITION, with no sibling policy table', () => {
    // 040-D chose Option A precisely so the Plan snapshot pins it for free.
    expect(WF_RAW).toMatch(/execution_mode/);
    const dir = path.join(ROOT, 'supabase/migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    const BANNED = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(workflow_step_policies|workflow_policies|workflow_execution_policies|step_policies)\b/i;
    expect(files.filter((f) =>
      BANNED.test(fs.readFileSync(path.join(dir, f), 'utf8')))).toEqual([]);
    expect(BANNED.test('CREATE TABLE public.workflow_step_policies (')).toBe(true);
  });

  it('the policy is read from the PLAN SNAPSHOT, never from workflow_versions', () => {
    const fn = STORE.slice(STORE.indexOf('export async function resolveTaskPolicy'));
    const body = fn.slice(0, fn.indexOf('export async function bridgeExecutionTask'));
    expect(body).toMatch(/definition_snapshot/);
    expect(body).not.toMatch(/workflow_versions/);
    expect(body).toMatch(/resolveStepPolicy\(/);
  });

  it('no caller may override the policy at execution time', () => {
    for (const surface of [STORE, ROUTE]) {
      expect(surface).not.toMatch(/body\.execution_mode|body\.executionMode/);
      expect(surface).not.toMatch(/body\.requires_approval|body\.requiresApproval/);
    }
    // Positive counterpart: the only input the route takes is the task id.
    expect(ROUTE).toMatch(/str\(body\.executionTaskId\)/);
  });
});

// ── D4-2: identity ─────────────────────────────────────────────────────────

describe('040 — bridge identity', () => {
  it('the bridge is keyed by execution_task_id and that is UNIQUE', () => {
    expect(HANDOFFS).toMatch(/execution_task_id\s+uuid\s+NOT NULL/i);
    expect(HANDOFFS).toMatch(/UNIQUE\s*\(\s*organization_id,\s*execution_task_id\s*\)/i);
    expect(MIG_RAW).toMatch(/bridge idempotency is unenforced/);
  });

  it('one legacy task can be claimed by exactly one handoff', () => {
    expect(HANDOFFS).toMatch(/UNIQUE\s*\(\s*organization_id,\s*outreach_task_id\s*\)/i);
    expect(MIG_RAW).toMatch(/could be claimed twice/);
  });

  it('the full execution chain is preserved', () => {
    for (const col of ['campaign_id', 'workflow_id', 'workflow_version_id',
      'execution_instance_id', 'execution_plan_id', 'execution_plan_step_id',
      'execution_task_id', 'subject_kind', 'subject_id', 'person_id']) {
      expect(HANDOFFS).toContain(col);
    }
  });

  it('SUBJECT KIND IS AUTHORITATIVE IN THE BRIDGE, never inferred from lead_id', () => {
    expect(HANDOFFS).toMatch(/subject_kind\s+text\s+NOT NULL/i);
    expect(MIG_RAW).toMatch(/subject_kind IN \('lead', 'prospect'\)/);
    // The legacy row's lead_id is the SUBJECT id, and the migration says so.
    expect(MIG_RAW).toMatch(/NEVER encoded here/);
    expect(MIG_RAW).toMatch(/cannot distinguish lead from prospect/);
  });

  it('person_id is MANDATORY on a handoff', () => {
    expect(HANDOFFS).toMatch(/person_id\s+uuid\s+NOT NULL/i);
    expect(MIG_RAW).toMatch(/person_id is not mandatory on a handoff/);
  });

  it('plan_task_id for a bridged row is the execution_task_id, not a slug', () => {
    const fn = fnBody('bridge_execution_task');
    expect(fn).toMatch(/p_execution_task_id::text/);
    expect(sqlCode(fn)).not.toMatch(/slug/i);
    expect(MIG).not.toMatch(/task-\$\{/);
  });

  it('subject_id goes to lead_id, and nothing encodes the kind there', () => {
    const fn = fnBody('bridge_execution_task');
    expect(fn).toMatch(/v_task\.subject_id,/);
    // No concatenation that would smuggle the kind into the legacy column.
    expect(fn).not.toMatch(/subject_kind\s*\|\|/);
    expect(fn).not.toMatch(/\|\|\s*v_task\.subject_kind/);
  });

  it('THE BRIDGE IDENTITY IS NOT plan_task_id', () => {
    const fn = STORE.slice(STORE.indexOf('export async function bridgeExecutionTask'));
    expect(fn).not.toMatch(/plan_task_id/);
    expect(STORE).toMatch(/\.eq\('execution_task_id', executionTaskId\)/);
  });

  it('the guard proves the recorded chain is the task’s own', () => {
    const g = fnBody('outreach_bridge_handoffs_guard');
    expect(g).toMatch(/attribution must be the task/);
    for (const col of ['execution_instance_id', 'execution_plan_step_id', 'execution_plan_id',
      'workflow_version_id', 'campaign_id', 'workflow_id', 'subject_kind', 'subject_id']) {
      expect(g).toMatch(new RegExp(`NEW\\.${col}\\s+IS DISTINCT FROM v_task\\.`));
    }
  });

  it('a handoff is immutable history', () => {
    const g = fnBody('outreach_bridge_handoffs_guard');
    expect(g).toMatch(/TG_OP = 'UPDATE'/);
    expect(g).toMatch(/immutable historical record/);
  });
});

// ── Identity-only mapping ──────────────────────────────────────────────────

describe('040 — the mapping does not duplicate the Outreach lifecycle', () => {
  it('NO SECOND LIFECYCLE COLUMN EXISTS', () => {
    for (const col of ['state', 'status', 'lifecycle_state', 'delivery_status',
      'sent_at', 'delivered_at', 'provider', 'transport', 'attempt_number',
      'message_id', 'message_version_id']) {
      expect(HANDOFFS).not.toMatch(new RegExp(`\\n\\s+${col}\\s`, 'i'));
    }
    expect(MIG_RAW).toMatch(/lifecycle\/dispatch column\(s\) leaked into the bridge/);
  });

  it('the mapping records the policy as it stood at handoff', () => {
    for (const col of ['execution_mode', 'workflow_requires_approval', 'policy_source']) {
      expect(HANDOFFS).toContain(col);
    }
    // And an incoherent pair is refused: human without approval is unrepresentable.
    expect(MIG_RAW).toMatch(/execution_mode <> 'human' OR workflow_requires_approval/);
  });
});

// ── Atomicity, idempotency, concurrency ────────────────────────────────────

describe('040 — one atomic handoff', () => {
  it('ONE FUNCTION WRITES BOTH ROWS', () => {
    const fn = fnBody('bridge_execution_task');
    const iLegacy = fn.indexOf('INSERT INTO public.outreach_tasks');
    const iMap = fn.indexOf('INSERT INTO public.outreach_bridge_handoffs');
    expect(iLegacy).toBeGreaterThan(-1);
    expect(iMap).toBeGreaterThan(iLegacy);
    expect(MIG_RAW).toMatch(/the bridge does not create a legacy task/);
    expect(MIG_RAW).toMatch(/the bridge does not record a mapping/);
  });

  it('the execution task is LOCKED for the duration', () => {
    expect(fnBody('bridge_execution_task')).toMatch(/FOR UPDATE OF t/);
    expect(MIG_RAW).toMatch(/the bridge does not lock the execution task/);
  });

  it('a replay returns the FIRST handoff and creates nothing', () => {
    const fn = STORE.slice(STORE.indexOf('export async function bridgeExecutionTask'));
    expect(fn).toMatch(/replayed: true/);
    expect(fn).toMatch(/getHandoffForTask\(/);
  });

  it('THE DATABASE IS THE ARBITER, not the replay check', () => {
    // The pre-check is an optimisation; losing a race there must resolve into a
    // replay rather than a duplicate.
    const fn = STORE.slice(STORE.indexOf('export async function bridgeExecutionTask'));
    expect(fn).toMatch(/outreach_bridge_handoffs_task_unique/);
    expect(fn).toMatch(/23505/);
    expect(STORE_RAW).toMatch(/NOT the uniqueness guarantee/);
  });

  it('the store never invents the identity it keys on', () => {
    expect(STORE).not.toMatch(/randomUUID|uuidv4|Date\.now\(\)/);
    expect(STORE).toMatch(/executionTaskId/);
  });
});

// ── Governance, approval, autonomy ─────────────────────────────────────────

describe('040 — the bridge grants nothing and duplicates nothing', () => {
  it('mayContact IS NEVER CALLED OR RE-DERIVED', () => {
    for (const surface of [MIG, STORE, ROUTE]) {
      expect(surface).not.toMatch(/mayContact\s*\(/);
    }
    // Positive counterpart: the route DOCUMENTS that it stays authoritative,
    // which is why the ban reads comment-stripped source.
    expect(ROUTE_RAW).toMatch(/mayContact/);
  });

  it('NO GATE IS EVALUATED OR DUPLICATED IN THE BRIDGE', () => {
    for (const surface of [MIG, STORE, ROUTE]) {
      expect(surface).not.toMatch(/evaluateGovernance|evaluateKillSwitch|evaluateSuppression|evaluateRateLimit/);
      expect(surface).not.toMatch(/kill_switch|suppression|rate_limit/);
    }
    expect(MIG_RAW).toMatch(/remain authoritative/);
  });

  it('NO SECOND APPROVAL AUTHORITY', () => {
    for (const surface of [MIG, STORE, ROUTE]) {
      expect(surface).not.toMatch(/outreach_approvals|execution_approvals|requires_human_approval/);
    }
    // Positive counterpart: the composed requirement is handed to the EXISTING
    // authority through the legacy task's own columns.
    expect(fnBody('bridge_execution_task')).toMatch(/requires_approval/);
    expect(fnBody('bridge_execution_task')).toMatch(/'awaiting_approval'/);
  });

  it('the composed requirement is a UNION and never a downgrade', () => {
    const fn = fnBody('bridge_execution_task');
    expect(fn).toMatch(/p_workflow_requires_approval OR v_task\.task_requires_approval/);
    // And `human` can never arrive without approval.
    expect(fn).toMatch(/p_execution_mode = 'human' AND NOT p_workflow_requires_approval/);
  });

  it('AUTONOMOUS DOES NOT GRANT CONTACT PERMISSION', () => {
    // Stated where a reader will meet it, and provable by absence: no gate, no
    // mayContact, no provider anywhere on the surface.
    expect(ROUTE_RAW).toMatch(/never that this\s*\n?\s*\*\s*person may be contacted|never that this person may be contacted/);
    expect(STORE_RAW).toMatch(/does not mean this person may be contacted/);
  });
});

// ── The channel and provider boundary ──────────────────────────────────────

describe('040 — no channel engine and no provider', () => {
  it('AN UNSUPPORTED CHANNEL FAILS CLEARLY AND IS NEVER DOWNGRADED', () => {
    const fn = STORE.slice(STORE.indexOf('export async function bridgeExecutionTask'));
    expect(fn).toMatch(/resolveTransport\(task\.channel\) === null/);
    expect(fn).toMatch(/channel_unsupported/);
    // No fallback: nothing reassigns the channel.
    expect(fn).not.toMatch(/channel\s*=\s*'email'|channel\s*=\s*'internal'/);
    expect(STORE_RAW).toMatch(/never downgraded/);
  });

  it('NO PROVIDER, TRANSPORT CALL, DISPATCH OR SEND', () => {
    for (const surface of [MIG, STORE, ROUTE]) {
      for (const banned of ['sendEmail', 'whatsapp', 'twilio', 'sendgrid',
        'dispatchInternalOutreachTask', 'registerTransport', 'providerAccount', 'warmup']) {
        expect(surface).not.toContain(banned);
      }
      expect(surface).not.toMatch(/\b(dispatch|enqueue|schedule|sendMessage)\s*\(/i);
    }
    // Positive counterpart: the transport registry is CONSULTED, not invoked.
    expect(STORE).toMatch(/resolveTransport|supportedChannels/);
  });

  it('NO ATTEMPT, EVIDENCE OR OUTCOME IS WRITTEN', () => {
    // Banned as a WRITE, not as a mention: the migration's own postcondition
    // legitimately names these tables inside the check that forbids writing them.
    expect(sqlCode(fnBody('bridge_execution_task')))
      .not.toMatch(/INSERT INTO public\.outreach_(attempts|outcomes|decisions|delivery_evidence)/i);
    expect(MIG).not.toMatch(/INSERT INTO public\.outreach_(attempts|outcomes|decisions|delivery_evidence)/i);
    // The store never names them at all.
    expect(STORE).not.toMatch(/outreach_attempts|outreach_outcomes|outreach_decisions|outreach_delivery_evidence/);
    // Positive counterpart: the migration DOES assert this at apply time.
    expect(MIG_RAW).toMatch(/belongs to the engine/);
    expect(MIG_RAW).toMatch(/outreach_attempts/);
  });

  it('NO MESSAGE IDENTITY IS INVENTED — J-5 stays deferred', () => {
    for (const surface of [MIG, STORE, ROUTE]) {
      expect(surface).not.toMatch(/gtm_messages|message_versions|message_version_id|personalization/);
    }
  });
});

// ── Legacy isolation ───────────────────────────────────────────────────────

describe('040 — the legacy substrate is adapted to, never altered', () => {
  it('NO ALTER OF outreach_tasks OR ITS DEPENDENTS', () => {
    expect(MIG).not.toMatch(/ALTER TABLE[^;]*outreach_tasks/i);
    expect(MIG).not.toMatch(/ALTER TABLE[^;]*outreach_(attempts|outcomes|decisions|approvals)/i);
    expect(MIG).not.toMatch(/DROP CONSTRAINT/i);
    expect(MIG_RAW).toMatch(/the legacy outreach_tasks identity was altered/);
    expect(MIG_RAW).toMatch(/execution column\(s\) were added to outreach_tasks/);
  });

  it('the legacy engine modules are byte-identical', () => {
    // RE-PINNED 2026-10-28 to the orchestration port: governance, quota and dispatch
    // are origin/main's plus the WS-3 re-dispatch fix (pi-consol's reconciliation is NOT
    // ported; owner decision pending); personAnchor is pi-consol's subject-aware version.
    // RE-PINNED 2026-11-02: dispatch stops before writing when a transport is disabled
    // (G-8) and its comments no longer claim idempotency at the provider (G-3).
    expect(sha('backend/services/leadOutreachExecution/governance.ts')).toBe('1baa47982b4a4613');
    expect(sha('backend/services/leadOutreachExecution/approval.ts')).toBe('4ef1acc19f3feb64');
    expect(sha('backend/services/leadOutreachExecution/materialization.ts')).toBe('46d4461b56be2908');
    expect(sha('backend/services/leadOutreachExecution/translation.ts')).toBe('a83e38bb9f2fe9b7');
    expect(sha('backend/services/leadOutreachExecution/personAnchor.ts')).toBe('7459e807986f20a6');
    expect(sha('backend/services/leadOutreachExecution/quota.ts')).toBe('5835d9876ad97b5b');
    expect(sha('backend/services/leadOutreachExecution/dispatch.ts')).toBe('c2a131f6aa8fa709');
  });

  it('person resolution reuses the ONE existing mechanism', () => {
    expect(STORE).toMatch(/resolveSubjectPersonId/);
    // No second resolver: nothing reads the person tables directly here.
    expect(STORE).not.toMatch(/unified_person_id/);
    expect(STORE).not.toMatch(/canonical_leads|from\('leads'\)/);
  });

  it('AN UNRESOLVED PERSON REFUSES BEFORE ANYTHING IS WRITTEN', () => {
    const fn = STORE.slice(STORE.indexOf('export async function bridgeExecutionTask'));
    const iPerson = fn.indexOf('person_unresolved');
    const iRpc = fn.indexOf('supabase.rpc(');
    expect(iPerson).toBeGreaterThan(-1);
    expect(iRpc).toBeGreaterThan(iPerson);
    // And the function refuses too, so a forgetful caller cannot bypass it.
    expect(fnBody('bridge_execution_task')).toMatch(/p_person_id IS NULL/);
  });
});

// ── 036 / 037 discipline ───────────────────────────────────────────────────

describe('040 — 036 and 037 are untouched beyond the authorized index', () => {
  it('036 and 037 artefacts are byte-identical', () => {
    // RE-PINNED 2026-10-28 to the orchestration port (renumbered migrations; the
    // plan store gained the read-only frequency lookup).
    expect(sha('supabase/migrations/20261228000001_pi_execution_plans.sql'))
      .toBe('04de68f4eb360825');
    expect(sha('backend/services/executionPlans/executionPlanStore.ts'))
      .toBe('c2f0c2174cb2ca3c');
    expect(sha('pages/api/execution-instances/[id]/plan.ts')).toBe('d133ffc3c1cadc5e');
    expect(sha('supabase/migrations/20261228000002_pi_execution_step_scheduling.sql'))
      .toBe('652e20fb2f6425e2');
    expect(sha('backend/services/workflowExecution/stepProgressionStore.ts'))
      .toBe('d70eaf7eed626960');
    expect(sha('pages/api/execution-instances/[id]/progression.ts')).toBe('1838a1d1139c3b51');
  });

  it('033 artefacts are byte-identical', () => {
    // RE-PINNED 2026-10-28 (see the 036/037 notes).
    expect(sha('supabase/migrations/20261228000000_pi_execution_instances.sql'))
      .toBe('497119eb80564588'); // RE-PINNED 2026-10-28 (real-PostgreSQL verification): postcondition accepts the 20261231 target FK (re-run safe)
    expect(sha('backend/services/executionInstances/executionInstanceStore.ts'))
      .toBe('1319b7d86960f9c3'); // RE-PINNED 2026-10-28: ei_create:targets_not_installed now maps to its own code
    expect(sha('pages/api/execution-instances/[id].ts')).toBe('871dd7074f95e064');
    expect(sha('pages/api/prospect-campaigns/[id]/execution-instances.ts'))
      .toBe('6c303af15da7a4bf');
  });

  it('THE ONLY AUTHORIZED 036 CHANGE IS THE COMPANION INDEX', () => {
    expect(MIG).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_tasks_id_org/);
    // It is on execution_TASKS, not execution_INSTANCES — 033's postcondition
    // refuses an unconditional composite unique key on the latter.
    expect(MIG).not.toMatch(/CREATE UNIQUE INDEX[^;]*ON public\.execution_instances/i);
    expect(MIG).not.toMatch(/ALTER TABLE[^;]*execution_(tasks|plans|plan_steps|instances)/i);
    expect(MIG_RAW).toMatch(/an unconditional composite unique key was added to execution_instances/);
  });

  it('040 ADDED EXACTLY ONE MIGRATION AND ONE TABLE', () => {
    const dir = path.join(ROOT, 'supabase/migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    expect(files.filter((f) => /_pi_outreach_bridge\.sql$/.test(f)))
      .toEqual(['20261229000000_pi_outreach_bridge.sql']);
    expect((MIG.match(/CREATE\s+TABLE/gi) || []).length).toBe(1);
    const creators = files.filter((f) =>
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?outreach_bridge_handoffs\b/i
        .test(fs.readFileSync(path.join(dir, f), 'utf8')));
    expect(creators).toEqual(['20261229000000_pi_outreach_bridge.sql']);
  });
});

// ── Tenancy, authorization, surface ────────────────────────────────────────

describe('040 — tenancy, authorization and surface', () => {
  it('composite tenant-safe FKs are used wherever a companion key exists', () => {
    for (const ref of ['execution_tasks', 'execution_plan_steps', 'execution_plans',
      'prospect_campaigns', 'workflows', 'workflow_versions']) {
      expect(HANDOFFS).toMatch(new RegExp(`REFERENCES public\\.${ref} \\(id, organization_id\\)`));
    }
  });

  it('the legacy task reference is guarded, because a companion key may not be added', () => {
    // `outreach_tasks.company_id` IS uuid (A3 retyped the family), so a composite
    // key would be type-compatible — but it needs a UNIQUE on the LEGACY table,
    // and altering that schema is forbidden. The guard carries it instead.
    expect(HANDOFFS).toMatch(/REFERENCES public\.outreach_tasks \(id\)/);
    expect(fnBody('outreach_bridge_handoffs_guard')).toMatch(/belongs to another tenant/);
    expect(MIG_RAW).toMatch(/altering the legacy substrate's schema is forbidden/);
    // And the migration records that `lead_id` stayed text, which is why a subject
    // id of either kind fits it.
    expect(MIG_RAW).toMatch(/did NOT retype `lead_id`/);
  });

  it('exactly one cascade — the tenant — and no SET NULL', () => {
    expect((HANDOFFS.match(/ON DELETE CASCADE/gi) || []).length).toBe(1);
    expect(HANDOFFS).toMatch(/REFERENCES public\.companies \(id\) ON DELETE CASCADE/);
    expect(MIG).not.toMatch(/ON DELETE SET NULL/i);
  });

  it('RLS is enabled and the function is service_role only', () => {
    expect(MIG).toMatch(/ALTER TABLE public\.outreach_bridge_handoffs ENABLE ROW LEVEL SECURITY/);
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION public\.bridge_execution_task\([^)]*\) FROM PUBLIC/);
    expect(MIG).toMatch(/FROM anon/);
    expect(MIG).toMatch(/FROM authenticated/);
    expect(MIG).toMatch(/GRANT EXECUTE ON FUNCTION public\.bridge_execution_task\([^)]*\) TO service_role/);
  });

  it('the route requires PROSPECT_ICP_MANAGE and adds no capability', () => {
    expect(ROUTE).toMatch(/PROSPECT_ICP_MANAGE/);
    expect(ROUTE).toMatch(/requireCapability\(/);
    for (const banned of ['WORKFLOW_MANAGE', 'AUTOMATION_EXECUTE', 'CAMPAIGN_EXECUTE',
      'OUTREACH_MANAGE', 'OUTREACH_EXECUTE']) {
      expect(ROUTE).not.toContain(banned);
    }
    const reg = read('shared/contracts/security/SecurityCapabilities.ts');
    expect(reg).not.toMatch(/\bOUTREACH_EXECUTE\b/);
    expect(reg).toMatch(/PROSPECT_ICP_MANAGE/);
  });

  it('authorization precedes the bind, and the bind precedes the handoff', () => {
    const iAuth = ROUTE.indexOf('requireCapability(');
    const iBind = ROUTE.indexOf('getExecutionInstance(');
    const iDo = ROUTE.indexOf('bridgeExecutionTask(');
    expect(iAuth).toBeGreaterThan(-1);
    expect(iBind).toBeGreaterThan(iAuth);
    expect(iDo).toBeGreaterThan(iBind);
  });

  it('the tenant comes from the verified session, never the body', () => {
    expect(ROUTE).toMatch(/organizationId:\s*companyId/);
  });

  it('ONE BRIDGE ENDPOINT, AND NO DELETE', () => {
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
        if (/bridgeExecutionTask\s*\(|bridge_execution_task/.test(body)) {
          creators.push(path.relative(ROOT, p).split(path.sep).join('/'));
        }
      }
    };
    walk(path.join(ROOT, 'pages'));
    expect(creators).toEqual([ROUTE_REL]);
    expect(ROUTE).toMatch(/METHODS\s*=\s*\['GET',\s*'POST'\]/);
    expect(ROUTE).not.toMatch(/'DELETE'/);
    expect(MIG).not.toMatch(/DELETE FROM/);
  });

  it('NO JOB, WORKER OR CRON BRIDGES A TASK', () => {
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
          if (/bridgeExecutionTask|bridge_execution_task|outreach_bridge_handoffs/.test(body)) {
            offenders.push(path.relative(ROOT, p).split(path.sep).join('/'));
          }
        }
      };
      walk(path.join(ROOT, root));
    }
    expect(offenders).toEqual([]);
    expect(fs.existsSync(path.join(ROOT, 'backend/jobs'))).toBe(true);
  });

  it('the route never reaches a table or an RPC directly', () => {
    expect(ROUTE).not.toMatch(/ownedDbTable|\.rpc\(/);
    expect(ROUTE).not.toMatch(/outreach_bridge_handoffs|outreach_tasks/);
  });
});
