/**
 * Phase 26E — Production boot wiring integration tests.
 */

import {
  activateProductionDomainRuntime,
  maybeActivateProductionDomainRuntime,
} from '../../../../../services/orchestration/distributed/domain/production/productionDomainBootWiring';
import {
  createWorkflowStepRegistry,
} from '../../../../../services/orchestration/distributed/workflowStepRegistry';

function trivialDeps() {
  return {
    longForm: { generateSection: async () => {} },
    campaign: { publishPost: async () => {} },
    socialPublish: { adapters: { x: async () => {} } },
    reconciliation: { reconcileRow: async () => {} },
  };
}

describe('activateProductionDomainRuntime', () => {
  test('registers all four domain builders + generic defaults', () => {
    const reg = createWorkflowStepRegistry({ telemetry: { emit: () => {} } });
    const result = activateProductionDomainRuntime({
      services: trivialDeps(),
      registry: reg,
      installAsDefault: false,
      telemetry: { emit: () => {} },
    });
    // 4 domain + 4 generic = 8 total registrations.
    expect(result.registry.list().length).toBe(8);
    expect(result.registry.get('long_form_generation')).not.toBeNull();
    expect(result.registry.get('campaign_execution')).not.toBeNull();
    expect(result.registry.get('social_publish')).not.toBeNull();
    expect(result.registry.get('provider_reconciliation')).not.toBeNull();
    expect(result.registry.get('content_generation')).not.toBeNull();
    expect(result.registry.get('recovery')).not.toBeNull();
    expect(result.registry.get('replay_continuation')).not.toBeNull();
    expect(result.registry.get('topology_mutation')).not.toBeNull();
    expect(result.continuityRulesRegistered).toBe(4);
  });

  test('throws on missing service dep', () => {
    expect(() => activateProductionDomainRuntime({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      services: { longForm: {} as any, campaign: { publishPost: async () => {} },
        socialPublish: { adapters: {} }, reconciliation: { reconcileRow: async () => {} } },
      installAsDefault: false,
      telemetry: { emit: () => {} },
    })).toThrow();
  });

  test('emits started + completed telemetry on success', () => {
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    activateProductionDomainRuntime({
      services: trivialDeps(),
      installAsDefault: false,
      telemetry: { emit(event, payload) { events.push({ event, payload }); } },
    });
    expect(events.some((e) => e.event === 'production_domain_boot_started')).toBe(true);
    expect(events.some((e) => e.event === 'production_domain_boot_completed')).toBe(true);
  });

  test('emits failed telemetry when deps invalid', () => {
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    expect(() => activateProductionDomainRuntime({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      services: {} as any,
      installAsDefault: false,
      telemetry: { emit(event, payload) { events.push({ event, payload }); } },
    })).toThrow();
    expect(events.some((e) => e.event === 'production_domain_boot_failed')).toBe(true);
  });
});

describe('maybeActivateProductionDomainRuntime', () => {
  const originalEnv = process.env.ENABLE_PRODUCTION_DOMAIN_RUNTIME;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ENABLE_PRODUCTION_DOMAIN_RUNTIME;
    else process.env.ENABLE_PRODUCTION_DOMAIN_RUNTIME = originalEnv;
  });

  test('returns null when env flag unset', () => {
    delete process.env.ENABLE_PRODUCTION_DOMAIN_RUNTIME;
    const r = maybeActivateProductionDomainRuntime({
      services: trivialDeps(),
      installAsDefault: false,
      telemetry: { emit: () => {} },
    });
    expect(r).toBeNull();
  });

  test('activates when env flag set to "1"', () => {
    process.env.ENABLE_PRODUCTION_DOMAIN_RUNTIME = '1';
    const r = maybeActivateProductionDomainRuntime({
      services: trivialDeps(),
      installAsDefault: false,
      telemetry: { emit: () => {} },
    });
    expect(r).not.toBeNull();
    expect(r?.continuityRulesRegistered).toBe(4);
  });

  test('emits skipped telemetry when not activated', () => {
    delete process.env.ENABLE_PRODUCTION_DOMAIN_RUNTIME;
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    maybeActivateProductionDomainRuntime({
      services: trivialDeps(),
      installAsDefault: false,
      telemetry: { emit(event, payload) { events.push({ event, payload }); } },
    });
    expect(events.some((e) => e.event === 'production_domain_boot_skipped')).toBe(true);
  });
});
