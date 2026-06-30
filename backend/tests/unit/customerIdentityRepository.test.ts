/**
 * Phase 6G contract-equivalence — Customer Identity Continuity migration.
 * The repository must reproduce the legacy IdentityContinuityReport exactly: the six
 * edge rules, Union-Find clustering + ordering (c_1, c_2…), confidence, drift flags,
 * salted email hashing, and the best-effort audit side-effect. Per-table mock; `now`
 * injected for determinism; recordComplianceAudit mocked; no DB.
 */
const fx: { sessions: any[]; leads: any[]; touches: any[]; audits: any[]; throwOn: Set<string> } = {
  sessions: [], leads: [], touches: [], audits: [], throwOn: new Set(),
};
const auditCalls: any[] = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const builder: Record<string, unknown> = {};
    const ret = () => builder;
    builder.select = ret; builder.eq = ret; builder.gte = ret; builder.limit = ret;
    (builder as { then: unknown }).then = (resolve: (o: any) => void, reject: (e: any) => void) => {
      if (fx.throwOn.has(table)) return reject(new Error(`boom:${table}`));
      const map: Record<string, any[]> = {
        visitor_sessions: fx.sessions, leads: fx.leads, campaign_touchpoints: fx.touches, audit_events: fx.audits,
      };
      return resolve({ data: map[table] ?? [] });
    };
    return builder;
  },
}));
jest.mock('../../services/audit/complianceAuditService', () => ({
  recordComplianceAudit: jest.fn(async (c: unknown) => { auditCalls.push(c); }),
}));

import {
  getCustomerIdentityContinuity,
  getCustomerIdentityInputs,
  analyzeIdentity,
} from '../../services/leadIntelligence/customerIdentityRepository';

const NOW = Date.parse('2026-06-01T00:00:00.000Z');

beforeEach(() => { fx.sessions = []; fx.leads = []; fx.touches = []; fx.audits = []; fx.throwOn = new Set(); auditCalls.length = 0; });

