/**
 * HARDEN-INT-002 (4) — Intelligence platform production smoke tests.
 *
 * Automated post-deploy verification of the INT stack against a REAL
 * environment. Answers, in order, the questions Production Runtime Validation
 * said could only be settled by running against a deployment:
 *
 *   1. migration      — does lead_intelligence_profiles exist?
 *   2. persistence    — can it be read?
 *   3. read:detail    — does the single-lead read API answer?
 *   4. read:bulk      — does the batched read answer?
 *   5. generation     — does a generation complete AND persist?
 *   6. fingerprint    — does an immediate re-run skip (no duplicate work)?
 *   7. freshness      — is the stale/pending backlog readable?
 *   8. rollback       — does the kill switch cleanly disable generation?
 *
 * Usage:
 *   npm run smoke:intelligence -- --company <companyId> [--lead <leadId>]
 *   npm run smoke:intelligence -- --company <companyId> --read-only
 *
 * WRITE BEHAVIOUR: steps 5 and 6 generate intelligence for ONE lead, which
 * upserts one row in lead_intelligence_profiles. That is the only write this
 * script performs. `--read-only` skips them (and 8), leaving the run purely
 * observational — use it for a first pass against production.
 *
 * Exit 0 = every executed check passed. Exit 1 = at least one failed.
 */

/* eslint-disable no-console */
try {
  // Load local env when present; deployed environments supply real env vars.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config({ path: '.env.local' });
} catch {
  /* dotenv optional */
}

type CheckStatus = 'pass' | 'fail' | 'skip';
interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  ms: number;
}

const results: CheckResult[] = [];

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (flag: string): boolean => process.argv.includes(flag);

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, status: 'pass', detail, ms: Date.now() - started });
    console.log(`  PASS  ${name.padEnd(24)} ${detail}`);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ name, status: 'fail', detail, ms: Date.now() - started });
    console.log(`  FAIL  ${name.padEnd(24)} ${detail}`);
  }
}

function skip(name: string, why: string): void {
  results.push({ name, status: 'skip', detail: why, ms: 0 });
  console.log(`  SKIP  ${name.padEnd(24)} ${why}`);
}

