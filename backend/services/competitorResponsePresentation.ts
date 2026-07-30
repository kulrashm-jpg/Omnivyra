/**
 * COMPETITOR-RESPONSE-001 — Complete Competitor Intelligence Response.
 *
 * Pure presentation helpers that expose evidence the competitor engine ALREADY
 * produced (on RankedCompetitor) as human-readable response fields. These do NOT
 * discover, score, or rank — they only summarize existing data. Nothing here
 * fabricates: every string is derived from fields already present on the ranked
 * competitor, and empty inputs yield empty/omitted output rather than invented text.
 */
import type { RankedCompetitor, CompetitorSource } from './competitorEngineServiceModel';
import type { CompetitorDiscoverySource } from '../../types/competitor';

/** Turn an internal category slug (mental_wellness_ai) into a readable label. */
export function readableCompetitorCategory(category: string | null | undefined): string {
  const raw = String(category ?? '').trim();
  if (!raw) return '';
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\bai\b/gi, 'AI')
    .replace(/\bseo\b/gi, 'SEO')
    .replace(/\bsaas\b/gi, 'SaaS')
    .replace(/\bcrm\b/gi, 'CRM')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function firstSentence(text: string | null | undefined, maxLen = 160): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const sentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  const out = sentence.length > maxLen ? `${sentence.slice(0, maxLen - 1).trim()}…` : sentence;
  return out;
}

/**
 * Concise human-readable Evidence Summary, e.g. "CRM platform serving SMBs."
 * Prefers the enrichment description (grounded text), else composes from the
 * category, business model, and target-customer fit signals already on the record.
 */
export function buildCompetitorEvidenceSummary(competitor: RankedCompetitor): string {
  const description = firstSentence(competitor.enrichment?.description);
  if (description) return description;

  const category = readableCompetitorCategory(competitor.category);
  const businessModel =
    competitor.enrichment?.business_model ?? competitor.fit_signals?.business_model ?? null;
  const target =
    competitor.fit_signals?.target_customer ??
    competitor.enrichment?.icp?.use_case ??
    null;

  const head = [category, businessModel && businessModel.toLowerCase() !== category.toLowerCase() ? businessModel : null]
    .filter(Boolean)
    .join(' · ');
  const summary = [head || category, target ? `serving ${String(target).trim()}` : null]
    .filter(Boolean)
    .join(' ');
  return summary.trim();
}

/**
 * Concise "Why Included" — derived from the dominant overlap signal the scoring
 * engine already computed, plus the first reasoning line when present. No new
 * scoring: this only reads existing overlap values and reasoning text.
 */
export function buildCompetitorWhyIncluded(competitor: RankedCompetitor): string {
  const reasons: string[] = [];
  const icp = Number(competitor.icp_overlap ?? 0);
  const problem = Number(competitor.problem_overlap ?? 0);
  const market = Number(competitor.market_overlap ?? 0);

  const strongest = Math.max(icp, problem, market);
  if (strongest > 0) {
    if (strongest === icp) reasons.push('Competes for the same customer segment.');
    else if (strongest === problem) reasons.push('Solves the same problem for the same buyers.');
    else reasons.push('Competes in the same market.');
  }

  const firstReasoning = Array.isArray(competitor.reasoning)
    ? competitor.reasoning.map((r) => String(r ?? '').trim()).find(Boolean)
    : null;
  if (firstReasoning && !reasons.some((r) => r.toLowerCase() === firstReasoning.toLowerCase())) {
    reasons.push(firstSentence(firstReasoning, 140));
  }

  if (reasons.length === 0) {
    const rationale = firstSentence(competitor.rationale, 140);
    if (rationale) reasons.push(rationale);
  }
  return reasons.slice(0, 2).join(' ').trim();
}

const SOURCE_LABELS: Record<CompetitorDiscoverySource, string> = {
  manual: 'Existing Competitor Database',
  stored: 'Company Website',
  provider: 'Knowledge Graph',
  serp: 'SERP',
  'ai-inferred': 'AI Analysis',
  ecosystem: 'Structured Market Data',
};

function labelForCompetitorSource(source: CompetitorSource): string | null {
  switch (source) {
    case 'website':
    case 'social':
      return 'Company Website';
    case 'serp_live':
      return 'SERP';
    case 'known_category_dataset':
    case 'market_substitute':
      return 'Structured Market Data';
    case 'manual':
    case 'user':
      return 'Existing Competitor Database';
    case 'profile_ai':
    case 'archetype_native_peer':
    case 'inferred_keyword_peer':
      return 'AI Analysis';
    default:
      return null;
  }
}

/**
 * Evidence Sources — human-readable provenance labels derived ONLY from the
 * discoverySources / source already captured on the record. Deduped, order-stable.
 */
export function buildCompetitorEvidenceSources(competitor: RankedCompetitor): string[] {
  const labels: string[] = [];
  for (const ds of competitor.discoverySources ?? []) {
    const label = SOURCE_LABELS[ds];
    if (label) labels.push(label);
  }
  const fromSource = labelForCompetitorSource(competitor.source);
  if (fromSource) labels.push(fromSource);
  return Array.from(new Set(labels));
}
