/**
 * WS-2 MILESTONE-1 FINALIZATION — operational baseline collection.
 *
 * Produces the EVIDENCE the alert thresholds and monitoring guidance are
 * derived from, and proves the historical-transition behaviour that the
 * rollout documentation describes. Runs realistic traffic against the real
 * database; measures, never asserts from assumption.
 *
 *   npx tsx scripts/ws2-m1-operational-baseline.ts
 *
 * SAFETY: local certenv only. This script writes.
 */

/* eslint-disable no-console */

const TARGET = String(process.env.SUPABASE_URL ?? '');
if (!/^https?:\/\/(127\.0\.0\.1|localhost):543\d\d/.test(TARGET)) {
  console.error(`\nBLOCKED — SUPABASE_URL must be a local certenv instance. Got: ${TARGET || '<unset>'}\n`);
  process.exit(2);
}

import { ownedDbTable } from '../backend/db/writeOwner';
import { resolveVisitorSession, stitchSessionToLead } from '../backend/services/attributionResolverService';
import { createLeadIntelligenceOrchestrator, LEAD_INTELLIGENCE_PROFILES_TABLE } from '../backend/services/leadIntelligenceOrchestration';
import { getIntelligenceHealth } from '../backend/services/leadIntelligenceHealth';
import { registry } from '../backend/observability/registry';

const COMPANY = '00000000-0000-4000-8000-00000000000a';
const RUN = `base-${Date.now()}`;

const counters = () => registry.counterEntries();
const sum = (name: string, pred: (l: Record<string, unknown>) => boolean = () => true): number =>
  counters().filter((c) => c.name === name && pred((c.labels ?? {}) as Record<string, unknown>)).reduce((a, c) => a + c.value, 0);

const pct = (n: number, d: number): string => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`);

const findings: string[] = [];
const note = (line: string) => {
  findings.push(line);
  console.log(line);
};

async function seedLead(tag: string, events: number, opts: { legacySession?: boolean } = {}): Promise<{ leadId: string; sessionId: string; anon: string; personId: string | null }> {
  const anon = `${RUN}-${tag}`;
  const s = await resolveVisitorSession({
    companyId: COMPANY,
    websiteId: null,
    attribution: { anonymous_id: anon, session_id: `${anon}-s1`, current_page: 'https://x.test/pricing', utm_source: 'google' } as never,
  });
  const sessionId = s.sessionId as string;

  if (opts.legacySession) {
    // Reproduce a PRE-M1B production row: the visitor block was never written
    // (the history read was answering 42703 and returning fabricated data that
    // the caller discarded), so historical rows carry no durable loyalty.
    await ownedDbTable('visitor_sessions').update({ metadata: {} }).eq('id', sessionId);
  }

  const person = await ownedDbTable('unified_persons').insert({ company_id: COMPANY, primary_email: `${anon}@base.test` }).select('id').single();
  const personId = (person.data as { id?: string } | null)?.id ?? null;
  const lead = await ownedDbTable('leads')
    .insert({
      company_id: COMPANY,
      name: `Baseline ${tag}`,
      email: `${anon}@base.test`,
      source: 'website',
      unified_person_id: personId,
      visitor_session_id: sessionId,
      metadata: { job_title: 'CTO', company_name: 'BigCorp', company_size: '1000+', industry: 'Finance' },
    })
    .select('id')
    .single();
  const leadId = (lead.data as { id?: string } | null)?.id as string;

  // The real capture path stitches the session to the unified person; the
  // snapshot loader reads sessions by unified_person_id whenever the lead has
  // one, so WITHOUT this step a lead loads zero sessions and every durable
  // visitor signal silently disappears. Mirrored here deliberately.
  await stitchSessionToLead({ leadId, companyId: COMPANY, visitorSessionId: sessionId, unifiedPersonId: personId });

  const pages = ['/pricing', '/demo', '/security', '/docs', '/case-studies', '/enterprise', '/integrations'];
  if (events > 0) {
    await ownedDbTable('tracking_events').insert(
      Array.from({ length: events }, (_, i) => ({
        company_id: COMPANY,
        visitor_session_id: sessionId,
        anonymous_id: anon,
        event_name: 'page_view',
        event_category: 'engagement',
        page_url: `https://x.test${pages[i % pages.length]}`,
        occurred_at: new Date(Date.now() - (events - i) * 30_000).toISOString(),
        metadata: { scroll_depth: 85, dwell_seconds: 60 },
      })),
    );
  }
  return { leadId, sessionId, anon, personId };
}

