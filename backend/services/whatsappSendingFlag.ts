/**
 * The instant Super Admin "stop all WhatsApp" switch (owner ruling via e9, 2026-11-11:
 * "YES, fail SAFE"). A flag in the existing rollout kit, so the operator surface is the existing
 * one: POST /api/super-admin/rollout-control { flagKey: 'whatsapp-sending', action: 'kill' }
 * (PLATFORM_CONTROLS_MANAGE + step-up, audited, no redeploy); 'unkill' resumes.
 *
 * Kept dependency-free (only the client-safe kit) so the rollout-control route can import it for
 * registration without pulling the WhatsApp service in. whatsappBroadcastService reads it.
 *
 * Meaning of the flag's resolution for SENDING (default 'enforce' = sending allowed):
 *   - admin `killed`, admin mode 'off', or env ROLLOUT_WHATSAPP_SENDING_KILL / _MODE=off -> STOP;
 *   - the kit-wide ROLLOUT_KILL_SWITCH (revert every rollout candidate to legacy) is NOT a send
 *     stop: it exists to back out rollouts, and coupling it to production sends would make a
 *     rollout rollback silently halt all WhatsApp. The send stops are this flag and the env
 *     LEAD_OUTREACH_EXECUTION_DISABLED; either one stops sending.
 */
import { defineRolloutFlag } from '../../lib/platform/rollout';

export const WHATSAPP_SENDING_FLAG = defineRolloutFlag({
  key: 'whatsapp-sending',
  description: 'Instant stop for ALL WhatsApp sends. kill = stop (create, Resume, Retry, and before every send; '
    + 'other servers pick it up within 30 s); unkill = resume paused broadcasts with Resume. Fails SAFE: an unreadable '
    + 'admin config pauses sending. (A per-company outreach kill switch instead stops an in-flight batch within 50 '
    + 'messages or 30 s - owner-accepted - and blocks everything new at once.)',
  defaultMode: 'enforce',
});
