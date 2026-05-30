/**
 * Governance Item Enricher (Closure Pass — Phase 4).
 *
 * Single shared helper for closing governance bypasses in the content
 * generation pipeline. Any caller that constructs an `item` envelope
 * to hand to `generateMasterContentFromIntent` /
 * `buildPlatformVariantsFromMaster` SHOULD route it through
 * `enrichItemWithGovernance(item)` so the system-prompt governance
 * preamble fires uniformly.
 *
 * STRICT scope:
 *   - Pure additive — when no company profile is resolvable or the
 *     industry is non-regulated, the returned item is byte-identical
 *     to the input (no `governance` field added).
 *   - Best-effort: profile resolution failures swallow errors and
 *     return the item unchanged.
 *   - Reuses `getProfile` + `buildGovernancePromptContext`. No second
 *     governance system.
 *
 * The function lives next to the policy registry so any future
 * runtime invalidation work (Phase 2's `invalidateGovernanceCaches`)
 * can wire into this single resolution site.
 */

import { getProfile } from '../companyProfileService';
import { buildGovernancePromptContext } from './strategyGovernancePromptContext';
import { auditRestrictedStrategySelected } from './strategyGovernanceAuditEvents';
import type { CreatorTypeForVariant } from '../../../lib/variants/creatorStrategyMapping';
import type { GovernancePromptContext } from './strategyGovernancePromptContext';

/**
 * Closure Pass — Phase 5 (audit parity). When the resolved
 * governance context indicates the operator-selected strategy is
 * restricted, fire the canonical audit event so the compliance trail
 * captures direct-API + queue + scheduler selections — not just
 * picker-mediated ones. Best-effort (the audit helper itself is
 * fire-and-forget and swallows errors).
 *
 * Pure side-effect; returns nothing.
 */
export function maybeAuditRestrictedStrategySelection(input: {
  context: GovernancePromptContext;
  companyId: string | null | undefined;
  contentType: string;
  actorUserId?: string | null;
}): void {
  try {
    if (!input.companyId) return;
    if (!input.context.selectedStrategyIsRestricted) return;
    const reason = input.context.selectedStrategyGovernanceReason
      ?? 'restricted by policy';
    if (!input.context.selectedStrategy) return;
    auditRestrictedStrategySelected({
      companyId: input.companyId,
      industry: input.context.industry,
      riskLevel: input.context.riskLevel,
      strategyId: input.context.selectedStrategy,
      contentType: input.contentType,
      restrictionReason: reason,
      actorUserId: input.actorUserId ?? null,
    });
  } catch {
    // Best-effort.
  }
}

/**
 * Enrich a pipeline item with the resolved governance prompt context.
 *
 * When the caller already set `item.governance`, the existing value
 * is preserved (no overwrite). Otherwise, resolves the profile by
 * `item.company_id`, builds the context, and attaches it.
 *
 * `lane` controls which content-type lane policy is applied. Posts /
 * threads / theme treatments share the 'image' lane policy by
 * convention (no separate text policy exists today); callers
 * generating visual assets through this helper should pass the
 * matching lane.
 *
 * Returns the item unchanged when:
 *   - it already carries a `governance` field
 *   - no `company_id` is present
 *   - profile resolution fails
 *   - the resolved industry yields the empty policy (no directives)
 */
export async function enrichItemWithGovernance<T extends Record<string, unknown>>(
  item: T,
  options?: {
    lane?: CreatorTypeForVariant;
    selectedStrategy?: string | null;
  },
): Promise<T> {
  if (item && typeof item === 'object' && 'governance' in item && (item as any).governance) {
    return item;
  }
  const companyId = typeof (item as any)?.company_id === 'string' ? (item as any).company_id : null;
  if (!companyId) return item;
  try {
    const profile = await getProfile(companyId, { autoRefine: false });
    if (!profile) return item;
    const context = buildGovernancePromptContext({
      companyContext: {
        industry: (profile as any).industry ?? null,
        industry_list: (profile as any).industry_list ?? null,
        category: (profile as any).category ?? null,
        category_list: (profile as any).category_list ?? null,
      },
      contentType: options?.lane ?? 'image',
      selectedStrategy: options?.selectedStrategy ?? null,
    });
    // No-op when industry='none' AND no compliance directives — the
    // preamble builder would return null anyway, but we skip the
    // attach to keep the item byte-identical to the input.
    if (context.industry === 'none' && context.compliancePromptDirectives.length === 0) {
      return item;
    }
    return { ...item, governance: context } as T;
  } catch {
    return item;
  }
}
