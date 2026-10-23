/**
 * PI-INGEST-CONSOLIDATION-001-A — golden master for the LEGACY CRM ingestion path.
 *
 * This test records WHAT `crmIngestionService` does. It makes no claim that any
 * of it is desirable, and it must not be "corrected" — its whole value is that a
 * later consolidation can prove it preserved every side effect, including the
 * awkward ones. If a future change alters behaviour deliberately, this file is
 * updated in the same commit and the diff is the record of what changed.
 *
 * ─── WHY PART OF IT READS SOURCE TEXT ─────────────────────────────────────
 * `ingestCrmData` composes fourteen collaborators — the provider governor, the
 * unified-ingestion runner, W1 identity, the LI-2 boundary, four table writers,
 * touchpoints and the lead-intelligence facade. Driving it end-to-end requires a
 * live database, which is a T2 concern; mocking all fourteen would produce a test
 * that asserts the mocks. So the side-effect SET and its ORDER are pinned from
 * the source, which is the only level at which "this path writes four tables in
 * this order" is observable without a database. The repository already uses this
 * technique for the cron scheduling contract.
 *
 * Everything that IS pure — the run key — is exercised for real.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { buildCrmRunKey } from '../../services/crmIngestionService';

const ROOT = join(__dirname, '..', '..', '..');
const SERVICE = readFileSync(join(ROOT, 'backend/services/crmIngestionService.ts'), 'utf8');
const SCHEDULER = readFileSync(join(ROOT, 'backend/services/ingestionScheduler.ts'), 'utf8');

/** Executable statements only — a collaborator named in a comment proves nothing. */
const code = (src: string): string =>
  src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const SERVICE_CODE = code(SERVICE);
const SCHEDULER_CODE = code(SCHEDULER);

/** Index of the first executable occurrence, for ordering assertions. */
const at = (src: string, needle: string): number => src.indexOf(needle);

describe('legacy CRM golden master — run key (behavioural)', () => {
  it('is deterministic for identical input', () => {
    const a = buildCrmRunKey({ companyId: 'org-1', csvContent: 'email\na@b.c' });
    const b = buildCrmRunKey({ companyId: 'org-1', csvContent: 'email\na@b.c' });
    expect(a).toBe(b);
  });

  it('is tenant-scoped — the same payload under another tenant is a different run', () => {
    const a = buildCrmRunKey({ companyId: 'org-1', csvContent: 'email\na@b.c' });
    const b = buildCrmRunKey({ companyId: 'org-2', csvContent: 'email\na@b.c' });
    expect(a).not.toBe(b);
  });

  it('distinguishes a rows payload from a csv payload', () => {
    const rows = buildCrmRunKey({ companyId: 'org-1', rows: [{ email: 'a@b.c' }] });
    const csv = buildCrmRunKey({ companyId: 'org-1', csvContent: 'email\na@b.c' });
    expect(rows).not.toBe(csv);
  });

  it('keys a rows payload on COUNT, so different rows of equal length collide', () => {
    // CHARACTERIZED, NOT ENDORSED. The key hashes `rows.length`, never the row
    // contents, so two different single-row imports for one tenant share a run
    // key. Any consolidation that keeps run-level idempotency inherits this.
    const a = buildCrmRunKey({ companyId: 'org-1', rows: [{ email: 'a@b.c' }] });
    const b = buildCrmRunKey({ companyId: 'org-1', rows: [{ email: 'z@y.x' }] });
    expect(a).toBe(b);
  });

  it('keys a csv payload on LENGTH, so different CSVs of equal length collide', () => {
    // Same characterization for the file-shaped input: content is not hashed.
    const a = buildCrmRunKey({ companyId: 'org-1', csvContent: 'aaaaaaaa' });
    const b = buildCrmRunKey({ companyId: 'org-1', csvContent: 'bbbbbbbb' });
    expect(a).toBe(b);
  });

  it('treats an absent payload as a distinct, stable run key', () => {
    // This is the shape the scheduler actually produces today: production has no
    // `crm` integration, so `config` is empty and both inputs are undefined.
    const a = buildCrmRunKey({ companyId: 'org-1' });
    const b = buildCrmRunKey({ companyId: 'org-1' });
    expect(a).toBe(b);
    expect(a).not.toBe(buildCrmRunKey({ companyId: 'org-1', rows: [] }));
  });
});