const loyaltyOf = (rec: unknown): { points: number; evidence: string } | null => {
  const contributions = (rec as { intelligence?: { intent?: { contributions?: Array<{ signal: string; points: number; evidence: string }> } } })?.intelligence?.intent?.contributions ?? [];
  const c = contributions.find((x) => x.signal === 'visitor_loyalty');
  return c ? { points: c.points, evidence: c.evidence } : null;
};

// ── 1. HISTORICAL TRANSITION ────────────────────────────────────────────────

async function historicalTransition(): Promise<void> {
  console.log('\n── 1. HISTORICAL DATA TRANSITION ──\n');
  const orch = createLeadIntelligenceOrchestrator();

  // (a) A historical record: session persisted BEFORE the M1B fix.
  const legacy = await seedLead('legacy', 6, { legacySession: true });
  void legacy.personId;
  const g1 = await orch.generate({ companyId: COMPANY, leadId: legacy.leadId });
  const fp1 = (g1.record as { inputFingerprint?: string } | undefined)?.inputFingerprint;
  note(`historical record          : status=${g1.status} loyalty=${loyaltyOf(g1.record) ? 'present' : 'ABSENT (expected)'} score=${String((g1.record as any)?.intelligence?.qualification?.totalScore)}`);
  note(`historical record          : complete envelope anyway — sections=${String((g1.record as any)?.intelligence?.qualification?.sections?.length)}, timeline=${String((g1.record as any)?.intelligence?.timeline?.length)}`);

  // (b) Steady state: nothing changed → skipped. A historical record does NOT
  //     regenerate on its own just because the code shipped.
  const g2 = await orch.generate({ companyId: COMPANY, leadId: legacy.leadId });
  note(`historical, no new visit   : status=${g2.status} (no self-triggered regeneration)`);

  // (c) The visitor RETURNS after deploy → the corrected history read writes a
  //     real visitor block → the fingerprint moves → loyalty appears.
  const legacyVisit2 = await resolveVisitorSession({
    companyId: COMPANY,
    websiteId: null,
    attribution: { anonymous_id: legacy.anon, session_id: `${legacy.anon}-s2`, current_page: 'https://x.test/demo' } as never,
  });
  await stitchSessionToLead({ leadId: legacy.leadId, companyId: COMPANY, visitorSessionId: legacyVisit2.sessionId, unifiedPersonId: legacy.personId });
  const sessionRows = await ownedDbTable('visitor_sessions').select('metadata').eq('company_id', COMPANY).eq('anonymous_id', legacy.anon).order('started_at', { ascending: true });
  const visitBlocks = ((sessionRows.data as Array<{ metadata?: { visitor?: { visit_count?: number } } }> | null) ?? []).map((r) => r.metadata?.visitor?.visit_count ?? null);
  note(`returning visitor          : visit_count per session = ${JSON.stringify(visitBlocks)} (historical session stays null — not backfilled)`);

  // The lead is still anchored to its ORIGINAL session, which is how a real
  // returning visitor behaves until identity stitching links the new one.
  const g3 = await orch.generate({ companyId: COMPANY, leadId: legacy.leadId }, { force: true });
  const fp3 = (g3.record as { inputFingerprint?: string } | undefined)?.inputFingerprint;
  note(`after return + regeneration: loyalty=${loyaltyOf(g3.record) ? `present (${loyaltyOf(g3.record)!.evidence})` : 'still absent — anchored to the historical session'} fingerprintChanged=${String(fp1 !== fp3)}`);

  // (d) A NEW visitor captured after deploy gets loyalty on their second visit.
  const fresh = await seedLead('fresh', 6);
  const visit2 = await resolveVisitorSession({ companyId: COMPANY, websiteId: null, attribution: { anonymous_id: fresh.anon, session_id: `${fresh.anon}-s2`, current_page: 'https://x.test/pricing' } as never });
  await stitchSessionToLead({ leadId: fresh.leadId, companyId: COMPANY, visitorSessionId: visit2.sessionId, unifiedPersonId: fresh.personId });
  const g4 = await orch.generate({ companyId: COMPANY, leadId: fresh.leadId }, { force: true });
  const l4 = loyaltyOf(g4.record);
  note(`post-deploy visitor        : loyalty=${l4 ? `present — "${l4.evidence}" (+${l4.points})` : 'absent'}`);

  // (e) The one-time regeneration wave: an input change makes the record stale
  //     exactly once, then it settles back to skipping.
  await ownedDbTable('tracking_events').insert({
    company_id: COMPANY, visitor_session_id: fresh.sessionId, anonymous_id: fresh.anon,
    event_name: 'page_view', event_category: 'engagement', page_url: 'https://x.test/enterprise',
    occurred_at: new Date().toISOString(), metadata: {},
  });
  const w1 = await orch.generate({ companyId: COMPANY, leadId: fresh.leadId });
  const w2 = await orch.generate({ companyId: COMPANY, leadId: fresh.leadId });
  note(`regeneration wave shape    : changed→${w1.status}, then→${w2.status} (one write, then settles)`);
}