async function main(): Promise<void> {
  const companyId = arg('--company');
  const readOnly = hasFlag('--read-only');
  let leadId = arg('--lead');

  console.log('── INT platform smoke tests ──');
  if (!companyId) {
    console.log('\nRESULT: BLOCKED — --company <companyId> is required.\n');
    process.exit(1);
  }
  console.log(`company:   ${companyId}`);
  console.log(`mode:      ${readOnly ? 'read-only (no writes)' : 'full (generates 1 lead)'}\n`);

  const { ownedDbTable } = await import('../backend/db/writeOwner');
  const { getIntelligenceHealth } = await import('../backend/services/leadIntelligenceHealth');
  const { createLeadIntelligenceReadApi } = await import('../backend/services/leadIntelligenceReadApi');
  const { createLeadIntelligenceOrchestrator, ENGINE_VERSION } = await import(
    '../backend/services/leadIntelligenceOrchestration'
  );

  // 1 ── migration ---------------------------------------------------------
  await check('migration', async () => {
    const health = await getIntelligenceHealth(companyId);
    const migration = health.indicators.find((i) => i.name === 'migration');
    if (!migration || migration.status !== 'healthy') {
      throw new Error(migration?.detail ?? 'migration probe returned no result');
    }
    return `lead_intelligence_profiles present (engine ${health.engineVersion}, schema ${health.schemaVersion})`;
  });

  // 2 ── persistence read --------------------------------------------------
  await check('persistence:read', async () => {
    const { error } = await ownedDbTable('lead_intelligence_profiles')
      .select('lead_id')
      .eq('company_id', companyId)
      .limit(1);
    if (error) throw new Error(String((error as { message?: string }).message ?? error));
    return 'tenant-scoped read succeeded';
  });

  // Resolve a lead to exercise, if not supplied.
  if (!leadId) {
    const { data } = await ownedDbTable('leads')
      .select('id')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1);
    const row = Array.isArray(data) && data.length > 0 ? (data[0] as { id?: unknown }) : null;
    leadId = row?.id ? String(row.id) : undefined;
  }
  if (!leadId) {
    console.log('\nRESULT: BLOCKED — no lead found for this company; pass --lead <leadId>.\n');
    process.exit(1);
  }
  console.log(`lead:      ${leadId}\n`);

  const readApi = createLeadIntelligenceReadApi();

  // 3 ── read: detail ------------------------------------------------------
  await check('read:detail', async () => {
    const view = await readApi.getLeadIntelligenceView(companyId, leadId as string);
    if (view.companyId !== companyId || view.leadId !== leadId) throw new Error('read returned mismatched identifiers');
    if (!['available', 'never_generated'].includes(view.status)) throw new Error(`unexpected status ${view.status}`);
    return `status=${view.status} freshness=${view.freshness}`;
  });

  // 4 ── read: bulk --------------------------------------------------------
  await check('read:bulk', async () => {
    const items = await readApi.getLeadIntelligenceListItems(companyId, [leadId as string]);
    if (items.length !== 1) throw new Error(`expected 1 item, received ${items.length}`);
    if (items[0].leadId !== leadId) throw new Error('bulk read returned the wrong lead');
    return `1 item, status=${items[0].status}`;
  });

  // 5/6 ── generation + fingerprint skip -----------------------------------
  if (readOnly) {
    skip('generation', '--read-only');
    skip('fingerprint:skip', '--read-only');
    skip('rollback:killswitch', '--read-only');
  } else {
    const orchestrator = createLeadIntelligenceOrchestrator();

    await check('generation', async () => {
      const result = await orchestrator.generate({ companyId, leadId: leadId as string }, { force: true });
      if (result.status === 'failed') throw new Error(result.error ?? 'generation failed');
      if (!result.persisted) throw new Error(`computed but NOT persisted: ${result.warnings.join('; ') || 'unknown'}`);
      if (result.record?.engineVersion !== ENGINE_VERSION) {
        throw new Error(`persisted engine ${result.record?.engineVersion}, expected ${ENGINE_VERSION}`);
      }
      return `generated v${result.record?.generationVersion} in ${result.record?.diagnostics.durationMs ?? '?'}ms, persisted`;
    });

    await check('fingerprint:skip', async () => {
      const again = await orchestrator.generate({ companyId, leadId: leadId as string });
      if (again.status !== 'skipped_unchanged') {
        throw new Error(`expected skipped_unchanged, received ${again.status} — the fingerprint skip is not engaging`);
      }
      return 'immediate re-run skipped (no duplicate work)';
    });

    // 8 ── rollback: the kill switch must cleanly disable generation --------
    await check('rollback:killswitch', async () => {
      const { runLeadIntelligenceGeneration } = await import('../backend/services/leadIntelligenceActivation');
      const previous = process.env.LEAD_INTELLIGENCE_GENERATION_DISABLED;
      process.env.LEAD_INTELLIGENCE_GENERATION_DISABLED = 'true';
      try {
        const outcome = await runLeadIntelligenceGeneration(companyId, leadId as string, 'lead_captured');
        if (outcome !== 'disabled') throw new Error(`kill switch ineffective — outcome was ${outcome}`);
      } finally {
        if (previous === undefined) delete process.env.LEAD_INTELLIGENCE_GENERATION_DISABLED;
        else process.env.LEAD_INTELLIGENCE_GENERATION_DISABLED = previous;
      }
      // Reads must keep serving persisted intelligence while generation is off.
      const view = await readApi.getLeadIntelligenceView(companyId, leadId as string);
      if (view.status !== 'available') throw new Error('reads stopped serving while generation was disabled');
      return 'generation disabled cleanly; reads unaffected';
    });
  }

  // 7 ── freshness ---------------------------------------------------------
  await check('freshness', async () => {
    const health = await getIntelligenceHealth(companyId);
    const freshness = health.indicators.find((i) => i.name === 'freshness');
    if (!freshness || freshness.status === 'unknown') {
      throw new Error(freshness?.detail ?? 'freshness probe returned no result');
    }
    return freshness.detail;
  });

  // ── summary --------------------------------------------------------------
  const failed = results.filter((r) => r.status === 'fail');
  const passed = results.filter((r) => r.status === 'pass');
  const skipped = results.filter((r) => r.status === 'skip');
  console.log(
    `\n${passed.length} passed · ${failed.length} failed · ${skipped.length} skipped ` +
      `(${results.reduce((a, r) => a + r.ms, 0)}ms)\n`,
  );
  if (failed.length > 0) {
    console.log('RESULT: FAILED');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    console.log('');
    process.exit(1);
  }
  console.log('RESULT: PASS — Intelligence platform verified against this environment.\n');
  process.exit(0);
}

main().catch((e) => {
  console.error(`\nRESULT: ERROR — ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});

// RELEASE-INT-001: this file loads everything through `require`/dynamic
// `await import()`, so without a top-level import or export TypeScript treats
// it as a GLOBAL script — its `main` (and `arg`/`check`/`skip`) then collide
// with the same names in other scripts, which is what raised TS2393 above the
// typecheck baseline. Declaring it a module scopes those names to this file.
// Runtime is unchanged: no static import is added and `main()` still runs on
// execution above.
export {};
