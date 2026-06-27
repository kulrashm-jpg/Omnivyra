/**
 * Canonical deterministic validation for Creator AI copy.
 *
 * ONE validation layer applied to EVERY AI response (generate / rewrite /
 * improve / expand / shorten). Validates against the canonical brand voice +
 * company context and REPAIRS or REJECTS violations before the value is
 * returned. Pure + deterministic — no LLM, no network.
 *
 * Checks:
 *   - forbidden words / phrases (brand vocabulary `prohibitedPhrases`)
 *   - prohibited compliance claims (`prohibitedClaims`)
 *   - banned generic CTAs (click here / submit / read now)
 *   - fabricated/unsupported superlative claims (#1, world-class, guaranteed, …)
 *   - required terminology presence (advisory)
 */

import type { CreatorBrandVoice } from './creatorCopyContextResolver';

export type CopyViolationType =
  | 'forbidden_phrase'
  | 'prohibited_claim'
  | 'banned_cta'
  | 'fabricated_claim'
  | 'missing_required_term'
  | 'emptied_by_repair';

export interface CopyViolation {
  type: CopyViolationType;
  detail: string;
}

export interface CopyValidationResult {
  /** The repaired value (offending content removed). */
  value: string;
  violations: CopyViolation[];
  repaired: boolean;
  /** False when repair could not yield a usable value (caller should fall back). */
  ok: boolean;
}

// Generic, unsupported superlative claims that read as hallucinated marketing
// unless the brand explicitly lists them as required terms.
const FABRICATED_CLAIM_PATTERNS: ReadonlyArray<RegExp> = [
  /#1\b/gi,
  /\bworld[-\s]?class\b/gi,
  /\bbest[-\s]?in[-\s]?class\b/gi,
  /\bindustry[-\s]?leading\b/gi,
  /\bguaranteed?\b/gi,
  /\brevolutionary\b/gi,
  /\bunmatched\b/gi,
];

const BANNED_CTA_PATTERN = /\b(click here|submit|read now)\b/gi;

