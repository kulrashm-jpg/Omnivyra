/**
 * PI-034 — EXECUTION INSTANCE PRODUCER / INVOCATION, T1.
 *
 * 034 added ONE capability: a legitimate product action can invoke a Workflow for a
 * Subject in a Campaign, and a retry of that action is distinguishable from an
 * intentional new run. It added no entity, no table, no planner call and no dispatch.
 *
 * ─── WHAT THESE GUARDS PROTECT ────────────────────────────────────────────
 * Mostly absences. The dangerous failure for a producer is not a wrong field, it is
 * quietly growing into automation: a second writer, a version override, a planner
 * call, an auto-transition out of `created`, or an Instance minted as a side effect
 * of a PI selection fact. Each of those has a guard here, and each negative guard is
 * paired with a positive assertion so it cannot pass by matching nothing.
 *
 * ─── READING RULES THESE GUARDS FOLLOW ────────────────────────────────────
 * Source text is compared after stripping comments, because the 033 closeout proved
 * that a word ban otherwise matches the implementation's OWN prose explaining why it
 * does not do the banned thing. Nothing asserts on line endings or brace placement:
 * the repository is CRLF and such an assertion proves only its own formatting. No
 * guard uses `git status`.
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

/** Drop block and line comments, so a ban cannot match the code's own prose. */
const code = (src: string): string => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

const ROUTE_REL = 'pages/api/prospect-campaigns/[id]/execution-instances.ts';
const STORE_REL = 'backend/services/executionInstances/executionInstanceStore.ts';
const MIDDLEWARE_REL = 'backend/middleware/withIdempotency.ts';

const ROUTE_RAW = read(ROUTE_REL);
const ROUTE = code(ROUTE_RAW);
const STORE_RAW = read(STORE_REL);
const STORE = code(STORE_RAW);

// ── The invocation surface ─────────────────────────────────────────────────

