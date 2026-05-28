/**
 * Phase 24J — Convenience helper to register all four domain builders.
 *
 * Operators wire their real service implementations via this helper.
 * Used by the boot wiring path to ensure no placeholder builders survive
 * into production (the WorkflowStepRegistry.assertRealBuildersPresent
 * check from Phase 23I would otherwise refuse to start).
 *
 * SCOPE: registration ONLY. No orchestration semantics.
 */

import type { WorkflowStepRegistry } from '../workflowStepRegistry';
import type {
  CampaignServiceHooks,
  LongFormServiceHooks,
  ReconciliationServiceHooks,
  SocialPublishServiceHooks,
} from './domainWorkflowTypes';
import type { WorkflowStepBuilder } from '../workflowExecutionTypes';
import {
  createLongFormWorkflowStepBuilder,
} from './longFormWorkflowStepBuilder';
import {
  createCampaignWorkflowStepBuilder,
} from './campaignWorkflowStepBuilder';
import {
  createSocialPublishWorkflowStepBuilder,
} from './socialPublishWorkflowStepBuilder';
import {
  createProviderReconciliationWorkflowStepBuilder,
} from './providerReconciliationWorkflowStepBuilder';

export interface DomainStepBuilderHooks {
  longForm: LongFormServiceHooks;
  campaign: CampaignServiceHooks;
  socialPublish: SocialPublishServiceHooks;
  reconciliation: ReconciliationServiceHooks;
}

export interface RegisterDomainStepBuildersInput {
  registry: WorkflowStepRegistry;
  hooks: DomainStepBuilderHooks;
  /** Optional name overrides per builder (for diagnostics). */
  builderNames?: {
    longForm?: string;
    campaign?: string;
    socialPublish?: string;
    reconciliation?: string;
  };
}

/**
 * Register all four domain builders into the registry. Throws if any
 * required hook is missing (those throws originate from the per-builder
 * constructors).
 */
export function registerDomainStepBuilders(input: RegisterDomainStepBuildersInput): void {
  const { registry, hooks, builderNames } = input;
  if (!registry) throw new Error('registry required');
  if (!hooks) throw new Error('hooks required');

  registry.register(createLongFormWorkflowStepBuilder({
    serviceHooks: hooks.longForm,
    name: builderNames?.longForm ?? 'real_long_form_builder',
  }) as WorkflowStepBuilder);

  registry.register(createCampaignWorkflowStepBuilder({
    serviceHooks: hooks.campaign,
    name: builderNames?.campaign ?? 'real_campaign_builder',
  }) as WorkflowStepBuilder);

  registry.register(createSocialPublishWorkflowStepBuilder({
    serviceHooks: hooks.socialPublish,
    name: builderNames?.socialPublish ?? 'real_social_publish_builder',
  }) as WorkflowStepBuilder);

  registry.register(createProviderReconciliationWorkflowStepBuilder({
    serviceHooks: hooks.reconciliation,
    name: builderNames?.reconciliation ?? 'real_provider_reconciliation_builder',
  }) as WorkflowStepBuilder);
}

/**
 * Test-only convenience: register all four builders with NO-OP hooks. Used
 * by the stress harness to exercise the registration + dispatch path
 * without invoking real domain services.
 */
export function registerNoopDomainStepBuilders(registry: WorkflowStepRegistry): void {
  registerDomainStepBuilders({
    registry,
    hooks: {
      longForm: { runGenerationSection: async () => {} },
      campaign: { runPost: async () => {} },
      socialPublish: { runProviderPublish: async () => {} },
      reconciliation: { runReconcileRow: async () => {} },
    },
  });
}
