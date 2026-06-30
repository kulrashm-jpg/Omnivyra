/**
 * Deterministic lead recommendations + summary (NO AI / LLM here — pure, rule-based,
 * explainable). Used by exports and consumer surfaces for "Recommended Next Action"
 * and a human-readable summary.
 */

import type { CanonicalLeadView } from './types';
import { CANONICAL_LEAD_SOURCE_LABELS } from './sourceTaxonomy';

const intentOf = (v: CanonicalLeadView): number => v.scores.intent ?? v.scores.total ?? 0;

export function recommendNextAction(view: CanonicalLeadView): string {
  const status = (view.status ?? '').toLowerCase();
  if (status === 'won' || status === 'qualified') return 'Advance to sales / schedule a meeting';
  if (status === 'contacted' || status === 'reviewing') return 'Follow up on the open conversation';
  if (status === 'dismissed' || status === 'lost') return 'No action — archived';
  const intent = intentOf(view);
  if (intent >= 0.7) return 'Reach out now — high buying intent';
  if (view.source === 'community' || view.source === 'engagement') return 'Engage on-platform and qualify';
  if (view.source === 'marketpulse') return 'Add to account watchlist — company-level signal';
  if (view.identity.email || view.identity.phone) return 'Send an introductory follow-up';
  return 'Enrich identity, then qualify';
}

export function summarizeLead(view: CanonicalLeadView): string {
  const who = view.identity.email ?? view.identity.platform ?? view.unifiedPersonId ?? 'Unknown contact';
  const src = CANONICAL_LEAD_SOURCE_LABELS[view.source] ?? view.source;
  const campaign = view.campaign ? ` via ${view.campaign}` : '';
  const intent = intentOf(view);
  const intentBand = intent >= 0.7 ? 'high' : intent >= 0.4 ? 'medium' : 'low';
  return `${who} from ${src}${campaign} — ${intentBand} intent (${Math.round(intent * 100)}%), status ${view.status ?? 'new'}.`;
}
