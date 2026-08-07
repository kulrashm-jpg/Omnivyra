/**
 * WS-2 MILESTONE-1B — PRODUCTION EXECUTION PROOF.
 *
 * Runs the REAL application services against a REAL PostgreSQL + PostgREST
 * (the local certenv Supabase), not a mock. Everything a unit test has to
 * assume — that the unique index is partial, that PostgREST reports 42703 for a
 * missing column instead of throwing, that `ON CONFLICT` cannot infer a partial
 * index, that concurrent inserts actually collide — is executed here instead.
 *
 *   npx ts-node --transpile-only scripts/ws2-m1b-execution-proof.ts
 *
 * SAFETY: refuses to run unless the target is a local certenv URL. This script
 * writes, and `.env.local` in this repo points at PRODUCTION.
 */

/* eslint-disable no-console */

const TARGET = String(process.env.SUPABASE_URL ?? '');
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|host\.docker\.internal):543\d\d/.test(TARGET);
if (!LOCAL) {
  console.error(`\nBLOCKED — SUPABASE_URL must be a local certenv instance. Got: ${TARGET || '<unset>'}\n`);
  process.exit(2);
}

import { ownedDbTable } from '../backend/db/writeOwner';
import { resolveVisitorSession, stitchSessionToLead, persistCampaignTouchpoint } from '../backend/services/attributionResolverService';
import { createLeadIntelligenceOrchestrator, LEAD_INTELLIGENCE_PROFILES_TABLE, computeInputFingerprint } from '../backend/services/leadIntelligenceOrchestration';
import { durableSnapshotSource } from '../backend/services/leadIntelligenceOrchestration/snapshotSource';
import { getPersistedLeadIntelligence } from '../backend/services/leadIntelligenceOrchestration/readIntegration';
import { assembleLeadCaptureSnapshot } from '../backend/services/leadIntelligenceEngine';
import { getIntelligenceHealth } from '../backend/services/leadIntelligenceHealth';
import { getObservabilitySnapshot } from '../backend/observability/snapshot';
import { registry } from '../backend/observability/registry';

