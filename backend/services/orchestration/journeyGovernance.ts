/**
 * The central pre-execution gate: the tenant and platform controls every contact step
 * passes, whichever engine serves it. No engine can be left out by forgetting to call a
 * gate, because the sweeper asks before it hands the step over.
 *
 * Not a second authority. The engines keep their own gates and those still decide; this
 * only guarantees the controls that some engines have no gate for at all.
 *
 * A failed configuration read is treated as unconfigured, so it refuses.
 */
import { isLeadOutreachGloballyDisabled, loadTenantGovernanceConfig } from '../leadOutreachExecution/governanceService';

export type ChannelRefusal = 'global_kill_switch' | 'tenant_not_enabled' | 'tenant_kill_switch' | 'channel_not_enabled';

export async function channelRefusal(organizationId: string, channel: string): Promise<ChannelRefusal | null> {
  if (isLeadOutreachGloballyDisabled()) return 'global_kill_switch';
  const config = await loadTenantGovernanceConfig(organizationId);
  if (!config.configured || !config.enabled) return 'tenant_not_enabled';
  if (config.killSwitch) return 'tenant_kill_switch';
  if (!config.enabledChannels.includes(channel)) return 'channel_not_enabled';
  return null;
}
