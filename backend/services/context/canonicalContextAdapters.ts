/**
 * canonicalContextAdapters.ts — CONTENT-INTELLIGENCE-002 Phase 5/8.
 *
 * Adapters that let existing AI consumers switch their GROUNDING SOURCE to the
 * canonical context WITHOUT redesigning their prompts. `toBriefGrounding`
 * matches the shape CONTENT-INTELLIGENCE-001 introduced ({text, signals,
 * strength}) so the swap is one line and fully backward compatible.
 */
import {
  FIELD_LABELS,
  type CanonicalContext,
  type Fact,
} from './canonicalContextTypes';

/** Legacy 3-tier strength expected by CI-001 consumers. */
export type LegacyStrength = 'strong' | 'moderate' | 'thin';

export function legacyStrength(ctx: CanonicalContext): LegacyStrength {
  switch (ctx.quality.overall) {
    case 'excellent':
    case 'strong': return 'strong';
    case 'moderate': return 'moderate';
    default: return 'thin';
  }
}

function fact(ctx: CanonicalContext, key: keyof CanonicalContext): Fact<unknown> | null {
  const v = ctx[key] as unknown;
  return v && typeof v === 'object' && 'origin' in (v as object) ? (v as Fact<unknown>) : null;
}

function valueText(v: unknown): string {
  return Array.isArray(v) ? v.join(', ') : String(v);
}

function clip(v: string, max = 60): string {
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Fields (in priority order) that carry substantive grounding for a brief. */
const BRIEF_FIELDS: ReadonlyArray<[keyof CanonicalContext, string, string]> = [
  ['offerings', 'Products / services', 'Offer'],
  ['icp', 'Target audience / ICP', 'ICP'],
  ['differentiators', 'Differentiation', 'Edge'],
  ['painPoints', 'Customer pain points', 'Pains'],
  ['brandPositioning', 'Brand positioning', 'Brand'],
  ['industry', 'Industry', 'Industry'],
  ['websiteIntelligence', 'Website', 'Site'],
  ['contentHistory', 'Published content', 'History'],
  ['currentInitiatives', 'Current initiatives', 'Initiatives'],
  ['marketPosition', 'Market position', 'Market'],
];

/**
 * CI-001-compatible grounding: a labeled text block + short signal chips +
 * a 3-tier strength. Drop-in replacement for buildGroundingContext(profile).
 */
export function toBriefGrounding(ctx: CanonicalContext): { text: string; signals: string[]; strength: LegacyStrength } {
  const lines: string[] = [];
  const signals: string[] = [];
  for (const [key, label, chip] of BRIEF_FIELDS) {
    const f = fact(ctx, key);
    if (!f) continue;
    const text = valueText(f.value);
    if (!text.trim()) continue;
    lines.push(`${label}: ${text}`);
    signals.push(`${chip}: ${clip(text, 48)}`);
  }
  return { text: lines.join('\n'), signals, strength: legacyStrength(ctx) };
}

/** Full transparency payload for UIs that show Grounded From / Confidence / Freshness / Missing. */
export function toTransparencyPayload(ctx: CanonicalContext) {
  return {
    groundedFrom: ctx.transparency.groundedFrom,
    confidence: ctx.transparency.confidence,
    freshness: ctx.transparency.freshnessLabel,
    evidenceAvailable: ctx.transparency.evidenceAvailable,
    missingContext: ctx.transparency.missingContext,
    quality: {
      overall: ctx.quality.overall,
      dimensions: ctx.quality.dimensions,
    },
    evidence: ctx.evidenceIntelligence,
    labels: FIELD_LABELS,
  };
}
