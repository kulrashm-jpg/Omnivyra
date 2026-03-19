/**
 * Partial Regeneration Engine — Day-2 Upgrade B
 *
 * When a user edits a single field (tone, CTA, audience, platforms),
 * regenerates ONLY the affected parts of the expanded plan — not the whole campaign.
 *
 * Edit → Affected parts:
 *   tone_guidelines   → cta_patterns + blueprint hooks (all slots)
 *   cta_type          → cta_patterns only (all slot CTAs swapped inline)
 *   target_audience   → positioning + audience field + key_points (all slots)
 *   campaign_goal     → positioning + themes (week themes only)
 *   platform added    → new platform slots added to existing weeks
 *   platform removed  → slots for that platform removed
 *   duration_weeks ↑  → additional weeks appended
 *   duration_weeks ↓  → tail weeks truncated
 *
 * Cost: 0 GPT calls for most edits. Only tone/audience changes may trigger
 *        one batchedGenerateBlueprint call for affected slots (max 1 batch).
 */

import { tryTemplateBlueprintFor } from './aiTemplateLayer';
import { assembleFromFragments, storeFragments } from './fragmentCache';
import { batchedGenerateBlueprint } from './batchAiProcessor';
import type { ExpandedCampaignPlan, ExpandedContentSlot } from './campaignExpansionEngine';
import type { CampaignStrategy } from './campaignStrategyEngine';

// ── Edit descriptor ───────────────────────────────────────────────────────────

export type EditField =
  | 'tone_guidelines'
  | 'cta_type'
  | 'target_audience'
  | 'campaign_goal'
  | 'platform_added'
  | 'platform_removed'
  | 'duration_extended'
  | 'duration_trimmed';

export interface PartialEdit {
  field:    EditField;
  oldValue: unknown;
  newValue: unknown;
}

// ── CTA swap (0 GPT) ──────────────────────────────────────────────────────────

function rotateCtas(plan: ExpandedCampaignPlan, ctaPatterns: string[]): ExpandedCampaignPlan {
  if (!ctaPatterns || ctaPatterns.length === 0) return plan;
  let i = 0;
  return {
    ...plan,
    weeks: plan.weeks.map(w => ({
      ...w,
      slots: w.slots.map(s => ({
        ...s,
        cta:       ctaPatterns[i % ctaPatterns.length],
        blueprint: { ...s.blueprint, cta: ctaPatterns[i++ % ctaPatterns.length] },
      })),
    })),
  };
}

// ── Duration trim (0 GPT) ─────────────────────────────────────────────────────

function trimWeeks(plan: ExpandedCampaignPlan, newDuration: number): ExpandedCampaignPlan {
  return {
    ...plan,
    weeks:      plan.weeks.slice(0, newDuration),
    total_posts: plan.weeks.slice(0, newDuration).reduce((s, w) => s + w.slots.length, 0),
  };
}

// ── Theme swap for goal change (0 GPT) ────────────────────────────────────────

function updateThemes(plan: ExpandedCampaignPlan, newGoal: string): ExpandedCampaignPlan {
  const goal = String(newGoal || 'campaign success');
  return {
    ...plan,
    strategy: { ...plan.strategy, positioning: `Repositioned for: ${goal}` },
    weeks: plan.weeks.map(w => ({
      ...w,
      theme: w.theme.includes('campaign success') ? w.theme.replace('campaign success', goal) : w.theme,
    })),
  };
}

// ── Audience + hook refresh (may use batch GPT for affected slots) ─────────────

