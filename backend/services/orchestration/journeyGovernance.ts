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

export type ChannelRefusal =
  | 'global_kill_switch' | 'tenant_not_enabled' | 'tenant_kill_switch' | 'channel_not_enabled'
  // The instant Super Admin WhatsApp stop (rollout flag `whatsapp-sending`) and its fail-safe pause.
  | 'super_admin_stop' | 'stop_switch_unreadable';

export async function channelRefusal(organizationId: string, channel: string): Promise<ChannelRefusal | null> {
  if (channel === 'whatsapp') {
    // WhatsApp has TWO global stops (owner rulings 2026-11-11): the env kill switch AND the instant
    // Super Admin switch, failing safe when it cannot be read. The send path checks both
    // (whatsappGlobalStop), so creation must too, with the SAME code; otherwise, while the switch is
    // on, a journey could still CREATE a broadcast that never sends (e9 / 6f, 2026-11-12). Imported
    // lazily: the broadcast service is a heavy module and must not become an import-time dependency
    // of every engine that passes this gate.
    const { whatsappGlobalStop } = await import('../whatsappBroadcastService');
    const stop = await whatsappGlobalStop();
    if (stop) return stop as ChannelRefusal;
  } else if (isLeadOutreachGloballyDisabled()) {
    return 'global_kill_switch';
  }
  const config = await loadTenantGovernanceConfig(organizationId);
  if (!config.configured || !config.enabled) return 'tenant_not_enabled';
  if (config.killSwitch) return 'tenant_kill_switch';
  if (!config.enabledChannels.includes(channel)) return 'channel_not_enabled';
  return null;
}
