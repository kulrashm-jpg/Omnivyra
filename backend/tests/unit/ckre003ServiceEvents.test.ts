/**
 * CKRE-003 §8/§9/§10 — knowledge events + canonical API.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../observability', () => ({ recordRawCounter: jest.fn() }));
jest.mock('../../services/signupEventService', () => ({
  SIGNUP_EVENT_SCHEMA_VERSION: '1.1', ensureSignupCorrelationId: jest.fn(async () => 'journey-shared'),
}));

import { supabase } from '../../db/supabaseClient';
import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import { recordRawCounter } from '../../observability';
import { emitKnowledgeEvent, metricForKnowledgeEvent, KNOWLEDGE_EVENT_CAPABILITY_PREFIX } from '../../services/knowledge/knowledgeEventService';
import { captureKnowledgeVersion, getKnowledgeHistory, rollbackKnowledge, getKnowledgeByVersion } from '../../services/knowledge/companyKnowledgeService';

const mockFrom = (supabase as any).from as jest.Mock;
const mockLog = logSecurityEvent as jest.MockedFunction<typeof logSecurityEvent>;
const mockCounter = recordRawCounter as jest.Mock;

/** Chainable supabase mock: select/eq/maybeSingle returns configured row; update/eq captures + resolves. */
function stub(row: Record<string, unknown> | null, onUpdate?: (u: any) => void) {
  mockFrom.mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: row }) }),
    }),
    update: jest.fn((u: any) => { onUpdate?.(u); return { eq: jest.fn().mockResolvedValue({ error: null }) }; }),
  });
}

const PROFILE = {
  company_id: 'org1', name: 'Acme', industry: 'SaaS', overall_confidence: 80,
  report_settings: {
    knowledge_version: { version: 3 },
    discovered_metadata: { language: 'en' },
  },
};

describe('CKRE-003 §8 — knowledge events reuse the AUTH-001 envelope', () => {
  test('capability knowledge.<Event>, versioned envelope, correlation', async () => {
    await emitKnowledgeEvent({ event: 'KnowledgeCreated', outcome: 'allowed', correlationId: 'cid', companyId: 'org1', version: 4, reason: 'r' });
    const rowArg = mockLog.mock.calls[0][0];
    expect(rowArg.capability).toBe(`${KNOWLEDGE_EVENT_CAPABILITY_PREFIX}KnowledgeCreated`);
    expect(rowArg.resourceId).toBe('cid');
    const env = JSON.parse(String(rowArg.reason));
    expect(env.v).toBe('1.1');
    expect(env.state).toBe('v4');
  });
  test('event → metric mapping; never throws', async () => {
    expect(metricForKnowledgeEvent('KnowledgeCreated')).toBe('versions_created');
    expect(metricForKnowledgeEvent('KnowledgeRolledBack')).toBe('rollback_count');
    expect(metricForKnowledgeEvent('KnowledgeCompared')).toBe('comparison_count');
    await emitKnowledgeEvent({ event: 'KnowledgeSnapshotCreated', outcome: 'allowed', correlationId: 'c', companyId: 'o', version: 1 });
    expect(mockCounter).toHaveBeenCalledWith('knowledge.snapshot_count', 1, {});
    mockLog.mockRejectedValueOnce(new Error('down'));
    await expect(emitKnowledgeEvent({ event: 'KnowledgeArchived', outcome: 'allowed', correlationId: 'c', companyId: 'o' })).resolves.toBeUndefined();
  });
});

