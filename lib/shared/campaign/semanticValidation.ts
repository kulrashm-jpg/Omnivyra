/**
 * CAMPAIGN-IMPL-007 — Semantic Validation & Regeneration Engine.
 *
 * ONE centralized, deterministic semantic gate that sits BETWEEN AI generation
 * and persistence. Every generated asset passes through `validateAsset`, which
 * checks ten semantic-uniqueness dimensions against the campaign-scoped context
 * (and an optional historical uniqueness ledger) and returns a deterministic
 * decision — ACCEPT / REGENERATE / ADAPT / DROP — with the exact reason.
 *
 * Pure + deterministic (no randomness, no I/O): the caller performs regeneration
 * via the SHARED `regenerateBeforeDrop` primitive and persistence. It reuses the
 * IMPL-004 semantic fingerprints and introduces no new prompt/planner/optimizer
 * behavior.
 */

import { fingerprint, normalizeForFingerprint } from './masterIdea';
import type { DropReasonCode } from './plannerDiagnostics';

export type ValidationDecision = 'ACCEPT' | 'REGENERATE' | 'ADAPT' | 'DROP';

export type ValidationDimension =
  | 'duplicate_headline'
  | 'duplicate_opening'
  | 'duplicate_cta'
  | 'duplicate_semantic_idea'
  | 'duplicate_narrative'
  | 'duplicate_slide'
  | 'duplicate_asset'
  | 'cross_platform_duplication'
  | 'historical_duplication'
  | 'master_idea_consistency';

/** A generated asset as it exists just before persistence. */
export interface GeneratedAsset {
  content_type: string;
  platform: string;
  /** The full caption / body text. */
  text: string;
  /** Carousel slides (for duplicate-slide detection). */
  slides?: string[];
  headline?: string | null;
  /** First sentence / opening line; derived from text when absent. */
  opening?: string | null;
  cta?: string | null;
  idea_fingerprint?: string | null;
  narrative_fingerprint?: string | null;
  master_idea_id?: string | null;
  variant_id?: string | null;
  /** True for intentionally shared/cross-posted assets (excluded from cross-platform dup). */
  shared?: boolean;
}

export interface ValidationFinding {
  dimension: ValidationDimension;
  detail: string;
}

export interface ValidationResult {
  decision: ValidationDecision;
  findings: ValidationFinding[];
  /** The primary (highest-priority) reason, for logs + metrics. */
  reason: string;
}

/** Optional persistent uniqueness ledger (dimension 9). Injected — no I/O in this module. */
export interface HistoricalLedger {
  has(fingerprint: string): boolean;
  add?(fingerprint: string): void;
}

/** Simple in-memory ledger (campaign-run scope, or wrap a persistent store). */
export class InMemoryLedger implements HistoricalLedger {
  private readonly seen = new Set<string>();
  has(fp: string): boolean { return this.seen.has(fp); }
  add(fp: string): void { if (fp) this.seen.add(fp); }
}

const firstSentence = (text: string): string => {
  const t = String(text ?? '').trim();
  const m = t.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : t).trim();
};

