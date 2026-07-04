/**
 * Engine Evidence Contract  (BETA-EXEC-004, Phase 7)
 *
 * A deterministic, LLM-free bridge that exposes the EXISTING measurements produced by the four
 * Website-Intelligence engines (Technical / Content / Accessibility / Brand) to the report's
 * narrative builders. It performs NO scoring and NO recalculation — it only READS the engine
 * outputs (scores, per-check labels/scores/details, issue lists, WCAG level, brand components),
 * ranks them deterministically, and renders evidence-specific sentence fragments.
 *
 * Every function returns `null` (or leaves the caller's static base untouched) when the underlying
 * evidence is unavailable, so narrative gracefully falls back to its prior template text. No value
 * is ever invented: only measurements actually present in the engine output are interpolated.
 *
 * Leaf module: imports only engine result TYPES — no circular dependency, no I/O.
 */
import type { CheckResult } from '../platformIntelligence/confidence';
import type { TechnicalIntelligence } from '../websiteIntelligence/technicalIntelligenceEngine';
import type { ContentIntelligence } from '../websiteIntelligence/contentIntelligenceEngine';
import type { AccessibilityIntelligence } from '../websiteIntelligence/accessibilityIntelligenceEngine';
import type { BrandIntelligence } from '../websiteIntelligence/brandIntelligenceEngine';

export type EvidenceDomain = 'technical' | 'content' | 'accessibility' | 'brand';

/** The four engine outputs, all optional/nullable (best-effort fetch upstream). */
export interface EngineEvidenceInput {
  technical?: TechnicalIntelligence | null;
  content?: ContentIntelligence | null;
  accessibility?: AccessibilityIntelligence | null;
  brand?: BrandIntelligence | null;
}

/** A single measured check, normalised for narrative use. */
export interface Measure {
  label: string;
  score: number; // rounded 0..100, always finite
  detail: string | null; // engine-provided detail (may carry a real count, e.g. "37 pages marked noindex")
}

/** Deterministic readout for one engine domain. `null` when the engine has no evaluable evidence. */
export interface EvidenceReadout {
  domain: EvidenceDomain;
  label: string; // human subject, e.g. "Technical health"
  score: number | null; // the engine's aggregate score (already computed by the engine)
  evaluatedCount: number;
  weakest: Measure[]; // ascending by score
  strongest: Measure[]; // descending by score
  criticalIssues: string[]; // engine-provided severe-issue labels
  extras: string[]; // domain-specific facts (WCAG level, brand component scores)
}

// ── deterministic primitives ─────────────────────────────────────────────────

const isEvaluable = (c: CheckResult): c is CheckResult & { score: number } =>
  c.status !== 'not_evaluable' && typeof c.score === 'number' && Number.isFinite(c.score);

function measuresFrom(checks: CheckResult[] | undefined | null): Measure[] {
  return (checks ?? []).filter(isEvaluable).map((c) => ({
    label: c.label,
    score: Math.round(c.score),
    detail: typeof c.detail === 'string' && c.detail.trim() ? c.detail.trim() : null,
  }));
}

// Stable sort: score first, then label alphabetically — fully deterministic across runs.
function byScoreAsc(a: Measure, b: Measure): number {
  return a.score - b.score || a.label.localeCompare(b.label);
}
function byScoreDesc(a: Measure, b: Measure): number {
  return b.score - a.score || a.label.localeCompare(b.label);
}

function joinList(parts: string[]): string {
  const p = parts.filter(Boolean);
  if (p.length === 0) return '';
  if (p.length === 1) return p[0];
  if (p.length === 2) return `${p[0]} and ${p[1]}`;
  return `${p.slice(0, -1).join(', ')}, and ${p[p.length - 1]}`;
}