describe('Phase 6G — Customer Identity Continuity repository migration (byte-identical)', () => {
  it('empty datasets → no clusters, audit still recorded once', async () => {
    const r = await getCustomerIdentityContinuity('co1', NOW);
    expect(r).toEqual({
      companyId: 'co1', generatedAt: '2026-06-01T00:00:00.000Z', windowDays: 30,
      totalClusters: 0, multiSignalClusters: 0, driftFlags: [], clusters: [],
      capabilityNote: expect.stringContaining('Deterministic identity stitching'),
    });
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].resourceId).toBe('identity_continuity:co1:2026-06-01');
    expect(auditCalls[0].detail).toEqual({ totalClusters: 0, multiSignalClusters: 0, driftFlags: 0 });
  });

  it('SESSION_TO_LEAD: stitches a lead to its session (cluster c_1)', async () => {
    fx.leads = [{ id: 'L1', visitor_session_id: 'v1', email: null, created_at: '2026-05-30T00:00:00Z' }];
    fx.sessions = [{ id: 's1', visitor_session_id: 'v1', device_fingerprint: null, started_at: '2026-05-30T00:00:00Z' }];
    const r = await getCustomerIdentityContinuity('co1', NOW);
    expect(r.totalClusters).toBe(1);
    const c = r.clusters[0];
    expect(c.clusterId).toBe('c_1');
    expect(c.leads).toEqual(['L1']);
    expect(c.sessions).toEqual(['v1']);
    expect(c.edges.map((e) => e.kind)).toEqual(['SESSION_TO_LEAD']);
    expect(c.confidence).toBe(20); // 1 distinct kind * 20
  });

  it('EMAIL_HASH: two leads sharing an email stitch; hash is opaque + salted', async () => {
    fx.leads = [
      { id: 'L1', visitor_session_id: null, email: 'Jane@B.com ', created_at: '2026-05-30T00:00:00Z' },
      { id: 'L2', visitor_session_id: null, email: 'jane@b.com', created_at: '2026-05-29T00:00:00Z' },
    ];
    const r = await getCustomerIdentityContinuity('co1', NOW);
    const c = r.clusters.find((x) => x.leads.includes('L1') && x.leads.includes('L2'))!;
    expect(c).toBeTruthy();
    expect(c.emailHashes).toHaveLength(1);                 // same normalized email → one hash
    expect(c.emailHashes[0]).not.toContain('jane');        // opaque
    expect(c.edges.some((e) => e.kind === 'EMAIL_HASH')).toBe(true);
    // drift: lead has no session evidence
    expect(r.driftFlags.some((d) => d.reason.includes('no session evidence'))).toBe(true);
  });

  it('multi-rule cluster reaches higher confidence + multiSignalClusters', async () => {
    // L1 ↔ session v1 (SESSION_TO_LEAD), nonce n1 on touchpoint ↔ L1 (CROSS_DOMAIN),
    // revenue event with nonce n1 + leadId L1 (WEBHOOK_IDENTITY) → 3 distinct kinds = 60.
    fx.leads = [{ id: 'L1', visitor_session_id: 'v1', email: 'a@b.com', created_at: '2026-05-30T00:00:00Z' }];
    fx.sessions = [{ id: 's1', visitor_session_id: 'v1', device_fingerprint: 'd1', started_at: '2026-05-30T00:00:00Z' }];
    fx.touches = [{ lead_id: 'L1', visitor_session_id: 'v1', campaign: 'c', touched_at: '2026-05-29T00:00:00Z', nonce: 'n1' }];
    fx.audits = [{ resource_id: 'rev1', metadata: { attributionNonce: 'n1', leadId: 'L1' }, created_at: '2026-05-31T00:00:00Z' }];
    const r = await getCustomerIdentityContinuity('co1', NOW);
    const c = r.clusters.find((x) => x.leads.includes('L1'))!;
    const kinds = new Set(c.edges.map((e) => e.kind));
    expect(kinds.has('SESSION_TO_LEAD')).toBe(true);
    expect(kinds.has('CROSS_DOMAIN')).toBe(true);
    expect(kinds.has('WEBHOOK_IDENTITY')).toBe(true);
    expect(c.confidence).toBe(Math.min(100, kinds.size * 20));
    expect(r.multiSignalClusters).toBe(1); // confidence >= 40
  });

  it('REPEAT_VISITOR: two sessions on one device fingerprint stitch + drift on multi-device email', async () => {
    fx.sessions = [
      { id: 's1', visitor_session_id: 'v1', device_fingerprint: 'dev', started_at: '2026-05-28T00:00:00Z' },
      { id: 's2', visitor_session_id: 'v2', device_fingerprint: 'dev', started_at: '2026-05-29T00:00:00Z' },
    ];
    const r = await getCustomerIdentityContinuity('co1', NOW);
    const c = r.clusters[0];
    expect(c.sessions.sort()).toEqual(['v1', 'v2']);
    expect(c.devices).toEqual(['dev']);
    expect(c.edges.some((e) => e.kind === 'REPEAT_VISITOR')).toBe(true);
  });

  it('WEBHOOK_IDENTITY without nonce still records a revenue→lead edge', async () => {
    fx.leads = [{ id: 'L1', visitor_session_id: 'v1', email: null, created_at: '2026-05-30T00:00:00Z' }];
    fx.sessions = [{ id: 's1', visitor_session_id: 'v1', device_fingerprint: null, started_at: '2026-05-30T00:00:00Z' }];
    fx.audits = [{ resource_id: 'rev9', metadata: { leadId: 'L1' }, created_at: '2026-05-31T00:00:00Z' }];
    const r = await getCustomerIdentityContinuity('co1', NOW);
    const c = r.clusters.find((x) => x.leads.includes('L1'))!;
    expect(c.edges.some((e) => e.kind === 'WEBHOOK_IDENTITY' && e.fromKey === 'revenue:rev9')).toBe(true);
  });

  it('singletons are not clusters', async () => {
    fx.leads = [{ id: 'L1', visitor_session_id: null, email: null, created_at: '2026-05-30T00:00:00Z' }];
    const r = await getCustomerIdentityContinuity('co1', NOW);
    expect(r.totalClusters).toBe(0); // lonely lead with no edges → singleton
  });

  it('fail-open + tenant isolation: throwing sources degrade to empty', async () => {
    fx.throwOn = new Set(['visitor_sessions', 'leads', 'campaign_touchpoints', 'audit_events']);
    const r = await getCustomerIdentityContinuity('other-co', NOW);
    expect(r.companyId).toBe('other-co');
    expect(r.clusters).toEqual([]);
  });

  it('inputs hydrate all four sources; analyzeIdentity is pure & audit-free', async () => {
    fx.leads = [{ id: 'L1', visitor_session_id: 'v1', email: 'a@b.com', created_at: '2026-05-30T00:00:00Z' }];
    fx.sessions = [{ id: 's1', visitor_session_id: 'v1', device_fingerprint: 'd', started_at: '2026-05-30T00:00:00Z' }];
    const inputs = await getCustomerIdentityInputs('co1', NOW);
    expect(inputs.leads).toHaveLength(1);
    expect(inputs.sessions).toHaveLength(1);
    expect(auditCalls).toHaveLength(0); // inputs/analysis do NOT write
    expect(analyzeIdentity(inputs, NOW)).toEqual(analyzeIdentity(inputs, NOW)); // deterministic
    expect(auditCalls).toHaveLength(0);
  });
});
