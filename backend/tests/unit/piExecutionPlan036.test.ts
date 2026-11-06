/**
 * PI-036 — EXECUTION PLAN / PLAN STEPS / TASK BOUNDARY, T1.
 *
 * 036 built the durable bridge from a pinned Workflow Version to a prepared task.
 * The dangerous failure for this layer is not a wrong column, it is quietly
 * becoming an execution engine: re-resolving the version, consulting the persona
 * planner, reproducing the unsafe legacy task key, dispatching, or marking a plan
 * `ready` before its children exist. Each has a guard here.
 *
 * ─── READING RULES THESE GUARDS FOLLOW ────────────────────────────────────
 * Source text is matched after stripping comments and SQL string literals,
 * because the 033 closeout proved a word ban otherwise matches the
 * implementation's OWN prose, or a postcondition's own error message, explaining
 * why it does not do the banned thing. Nothing asserts on line endings or brace
 * placement: the repository is CRLF and such an assertion proves only its own
 * formatting. No guard uses `git status`. Every ban is paired with a positive
 * assertion so it cannot pass by matching nothing.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ROOT = process.cwd();
const read = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const sha = (rel: string): string =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 16);

/** Drop `--` comments AND single-quoted literals, so a ban sees only live SQL. */
const sqlCode = (s: string): string => s
  .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
  .replace(/'(?:[^']|'')*'/g, "''");
/** Drop block and line comments from TypeScript. */
const tsCode = (s: string): string => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

const MIG_REL = 'supabase/migrations/20261228000001_pi_execution_plans.sql';
const STORE_REL = 'backend/services/executionPlans/executionPlanStore.ts';
const ROUTE_REL = 'pages/api/execution-instances/[id]/plan.ts';

const MIG_RAW = read(MIG_REL);
const MIG = sqlCode(MIG_RAW);
const STORE_RAW = read(STORE_REL);
const STORE = tsCode(STORE_RAW);
const ROUTE_RAW = read(ROUTE_REL);
const ROUTE = tsCode(ROUTE_RAW);

/** The CREATE TABLE statement for one table, for structural counts. */
const createTable = (name: string): string =>
  (MIG.match(new RegExp(`CREATE\\s+TABLE[^;]*\\b${name}\\b[^;]*;`, 'i')) || [''])[0];

const PLANS = createTable('execution_plans');
const STEPS = createTable('execution_plan_steps');
const TASKS = createTable('execution_tasks');

// ── The three tables exist with the intended shape ─────────────────────────

describe('036 — the schema contract', () => {
  it('creates exactly three tables', () => {
    const created = (MIG.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.(\w+)/gi) || [])
      .map((m) => m.replace(/.*public\./, ''));
    expect(created.sort()).toEqual(
      ['execution_plan_steps', 'execution_plans', 'execution_tasks'],
    );
  });

  it('PLAN IS 1:1 WITH THE RUN, enforced by the database', () => {
    expect(PLANS).toMatch(/execution_plans_instance_unique/);
    expect(PLANS).toMatch(/UNIQUE\s*\(\s*execution_instance_id\s*\)/i);
    expect(MIG_RAW).toMatch(/execution_plans_instance_unique is missing/);
  });

  it('the plan snapshots the definition AND keeps the version beside it', () => {
    expect(PLANS).toMatch(/definition_snapshot\s+jsonb\s+NOT NULL/i);
    expect(PLANS).toMatch(/workflow_version_id\s+uuid\s+NOT NULL/i);
    expect(PLANS).toMatch(/jsonb_typeof\(definition_snapshot\)/i);
  });

  it('a plan step carries the authored snapshot plus run state', () => {
    for (const col of ['step_key', 'step_order', 'channel', 'instruction',
      'delay_after_previous_hours', 'state']) {
      expect(STEPS).toContain(col);
    }
    expect(STEPS).toMatch(/execution_plan_steps_key_unique/);
    expect(STEPS).toMatch(/UNIQUE\s*\(\s*organization_id,\s*plan_id,\s*step_key\s*\)/i);
    expect(STEPS).toMatch(/UNIQUE\s*\(\s*organization_id,\s*plan_id,\s*step_order\s*\)/i);
  });

  it('plan-step state covers exactly the ratified set', () => {
    const m = MIG_RAW.match(/execution_plan_steps_state_valid[\s\S]{0,200}?\)/);
    expect(m).not.toBeNull();
    for (const s of ['pending', 'ready', 'running', 'completed', 'failed', 'skipped', 'cancelled']) {
      expect(m![0]).toContain(`'${s}'`);
    }
    expect(STORE).toMatch(/PLAN_STEP_STATES\s*=\s*\[/);
  });

  it('the authored channel intent is NOT narrowed to dispatchable transports', () => {
    // A plan may legitimately record a channel that cannot be sent yet. Narrowing
    // here would silently rewrite authored intent.
    expect(STEPS).not.toMatch(/channel\s+text[^,]*CHECK[^,]*IN\s*\(/i);
    expect(STEPS).toMatch(/execution_plan_steps_channel_not_blank/);
  });

  it('RLS is enabled on all three tables', () => {
    expect((MIG.match(/ENABLE ROW LEVEL SECURITY/gi) || []).length).toBe(3);
  });
});