describe('legacy CRM golden master — the side-effect set', () => {
  it('writes exactly these three canonical tables and no others', () => {
    // 003-B-R1: `leads` left this set. The CRM path no longer writes the legacy
    // web-form table; the three canonical writes are unchanged.
    const written = ['canonical_users', 'canonical_leads', 'canonical_revenue_events'];
    for (const t of written) {
      expect(SERVICE_CODE).toContain(`ownedDbTable('${t}')`);
    }
    // Tables it must NOT write: LI-4D's, and now the legacy web-form table too.
    // Stated as an explicit negative rather than by dropping the old assertion,
    // so the retirement is pinned instead of merely untested.
    for (const t of ['leads', 'prospect_accounts', 'prospect_score_evaluations', 'person_duplicate_candidates']) {
      expect(SERVICE_CODE).not.toContain(`ownedDbTable('${t}')`);
    }
  });

  it('003-B-R1: every behaviour retired with the legacy helper is gone', () => {
    expect(SERVICE_CODE).not.toContain('upsertLegacyLead');
    expect(SERVICE_CODE).not.toContain('onLeadEnrichmentChanged');
    expect(SERVICE_CODE).not.toContain('ensureUnifiedPerson');
    expect(SERVICE_CODE).not.toContain('IDENTITY_REQUIRED_FOR_LEAD');
  });

  it('003-B-R1: the four live NON-CRM lead-intelligence triggers are untouched', () => {
    // The trigger subsystem survives; only the CRM call site went. Asserted from
    // the callers' own sources so a regression there fails here.
    const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
    expect(read('backend/services/leadCaptureService.ts')).toContain('triggerLeadIntelligence');
    expect(read('pages/api/leads/index.ts')).toContain('triggerLeadIntelligence');
    expect(read('pages/api/website-events/track.ts')).toContain('triggerVisitorSessionIntelligence');
    // and the trigger implementation itself is intact
    expect(read('backend/services/leadIntelligenceActivation.ts')).toContain('export function onLeadEnrichmentChanged');
  });

  it('resolves identity through W1 rather than its own matcher', () => {
    expect(SERVICE_CODE).toContain('resolveUnifiedPerson');
  });

  it('records LI-2 provenance, and does so BEFORE the derived writes', () => {
    expect(SERVICE_CODE).toContain('ingestSourceRecord');
    // Compared inside the ingest loop only. Measuring across the whole file
    // would find each helper's DEFINITION, which sits above its call site and
    // says nothing about execution order.
    const loop = SERVICE_CODE.slice(at(SERVICE_CODE, 'async function ingestCrmRows'));
    const provenance = at(loop, 'await recordCrmProspectProvenance({');
    const canonicalUser = at(loop, 'await upsertCanonicalUser(');
    const canonicalLead = at(loop, 'await upsertCanonicalLead({');
    expect(provenance).toBeGreaterThan(-1);
    expect(canonicalUser).toBeGreaterThan(-1);
    expect(canonicalLead).toBeGreaterThan(-1);
    expect(provenance).toBeLessThan(canonicalUser);
    expect(provenance).toBeLessThan(canonicalLead);
  });

  it('emits touchpoints', () => {
    expect(SERVICE_CODE).toContain('bulkCreateTouchpoints');
  });

  it("adopts the lead into the lead-intelligence facade under the 'crm' channel", () => {
    expect(SERVICE_CODE).toContain("adoptLead('crm'");
  });

  it('authorizes and meters the provider call before loading any row', () => {
    expect(SERVICE_CODE).toContain("authorizeProviderCall({ providerId: 'commercial'");
    expect(SERVICE_CODE).toContain('recordProviderUsage');
    expect(at(SERVICE_CODE, 'authorizeProviderCall')).toBeLessThan(at(SERVICE_CODE, 'await loadRows(input)'));
  });

  it('refuses to proceed when the governor blocks', () => {
    expect(SERVICE_CODE).toContain('provider_governor_blocked:commercial:');
  });

  it('routes a csvContent payload through the unified ingestion runner with the run key', () => {
    expect(SERVICE_CODE).toContain('ingestUnifiedData');
    expect(SERVICE_CODE).toContain('idempotencyKey: buildCrmRunKey(input)');
  });

  it('returns the documented result counters', () => {
    for (const field of ['leadsProcessed', 'leadsInserted', 'revenueEventsInserted', 'touchpointsCreated']) {
      expect(SERVICE).toContain(field);
    }
    expect(SERVICE_CODE).toContain("source: 'crm'");
  });

  it('scopes every canonical write to the tenant', () => {
    // Each write helper filters on company_id; a write without it would be a
    // cross-tenant write, which `ownedDbTable` alone does not prevent.
    expect(SERVICE_CODE).toContain("eq('company_id'");
  });

  it('treats an empty payload as zero rows rather than an error', () => {
    // `loadRows` returns [] when neither rows nor csvContent is supplied, which
    // is exactly what the scheduler passes today.
    expect(SERVICE_CODE).toContain('return [];');
  });
});

