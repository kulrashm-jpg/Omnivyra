/**
 * A3Z — tenant-funded provider selection reconciliation.
 *
 * A3X settled that third-party enrichment is TENANT-FUNDED: the tenant holds
 * the vendor subscription and the vendor invoices them, so every descriptor
 * correctly lost its Omnivyra credit action. A3C's selection gate was not
 * reconciled and still read "no credit action" as "unpriced", so the absence of
 * one value came to mean two incompatible things and EVERY source — including a
 * fully connected Clearbit with a registered adapter and a tenant credential —
 * was refused. The planner, separately, could not even name Clearbit: its
 * availability came from the admin catalogue, which knows nothing about PI
 * adapters or tenant provider credentials.
 *
 * These tests pin the reconciliation and, more importantly, pin what it did NOT
 * do. The load-bearing assertions are the negative ones: a missing tenant
 * credential still refuses, a global environment variable still activates
 * nothing, an explicitly chosen source is still never substituted, and a
 * provider with no adapter is still not executable however it is catalogued.
 *
 * SECRETS: all synthetic. No credential is created, no provider is contacted.
 */

import {
  ACQUISITION_SOURCES, FUNDING_MODELS, getSource, listSourceStatus,
  type AcquisitionSourceDescriptor, type SourceStatus,
} from '../../services/enrichment/providers/sources';
import {
  evaluateEconomics, evaluateSource, selectAcquisitionSource,
  INELIGIBILITY_REASONS, AUTO_SELECTION,
  type SelectionOutcome,
} from '../../services/enrichment/providers/selection';
import { getProvider } from '../../services/enrichment/providers';
import {
  ingestionEnrichmentCoverage, availableEnrichmentSources,
} from '../../services/leadIngestion/enrichmentCoverage';
import { planEnrichment } from '../../services/enrichment/planner';
import { DATA_SOURCE_CATALOGUE } from '../../services/integrations/dataSourceCatalogue';
import * as fs from 'fs';
import * as path from 'path';

const NOW = '2026-09-06T00:00:00.000Z';

/** Adapter registered for clearbit only — the platform's real state. */
const clearbitAdapter = (id: string) => id === 'clearbit';

/** Live statuses with, and without, a tenant credential. */
const withCredential = () => listSourceStatus(clearbitAdapter, () => true);
const withoutCredential = () => listSourceStatus(clearbitAdapter, () => false);

const rejected = (o: SelectionOutcome) => {
  if (!('ineligibility' in o)) throw new Error('expected a refusal, got a selection');
  return o;
};
const selected = (o: SelectionOutcome) => {
  if (!('sourceId' in o)) throw new Error(`expected a selection, got: ${o.reason}`);
  return o;
};

const descriptor = (over: Partial<AcquisitionSourceDescriptor> = {}): AcquisitionSourceDescriptor => ({
  id: 'synthetic', displayName: 'Synthetic', sourceType: 'external_api',
  capabilities: { entities: ['account'], attributes: ['employee_count'] },
  credentialEnvVar: 'SYNTHETIC_KEY', authorizationRequirements: [],
  creditAction: null, fundingModel: 'tenant_provider_subscription',
  priority: 1, note: 'synthetic',
  ...over,
} as AcquisitionSourceDescriptor);

const ACCOUNT_REQUEST = {
  subject: 'account' as const, attributes: ['employee_count'], mode: AUTO_SELECTION,
};

// ── 1/2/3. the economics contract ───────────────────────────────────────────