/** Accumulates what has already been accepted this campaign, for dup detection. */
export class ValidationContext {
  /**
   * platform::content_type -> normalized headlines already accepted in that scope.
   *
   * Scoped, not campaign-global: `headline` is the CARD's title, and one card
   * legitimately fans out to several platform variants (see masterContentDocument:
   * one master_title, many platforms). A global set made every sibling after the
   * first look like a duplicate of its own card.
   */
  readonly headlines = new Map<string, Set<string>>();
  readonly openings = new Set<string>();
  /**
   * platform::content_type -> normalized CTAs already accepted in that scope.
   *
   * Scoped for the same reason as headlines: the CTA comes from the CARD
   * (`master_idea.cta_strategy`), and creatorCardTypes declares exactly one
   * cta_strategy per card while platform_strategy is a per-platform record. So
   * every platform sibling of a card carries the same CTA by construction, and a
   * campaign-global set flagged each sibling as a duplicate of its own card.
   */
  readonly ctas = new Map<string, Set<string>>();
  /*
   * There is deliberately NO in-run set of idea/narrative fingerprints.
   *
   * Both are sourced from FIXED campaign metadata — bolt closes over
   * `rowContentJson.fingerprint`, creator reads `content.fingerprint` off
   * `input.existingContent`. Every activity of one campaign therefore carries
   * the SAME fingerprint by construction, so comparing them WITHIN a run
   * carries no information: it cannot tell a second legitimate planner slot
   * from a genuine duplicate. Held campaign-globally it dropped five of six
   * activities in production (campaign 4ead230b: generated 6, accepted 1),
   * because every sibling looked like a duplicate of its own campaign.
   *
   * Scoping it to platform+content_type was not enough either — a campaign may
   * legitimately fill two slots of the same format on the same platform.
   *
   * So these fingerprints are now a CROSS-CAMPAIGN signal only, checked against
   * the historical ledger in `validateAsset`. In-run duplicate protection is
   * unchanged and rests on ACTUAL generated content: duplicate_asset (identical
   * text in scope), duplicate_headline, duplicate_opening, duplicate_cta.
   */
  /** platform::content_type → set of normalized text hashes (same-platform exact/near dup). */
  readonly assetHashes = new Map<string, Set<string>>();
  /** normalized text hash → platform (cross-platform detection). */
  readonly textToPlatform = new Map<string, string>();
  /** variant_id → master_idea_id (consistency). */
  readonly variantToMaster = new Map<string, string>();
  constructor(readonly ledger?: HistoricalLedger) {}

  /** The one scheduling-identity key: same platform + same content type. */
  scopeKey(platform: string, type: string): string {
    return `${String(platform).toLowerCase()}::${String(type).toLowerCase()}`;
  }

  /** Record an accepted asset so later assets are compared against it. */
  commit(asset: GeneratedAsset): void {
    const scope = this.scopeKey(asset.platform, asset.content_type);
    const hl = normalizeForFingerprint(asset.headline ?? '');
    if (hl) {
      if (!this.headlines.has(scope)) this.headlines.set(scope, new Set());
      this.headlines.get(scope)!.add(hl);
    }
    const op = normalizeForFingerprint(asset.opening ?? firstSentence(asset.text));
    if (op) this.openings.add(op);
    const cta = normalizeForFingerprint(asset.cta ?? '');
    if (cta) {
      if (!this.ctas.has(scope)) this.ctas.set(scope, new Set());
      this.ctas.get(scope)!.add(cta);
    }
    const textHash = fingerprint(asset.text);
    const k = this.scopeKey(asset.platform, asset.content_type);
    if (!this.assetHashes.has(k)) this.assetHashes.set(k, new Set());
    this.assetHashes.get(k)!.add(textHash);
    if (!asset.shared) this.textToPlatform.set(textHash, String(asset.platform).toLowerCase());
    if (asset.variant_id && asset.master_idea_id) this.variantToMaster.set(asset.variant_id, asset.master_idea_id);
    // Only content-derived hashes are learned during a run. A campaign-constant
    // idea/narrative fingerprint must NOT be written back mid-run: every later
    // sibling of this campaign carries the same value, so the ledger would
    // start rejecting the campaign's own remaining activities the moment one
    // was accepted — the in-run bug this fix removes, reintroduced through the
    // historical door. Seeding the ledger from PRIOR campaigns is the caller's
    // job and stays fully effective.
    this.ledger?.add?.(textHash);
  }
}

export interface ValidateOptions {
  /** Weight cross-platform non-shared dup as ADAPT (default) rather than ignore. */
  flagCrossPlatform?: boolean;
}

/**
 * Validate one generated asset against the campaign context + optional ledger.
 * Deterministic: the same asset + context always yields the same decision.
 *
 * Decision priority (highest wins):
 *   DROP        — Master-Idea inconsistency (a structural violation, not fixable by retry)
 *   REGENERATE  — any fixable duplication (slide/headline/opening/cta/idea/narrative/
 *                 same-platform asset/historical) → the caller retries then drops
 *   ADAPT       — non-shared cross-platform duplication (differentiate per platform)
 *   ACCEPT      — clean
 */
