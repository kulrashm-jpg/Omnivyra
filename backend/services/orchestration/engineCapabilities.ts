/**
 * What each of the five engines declares under the execution contract. Not a registry:
 * routing stays `buildAdapterRegistry`, and each adapter carries its own declaration.
 *
 * Kept apart from the adapters because the community adapter's module graph needs the
 * full runtime configuration at load, and the sweeper's lazy wrapper must not trigger it.
 *
 * `verification` is deliberately modest and is the honest state of each claim. Outreach
 * owns these values and raises them only with evidence of the level claimed.
 */

import { EXECUTION_CONTRACT_VERSION, type EngineCapabilityDeclaration } from './executionContract';

export const WS3_CAPABILITIES: EngineCapabilityDeclaration = {
  contractVersion: EXECUTION_CONTRACT_VERSION,
  engine: 'ws3',
  actions: [
    {
      action: 'internal_task', channel: 'internal', contactsPerson: false,
      idempotency: 'engine_record', approval: 'ws3_task', creditMetered: false,
      reportsDelivery: false, reportsResponses: false,
      providers: [{ provider: 'internal', credentials: 'none', verification: 'postgres_verified' }],
    },
    {
      action: 'send_email', channel: 'email', contactsPerson: true,
      idempotency: 'engine_record', approval: 'ws3_task', creditMetered: false,
      reportsDelivery: true, reportsResponses: true,
      providers: [{ provider: 'ses', credentials: 'platform', verification: 'mocked' }],
    },
  ],
};

export const WHATSAPP_CAPABILITIES: EngineCapabilityDeclaration = {
  contractVersion: EXECUTION_CONTRACT_VERSION,
  engine: 'whatsapp',
  actions: [{
    action: 'send_template', channel: 'whatsapp', contactsPerson: true,
    idempotency: 'request_ledger', approval: 'none_available', creditMetered: false,
    reportsDelivery: true, reportsResponses: true,
    providers: [{ provider: 'meta_cloud_api', credentials: 'tenant', verification: 'mocked' }],
  }],
};

export const SOCIAL_PUBLISH_CAPABILITIES: EngineCapabilityDeclaration = {
  contractVersion: EXECUTION_CONTRACT_VERSION,
  engine: 'social_publish',
  actions: [{
    action: 'observe_post', channel: 'social_post', contactsPerson: false,
    idempotency: 'observation_only', approval: 'engine_record', creditMetered: false,
    reportsDelivery: false, reportsResponses: false,
    providers: [],
  }],
};

export const COMMUNITY_CAPABILITIES: EngineCapabilityDeclaration = {
  contractVersion: EXECUTION_CONTRACT_VERSION,
  engine: 'community',
  actions: [{
    action: 'execute_bound_action', channel: 'community', contactsPerson: true,
    idempotency: 'request_ledger', approval: 'engine_record', creditMetered: false,
    reportsDelivery: false, reportsResponses: false,
    providers: [
      { provider: 'platform_api', credentials: 'tenant', verification: 'mocked' },
      { provider: 'rpa_browser', credentials: 'tenant', verification: 'mocked' },
    ],
  }],
};

export const BROWSER_CAPABILITIES: EngineCapabilityDeclaration = {
  contractVersion: EXECUTION_CONTRACT_VERSION,
  engine: 'browser',
  actions: [],
};
