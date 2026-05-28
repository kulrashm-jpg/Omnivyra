/**
 * Phase 26E — Production domain boot wiring.
 *
 * Single canonical entry point that operators call from
 * `bootWireDistributedRuntime` (or equivalent boot path) to activate
 * the real-business runtime end-to-end. Combines:
 *
 *   - Production hook factories (long-form, campaign, publish, reconciliation)
 *   - Domain step builder registration (via Phase 24J helper)
 *   - Pre-registered continuity rules (via Phase 26F)
 *   - Replacement of the QueueCheckpointContinuityCoordinator default
 *     with one carrying the rules
 *   - Replacement of the WorkflowStepRegistry default with one carrying
 *     all real builders
 *
 * GUARANTEES:
 *   - Runtime CANNOT boot with placeholder hooks: each factory throws
 *     if its required dep is missing; the WorkflowStepRegistry's
 *     `assertRealBuildersPresent` (Phase 23I) catches placeholder-only
 *     registrations as a backstop.
 *   - Domain continuity rules ACTIVATE AUTOMATICALLY — operators don't
 *     need a separate registration call.
 *   - Memory mode unaffected: this helper is only invoked when the
 *     env-gated distributed runtime is enabled.
 *
 * SCOPE: BOOT WIRING ONLY. No orchestration semantics, no service
 * mutations. The actual domain work happens inside the caller-supplied
 * service-reference functions.
 */

import {
  createWorkflowStepRegistry,
  setDefaultWorkflowStepRegistry,
  type WorkflowStepRegistry,
} from '../../workflowStepRegistry';
import {
  registerDomainStepBuilders,
} from '../registerDomainStepBuilders';
import {
  registerDefaultDistributedStepBuilders,
} from '../../defaultDistributedStepBuilders';
import {
  createQueueCheckpointContinuityCoordinator,
  setDefaultQueueCheckpointContinuityCoordinator,
} from '../../queueCheckpointContinuityCoordinator';
import {
  createProductionLongFormHooks,
  type LongFormServiceDeps,
} from './productionLongFormHooks';
import {
  createProductionCampaignHooks,
  type CampaignServiceDeps,
} from './productionCampaignHooks';
import {
  createProductionSocialPublishHooks,
  type SocialPublishServiceDeps,
} from './productionSocialPublishHooks';
import {
  createProductionReconciliationHooks,
  type ReconciliationServiceDeps,
} from './productionReconciliationHooks';
import {
  getAllDomainContinuityRules,
} from './domainContinuityRules';

// ────────────────────────────────────────────────────────────────────
// Telemetry
// ────────────────────────────────────────────────────────────────────

export type ProductionDomainBootTelemetryEvent =
  | 'production_domain_boot_started'
  | 'production_domain_boot_completed'
  | 'production_domain_boot_failed'
  | 'production_domain_boot_skipped';

export interface ProductionDomainBootTelemetrySink {
  emit(event: ProductionDomainBootTelemetryEvent, payload: Record<string, unknown>): void;
}

const defaultTelemetrySink: ProductionDomainBootTelemetrySink = {
  emit(event, payload) {
    try {
      const line = JSON.stringify({ event, ...payload, ts: new Date().toISOString() });
      if (event === 'production_domain_boot_failed') console.warn(`[prod_domain_boot] ${line}`);
      else console.log(`[prod_domain_boot] ${line}`);
    } catch { /* ignore */ }
  },
};

// ────────────────────────────────────────────────────────────────────
// Input shape
// ────────────────────────────────────────────────────────────────────

export interface ProductionDomainBootInput {
  /** Caller-supplied production service references. */
  services: {
    longForm: LongFormServiceDeps;
    campaign: CampaignServiceDeps;
    socialPublish: SocialPublishServiceDeps;
    reconciliation: ReconciliationServiceDeps;
  };
  /** Optional registry — defaults to creating a fresh one. */
  registry?: WorkflowStepRegistry;
  /** When true, install the new registry + continuity coordinator as defaults. Default true. */
  installAsDefault?: boolean;
  telemetry?: ProductionDomainBootTelemetrySink;
}

