/**
 * P3-B — per-slot review package + derived readiness (PURE).
 *
 * THE QUESTION THIS ANSWERS
 * -------------------------
 *   "Is what the CMO approved the same content package the scheduler will
 *    actually attempt to execute?"
 *
 * Before P3-B, text and assets were approved through two independent, unjoined
 * facts: `content_planning_status` (planning-owned, per slot) and
 * `CampaignAssignment.approval` (planning-owned, per assignment). A slot could
 * show "Approved" on its text while carrying an unapproved — or entirely
 * missing — asset, and nothing surfaced the mismatch.
 *
 * WHAT THIS IS NOT
 * ----------------
 *   • NOT a persisted lifecycle status. Every value here is DERIVED on read
 *     from facts that already exist. Nothing is written, no vocabulary is
 *     added to draft/review/approved, and `campaign_readiness` (informational
 *     since B1) is deliberately NOT consulted — that is campaign planning
 *     completeness, not slot execution readiness.
 *   • NOT a second publisher. Execution capability is CONSUMED as an optional
 *     input; this module never decides what a platform can publish. The
 *     backend authority remains publishReadinessValidator (P3-A).
 *
 * REVIEW READINESS vs EXECUTION READINESS
 * ---------------------------------------
 * They are related and NOT identical, and this module keeps them separate:
 *   review_ready    — the humans have approved the package
 *   execution_ready — the system can actually deliver it
 * A package can be review-ready and execution-blocked (e.g. an image on a
 * platform whose media upload is switched off). `ready` requires BOTH; when
 * capability is not supplied, the verdict is `execution_unknown` rather than
 * an unearned `ready`.
 *
 * Pure and deterministic: same facts → same verdict. No I/O, no clock.
 */

import { deriveContentItems, type ContentPlanLike, type ContentWorkspaceItem } from './campaignContentModel';
import type { CampaignAssignment } from './campaignAssignments';

/* ── Asset facts (the shape fetchLibraryMaterializableAssets already returns) ── */

export interface ReviewableAssetSource {
  id: string;
  title: string | null;
  url: string | null;
  files?: unknown[] | null;
  creatorType: string | null;
  version: number | null;
}

/** One renderable piece of an asset — a single image, or one carousel slide. */
export interface ReviewAssetSlide {
  /** 1-based, matching what the reviewer sees. */
  index: number;
  url: string | null;
  /** False ⇒ the slide is assigned but has no usable URL. */
  available: boolean;
}

export interface ReviewAsset {
  assignment_id: string;
  asset_id: string;
  /** Resolved from the library; null ⇒ assigned but not found (missing asset). */
  title: string | null;
  creator_type: string | null;
  version: number | null;
  /** Publication slot within the opportunity, e.g. 'primary' / 'story'. */
  slot_role: string | null;
  approval: string;
  /** Ordered renderables. One entry for an image; N for a carousel. */
  slides: ReviewAssetSlide[];
  /** True when every slide resolved to a usable URL. */
  fully_available: boolean;
  /** True when the library had no record for this asset_id at all. */
  missing: boolean;
  /** True when this asset is a video family (preview differs from an image). */
  is_video: boolean;
}

/* ── Verdict ── */

export type SlotReadinessCode =
  | 'ready'
  | 'blocked_text'
  | 'blocked_asset'
  | 'blocked_execution'
  | 'execution_unknown';

export interface SlotReadiness {
  code: SlotReadinessCode;
  /** Humans have approved everything present. */
  review_ready: boolean;
  /** The system can deliver it (false/unknown when capability says otherwise). */
  execution_ready: boolean | null;
  /** One short sentence a CMO can act on. */
  reason: string;
}

export interface SlotReviewPackage {
  slot: ContentWorkspaceItem['slot'];
  /** Planning-owned text facts, unchanged from campaignContentModel. */
  text: {
    body: string | null;
    status: string;
    has_content: boolean;
    manually_edited: boolean;
  };
  assets: ReviewAsset[];
  readiness: SlotReadiness;
}

