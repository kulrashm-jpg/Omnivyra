/**
 * WS-3 Milestone-8 — certification harness (shared fixtures).
 *
 * EXECUTION PROOF, NOT UNIT TESTING. Everything below runs against the REAL
 * runtime: real PostgreSQL through PostgREST, real Redis, the real telemetry
 * registry, real governance, real quota, real storage. The only stub is the
 * email PROVIDER port — the one component whose real implementation would send
 * a message to a human being. Every other seam is the shipped code.
 *
 * The provider stub records every call, which is what makes "exactly one
 * provider call under 32 concurrent dispatchers" an observation rather than an
 * assertion about code we hope is correct.
 */
/* eslint-disable no-console */

import { randomUUID } from 'node:crypto';

import type { EmailProviderPort, EmailProviderResponse } from '../../backend/services/leadOutreachExecution';

const TARGET = String(process.env.SUPABASE_URL ?? '');

/** Refuse to run anywhere but a local certification instance. */
export function assertCertenv(): void {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost):543\d\d/.test(TARGET)) {
    console.error(`\nBLOCKED — local certenv only. SUPABASE_URL=${TARGET || '<unset>'}\n`);
    process.exit(2);
  }
}

export const CERTENV_URL = TARGET;

// ── result recording ────────────────────────────────────────────────────────

export interface ProofRecord {
  section: string;
  label: string;
  ok: boolean;
  detail: string;
}

const records: ProofRecord[] = [];
let currentSection = '';

export function section(title: string): void {
  currentSection = title;
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 70 - title.length))}`);
}

export function check(label: string, ok: boolean, detail = ''): boolean {
  records.push({ section: currentSection, label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`);
  return ok;
}

/** A measurement, not a pass/fail. Printed and kept for the report. */
const measurements: Array<{ section: string; label: string; value: string }> = [];

export function measure(label: string, value: string): void {
  measurements.push({ section: currentSection, label, value });
  console.log(`  MEAS  ${label.padEnd(44)} ${value}`);
}

export const results = (): ProofRecord[] => records;
export const measurementLog = (): typeof measurements => measurements;

export function summarise(): number {
  const failed = records.filter((r) => !r.ok);
  console.log(`\n${'='.repeat(74)}`);
  console.log(`  ${records.length - failed.length} passed, ${failed.length} failed, ${measurements.length} measurements`);
  if (failed.length) {
    console.log('\n  FAILURES:');
    for (const f of failed) console.log(`    [${f.section}] ${f.label}  ${f.detail}`);
  }
  console.log(`${'='.repeat(74)}\n`);
  return failed.length;
}

// ── timing ──────────────────────────────────────────────────────────────────

export const nowMs = (): number => Number(process.hrtime.bigint() / 1_000_000n);

export interface Stats { p50: number; p95: number; p99: number; min: number; max: number; mean: number; n: number }

export function stats(samples: readonly number[]): Stats {
  const s = [...samples].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  return {
    p50: q(0.5), p95: q(0.95), p99: q(0.99),
    min: s[0], max: s[s.length - 1],
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    n: s.length,
  };
}

export const fmt = (st: Stats): string =>
  `p50 ${st.p50.toFixed(1)}ms  p95 ${st.p95.toFixed(1)}ms  p99 ${st.p99.toFixed(1)}ms  max ${st.max.toFixed(1)}ms  (n=${st.n})`;

// ── the provider stub ───────────────────────────────────────────────────────

export interface ProviderCall { to: string; idempotencyKey: string; at: number }

export const provider = {
  calls: [] as ProviderCall[],
  behaviour: 'accept' as 'accept' | 'reject' | 'throw' | 'hang',
  reset(): void { this.calls = []; this.behaviour = 'accept'; },
};

let messageSeq = 0;
let fixtureSeq = 0;

/**
 * The ONE stubbed seam. It records every call so duplicate egress is directly
 * observable, and it can be told to fail in each way a real provider fails.
 */
export const stubProvider: EmailProviderPort = {
  name: 'certenv_stub',
  async send(req): Promise<EmailProviderResponse> {
    provider.calls.push({ to: req.to, idempotencyKey: req.idempotencyKey, at: nowMs() });
    if (provider.behaviour === 'throw') throw new Error('provider exploded');
    if (provider.behaviour === 'hang') return new Promise<EmailProviderResponse>(() => undefined);
    if (provider.behaviour === 'reject') {
      return { accepted: false, messageId: null, rejectionReason: 'provider rejected the message' };
    }
    messageSeq += 1;
    return { accepted: true, messageId: `stub-msg-${messageSeq}` };
  },
};

// ── tenant fixtures ─────────────────────────────────────────────────────────

export interface TenantConfig {
  enabled?: boolean;
  killSwitch?: boolean;
  enabledChannels?: string[];
  restrictedRegions?: string[];
  dailyLimitTenant?: number | null;
  dailyLimitLead?: number | null;
}

