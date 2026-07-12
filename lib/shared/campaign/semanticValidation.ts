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
  readonly headlines = new Set<string>();
  readonly openings = new Set<string>();
  readonly ctas = new Set<string>();
  readonly ideaFingerprints = new Set<string>();
  readonly narrativeFingerprints = new Set<string>();
  /** platform::content_type → set of normalized text hashes (same-platform exact/near dup). */
  readonly assetHashes = new Map<string, Set<string>>();
  /** normalized text hash → platform (cross-platform detection). */
  readonly textToPlatform = new Map<string, string>();
  /** variant_id → master_idea_id (consistency). */
  readonly variantToMaster = new Map<string, string>();
  constructor(readonly ledger?: HistoricalLedger) {}

  private key(platform: string, type: string): string {
    return `${String(platform).toLowerCase()}::${String(type).toLowerCase()}`;
  }

  /** Record an accepted asset so later assets are compared against it. */
  commit(asset: GeneratedAsset): void {
    const hl = normalizeForFingerprint(asset.headline ?? '');
    if (hl) this.headlines.add(hl);
    const op = normalizeForFingerprint(asset.opening ?? firstSentence(asset.text));
    if (op) this.openings.add(op);
    const cta = normalizeForFingerprint(asset.cta ?? '');
    if (cta) this.ctas.add(cta);
    if (asset.idea_fingerprint) this.ideaFingerprints.add(asset.idea_fingerprint);
    if (asset.narrative_fingerprint) this.narrativeFingerprints.add(asset.narrative_fingerprint);
    const textHash = fingerprint(asset.text);
    const k = this.key(asset.platform, asset.content_type);
    if (!this.assetHashes.has(k)) this.assetHashes.set(k, new Set());
    this.assetHashes.get(k)!.add(textHash);
    if (!asset.shared) this.textToPlatform.set(textHash, String(asset.platform).toLowerCase());
    if (asset.variant_id && asset.master_idea_id) this.variantToMaster.set(asset.variant_id, asset.master_idea_id);
    this.ledger?.add?.(textHash);
    if (asset.idea_fingerprint) this.ledger?.add?.(asset.idea_fingerprint);
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
  const hl = normalizeForFingerprint(asset.headline ?? '');
  if (hl && ctx.headlines.has(hl)) findings.push({ dimension: 'duplicate_headline', detail: 'headline already used' });
  const op = normalizeForFingerprint(asset.opening ?? firstSentence(asset.text));
  if (op && ctx.openings.has(op)) findings.push({ dimension: 'duplicate_opening', detail: 'opening sentence already used' });
  const cta = normalizeForFingerprint(asset.cta ?? '');
  if (cta && ctx.ctas.has(cta)) findings.push({ dimension: 'duplicate_cta', detail: 'CTA already used' });

  // 4/5. Duplicate semantic idea / narrative (via fingerprints).
  if (asset.idea_fingerprint && ctx.ideaFingerprints.has(asset.idea_fingerprint)) findings.push({ dimension: 'duplicate_semantic_idea', detail: 'semantic idea already covered' });
  if (asset.narrative_fingerprint && ctx.narrativeFingerprints.has(asset.narrative_fingerprint)) findings.push({ dimension: 'duplicate_narrative', detail: 'narrative already used' });

  // 7. Duplicate asset within campaign (same platform + type, same text).
  const textHash = fingerprint(asset.text);
  const k = `${String(asset.platform).toLowerCase()}::${String(asset.content_type).toLowerCase()}`;
  if (ctx.assetHashes.get(k)?.has(textHash)) findings.push({ dimension: 'duplicate_asset', detail: 'identical asset already scheduled on this platform+type' });

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

const REGENERATE_DIMENSIONS = new Set<ValidationDimension>([
  'duplicate_slide', 'duplicate_headline', 'duplicate_opening', 'duplicate_cta',
  'duplicate_semantic_idea', 'duplicate_narrative', 'duplicate_asset', 'historical_duplication',
]);

function decide(findings: ValidationFinding[]): ValidationDecision {
  if (findings.length === 0) return 'ACCEPT';
  if (findings.some((f) => f.dimension === 'master_idea_consistency')) return 'DROP';
  if (findings.some((f) => REGENERATE_DIMENSIONS.has(f.dimension))) return 'REGENERATE';
  if (findings.some((f) => f.dimension === 'cross_platform_duplication')) return 'ADAPT';
  return 'ACCEPT';
}

function primaryReason(findings: ValidationFinding[], decision: ValidationDecision): string {
  const pick =
    decision === 'DROP' ? findings.find((f) => f.dimension === 'master_idea_consistency')
    : decision === 'REGENERATE' ? findings.find((f) => REGENERATE_DIMENSIONS.has(f.dimension))
    : decision === 'ADAPT' ? findings.find((f) => f.dimension === 'cross_platform_duplication')
    : findings[0];
  return pick ? `${pick.dimension}: ${pick.detail}` : 'passes semantic validation';
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