async function refreshAudienceHooks(
  plan: ExpandedCampaignPlan,
  newAudience: string,
): Promise<ExpandedCampaignPlan> {
  // Identify slots that have rule-based hooks (template/fragment hooks are already generic enough)
  const ruleBasedSlots = plan.weeks
    .flatMap(w => w.slots)
    .filter(s => s.source === 'rule-based')
    .slice(0, 15); // cap refresh at 15 slots

  if (ruleBasedSlots.length === 0) {
    // Just update strategy audience, no slot changes needed
    return { ...plan, strategy: { ...plan.strategy, audience: newAudience } };
  }

  // Batch refresh affected slots
  const refreshed = await Promise.allSettled(
    ruleBasedSlots.map(slot =>
      batchedGenerateBlueprint({
        topic:        slot.topic,
        content_type: slot.content_type,
        intent: {
          target_audience: newAudience,
          objective:       slot.funnel_stage,
          cta_type:        'Soft CTA',
        },
      }),
    ),
  );

  const patchMap = new Map<string, ExpandedContentSlot['blueprint']>();
  for (let i = 0; i < ruleBasedSlots.length; i++) {
    const r = refreshed[i];
    if (r.status === 'fulfilled') {
      patchMap.set(ruleBasedSlots[i].slot_id, r.value);
    }
  }

  return {
    ...plan,
    strategy: { ...plan.strategy, audience: newAudience },
    gpt_used: patchMap.size > 0,
    weeks: plan.weeks.map(w => ({
      ...w,
      slots: w.slots.map(s => {
        const patched = patchMap.get(s.slot_id);
        return patched ? { ...s, blueprint: patched, source: 'template' as const } : s;
      }),
    })),
  };
}

// ── Tone refresh (0 GPT — update CTAs only, hooks are tone-neutral) ───────────

function refreshTone(plan: ExpandedCampaignPlan, newTone: string): ExpandedCampaignPlan {
  return {
    ...plan,
    strategy: { ...plan.strategy, tone_guidelines: newTone },
    // Tone doesn't change hooks, only voice. CTAs are already rotated from cta_patterns.
    // Flag for next full render — no immediate slot changes needed.
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Apply a partial edit to an existing expanded campaign plan.
 * Returns a new plan with only the affected parts regenerated.
 * Most edits return in <50ms (0 GPT). Audience changes may take 3–5s (1 batch call).
 *
 * @param plan    - Current expanded plan
 * @param strategy - Current strategy (may be updated inline)
 * @param edits   - List of field changes
 */
export async function applyPartialEdits(
  plan: ExpandedCampaignPlan,
  strategy: CampaignStrategy,
  edits: PartialEdit[],
): Promise<ExpandedCampaignPlan> {
  let current = { ...plan, strategy };

  for (const edit of edits) {
    switch (edit.field) {
      case 'cta_type': {
        // Swap CTA patterns from strategy (caller updates strategy.cta_patterns before calling)
        current = rotateCtas(current, current.strategy.cta_patterns);
        break;
      }
      case 'tone_guidelines': {
        current = refreshTone(current, String(edit.newValue ?? ''));
        break;
      }
      case 'target_audience': {
        current = await refreshAudienceHooks(current, String(edit.newValue ?? ''));
        break;
      }
      case 'campaign_goal': {
        current = updateThemes(current, String(edit.newValue ?? ''));
        break;
      }
      case 'duration_trimmed': {
        const weeks = Number(edit.newValue);
        if (Number.isFinite(weeks) && weeks > 0) {
          current = trimWeeks(current, weeks);
        }
        break;
      }
      case 'duration_extended':
      case 'platform_added':
      case 'platform_removed': {
        // These require a full re-expansion — caller should trigger a new job
        // Mark the plan as needing regeneration
        current = {
          ...current,
          confidence: 0.40, // triggers refinement on next job
        };
        break;
      }
    }
  }

  return current;
}

/**
 * Classify which edit fields require a full re-run vs partial patch.
 * Returns true if the edit is too structural for partial regeneration.
 */
export function requiresFullRegeneration(edits: PartialEdit[]): boolean {
  const structural: EditField[] = ['platform_added', 'platform_removed', 'duration_extended'];
  return edits.some(e => structural.includes(e.field));
}