describe('legacy CRM golden master — scheduler operational semantics', () => {
  it('runs the CRM source through the ingestion-run lifecycle', () => {
    for (const fn of ['beginIngestionRun', 'completeIngestionRun', 'findIngestionRunByKey', 'hasRunningIngestion', 'setDataSourceStatus']) {
      expect(SCHEDULER_CODE).toContain(fn);
    }
  });

  it('exposes retry and validation surfaces', () => {
    expect(SCHEDULER_CODE).toContain('getRetryableFailedRuns');
    expect(SCHEDULER_CODE).toContain('retryFailedIngestionForCompany');
    expect(SCHEDULER_CODE).toContain('validateIngestionOutput');
  });

  it('includes crm in the default source set', () => {
    expect(SCHEDULER_CODE).toMatch(/sources \?\? \[[^\]]*'crm'[^\]]*\]/);
  });

  it('reads the CRM payload from integration config or an explicit override', () => {
    expect(SCHEDULER_CODE).toContain('csvContent');
    expect(SCHEDULER_CODE).toContain('ingestCrmData({');
  });

  it('does NOT route the CRM source through the LI-4D orchestrator', () => {
    // The defining property of the legacy path. When consolidation happens this
    // assertion is the one that must be deliberately inverted.
    expect(SCHEDULER_CODE).not.toContain('ingestLeadBatch');
    expect(SCHEDULER_CODE).not.toContain('leadIngestion/orchestrator');
  });
});

describe('legacy CRM golden master — what the legacy path does NOT do', () => {
  it('performs no account resolution', () => {
    expect(SERVICE_CODE).not.toContain('resolveOrCreateAccount');
    expect(SERVICE_CODE).not.toContain('attachPersonToAccount');
  });

  it('performs no WS-1 prospect resolution', () => {
    expect(SERVICE_CODE).not.toContain('resolveOrCreateProspect');
  });

  it('performs no LI-4C duplicate detection or parking', () => {
    expect(SERVICE_CODE).not.toContain('detectAndParkDuplicates');
  });

  it('applies no capability check and no lead-ingestion feature gate', () => {
    expect(SERVICE_CODE).not.toContain('requireCapability');
    expect(SERVICE_CODE).not.toContain('resolveLeadIngestionGate');
    expect(SERVICE_CODE).not.toContain('isLeadIngestionEnabled');
  });
});