/** Write a tenant's governance configuration directly. Real table, real row. */
export async function configureTenant(companyId: string, over: TenantConfig = {}): Promise<void> {
  const { ownedDbTable } = await import('../../backend/db/writeOwner');
  await ownedDbTable('outreach_governance_config').upsert({
    company_id: companyId,
    enabled: over.enabled ?? true,
    kill_switch: over.killSwitch ?? false,
    enabled_channels: over.enabledChannels ?? ['email', 'internal'],
    restricted_regions: over.restrictedRegions ?? [],
    daily_limit_tenant: over.dailyLimitTenant ?? null,
    daily_limit_lead: over.dailyLimitLead ?? null,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Add a suppression. Throws on a rejected write.
 *
 * The throw matters: `scope` is constrained to four values by the database, and
 * a silently-dropped fixture would make the suppression gate look permissive
 * when in fact it was never given anything to suppress.
 */
export async function addSuppression(companyId: string, scope: 'recipient' | 'channel' | 'task' | 'lead', value: string): Promise<void> {
  const { ownedDbTable } = await import('../../backend/db/writeOwner');
  const res = await ownedDbTable('outreach_suppressions').insert({
    company_id: companyId, scope, value, reason: 'certification fixture', created_by: 'ws3-m8',
  });
  const err = (res as { error?: { message?: string } } | null)?.error;
  if (err) throw new Error(`suppression fixture rejected: ${err.message ?? JSON.stringify(err)}`);
}

// ── raw SQL, for the assertions PostgREST cannot express ────────────────────

type PgClient = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>; end: () => Promise<void> };

let pg: PgClient | null = null;

/**
 * A direct libpq connection.
 *
 * PostgREST cannot express "does this unique index exist" or "does this trigger
 * refuse a DELETE issued as the table owner". Those are the guarantees the
 * architecture actually rests on, so they are verified against the catalog
 * itself rather than through the API that sits above it.
 */
export async function sql(): Promise<PgClient> {
  if (pg) return pg;
  const { Client } = (await import('pg')) as unknown as { Client: new (c: unknown) => PgClient & { connect: () => Promise<void> } };
  const c = new Client({ host: '127.0.0.1', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
  await c.connect();
  pg = c;
  return pg;
}

export async function closeSql(): Promise<void> {
  if (pg) { await pg.end(); pg = null; }
}

// ── redis, direct ───────────────────────────────────────────────────────────

export async function redis(): Promise<Record<string, (...a: unknown[]) => Promise<unknown>>> {
  const mod = await import('../../backend/queue/bullmqClient');
  return (mod as unknown as { getSharedRedisClient: () => never }).getSharedRedisClient();
}

// ── plan fixture ────────────────────────────────────────────────────────────

/**
 * A REAL WS-2 plan, built by the real WS-2 engines from a real snapshot.
 *
 * Deliberately not a hand-written AutomationSummary literal: the point of the
 * proof is that WS-3 consumes what WS-2 actually produces, and a hand-written
 * fixture would only prove WS-3 consumes what this script produces.
 */
export async function realPlan(companyId: string, leadId: string, now: string): Promise<unknown> {
  const engine = await import('../../backend/services/leadIntelligenceEngine');
  const planning = await import('../../backend/services/qualificationPlanning');
  const automation = await import('../../backend/services/automationExecution');

  const pages = ['/pricing', '/demo', '/security', '/case-studies/a', '/enterprise'];
  const snapshot = engine.assembleLeadCaptureSnapshot({
    leadRow: {
      id: leadId, company_id: companyId, email: 'cto@bigcorp.test',
      created_at: '2026-08-04T09:00:00.000Z', visitor_session_id: 'vs-1',
      metadata: { job_title: 'CTO', company_name: 'BigCorp', company_size: '1000+', industry: 'Finance' },
    },
    trackingEventRows: pages.map((p, i) => ({
      id: `e${i}`, event_name: 'page_view', page_url: `https://x.test${p}`,
      visitor_session_id: 'vs-1', occurred_at: `2026-08-04T08:0${i}:00.000Z`,
      metadata: { scroll_depth: 90 },
    })),
    visitorSessionRows: [{
      id: 'vs-1', started_at: '2026-08-04T08:00:00.000Z', last_seen_at: '2026-08-04T08:30:00.000Z',
      metadata: { visitor: { visit_count: 3, returning_visitor: true, first_visit_at: '2026-07-20T09:00:00.000Z' } },
    }],
    touchpointRows: [],
    now,
  });
  const behavior = engine.analyzeBehavior(snapshot, engine.defaultEngineConfig);
  const intent = engine.computeIntentIntelligence(snapshot, engine.defaultEngineConfig, behavior);
  const persona = engine.classifyPersona(snapshot, engine.defaultEngineConfig, behavior);
  const summary = planning.buildQualificationPlanningSummary({ snapshot, intent, persona });
  return automation.buildAutomationSummary({ summary });
}

/**
 * Unique tenant id per run — certenv rows are append-only and never deleted.
 *
 * MUST be a syntactically valid UUID. A3 retyped `company_id` on every
 * `outreach_*` table from `text` to `uuid`, so the previous
 * `m8-<tag>-<pid>-<seq>` shape now fails the whole harness with `22P02`
 * (invalid_text_representation) on the first insert. This is a harness-only
 * correction: it changes no production identity semantics, no schema decision,
 * and no runtime code path.
 *
 * `randomUUID()` rather than a hand-rolled hex encoding of tag/pid/seq: the id
 * must be a *valid* UUID, not merely UUID-shaped, and inventing an encoding to
 * smuggle debug data into the identifier is exactly the kind of cleverness that
 * later reads as meaningful. Traceability is preserved out-of-band by
 * `tenantLabels`, so a failing certification run can still name the fixture.
 */
export const tenantId = (tag: string): string => {
  fixtureSeq += 1;
  const id = randomUUID();
  tenantLabels.set(id, `m8-${tag}-${process.pid}-${fixtureSeq}`);
  return id;
};

/** Debug-only map from generated tenant uuid → the human-readable fixture label. */
const tenantLabels = new Map<string, string>();

/** The fixture label a generated tenant id was minted for, for diagnostics. */
export const tenantLabel = (id: string): string => tenantLabels.get(id) ?? id;