// ── Task identity — the J-4 requirement ────────────────────────────────────

describe('036 — task identity carries the run dimension', () => {
  it('ONE TASK PER PLAN STEP, enforced by the database', () => {
    expect(TASKS).toMatch(/execution_tasks_step_unique/);
    expect(TASKS).toMatch(/UNIQUE\s*\(\s*organization_id,\s*plan_step_id\s*\)/i);
  });

  it('THE LEGACY UNSAFE KEY IS NOT REPRODUCED', () => {
    // `task-<order>-<slug>` had no run dimension and swallowed a second run as
    // "already materialised". Neither it nor its columns may appear here.
    expect(TASKS).not.toMatch(/plan_task_id/);
    expect(TASKS).not.toMatch(/\blead_id\b/);
    expect(MIG).not.toMatch(/task-\$\{/);
    expect(MIG).not.toMatch(/slug\s*\(/i);
    // Positive counterpart: the migration ASSERTS the absence at apply time.
    expect(MIG_RAW).toMatch(/reproduces the legacy plan_task_id\/lead_id identity/);
  });

  it('subject_kind is a COLUMN, so lead and prospect cannot collapse', () => {
    expect(TASKS).toMatch(/subject_kind\s+text\s+NOT NULL/i);
    expect(MIG_RAW).toMatch(/subject_kind IN \('lead', 'prospect'\)/);
    expect(MIG_RAW).toMatch(/lead and prospect could collapse/);
  });

  it('the task names its run directly, and the guard proves the attribution', () => {
    expect(TASKS).toMatch(/execution_instance_id\s+uuid\s+NOT NULL/i);
    expect(MIG).toMatch(/execution_tasks_guard/);
    expect(MIG_RAW).toMatch(/attribution must agree/);
  });

  it('task state is PREPARATION ONLY — no dispatch vocabulary', () => {
    const m = MIG_RAW.match(/execution_tasks_state_valid[\s\S]{0,160}?\)/);
    expect(m).not.toBeNull();
    for (const s of ['prepared', 'cancelled', 'failed']) expect(m![0]).toContain(`'${s}'`);
    for (const forbidden of ['sent', 'delivered', 'dispatched', 'queued', 'bounced']) {
      expect(m![0]).not.toContain(`'${forbidden}'`);
    }
    expect(STORE).toMatch(/TASK_STATES\s*=\s*\['prepared',\s*'cancelled',\s*'failed'\]/);
  });
});

// ── The pinned version is authoritative (J-1) ──────────────────────────────

describe('036 — the pinned Workflow Version is the only source', () => {
  it('the creation function reads the version OFF THE INSTANCE', () => {
    expect(MIG).toMatch(/v_instance\.workflow_version_id/);
    expect(MIG_RAW).toMatch(/does not read the instance pinned version/);
  });

  it('IT NEVER RE-RESOLVES A PUBLISHED VERSION', () => {
    // Re-resolving would silently re-point a historical run at a later publication.
    const fn = MIG.slice(MIG.indexOf('CREATE OR REPLACE FUNCTION public.create_execution_plan'));
    const body = fn.slice(0, fn.indexOf('REVOKE ALL'));
    expect(body).not.toMatch(/published/i);
    expect(body).not.toMatch(/\bmax\s*\(/i);
    // Positive counterpart: it DOES select the pinned version by id.
    expect(body).toMatch(/FROM public\.workflow_versions/);
    expect(body).toMatch(/WHERE id = v_instance\.workflow_version_id/);
  });

  it('THE PERSONA PLANNER IS NOT CONSULTED ANYWHERE', () => {
    for (const banned of ['PERSONA_PLAYBOOKS', 'buildOutreachPlan', 'automationPlanning',
      'taskGenerator', 'qualificationPlanning', 'lead_intelligence_profiles']) {
      expect(MIG).not.toContain(banned);
      expect(STORE).not.toContain(banned);
      expect(ROUTE).not.toContain(banned);
    }
    // Positive counterpart: the migration asserts it at apply time.
    expect(MIG_RAW).toMatch(/consults the persona planner/);
  });

  it('neither the store nor the route accepts a version, workflow or step input', () => {
    for (const surface of [STORE, ROUTE]) {
      expect(surface).not.toMatch(/workflowVersionId\s*[:=]\s*(?:input|body|req)/);
      expect(surface).not.toMatch(/body\.\w*[Vv]ersion/);
      expect(surface).not.toMatch(/body\.steps/);
      expect(surface).not.toMatch(/body\.channel/);
    }
    // Positive counterpart: creation takes exactly the tenant and the run.
    expect(STORE).toMatch(/organizationId:\s*string;\s*\n\s*executionInstanceId:\s*string;/);
    expect(MIG).toMatch(/create_execution_plan\(\s*\n?\s*p_organization_id uuid,\s*\n?\s*p_execution_instance_id uuid\s*\n?\s*\)/);
  });
});

// ── Atomicity (§16) ────────────────────────────────────────────────────────

describe('036 — no falsely ready plan can exist', () => {
  it('the plan is inserted as `materializing`, never as ready', () => {
    // Read from RAW source: `sqlCode` blanks string literals, so the state name
    // this assertion is about is exactly what it strips.
    const fn = MIG_RAW.slice(MIG_RAW.indexOf('CREATE OR REPLACE FUNCTION public.create_execution_plan'));
    const insert = fn.slice(fn.indexOf('INSERT INTO public.execution_plans'));
    expect(insert.slice(0, 400)).toMatch(/'materializing'/);
    expect(insert.slice(0, 400)).not.toMatch(/'ready'/);
  });

  it('THE READY FLIP IS THE LAST ACT, AFTER EVERY CHILD', () => {
    const fn = MIG_RAW.slice(MIG_RAW.indexOf('CREATE OR REPLACE FUNCTION public.create_execution_plan'));
    const iStep = fn.indexOf('INSERT INTO public.execution_plan_steps');
    const iTask = fn.indexOf('INSERT INTO public.execution_tasks');
    const iReady = fn.indexOf("SET status = 'ready'");
    expect(iStep).toBeGreaterThan(-1);
    expect(iTask).toBeGreaterThan(iStep);
    expect(iReady).toBeGreaterThan(iTask);
    // And the migration asserts the same ordering at apply time.
    expect(MIG_RAW).toMatch(/marked ready before its tasks are written/);
  });

  it('a partial materialization is detected and raises', () => {
    expect(MIG).toMatch(/v_order <> v_count/);
    expect(MIG_RAW).toMatch(/ep_create:partial_materialization/);
  });

  it('concurrent materialization of one run serializes on a row lock', () => {
    expect(MIG).toMatch(/FROM public\.execution_instances[\s\S]{0,200}?FOR UPDATE/);
  });

  it('NO READ-THEN-WRITE UNIQUENESS CHECK GUARDS CREATION', () => {
    // The constraint is authoritative. A pre-insert existence check would let two
    // concurrent callers both pass.
    const create = STORE.slice(STORE.indexOf('export async function createExecutionPlan'));
    const body = create.slice(0, create.indexOf('export async function getExecutionPlan'));
    expect(body).not.toMatch(/getPlanForInstance\(/);
    // Positive counterpart: the duplicate is translated from the constraint.
    expect(STORE).toMatch(/execution_plans_instance_unique/);
    expect(STORE).toMatch(/'plan_exists'/);
  });
});

// ── Immutability ───────────────────────────────────────────────────────────

describe('036 — snapshots freeze, only state moves', () => {
  it('three guards exist', () => {
    for (const t of ['trg_execution_plans_guard', 'trg_execution_plan_steps_guard',
      'trg_execution_tasks_guard']) {
      expect(MIG).toContain(t);
    }
    expect(MIG_RAW).toMatch(/% of 3 guards present/);
  });

  it('the plan guard freezes the snapshot and the attribution', () => {
    const g = MIG.slice(MIG.indexOf('FUNCTION public.execution_plans_guard'));
    for (const col of ['organization_id', 'execution_instance_id', 'workflow_version_id',
      'definition_snapshot', 'step_count', 'created_at']) {
      expect(g).toMatch(new RegExp(`NEW\\.${col}\\s+IS DISTINCT FROM OLD\\.${col}`, 'i'));
    }
    // status is the one field that moves, so it must NOT be frozen.
    expect(g).not.toMatch(/NEW\.status\s+IS DISTINCT FROM OLD\.status\s*$/m);
  });

  it('the step guard freezes the authored fields but not state', () => {
    const g = MIG.slice(MIG.indexOf('FUNCTION public.execution_plan_steps_guard'));
    for (const col of ['plan_id', 'step_key', 'step_order', 'channel', 'instruction',
      'delay_after_previous_hours']) {
      expect(g).toMatch(new RegExp(`NEW\\.${col}\\s+IS DISTINCT FROM OLD\\.${col}`, 'i'));
    }
  });

  it('a settled plan, step or task cannot be re-opened', () => {
    expect(MIG_RAW).toMatch(/a settled plan cannot be re-opened/);
    expect(MIG_RAW).toMatch(/a settled step cannot be re-opened/);
    expect(MIG_RAW).toMatch(/a settled task cannot be re-opened/);
    expect(STORE).toMatch(/TERMINAL_PLAN_STEP_STATES/);
    expect(STORE).toMatch(/TERMINAL_TASK_STATES/);
  });

  it('the plan guard checks tenant AND pinned-version agreement on INSERT', () => {
    const g = MIG_RAW.slice(MIG_RAW.indexOf('FUNCTION public.execution_plans_guard'));
    expect(g).toMatch(/belongs to another tenant/);
    expect(g).toMatch(/the pinned version is authoritative/);
  });
});

// ── Tenant safety ──────────────────────────────────────────────────────────

describe('036 — tenant safety is in the database', () => {
  it('composite tenant-safe FKs are used wherever a companion key exists', () => {
    expect(PLANS).toMatch(/FOREIGN KEY \(workflow_version_id, organization_id\)/i);
    expect(STEPS).toMatch(/FOREIGN KEY \(plan_id, organization_id\)/i);
    expect(TASKS).toMatch(/FOREIGN KEY \(plan_step_id, organization_id\)/i);
  });

  it('this migration creates the companion keys its OWN children need', () => {
    expect(MIG).toMatch(/uq_execution_plans_id_org/);
    expect(MIG).toMatch(/uq_execution_plan_steps_id_org/);
  });

  it('IT DOES NOT ADD A COMPANION KEY TO execution_instances', () => {
    // 033's postcondition refuses any unconditional composite unique index on
    // that table, so adding one would make the FROZEN 033 migration fail on
    // replay. The instance reference is therefore a single-column FK plus a
    // trigger — the precedent 033 itself set for its polymorphic subject.
    expect(MIG).not.toMatch(/CREATE UNIQUE INDEX[^;]*ON public\.execution_instances/i);
    expect(PLANS).toMatch(/FOREIGN KEY \(execution_instance_id\)\s*\n?\s*REFERENCES public\.execution_instances \(id\)/i);
    // Positive counterpart: the migration asserts it did not add one.
    expect(MIG_RAW).toMatch(/an unconditional composite unique key was added to execution_instances/);
  });

  it('exactly one cascade per table — the tenant — and no SET NULL', () => {
    for (const t of [PLANS, STEPS, TASKS]) {
      expect((t.match(/ON DELETE CASCADE/gi) || []).length).toBe(1);
      expect(t).toMatch(/REFERENCES public\.companies \(id\) ON DELETE CASCADE/i);
    }
    expect(MIG).not.toMatch(/ON DELETE SET NULL/i);
  });

  it('every store read and write is tenant-scoped first', () => {
    const eqs = STORE.match(/\.eq\('organization_id', /g) || [];
    expect(eqs.length).toBeGreaterThanOrEqual(6);
    expect(STORE).toMatch(/function assertTenant/);
  });
});

// ── The legacy substrate stays isolated (§3 decision: B) ───────────────────

describe('036 — outreach_tasks is isolated, not evolved', () => {
  it('the migration does not touch outreach_tasks', () => {
    expect(MIG).not.toMatch(/ALTER TABLE[^;]*outreach_tasks/i);
    expect(MIG).not.toMatch(/DROP CONSTRAINT[^;]*outreach_tasks/i);
    // Positive counterpart: it ASSERTS the legacy identity survives untouched.
    expect(MIG_RAW).toMatch(/outreach_tasks_identity_unique was altered/);
  });

  it('the new store never writes the legacy table', () => {
    expect(STORE).not.toMatch(/outreach_tasks|outreach_attempts|outreach_outcomes/);
    expect(STORE).toMatch(/const TASKS_TABLE = 'execution_tasks'/);
  });

  it('the legacy materializer is untouched by 036', () => {
    expect(sha('backend/services/leadOutreachExecution/materialization.ts'))
      .toBe('46d4461b56be2908');
    expect(sha('backend/services/automationExecution/taskGenerator.ts'))
      .toBe('fbc7348d52c11f04');
  });
});

// ── The Outreach boundary (§15) ────────────────────────────────────────────

describe('036 — nothing is dispatched', () => {
  it('NO DISPATCH, DELIVERY, PROVIDER OR TRANSPORT COLUMN EXISTS', () => {
    for (const col of ['provider', 'transport', 'attempt_number', 'delivery_status',
      'sent_at', 'delivered_at', 'scheduled_at', 'provider_message_id']) {
      expect(PLANS).not.toContain(col);
      expect(STEPS).not.toContain(col);
      expect(TASKS).not.toContain(col);
    }
    expect(MIG_RAW).toMatch(/column\(s\) leaked into the execution layer/);
  });

  it('NO MESSAGE IDENTITY IS CLAIMED — J-5 stays deferred', () => {
    for (const banned of ['gtm_messages', 'message_versions', 'message_id',
      'message_version_id', 'personalization']) {
      expect(MIG).not.toContain(banned);
      expect(STORE).not.toContain(banned);
      expect(ROUTE).not.toContain(banned);
    }
    // Positive counterpart: the store says so explicitly, and `instruction` is
    // authoring text rather than a message.
    expect(STORE_RAW).toMatch(/J-5/);
    expect(STORE).toMatch(/instruction/);
  });

  it('NOTHING IS SCHEDULED, ENQUEUED OR SENT', () => {
    for (const surface of [STORE, ROUTE]) {
      expect(surface).not.toMatch(/\b(schedule|enqueue|dispatch|setTimeout|sendMessage)\s*\(/i);
    }
    expect(MIG).not.toMatch(/pg_cron|pg_notify/i);
  });

  it('mayContact and the governance chain are neither called nor altered', () => {
    for (const surface of [MIG, STORE, ROUTE]) {
      expect(surface).not.toMatch(/mayContact\s*\(/);
      expect(surface).not.toMatch(/kill_switch|suppression|rate_limit/);
    }
    // Positive counterpart: the route DOCUMENTS that they remain authoritative,
    // which is why the bans above read comment-stripped source.
    expect(ROUTE_RAW).toMatch(/mayContact/);
    expect(ROUTE_RAW).toMatch(/authoritative/);
  });

  it('requires_approval is a requirement carried forward, never a grant', () => {
    expect(TASKS).toMatch(/requires_approval\s+boolean\s+NOT NULL DEFAULT false/i);
    expect(MIG_RAW).toMatch(/never a grant/);
  });
});

// ── Authorization ──────────────────────────────────────────────────────────

describe('036 — authorization is the interim capability, unchanged', () => {
  it('the route requires PROSPECT_ICP_MANAGE', () => {
    expect(ROUTE).toMatch(/PROSPECT_ICP_MANAGE/);
    expect(ROUTE).toMatch(/requireCapability\(/);
  });

  it('NO NEW CAPABILITY WAS INTRODUCED', () => {
    for (const banned of ['WORKFLOW_MANAGE', 'AUTOMATION_EXECUTE', 'CAMPAIGN_EXECUTE',
      'EXECUTION_MANAGE', 'EXECUTION_PLAN_MANAGE']) {
      expect(ROUTE).not.toContain(banned);
    }
    // Word-anchored, and `PLAN_MANAGE` is NOT banned as a bare substring: the
    // registry has a pre-existing, unrelated `BILLING_PLAN_MANAGE`, which an
    // unanchored ban flagged. The names below are the ones 036 could have added.
    const reg = read('shared/contracts/security/SecurityCapabilities.ts');
    expect(reg).not.toMatch(/\bWORKFLOW_MANAGE\b/);
    expect(reg).not.toMatch(/\bEXECUTION_MANAGE\b/);
    expect(reg).not.toMatch(/\bEXECUTION_PLAN_MANAGE\b/);
    expect(reg).not.toMatch(/\bEXECUTION_TASK_MANAGE\b/);
    expect(reg).toMatch(/PROSPECT_ICP_MANAGE/);
  });

  it('authorization precedes the bind, and the bind precedes creation', () => {
    const iAuth = ROUTE.indexOf('requireCapability(');
    const iBind = ROUTE.indexOf('getExecutionInstance(');
    const iCreate = ROUTE.indexOf('createExecutionPlan(');
    expect(iAuth).toBeGreaterThan(-1);
    expect(iBind).toBeGreaterThan(iAuth);
    expect(iCreate).toBeGreaterThan(iBind);
  });

  it('the tenant comes from the verified session and the run from the path', () => {
    expect(ROUTE).toMatch(/organizationId:\s*companyId/);
    expect(ROUTE).toMatch(/executionInstanceId:\s*instanceId/);
    expect(ROUTE).not.toMatch(/body\.company_id\s*\|\|/);
  });

  it('the RPC is service_role only', () => {
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION public\.create_execution_plan\(uuid, uuid\) FROM PUBLIC/);
    expect(MIG).toMatch(/FROM anon/);
    expect(MIG).toMatch(/FROM authenticated/);
    expect(MIG).toMatch(/GRANT EXECUTE ON FUNCTION public\.create_execution_plan\(uuid, uuid\) TO service_role/);
  });

  it('there is no DELETE anywhere — a plan is the record of a run', () => {
    expect(ROUTE).toMatch(/METHODS\s*=\s*\['GET',\s*'POST'\]/);
    expect(ROUTE).not.toMatch(/'DELETE'/);
    expect(STORE).not.toMatch(/export\s+async\s+function\s+delete/i);
    expect(STORE).not.toMatch(/\.delete\(\)/);
  });
});

// ── Scope fence (§21) ──────────────────────────────────────────────────────

describe('036 — the scope fence holds', () => {
  it('NO SCHEDULER, BRANCHING, CONDITION OR EVENT-WAIT CONSTRUCT', () => {
    for (const col of ['condition', 'branch', 'depends_on', 'wait_for_event',
      'business_day', 'cron_expression', 'run_at']) {
      expect(PLANS).not.toContain(col);
      expect(STEPS).not.toContain(col);
      expect(TASKS).not.toContain(col);
    }
    // Positive counterpart: the WHOLE timing vocabulary is the authored relative
    // delay, exactly as 032 ratified.
    expect(STEPS).toMatch(/delay_after_previous_hours\s+numeric\s+NOT NULL/i);
  });

  it('036 ADDED EXACTLY ONE MIGRATION', () => {
    const dir = path.join(ROOT, 'supabase/migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);
    const mine = files.filter((f) => /_pi_execution_plans\.sql$/.test(f));
    expect(mine).toEqual(['20261228000001_pi_execution_plans.sql']);
    // And each new table has exactly ONE creator migration.
    for (const t of ['execution_plans', 'execution_plan_steps', 'execution_tasks']) {
      const creators = files.filter((f) =>
        new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?${t}\\b`, 'i')
          .test(fs.readFileSync(path.join(dir, f), 'utf8')));
      expect(creators).toEqual(['20261228000001_pi_execution_plans.sql']);
    }
  });

  it('NO JOB, WORKER, CRON OR SCRIPT MATERIALIZES A PLAN', () => {
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
          if (/createExecutionPlan\s*\(|create_execution_plan|execution_plans|execution_tasks/.test(body)) {
            offenders.push(path.relative(ROOT, p).split(path.sep).join('/'));
          }
        }
      };
      walk(path.join(ROOT, root));
    }
    expect(offenders).toEqual([]);
    expect(fs.existsSync(path.join(ROOT, 'backend/jobs'))).toBe(true);
  });

  it('ONLY ONE ROUTE MATERIALIZES A PLAN', () => {
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
        if (/createExecutionPlan\s*\(|create_execution_plan/.test(body)) {
          creators.push(path.relative(ROOT, p).split(path.sep).join('/'));
        }
      }
    };
    walk(path.join(ROOT, 'pages'));
    expect(creators).toEqual([ROUTE_REL]);
  });

  it('the store is the single writer of the three new tables', () => {
    expect(ROUTE).not.toMatch(/ownedDbTable|\.rpc\(/);
    expect(ROUTE).not.toMatch(/execution_plans|execution_plan_steps|execution_tasks/);
    expect(STORE).toMatch(/CREATE_EXECUTION_PLAN_FN\s*=\s*'create_execution_plan'/);
  });
});

// ── Isolation, proven by content not by git status ─────────────────────────

describe('036 — frozen artefacts are untouched', () => {
  // RE-PINNED 2026-10-28 to the orchestration port: renumbered migrations, the
  // deferred target FK, read-only store listings, the journey-policy validator and
  // the enrollment-eligibility check on the invocation route.
  it('033 is byte-identical', () => {
    expect(sha('supabase/migrations/20261228000000_pi_execution_instances.sql'))
      .toBe('497119eb80564588'); // RE-PINNED 2026-10-28 (real-PostgreSQL verification): postcondition accepts the 20261231 target FK (re-run safe)
    expect(sha('backend/services/executionInstances/executionInstanceStore.ts'))
      .toBe('1319b7d86960f9c3'); // RE-PINNED 2026-10-28: ei_create:targets_not_installed now maps to its own code
    expect(sha('pages/api/execution-instances/[id].ts')).toBe('5bf14b6a3889a485'); // RE-PINNED 2026-11-05 (Prompt 4): PATCH resume may carry a returnDate (journeyRetiming)
  });

  it('034 canonical invocation route is byte-identical at its post-port baseline', () => {
    expect(sha('pages/api/prospect-campaigns/[id]/execution-instances.ts'))
      .toBe('6c303af15da7a4bf');
  });

  it('032 is byte-identical (029/030 land with the lists slice)', () => {
    expect(sha('supabase/migrations/20261227000000_pi_workflow_definitions.sql'))
      .toBe('71691e4328a27592'); // RE-PINNED 2026-10-28 (migration re-run safety): re-running 032 after 20261231000004 no longer narrows the publish vocabulary (function body unchanged)
    expect(sha('backend/services/workflows/workflowStore.ts')).toBe('8b5096c788dc142d'); // RE-PINNED 2026-10-28 (social_post): additive social_post channel + optional step reference (20261231000004)
  });

  it('036 created no Plan/Step/Task table beyond its own three', () => {
    const dir = path.join(ROOT, 'supabase/migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    const BANNED = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(execution_contexts?|workflow_runs?|workflow_instances?|workflow_steps?|workflow_invocations?|message_versions?)\b/i;
    expect(files.filter((f) =>
      BANNED.test(fs.readFileSync(path.join(dir, f), 'utf8')))).toEqual([]);
    expect(BANNED.test('CREATE TABLE public.message_versions (')).toBe(true);
  });
});
