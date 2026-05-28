/**
 * Phase 12.5 — Ecosystem-wide narrative governor.
 *
 * The cross-modal continuity governor (Phase 3) handles ONE transformation;
 * this governor reviews the WHOLE ecosystem (all formats together) and
 * ensures the strategic narrative evolves coherently.
 *
 * Detects:
 *   NARRATIVE_FRAGMENTATION       no dominant narrative class — every
 *                                  format tells a different story
 *   POSITIONING_CONTRADICTION     two formats hold opposing positions
 *                                  (e.g. "instead of" vs "sequenced before")
 *   AUTHORITY_INCOHERENCE         high-authority pillar in one format,
 *                                  near-zero authority in another for same archetype
 *   EDUCATIONAL_DISORIENTATION    funnel ranks scattered — no progression
 *                                  for any ICP
 *   STRATEGIC_DIVERGENCE          per-format dominant signature diverges
 *                                  from the global dominant signature
 *
 * Pure / deterministic. Reuses the semantic matcher so synonym-aware.
 */

import type {
  CrossModalAsset,
  CrossModalFormat,
  EcosystemNarrativeIssue,
  EcosystemNarrativeResult,
} from './longFormRecommendationTypes';
import { createSemanticMatcher, type SemanticMatcher } from './semanticTransformationMatcher';
import { FORMAT_FUNNEL_RANK } from './authorityCompoundingEngine';

const CONTRADICTION_PAIRS: Array<[RegExp, RegExp]> = [
  [/instead of\b/i, /sequenced before\b/i],
  [/only works when\b/i, /always required\b/i],
  [/manual\b/i, /fully automated\b/i],
  [/cheaper\b/i, /premium\b/i],
];

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function signatureFor(matcher: SemanticMatcher, assets: CrossModalAsset[]): { signature: string; tokens: number } {
  if (assets.length === 0) return { signature: '', tokens: 0 };
  const combined = assets.map((a) => `${a.strategicNarrative} ${a.authorityThemes.join(' ')} ${a.terminologyClusters.join(' ')}`).join(' ');
  const cls = matcher.canonicalTokens(combined);
  const arr = Array.from(cls).sort();
  return { signature: arr.join('+'), tokens: arr.length };
}

export interface GovernEcosystemNarrativeInput {
  assets: CrossModalAsset[];
  matcher?: SemanticMatcher;
}