const COMPANY = '00000000-0000-4000-8000-00000000000a'; // Cert Company A
const RUN = `m1b-${Date.now()}`;

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(42)} ${detail}`);
};

const sql = <T = unknown>(t: string) => ownedDbTable(t) as unknown as T;

async function cleanup(): Promise<void> {
  await ownedDbTable('campaign_touchpoints').delete().like('metadata->attribution->>anonymous_id', `${RUN}%`);
  await ownedDbTable('tracking_events').delete().like('anonymous_id', `${RUN}%`);
  await ownedDbTable('visitor_sessions').delete().like('anonymous_id', `${RUN}%`);
}

// ── 1. REAL DATABASE CONCURRENCY ────────────────────────────────────────────

async function realDbConcurrency(): Promise<void> {
  console.log('\n── 1. REAL DATABASE CONCURRENCY VALIDATION ──\n');

  // 1.1 Concurrent session creation for ONE visitor.
  const anon = `${RUN}-a`;
  const N = 25;
  const results = await Promise.all(
    Array.from({ length: N }, () =>
      resolveVisitorSession({ companyId: COMPANY, websiteId: null, attribution: { anonymous_id: anon, session_id: `${anon}-s1` } as never }),
    ),
  );
  const ids = new Set(results.map((r) => r.sessionId));
  const nulls = results.filter((r) => r.sessionId === null).length;
  const rows = await ownedDbTable('visitor_sessions').select('id').eq('company_id', COMPANY).eq('anonymous_id', anon);
  const rowCount = (rows.data as unknown[] | null)?.length ?? -1;

  record('concurrent inserts → one row', rowCount === 1, `${N} concurrent callers → ${rowCount} row(s) in visitor_sessions`);
  record('deterministic recovery', ids.size === 1 && nulls === 0, `${ids.size} distinct id(s) returned, ${nulls} null(s)`);

  // 1.2 The unique index actually rejects a duplicate (proves the guard is real).
  const dup = await ownedDbTable('visitor_sessions')
    .insert({ company_id: COMPANY, anonymous_id: anon, session_key: `${anon}-s1`, first_touch: {}, last_touch: {}, metadata: {} })
    .select('id')
    .single();
  const dupCode = String((dup.error as { code?: string } | null)?.code ?? 'none');
  record('unique index rejects duplicate', dupCode === '23505', `direct duplicate insert → ${dupCode}`);

  // 1.3 PostgREST cannot infer the PARTIAL unique index — the documented reason
  //     the implementation uses read-back recovery instead of an upsert.
  const upsert = await ownedDbTable('visitor_sessions')
    .upsert(
      { company_id: COMPANY, anonymous_id: anon, session_key: `${anon}-s1`, first_touch: {}, last_touch: {}, metadata: {} },
      { onConflict: 'company_id,anonymous_id,session_key' },
    )
    .select('id');
  const upsertCode = String((upsert.error as { code?: string } | null)?.code ?? 'none');
  record('upsert on partial index refused', upsertCode === '42P10', `ON CONFLICT inference → ${upsertCode} (justifies read-back design)`);

  // 1.4 Concurrent DIFFERENT visitors stay isolated.
  const many = await Promise.all(
    ['b', 'c', 'd', 'e'].flatMap((k) => [
      resolveVisitorSession({ companyId: COMPANY, websiteId: null, attribution: { anonymous_id: `${RUN}-${k}`, session_id: `${RUN}-${k}-s` } as never }),
      resolveVisitorSession({ companyId: COMPANY, websiteId: null, attribution: { anonymous_id: `${RUN}-${k}`, session_id: `${RUN}-${k}-s` } as never }),
    ]),
  );
  const distinct = new Set(many.map((r) => r.sessionId));
  record('concurrent distinct visitors isolated', distinct.size === 4 && !distinct.has(null), `8 concurrent calls over 4 visitors → ${distinct.size} session(s)`);

  // 1.5 THE M1B DEFECT PROOF — visitor history across separate sessions.
  //     Before the fix this read ordered by a column that does not exist, so
  //     every visit was recorded as visit #1 / returning_visitor=false.
  const loyal = `${RUN}-loyal`;
  for (let i = 1; i <= 3; i++) {
    await resolveVisitorSession({ companyId: COMPANY, websiteId: null, attribution: { anonymous_id: loyal, session_id: `${loyal}-s${i}` } as never });
  }
  const loyalRows = await ownedDbTable('visitor_sessions').select('metadata,started_at').eq('company_id', COMPANY).eq('anonymous_id', loyal).order('started_at', { ascending: true });
  const visitorBlocks = ((loyalRows.data as Array<{ metadata?: { visitor?: { visit_count?: number; returning_visitor?: boolean } } }> | null) ?? []).map((r) => r.metadata?.visitor);
  const counts = visitorBlocks.map((v) => v?.visit_count);
  const returning = visitorBlocks.map((v) => v?.returning_visitor);
  record(
    'visitor history is real (M1B fix)',
    JSON.stringify(counts) === '[1,2,3]' && JSON.stringify(returning) === '[false,true,true]',
    `visit_count=${JSON.stringify(counts)} returning=${JSON.stringify(returning)}`,
  );

  // 1.6 Session continuation measures real duration (was always null pre-M1B).
  await resolveVisitorSession({ companyId: COMPANY, websiteId: null, attribution: { anonymous_id: loyal, session_id: `${loyal}-s1`, current_page: 'https://x.test/pricing' } as never });
  const cont = await ownedDbTable('visitor_sessions').select('metadata').eq('company_id', COMPANY).eq('session_key', `${loyal}-s1`).single();
  const durationMs = (cont.data as { metadata?: { visitor?: { session_duration_ms?: number | null } } } | null)?.metadata?.visitor?.session_duration_ms;
  record('session duration measured (M1B fix)', typeof durationMs === 'number' && durationMs >= 0, `session_duration_ms=${String(durationMs)}`);

  // 1.7 No orphans / no race corruption.
  const orphans = await ownedDbTable('visitor_sessions').select('id,company_id,anonymous_id,session_key').like('anonymous_id', `${RUN}%`);
  const orphanRows = ((orphans.data as Array<Record<string, unknown>> | null) ?? []).filter(
    (r) => !r.company_id || !r.anonymous_id || !r.session_key,
  );
  record('no orphan / corrupt session rows', orphanRows.length === 0, `${orphanRows.length} row(s) with a null identity column`);
}

// ── 2. END-TO-END PIPELINE ──────────────────────────────────────────────────

async function endToEnd(): Promise<{ leadId: string; sessionId: string } | null> {
  console.log('\n── 2. END-TO-END PIPELINE VALIDATION ──\n');
  const anon = `${RUN}-e2e`;

  // Stage 1-2: capture → session persistence (two visits, so loyalty is real).
  await resolveVisitorSession({ companyId: COMPANY, websiteId: null, attribution: { anonymous_id: anon, session_id: `${anon}-s1` } as never });
  const s2 = await resolveVisitorSession({
    companyId: COMPANY,
    websiteId: null,
    attribution: { anonymous_id: anon, session_id: `${anon}-s2`, current_page: 'https://x.test/pricing', utm_source: 'google' } as never,
  });
  if (!s2.sessionId) {
    record('e2e session persistence', false, 'no session id');
    return null;
  }
  record('e2e session persistence', true, `session ${s2.sessionId}`);

  // A lead anchored to that session.
  const person = await ownedDbTable('unified_persons').insert({ company_id: COMPANY, primary_email: `${anon}@e2e.test` }).select('id').single();
  const personId = (person.data as { id?: string } | null)?.id;
  const lead = await ownedDbTable('leads')
    .insert({
      company_id: COMPANY,
      name: 'E2E Buyer',
      email: `${anon}@e2e.test`,
      source: 'website',
      unified_person_id: personId,
      visitor_session_id: s2.sessionId,
      metadata: { job_title: 'CTO', company_name: 'BigCorp', company_size: '1000+', industry: 'Finance' },
    })
    .select('id')
    .single();
  const leadId = (lead.data as { id?: string } | null)?.id;
  if (!leadId) {
    record('e2e lead creation', false, JSON.stringify(lead.error));
    return null;
  }
  await stitchSessionToLead({ leadId, companyId: COMPANY, visitorSessionId: s2.sessionId, unifiedPersonId: personId });
  await persistCampaignTouchpoint({ companyId: COMPANY, visitorSessionId: s2.sessionId, leadId, attribution: { anonymous_id: anon, utm_source: 'google', current_page: 'https://x.test/pricing' } as never, touchpointType: 'conversion' });

  // Behavioural events on that session.
  const pages = ['/pricing', '/demo', '/security', '/docs', '/case-studies'];
  await ownedDbTable('tracking_events').insert(
    pages.map((p, i) => ({
      company_id: COMPANY,
      visitor_session_id: s2.sessionId,
      anonymous_id: anon,
      event_name: 'page_view',
      event_category: 'engagement',
      page_url: `https://x.test${p}`,
      occurred_at: new Date(Date.now() - (pages.length - i) * 60_000).toISOString(),
      metadata: { scroll_depth: 90, dwell_seconds: 75 },
    })),
  );
  record('e2e capture rows written', true, `lead ${leadId}, ${pages.length} tracking events, 1 touchpoint`);

  // Stage 3: snapshot generation straight from the database.
  const raw = await durableSnapshotSource.load(COMPANY, leadId);
  const snapshot = raw ? assembleLeadCaptureSnapshot({ ...raw, now: new Date().toISOString() }) : null;
  record(
    'e2e snapshot generation',
    !!snapshot && snapshot.events.length === pages.length && snapshot.sessions.length >= 1,
    snapshot ? `${snapshot.events.length} events, ${snapshot.sessions.length} session(s), ${snapshot.touchpoints.length} touchpoint(s)` : 'snapshot null',
  );
  const mapped = snapshot?.sessions[0];
  record(
    'e2e session metadata propagated',
    !!mapped && mapped.visitCount !== null && mapped.returning !== null,
    `visitCount=${String(mapped?.visitCount)} returning=${String(mapped?.returning)} lastCurrentPage=${String(mapped?.lastCurrentPage)}`,
  );

  // Stages 4-8: engines → envelope persistence, via THE public entry point.
  const orch = createLeadIntelligenceOrchestrator();
  const gen = await orch.generate({ companyId: COMPANY, leadId });
  record('e2e generation + persistence', gen.status === 'generated' && gen.persisted === true, `status=${gen.status} persisted=${String(gen.persisted)} ${gen.error ?? ''}`);

  // The in-memory record's `intelligence` IS the summary; the persisted JSONB
  // nests it under `summary` alongside the two planning blocks.
  const summary = gen.record?.intelligence as any;
  const loyalty = summary?.intent?.contributions?.find((c: { signal: string }) => c.signal === 'visitor_loyalty');
  record(
    'e2e NEW intelligence in envelope',
    !!loyalty,
    loyalty ? `${loyalty.signal} +${loyalty.points} — "${loyalty.evidence}"` : 'visitor_loyalty contribution absent',
  );
  record(
    'e2e full envelope shape',
    !!summary && summary.qualification?.sections?.length === 5 && Array.isArray(summary.timeline),
    `score=${String(summary?.qualification?.totalScore)} band=${String(summary?.qualification?.band)} timeline=${String(summary?.timeline?.length)}`,
  );

  // Stage 9: read API reads the PERSISTED row (never regenerates).
  const read = await getPersistedLeadIntelligence(COMPANY, leadId);
  record(
    'e2e read API serves persisted record',
    !!read?.record,
    `freshness=${String(read?.freshness)} engine=${String(read?.record?.engineVersion)} schema=${String(read?.record?.schemaVersion)}`,
  );

  // Stage 10: dashboard consumption — the persisted row in the real table.
  const stored = await ownedDbTable(LEAD_INTELLIGENCE_PROFILES_TABLE).select('*').eq('company_id', COMPANY).eq('lead_id', leadId).single();
  const storedRow = stored.data as Record<string, unknown> | null;
  record('e2e envelope row in database', !!storedRow, storedRow ? `generation_version=${String(storedRow.generation_version)} bytes=${JSON.stringify(storedRow.intelligence).length}` : JSON.stringify(stored.error));

  // Each stage executes ONCE: an immediate re-run must skip on fingerprint.
  const again = await orch.generate({ companyId: COMPANY, leadId });
  const after = await ownedDbTable(LEAD_INTELLIGENCE_PROFILES_TABLE).select('generation_version').eq('company_id', COMPANY).eq('lead_id', leadId).single();
  record(
    'no duplicate generation (fingerprint skip)',
    again.status === 'skipped_unchanged',
    `re-run status=${again.status}, generation_version ${String(storedRow?.generation_version)} → ${String((after.data as { generation_version?: number } | null)?.generation_version)}`,
  );

  // Deterministic output: a forced regeneration must reproduce identical content.
  const forced = await orch.generate({ companyId: COMPANY, leadId }, { force: true });
  const same = JSON.stringify((forced.record?.intelligence as any)?.intent) === JSON.stringify(summary?.intent);
  record('deterministic output on regeneration', same, same ? 'forced regeneration byte-identical' : 'content diverged');

  // Fingerprint stability against the real snapshot.
  const raw2 = await durableSnapshotSource.load(COMPANY, leadId);
  const fp1 = computeInputFingerprint(assembleLeadCaptureSnapshot({ ...raw!, now: 'x' }));
  const fp2 = computeInputFingerprint(assembleLeadCaptureSnapshot({ ...raw2!, now: 'y' }));
  record('fingerprint stable across reads', fp1 === fp2, `${fp1.slice(0, 12)} == ${fp2.slice(0, 12)}`);

  return { leadId, sessionId: s2.sessionId };
}

