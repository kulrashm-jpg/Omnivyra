/**
 * evidenceIntelligence.ts — CONTENT-INTELLIGENCE-002 Phase 6.
 *
 * Produces three deterministic evidence groups from ONLY what the canonical
 * context actually contains. Never invents statistics: internal/external items
 * surface existing facts verbatim; reasoning items are logical scaffolds
 * (comparisons/scenarios) clearly framed as reasoning, not data. When a group
 * has no basis, it says so honestly.
 */
import type { CanonicalContext, EvidenceIntelligence, EvidenceItem, Fact } from './canonicalContextTypes';

function items(fact: Fact<string[]> | null, transform?: (v: string) => string): EvidenceItem[] {
  if (!fact) return [];
  return fact.value.map((v) => ({ text: transform ? transform(v) : v, origin: fact.origin }));
}

export function buildEvidenceIntelligence(ctx: CanonicalContext): EvidenceIntelligence {
  // Internal — first-party proof: achievements, products, capabilities, differentiators.
  const internal: EvidenceItem[] = [
    ...items(ctx.evidence),
    ...items(ctx.offerings, (v) => `Product/capability: ${v}`),
    ...items(ctx.differentiators, (v) => `Differentiator: ${v}`),
  ];

  // External — market/competitive/SEO observations (industry reports, trends, standards).
  const external: EvidenceItem[] = [
    ...items(ctx.competitiveObservations),
    ...items(ctx.marketSignals),
    ...items(ctx.seoObservations),
  ];

  // Reasoning — deterministic logical scaffolds derived from present facts.
  // These are NOT data; they are argument shapes the writer fills with real detail.
  const reasoning: EvidenceItem[] = [];
  if (ctx.differentiators) {
    for (const d of ctx.differentiators.value.slice(0, 2)) {
      reasoning.push({ text: `Compare "${d}" against the status-quo/manual approach the reader uses today.`, origin: 'derived' });
    }
  }
  if (ctx.painPoints) {
    for (const p of ctx.painPoints.value.slice(0, 2)) {
      reasoning.push({ text: `Walk through a before/after scenario around the pain: ${p}.`, origin: 'derived' });
    }
  }
  if (ctx.offerings && ctx.icp) {
    reasoning.push({ text: `Give a concrete example of ${ctx.icp.value} using ${ctx.offerings.value[0]} to reach a specific outcome.`, origin: 'derived' });
  }

  const notes: string[] = [];
  if (internal.length === 0) {
    notes.push('No first-party proof found — add case studies, customer outcomes, or product specifics to your profile so posts can cite real evidence.');
  }
  if (external.length === 0) {
    notes.push('No external market/competitor evidence available (competitor & SEO intelligence not populated for this company).');
  }
  if (internal.length > 0 && external.length === 0 && reasoning.length > 0) {
    notes.push('Reasoning scaffolds provided are argument shapes to fill with your real numbers — do not present them as data on their own.');
  }

  return { internal, external, reasoning, note: notes.join(' ') };
}
