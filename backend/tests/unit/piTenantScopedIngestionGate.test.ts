/**
 * PI — the TENANT-SCOPED ingestion gate.
 *
 * Two switches in series decide whether one organisation may ingest:
 *
 *   ENABLE_LEAD_INGESTION   the outer kill switch — closes every tenant at once
 *   feature_flags.lead_ingestion   the per-tenant switch, org-scoped
 *
 * The property that matters most is the one the previous global-only flag could
 * not give: enabling tenant A must NOT enable tenant B. Everything else here
 * exists to prove the gate cannot be opened by accident — a missing row, a
 * disabled row, a missing tenant and a THROWN lookup all have to deny.
 */

const evaluateFeatureFlag = jest.fn();

jest.mock('../../services/featureFlagService', () => ({
  evaluateFeatureFlag: (...a: unknown[]) => evaluateFeatureFlag(...a),
}));

// The write chain is doubled so a gate failure is observable as "nothing was
// attempted", not merely as an unasserted absence.
const writes: string[] = [];
jest.mock('../../services/identityResolutionService', () => ({
  resolveUnifiedPerson: jest.fn(async () => { writes.push('identity'); return { unifiedPersonId: 'person-1' }; }),
  normalizeEmail: (v: string) => v,
  normalizePhone: (v: string) => v,
}));
jest.mock('../../services/prospectIdentity/accountResolution', () => ({
  resolveOrCreateAccount: jest.fn(async () => ({ accountId: null, outcome: 'insufficient_evidence' })),
  attachPersonToAccount: jest.fn(async () => ({ attached: true, reason: 'ok' })),
}));
jest.mock('../../services/prospectIdentity/prospectResolution', () => ({
  resolveOrCreateProspect: jest.fn(async () => {
    writes.push('prospect');
    return { organizationId: 'org', prospectId: 'p-1', subjectId: 's-1', outcome: 'created', externalLeadKey: 'E-1', reason: 'created' };
  }),
}));
jest.mock('../../services/prospectIdentity/ingestionBoundary', () => ({
  ingestSourceRecord: jest.fn(async () => {
    writes.push('provenance');
    return { sourceRecordId: 'sr-1', outcome: 'created', canonicalApplied: [], canonicalWithheld: [] };
  }),
}));
jest.mock('../../services/prospectIdentity/personDuplicates', () => ({
  detectAndParkDuplicates: jest.fn(async () => ({ detected: [], parked: 0, alreadyOpen: 0 })),
}));

import {
  LEAD_INGESTION_FLAG_KEY,
  resolveLeadIngestionGate,
  isLeadIngestionEnabled,
  ingestLeadBatch,
  ingestNormalizedRecord,
} from '../../services/leadIngestion/orchestrator';
import {
  __resetLeadSourceRegistry,
  registerLeadSourceAdapter,
} from '../../services/leadIngestion/registry';
import type { AdapterResult, LeadSourceAdapter } from '../../services/leadIngestion/contracts';

const FLAG = 'ENABLE_LEAD_INGESTION';
const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';

const adapter: LeadSourceAdapter = {
  source: 'gate_test_source',
  label: 'Gate Test Source',
  capabilities: ['person_discovery'],
  translate: (raw: Record<string, unknown>, organizationId: string): AdapterResult => ({
    raw,
    normalized: {
      organizationId,
      source: 'gate_test_source',
      entityType: 'person',
      externalId: String(raw.id ?? 'EXT-1'),
      person: { email: (raw.email as string) ?? 'a@x.test', phone: null, fullName: null, externalKeys: null },
      account: null,
      observedAt: null,
    },
  }),
};

const record = (org = ORG_A): AdapterResult => adapter.translate({ id: 'EXT-1', email: 'a@x.test' }, org);

/** The flag double: enabled only for the organisations named. */
const enableFor = (...orgs: string[]) => {
  evaluateFeatureFlag.mockImplementation(async ({ organizationId }: { organizationId: string }) =>
    orgs.includes(organizationId)
      ? { enabled: true, reason: 'flag_enabled_full_rollout' }
      : { enabled: false, reason: 'no_flag_row' });
};

let flagBefore: string | undefined;
beforeAll(() => { flagBefore = process.env[FLAG]; });
afterAll(() => { if (flagBefore === undefined) delete process.env[FLAG]; else process.env[FLAG] = flagBefore; });

beforeEach(() => {
  jest.clearAllMocks();
  writes.length = 0;
  delete process.env[FLAG];
  __resetLeadSourceRegistry();
  registerLeadSourceAdapter(adapter);
  enableFor();                       // default: no tenant enabled
});

