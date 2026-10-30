/**
 * In-memory, tenant-keyed fakes for the A4 provenance bridge tests.
 *
 * The contribution store is driven through the REAL `recordSourceContribution`
 * with an injected inserter that emulates the two database constraints by name
 * (`uq_psc_org_lead_external_ref`, `uq_psc_one_originating_per_lead`), so the
 * writer's duplicate / downgrade logic is exercised, not re-implemented.
 */
import { recordSourceContribution } from '../../services/prospectProvenance/contributionWriter';
import { PROVENANCE_DB } from '../../../lib/prospectProvenance/contract';
import type { BridgeDeps } from '../../services/prospectProvenance/bridge/types';

type Row = Record<string, unknown>;

export interface FakeWorld {
  deps: BridgeDeps;
  gateOpen: Set<string>;
  persons: Array<{ id: string; org: string; keys: string }>;
  prospects: Array<{ id: string; org: string; key: string; personId: string | null; source: string }>;
  sourceRecords: Array<{ id: string; org: string; provider: string; recordId: string; personId: string; observedAt: string; runId: string | null; raw: Row }>;
  contributions: Row[];
  signals: Row[];
  calls: string[];
  failNext: Partial<Record<keyof BridgeDeps, Error>>;
}

export function makeWorld(): FakeWorld {
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;
  const w: FakeWorld = {
    gateOpen: new Set(),
    persons: [],
    prospects: [],
    sourceRecords: [],
    contributions: [],
    signals: [],
    calls: [],
    failNext: {},
    deps: undefined as unknown as BridgeDeps,
  };
  const maybeFail = (name: keyof BridgeDeps) => {
    const e = w.failNext[name];
    if (e) { delete w.failNext[name]; throw e; }
  };

  const inserter = async (row: Row) => {
    const dupRef = w.contributions.find((c) =>
      c.organization_id === row.organization_id && c.canonical_lead_id === row.canonical_lead_id && c.external_ref === row.external_ref);
    if (dupRef) return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${PROVENANCE_DB.idempotencyConstraint}"` } };
    if (row.contribution_role === 'originating' && w.contributions.some((c) =>
      c.canonical_lead_id === row.canonical_lead_id && c.contribution_role === 'originating')) {
      return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${PROVENANCE_DB.oneOriginatingIndex}"` } };
    }
    const newId = id('psc');
    w.contributions.push({ ...row, id: newId });
    return { data: { id: newId }, error: null };
  };

  w.deps = {
    gate: async (org) => { w.calls.push('gate'); return w.gateOpen.has(org) ? { allowed: true, reason: 'tenant_flag:enabled' } : { allowed: false, reason: 'tenant_flag:flag_not_found' }; },
    resolvePerson: async ({ companyId, externalKeys }) => {
      w.calls.push('resolvePerson'); maybeFail('resolvePerson');
      const keys = JSON.stringify(externalKeys);
      const found = w.persons.find((p) => p.org === companyId && p.keys === keys);
      if (found) return { unifiedPersonId: found.id };
      const p = { id: id('person'), org: companyId, keys };
      w.persons.push(p);
      return { unifiedPersonId: p.id };
    },
    findProspectByKey: async (org, key) => {
      w.calls.push('findProspectByKey');
      return w.prospects.find((p) => p.org === org && p.key === key)?.id ?? null;
    },
    findProspectsForPerson: async (org, personId) => {
      w.calls.push('findProspectsForPerson');
      return w.prospects.filter((p) => p.org === org && p.personId === personId).map((p) => p.id).slice(0, 2);
    },
    resolveOrCreateProspect: async (org, cand) => {
      w.calls.push('resolveOrCreateProspect'); maybeFail('resolveOrCreateProspect');
      const existing = w.prospects.find((p) => p.org === org && p.key === cand.externalLeadKey);
      if (existing) return { prospectId: existing.id, outcome: 'matched' };
      const p = { id: id('lead'), org, key: cand.externalLeadKey, personId: cand.personId, source: cand.source };
      w.prospects.push(p);
      return { prospectId: p.id, outcome: 'created' };
    },
    ingestSourceRecord: async (input) => {
      w.calls.push('ingestSourceRecord'); maybeFail('ingestSourceRecord');
      const found = w.sourceRecords.find((r) => r.org === input.organizationId && r.provider === input.provider && r.recordId === input.sourceRecordId);
      if (found) return { sourceRecordId: found.id };
      const r = { id: id('src'), org: input.organizationId, provider: input.provider, recordId: input.sourceRecordId,
        personId: input.personId, observedAt: input.observedAt, runId: input.ingestionRunId, raw: input.rawPayload };
      w.sourceRecords.push(r);
      return { sourceRecordId: r.id };
    },
    recordContribution: async (input) => { w.calls.push('recordContribution'); return recordSourceContribution(input, { insert: inserter }); },
    loadLeadSignal: async (org, sid) => {
      w.calls.push('loadLeadSignal'); maybeFail('loadLeadSignal');
      return w.signals.find((s) => s.organization_id === org && s.id === sid) ?? null;
    },
    now: () => '2026-10-30T12:00:00.000Z',
  };
  return w;
}