// ── 2. BASELINE TELEMETRY ───────────────────────────────────────────────────

async function baseline(): Promise<void> {
  console.log('\n── 2. BASELINE TELEMETRY (healthy system, realistic traffic) ──\n');
  registry.reset();
  const orch = createLeadIntelligenceOrchestrator();

  // Realistic mixed workload: 8 leads of varying event volume.
  const sizes = [3, 8, 15, 25, 40, 60, 90, 120];
  const leads: string[] = [];
  const bytes: number[] = [];
  const durations: number[] = [];

  for (const [i, n] of sizes.entries()) {
    const seeded = await seedLead(`w${i}`, n);
    leads.push(seeded.leadId);
    const t0 = process.hrtime.bigint();
    const g = await orch.generate({ companyId: COMPANY, leadId: seeded.leadId });
    durations.push(Number(process.hrtime.bigint() - t0) / 1e6);
    if (g.record) bytes.push(Buffer.byteLength(JSON.stringify(g.record.intelligence)));
  }

  // Steady state: every lead triggered 3 more times with unchanged inputs.
  for (let round = 0; round < 3; round++) {
    for (const leadId of leads) await orch.generate({ companyId: COMPANY, leadId });
  }

  // Concurrent session writes — the recovery-rate baseline.
  const anon = `${RUN}-race`;
  await Promise.all(Array.from({ length: 30 }, () =>
    resolveVisitorSession({ companyId: COMPANY, websiteId: null, attribution: { anonymous_id: anon, session_id: `${anon}-s` } as never }),
  ));

  const genTotal = sum('intel.generation.count');
  const genSkipped = sum('intel.generation.skipped');
  const genFailures = sum('intel.generation.failures');
  const sessTotal = sum('intel.session.persistence');
  const sessRecovered = sum('intel.session.persistence', (l) => l.outcome === 'recovered_conflict');
  const sessRetried = sum('intel.session.persistence', (l) => l.outcome === 'insert_retried');
  const sessFailures = sum('intel.session.persistence_failures');
  const p = (arr: number[], q: number): number => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0;
  };

  note(`generation attempts        : ${genTotal}`);
  note(`fingerprint skip rate      : ${genSkipped}/${genTotal} = ${pct(genSkipped, genTotal)}  ← steady-state dominant path`);
  note(`generation failure rate    : ${genFailures}/${genTotal} = ${pct(genFailures, genTotal)}`);
  note(`generation duration        : p50 ${p(durations, 0.5).toFixed(0)} ms · p95 ${p(durations, 0.95).toFixed(0)} ms · max ${Math.max(...durations).toFixed(0)} ms`);
  note(`envelope bytes             : p50 ${(p(bytes, 0.5) / 1024).toFixed(1)} KB · p95 ${(p(bytes, 0.95) / 1024).toFixed(1)} KB · max ${(Math.max(...bytes) / 1024).toFixed(1)} KB (3–120 events)`);
  note(`session write outcomes     : ${sessTotal} total`);
  note(`session recovery rate      : ${sessRecovered}/${sessTotal} = ${pct(sessRecovered, sessTotal)}  ← 30 concurrent writers, worst case`);
  note(`session retry rate         : ${sessRetried}/${sessTotal} = ${pct(sessRetried, sessTotal)}  ← healthy database`);
  note(`session failure rate       : ${sessFailures}/${sessTotal} = ${pct(sessFailures, sessTotal)}`);
  note(`telemetry volume           : ${counters().filter((c) => c.name.startsWith('intel.')).length} counter series total, ${counters().filter((c) => c.name.startsWith('intel.session.')).length} session series`);
}