export function governEcosystemNarrative(input: GovernEcosystemNarrativeInput): EcosystemNarrativeResult {
  const matcher = input.matcher ?? createSemanticMatcher();
  const assets = input.assets;
  if (assets.length === 0) {
    return {
      ecosystemCoherenceScore: 100,
      detectedIssues: [],
      perFormatNarrativeSignatures: [],
      dominantSignature: null,
    };
  }

  const issues: EcosystemNarrativeIssue[] = [];

  // ── 1. per-format signature ─────────────────────────────────────────
  const formats = Array.from(new Set(assets.map((a) => a.format))) as CrossModalFormat[];
  const perFormat = formats.map((f) => {
    const subset = assets.filter((a) => a.format === f);
    const sig = signatureFor(matcher, subset);
    return { format: f, signature: sig.signature, tokens: sig.tokens };
  });

  // Global signature.
  const global = signatureFor(matcher, assets);

  // ── 2. NARRATIVE_FRAGMENTATION ──────────────────────────────────────
  // If no class appears in > 50% of formats, it's fragmented.
  const classCounts = new Map<string, number>();
  for (const pf of perFormat) {
    const cls = pf.signature.split('+').filter(Boolean);
    for (const c of cls) classCounts.set(c, (classCounts.get(c) ?? 0) + 1);
  }
  let dominantClass: string | null = null;
  let dominantCount = 0;
  classCounts.forEach((c, cls) => { if (c > dominantCount) { dominantCount = c; dominantClass = cls; } });
  const dominantRatio = formats.length === 0 ? 0 : dominantCount / formats.length;
  if (formats.length >= 3 && dominantRatio < 0.5) {
    issues.push({
      type: 'NARRATIVE_FRAGMENTATION',
      severity: dominantRatio < 0.34 ? 'high' : 'medium',
      formats,
      detail: `Top class "${dominantClass ?? '(none)'}" appears in only ${dominantCount}/${formats.length} formats — ecosystem narrative is fragmented.`,
    });
  }

  // ── 3. POSITIONING_CONTRADICTION ────────────────────────────────────
  for (const [aPat, bPat] of CONTRADICTION_PAIRS) {
    const aFormats = new Set<CrossModalFormat>();
    const bFormats = new Set<CrossModalFormat>();
    for (const a of assets) {
      if (aPat.test(a.strategicNarrative)) aFormats.add(a.format);
      if (bPat.test(a.strategicNarrative)) bFormats.add(a.format);
    }
    if (aFormats.size > 0 && bFormats.size > 0) {
      const involved = Array.from(new Set([...aFormats, ...bFormats])) as CrossModalFormat[];
      issues.push({
        type: 'POSITIONING_CONTRADICTION',
        severity: 'high',
        formats: involved,
        detail: `Formats [${[...aFormats].join(', ')}] use "${aPat.source}" while formats [${[...bFormats].join(', ')}] use "${bPat.source}".`,
      });
    }
  }

  // ── 4. AUTHORITY_INCOHERENCE ────────────────────────────────────────
  // For each archetype, max authority vs min authority across formats.
  const byArchetype = new Map<string, Map<CrossModalFormat, number[]>>();
  for (const a of assets) {
    const arch = (a.narrativeArchetype ?? 'uncategorized').toString();
    const inner = byArchetype.get(arch) ?? new Map<CrossModalFormat, number[]>();
    const arr = inner.get(a.format) ?? [];
    arr.push(a.authorityClaimCoverage);
    inner.set(a.format, arr);
    byArchetype.set(arch, inner);
  }
  for (const [arch, inner] of byArchetype) {
    if (inner.size < 2) continue;
    const formatAverages = Array.from(inner.entries()).map(([fmt, arr]) => ({
      format: fmt,
      avg: arr.reduce((s, v) => s + v, 0) / arr.length,
    }));
    const maxAvg = Math.max(...formatAverages.map((f) => f.avg));
    const minAvg = Math.min(...formatAverages.map((f) => f.avg));
    if (maxAvg >= 60 && minAvg <= 25 && (maxAvg - minAvg) >= 40) {
      issues.push({
        type: 'AUTHORITY_INCOHERENCE',
        severity: 'medium',
        formats: formatAverages.map((f) => f.format),
        detail: `Archetype "${arch}" has authority ${Math.round(maxAvg)} in ${formatAverages.find((f) => f.avg === maxAvg)?.format} but ${Math.round(minAvg)} in ${formatAverages.find((f) => f.avg === minAvg)?.format}.`,
      });
    }
  }

  // ── 5. EDUCATIONAL_DISORIENTATION ───────────────────────────────────
  // For ICPs with ≥3 assets, check whether funnel ranks are scattered
  // (range covered ≥3 but never monotonic for any window of 3).
  const byIcp = new Map<string, CrossModalAsset[]>();
  for (const a of assets) for (const icp of a.icpFocus) {
    const arr = byIcp.get(icp.toLowerCase()) ?? [];
    arr.push(a);
    byIcp.set(icp.toLowerCase(), arr);
  }
  for (const [icp, group] of byIcp) {
    if (group.length < 3) continue;
    const ordered = [...group].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    const ranks = ordered.map((a) => FORMAT_FUNNEL_RANK[a.format]);
    const range = Math.max(...ranks) - Math.min(...ranks);
    if (range < 2) continue; // not actually multi-stage — skip
    // any strictly-increasing window of 3?
    let monotonic = false;
    for (let i = 0; i + 2 < ranks.length; i += 1) {
      if (ranks[i] < ranks[i + 1] && ranks[i + 1] < ranks[i + 2]) { monotonic = true; break; }
    }
    if (!monotonic) {
      issues.push({
        type: 'EDUCATIONAL_DISORIENTATION',
        severity: 'medium',
        formats: Array.from(new Set(ordered.map((a) => a.format))) as CrossModalFormat[],
        detail: `ICP "${icp}" sees ${ranks.length} assets across funnel ranks [${ranks.join(',')}] with no monotonic progression.`,
      });
    }
  }

  // ── 6. STRATEGIC_DIVERGENCE ────────────────────────────────────────
  // Each per-format signature compared to global; flag formats whose
  // Jaccard with the global signature is low.
  if (formats.length >= 3 && global.tokens > 0) {
    const globalSet = new Set(global.signature.split('+').filter(Boolean));
    for (const pf of perFormat) {
      const pfSet = new Set(pf.signature.split('+').filter(Boolean));
      let inter = 0;
      globalSet.forEach((t) => { if (pfSet.has(t)) inter += 1; });
      const union = globalSet.size + pfSet.size - inter;
      const overlap = union === 0 ? 1 : inter / union;
      if (overlap < 0.3 && pfSet.size > 0) {
        issues.push({
          type: 'STRATEGIC_DIVERGENCE',
          severity: 'medium',
          formats: [pf.format],
          detail: `Format "${pf.format}" signature [${pf.signature || '(empty)'}] diverges from ecosystem signature (overlap ${(overlap * 100).toFixed(0)}%).`,
        });
      }
    }
  }

  // ── Composite ecosystem coherence score ────────────────────────────
  let score = 100;
  for (const i of issues) score -= i.severity === 'high' ? 22 : i.severity === 'medium' ? 12 : 5;
  score = clamp100(score);

  return {
    ecosystemCoherenceScore: score,
    detectedIssues: issues,
    perFormatNarrativeSignatures: perFormat,
    dominantSignature: dominantClass,
  };
}