/** Optional execution-capability facts, supplied by the caller. */
export interface ExecutionCapabilityInput {
  /**
   * platform (lowercased) → adapter will actually upload media.
   * ABSENT for a platform ⇒ unknown, which yields `execution_unknown` rather
   * than a claimed `ready`. Never inferred here.
   */
  mediaCapableByPlatform?: Record<string, boolean>;
}

const VIDEO_TYPES = new Set(['video', 'reel', 'short', 'podcast']);

const asUrl = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

/** A file entry may be a bare url string or an object carrying one. */
function fileUrl(entry: unknown): string | null {
  const direct = asUrl(entry);
  if (direct) return direct;
  if (entry && typeof entry === 'object') {
    const o = entry as Record<string, unknown>;
    return asUrl(o.url) ?? asUrl(o.src) ?? asUrl(o.href);
  }
  return null;
}

/**
 * Build the ordered slide list for one asset.
 *
 * `files[]` is the carousel case — ORDER IS PRESERVED exactly as stored, and a
 * file that yields no URL becomes an explicitly UNAVAILABLE slide rather than
 * being dropped. Silently omitting a slide would let a 4-of-5 carousel read as
 * complete.
 */
function buildSlides(source: ReviewableAssetSource | undefined): ReviewAssetSlide[] {
  if (!source) return [];
  const files = Array.isArray(source.files) ? source.files : null;
  if (files && files.length > 0) {
    return files.map((f, i) => {
      const url = fileUrl(f);
      return { index: i + 1, url, available: url !== null };
    });
  }
  const single = asUrl(source.url);
  return [{ index: 1, url: single, available: single !== null }];
}

function resolveAsset(
  assignment: CampaignAssignment,
  library: Map<string, ReviewableAssetSource> | undefined,
): ReviewAsset {
  const source = library?.get(assignment.asset_id);
  const slides = buildSlides(source);
  const creatorType = source?.creatorType ?? assignment.content_type ?? null;
  return {
    assignment_id: assignment.id,
    asset_id: assignment.asset_id,
    title: source?.title ?? null,
    creator_type: creatorType,
    version: source?.version ?? assignment.asset_version ?? null,
    slot_role: assignment.slot ?? null,
    approval: assignment.approval ?? 'not_required',
    slides,
    fully_available: slides.length > 0 && slides.every((s) => s.available),
    missing: !source,
    is_video: VIDEO_TYPES.has(String(creatorType ?? '').toLowerCase()),
  };
}

/**
 * Derive the readiness verdict from the facts of ONE package.
 *
 * Order is deliberate: the earliest unmet precondition is reported, because
 * that is the one the reviewer must act on first.
 */