// ── 3. OBSERVABILITY + DASHBOARD ACCURACY ───────────────────────────────────

async function observability(): Promise<void> {
  console.log('\n── 3. OBSERVABILITY VALIDATION ──\n');

  const health = await getIntelligenceHealth(COMPANY);
  note(`health rollup              : ${health.status} — ${health.indicators.map((i) => `${i.name}=${i.status}`).join(' ')}`);

  // Dashboard accuracy: the freshness indicator must match the actual table.
  const freshness = health.indicators.find((i) => i.name === 'freshness');
  const actual = await ownedDbTable(LEAD_INTELLIGENCE_PROFILES_TABLE).select('lead_id').eq('company_id', COMPANY);
  const actualCount = (actual.data as unknown[] | null)?.length ?? -1;
  const reported = Number((freshness?.data as { total?: number } | undefined)?.total ?? -1);
  note(`dashboard accuracy         : health reports ${reported} record(s), table holds ${actualCount} → ${reported === actualCount ? 'MATCH' : 'MISMATCH'}`);

  // Every metric the alerts reference must actually exist in the registry.
  const required = [
    'intel.session.persistence',
    'intel.session.persistence_failures',
    'intel.generation.count',
    'intel.generation.skipped',
  ];
  const present = new Set(counters().map((c) => c.name));
  for (const r of required) note(`metric visible             : ${r} → ${present.has(r) ? 'yes' : 'NO'}`);

  // Session persistence trend, by outcome — the Panel 7 series.
  const series = counters().filter((c) => c.name.startsWith('intel.session.'));
  for (const s of series) {
    note(`  ${s.name}{${Object.entries(s.labels ?? {}).map(([k, v]) => `${k}=${v}`).join(',')}} = ${s.value}`);
  }
}

async function cleanup(): Promise<void> {
  const leads = await ownedDbTable('leads').select('id').like('email', `${RUN}%`);
  const ids = ((leads.data as Array<{ id: string }> | null) ?? []).map((r) => r.id);
  for (const id of ids) await ownedDbTable(LEAD_INTELLIGENCE_PROFILES_TABLE).delete().eq('lead_id', id);
  await ownedDbTable('tracking_events').delete().like('anonymous_id', `${RUN}%`);
  await ownedDbTable('campaign_touchpoints').delete().like('metadata->attribution->>anonymous_id', `${RUN}%`);
  await ownedDbTable('leads').delete().like('email', `${RUN}%`);
  await ownedDbTable('visitor_sessions').delete().like('anonymous_id', `${RUN}%`);
  await ownedDbTable('unified_persons').delete().like('primary_email', `${RUN}%`);
}

(async () => {
  console.log(`\nWS-2 M1 OPERATIONAL BASELINE  target=${TARGET}  run=${RUN}\n`);
  try {
    await historicalTransition();
    await baseline();
    await observability();
  } catch (e) {
    console.error('HARNESS ERROR:', e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    await cleanup();
    console.log('\n(test data removed)\n');
  }
  process.exit(0);
})();