const lowerFirst = (s: string): string => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const upperFirst = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// Lowercase the first letter for mid-sentence use, but preserve acronyms / all-caps starts
// (HTTPS, WCAG, SEO, CTA) — detected when the 2nd character is itself an uppercase letter.
const lowerLabel = (s: string): string => {
  if (s.length > 1 && s[1] !== s[1].toLowerCase() && s[1] === s[1].toUpperCase()) return s;
  return lowerFirst(s);
};
const measurePhrase = (m: Measure): string => `${lowerLabel(m.label)} (${m.score}/100)`;
// Detail is only used when it carries an actual figure — otherwise it adds no evidence.
const numericDetail = (ms: Measure[]): string | null =>
  ms.find((m) => m.detail && /\d/.test(m.detail))?.detail ?? null;

function buildReadout(
  domain: EvidenceDomain,
  label: string,
  score: number | null,
  checks: CheckResult[] | undefined | null,
  criticalIssues: string[] | undefined | null,
  extras: string[],
): EvidenceReadout | null {
  const ms = measuresFrom(checks);
  if (ms.length === 0) return null;
  return {
    domain,
    label,
    score: typeof score === 'number' && Number.isFinite(score) ? Math.round(score) : null,
    evaluatedCount: ms.length,
    weakest: [...ms].sort(byScoreAsc).slice(0, 3),
    strongest: [...ms].sort(byScoreDesc).slice(0, 2),
    criticalIssues: (criticalIssues ?? []).slice(0, 3),
    extras,
  };
}

// ── domain readouts (read-only; no recalculation) ────────────────────────────

export function readTechnical(t?: TechnicalIntelligence | null): EvidenceReadout | null {
  if (!t) return null;
  return buildReadout('technical', 'Technical health', t.technicalScore ?? null, t.checks, t.criticalIssues, []);
}

export function readContent(c?: ContentIntelligence | null): EvidenceReadout | null {
  if (!c) return null;
  const extras: string[] = [];
  if (c.missingContent?.length) extras.push(`missing: ${joinList(c.missingContent.slice(0, 3).map(lowerFirst))}`);
  return buildReadout('content', 'Content quality', c.contentScore ?? null, c.checks, c.conversionIssues, extras);
}

export function readAccessibility(a?: AccessibilityIntelligence | null): EvidenceReadout | null {
  if (!a) return null;
  const extras: string[] = [];
  if (a.wcagLevel && a.wcagLevel !== 'insufficient_data') extras.push(`WCAG ${a.wcagLevel}`);
  return buildReadout('accessibility', 'Accessibility', a.accessibilityScore ?? null, a.checks, a.criticalIssues, extras);
}

export function readBrand(b?: BrandIntelligence | null): EvidenceReadout | null {
  if (!b) return null;
  const comp: string[] = [];
  const add = (name: string, v: number | null | undefined) => {
    if (typeof v === 'number' && Number.isFinite(v)) comp.push(`${name} ${Math.round(v)}/100`);
  };
  add('trust', b.brandTrust);
  add('authority', b.brandAuthority);
  add('consistency', b.brandConsistency);
  add('maturity', b.brandMaturity);
  return buildReadout('brand', 'Brand strength', b.brandScore ?? null, b.checks, b.brandWeaknesses, comp);
}

export function readAll(input: EngineEvidenceInput): Record<EvidenceDomain, EvidenceReadout | null> {
  return {
    technical: readTechnical(input.technical),
    content: readContent(input.content),
    accessibility: readAccessibility(input.accessibility),
    brand: readBrand(input.brand),
  };
}

// ── deterministic formatters (never invent values) ───────────────────────────

const WEAK_CUTOFF = 70; // a check below this is treated as a constraint driver
const STRONG_CUTOFF = 80;

/**
 * "Technical health (58/100) is constrained primarily by crawl integrity (48/100) and metadata
 *  completeness (61/100) — 37 pages marked noindex."
 * Returns null when there is no measured constraint to report.
 */