export interface ProductionDomainBootResult {
  registry: WorkflowStepRegistry;
  installedAsDefault: boolean;
  continuityRulesRegistered: number;
}

// ────────────────────────────────────────────────────────────────────
// Boot entry point
// ────────────────────────────────────────────────────────────────────

/**
 * Wire all production domain hooks + builders + continuity rules.
 * Throws when ANY required service dep is missing — runtime cannot boot
 * partially.
 */
export function activateProductionDomainRuntime(
  input: ProductionDomainBootInput,
): ProductionDomainBootResult {
  const telemetry = input.telemetry ?? defaultTelemetrySink;
  telemetry.emit('production_domain_boot_started', {
    installAsDefault: input.installAsDefault !== false,
  });

  try {
    // 1. Construct real hook instances. Each factory throws on missing deps.
    const longFormHooks = createProductionLongFormHooks({ deps: input.services.longForm });
    const campaignHooks = createProductionCampaignHooks({ deps: input.services.campaign });
    const publishHooks = createProductionSocialPublishHooks({ deps: input.services.socialPublish });
    const reconciliationHooks = createProductionReconciliationHooks({ deps: input.services.reconciliation });

    // 2. Build / take the registry.
    const registry = input.registry ?? createWorkflowStepRegistry({ telemetry: { emit: () => {} } });

    // 2b. Register the Phase 23 generic builders FIRST so generic workflow
    // types (replay_continuation / recovery / topology_mutation /
    // content_generation) still work alongside the domain builders.
    // Domain builders register AFTER and take precedence for shared types
    // (currently none, since the domain types are distinct from generics).
    registerDefaultDistributedStepBuilders(registry);

    // 3. Register all four domain step builders with REAL hooks.
    registerDomainStepBuilders({
      registry,
      hooks: {
        longForm: longFormHooks,
        campaign: campaignHooks,
        socialPublish: publishHooks,
        reconciliation: reconciliationHooks,
      },
      builderNames: {
        longForm: 'production_long_form_builder',
        campaign: 'production_campaign_builder',
        socialPublish: 'production_social_publish_builder',
        reconciliation: 'production_provider_reconciliation_builder',
      },
    });

    // 4. Pre-register domain continuity rules.
    const rules = getAllDomainContinuityRules();
    const continuityCoord = createQueueCheckpointContinuityCoordinator({
      telemetry: { emit: () => {} },
      domainRules: rules,
    });

    // 5. Final assertion — refuse to install if no real builders are present.
    registry.assertRealBuildersPresent();

    // 6. Install as defaults (if requested).
    const install = input.installAsDefault !== false;
    if (install) {
      setDefaultWorkflowStepRegistry(registry);
      setDefaultQueueCheckpointContinuityCoordinator(continuityCoord);
    }

    telemetry.emit('production_domain_boot_completed', {
      installedAsDefault: install,
      builderCount: registry.list().length,
      continuityRulesRegistered: rules.length,
    });

    return {
      registry,
      installedAsDefault: install,
      continuityRulesRegistered: rules.length,
    };
  } catch (err) {
    telemetry.emit('production_domain_boot_failed', {
      error: (err as Error)?.message ?? String(err),
    });
    throw err;
  }
}

/**
 * Env-gated convenience helper. Skipped when
 * ENABLE_PRODUCTION_DOMAIN_RUNTIME is unset, so adding the call to a
 * boot entry point doesn't change default behavior.
 */
export function maybeActivateProductionDomainRuntime(
  input: ProductionDomainBootInput,
): ProductionDomainBootResult | null {
  const enabled =
    process.env.ENABLE_PRODUCTION_DOMAIN_RUNTIME === '1' ||
    process.env.ENABLE_PRODUCTION_DOMAIN_RUNTIME === 'true';
  if (!enabled) {
    const telemetry = input.telemetry ?? defaultTelemetrySink;
    telemetry.emit('production_domain_boot_skipped', {
      reason: 'ENABLE_PRODUCTION_DOMAIN_RUNTIME unset',
    });
    return null;
  }
  return activateProductionDomainRuntime(input);
}