function collapse(s: string): string {
  return s.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validate + repair a single AI-produced field value against the canonical
 * brand voice. `isCta` enables CTA-specific rules.
 */
export function validateCreatorCopyValue(
  rawValue: string,
  fieldKey: string,
  brandVoice: CreatorBrandVoice | undefined,
): CopyValidationResult {
  const violations: CopyViolation[] = [];
  let value = String(rawValue ?? '');
  let repaired = false;
  const bv = brandVoice ?? {};
  const isCta = fieldKey.toLowerCase().includes('cta');

  // 1) Forbidden words/phrases (brand vocabulary).
  for (const phrase of bv.prohibitedPhrases ?? []) {
    const p = String(phrase || '').trim();
    if (!p) continue;
    const re = new RegExp(`\\b${escapeRegExp(p)}\\b`, 'gi');
    if (re.test(value)) {
      value = value.replace(re, '');
      repaired = true;
      violations.push({ type: 'forbidden_phrase', detail: p });
    }
  }

  // 2) Prohibited compliance claims.
  for (const claim of bv.prohibitedClaims ?? []) {
    const c = String(claim || '').trim();
    if (!c) continue;
    const re = new RegExp(`\\b${escapeRegExp(c)}\\b`, 'gi');
    if (re.test(value)) {
      value = value.replace(re, '');
      repaired = true;
      violations.push({ type: 'prohibited_claim', detail: c });
    }
  }

  // 3) Banned generic CTAs → replace with the brand CTA style (or a safe default).
  if (BANNED_CTA_PATTERN.test(value)) {
    BANNED_CTA_PATTERN.lastIndex = 0;
    const replacement = isCta ? (bv.ctaStyle && /^[\w ]+$/.test(bv.ctaStyle) ? bv.ctaStyle : 'Learn more') : '';
    value = value.replace(BANNED_CTA_PATTERN, replacement);
    repaired = true;
    violations.push({ type: 'banned_cta', detail: 'generic CTA replaced' });
  }

  // 4) Fabricated/unsupported superlative claims (unless a required term).
  const requiredLower = (bv.requiredTerms ?? []).map((t) => String(t).toLowerCase());
  for (const pattern of FABRICATED_CLAIM_PATTERNS) {
    pattern.lastIndex = 0;
    const match = value.match(pattern);
    if (match && !match.some((m) => requiredLower.includes(m.toLowerCase()))) {
      value = value.replace(pattern, '');
      repaired = true;
      violations.push({ type: 'fabricated_claim', detail: match[0] });
    }
  }

  if (repaired) value = collapse(value);

  // 5) Required terminology presence — advisory only (never force-injected).
  for (const term of bv.requiredTerms ?? []) {
    const t = String(term || '').trim();
    if (t && !new RegExp(`\\b${escapeRegExp(t)}\\b`, 'i').test(value)) {
      violations.push({ type: 'missing_required_term', detail: t });
    }
  }

  const ok = value.trim().length > 0;
  if (!ok && rawValue.trim().length > 0) {
    violations.push({ type: 'emptied_by_repair', detail: fieldKey });
  }

  return { value: value.trim(), violations, repaired, ok };
}

/* ── Master-generation output validation ─────────────────────────────── */

/** True when the brand voice carries any enforceable constraint. */
export function hasBrandConstraints(bv: CreatorBrandVoice | undefined): boolean {
  if (!bv) return false;
  return Boolean(
    (bv.prohibitedPhrases && bv.prohibitedPhrases.length)
    || (bv.prohibitedClaims && bv.prohibitedClaims.length)
    || (bv.requiredTerms && bv.requiredTerms.length)
    || bv.ctaStyle,
  );
}

export interface OutputCopyValidationResult {
  assetPayload: Record<string, unknown>;
  violations: CopyViolation[];
  repaired: boolean;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const OVERLAY_KEYS = ['hook', 'headline', 'keyInsight', 'cta', 'supportingText'] as const;
const SLIDE_KEYS = ['title', 'headline', 'body', 'body_text'] as const;

/**
 * Apply the SAME deterministic validation to every text field of a generated
 * asset payload (overlay copy, carousel slides, infographic section lines)
 * BEFORE render — the master-generation analogue of field-assist validation.
 *
 * No-op (byte-identical) when the brand defines no constraints, so existing
 * (no-brand-vocabulary) Creator flows are unchanged. Returns a NEW payload when
 * anything was repaired; otherwise the input is returned unchanged.
 */
export function validateCreatorOutputCopy(
  assetPayload: Record<string, unknown>,
  brandVoice: CreatorBrandVoice | undefined,
): OutputCopyValidationResult {
  if (!hasBrandConstraints(brandVoice)) {
    return { assetPayload, violations: [], repaired: false };
  }
  const violations: CopyViolation[] = [];
  let repaired = false;
  const fix = (raw: unknown, key: string): string => {
    const original = String(raw ?? '');
    if (!original.trim()) return original;
    const r = validateCreatorCopyValue(original, key, brandVoice);
    if (r.repaired) {
      repaired = true;
      violations.push(...r.violations);
      return r.ok ? r.value : original; // never blank generated content
    }
    if (r.violations.length) violations.push(...r.violations);
    return original;
  };

  const next: Record<string, unknown> = { ...assetPayload };

  // overlay_text (top-level + media_bundle.metadata)
  const fixOverlay = (o: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...o };
    for (const k of OVERLAY_KEYS) if (k in out) out[k] = fix(out[k], k);
    return out;
  };
  if (assetPayload.overlay_text) next.overlay_text = fixOverlay(obj(assetPayload.overlay_text));

  // slides[]
  if (Array.isArray(assetPayload.slides)) {
    next.slides = assetPayload.slides.map((s) => {
      const slide = obj(s);
      const out: Record<string, unknown> = { ...slide };
      for (const k of SLIDE_KEYS) if (k in out) out[k] = fix(out[k], k === 'body' || k === 'body_text' ? 'body' : 'headline');
      return out;
    });
  }

  // media_bundle.metadata.{overlay_text, thread_visual_transform.items}
  const mb = obj(assetPayload.media_bundle);
  const meta = obj(mb.metadata);
  if (Object.keys(meta).length > 0) {
    const nextMeta: Record<string, unknown> = { ...meta };
    if (meta.overlay_text) nextMeta.overlay_text = fixOverlay(obj(meta.overlay_text));
    const tvt = obj(meta.thread_visual_transform);
    if (Array.isArray(tvt.items)) {
      nextMeta.thread_visual_transform = { ...tvt, items: tvt.items.map((it) => fix(it, 'headline')) };
    }
    next.media_bundle = { ...mb, metadata: nextMeta };
  }

  return repaired ? { assetPayload: next, violations, repaired } : { assetPayload, violations, repaired: false };
}