export function validateAsset(
  asset: GeneratedAsset,
  ctx: ValidationContext,
  opts: ValidateOptions = {},
): ValidationResult {
  const findings: ValidationFinding[] = [];
  const flagCrossPlatform = opts.flagCrossPlatform !== false;

  // 10. Master-Idea consistency — a variant must map to exactly one Master Idea.
  if (asset.variant_id && asset.master_idea_id) {
    const prior = ctx.variantToMaster.get(asset.variant_id);
    if (prior && prior !== asset.master_idea_id) {
      findings.push({ dimension: 'master_idea_consistency', detail: `variant ${asset.variant_id} already bound to ${prior}` });
    }
  }

  // 6. Duplicate slide (within a carousel).
  if (Array.isArray(asset.slides) && asset.slides.length > 1) {
    const seen = new Set<string>();
    for (const slide of asset.slides) {
      const h = normalizeForFingerprint(slide);
      if (!h) continue;
      if (seen.has(h)) { findings.push({ dimension: 'duplicate_slide', detail: 'two carousel slides are identical' }); break; }
      seen.add(h);
    }
  }

  // 1/2/3. Duplicate headline / opening / CTA (against prior accepted assets).
  const scope = ctx.scopeKey(asset.platform, asset.content_type);
  const hl = normalizeForFingerprint(asset.headline ?? '');
  if (hl && ctx.headlines.get(scope)?.has(hl)) findings.push({ dimension: 'duplicate_headline', detail: 'headline already used on this platform+type' });
  const op = normalizeForFingerprint(asset.opening ?? firstSentence(asset.text));
  if (op && ctx.openings.has(op)) findings.push({ dimension: 'duplicate_opening', detail: 'opening sentence already used' });
  const cta = normalizeForFingerprint(asset.cta ?? '');
  if (cta && ctx.ctas.get(scope)?.has(cta)) findings.push({ dimension: 'duplicate_cta', detail: 'CTA already used on this platform+type' });

  // 4/5. Duplicate semantic idea / narrative (via fingerprints).
  // 4/5. Duplicate semantic idea / narrative — deliberately NOT evaluated here.
  //
  // Both fingerprints are campaign-constant, so within a run every activity of
  // a campaign matches every other by construction: the check could only ever
  // say "these belong to the same campaign", which is not a defect. Evaluating
  // it dropped five of six activities in production (campaign 4ead230b).
  //
  // Cross-campaign reuse is already covered by `historical_duplication` below,
  // which consults the same ledger and keeps its existing REGENERATE policy —
  // the caller CAN rewrite the content even though it cannot change a fixed
  // fingerprint. Re-adding a terminal fingerprint check here would silently
  // convert that long-standing REGENERATE into a DROP.
  //
  // The two dimensions remain in the contract for callers that supply a
  // per-activity fingerprint; no in-run producer does today.

  // 7. Duplicate asset within campaign (same platform + type, same text).
  const textHash = fingerprint(asset.text);
  if (ctx.assetHashes.get(scope)?.has(textHash)) findings.push({ dimension: 'duplicate_asset', detail: 'identical asset already scheduled on this platform+type' });

  // 8. Cross-platform duplication (shared assets excluded).
  if (!asset.shared && flagCrossPlatform) {
    const otherPlatform = ctx.textToPlatform.get(textHash);
    if (otherPlatform && otherPlatform !== String(asset.platform).toLowerCase()) {
      findings.push({ dimension: 'cross_platform_duplication', detail: `same content already on ${otherPlatform} (not marked shared)` });
    }
  }

  // 9. Historical duplication (persistent ledger).
  if (ctx.ledger) {
    if (ctx.ledger.has(textHash) || (asset.idea_fingerprint ? ctx.ledger.has(asset.idea_fingerprint) : false)) {
      findings.push({ dimension: 'historical_duplication', detail: 'this asset/idea was published before' });
    }
  }

  const decision = decide(findings);
  const reason = findings.length ? primaryReason(findings, decision) : 'passes semantic validation';
  return { decision, findings, reason };
}

