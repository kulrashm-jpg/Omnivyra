/**
 * Strategic Mix P3 — Assignment intelligence (ASSIST-ONLY, SPEC-001 AI
 * contract): recommend, optimize, detect gaps, detect conflicts. Every result
 * is a SUGGESTION the user must explicitly apply — nothing here creates,
 * changes, or removes an assignment, and nothing here is wired to do so
 * automatically. Deterministic and local: same inputs → same advice.
 */

import {
  type CampaignAssignment,
  type StructureSlot,
  assignmentsForSlot,
} from './campaignAssignments';

/** The slice of a library asset the advisor needs — metadata only, no payloads. */
export interface AssignableAsset {
  id: string;
  assetType: string | null;
  title: string | null;
  tags: string[];
}

/* ── Gaps: publishing opportunities with no content assigned ── */

export interface AssignmentGap {
  slot: StructureSlot;
  reason: string;
}

export function detectAssignmentGaps(
  slots: StructureSlot[],
  assignments: CampaignAssignment[],
): AssignmentGap[] {
  return slots
    .filter((slot) => assignmentsForSlot(assignments, slot.structure_id).length === 0)
    .map((slot) => ({
      slot,
      reason: `No asset assigned for ${slot.platform ?? 'any platform'} · ${slot.content_type ?? 'any type'} (week ${slot.week ?? '?'}, ${slot.day ?? 'any day'})`,
    }));
}

/* ── Conflicts ── */

export type AssignmentConflictKind =
  | 'duplicate_asset_same_platform_day'
  | 'content_type_mismatch'
  | 'orphaned_structure';

export interface AssignmentConflict {
  kind: AssignmentConflictKind;
  assignment_ids: string[];
  message: string;
}

/** Content-type families so 'image' matches 'banner', 'carousel' matches
 *  'slider', etc. — mirrors the creator taxonomy consolidation. */
const TYPE_FAMILY: Record<string, string> = {
  image: 'image',
  banner: 'image',
  photo: 'image',
  visual: 'image',
  carousel: 'carousel',
  slider: 'carousel',
  presentation: 'carousel',
  deck: 'carousel',
  infographic: 'infographic',
};

function typeFamily(value: string | null | undefined): string | null {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!key) return null;
  return TYPE_FAMILY[key] ?? key;
}

export function detectAssignmentConflicts(
  slots: StructureSlot[],
  assignments: CampaignAssignment[],
  assets?: AssignableAsset[],
): AssignmentConflict[] {
  const conflicts: AssignmentConflict[] = [];
  const slotIds = new Set(slots.map((s) => s.structure_id));
  const assetTypeById = new Map<string, string | null>();
  for (const a of assets ?? []) assetTypeById.set(a.id, a.assetType);

  // Same asset placed twice on the same platform+day — repeats content the
  // scheduling integrity rules (1/platform/day, no dup content) will reject.
  const byPlacement = new Map<string, CampaignAssignment[]>();
  for (const a of assignments) {
    const key = `${a.asset_id}|${(a.platform ?? '').toLowerCase()}|w${a.week ?? ''}|${(a.day ?? '').toLowerCase()}`;
    byPlacement.set(key, [...(byPlacement.get(key) ?? []), a]);
  }
  for (const group of byPlacement.values()) {
    if (group.length > 1) {
      conflicts.push({
        kind: 'duplicate_asset_same_platform_day',
        assignment_ids: group.map((a) => a.id),
        message: `The same asset is assigned ${group.length}× to ${group[0].platform ?? 'a platform'} on week ${group[0].week ?? '?'} ${group[0].day ?? ''} — duplicate content on one platform/day.`,
      });
    }
  }

  for (const a of assignments) {
    // Assignment pointing at a slot the structure no longer defines.
    if (!slotIds.has(a.structure_id)) {
      conflicts.push({
        kind: 'orphaned_structure',
        assignment_ids: [a.id],
        message: `An assignment references a structure slot that no longer exists (${a.structure_id}). Move or detach it.`,
      });
      continue;
    }
    // Asset family vs the slot's requested content type.
    const assetFamily = typeFamily(assetTypeById.get(a.asset_id));
    const slotFamily = typeFamily(a.content_type);
    if (assetFamily && slotFamily && assetFamily !== slotFamily) {
      conflicts.push({
        kind: 'content_type_mismatch',
        assignment_ids: [a.id],
        message: `A ${assetFamily} asset is assigned to a ${slotFamily} slot (week ${a.week ?? '?'}, ${a.platform ?? 'any platform'}).`,
      });
    }
  }
  return conflicts;
}

/* ── Recommendations: rank library assets per unfilled slot ── */

export interface AssignmentRecommendation {
  slot: StructureSlot;
  asset_id: string;
  score: number;
  reason: string;
}

const keywordsOf = (value: string | null | undefined): string[] =>
  typeof value === 'string'
    ? value.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3)
    : [];

/**
 * Suggest the best library asset for each GAP slot. Scoring (deterministic):
 *   +3  content-type family match
 *   +1  per keyword shared between the slot's title and the asset's title/tags
 *   −2  the asset is already assigned to the same platform+day (conflict-to-be)
 *   −0.5 per existing assignment of the asset (spread reuse around)
 * Ties break by asset id for stable output. Suggestions only — the caller
 * (a human) applies them one by one.
 */
export function recommendAssignments(
  slots: StructureSlot[],
  assets: AssignableAsset[],
  assignments: CampaignAssignment[],
): AssignmentRecommendation[] {
  const gaps = detectAssignmentGaps(slots, assignments);
  const recommendations: AssignmentRecommendation[] = [];

  for (const gap of gaps) {
    const slot = gap.slot;
    const slotFamily = typeFamily(slot.content_type);
    const slotWords = new Set(keywordsOf(slot.title));
    let best: AssignmentRecommendation | null = null;

    for (const asset of assets) {
      let score = 0;
      const reasons: string[] = [];
      const assetFamily = typeFamily(asset.assetType);
      if (slotFamily && assetFamily === slotFamily) {
        score += 3;
        reasons.push(`type matches (${slotFamily})`);
      } else if (slotFamily && assetFamily && assetFamily !== slotFamily) {
        continue; // never recommend a type-mismatched asset into a typed slot
      }
      const assetWords = new Set([...keywordsOf(asset.title), ...asset.tags.flatMap(keywordsOf)]);
      let overlap = 0;
      for (const w of slotWords) if (assetWords.has(w)) overlap += 1;
      if (overlap > 0) {
        score += overlap;
        reasons.push(`${overlap} theme keyword${overlap > 1 ? 's' : ''} in common`);
      }
      const uses = assignments.filter((a) => a.asset_id === asset.id);
      const samePlacement = uses.some(
        (a) =>
          (a.platform ?? '').toLowerCase() === (slot.platform ?? '').toLowerCase() &&
          a.week === slot.week &&
          (a.day ?? '').toLowerCase() === (slot.day ?? '').toLowerCase(),
      );
      if (samePlacement) score -= 2;
      score -= uses.length * 0.5;
      if (uses.length === 0) reasons.push('not yet used in this campaign');

      if (score <= 0) continue;
      const candidate: AssignmentRecommendation = {
        slot,
        asset_id: asset.id,
        score,
        reason: reasons.join('; ') || 'available in the library',
      };
      if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.asset_id < best.asset_id)) {
        best = candidate;
      }
    }
    if (best) recommendations.push(best);
  }
  return recommendations;
}