describe('CKRE-003 §10 — canonical API', () => {
  test('captureKnowledgeVersion composes + writes an immutable snapshot', async () => {
    let written: any = null;
    stub(PROFILE, (u) => { written = u; });
    const r = await captureKnowledgeVersion({ companyId: 'org1', version: 4, refreshReason: 'major_change', refreshPolicy: 'REFRESH_FULL', dependencies: ['BUSINESS'] });
    expect(r.ok).toBe(true);
    expect(r.version).toBe(4);
    const snaps = written.report_settings.knowledge_snapshots;
    expect(snaps[0].entity.version).toBe(4);
    expect(snaps[0].entity.lifecycle).toBe('ACTIVE');
    expect(snaps[0].domains.IDENTITY.fields.name).toBe('Acme'); // composed knowledge captured
    // event emitted
    const capabilities = mockLog.mock.calls.map((c) => c[0].capability);
    expect(capabilities).toContain('knowledge.KnowledgeCreated');
    expect(capabilities).toContain('knowledge.KnowledgeSnapshotCreated');
  });

  test('captureKnowledgeVersion ignores invalid version / missing profile (fail-safe)', async () => {
    stub(null);
    expect((await captureKnowledgeVersion({ companyId: 'org1', version: 0, refreshReason: 'r', refreshPolicy: 'x' })).ok).toBe(false);
    expect((await captureKnowledgeVersion({ companyId: 'org1', version: 4, refreshReason: 'r', refreshPolicy: 'x' })).ok).toBe(false);
  });

  test('getKnowledgeHistory derives lifecycle per version', async () => {
    const withSnaps = {
      ...PROFILE,
      report_settings: {
        knowledge_version: { version: 3 },
        knowledge_snapshots: [
          { entity: { version: 3, lifecycle: 'ACTIVE', createdAt: 't3' }, domains: {} },
          { entity: { version: 2, lifecycle: 'ACTIVE', createdAt: 't2' }, domains: {} },
        ],
        knowledge_rollbacks: [{ at: 't', fromVersion: 3, targetVersion: 1, reason: 'r', validated: true }],
      },
    };
    stub(withSnaps);
    const h = await getKnowledgeHistory('org1');
    expect(h.versions.find((v) => v.version === 3)?.lifecycle).toBe('ACTIVE');
    expect(h.versions.find((v) => v.version === 2)?.lifecycle).toBe('SUPERSEDED');
    expect(h.rollbacks).toHaveLength(1);
  });

  test('rollbackKnowledge validates target + records metadata (no history overwrite)', async () => {
    let written: any = null;
    const withSnaps = {
      ...PROFILE,
      report_settings: {
        knowledge_version: { version: 3 },
        knowledge_snapshots: [
          { entity: { version: 3, lifecycle: 'ACTIVE', createdAt: 't3' }, domains: {} },
          { entity: { version: 1, lifecycle: 'ACTIVE', createdAt: 't1' }, domains: {} },
        ],
      },
    };
    stub(withSnaps, (u) => { written = u; });
    const r = await rollbackKnowledge('org1', 1, 'bad refresh');
    expect(r.ok).toBe(true);
    expect(r.validated).toBe(true);
    expect(r.target?.entity.version).toBe(1);
    expect(written.report_settings.knowledge_rollbacks[0]).toMatchObject({ targetVersion: 1, fromVersion: 3, reason: 'bad refresh', validated: true });
    const caps = mockLog.mock.calls.map((c) => c[0].capability);
    expect(caps).toContain('knowledge.KnowledgeRolledBack');
  });

  test('rollback to current or missing version is invalid', async () => {
    stub({ ...PROFILE, report_settings: { knowledge_version: { version: 3 }, knowledge_snapshots: [{ entity: { version: 3, lifecycle: 'ACTIVE' }, domains: {} }] } });
    expect((await rollbackKnowledge('org1', 3, 'r')).validated).toBe(false); // target == current
    stub({ ...PROFILE, report_settings: { knowledge_version: { version: 3 }, knowledge_snapshots: [] } });
    expect((await rollbackKnowledge('org1', 9, 'r')).error).toBe('TARGET_NOT_FOUND');
  });

  test('getKnowledgeByVersion returns the immutable snapshot', async () => {
    stub({ ...PROFILE, report_settings: { knowledge_snapshots: [{ entity: { version: 2 }, domains: { IDENTITY: { fields: { name: 'X' } } } }] } });
    const s = await getKnowledgeByVersion('org1', 2);
    expect(s?.entity.version).toBe(2);
  });
});
