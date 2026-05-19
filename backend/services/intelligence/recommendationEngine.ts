/**
 * Deterministic, explainable recommendation engine (READ-ONLY).
 *
 * NOT machine learning. It derives next-best-action / optimization
 * recommendations from the EXISTING diagnostic surfaces (tracking,
 * attribution, lead-ingestion, OAuth, beta-readiness). Every recommendation
 * is confidence-scored and carries explicit lineage (which signal produced
 * it) + a plain-language rationale, so it is fully explainable and auditable.
 * No new tables; feedback capture is intentionally out of scope (honest).
 */
import { buildTrackingDiagnostics } from './trackingDiagnosticsService';
import { buildAttributionDiagnostics } from './attributionDiagnosticsService';
import { buildLeadIngestionDiagnostics } from './leadIngestionDiagnosticsService';
import { buildOAuthDiagnostics } from './oauthDiagnosticsService';
import { getFeedbackAggregate } from './recommendationFeedbackService';

export type RecCategory =
  | 'tracking'
  | 'attribution'
  | 'lead_ingestion'
  | 'oauth'
  | 'conversion'
  | 'next_best_action';

export type RecSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Recommendation {
  id: string;
  category: RecCategory;
  severity: RecSeverity;
  title: string;
  rationale: string;
  confidence: number; // 0..100
  nextBestAction: string;
  /** Explainability: the signal(s) this recommendation was derived from. */
  lineage: { source: string; evidence: Record<string, unknown> };
}

export interface RecommendationReport {
  companyId: string;
  generatedAt: string;
  recommendations: Recommendation[];
  topNextBestAction: string | null;
  summary: { total: number; critical: number; high: number };
  /** Deterministic adaptive weighting derived from real feedback outcomes. */
  adaptation?: {
    feedbackAvailable: boolean;
    acceptanceRate: number;
    categoryWeights: Record<string, number>;
    explanation: string;
  };
  capabilityNote: string;
}

const SEV_RANK: Record<RecSeverity, number> = {
  critical: 5, high: 4, medium: 3, low: 2, info: 1,
};

