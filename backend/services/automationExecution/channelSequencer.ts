/**
 * INT-001 Phase 5 — Channel Sequencer. Orders the Phase 3 channel
 * recommendations into a deterministic execution sequence. Recommendation
 * only; nothing is contacted.
 */

import type { AutomationInput, ChannelSequenceEntry } from './types';
import { CHANNEL_SEQUENCE_MIN_CONFIDENCE } from './automationConfig';

export function sequenceChannels(input: AutomationInput): ChannelSequenceEntry[] {
  const context = input.context ?? {};
  const out: ChannelSequenceEntry[] = [];

  for (const rec of input.summary.recommendedChannels) {
    if (rec.confidence < CHANNEL_SEQUENCE_MIN_CONFIDENCE) continue;
    // Contact-availability gating (deterministic): channels whose medium is
    // known to be missing are excluded rather than down-ranked.
    if ((rec.channel === 'phone' || rec.channel === 'whatsapp' || rec.channel === 'sms') && context.hasPhone === false) continue;
    if (rec.channel === 'email' && context.hasEmail === false) continue;
    if (rec.channel === 'linkedin' && context.linkedinProfileKnown === false) continue;
    out.push({
      order: out.length + 1,
      channel: rec.channel,
      confidence: rec.confidence,
      explanation: rec.reasoning,
    });
  }
  return out;
}
