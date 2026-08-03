/**
 * INT-001 Phase 3 — Autonomous Outreach Planner. Produces a RECOMMENDED,
 * ordered plan from the persona playbooks; executes nothing.
 */

import type {
  QualificationPlanningInput,
  QualificationResult,
  ChannelRecommendation,
  OutreachPlan,
  OutreachPlanStep,
  OutreachChannel,
} from './types';
import { PERSONA_PLAYBOOKS } from './planningConfig';
import { clampConfidence } from './signals';

export function buildOutreachPlan(
  input: QualificationPlanningInput,
  qualification: QualificationResult,
  channels: ChannelRecommendation[],
): OutreachPlan {
  const persona = input.persona.persona;
  const playbookKey = PERSONA_PLAYBOOKS[persona] ? persona : 'Default';
  const template = PERSONA_PLAYBOOKS[playbookKey];

  const steps: OutreachPlanStep[] = template.map((entry, index) => ({
    order: index + 1,
    step: entry.step,
    channel: entry.channel as OutreachChannel | 'content',
    detail: entry.detail,
  }));

  const topChannel = channels[0]?.channel ?? 'email';
  const bandFactor =
    qualification.band === 'hot' ? 1
      : qualification.band === 'warm' ? 0.85
        : qualification.band === 'cool' ? 0.65 : 0.5;
  const confidence = clampConfidence((0.35 + input.persona.confidence * 0.5) * bandFactor);

  const reasoning = playbookKey === 'Default'
    ? `No persona-specific playbook for ${persona} — using the default nurture sequence; strongest channel is ${topChannel}.`
    : `${playbookKey} playbook selected (persona confidence ${input.persona.confidence}); qualification band ${qualification.band}; strongest channel ${topChannel}.`;

  return { playbook: playbookKey, steps, reasoning, confidence };
}