export function formatConstraintSentence(r: EvidenceReadout | null): string | null {
  if (!r) return null;
  const head = r.score != null ? `${r.label} (${r.score}/100)` : r.label;
  const weak = r.weakest.filter((m) => m.score < WEAK_CUTOFF);
  if (weak.length === 0) {
    if (r.strongest.length === 0) return null;
    return `${head} is currently carried by ${joinList(r.strongest.map(measurePhrase))}.`;
  }
  const detail = numericDetail(weak);
  const core = `${head} is constrained primarily by ${joinList(weak.map(measurePhrase))}`;
  return detail ? `${core} — ${lowerFirst(detail)}.` : `${core}.`;
}

/**
 * Appends measured drivers to a static rationale base (Phase 3). Backward compatible: when no
 * evidence is available the base is returned unchanged.
 * "<base> Measured drivers — weakest: crawl integrity (48/100), metadata completeness (61/100);
 *  strongest: HTTPS (100/100). 37 pages marked noindex."
 */
export function enrichRationale(base: string, r: EvidenceReadout | null): string {
  if (!r || r.evaluatedCount === 0) return base;
  const weak = r.weakest.filter((m) => m.score < STRONG_CUTOFF).slice(0, 2);
  const strong = r.strongest.slice(0, 1);
  const segs: string[] = [];
  if (weak.length) segs.push(`weakest ${joinList(weak.map(measurePhrase))}`);
  if (strong.length && (!weak.length || strong[0].score >= STRONG_CUTOFF)) {
    segs.push(`strongest ${joinList(strong.map(measurePhrase))}`);
  }
  if (r.extras.length) segs.push(r.extras.join(', '));
  if (segs.length === 0) return base;
  const detail = numericDetail(r.weakest);
  let out = `${base} Measured evidence — ${segs.join('; ')}.`;
  if (detail) out += ` ${upperFirst(detail)}.`;
  return out;
}

/**
 * A single evidence clause for the executive summary / strategic direction (Phases 4-5):
 * picks the weakest-scoring domain that has a real constraint and names its drivers.
 * Returns null when no domain has measured constraints.
 */
export function formatPrimaryConstraint(input: EngineEvidenceInput): string | null {
  const readouts = Object.values(readAll(input)).filter((r): r is EvidenceReadout => r != null && r.score != null);
  if (readouts.length === 0) return null;
  // The weakest measured domain is the primary constraint.
  const primary = [...readouts].sort((a, b) => (a.score as number) - (b.score as number))[0];
  return formatConstraintSentence(primary);
}

/**
 * Maps a decision issue_type/action_type to the engine domain whose evidence best explains it,
 * so why-it-matters (Phase 2/6) can cite the specific measured driver. Returns null when the
 * decision does not map cleanly to a measured domain (caller keeps its category explanation).
 */
export function domainForDecisionSignal(signal: string): EvidenceDomain | null {
  const s = (signal || '').toLowerCase();
  if (/(crawl|index|canonical|metadata|meta[_ ]tag|internal[_ ]link|redirect|https|technical|sitemap|robots|broken)/.test(s)) return 'technical';
  if (/(content|thin|readab|topic|copy|word[_ ]count|depth|blog|faq|conversion[_ ]copy|value[_ ]prop|cta)/.test(s)) return 'content';
  if (/(accessib|wcag|a11y|alt[_ ]text|aria|contrast)/.test(s)) return 'accessibility';
  if (/(brand|trust|authority|reputation|consistency|maturity|proof|credibil)/.test(s)) return 'brand';
  return null;
}

/**
 * Evidence-specific "why it matters" tail for a decision (Phase 2/6). Given the decision's signal
 * (issue_type + action_type) and the engine evidence, returns the measured driver sentence for the
 * mapped domain, or null (caller keeps the existing category/generic signal).
 */
export function evidenceTailForDecision(signal: string, input: EngineEvidenceInput): string | null {
  const domain = domainForDecisionSignal(signal);
  if (!domain) return null;
  const readouts = readAll(input);
  return formatConstraintSentence(readouts[domain]);
}
