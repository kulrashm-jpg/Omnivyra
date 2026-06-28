/**
 * Canonical Marketing Brief resolver (CREATOR-063, STEP 4).
 *
 * The ONE bridge from the Unified Workspace's MarketingBrief to what editors and
 * generators consume:
 *
 *   MarketingBrief → EditorContext → GeneratorContext
 *
 * No editor-specific mapping logic anywhere else: every editor prefills from
 * `resolveEditorContext`, every generation request derives from
 * `resolveGeneratorContext`. Pure + deterministic; additive (a null/absent brief
 * yields empty defaults, so an editor opened without a workspace brief behaves
 * exactly as before). No generation/render/editor-capability change.
 */

import type { MarketingBrief } from './unifiedCreationModel';
import { getCreationGoal } from './unifiedCreationModel';

/** Normalized fields any editor prefills from (replaces per-editor question flows). */
export interface EditorContext {
  goalId: string | null;
  goalLabel: string;
  topic: string;
  objective: string;
  audience: string;
  tone: string;
  cta: string;
  brand: string;
  offer: string;
  freeText: string;
}

/** Fields a generation request derives from (mirrors the existing creator_card / writer prefill shape). */
export interface GeneratorContext {
  topic: string;
  objective: string;
  audience: string;
  summary: string;
  goalId: string | null;
  /** Additive creator_card fragment — generators already accept these keys. */
  creatorCard: Record<string, unknown>;
}

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** MarketingBrief → EditorContext. The single editor-facing mapping. */
export function resolveEditorContext(brief: MarketingBrief | null | undefined): EditorContext {
  const goal = brief?.goalId ? getCreationGoal(brief.goalId) : null;
  const goalLabel = goal?.label ?? '';
  const freeText = s(brief?.freeText);
  const offer = s(brief?.offer);
  return {
    goalId: brief?.goalId ?? null,
    goalLabel,
    topic: freeText || offer || goalLabel,
    objective: goalLabel || offer,
    audience: s(brief?.audience),
    tone: s(brief?.tone),
    cta: s(brief?.cta),
    brand: s(brief?.brand),
    offer,
    freeText,
  };
}

/** MarketingBrief → GeneratorContext. The single generator-facing mapping. */
export function resolveGeneratorContext(brief: MarketingBrief | null | undefined): GeneratorContext {
  const e = resolveEditorContext(brief);
  const creatorCard: Record<string, unknown> = {};
  if (e.objective) creatorCard.objective = e.objective;
  if (e.audience) creatorCard.audience = e.audience;
  if (e.tone) creatorCard.tone = e.tone;
  if (e.cta) creatorCard.cta = e.cta;
  if (e.brand) creatorCard.brand_context = e.brand;
  return {
    topic: e.topic,
    objective: e.objective,
    audience: e.audience,
    summary: e.freeText || e.offer || e.goalLabel,
    goalId: e.goalId,
    creatorCard,
  };
}

/* ── Canonical session bridge (the Workspace writes it; editors read it) ────── */

export const MARKETING_BRIEF_SESSION_KEY = 'marketing-brief';

export function serializeMarketingBrief(brief: MarketingBrief): string {
  return JSON.stringify(brief);
}

/** Safe parse of the canonical brief; null when missing/invalid (legacy behavior). */
export function readMarketingBrief(raw: string | null | undefined): MarketingBrief | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as MarketingBrief;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* fall through */ }
  return null;
}
