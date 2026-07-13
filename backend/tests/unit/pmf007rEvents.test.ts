/**
 * PMF-007R §7 — decision events + the canonical production service: DecisionCreated
 * events flow through the AUTH-001 envelope; produceDecisionsFromRecommendation emits
 * events + telemetry and returns the canonical export.
 */

jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../observability', () => ({ recordRawCounter: jest.fn(), recordRawHistogram: jest.fn() }));
jest.mock('../../services/signupEventService', () => ({ SIGNUP_EVENT_SCHEMA_VERSION: '1.1', ensureSignupCorrelationId: jest.fn(async () => null) }));
jest.mock('../../services/crawl/crawlEventService', () => ({ resolveCrawlCorrelationId: jest.fn(async () => 'company:org1') }));

import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import { recordRawCounter } from '../../observability';
import { emitDecisionEvent, metricForDecisionEvent } from '../../services/decisionIntelligence/decisionEvents';
import { produceDecisionsFromRecommendation } from '../../services/decisionIntelligence/decisionIntelligenceService';

const mockLog = logSecurityEvent as jest.MockedFunction<typeof logSecurityEvent>;
const NOW = '2026-07-13T00:00:00.000Z';

beforeEach(() => jest.clearAllMocks());

describe('PMF-007R §7 — decision events', () => {
  test('emits decision.<Event> on the AUTH envelope + metric', async () => {
    await emitDecisionEvent({ event: 'DecisionCreated', outcome: 'allowed', correlationId: 'cid', companyId: 'org1', decisionId: 'dec_1', decisionType: 'CONTENT_RECOMMENDATIONS' });
    const arg = mockLog.mock.calls[0][0] as any;
    expect(arg.capability).toBe('decision.DecisionCreated');
    expect(arg.resourceId).toBe('cid');
    const env = JSON.parse(String(arg.reason));
    expect(env.v).toBe('1.1');
    expect(env.metadata.decisionId).toBe('dec_1');
    expect(recordRawCounter).toHaveBeenCalledWith('decision.created', 1, {});
  });
  test('event → metric mapping', () => {
    expect(metricForDecisionEvent('DecisionApproved')).toBe('approved');
    expect(metricForDecisionEvent('DecisionConsumed')).toBe('consumed');
    expect(metricForDecisionEvent('DecisionRejected')).toBe('rejected');
  });
});

describe('PMF-007R — production service', () => {
  test('produces decisions + export, emits DecisionCreated per decision, records telemetry', async () => {
    const result = { recommendations: [{ title: 'A', confidence: 88 }, { title: 'B', confidence: 60 }] };
    const produced = await produceDecisionsFromRecommendation(result, { companyId: 'org1', knowledgeVersion: 9, createdAt: NOW, runtime: 'platform', correlationId: 'cid' });

    expect(produced.decisions).toHaveLength(2);
    expect(produced.export.count).toBe(2);
    expect(produced.export.decisions[0].explanation).toBeDefined();

    const caps = mockLog.mock.calls.map((c) => (c[0] as any).capability);
    expect(caps.filter((x) => x === 'decision.DecisionCreated')).toHaveLength(2); // one per decision
    const counters = (recordRawCounter as jest.Mock).mock.calls.map((c) => c[0]);
    expect(counters).toContain('decision.count');
    expect(counters).toContain('decision.priority_distribution');
  });

  test('emitEvents=false / recordTelemetry=false are honored; never throws', async () => {
    const produced = await produceDecisionsFromRecommendation({}, { companyId: 'org1', knowledgeVersion: null, createdAt: NOW, emitEvents: false, recordTelemetry: false });
    expect(produced.decisions.length).toBeGreaterThan(0); // producing-node fallback
    expect(mockLog).not.toHaveBeenCalled();
  });
});