// ════════════════════════════════════════════════════════════════════════════
describe('the flag key is declared once', () => {
  it('is exactly `lead_ingestion`', () => {
    expect(LEAD_INGESTION_FLAG_KEY).toBe('lead_ingestion');
  });

  it('is the key the gate actually evaluates', async () => {
    process.env[FLAG] = 'true';
    enableFor(ORG_A);
    await resolveLeadIngestionGate(ORG_A);
    expect(evaluateFeatureFlag).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_A, flagKey: 'lead_ingestion' }),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the two switches, in series', () => {
  // A
  it('A. global OFF + tenant flag ON ⇒ DENIED', async () => {
    delete process.env[FLAG];
    enableFor(ORG_A);
    const gate = await resolveLeadIngestionGate(ORG_A);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('global_kill_switch_off');
    // The kill switch is free: it must not even reach the database.
    expect(evaluateFeatureFlag).not.toHaveBeenCalled();
  });

  // B
  it('B. global ON + tenant flag OFF ⇒ DENIED', async () => {
    process.env[FLAG] = 'true';
    evaluateFeatureFlag.mockResolvedValue({ enabled: false, reason: 'flag_disabled' });
    const gate = await resolveLeadIngestionGate(ORG_A);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('tenant_flag:flag_disabled');
  });

  // C
  it('C. global ON + tenant flag ABSENT ⇒ DENIED', async () => {
    process.env[FLAG] = 'true';
    evaluateFeatureFlag.mockResolvedValue({ enabled: false, reason: 'no_flag_row' });
    const gate = await resolveLeadIngestionGate(ORG_A);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('tenant_flag:no_flag_row');
  });

  // D
  it('D. global ON + tenant flag ON ⇒ ALLOWED', async () => {
    process.env[FLAG] = 'true';
    enableFor(ORG_A);
    const gate = await resolveLeadIngestionGate(ORG_A);
    expect(gate.allowed).toBe(true);
    expect(gate.reason).toMatch(/^tenant_flag:/);
  });

  it("'1' enables the kill switch exactly as 'true' does", async () => {
    process.env[FLAG] = '1';
    enableFor(ORG_A);
    expect((await resolveLeadIngestionGate(ORG_A)).allowed).toBe(true);
  });

  it.each(['', '  ', 'false', '0', 'yes', 'on', 'TRUE!'])(
    'an unrecognised kill-switch value %p keeps ingestion closed', async (v) => {
      process.env[FLAG] = v;
      enableFor(ORG_A);
      expect((await resolveLeadIngestionGate(ORG_A)).allowed).toBe(false);
    });
});

