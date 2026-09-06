/**
 * A4B — a planned field actually reaches the recorded executor, and reaches
 * nothing else.
 *
 * The A4 audit found the planner and the executor were two finished halves with
 * nothing between them: `planProspectEnrichment` had two production callers and
 * `executeEnrichment` had none, so every safety property the executor owns
 * guarded a path no plan could take. These tests pin the join, and pin equally
 * hard that joining them introduced no new policy — no credential fallback, no
 * Omnivyra charge, no substituted provider, no scheduler, no second write.
 *
 * The distinction under test throughout: a REFUSAL is ours and costs nothing;
 * an OUTCOME is the provider's. A4B must never turn one into the other, because
 * "we declined to ask" and "they had no answer" are different facts about a
 * prospect and imply opposite next actions.
 *
 * SECRETS: all synthetic. No real credential, no network, no provider call.
 */

import {
  executePlannedField,
  canonicalSelectors,
  PLAN_REFUSALS,
  PLAN_EXECUTION_VERSION,
  ENRICHABLE_ENTITY_STATUSES,
  type PlanFieldExecution,
} from '../../services/enrichment/execution';
import type { EnrichmentPlan, PlannedField } from '../../services/enrichment/planner';
import type { ProspectSnapshot } from '../../services/enrichment/service';
import type { ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type {
  EnrichmentProviderAdapter, EnrichmentRequest, ProviderResponse,
} from '../../services/enrichment/providers/contract';
import { ENRICHMENT_OUTCOMES } from '../../services/enrichment/providers/contract';
import {
  ACQUISITION_SOURCES, listSourceStatus, type SourceStatus,
} from '../../services/enrichment/providers/sources';
import * as fs from 'fs';
import * as path from 'path';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const PROSPECT = 'lead-1';
const ACCOUNT_ID = 'acct-1';
const PERSON_ID = 'person-1';
const NOW = '2026-09-06T00:00:00.000Z';
const CORRELATION = 'run-a4b-1';

// ── fixtures ────────────────────────────────────────────────────────────────

/**
 * A source status that is genuinely eligible.
 *
 * A3Z: the economics here are now the REAL ones — tenant-funded, no Omnivyra
 * credit action. This fixture originally carried `creditAction:
 * 'prospect_enrichment'` to work around A3C's `unpriced` gate, which at the
 * time refused every real descriptor. That gate has since been re-anchored on
 * the declared funding model, so the workaround is gone and the fixture matches
 * the live descriptor.
 */
function status(over: Partial<SourceStatus> = {}): SourceStatus {
  return {
    id: 'clearbit',
    displayName: 'Clearbit',
    sourceType: 'external_api',
    capabilities: { entities: ['account'], attributes: ['employee_count', 'founded_year'] },
    credentialEnvVar: 'CLEARBIT_API_KEY',
    authorizationRequirements: [],
    creditAction: null,
    fundingModel: 'tenant_provider_subscription',
    priority: 25,
    note: 'synthetic',
    connectionState: 'connected',
    usable: true,
    stateReason: 'synthetic: connected',
    ...over,
  } as SourceStatus;
}

const plan = (over: Partial<EnrichmentPlan> = {}): EnrichmentPlan => ({
  organizationId: ORG,
  prospectId: PROSPECT,
  version: 'ws2.1',
  generatedAt: NOW,
  fields: [],
  toEnrich: [],
  counts: { known: 0, missing: 1, stale: 0, conflicting: 0 },
  empty: false,
  ...over,
});

const field = (over: Partial<PlannedField> = {}): PlannedField => ({
  attribute: 'employee_count',
  subject: 'account',
  state: 'missing',
  requiredForNextAction: false,
  action: 'enrich',
  source: 'clearbit',
  sourceStatus: 'connected',
  cost: { kind: 'unknown' },
  reason: 'synthetic planned field',
  ...over,
});

const snapshot = (over: Partial<ProspectSnapshot> = {}): ProspectSnapshot => ({
  personId: PERSON_ID,
  accountId: ACCOUNT_ID,
  person: {
    id: PERSON_ID, status: 'active', primary_email: 'a@example.com', full_name: 'A Person',
  },
  account: {
    id: ACCOUNT_ID, status: 'active', domain_normalized: 'example.com',
    name: 'Example Inc', website_url: 'https://example.com',
  },
  ...over,
});

interface Harness {
  ports: ExecuteEnrichmentPorts;
  adapter: EnrichmentProviderAdapter;
  calls: EnrichmentRequest[];
  attempts: Record<string, unknown>[];
  completions: Record<string, unknown>[];
  persisted: Record<string, unknown>[];
  costCalls: number;
  recorder: Record<string, unknown>;
}

function harness(opts: {
  credential?: string | null;
  response?: ProviderResponse;
  throws?: unknown;
  recent?: { observedAt: string } | null;
  costDenied?: string;
} = {}): Harness {
  const calls: EnrichmentRequest[] = [];
  const attempts: Record<string, unknown>[] = [];
  const completions: Record<string, unknown>[] = [];
  const persisted: Record<string, unknown>[] = [];
  const h = { costCalls: 0 };

  const adapter: EnrichmentProviderAdapter = {
    id: 'clearbit',
    label: 'Clearbit',
    supports: ['employee_count', 'founded_year'],
    credentialEnvVar: 'CLEARBIT_API_KEY',
    isAvailable: () => false,
    async enrich(request) {
      calls.push(request);
      if (opts.throws !== undefined) throw opts.throws;
      return opts.response ?? {
        outcome: 'enriched',
        fields: [{
          attribute: 'employee_count', subject: 'account', value: 250,
          observedAt: '2026-09-01T00:00:00.000Z', confidence: null, providerInferred: false,
        }],
        notReturned: [],
        payloadHash: 'hash-1',
        rawPayload: { synthetic: true },
      };
    },
  };

  const ports: ExecuteEnrichmentPorts = {
    async authorizeCost() {
      h.costCalls += 1;
      return opts.costDenied
        ? { authorized: false, reason: opts.costDenied }
        : { authorized: true, holdId: null, cost: { kind: 'unknown' } };
    },
    async releaseCost() { /* nothing reserved under tenant-funded economics */ },
    async resolveCredential() {
      return opts.credential === undefined ? 'synthetic-tenant-key' : opts.credential;
    },
    async findRecentObservation() { return opts.recent ?? null; },
    async persistObservation(input) {
      persisted.push(input as unknown as Record<string, unknown>);
      return { sourceRecordId: 'src-1', canonicalWithheld: [] };
    },
    now: () => NOW,
  };

  const recorder = {
    now: () => NOW,
    nextNumber: async () => 1,
    record: async (i: unknown) => {
      attempts.push(i as Record<string, unknown>);
      return { attemptId: 'attempt-1' };
    },
    complete: async (i: unknown) => { completions.push(i as Record<string, unknown>); },
  };

  return {
    ports, adapter, calls, attempts, completions, persisted, recorder,
    get costCalls() { return h.costCalls; },
  } as Harness;
}

const run = (
  hz: Harness,
  over: { field?: Partial<PlannedField>; snapshot?: Partial<ProspectSnapshot>;
    statuses?: readonly SourceStatus[]; plan?: Partial<EnrichmentPlan>;
    mode?: string; freshnessDays?: number } = {},
): Promise<PlanFieldExecution> => executePlannedField({
  plan: plan(over.plan),
  field: field(over.field),
  snapshot: snapshot(over.snapshot),
  statuses: over.statuses ?? [status()],
  mode: over.mode,
  correlationId: CORRELATION,
  freshnessDays: over.freshnessDays,
  adapter: hz.adapter,
  recorder: hz.recorder as never,
}, hz.ports);

// ── 1. the seam exists and is reached ───────────────────────────────────────

describe('A4B — an executable plan item reaches the recorded executor', () => {
  it('1. calls the provider, persists through LI-2, and returns the outcome', async () => {
    const hz = harness();
    const out = await run(hz);

    expect(out.executed).toBe(true);
    expect(out.refusal).toBeNull();
    expect(out.outcome).toBe('enriched');
    expect(out.providerCalled).toBe(true);
    expect(hz.calls).toHaveLength(1);
    // LI-2's persistence port is the ONLY write, and the seam did not add one.
    expect(hz.persisted).toHaveLength(1);
    expect(out.sourceRecordId).toBe('src-1');
    expect(out.version).toBe(PLAN_EXECUTION_VERSION);
  });

  it('sends exactly the planned attribute — never the whole plan', async () => {
    const hz = harness();
    await run(hz, { field: { attribute: 'founded_year' } });
    expect(hz.calls[0].attributes).toEqual(['founded_year']);
  });

  it('carries a correlation id from plan through request to attempt to result', async () => {
    const hz = harness();
    const out = await run(hz);
    expect(hz.calls[0].correlationId).toBe(CORRELATION);
    expect(hz.attempts[0].correlationId).toBe(CORRELATION);
    expect(out.correlationId).toBe(CORRELATION);
  });
});

// ── 2. tenant identity ──────────────────────────────────────────────────────

describe('A4B — tenant identity is the plan\'s, and survives every hop', () => {
  it('2. the request, the credential lookup and the attempt all name the plan tenant', async () => {
    const hz = harness();
    let credentialOrg: string | null = null;
    const ports: ExecuteEnrichmentPorts = {
      ...hz.ports,
      async resolveCredential(i) { credentialOrg = i.organizationId; return 'synthetic-tenant-key'; },
    };
    const out = await executePlannedField({
      plan: plan(), field: field(), snapshot: snapshot(), statuses: [status()],
      correlationId: CORRELATION, adapter: hz.adapter, recorder: hz.recorder as never,
    }, ports);

    expect(out.organizationId).toBe(ORG);
    expect(hz.calls[0].organizationId).toBe(ORG);
    expect(credentialOrg).toBe(ORG);
    expect(hz.attempts[0].organizationId).toBe(ORG);
    expect(hz.persisted[0].organizationId).toBe(ORG);
  });

  it('never reads a tenant from the snapshot or the entity row', async () => {
    const hz = harness();
    // A snapshot carrying another tenant's marker must not change the answer:
    // the PLAN is the only authority for whose enrichment this is.
    const out = await run(hz, {
      snapshot: { account: {
        id: ACCOUNT_ID, status: 'active', domain_normalized: 'example.com',
        organization_id: OTHER_ORG,
      } },
    });
    expect(out.organizationId).toBe(ORG);
    expect(hz.calls[0].organizationId).toBe(ORG);
  });
});

// ── 3. canonical entity identity ────────────────────────────────────────────

describe('A4B — the canonical entity is the snapshot\'s, never re-derived', () => {
  it('3. an account field executes against prospect_accounts.id', async () => {
    const hz = harness();
    const out = await run(hz);
    expect(out.entityId).toBe(ACCOUNT_ID);
    expect(hz.calls[0].entityId).toBe(ACCOUNT_ID);
    expect(hz.calls[0].subject).toBe('account');
    expect(hz.attempts[0].entityId).toBe(ACCOUNT_ID);
  });

  it('a person field executes against unified_persons.id', async () => {
    const hz = harness();
    const out = await run(hz, {
      field: { subject: 'person', attribute: 'job_title' },
      statuses: [status({
        capabilities: { entities: ['person'], attributes: ['job_title'] },
      })],
    });
    // The adapter does not support job_title, so A3 answers field_not_found —
    // but the ENTITY it was asked about is still the person, not the account.
    expect(out.entityId).toBe(PERSON_ID);
    expect(out.subject).toBe('person');
  });

  it('10a. refuses when the prospect has no canonical row for the subject', async () => {
    const hz = harness();
    const out = await run(hz, { snapshot: { accountId: null, account: null } });
    expect(out.executed).toBe(false);
    expect(out.refusal).toBe('entity_missing');
    expect(hz.calls).toHaveLength(0);
    expect(hz.attempts).toHaveLength(0);
  });
});

// ── 4. explicit provider selection ──────────────────────────────────────────

describe('A4B — the planner\'s source is preserved, never substituted', () => {
  it('4. the planned source is the provider that is called', async () => {
    const hz = harness();
    const out = await run(hz);
    expect(out.providerId).toBe('clearbit');
  });

  it('a planned source that is ineligible refuses — it is NOT replaced by an eligible one', async () => {
    const hz = harness();
    const out = await run(hz, {
      field: { source: 'apollo' },
      statuses: [
        status({ id: 'apollo', displayName: 'Apollo', connectionState: 'not_connected', usable: false,
          stateReason: 'the tenant has not linked it' }),
        status(),   // clearbit IS eligible, and must not be chosen instead
      ],
    });
    expect(out.executed).toBe(false);
    expect(out.refusal).toBe('source_ineligible');
    expect(out.providerId).toBe('apollo');
    expect(out.ineligibility).toBe('not_connected');
    expect(hz.calls).toHaveLength(0);
  });

  it('an unknown planned source refuses under A3\'s own vocabulary', async () => {
    const hz = harness();
    const out = await run(hz, { field: { source: 'apollo_enrichment' } });
    expect(out.refusal).toBe('source_ineligible');
    expect(out.ineligibility).toBe('unknown_source');
    expect(hz.calls).toHaveLength(0);
  });

  it('does not default to auto — an omitted mode means the PLANNER\'s source', async () => {
    const hz = harness();
    const out = await run(hz, {
      field: { source: 'apollo' },
      statuses: [status(), status({ id: 'apollo', connectionState: 'unsupported', usable: false,
        stateReason: 'declared only' })],
    });
    // If the seam had silently used `auto`, clearbit would have been selected.
    expect(out.executed).toBe(false);
    expect(out.providerId).toBe('apollo');
  });
});

// ── 5/6. unavailable provider and missing credential ────────────────────────

describe('A4B — refusals that cost nothing', () => {
  it('5. an unavailable provider refuses with NO provider call', async () => {
    const hz = harness();
    const out = await run(hz, {
      statuses: [status({ connectionState: 'credential_missing', usable: false,
        stateReason: 'this tenant has not configured a credential for this source' })],
    });
    expect(out.executed).toBe(false);
    expect(out.refusal).toBe('source_ineligible');
    expect(out.ineligibility).toBe('not_connected');
    expect(out.providerCalled).toBe(false);
    expect(hz.calls).toHaveLength(0);
    // Nothing was authorised either — a refusal before selection never reaches cost.
    expect(hz.costCalls).toBe(0);
  });

  it('6. a missing TENANT credential fails closed as credential_missing', async () => {
    const hz = harness({ credential: null });
    const out = await run(hz);
    expect(out.executed).toBe(true);           // the attempt happened
    expect(out.outcome).toBe('credential_missing');
    expect(out.providerCalled).toBe(false);
    expect(hz.calls).toHaveLength(0);
    // and it is RECORDED, because "we could not ask" is a maintenance fact.
    expect(hz.attempts).toHaveLength(1);
    expect(hz.completions[0].outcome).toBe('credential_missing');
    expect(hz.completions[0].providerCalled).toBe(false);
  });

  it('a cost/platform denial is reported as cost_denied, not as a provider failure', async () => {
    const hz = harness({ costDenied: 'platform capacity is exhausted' });
    const out = await run(hz);
    expect(out.outcome).toBe('cost_denied');
    expect(out.providerCalled).toBe(false);
    expect(hz.calls).toHaveLength(0);
  });
});

// ── 7. duplicate suppression ────────────────────────────────────────────────

describe('A4B — duplicate suppression is the executor\'s, and still fires', () => {
  it('7. a fresh equivalent observation prevents the provider call', async () => {
    const hz = harness({ recent: { observedAt: '2026-09-04T00:00:00.000Z' } });
    const out = await run(hz);
    expect(out.outcome).toBe('duplicate_suppressed');
    expect(out.providerCalled).toBe(false);
    expect(hz.calls).toHaveLength(0);
    expect(hz.costCalls).toBe(0);   // suppression precedes cost, as A3 defined
  });

  it('an observation older than the freshness window does NOT suppress', async () => {
    const hz = harness({ recent: { observedAt: '2026-01-01T00:00:00.000Z' } });
    const out = await run(hz);
    expect(out.outcome).toBe('enriched');
    expect(hz.calls).toHaveLength(1);
  });

  it('A4B introduces no horizon of its own — the executor default still governs', async () => {
    // 60 days old: inside the planner's 90-day stale horizon, outside the
    // executor's 30-day freshness window. The mismatch the A4 audit recorded is
    // REAL and is deliberately untouched here; the executor's window decides.
    const hz = harness({ recent: { observedAt: '2026-07-08T00:00:00.000Z' } });
    const out = await run(hz);
    expect(out.outcome).toBe('enriched');

    // And an explicitly widened window suppresses the same observation, proving
    // the seam passes the caller's horizon through rather than owning one.
    const hz2 = harness({ recent: { observedAt: '2026-07-08T00:00:00.000Z' } });
    const out2 = await run(hz2, { freshnessDays: 90 });
    expect(out2.outcome).toBe('duplicate_suppressed');
    expect(hz2.calls).toHaveLength(0);
  });
});

// ── 8. the A4A attempt record ───────────────────────────────────────────────

describe('A4B — every execution is recorded through A4A', () => {
  it('8. an attempt is opened before the call and closed with the outcome', async () => {
    const hz = harness();
    const out = await run(hz);

    expect(hz.attempts).toHaveLength(1);
    expect(hz.completions).toHaveLength(1);
    expect(out.attemptId).toBe('attempt-1');
    expect(out.attemptNumber).toBe(1);

    expect(hz.attempts[0]).toMatchObject({
      organizationId: ORG, subject: 'account', entityId: ACCOUNT_ID,
      providerId: 'clearbit', attemptNumber: 1,
    });
    expect(hz.completions[0]).toMatchObject({
      organizationId: ORG, attemptId: 'attempt-1',
      outcome: 'enriched', providerCalled: true, sourceRecordId: 'src-1',
    });
  });

  it('a refusal BEFORE the executor records no attempt — nothing was attempted', async () => {
    const hz = harness();
    const out = await run(hz, { field: { action: 'skip' } });
    expect(out.executed).toBe(false);
    expect(hz.attempts).toHaveLength(0);
    expect(hz.completions).toHaveLength(0);
    expect(out.attemptId).toBeNull();
  });

  it('the attempt records the requested attribute, not the whole plan', async () => {
    const hz = harness();
    await run(hz, { field: { attribute: 'founded_year' } });
    expect(hz.attempts[0].requestedAttributes).toEqual(['founded_year']);
  });
});

// ── 9. outcome preservation ─────────────────────────────────────────────────

describe('A4B — a provider outcome is preserved, never collapsed', () => {
  const cases: Array<[string, ProviderResponse | undefined, unknown, string]> = [
    ['no_match', { outcome: 'no_match', fields: [], notReturned: ['employee_count'] }, undefined, 'no_match'],
    ['provider_declined', { outcome: 'provider_declined', fields: [], notReturned: [] }, undefined, 'provider_declined'],
    ['quota_exceeded', { outcome: 'quota_exceeded', fields: [], notReturned: [] }, undefined, 'quota_exceeded'],
  ];

  it.each(cases)('9. %s survives to the caller', async (_name, response, _throws, expected) => {
    const hz = harness({ response });
    const out = await run(hz);
    expect(out.outcome).toBe(expected);
    expect(out.refusal).toBeNull();
    expect(out.providerCalled).toBe(true);
    expect(hz.completions[0].outcome).toBe(expected);
  });

  it('a transport error keeps A3\'s classification rather than becoming a generic failure', async () => {
    const hz = harness({ throws: new Error('socket timed out') });
    const out = await run(hz);
    expect(out.outcome).toBe('timeout');
    expect(out.providerCalled).toBe(true);
  });

  it('an unrecognised error becomes provider_unavailable, never no_match', async () => {
    const hz = harness({ throws: new Error('something inexplicable') });
    const out = await run(hz);
    expect(out.outcome).toBe('provider_unavailable');
  });

  it('every outcome it can return belongs to the frozen A3 vocabulary', async () => {
    const hz = harness();
    const out = await run(hz);
    expect(ENRICHMENT_OUTCOMES).toContain(out.outcome as string);
  });

  it('a refusal and an outcome are never both set', async () => {
    const executed = await run(harness());
    expect(executed.outcome).not.toBeNull();
    expect(executed.refusal).toBeNull();

    const refused = await run(harness(), { field: { action: 'skip' } });
    expect(refused.outcome).toBeNull();
    expect(refused.refusal).not.toBeNull();
  });
});

// ── 10. plan items that must not execute ────────────────────────────────────

describe('A4B — a plan item lacking safe identity or intent is refused', () => {
  it.each(['skip', 'no_available_source', 'needs_resolution'] as const)(
    '10b. action=%s never reaches a provider', async (action) => {
      const hz = harness();
      const out = await run(hz, { field: { action } });
      expect(out.executed).toBe(false);
      expect(out.refusal).toBe('not_executable');
      expect(hz.calls).toHaveLength(0);
    });

  it('needs_resolution in particular is never re-fetched — that would overwrite a conflict', async () => {
    const hz = harness();
    const out = await run(hz, {
      field: { action: 'needs_resolution', state: 'conflicting', source: null, sourceStatus: null },
    });
    expect(out.refusal).toBe('not_executable');
    expect(out.reason).toContain('needs_resolution');
    expect(hz.calls).toHaveLength(0);
  });

  it('an internal seam is not executed through the provider path', async () => {
    const hz = harness();
    for (const s of ['internal', 'market_pulse'] as const) {
      const out = await run(hz, { field: { source: s, sourceStatus: s } });
      expect(out.refusal).toBe('internal_source');
    }
    expect(hz.calls).toHaveLength(0);
    expect(hz.attempts).toHaveLength(0);
  });

  it('10c. a non-active canonical entity is refused', async () => {
    for (const st of ['merged', 'archived', 'suppressed']) {
      const hz = harness();
      const out = await run(hz, {
        snapshot: { account: { id: ACCOUNT_ID, status: st, domain_normalized: 'example.com' } },
      });
      expect(out.executed).toBe(false);
      expect(out.refusal).toBe('entity_not_active');
      expect(out.reason).toContain(st);
      expect(hz.calls).toHaveLength(0);
    }
  });

  it('an unreadable status refuses rather than assuming active — absence is not intelligence', async () => {
    const hz = harness();
    const out = await run(hz, {
      snapshot: { account: { id: ACCOUNT_ID, domain_normalized: 'example.com' } },
    });
    expect(out.refusal).toBe('entity_not_active');
    expect(out.reason).toContain('unreadable');
  });

  it('10d. refuses when no canonical identity exists to search on', async () => {
    const hz = harness();
    const out = await run(hz, {
      snapshot: { account: { id: ACCOUNT_ID, status: 'active' } },
    });
    expect(out.executed).toBe(false);
    expect(out.refusal).toBe('selector_missing');
    expect(hz.calls).toHaveLength(0);
    expect(hz.attempts).toHaveLength(0);
  });

  it('selectors are canonical columns verbatim — nothing composed or borrowed', () => {
    expect(canonicalSelectors('account', {
      domain_normalized: 'example.com', name: 'Example Inc', website_url: 'https://example.com',
    })).toEqual({ domain: 'example.com', name: 'Example Inc', website: 'https://example.com' });

    expect(canonicalSelectors('person', {
      primary_email: 'a@example.com', full_name: 'A Person',
    })).toEqual({ email: 'a@example.com', name: 'A Person' });

    // A PERSON never inherits the employer's domain: evidence keyed on a
    // company domain but attributed to a person is the wrong entity's fact.
    expect(canonicalSelectors('person', { domain_normalized: 'example.com' })).toEqual({});
    expect(canonicalSelectors('account', null)).toEqual({});
    expect(canonicalSelectors('account', { domain_normalized: '   ' })).toEqual({});
  });

  it('the person selectors that ARE held reach the provider', async () => {
    const hz = harness();
    await run(hz, {
      field: { subject: 'person', attribute: 'employee_count' },
      statuses: [status({ capabilities: { entities: ['person'], attributes: ['employee_count'] } })],
    });
    expect(hz.calls[0].selectors).toEqual({ email: 'a@example.com', name: 'A Person' });
  });
});

// ── 11/12/13. what the seam must NOT have introduced ────────────────────────

/**
 * The file's CODE, with comments removed.
 *
 * These assertions are about what the module DOES, and a doc comment that
 * explains why something is deliberately absent must not read as that thing
 * being present — "no loop over `plan.toEnrich`" is the opposite of a loop over
 * `plan.toEnrich`, and a scan of raw text cannot tell them apart.
 */
const read = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('A4B — the seam introduced no new capability', () => {
  it('11. the planner still performs no network I/O', () => {
    const src = read('services/enrichment/planner.ts');
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/safeFetch|axios|node-fetch|https?:\/\/[^\s'")]+/);
    expect(src).not.toMatch(/\bawait\b/);          // pure and synchronous
    expect(src).not.toMatch(/import[^\n]*adapters/);
  });

  it('the seam does not make the planner import a provider or an adapter', () => {
    const src = read('services/enrichment/planner.ts');
    expect(src).not.toMatch(/from '\.\/providers/);
  });

  it('12. the seam introduces no process.env credential fallback', () => {
    const src = read('services/enrichment/execution.ts');
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/hasCredential/);
    // The credential is resolved by the executor's tenant port and nowhere else.
    expect(src).not.toMatch(/credential\s*:/);
  });

  it('12b. the seam never reads, logs or returns a credential', async () => {
    const hz = harness();
    const out = await run(hz);
    expect(JSON.stringify(out)).not.toContain('synthetic-tenant-key');
    // The adapter received it (the executor injects it) but nothing else did.
    expect(hz.calls[0].credential).toBe('synthetic-tenant-key');
    expect(JSON.stringify(hz.attempts)).not.toContain('synthetic-tenant-key');
    expect(JSON.stringify(hz.completions)).not.toContain('synthetic-tenant-key');
  });

  it('13. the seam introduces no Omnivyra customer credit charge', () => {
    const src = read('services/enrichment/execution.ts');
    expect(src).not.toMatch(/PROSPECT_ENRICHMENT_ACTION|creditCostPort|makeCreditCostPort/);
    expect(src).not.toMatch(/from '\.\/providers\/cost'/);
    expect(src).not.toMatch(/reserveCredits|chargeCredits|pricingService/);
  });

  it('13b. no raw provider payload reaches the returned result', async () => {
    const hz = harness();
    const out = await run(hz);
    expect(JSON.stringify(out)).not.toContain('synthetic');
    // The payload went to LI-2's persistence port, which is where it belongs.
    expect(hz.persisted[0].rawPayload).toEqual({ synthetic: true });
  });

  it('5b. adds no second persistence path — it never calls applyEnrichmentResult', () => {
    const src = read('services/enrichment/execution.ts');
    expect(src).not.toMatch(/applyEnrichmentResult\(/);
    expect(src).not.toMatch(/ingestSourceRecord/);
    expect(src).not.toMatch(/ownedDbTable|supabase/);
  });

  it('adds no scheduler, queue, cron or timer', () => {
    const src = read('services/enrichment/execution.ts');
    expect(src).not.toMatch(/setInterval|setTimeout|node-cron|bullmq|Queue\(|Worker\(/);
    // One call executes ONE field: no loop over the plan lives here.
    expect(src).not.toMatch(/toEnrich/);
  });
});

// ── 14. suppression, unchanged ──────────────────────────────────────────────

describe('A4B — suppression semantics are unchanged', () => {
  it('14. an explicitly suppressed canonical entity is not enriched', async () => {
    const hz = harness();
    const out = await run(hz, {
      snapshot: { account: { id: ACCOUNT_ID, status: 'suppressed', domain_normalized: 'example.com' } },
    });
    expect(out.refusal).toBe('entity_not_active');
    expect(hz.calls).toHaveLength(0);
  });

  it('a required-for-next-action field does not override a suppressed entity', async () => {
    const hz = harness();
    const out = await run(hz, {
      field: { requiredForNextAction: true },
      snapshot: { person: { id: PERSON_ID, status: 'suppressed', primary_email: 'a@example.com' },
        account: { id: ACCOUNT_ID, status: 'suppressed', domain_normalized: 'example.com' } },
    });
    // Positive intent never outranks an explicit suppression state.
    expect(out.refusal).toBe('entity_not_active');
    expect(hz.calls).toHaveLength(0);
  });

  it('the enrichable status set is exactly the canonical "active" — not a new vocabulary', () => {
    expect([...ENRICHABLE_ENTITY_STATUSES]).toEqual(['active']);
  });

  it('A4B does not wire contact governance (DNC) into enrichment', () => {
    const src = read('services/enrichment/execution.ts');
    expect(src).not.toMatch(/contactGovernance|mayContact|loadSuppressionMatches/);
  });
});

// ── the live registry: an honest pin on a real, pre-existing mismatch ───────

describe('A4B — the live source registry, reconciled by A3Z', () => {
  it('every real acquisition source has creditAction null (A3X, tenant-funded)', () => {
    expect(ACQUISITION_SOURCES.every((s) => s.creditAction === null)).toBe(true);
  });

  it('a live, connected, tenant-credentialled Clearbit now executes through the seam', async () => {
    // This test previously pinned the A3X/A3C contradiction that made EVERY
    // source refuse as `unpriced`. A3Z re-anchored that gate on the declared
    // funding model, so the live registry now selects Clearbit — and the seam
    // carries it all the way to the adapter. Nothing was weakened: the
    // Omnivyra-funded-without-a-credit-action refusal is still enforced, and
    // the credential-absent case below still refuses.
    const hz = harness();
    const live = listSourceStatus(
      (id) => id === 'clearbit',        // adapter registered
      () => true,                       // tenant credential present
    );
    expect(live.find((s) => s.id === 'clearbit')?.connectionState).toBe('connected');

    const out = await run(hz, { statuses: live });
    expect(out.executed).toBe(true);
    expect(out.refusal).toBeNull();
    expect(out.providerId).toBe('clearbit');
    expect(out.outcome).toBe('enriched');
  });

  it('the SAME live registry without a tenant credential refuses, and calls nobody', async () => {
    const hz = harness();
    const live = listSourceStatus((id) => id === 'clearbit', () => false);
    const out = await run(hz, { statuses: live });
    expect(out.executed).toBe(false);
    expect(out.refusal).toBe('source_ineligible');
    expect(out.ineligibility).toBe('not_connected');
    expect(hz.calls).toHaveLength(0);
  });

  it('the refusal vocabulary is closed and disjoint from the outcome vocabulary', () => {
    expect(new Set(PLAN_REFUSALS).size).toBe(PLAN_REFUSALS.length);
    for (const r of PLAN_REFUSALS) {
      expect(ENRICHMENT_OUTCOMES).not.toContain(r as never);
    }
  });
});
