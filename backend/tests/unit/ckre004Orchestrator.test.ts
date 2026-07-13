/**
 * CKRE-004 §1/§3/§6/§7/§10 — the orchestration engine coordinates existing
 * services: plan → invalidate → tasks → events; dispatch routing; rollback; resume.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../observability', () => ({ recordRawCounter: jest.fn() }));
jest.mock('../../services/signupEventService', () => ({
  SIGNUP_EVENT_SCHEMA_VERSION: '1.1', ensureSignupCorrelationId: jest.fn(async () => null),
}));
jest.mock('../../services/aiResponseCache', () => ({ invalidateCacheByPrefix: jest.fn(async () => 0) }));
jest.mock('../../services/knowledge/companyKnowledgeService', () => ({
  rollbackKnowledge: jest.fn(async () => ({ ok: true, validated: true, target: { entity: { version: 2 } } })),
  getCurrentKnowledge: jest.fn(async () => ({ entity: { version: 3 }, domains: { WEBSITE: {}, SEO: {} } })),
}));

import { supabase } from '../../db/supabaseClient';
import { logSecurityEvent } from '../../security/audit/SecurityAuditService';
import { invalidateCacheByPrefix } from '../../services/aiResponseCache';
import { rollbackKnowledge } from '../../services/knowledge/companyKnowledgeService';
import { orchestrateKnowledgeChange, orchestrateRollback, resumeOrchestration, dispatch } from '../../services/orchestration/knowledgeOrchestrator';

const mockFrom = (supabase as any).from as jest.Mock;
const mockLog = logSecurityEvent as jest.MockedFunction<typeof logSecurityEvent>;
const NOW = '2026-07-13T00:00:00.000Z';

let updatedSettings: any = null;
function stub(reportSettings: Record<string, unknown>) {
  updatedSettings = null;
  mockFrom.mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: { report_settings: reportSettings } }) }),
    }),
    update: jest.fn((u: any) => { updatedSettings = u.report_settings; return { eq: jest.fn().mockResolvedValue({ error: null }) }; }),
  });
}

function capabilities(): string[] {
  return mockLog.mock.calls.map((c) => (c[0] as any).capability);
}

beforeEach(() => { jest.clearAllMocks(); });

describe('CKRE-004 §1/§6 — orchestrateKnowledgeChange', () => {
  test('plans, persists tasks, invalidates, completes, emits lifecycle events', async () => {
    stub({ knowledge_version: { version: 5 } });
    const res = await orchestrateKnowledgeChange({ companyId: 'org1', changedDomains: ['WEBSITE'], now: NOW });
    expect(res.ok).toBe(true);
    expect(res.outcome).toBe('completed');
    expect(res.tasks.length).toBeGreaterThan(0);
    expect(res.tasks.every((t) => t.state === 'COMPLETED')).toBe(true);
    // Downstream cache invalidated for the affected ops.
    expect(invalidateCacheByPrefix).toHaveBeenCalled();
    // Ledger persisted into report_settings.orchestration_tasks.
    expect(Array.isArray(updatedSettings?.orchestration_tasks)).toBe(true);
    const caps = capabilities();
    expect(caps).toContain('orchestration.OrchestrationPlanned');
    expect(caps).toContain('orchestration.OrchestrationStarted');
    expect(caps).toContain('orchestration.OrchestrationCompleted');
    expect(caps).toContain('orchestration.InvalidationPropagated');
  });

  test('empty change → noop, no events for a non-change', async () => {
    stub({});
    const res = await orchestrateKnowledgeChange({ companyId: 'org1', changedDomains: [], now: NOW });
    expect(res.outcome).toBe('noop');
    expect(res.tasks).toEqual([]);
  });

  test('missing companyId → failed, never throws', async () => {
    stub({});
    const res = await orchestrateKnowledgeChange({ companyId: '', changedDomains: ['WEBSITE'], now: NOW });
    expect(res.ok).toBe(false);
    expect(res.outcome).toBe('failed');
  });
});

describe('CKRE-004 §7 — rollback + resume', () => {
  test('orchestrateRollback reuses CKRE-003 rollback then invalidates + emits', async () => {
    stub({ knowledge_version: { version: 5 } });
    const res = await orchestrateRollback({ companyId: 'org1', targetVersion: 2, reason: 'manual', now: NOW });
    expect(rollbackKnowledge).toHaveBeenCalledWith('org1', 2, 'manual', NOW);
    expect(res.ok).toBe(true);
    expect(capabilities()).toContain('orchestration.RollbackOrchestrated');
  });

  test('resumeOrchestration heals stuck tasks in the ledger', async () => {
    const stuck = {
      id: 'org1:knowledge_refresh:all:na', companyId: 'org1', type: 'knowledge_refresh', target: 'all',
      priority: 40, state: 'RUNNING', attempts: 1, maxAttempts: 3, timeoutMs: 1000,
      createdAt: NOW, startedAt: '2026-07-12T00:00:00.000Z', finishedAt: null, lastError: null,
    };
    stub({ orchestration_tasks: [stuck] });
    const out = await resumeOrchestration('org1', NOW);
    expect(out.recovered).toBe(1);
    expect(capabilities()).toContain('orchestration.ExecutionResumed');
  });
});

describe('CKRE-004 §3 — dispatch consumes the subscription registry', () => {
  test('unknown event ignored', async () => {
    stub({});
    const out = await dispatch('TotallyUnknown', { companyId: 'org1', now: NOW });
    expect(out).toEqual({ ignored: true, event: 'TotallyUnknown' });
  });

  test('WebsiteChanged seeds WEBSITE and orchestrates', async () => {
    stub({ knowledge_version: { version: 1 } });
    const out: any = await dispatch('WebsiteChanged', { companyId: 'org1', now: NOW });
    expect(out.ok).toBe(true);
    expect(out.plan.changedDomains).toContain('WEBSITE');
  });

  test('KnowledgeRolledBack routes to rollback', async () => {
    stub({ knowledge_version: { version: 5 } });
    const out: any = await dispatch('KnowledgeRolledBack', { companyId: 'org1', targetVersion: 2, now: NOW });
    expect(rollbackKnowledge).toHaveBeenCalled();
    expect(out.ok).toBe(true);
  });
});