export const ORG_A = '11111111-1111-4111-8111-111111111111';
export const ORG_B = '22222222-2222-4222-8222-222222222222';

export function listeningSignal(org: string, over: Row = {}): Row {
  return {
    id: 'sig-1', organization_id: org, source_type: 'listening', source_id: 't3_abc', platform: 'reddit',
    platform_user_id: 'u_alice', detected_at: '2026-10-29T10:05:00.000Z', contact_id: 'contact-1',
    metadata: { content_url: 'https://reddit.com/r/saas/comments/abc', posted_at: '2026-10-29T09:00:00.000Z', is_comment: false, author_handle: 'alice' },
    ...over,
  };
}

export function feedItem(org: string, over: Row = {}): Row {
  return {
    id: 'feed-1', organization_id: org, signal_id: 'sig-1', cluster_id: 'cluster-1', listening_execution_id: 'exec-1',
    opportunity_type: 'buying_intent', opportunity_score: 0.8, confidence_score: 0.7, urgency_score: 0.4,
    source_context: { subreddit: 'saas' }, detected_reason: 'Explicit buyer-intent language detected.',
    matched_keywords: ['looking for'], platform: 'reddit', source_identifier: 'saas',
    author_metadata: { platform_user_id: 'u_alice', author_handle: 'alice', profile_company: 'Acme' },
    explanation: {
      source_trace: { listening_execution_id: 'exec-1', source_type: 'listening', source_identifier: 'saas', platform: 'reddit', detected_at: '2026-10-29T10:00:00.000Z' },
      cluster: { cluster_key: 'k1', cluster_id: 'cluster-1' },
      moderation: { outcome: 'approved', reasons: [] },
    },
    signal_excerpt: 'we are looking for a tool', created_at: '2026-10-29T10:06:00.000Z',
    ...over,
  };
}

export function engagementSignal(org: string, over: Row = {}): Row {
  return {
    id: 'esig-1', organization_id: org, source_type: 'engagement', source_id: 'msg-1', thread_id: 'thread-1',
    platform: 'linkedin', platform_user_id: 'li_bob', detected_at: '2026-10-29T11:00:00.000Z', contact_id: 'contact-9',
    migration_source: 'native', contact_key: 'linkedin:li_bob',
    metadata: { lead_intent: 'buying_intent', author_id: 'author-1', scheduled_post_id: 'sp-77', message_created_at: '2026-10-29T08:30:00.000Z' },
    ...over,
  };
}

/* ── A minimal chainable PostgREST double for wiring tests ─────────────────── */

export interface DbOp { table: string; op: 'select' | 'insert' | 'upsert' | 'update' | 'delete'; payload?: unknown; filters: Array<[string, unknown]> }
export type DbHandler = (op: DbOp, terminal: 'single' | 'maybeSingle' | 'many') => { data: unknown; error: unknown };

export function makeFakeDb(handler: DbHandler) {
  const ops: DbOp[] = [];
  const table = (name: string) => {
    const op: DbOp = { table: name, op: 'select', filters: [] };
    let recorded = false;
    const record = () => { if (!recorded) { ops.push(op); recorded = true; } };
    const run = (terminal: 'single' | 'maybeSingle' | 'many') => { record(); return Promise.resolve(handler(op, terminal)); };
    const b: Record<string, unknown> = {};
    const chain = (fn?: (...a: unknown[]) => void) => (...a: unknown[]) => { fn?.(...a); return b; };
    Object.assign(b, {
      select: chain(),
      insert: chain((p) => { op.op = 'insert'; op.payload = p; }),
      upsert: chain((p) => { op.op = 'upsert'; op.payload = p; }),
      update: chain((p) => { op.op = 'update'; op.payload = p; }),
      delete: chain(() => { op.op = 'delete'; }),
      eq: chain((k, v) => op.filters.push([String(k), v])),
      is: chain((k, v) => op.filters.push([String(k), v])),
      in: chain((k, v) => op.filters.push([String(k), v])),
      neq: chain(), order: chain(), limit: chain(), contains: chain(),
      single: () => run('single'),
      maybeSingle: () => run('maybeSingle'),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run('many').then(res, rej),
    });
    return b;
  };
  return { ops, table };
}