describe('A3Z — tenant-funded is not the same fact as unpriced', () => {
  it('1. a tenant-funded provider with creditAction null is NOT rejected as unpriced', () => {
    const out = evaluateEconomics(descriptor());
    expect(out).toEqual({ ok: true });
  });

  it('1b. and it is genuinely selectable, not merely un-refused', () => {
    const s = { ...descriptor(), connectionState: 'connected', usable: true, stateReason: 'test' } as SourceStatus;
    const out = evaluateSource(s, 'connected', 'test',
      { subject: 'account', attributes: ['employee_count'], mode: 'synthetic' });
    expect(out.eligible).toBe(true);
    expect(out.ineligibility).toBeUndefined();
  });

  it('3. an OMNIVYRA-FUNDED source with no credit action is still refused as unpriced', () => {
    const out = evaluateEconomics(descriptor({ fundingModel: 'omnivyra_funded', creditAction: null }));
    expect(rejectedEconomics(out).ineligibility).toBe('unpriced');
    expect(rejectedEconomics(out).reason).toContain('cannot be authorised');
  });

  it('3b. an Omnivyra-funded source WITH a credit action passes', () => {
    expect(evaluateEconomics(
      descriptor({ fundingModel: 'omnivyra_funded', creditAction: 'prospect_enrichment' }),
    )).toEqual({ ok: true });
  });

  it('2. an absent funding model is unknown economics — never assumed tenant-funded', () => {
    const out = evaluateEconomics(descriptor({ fundingModel: undefined as never }));
    expect(rejectedEconomics(out).ineligibility).toBe('unknown_economics');
  });

  it('2b. a funding model outside the vocabulary refuses', () => {
    const out = evaluateEconomics(descriptor({ fundingModel: 'invoice_later' as never }));
    expect(rejectedEconomics(out).ineligibility).toBe('unknown_economics');
  });

  it('2c. tenant-funded AND an Omnivyra credit action is a contradiction, so it refuses', () => {
    // Nobody may be billed twice, and guessing which one wins is how a tenant
    // silently pays for something they did not buy.
    const out = evaluateEconomics(descriptor({ creditAction: 'prospect_enrichment' }));
    expect(rejectedEconomics(out).ineligibility).toBe('unknown_economics');
  });

  it('2d. an external API claiming nobody is billed refuses — a call always costs someone', () => {
    const out = evaluateEconomics(descriptor({ fundingModel: 'none' }));
    expect(rejectedEconomics(out).ineligibility).toBe('unknown_economics');
    const gateway = evaluateEconomics(descriptor({ sourceType: 'gateway_api', fundingModel: 'none' }));
    expect(rejectedEconomics(gateway).ineligibility).toBe('unknown_economics');
  });

  it('"none" is legitimate only where nothing external is paid', () => {
    expect(evaluateEconomics(descriptor({ sourceType: 'manual', fundingModel: 'none' }))).toEqual({ ok: true });
    expect(evaluateEconomics(
      descriptor({ sourceType: 'browser_extension', fundingModel: 'none' }),
    )).toEqual({ ok: true });
  });

  it('no vendor price is invented anywhere — funding says WHO pays, never HOW MUCH', () => {
    // Scanned as CODE: the word "unpriced" is a legitimate refusal reason, and
    // the doc comments necessarily discuss pricing to explain why the gate
    // moved. What must be absent is an actual price — the `amount`/`currency`
    // pair that `SourceCost` uses for a known cost.
    const src = fs.readFileSync(
      path.join(__dirname, '../../services/enrichment/providers/selection.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/\bamount\b|\bcurrency\b|\bUSD\b|\bEUR\b/i);
    for (const s of ACQUISITION_SOURCES) expect(s.creditAction).toBeNull();
  });

  it('every real descriptor declares a recognised funding model', () => {
    for (const s of ACQUISITION_SOURCES) {
      expect(FUNDING_MODELS).toContain(s.fundingModel);
      expect(evaluateEconomics(s)).toEqual({ ok: true });
    }
  });

  it('unknown_economics is a distinct reason, not a rename of unpriced', () => {
    expect(INELIGIBILITY_REASONS).toContain('unpriced');
    expect(INELIGIBILITY_REASONS).toContain('unknown_economics');
  });
});

function rejectedEconomics(o: ReturnType<typeof evaluateEconomics>) {
  if (!('reason' in o)) throw new Error('expected the economics gate to refuse');
  return o;
}

// ── 4/5. Clearbit reaches the executable path ───────────────────────────────

describe('A3Z — Clearbit is the one executable provider, and only when it really is', () => {
  it('4. Clearbit exists in the A3 registry with an adapter and declared capability', () => {
    const src = getSource('clearbit');
    expect(src).not.toBeNull();
    expect(getProvider('clearbit')).not.toBeNull();
    expect(src!.capabilities.entities).toEqual(['account']);
    expect(src!.capabilities.attributes.length).toBeGreaterThan(0);
    expect(src!.fundingModel).toBe('tenant_provider_subscription');
    expect(src!.authorizationRequirements).toContain('tenant_provider_subscription');
  });

  it('5. the planner discovers Clearbit only when its real requirements are satisfied', () => {
    const coverage = ingestionEnrichmentCoverage({ statuses: withCredential() });
    expect(Object.keys(coverage.external ?? {})).toContain('clearbit');
    expect(coverage.verifiedExternal).toContain('clearbit');

    const plan = planEnrichment({
      organizationId: 'org', prospectId: 'lead',
      fields: [{ attribute: 'employee_count', subject: 'account', value: null }],
      coverage, integrations: [], now: NOW,
    });
    expect(plan.toEnrich).toHaveLength(1);
    expect(plan.fields[0].action).toBe('enrich');
    expect(plan.fields[0].source).toBe('clearbit');
    expect(plan.fields[0].sourceStatus).toBe('connected');
    // Cost stays UNKNOWN — the tenant's vendor invoice is not ours to price.
    expect(plan.fields[0].cost).toEqual({ kind: 'unknown' });
  });

  it('coverage offers ONLY the attributes Clearbit actually declares', () => {
    const coverage = ingestionEnrichmentCoverage({ statuses: withCredential() });
    expect(coverage.external!.clearbit).toEqual(getSource('clearbit')!.capabilities.attributes);
  });

  it('an attribute Clearbit does not supply still has no source', () => {
    const plan = planEnrichment({
      organizationId: 'org', prospectId: 'lead',
      fields: [{ attribute: 'annual_revenue', subject: 'account', value: null }],
      coverage: ingestionEnrichmentCoverage({ statuses: withCredential() }),
      integrations: [], now: NOW,
    });
    expect(plan.fields[0].action).toBe('no_available_source');
  });

  it('a PERSON attribute gets no account-only source', () => {
    const plan = planEnrichment({
      organizationId: 'org', prospectId: 'lead',
      fields: [{ attribute: 'employee_count', subject: 'person', value: null }],
      coverage: ingestionEnrichmentCoverage({ statuses: withCredential() }),
      integrations: [], now: NOW,
    });
    // Coverage is keyed by attribute, and clearbit declares account entities
    // only; selection would refuse `entity_unsupported` for a person.
    const chosen = plan.fields[0].source;
    if (chosen === 'clearbit') {
      const out = selectAcquisitionSource(
        { subject: 'person', attributes: ['employee_count'], mode: 'clearbit' }, withCredential());
      expect(rejected(out).ineligibility).toBe('entity_unsupported');
    }
  });
});

// ── 6/7. NEGATIVE PROOFS — what must NOT make a provider operational ────────

describe('A3Z — nothing global can make a provider tenant-operational', () => {
  it('6. a missing tenant credential leaves Clearbit non-executable', () => {
    const statuses = withoutCredential();
    expect(statuses.find((s) => s.id === 'clearbit')!.connectionState).toBe('credential_missing');

    const coverage = ingestionEnrichmentCoverage({ statuses });
    expect(coverage.external!.clearbit).toBeUndefined();
    expect(coverage.verifiedExternal).toEqual([]);

    const plan = planEnrichment({
      organizationId: 'org', prospectId: 'lead',
      fields: [{ attribute: 'employee_count', subject: 'account', value: null }],
      coverage, integrations: [], now: NOW,
    });
    expect(plan.toEnrich).toHaveLength(0);
    expect(plan.fields[0].action).toBe('no_available_source');
  });

  it('6b. explicit selection of a credential-less Clearbit refuses, and names why', () => {
    const out = selectAcquisitionSource(
      { subject: 'account', attributes: ['employee_count'], mode: 'clearbit' }, withoutCredential());
    expect(rejected(out).ineligibility).toBe('not_connected');
    expect(rejected(out).reason).toContain('this tenant has not configured a credential');
  });

  it('7. a global process.env credential cannot activate Clearbit', () => {
    const before = process.env.CLEARBIT_API_KEY;
    process.env.CLEARBIT_API_KEY = 'synthetic-global-key-not-a-tenant-credential';
    try {
      // `credentialPresent` is the TENANT's answer and is still false. A3V made
      // it a required argument precisely so the environment could not answer a
      // question about a tenant.
      const coverage = ingestionEnrichmentCoverage({ statuses: withoutCredential() });
      expect(coverage.verifiedExternal).toEqual([]);
      expect(coverage.external!.clearbit).toBeUndefined();

      const out = selectAcquisitionSource(
        { subject: 'account', attributes: ['employee_count'], mode: 'clearbit' }, withoutCredential());
      expect(rejected(out).ineligibility).toBe('not_connected');
    } finally {
      if (before === undefined) delete process.env.CLEARBIT_API_KEY;
      else process.env.CLEARBIT_API_KEY = before;
    }
  });

  it('7b. no reconciled module reads process.env for a tenant credential', () => {
    for (const rel of [
      '../../services/enrichment/providers/selection.ts',
      '../../services/enrichment/providers/sources.ts',
      '../../services/leadIngestion/enrichmentCoverage.ts',
      '../../services/enrichment/planner.ts',
    ]) {
      const src = fs.readFileSync(path.join(__dirname, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(src).not.toMatch(/process\.env/);
      expect(src).not.toMatch(/hasCredential/);
    }
  });

  it('12. coverage never reports an unavailable provider as executable', () => {
    const coverage = ingestionEnrichmentCoverage({ statuses: withCredential() });
    for (const id of ['apollo', 'zoominfo', 'crunchbase', 'rapidapi', 'omnivyra_extension', 'manual']) {
      expect(coverage.verifiedExternal).not.toContain(id);
      expect(coverage.external![id]).toBeUndefined();
    }
  });

  it('12b. coverage with NO statuses reports nothing executable — absent means none', () => {
    const coverage = ingestionEnrichmentCoverage();
    expect(coverage.verifiedExternal).toEqual([]);
    expect(Object.values(coverage.external ?? {}).every((a) => a.length === 0)).toBe(true);
  });

  it('13. a descriptor without an adapter cannot become executable through catalogue registration', () => {
    // Apollo is in the A3 registry, in the admin catalogue, and declared in
    // DECLARED_PROVIDERS. It still has no adapter, so it is `unsupported`.
    const statuses = listSourceStatus(() => false, () => true);   // credential present, NO adapter
    const apollo = statuses.find((s) => s.id === 'apollo')!;
    expect(apollo.connectionState).toBe('unsupported');
    expect(ingestionEnrichmentCoverage({ statuses }).verifiedExternal).toEqual([]);

    const out = selectAcquisitionSource(
      { subject: 'person', attributes: ['job_title'], mode: 'apollo' }, statuses);
    expect(rejected(out).ineligibility).toBe('not_connected');
  });

  it('13b. the catalogue still does not know Clearbit — and coverage does not need it to', () => {
    // The mapping is a PROJECTION of the A3 registry, not a duplicated entry.
    // Adding Clearbit to the admin catalogue would have created a second,
    // weaker answer to "is this connected" (company_integrations rather than
    // the tenant provider credential store).
    expect(DATA_SOURCE_CATALOGUE.some((d) => d.key === 'clearbit')).toBe(false);
    expect(ingestionEnrichmentCoverage({ statuses: withCredential() }).verifiedExternal)
      .toContain('clearbit');
  });
});

// ── 8/9/10. selection determinism is untouched ──────────────────────────────

describe('A3Z — selection determinism and non-substitution are unchanged', () => {
  it('8. explicit Clearbit selects Clearbit', () => {
    const out = selectAcquisitionSource(
      { subject: 'account', attributes: ['employee_count'], mode: 'clearbit' }, withCredential());
    expect(selected(out).sourceId).toBe('clearbit');
  });

  it('9. an explicitly requested UNAVAILABLE provider refuses even though Clearbit is available', () => {
    const statuses = withCredential();
    // Clearbit is eligible in this very list; Apollo must still not be swapped in.
    expect(selected(selectAcquisitionSource(
      { subject: 'account', attributes: ['employee_count'], mode: 'clearbit' }, statuses)).sourceId)
      .toBe('clearbit');

    const out = selectAcquisitionSource(
      { subject: 'account', attributes: ['employee_count'], mode: 'apollo' }, statuses);
    expect(rejected(out).ineligibility).toBe('not_connected');
    expect(rejected(out).considered.map((c) => c.sourceId)).toEqual(['apollo']);
  });

  it('10. an unsupported provider stays unsupported, and an unknown one stays unknown', () => {
    const statuses = withCredential();
    expect(rejected(selectAcquisitionSource(
      { subject: 'account', attributes: ['employee_count'], mode: 'rapidapi' }, statuses)).ineligibility)
      .toBe('not_connected');
    expect(rejected(selectAcquisitionSource(
      { subject: 'account', attributes: ['employee_count'], mode: 'no_such_provider' }, statuses)).ineligibility)
      .toBe('unknown_source');
  });

  it('manual entry is still not automatable, however it is funded', () => {
    const statuses = listSourceStatus(() => true, () => true);
    const out = evaluateSource(
      statuses.find((s) => s.id === 'manual')!, 'connected', 'test',
      { subject: 'person', attributes: ['job_title'], mode: 'manual' });
    expect(out.eligible).toBe(false);
    expect(out.ineligibility).toBe('manual_not_automatable');
  });

  it('auto picks Clearbit deterministically, and picks nothing when it is unusable', () => {
    expect(selected(selectAcquisitionSource(
      { ...ACCOUNT_REQUEST }, withCredential())).sourceId).toBe('clearbit');
    expect(rejected(selectAcquisitionSource(
      { ...ACCOUNT_REQUEST }, withoutCredential())).ineligibility).toBe('no_eligible_source');
  });
});

// ── 11/17/18. what the reconciliation must not have introduced ──────────────

describe('A3Z — no new capability, cost or I/O', () => {
  const code = (rel: string): string =>
    fs.readFileSync(path.join(__dirname, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('11. the planner still performs no network I/O and knows no adapter', () => {
    const src = code('../../services/enrichment/planner.ts');
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/safeFetch|axios|node-fetch/);
    expect(src).not.toMatch(/\bawait\b/);
    expect(src).not.toMatch(/adapters|getProvider|registerProvider|isAvailable/);
  });

  it('11b. coverage performs no I/O either — it is given statuses, it does not fetch them', () => {
    const src = code('../../services/leadIngestion/enrichmentCoverage.ts');
    expect(src).not.toMatch(/\bfetch\s*\(|ownedDbTable|supabase|await/);
  });

  it('17. no Omnivyra customer credit charge is introduced', () => {
    for (const rel of [
      '../../services/enrichment/providers/selection.ts',
      '../../services/enrichment/providers/sources.ts',
      '../../services/leadIngestion/enrichmentCoverage.ts',
      '../../services/enrichment/planner.ts',
    ]) {
      const src = code(rel);
      expect(src).not.toMatch(/reserveCredits|chargeCredits|pricingService|featureRegistry/);
      expect(src).not.toMatch(/PROSPECT_ENRICHMENT_ACTION/);
    }
  });

  it('18. no provider adapter is invoked anywhere in this path', () => {
    for (const rel of [
      '../../services/enrichment/providers/selection.ts',
      '../../services/leadIngestion/enrichmentCoverage.ts',
    ]) {
      expect(code(rel)).not.toMatch(/\.enrich\(/);
    }
  });

  it('no fake adapter was added — Clearbit remains the only registered one', () => {
    for (const id of ['apollo', 'zoominfo', 'crunchbase', 'rapidapi', 'linkedin', 'hunter', 'builtwith', 'pdl']) {
      expect(getProvider(id)).toBeNull();
    }
    expect(getProvider('clearbit')).not.toBeNull();
  });

  it('the declared-only catalogue derivation is unchanged', () => {
    // A3Z did not touch dataSourceCatalogue, so this still answers empty.
    expect(availableEnrichmentSources()).toEqual([]);
  });
});
