/**
 * INT-001 Phase 3 — Channel Intelligence. Recommendation ONLY: nothing here
 * executes, sends, or schedules anything. Ordering is deterministic —
 * confidence descending, then a fixed channel tiebreak order.
 */

import type {
  QualificationPlanningInput,
  ChannelRecommendation,
  OutreachChannel,
} from './types';
import { extractSnapshotSignals } from './signals';
import { CHANNEL_TIEBREAK_ORDER } from './planningConfig';
import { clampConfidence } from './signals';

const EXEC_PERSONAS = new Set(['Founder', 'CEO', 'CTO', 'Marketing', 'Sales', 'Procurement', 'Consultant', 'Investor']);
const DEV_PERSONAS = new Set(['Developer', 'CTO']);

export function recommendChannels(input: QualificationPlanningInput): ChannelRecommendation[] {
  const signals = extractSnapshotSignals(input.snapshot);
  const persona = input.persona.persona;
  const hasPhone = Boolean(String(input.context?.phoneNumber ?? '').trim());
  const companyEmail = signals.emailClass === 'company';

  const out: ChannelRecommendation[] = [];
  const add = (channel: OutreachChannel, confidence: number, reasoning: string) => {
    out.push({ channel, confidence: clampConfidence(confidence), reasoning });
  };

  // Email is always addressable when an email exists.
  if (input.snapshot.lead.email) {
    add('email', companyEmail ? 0.85 : 0.65, companyEmail
      ? 'Company email provided — direct email is reliable.'
      : 'Personal email provided — email works but with lower deliver-to-decision odds.');
  }

  if (EXEC_PERSONAS.has(persona)) {
    add('linkedin', 0.6 + input.persona.confidence * 0.3, `${persona} personas respond best to LinkedIn outreach.`);
  } else if (persona !== 'Unknown') {
    add('linkedin', 0.45, `${persona} persona is reachable on LinkedIn with moderate response odds.`);
  } else {
    add('linkedin', 0.3, 'Persona unknown — LinkedIn viable once identity is confirmed.');
  }

  if (DEV_PERSONAS.has(persona)) {
    add('github', 0.55, 'Technical persona — GitHub presence is a credible touch.');
    add('discord', 0.5, 'Technical persona — developer community channels convert well.');
    add('community', 0.5, 'Invite into the developer community for low-friction engagement.');
  } else if ((signals.pageSignalCounts.documentation ?? 0) > 0) {
    add('community', 0.4, 'Documentation interest — community is a soft next touch.');
  }

  if (hasPhone) {
    add('phone', signals.demoRequested ? 0.7 : 0.5, signals.demoRequested
      ? 'Phone provided and a demo was requested — a call is warranted.'
      : 'Phone provided — a call is possible once warmed.');
    add('whatsapp', 0.4, 'Phone provided — WhatsApp viable where appropriate.');
    add('sms', 0.25, 'Phone provided — SMS only for confirmed meetings/reminders.');
  }

  if (input.context?.existingCustomer) {
    add('slack', 0.6, 'Existing customer — the shared Slack channel is the fastest path.');
  }

  // Deterministic ordering: confidence desc, then fixed tiebreak order.
  return out.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return CHANNEL_TIEBREAK_ORDER.indexOf(a.channel) - CHANNEL_TIEBREAK_ORDER.indexOf(b.channel);
  });
}