export function deriveSlotReadiness(input: {
  text: SlotReviewPackage['text'];
  assets: ReviewAsset[];
  platform: string | null;
  /** Company-level toggle — when false, assignment approval is not required. */
  requireApproval?: boolean;
  capability?: ExecutionCapabilityInput;
}): SlotReadiness {
  const { text, assets, platform, requireApproval, capability } = input;

  // 1. TEXT — planning-owned, unchanged vocabulary.
  if (!text.has_content) {
    return { code: 'blocked_text', review_ready: false, execution_ready: null, reason: 'No content written yet.' };
  }
  if (text.status !== 'approved') {
    return {
      code: 'blocked_text',
      review_ready: false,
      execution_ready: null,
      reason: text.status === 'review' ? 'Content is awaiting approval.' : 'Content is still a draft.',
    };
  }

  // 2. ASSETS — every assigned asset must resolve and be fully available.
  const missing = assets.filter((a) => a.missing);
  if (missing.length > 0) {
    return {
      code: 'blocked_asset',
      review_ready: false,
      execution_ready: null,
      reason: `${missing.length} assigned asset(s) could not be found in the library.`,
    };
  }
  const incomplete = assets.filter((a) => !a.fully_available);
  if (incomplete.length > 0) {
    const gaps = incomplete.reduce((n, a) => n + a.slides.filter((s) => !s.available).length, 0);
    return {
      code: 'blocked_asset',
      review_ready: false,
      execution_ready: null,
      reason: `${gaps} asset file(s) are missing or unavailable.`,
    };
  }
  if (requireApproval) {
    const unapproved = assets.filter((a) => a.approval !== 'approved' && a.approval !== 'not_required');
    if (unapproved.length > 0) {
      return {
        code: 'blocked_asset',
        review_ready: false,
        execution_ready: null,
        reason: `${unapproved.length} assigned asset(s) still need approval.`,
      };
    }
  }

  // Humans are satisfied from here on.
  const reviewReady = true;

  // 3. EXECUTION CAPABILITY — consumed, never decided here.
  if (assets.length > 0) {
    const key = String(platform ?? '').trim().toLowerCase();
    const capable = capability?.mediaCapableByPlatform?.[key];
    if (capable === false) {
      return {
        code: 'blocked_execution',
        review_ready: reviewReady,
        execution_ready: false,
        reason: `${platform ?? 'This platform'} cannot publish attached media right now, so this would send text only.`,
      };
    }
    if (capable === undefined) {
      return {
        code: 'execution_unknown',
        review_ready: reviewReady,
        execution_ready: null,
        reason: 'Approved. Media delivery for this platform has not been confirmed.',
      };
    }
  }

  return {
    code: 'ready',
    review_ready: true,
    execution_ready: true,
    reason: assets.length > 0 ? 'Approved with media, ready to schedule.' : 'Approved, ready to schedule.',
  };
}

/**
 * Build the review package for every slot in the plan.
 *
 * The review UNIT is the existing `StructureSlot` (campaign → week → day →
 * platform → content type). Platform variants stay independent because each
 * platform is its own slot in the live architecture — no packages are merged
 * across platforms, and no `content_variant` is involved.
 */
export function deriveSlotReviewPackages(input: {
  plan: ContentPlanLike | null | undefined;
  assignments: CampaignAssignment[] | null | undefined;
  assets?: Map<string, ReviewableAssetSource> | null;
  requireApproval?: boolean;
  capability?: ExecutionCapabilityInput;
}): SlotReviewPackage[] {
  const items = deriveContentItems(input.plan);
  const assignments = Array.isArray(input.assignments) ? input.assignments : [];
  const library = input.assets ?? undefined;

  const bySlot = new Map<string, CampaignAssignment[]>();
  for (const a of assignments) {
    if (!a?.structure_id) continue;
    const list = bySlot.get(a.structure_id) ?? [];
    list.push(a);
    bySlot.set(a.structure_id, list);
  }

  return items.map((item) => {
    // Ordering is the assignment's own `ordering`, so multi-asset review shows
    // what execution would use, in the same sequence.
    const slotAssignments = (bySlot.get(item.slot.structure_id) ?? [])
      .slice()
      .sort((a, b) => (a.ordering ?? 0) - (b.ordering ?? 0));
    const assets = slotAssignments.map((a) => resolveAsset(a, library ?? undefined));
    const text = {
      body: item.draft?.body ?? null,
      status: item.status,
      has_content: item.has_content,
      manually_edited: item.manually_edited,
    };
    return {
      slot: item.slot,
      text,
      assets,
      readiness: deriveSlotReadiness({
        text,
        assets,
        platform: item.slot.platform,
        requireApproval: input.requireApproval,
        capability: input.capability,
      }),
    };
  });
}

/** Counts for a header strip. Derived, never persisted. */
export function summarizeSlotReadiness(packages: SlotReviewPackage[]): Record<SlotReadinessCode, number> & { total: number } {
  const out = {
    ready: 0, blocked_text: 0, blocked_asset: 0, blocked_execution: 0, execution_unknown: 0, total: 0,
  };
  for (const p of packages) {
    out[p.readiness.code] += 1;
    out.total += 1;
  }
  return out;
}