/**
 * Terminal findings: the validator can detect the collision, but no caller can
 * produce a candidate that changes the offending field, so REGENERATE would be
 * a remedy none of them can deliver.
 *
 * master_idea_consistency was always here. The two fingerprints join it on the
 * same evidence: every caller sources them from fixed campaign/content metadata
 * -- bolt closes over `rowContentJson.fingerprint`, creator reads
 * `content.fingerprint` off `input.existingContent` while regenerating only
 * `asset_payload`, and the weekly-structure preview never regenerates at all.
 *
 * Contrast duplicate_headline / duplicate_cta, which stay REGENERATE precisely
 * because creatorOrchestrator CAN rewrite them via a new asset payload.
 */
const TERMINAL_DIMENSIONS = new Set<ValidationDimension>([
  'master_idea_consistency', 'duplicate_semantic_idea', 'duplicate_narrative',
]);

const REGENERATE_DIMENSIONS = new Set<ValidationDimension>([
  'duplicate_slide', 'duplicate_headline', 'duplicate_opening', 'duplicate_cta',
  'duplicate_asset', 'historical_duplication',
]);

function decide(findings: ValidationFinding[]): ValidationDecision {
  if (findings.length === 0) return 'ACCEPT';
  if (findings.some((f) => TERMINAL_DIMENSIONS.has(f.dimension))) return 'DROP';
  if (findings.some((f) => REGENERATE_DIMENSIONS.has(f.dimension))) return 'REGENERATE';
  if (findings.some((f) => f.dimension === 'cross_platform_duplication')) return 'ADAPT';
  return 'ACCEPT';
}

/** The finding that actually drove the decision (mirrors `decide`'s priority). */
function primaryFinding(findings: ValidationFinding[], decision: ValidationDecision): ValidationFinding | undefined {
  return decision === 'DROP' ? findings.find((f) => TERMINAL_DIMENSIONS.has(f.dimension))
    : decision === 'REGENERATE' ? findings.find((f) => REGENERATE_DIMENSIONS.has(f.dimension))
    : decision === 'ADAPT' ? findings.find((f) => f.dimension === 'cross_platform_duplication')
    : findings[0];
}

function primaryReason(findings: ValidationFinding[], decision: ValidationDecision): string {
  const pick = primaryFinding(findings, decision);
  return pick ? `${pick.dimension}: ${pick.detail}` : 'passes semantic validation';
}

/**
 * D1 — ValidationDimension -> DropReasonCode.
 *
 * These are two SEPARATE taxonomies. `ValidationDimension` says which semantic
 * rule fired; `DropReasonCode` is the planner's drop vocabulary that
 * `publicDropReason` / `dropReasonMessage` and the scheduling-result UI are
 * defined over. A dimension emitted where a drop reason is expected falls
 * through PUBLIC_DROP_REASON to 'UNKNOWN_ERROR' and through FRIENDLY to the
 * generic message, so a well-understood duplicate reaches the user as an
 * unknown failure.
 *
 * Hard-coding one reason avoids that but mislabels the dimensions that are NOT
 * duplicates: a variant bound to two Master Ideas is a structural violation, and
 * reporting it as DUPLICATE_CONTENT sends the user hunting for a duplicate that
 * does not exist.
 *
 * Kept beside the dimensions themselves so every scheduler that drops on a
 * verdict translates through ONE mapping instead of inventing its own.
 */
const DIMENSION_DROP_REASON: Record<ValidationDimension, DropReasonCode> = {
  duplicate_headline: 'duplicate_content',
  duplicate_opening: 'duplicate_content',
  duplicate_cta: 'duplicate_content',
  duplicate_semantic_idea: 'duplicate_content',
  duplicate_narrative: 'duplicate_content',
  duplicate_slide: 'duplicate_content',
  duplicate_asset: 'duplicate_content',
  cross_platform_duplication: 'duplicate_content',
  historical_duplication: 'duplicate_content',
  // Not a duplicate: a structural violation, which is what validation_failure means.
  master_idea_consistency: 'validation_failure',
};

/**
 * The planner drop reason for a verdict, chosen from the SAME finding the
 * verdict's own `reason` names — not `findings[0]`, which is merely insertion
 * order and carries no contract.
 */