// ════════════════════════════════════════════════════════════════════════════
describe('E. one tenant does not enable another', () => {
  it('tenant A enabled ⇒ tenant B still DENIED', async () => {
    process.env[FLAG] = 'true';
    enableFor(ORG_A);

    const a = await resolveLeadIngestionGate(ORG_A);
    const b = await resolveLeadIngestionGate(ORG_B);

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(false);
  });

  it('the batch path honours it — B ingests nothing while A ingests', async () => {
    process.env[FLAG] = 'true';
    enableFor(ORG_A);

    const bResult = await ingestLeadBatch({
      organizationId: ORG_B, source: 'gate_test_source', records: [{ id: 'EXT-1', email: 'a@x.test' }],
    });
    expect(bResult.succeeded).toBe(0);
    expect(bResult.outcomes[0]).toMatchObject({ ok: false, rejection: 'ingestion_disabled' });
    // Nothing was attempted at all — not even the adapter's first write.
    expect(writes).toEqual([]);

    const aResult = await ingestLeadBatch({
      organizationId: ORG_A, source: 'gate_test_source', records: [{ id: 'EXT-1', email: 'a@x.test' }],
    });
    expect(aResult.succeeded).toBe(1);
    expect(writes).toContain('identity');
  });

  it('the gate is evaluated with the BATCH tenant, never a record-supplied one', async () => {
    process.env[FLAG] = 'true';
    enableFor(ORG_A);
    await ingestLeadBatch({ organizationId: ORG_A, source: 'gate_test_source', records: [{ id: 'E-1' }] });
    expect(evaluateFeatureFlag).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_A }),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('H. it fails closed', () => {
  it('a THROWN flag evaluation denies rather than propagating', async () => {
    process.env[FLAG] = 'true';
    evaluateFeatureFlag.mockRejectedValue(new Error('connection reset'));
    const gate = await resolveLeadIngestionGate(ORG_A);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/^flag_evaluation_failed:connection reset/);
  });

  it('a thrown evaluation fails the batch without writing anything', async () => {
    process.env[FLAG] = 'true';
    evaluateFeatureFlag.mockRejectedValue(new Error('timeout'));
    const r = await ingestLeadBatch({
      organizationId: ORG_A, source: 'gate_test_source', records: [{ id: 'E-1' }],
    });
    expect(r.succeeded).toBe(0);
    expect(writes).toEqual([]);
  });

  it('a missing tenant is refused — a tenant gate cannot answer without a tenant', async () => {
    process.env[FLAG] = 'true';
    enableFor(ORG_A);
    for (const org of [null, undefined, '', '   ']) {
      const gate = await resolveLeadIngestionGate(org as string | null);
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toBe('organization_required');
    }
  });

  it('a percentage rollout without a cohort key refuses — the safe direction for a write surface', async () => {
    process.env[FLAG] = 'true';
    evaluateFeatureFlag.mockResolvedValue({
      enabled: false, reason: 'cohort_key_required_for_percent_rollout',
    });
    const gate = await resolveLeadIngestionGate(ORG_A);
    expect(gate.allowed).toBe(false);
    // The gate passes cohortKey: null deliberately — ingestion is per-org.
    expect(evaluateFeatureFlag).toHaveBeenCalledWith(expect.objectContaining({ cohortKey: null }));
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the single-record surface stays closed', () => {
  it('a caller driving one record without a batch is still gated', async () => {
    process.env[FLAG] = 'true';
    enableFor(ORG_B);                       // A is NOT enabled
    const out = await ingestNormalizedRecord(record(ORG_A));
    expect(out).toMatchObject({ ok: false, rejection: 'ingestion_disabled' });
    expect(writes).toEqual([]);
  });

  it('and is allowed when its own tenant is enabled', async () => {
    process.env[FLAG] = 'true';
    enableFor(ORG_A);
    const out = await ingestNormalizedRecord(record(ORG_A));
    expect(out.ok).toBe(true);
  });

  it('a batch-supplied decision spares a per-record database read', async () => {
    process.env[FLAG] = 'true';
    enableFor(ORG_A);
    await ingestLeadBatch({
      organizationId: ORG_A,
      source: 'gate_test_source',
      records: [{ id: 'E-1' }, { id: 'E-2' }, { id: 'E-3' }],
    });
    // One evaluation for the whole batch, not one per record.
    expect(evaluateFeatureFlag).toHaveBeenCalledTimes(1);
  });

  it('the KILL SWITCH is still re-read per record, so a mid-batch flip stops the next one', async () => {
    process.env[FLAG] = 'true';
    enableFor(ORG_A);
    const first = await ingestNormalizedRecord(record(ORG_A), {
      gateDecision: { allowed: true, reason: 'precomputed' },
    });
    expect(first.ok).toBe(true);

    process.env[FLAG] = 'false';
    const second = await ingestNormalizedRecord(record(ORG_A), {
      gateDecision: { allowed: true, reason: 'precomputed' },
    });
    // Even with a precomputed ALLOW, the kill switch closes it.
    expect(second).toMatchObject({ ok: false, rejection: 'ingestion_disabled' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('G. the surrounding contract is unchanged', () => {
  it('the global helper still exists and is still global', () => {
    delete process.env[FLAG];
    expect(isLeadIngestionEnabled()).toBe(false);
    process.env[FLAG] = 'true';
    expect(isLeadIngestionEnabled()).toBe(true);
    expect(isLeadIngestionEnabled.length).toBe(0);   // still takes no tenant
  });

  it('no second flag system was introduced — evaluation goes through featureFlagService', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/leadIngestion/orchestrator.ts'), 'utf8');
    expect(src).toContain("from '../featureFlagService'");
    // No direct table access, no parallel flag store.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain("ownedDbTable('feature_flags')");
  });

  it('the routes keep UUID validation, membership and capability enforcement', () => {
    const fs = require('fs'); const path = require('path');
    for (const r of ['manual', 'crm', 'csv']) {
      const src = fs.readFileSync(path.join(__dirname, `../../../pages/api/lead-ingestion/${r}.ts`), 'utf8');
      expect(src).toContain('UUID.test(companyId)');
      expect(src).toContain('enforceCompanyAccess');
      expect(src).toContain('PROSPECT_INGEST');
      expect(src).toContain('resolveLeadIngestionGate');
    }
  });

  it('the routes evaluate the tenant gate AFTER authorization, never before', () => {
    const fs = require('fs'); const path = require('path');
    for (const r of ['manual', 'crm', 'csv']) {
      const src = fs.readFileSync(path.join(__dirname, `../../../pages/api/lead-ingestion/${r}.ts`), 'utf8');
      const kill = src.indexOf('isLeadIngestionEnabled()');
      const member = src.indexOf('enforceCompanyAccess({');
      const cap = src.indexOf('requireCapability(req, res, {');
      const tenant = src.indexOf('resolveLeadIngestionGate(companyId)');
      // kill switch → membership → capability → tenant flag
      expect(kill).toBeGreaterThan(-1);
      expect(member).toBeGreaterThan(kill);
      expect(cap).toBeGreaterThan(member);
      expect(tenant).toBeGreaterThan(cap);
    }
  });
});
