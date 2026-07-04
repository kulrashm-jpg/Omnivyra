/**
 * Canonical CRM Activation Facade
 * -------------------------------
 * ONE interface for per-tenant CRM activation, over the EXISTING architecture —
 * it introduces no new store, connector, or scheduler. It composes:
 *   • gating          → CRM_ENABLED / COMMERCIAL_EVIDENCE_ENABLED
 *   • connection       → integrationService (company_integrations +
 *                        integration_credentials, encrypted) via 'lead_webhook'
 *   • sync             → ingestionScheduler.runIngestionForCompany(['crm'])
 *                        (the canonical scheduler — manual + scheduled, retry,
 *                         failure recording; NO new scheduler)
 *   • health           → providerSyncHealth (governor + data_source_status)
 *   • disconnect/reconnect → integrationService delete/validate
 *
 * Native CRM-app OAuth connectors (crm_hubspot / crm_salesforce / crm_zoho) and
 * their IntegrationType CHECK migration are DEFERRED (see outboundCrmSyncService,
 * which documents the same future addition) — this facade activates what exists
 * today (webhook + inbound + consolidation) through one canonical surface.
 */

import { getProviderSyncHealth, type ProviderSyncHealth } from './providerSyncHealth';
import { runIngestionForCompany } from '../ingestionScheduler';
import { getActiveIntegration, deleteIntegration, validateIntegration } from '../integrationService';

/** Canonical CRM provider ids (mirrors outboundCrmSyncService — one source). */
export type CrmProvider = 'hubspot' | 'salesforce' | 'zoho' | 'webhook_only';
export const SUPPORTED_CRM_PROVIDERS: CrmProvider[] = ['hubspot', 'salesforce', 'zoho', 'webhook_only'];

/** Native app connectors requiring the deferred crm_* type migration. */
export const NATIVE_CRM_PROVIDERS: CrmProvider[] = ['hubspot', 'salesforce', 'zoho'];

const truthy = (v: string | undefined): boolean => v === '1' || v === 'true' || v === 'on' || v === 'yes';

/** CRM commercial evidence is gated on either flag (matches commercialProviderBridge). */
export function isCrmEnabled(): boolean {
  return truthy(process.env.CRM_ENABLED) || truthy(process.env.COMMERCIAL_EVIDENCE_ENABLED);
}

export interface CrmActivationStatus {
  enabled: boolean;
  /** A per-tenant webhook connection exists in the canonical integration store. */
  connected: boolean;
  health: ProviderSyncHealth | null;
  supportedProviders: CrmProvider[];
  /** Providers that need the deferred native-connector migration to activate. */
  pendingNativeProviders: CrmProvider[];
}

/** Canonical CRM activation status for a tenant. Never throws. */
export async function getCrmActivationStatus(companyId: string): Promise<CrmActivationStatus> {
  let connected = false;
  try {
    const webhook = await getActiveIntegration(companyId, 'lead_webhook');
    connected = Boolean(webhook && webhook.status === 'connected');
  } catch {
    connected = false;
  }
  let health: ProviderSyncHealth | null = null;
  try {
    health = await getProviderSyncHealth(companyId, 'commercial');
  } catch {
    health = null;
  }
  return {
    enabled: isCrmEnabled(),
    connected,
    health,
    supportedProviders: SUPPORTED_CRM_PROVIDERS,
    pendingNativeProviders: NATIVE_CRM_PROVIDERS,
  };
}

export interface CrmSyncResult {
  triggered: boolean;
  reason?: string;
}

/**
 * Trigger a CRM sync through the CANONICAL scheduler (no bespoke scheduler).
 * `manual` maps to force=true so the operator always gets a fresh run.
 */
export async function triggerCrmSync(companyId: string, opts?: { manual?: boolean }): Promise<CrmSyncResult> {
  if (!isCrmEnabled()) return { triggered: false, reason: 'crm_disabled' };
  try {
    await runIngestionForCompany({
      companyId,
      sources: ['crm'],
      force: opts?.manual === true,
      reason: opts?.manual ? 'crm_manual_sync' : 'crm_scheduled_sync',
    });
    return { triggered: true };
  } catch (err) {
    return { triggered: false, reason: err instanceof Error ? err.message : 'crm_sync_failed' };
  }
}

/** Disconnect the tenant's CRM webhook connection (canonical integration framework). */
export async function disconnectCrm(companyId: string): Promise<{ disconnected: boolean; reason?: string }> {
  try {
    const webhook = await getActiveIntegration(companyId, 'lead_webhook');
    if (!webhook) return { disconnected: false, reason: 'not_connected' };
    await deleteIntegration(webhook.id, companyId);
    return { disconnected: true };
  } catch (err) {
    return { disconnected: false, reason: err instanceof Error ? err.message : 'disconnect_failed' };
  }
}

/** Reconnect = re-validate the existing CRM webhook connection (health-driven). */
export async function reconnectCrm(companyId: string): Promise<{ reconnected: boolean; reason?: string }> {
  try {
    const webhook = await getActiveIntegration(companyId, 'lead_webhook');
    if (!webhook) return { reconnected: false, reason: 'not_connected' };
    const result = await validateIntegration(webhook.id, companyId);
    return { reconnected: result.success, reason: result.success ? undefined : result.message };
  } catch (err) {
    return { reconnected: false, reason: err instanceof Error ? err.message : 'reconnect_failed' };
  }
}