export function plannerDropReasonFor(result: ValidationResult): DropReasonCode {
  const primary = primaryFinding(result.findings, result.decision);
  return primary ? DIMENSION_DROP_REASON[primary.dimension] : 'duplicate_content';
}

/**
 * CAMPAIGN-IMPL-007A — adapt a creator asset (carousel/pdf/slider/infographic/…)
 * into the canonical GeneratedAsset the ONE engine validates. Multi-frame decks
 * expose `slides`/`sections` (→ duplicate-slide / duplicate-section detection);
 * campaign context (master_idea, fingerprints) is read from the row content JSON,
 * exactly as the text path does. Pure — no I/O, deterministic.
 */
export function creatorAssetToGenerated(params: {
  content_type: string;
  platform: string;
  asset_payload?: Record<string, any> | null;
  content?: Record<string, any> | null;
}): GeneratedAsset {
  const payload = params.asset_payload && typeof params.asset_payload === 'object' ? params.asset_payload : {};
  const content = params.content && typeof params.content === 'object' ? params.content : {};
  const mi = content.master_idea && typeof content.master_idea === 'object' ? content.master_idea : {};
  const fp = content.fingerprint && typeof content.fingerprint === 'object' ? content.fingerprint : {};
  const rawFrames = Array.isArray(payload.slides) ? payload.slides : Array.isArray(payload.sections) ? payload.sections : [];
  const slides = rawFrames
    .map((s: any) => `${String(s?.headline ?? s?.title ?? '')} ${String(s?.body ?? s?.body_text ?? s?.text ?? s?.take ?? '')}`.trim())
    .filter(Boolean);
  const packaging = payload.packaging && typeof payload.packaging === 'object' ? payload.packaging : {};
  const caption = String(payload.caption ?? payload.overlay_text ?? (slides.length ? slides.join(' \n ') : payload.body ?? '')).trim();
  const variant = content.variant && typeof content.variant === 'object' ? content.variant : {};
  return {
    content_type: params.content_type,
    platform: params.platform,
    text: caption,
    slides: slides.length > 0 ? slides : undefined,
    headline: (String(payload.headline ?? payload.title ?? content.title ?? '').trim() || null),
    cta: (String(packaging.cta ?? payload.cta ?? mi.cta_strategy ?? '').trim() || null),
    idea_fingerprint: fp.idea ?? null,
    narrative_fingerprint: fp.narrative ?? null,
    master_idea_id: mi.id ?? null,
    variant_id: variant.variant_id ?? null,
    shared: String(content.distribution_mode ?? '').toLowerCase() === 'shared',
  };
}

/** Running tallies for observability (validation pass/regen/accept/drop rates). */
export interface ValidationStats {
  generated: number;
  validated: number;   // passed (accepted or adapted)
  regenerated: number; // saved by regeneration
  accepted: number;
  adapted: number;
  dropped: number;
  reasons: Record<string, number>;
}

export function emptyValidationStats(): ValidationStats {
  return { generated: 0, validated: 0, regenerated: 0, accepted: 0, adapted: 0, dropped: 0, reasons: {} };
}

/** Text / Creator / Combined validation lanes for the planner diagnostics UI. */
export interface CampaignValidationLanes {
  combined: ValidationStats;
  text: ValidationStats;
  creator: ValidationStats;
}

/** Fold one decision into the stats (pure). */
export function tallyValidation(stats: ValidationStats, result: ValidationResult, opts: { regenerated?: boolean } = {}): ValidationStats {
  stats.generated += 1;
  if (opts.regenerated) stats.regenerated += 1;
  const primary = result.findings[0]?.dimension;
  if (primary) stats.reasons[primary] = (stats.reasons[primary] ?? 0) + 1;
  switch (result.decision) {
    case 'ACCEPT': stats.accepted += 1; stats.validated += 1; break;
    case 'ADAPT': stats.adapted += 1; stats.validated += 1; break;
    case 'DROP': stats.dropped += 1; break;
    case 'REGENERATE': /* transient — resolved to accept/drop by the caller */ break;
  }
  return stats;
}