describe('034 — exactly one invocation endpoint', () => {
  it('the campaign-nested POST is the invocation action', () => {
    expect(ROUTE).toMatch(/METHODS\s*=\s*\['GET',\s*'POST'\]/);
    expect(ROUTE).toMatch(/createExecutionInstance\(/);
  });

  it('NO SECOND ENDPOINT CREATES AN EXECUTION INSTANCE', () => {
    // Census over every API route: the set that can create an Instance must be
    // exactly one file. A second creating endpoint under the same capability is
    // the competing-invocation-endpoint shape 034 was forbidden to produce.
    const creators: string[] = [];
    const walk = (dir: string): void => {
      let entries: string[] = [];
      try { entries = fs.readdirSync(dir); } catch { return; }
      for (const e of entries) {
        const p = path.join(dir, e);
        let stat: fs.Stats;
        try { stat = fs.statSync(p); } catch { continue; }
        if (stat.isDirectory()) { walk(p); continue; }
        if (!e.endsWith('.ts') && !e.endsWith('.tsx')) continue;
        const body = code(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'));
        if (/createExecutionInstance\s*\(/.test(body)
          || /create_execution_instance/.test(body)) {
          creators.push(path.relative(ROOT, p).split(path.sep).join('/'));
        }
      }
    };
    walk(path.join(ROOT, 'pages'));
    expect(creators).toEqual([ROUTE_REL]);
  });

  it('NO JOB, WORKER, CRON OR SCRIPT CREATES AN EXECUTION INSTANCE', () => {
    // The producer must be an explicit action. Automatic creation from a
    // background process is the hidden-automation failure 034 forbids.
    const offenders: string[] = [];
    for (const root of ['backend/jobs', 'backend/workers', 'backend/queue', 'scripts']) {
      const base = path.join(ROOT, root);
      const walk = (dir: string): void => {
        let entries: string[] = [];
        try { entries = fs.readdirSync(dir); } catch { return; }
        for (const e of entries) {
          const p = path.join(dir, e);
          let stat: fs.Stats;
          try { stat = fs.statSync(p); } catch { continue; }
          if (stat.isDirectory()) { if (e !== 'node_modules') walk(p); continue; }
          if (!e.endsWith('.ts')) continue;
          const body = code(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'));
          if (/createExecutionInstance\s*\(/.test(body)
            || /create_execution_instance/.test(body)
            || /execution_instances/.test(body)) {
            offenders.push(path.relative(ROOT, p).split(path.sep).join('/'));
          }
        }
      };
      walk(base);
    }
    expect(offenders).toEqual([]);
    // Positive counterpart: the directories really were scanned.
    expect(fs.existsSync(path.join(ROOT, 'backend/jobs'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'scripts'))).toBe(true);
  });

  it('the store is still the single Execution Instance mutation owner', () => {
    expect(STORE).toMatch(/CREATE_EXECUTION_INSTANCE_FN\s*=\s*'create_execution_instance'/);
    // The route calls the store; it does not reach the RPC or the table itself.
    expect(ROUTE).not.toMatch(/create_execution_instance/);
    expect(ROUTE).not.toMatch(/execution_instances/);
    expect(ROUTE).not.toMatch(/ownedDbTable|\.rpc\(/);
  });
});

// ── Invocation identity ────────────────────────────────────────────────────

describe('034 — invocation identity is the caller-supplied idempotency key', () => {
  it('the POST is wrapped in the repository idempotency middleware', () => {
    expect(ROUTE).toMatch(/withIdempotency\(/);
    expect(ROUTE).toMatch(/scope:\s*'pi-execution-instance-invoke'/);
  });

  it('the wrapper covers POST ONLY, so GET carries no invocation identity', () => {
    const call = ROUTE.match(/withIdempotency\([\s\S]*?\}\s*\)/);
    expect(call).not.toBeNull();
    expect(call![0]).toMatch(/methods:\s*\['POST'\]/);
    expect(call![0]).not.toMatch(/'GET'/);
  });

  it('THE KEY IS MANDATORY — a keyless POST cannot reach the handler', () => {
    // Asserted against the middleware's own contract rather than restated here,
    // so this cannot drift from the mechanism it describes.
    const mw = code(read(MIDDLEWARE_REL));
    expect(mw).toMatch(/headers\['idempotency-key'\]/);
    expect(mw).toMatch(/IDEMPOTENCY_KEY_REQUIRED/);
    expect(mw).toMatch(/status\(400\)/);
  });

  it('a retry replays the original response rather than creating a second run', () => {
    const mw = code(read(MIDDLEWARE_REL));
    expect(mw).toMatch(/status\s*===\s*'completed'/);
    expect(mw).toMatch(/response_status/);
    expect(mw).toMatch(/response_body/);
  });

  it('the same key with a DIFFERENT payload is a conflict, not a replay', () => {
    const mw = code(read(MIDDLEWARE_REL));
    expect(mw).toMatch(/request_hash\s*!==\s*requestHash/);
    expect(mw).toMatch(/IDEMPOTENCY_CONFLICT/);
  });

  it('identity is caller-scoped, so one principal cannot replay another’s', () => {
    const mw = code(read(MIDDLEWARE_REL));
    expect(mw).toMatch(/callerId/);
    expect(mw).toMatch(/IDEMPOTENCY_PRINCIPAL_REQUIRED/);
  });

  it('NO SERVER-MINTED INVOCATION KEY — the route never generates one', () => {
    // A server-minted key would make every retry a new invocation, which is the
    // failure this whole mechanism exists to prevent. 030 rejected the same
    // shortcut for selection keys.
    expect(ROUTE).not.toMatch(/randomUUID|uuidv4|Date\.now\(\)|crypto\./);
    // Positive counterpart: the identity genuinely comes from the wrapper.
    expect(ROUTE).toMatch(/withIdempotency/);
  });

  it('TARGET IS NOT THE INVOCATION KEY', () => {
    // A Target is a PI selection fact: it can back invocations of different
    // workflows, and a lead subject has none. The route must not derive
    // invocation identity from it.
    const call = ROUTE.match(/withIdempotency\([\s\S]*?\}\s*\)/);
    expect(call![0]).not.toMatch(/target/i);
    // And the Target is still merely passed through when present.
    expect(ROUTE).toMatch(/targetId:\s*String\(body\.targetId\)/);
  });
});

// ── The version boundary ───────────────────────────────────────────────────

describe('034 — the producer does not choose a Workflow Version', () => {
  it('the route accepts no version INPUT', () => {
    // Banned precisely: a version read from the request. A bare /version/i ban
    // was wrong — it matched the route's own `no_published_version` error code,
    // which is the route correctly REPORTING that resolution found nothing.
    expect(ROUTE).not.toMatch(/workflowVersionId/i);
    expect(ROUTE).not.toMatch(/body\.\w*[Vv]ersion/);
    expect(ROUTE).not.toMatch(/query\.\w*[Vv]ersion/);
    expect(ROUTE).not.toMatch(/str\(\s*body\.[^)]*[Vv]ersion/);
  });

  it('the route names a WORKFLOW, which 033 then resolves and pins', () => {
    expect(ROUTE).toMatch(/workflowId/);
    expect(STORE).toMatch(/CREATE_EXECUTION_INSTANCE_FN/);
    // Positive counterpart to the ban above: the route DOES surface the
    // resolution outcome, which is only possible because 033 owns resolution.
    expect(ROUTE).toMatch(/no_published_version/);
  });

  it('NO MAX(version) RESOLUTION ANYWHERE ON THE PRODUCER PATH', () => {
    expect(ROUTE).not.toMatch(/\bmax\s*\(/i);
    expect(STORE).not.toMatch(/\bmax\s*\(/i);
  });
});

// ── Lifecycle: invocation does not execute ─────────────────────────────────

describe('034 — invocation creates a durable fact and nothing else', () => {
  it('the caller cannot set the lifecycle state, timestamps or the identity', () => {
    const post = ROUTE.slice(ROUTE.indexOf('createExecutionInstance('));
    expect(post).not.toMatch(/lifecycleState/);
    expect(post).not.toMatch(/created_at|createdAt|updated_at|updatedAt/);
    // Positive counterpart: the five legitimate inputs ARE passed.
    for (const f of ['organizationId', 'campaignId', 'workflowId', 'subjectKind', 'subjectId']) {
      expect(post).toContain(f);
    }
  });

  it('the tenant comes from the verified session, never from the body', () => {
    expect(ROUTE).toMatch(/organizationId:\s*companyId/);
    expect(ROUTE).toMatch(/enforceCompanyAccess\(/);
  });

  it('the campaign comes from the bound path parent, never from the body', () => {
    expect(ROUTE).toMatch(/campaignId,/);
    expect(ROUTE).toMatch(/getProspectCampaign\(companyId,\s*campaignId\)/);
    expect(ROUTE).not.toMatch(/body\.campaign_id|body\.campaignId/);
  });

  it('NO PLANNER IS INVOKED', () => {
    for (const banned of ['buildOutreachPlan', 'automationPlanning', 'PERSONA_PLAYBOOKS',
      'taskGenerator', 'lead_intelligence_profiles']) {
      expect(ROUTE).not.toContain(banned);
      expect(STORE).not.toContain(banned);
    }
  });

  it('NO OUTREACH, TRANSPORT OR PROVIDER IS TOUCHED', () => {
    for (const banned of ['outreach_tasks', 'outreach_attempts', 'gtm_messages',
      'transportRegistry', 'providerAccount', 'dispatch', 'warmup']) {
      expect(ROUTE).not.toContain(banned);
      expect(STORE).not.toContain(banned);
    }
  });

  it('NOTHING IS SCHEDULED OR ENQUEUED', () => {
    expect(ROUTE).not.toMatch(/\b(schedule|enqueue|setTimeout|cron|queue)\s*\(/i);
    expect(STORE).not.toMatch(/\b(schedule|enqueue|setTimeout|cron)\s*\(/i);
  });

  it('mayContact and the governance chain are neither called nor altered', () => {
    expect(ROUTE).not.toMatch(/mayContact\s*\(/);
    expect(STORE).not.toMatch(/mayContact\s*\(/);
    // Positive counterpart: the route still DOCUMENTS that they stay authoritative,
    // which is why the ban above is read from comment-stripped source.
    expect(ROUTE_RAW).toMatch(/mayContact/);
    expect(ROUTE_RAW).toMatch(/authoritative/i);
  });

  it('no instance is created as a side effect of a PI selection fact', () => {
    // The selection producer, the list layer and the Target store must remain
    // unaware of invocation.
    for (const rel of [
      'backend/services/prospectCampaigns/campaignSelectionService.ts',
      'backend/services/prospectCampaigns/campaignTargetStore.ts',
    ]) {
      // Both land with the lists/targets slice; the guard applies as soon as they exist.
      if (!fs.existsSync(path.join(ROOT, rel))) continue;
      const body = code(read(rel));
      expect(body).not.toMatch(/createExecutionInstance|execution_instances/);
    }
  });
});

// ── Authorization ──────────────────────────────────────────────────────────

describe('034 — authorization is 033’s interim capability, unchanged', () => {
  it('the invocation action requires PROSPECT_ICP_MANAGE', () => {
    expect(ROUTE).toMatch(/PROSPECT_ICP_MANAGE/);
    expect(ROUTE).toMatch(/requireCapability\(/);
  });

  it('NO NEW CAPABILITY WAS INTRODUCED', () => {
    expect(ROUTE).not.toMatch(/WORKFLOW_MANAGE/);
    expect(ROUTE).not.toMatch(/AUTOMATION_EXECUTE/);
    expect(ROUTE).not.toMatch(/CAMPAIGN_EXECUTE/);
  });

  it('the capability registry was not modified', () => {
    const reg = read('shared/contracts/security/SecurityCapabilities.ts');
    expect(reg).not.toMatch(/WORKFLOW_MANAGE/);
    expect(reg).not.toMatch(/EXECUTION_INSTANCE_[A-Z_]+/);
    // Positive counterpart: this really is the registry that defines the
    // capability 034 reuses.
    expect(reg).toMatch(/PROSPECT_ICP_MANAGE/);
  });

  it('the widening is recorded explicitly', () => {
    expect(ROUTE_RAW).toMatch(/widening/i);
    expect(ROUTE_RAW).toMatch(/invoke an Execution Instance/i);
  });

  it('authorization precedes the bind, and the bind precedes creation', () => {
    const iAuth = ROUTE.indexOf('requireCapability(');
    const iBind = ROUTE.indexOf('getProspectCampaign(');
    const iCreate = ROUTE.indexOf('createExecutionInstance(');
    expect(iAuth).toBeGreaterThan(-1);
    expect(iBind).toBeGreaterThan(iAuth);
    expect(iCreate).toBeGreaterThan(iBind);
  });
});

// ── Error semantics ────────────────────────────────────────────────────────

describe('034 — a caller can tell acceptance from conflict', () => {
  it('an active conflict names the run that is in the way', () => {
    expect(ROUTE).toMatch(/already_active/);
    expect(ROUTE).toMatch(/activeInstanceId/);
    expect(ROUTE).toMatch(/getOccupiedExecutionInstance\(/);
  });

  it('the conflict id is read through the occupancy predicate', () => {
    expect(STORE).toMatch(/OCCUPIED_LIFECYCLE_STATES/);
    const fn = STORE.slice(STORE.indexOf('export async function getOccupiedExecutionInstance'));
    expect(fn.slice(0, 900)).toMatch(/\.in\('lifecycle_state',\s*\[\.\.\.OCCUPIED_LIFECYCLE_STATES\]\)/);
  });

  it('NO READ-THEN-WRITE UNIQUENESS CHECK GUARDS CREATION', () => {
    // The occupancy read must happen only in the FAILURE path. If it ran before
    // creation as a guard, two concurrent invocations could both pass it.
    const iCreate = ROUTE.indexOf('createExecutionInstance(');
    const iOccupied = ROUTE.indexOf('getOccupiedExecutionInstance(');
    expect(iCreate).toBeGreaterThan(-1);
    expect(iOccupied).toBeGreaterThan(iCreate);
    // And it sits inside the catch, not the try.
    expect(ROUTE.slice(ROUTE.indexOf('} catch'))).toMatch(/getOccupiedExecutionInstance\(/);
  });

  it('the distinguishable outcomes are all reachable', () => {
    expect(ROUTE).toMatch(/status\(201\)/);
    expect(ROUTE).toMatch(/status\(409\)/);
    expect(ROUTE).toMatch(/statusFor\(/);
  });
});

// ── Isolation, proven by content not by git status ─────────────────────────

describe('034 — isolation, proven by content', () => {
  it('034 ADDED NO MIGRATION', () => {
    const dir = path.join(ROOT, 'supabase/migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);
    // Matched on a workstream slug, never on bare digits: a `/034/` match would
    // also hit timestamps inside unrelated filenames.
    expect(files.filter((f) => /invocation|_034_/i.test(f))).toEqual([]);
    // And the Instance table still has exactly one creator, 033's. Anchored to the
    // TABLE-NAME position: the earlier `CREATE TABLE[^;]*execution_instances` form
    // reached across a whole column list, so 036's migration matched it merely for
    // carrying a FOREIGN KEY that REFERENCES this table.
    const creators = files.filter((f) =>
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?execution_instances\b/i
        .test(fs.readFileSync(path.join(dir, f), 'utf8')));
    expect(creators).toEqual(['20261228000000_pi_execution_instances.sql']);
  });

  it('033’s store and migration are untouched by 034', () => {
    const crypto = require('crypto') as typeof import('crypto');
    const sha = (rel: string): string => crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 16);
    // RE-PINNED 2026-10-28 to the orchestration port (renumbered migration with the
    // deferred target FK; the store gained the read-only discovery/report listings).
    expect(sha('supabase/migrations/20261228000000_pi_execution_instances.sql'))
      .toBe('497119eb80564588'); // RE-PINNED 2026-10-28 (real-PostgreSQL verification): postcondition accepts the 20261231 target FK (re-run safe)
    // RE-PINNED 2026-10-28: ei_create:targets_not_installed now maps to its own code.
    expect(sha(STORE_REL)).toBe('1319b7d86960f9c3');
    expect(sha('pages/api/execution-instances/[id].ts')).toBe('871dd7074f95e064');
  });

  it('032’s and 029’s certified artefacts are untouched by 034', () => {
    const crypto = require('crypto') as typeof import('crypto');
    const sha = (rel: string): string => crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 16);
    // RE-PINNED 2026-10-28 (renumbered migration; the store validates the journey
    // policy extensions). 029's targets / 030's producer land with the lists slice.
    expect(sha('supabase/migrations/20261227000000_pi_workflow_definitions.sql'))
      .toBe('099d274b241178c8'); // RE-PINNED 2026-10-28 (real-PostgreSQL verification): publish accepts the `internal` channel the validator allows
    expect(sha('backend/services/workflows/workflowStore.ts')).toBe('79d1df2478d2fe7f'); // RE-PINNED 2026-10-28 (social_post): additive social_post channel + optional step reference (20261231000004)
  });

  it('the idempotency middleware itself was not modified', () => {
    const mw = read(MIDDLEWARE_REL);
    // 034 ADOPTED this middleware; it did not change it. Asserted semantically:
    // the contract 034 relies on is present and unweakened.
    expect(mw).toMatch(/IDEMPOTENCY_KEY_REQUIRED/);
    expect(mw).toMatch(/IDEMPOTENCY_CONFLICT/);
    expect(mw).toMatch(/caller_id|callerId/);
    expect(mw).not.toMatch(/pi-execution-instance-invoke/);
  });

  it('034 CREATED NO PLAN, STEP, TASK OR MESSAGE ENTITY', () => {
    const dir = path.join(ROOT, 'supabase/migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);
    // The banned name is anchored to the TABLE-NAME position. An earlier form
    // used `CREATE TABLE[^;]*<name>`, where `[^;]*` reached across a whole
    // column list and flagged two legacy `bolt_failure_summary` migrations for a
    // word buried in their columns. `invocations?` was also dropped: it is a
    // plausible COLUMN name, so banning it as a table name is all that is meant.
    // `execution_plans`, `execution_plan_steps` and `execution_tasks` have left
    // this list: PI-036 created them under the ratified Plan/Step/Task contract.
    // The shapes nobody ratified stay banned, MESSAGE tables included — J-5 is
    // still deferred.
    const BANNED = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(execution_steps?|execution_contexts?|workflow_runs?|workflow_instances?|workflow_steps?|workflow_invocations?|execution_invocations?|message_versions?|message_templates?)\b/i;
    expect(files.filter((f) =>
      BANNED.test(fs.readFileSync(path.join(dir, f), 'utf8')))).toEqual([]);
    // Positive counterpart: the anchored form still catches the shape it is for.
    expect(BANNED.test('CREATE TABLE IF NOT EXISTS public.execution_contexts (')).toBe(true);
    expect(BANNED.test('CREATE TABLE workflow_invocations (')).toBe(true);
    expect(BANNED.test('CREATE TABLE public.message_versions (')).toBe(true);
    // ...and does NOT fire on the three tables 036 was authorized to create.
    expect(BANNED.test('CREATE TABLE IF NOT EXISTS public.execution_plans (')).toBe(false);
    expect(BANNED.test('CREATE TABLE IF NOT EXISTS public.execution_tasks (')).toBe(false);
    // ...and does NOT fire on a legitimate table that merely has such a column.
    expect(BANNED.test('CREATE TABLE public.bolt_failure_summary (\n  invocations int\n);'))
      .toBe(false);
  });
});