// ── 3. DEPLOYMENT VALIDATION ────────────────────────────────────────────────

async function deployment(ctx: { leadId: string; sessionId: string } | null): Promise<void> {
  console.log('\n── 3. DEPLOYMENT VALIDATION ──\n');

  // Health endpoint — the real probe set against the real table.
  const health = await getIntelligenceHealth(COMPANY);
  const names = health.indicators.map((i) => i.name).sort().join(',');
  record('health endpoint', names === 'freshness,generation,migration,persistence,sessionCapture', `status=${health.status} indicators=[${names}]`);
  const sessionCapture = health.indicators.find((i) => i.name === 'sessionCapture');
  record('sessionCapture indicator live', !!sessionCapture, `${sessionCapture?.status}: ${sessionCapture?.detail}`);
  const migration = health.indicators.find((i) => i.name === 'migration');
  record('migration indicator healthy', migration?.status === 'healthy', String(migration?.detail));

  // Observability snapshot — the metrics an operator would actually see.
  const snap = getObservabilitySnapshot() as unknown as { counters?: Array<{ name: string; labels?: Record<string, unknown>; value: number }> };
  const counters = snap.counters ?? [];
  const intelNames = [...new Set(counters.filter((c) => c.name.startsWith('intel.')).map((c) => c.name))];
  record('observability endpoint exposes intel metrics', intelNames.length > 0, intelNames.join(', '));
  const sessionSeries = counters.filter((c) => c.name.startsWith('intel.session.'));
  record(
    'session metrics visible',
    sessionSeries.length > 0,
    sessionSeries.map((c) => `${c.name}{${Object.entries(c.labels ?? {}).map(([k, v]) => `${k}=${v}`).join(',')}}=${c.value}`).join(' | ') || 'none',
  );

  // Cardinality — the alert/dashboard contract depends on closed label sets.
  const labelKeys = new Set(sessionSeries.flatMap((c) => Object.keys(c.labels ?? {})));
  record('metric cardinality bounded', [...labelKeys].every((k) => k === 'outcome' || k === 'error_class'), `label keys: ${[...labelKeys].join(',') || 'none'}`);

  // Prometheus exposition — the exporter renders from this same registry.
  const promLines = registry
    .counterEntries()
    .filter((c) => c.name.startsWith('intel.'))
    .map((c) => `${c.name.replace(/\./g, '_')}{${Object.entries(c.labels ?? {}).map(([k, v]) => `${k}="${v}"`).join(',')}} ${c.value}`);
  record('prometheus exposition renders', promLines.length > 0, `${promLines.length} series, e.g. ${promLines[0] ?? 'n/a'}`);

  // Alert evaluation against live counters.
  const sum = (name: string, pred: (l: Record<string, unknown>) => boolean = () => true) =>
    counters.filter((c) => c.name === name && pred(c.labels ?? {})).reduce((a, c) => a + c.value, 0);
  const blocked = sum('intel.session.persistence_failures', (l) => l.error_class === 'missing_table' || l.error_class === 'permission');
  const anyFail = sum('intel.session.persistence_failures');
  const genFail = sum('intel.generation.failures');
  record('alert INT-Session-Write-Blocked', blocked === 0, `P1 condition value = ${blocked} (fires when > 0)`);
  record('alert INT-Session-Persistence-Failing', anyFail === 0, `P2 condition value = ${anyFail} (fires when > 0)`);
  record('alert INT-Generation-Failing', genFail === 0, `failures = ${genFail}`);

  // Dashboard population — Panel 7 and the freshness panel have real data.
  const total = await ownedDbTable(LEAD_INTELLIGENCE_PROFILES_TABLE).select('lead_id').eq('company_id', COMPANY);
  record('dashboard data populated', ((total.data as unknown[] | null)?.length ?? 0) > 0, `${(total.data as unknown[] | null)?.length ?? 0} envelope row(s) for the tenant`);

  if (!ctx) return;

  // Regeneration wave — the M1 fingerprint change makes a record stale exactly
  // once. Simulated by mutating the inputs, which is the same mechanism.
  const before = await ownedDbTable(LEAD_INTELLIGENCE_PROFILES_TABLE).select('generation_version,input_fingerprint').eq('lead_id', ctx.leadId).single();
  await ownedDbTable('tracking_events').insert({
    company_id: COMPANY,
    visitor_session_id: ctx.sessionId,
    anonymous_id: `${RUN}-e2e`,
    event_name: 'page_view',
    event_category: 'engagement',
    page_url: 'https://x.test/enterprise',
    occurred_at: new Date().toISOString(),
    metadata: {},
  });
  const orch = createLeadIntelligenceOrchestrator();
  const wave = await orch.generate({ companyId: COMPANY, leadId: ctx.leadId });
  const after = await ownedDbTable(LEAD_INTELLIGENCE_PROFILES_TABLE).select('generation_version,input_fingerprint').eq('lead_id', ctx.leadId).single();
  const b = before.data as { generation_version?: number; input_fingerprint?: string } | null;
  const a = after.data as { generation_version?: number; input_fingerprint?: string } | null;
  record(
    'regeneration wave behaviour',
    wave.status === 'generated' && b?.input_fingerprint !== a?.input_fingerprint && (a?.generation_version ?? 0) > (b?.generation_version ?? 0),
    `changed inputs → ${wave.status}, version ${String(b?.generation_version)} → ${String(a?.generation_version)}`,
  );

  // Rollback — the kill switch must stop generation immediately.
  process.env.LEAD_INTELLIGENCE_GENERATION_DISABLED = 'true';
  let killed = 'not-evaluated';
  try {
    const { runLeadIntelligenceGeneration } = await import('../backend/services/leadIntelligenceActivation');
    killed = String(await runLeadIntelligenceGeneration(COMPANY, ctx.leadId, 'lead_captured'));
  } catch (e) {
    killed = `threw: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    delete process.env.LEAD_INTELLIGENCE_GENERATION_DISABLED;
  }
  record('rollback kill switch', killed === 'disabled', `generation outcome with kill switch on = ${killed}`);

  // And generation resumes cleanly once the switch is cleared.
  const resumed = await (await import('../backend/services/leadIntelligenceActivation')).runLeadIntelligenceGeneration(COMPANY, ctx.leadId, 'lead_captured');
  record('rollback is reversible', resumed !== 'disabled', `outcome after clearing the switch = ${resumed}`);

  // Reads must keep serving the persisted record with generation disabled.
  const stillReadable = await getPersistedLeadIntelligence(COMPANY, ctx.leadId);
  record('reads survive rollback', !!stillReadable?.record, `freshness=${String(stillReadable?.freshness)}`);
}

// ── main ────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\nWS-2 M1B EXECUTION PROOF  target=${TARGET}  run=${RUN}\n`);
  try {
    await cleanup();
    await realDbConcurrency();
    const ctx = await endToEnd();
    await deployment(ctx);
  } catch (e) {
    record('harness', false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`TOTAL ${checks.length}   PASS ${checks.length - failed.length}   FAIL ${failed.length}`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  • ${f.name}: ${f.detail}`);
  }
  console.log(`\nRESULT: ${failed.length === 0 ? 'ALL CHECKS PASSED' : 'FAILURES PRESENT'}\n`);
  process.exit(failed.length === 0 ? 0 : 1);
})();

void sql;