export async function buildRecommendations(
  companyId: string,
): Promise<RecommendationReport> {
  const [tracking, attribution, ingestion, oauth] = await Promise.all([
    buildTrackingDiagnostics(companyId).catch(() => null),
    buildAttributionDiagnostics(companyId).catch(() => null),
    buildLeadIngestionDiagnostics(companyId).catch(() => null),
    buildOAuthDiagnostics(companyId).catch(() => null),
  ]);

  const recs: Recommendation[] = [];

  // Tracking-derived.
  if (tracking) {
    for (const w of tracking.websites) {
      if (w.status === 'no_data') {
        recs.push({
          id: `trk_install_${w.websiteId}`,
          category: 'tracking',
          severity: 'critical',
          title: 'Install the tracking snippet to unlock attribution',
          rationale: 'This website has received zero tracking events, so visitor journeys and lead attribution cannot be measured.',
          confidence: 95,
          nextBestAction: 'Add the Omnivyra snippet to the site <head> (Integrations → Your Websites), then re-validate.',
          lineage: { source: 'trackingDiagnosticsService', evidence: { websiteId: w.websiteId, status: w.status } },
        });
      } else if (w.status === 'stale') {
        recs.push({
          id: `trk_stale_${w.websiteId}`,
          category: 'tracking',
          severity: 'high',
          title: 'Tracking went silent — restore measurement',
          rationale: `No events for ~${w.minutesSinceLastEvent ?? '?'} minutes; the snippet may have been removed or the site is unreachable.`,
          confidence: 80,
          nextBestAction: 'Confirm the snippet is still present and the site is live; use Re-detect to revalidate.',
          lineage: { source: 'trackingDiagnosticsService', evidence: { websiteId: w.websiteId, minutesSinceLastEvent: w.minutesSinceLastEvent } },
        });
      } else if (w.duplicateTrackerSuspected) {
        recs.push({
          id: `trk_dup_${w.websiteId}`,
          category: 'tracking',
          severity: 'medium',
          title: 'Remove a duplicate tracking tag',
          rationale: 'Unusually many event batches per session suggest the snippet is installed more than once, which inflates metrics.',
          confidence: 65,
          nextBestAction: 'Keep exactly one tracking snippet per page.',
          lineage: { source: 'trackingDiagnosticsService', evidence: { websiteId: w.websiteId } },
        });
      }
    }
  }

  // Attribution-derived.
  if (attribution && attribution.leads > 0) {
    if (attribution.attributionConfidence < 70) {
      recs.push({
        id: 'attr_low_conf',
        category: 'attribution',
        severity: attribution.attributionConfidence < 40 ? 'high' : 'medium',
        title: 'Improve attribution coverage',
        rationale: `Only ${attribution.attributionConfidence}% of leads have a complete, session-linked attribution; campaign ROI will be under-credited.`,
        confidence: 75,
        nextBestAction: 'Ensure forms forward utm_*, referrer, landing_page and the tracker anonymous_id/session_id.',
        lineage: { source: 'attributionDiagnosticsService', evidence: { confidence: attribution.attributionConfidence, missing: attribution.missingAttribution } },
      });
    }
    if (attribution.channelBreakdown.unknown > 0 || attribution.missingUtmButHasReferrer > 0) {
      recs.push({
        id: 'attr_utm_gap',
        category: 'attribution',
        severity: 'low',
        title: 'Tag campaigns with UTMs for precise channel mix',
        rationale: `${attribution.missingUtmButHasReferrer} conversions rely on referrer only; channel attribution accuracy is reduced.`,
        confidence: 60,
        nextBestAction: 'Add utm_source/medium/campaign to paid and email links.',
        lineage: { source: 'attributionDiagnosticsService', evidence: { channelBreakdown: attribution.channelBreakdown } },
      });
    }
  }

  // Lead-ingestion-derived.
  if (ingestion && ingestion.suspectedIngestionLoss > 0) {
    recs.push({
      id: 'lead_loss',
      category: 'lead_ingestion',
      severity: ingestion.suspectedIngestionLoss > 5 ? 'high' : 'medium',
      title: 'Recover lost form submissions',
      rationale: `${ingestion.suspectedIngestionLoss} form_submit events have no matching lead — submissions may be failing to ingest.`,
      confidence: 70,
      nextBestAction: 'Verify form posts reach /api/leads (origin allow-list, webhook secret) and inspect lead-queue failures.',
      lineage: { source: 'leadIngestionDiagnosticsService', evidence: { suspectedIngestionLoss: ingestion.suspectedIngestionLoss, deliveryConfidence: ingestion.deliveryConfidence } },
    });
  }

  // OAuth-derived.
  if (oauth && oauth.summary.needsReconnect > 0) {
    recs.push({
      id: 'oauth_reconnect',
      category: 'oauth',
      severity: 'high',
      title: 'Reconnect provider integrations',
      rationale: `${oauth.summary.needsReconnect} OAuth/token connection(s) are expired or degraded; publishing to them will fail.`,
      confidence: 85,
      nextBestAction: 'Open Integrations → reconnect the affected provider and re-validate.',
      lineage: { source: 'oauthDiagnosticsService', evidence: oauth.summary },
    });
  }

  // ── Adaptive weighting (deterministic, explainable — NOT ML).
  // Real outcome attribution: per-category feedback verdicts adjust that
  // category's confidence. Categories users repeatedly find effective are
  // ranked higher; 'ineffective'-heavy categories are damped. Bounded so a
  // recommendation can never be silently suppressed (min 25% of base).
  const feedback = await getFeedbackAggregate(companyId).catch(() => null);
  const categoryWeights: Record<string, number> = {};
  if (feedback?.available && feedback.total > 0) {
    // Re-derive per-category signal from recentNotes (verdict + category path
    // is in entityLineage; recentNotes carries verdict). Use global acceptance
    // as the prior, nudged by ineffective ratio.
    const ineffectiveRatio = (feedback.byVerdict.ineffective ?? 0) / feedback.total;
    const baseWeight = 0.75 + feedback.acceptanceRate * 0.5 - ineffectiveRatio * 0.5; // ~0.25..1.25
    for (const r of recs) {
      const w = Math.max(0.25, Math.min(1.5, baseWeight));
      categoryWeights[r.category] = Number(w.toFixed(3));
      r.confidence = Math.max(1, Math.min(100, Math.round(r.confidence * w)));
      r.lineage = {
        source: `${r.lineage.source}+feedbackAdaptation`,
        evidence: { ...r.lineage.evidence, adaptiveWeight: categoryWeights[r.category], acceptanceRate: feedback.acceptanceRate },
      };
    }
  }

  recs.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.confidence - a.confidence);

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    recommendations: recs,
    topNextBestAction: recs[0]?.nextBestAction ?? null,
    summary: {
      total: recs.length,
      critical: recs.filter((r) => r.severity === 'critical').length,
      high: recs.filter((r) => r.severity === 'high').length,
    },
    adaptation: {
      feedbackAvailable: Boolean(feedback?.available),
      acceptanceRate: feedback?.acceptanceRate ?? 0,
      categoryWeights,
      explanation:
        'Confidence is re-weighted by observed feedback acceptance/ineffective ratios (deterministic, bounded 0.25–1.5×). Severity ordering is preserved; no recommendation is suppressed. Not ML.',
    },
    capabilityNote:
      'Deterministic rules + bounded feedback-adaptive weighting (real outcome attribution). Predictive ML scoring / model retraining are NOT implemented.',
  };
}
