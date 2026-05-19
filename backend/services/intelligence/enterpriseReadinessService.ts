/**
 * Enterprise readiness + advanced-observability aggregation (READ-ONLY).
 *
 * Composes the existing diagnostic surfaces into one enterprise view +
 * operational maturity score. No mutation, no provider calls. Honest by
 * design: capabilities that are genuinely not implemented (DLQ, OAuth refresh,
 * credential rotation, immutable audit) are reported as explicit blockers
 * rather than scored as present.
 */
import { buildBetaReadinessReport } from '../cms/betaReadinessService';
import { buildTrackingDiagnostics } from './trackingDiagnosticsService';
import { buildAttributionDiagnostics } from './attributionDiagnosticsService';
import { buildLeadIngestionDiagnostics } from './leadIngestionDiagnosticsService';
import { buildOAuthDiagnostics } from './oauthDiagnosticsService';
import { getSelfHealHistory } from './selfHealOrchestrator';
import { getDurableHistory } from './durableOrchestrationStore';
import { getFeedbackAggregate } from './recommendationFeedbackService';
import { getLeadQueueObservabilitySnapshot } from '../../queue/leadQueueObservability';

export type MaturityBand = 'foundational' | 'operational' | 'enterprise';

export interface EnterpriseReadinessReport {
  companyId: string;
  generatedAt: string;
  operationalMaturityScore: number; // 0..100
  maturityBand: MaturityBand;
  rolloutRecommendation: 'enterprise_ready' | 'operational_ready' | 'beta_only' | 'hold';
  axes: {
    publishing: string;
    attribution: string;
    intelligence: string;
    resilience: string;
    observability: string;
    security: string;
    oauthLifecycle: string;
  };
  unresolvedEnterpriseBlockers: string[];
  advisories: string[];
  signals: Record<string, unknown>;
  /** Additive finalization grades (do not alter legacy fields above). */
  grades?: {
    enterpriseMaturity: 'A' | 'B' | 'C' | 'D';
    operationalScalability: 'ready' | 'partial' | 'not_ready';
    aiReadiness: 'ready' | 'partial' | 'not_ready';
    complianceReadiness: string;
    /** Final-phase grades. */
    finalEnterpriseMaturityGrade?: 'A' | 'B' | 'C' | 'D';
    scalabilityReadinessGrade?: 'validated' | 'simulated_only' | 'unvalidated';
    aiMaturityGrade?: 'adaptive' | 'feedback_capable' | 'deterministic_only';
    securityAutomationGrade?: 'automated' | 'audited_manual' | 'basic';
  };
  unresolvedCriticalBlockers?: string[];
}

const NOT_IMPLEMENTED_BLOCKERS = [
  'Persistent dead-letter queue + replay tooling not implemented (observability-only).',
  'OAuth automatic refresh/rotation not implemented (guided reconnect only).',
  'Credential rotation workflow not implemented (immutable audit IS available via audit_events).',
  'Operational dashboard UIs not built (read-only data endpoints available).',
];

export async function buildEnterpriseReadinessReport(
  companyId: string,
): Promise<EnterpriseReadinessReport> {
  const advisories: string[] = [];

  const [beta, tracking, attribution, ingestion, oauth] = await Promise.all([
    buildBetaReadinessReport(companyId).catch(() => null),
    buildTrackingDiagnostics(companyId).catch(() => null),
    buildAttributionDiagnostics(companyId).catch(() => null),
    buildLeadIngestionDiagnostics(companyId).catch(() => null),
    buildOAuthDiagnostics(companyId).catch(() => null),
  ]);

  let queueAvailable = false;
  let queueSnapshot: unknown = null;
  try {
    queueSnapshot = await getLeadQueueObservabilitySnapshot();
    queueAvailable = true;
  } catch {
    queueAvailable = false;
  }

  const selfHeal = getSelfHealHistory(companyId);
  // Durable, multi-instance orchestration/audit history (audit_events-backed).
  const durableHistory = await getDurableHistory(companyId, 25).catch(() => []);
  const durabilityAvailable = durableHistory.length > 0;
  const auditAvailable = durabilityAvailable; // same substrate (audit_events)
  // Distributed lock substrate is the same durable store → available iff durable.
  const distributedLockAvailable = durabilityAvailable;
  // Adaptive-loop storage/measurement availability (feedback over audit_events).
  const feedback = await getFeedbackAggregate(companyId).catch(() => null);
  const feedbackCapable = Boolean(feedback?.available);
  // Scale validation harness is always invokable (pure in-memory, on-demand).
  const scaleHarnessAvailable = true;

  // Axis scoring (0..100 each), then weighted maturity.
  const pubAxis = beta?.readiness?.publishing ?? 'not_ready';
  const attrAxis = beta?.readiness?.attribution ?? 'not_ready';
  const intelAxis = beta?.readiness?.intelligence ?? 'not_ready';

  const axisScore = (v: string | undefined): number =>
    v === 'ready' ? 100 : v === 'partial' ? 55 : 15;

  const publishing = axisScore(pubAxis);
  const attributionS = attribution
    ? Math.round(attribution.attributionConfidence)
    : axisScore(attrAxis);
  const intelligence = tracking
    ? tracking.overall === 'healthy'
      ? 90
      : tracking.overall === 'degraded'
        ? 55
        : 25
    : axisScore(intelAxis);
  const resilience =
    (selfHeal.length > 0
      ? Math.min(100, 60 + selfHeal.filter((a) => a.outcome === 'repaired').length * 5)
      : 60) + (durabilityAvailable ? 10 : 0); // durable multi-instance cooldown/history
  const observability =
    (queueAvailable ? 75 : 60) + (durabilityAvailable ? 10 : 0); // diagnostics exist; no DLQ still caps full
  // Honest: webhook-sig + RBAC exist; immutable audit_events NOW available
  // (correlation + actor/entity lineage); credential rotation still absent.
  const security = (auditAvailable ? 50 : 30);
  const oauthLifecycle = oauth
    ? oauth.summary.total === 0
      ? 70
      : oauth.summary.needsReconnect === 0
        ? 55 // healthy tokens but NO auto-refresh → capped
        : 30
    : 50;

  const weights: Array<[number, number]> = [
    [publishing, 0.2],
    [attributionS, 0.15],
    [intelligence, 0.15],
    [resilience, 0.15],
    [observability, 0.15],
    [security, 0.1],
    [oauthLifecycle, 0.1],
  ];
  const operationalMaturityScore = Math.round(
    weights.reduce((acc, [s, w]) => acc + Math.min(100, Math.max(0, s)) * w, 0),
  );

  const maturityBand: MaturityBand =
    operationalMaturityScore >= 80
      ? 'enterprise'
      : operationalMaturityScore >= 55
        ? 'operational'
        : 'foundational';

  const unresolvedEnterpriseBlockers = [...NOT_IMPLEMENTED_BLOCKERS];
  if (beta?.unresolvedBlockers?.length) unresolvedEnterpriseBlockers.push(...beta.unresolvedBlockers);
  if (oauth && oauth.summary.needsReconnect > 0)
    unresolvedEnterpriseBlockers.push(`${oauth.summary.needsReconnect} OAuth connection(s) need reconnect.`);
  if (tracking && tracking.overall !== 'healthy')
    advisories.push(`Tracking overall: ${tracking.overall}.`);
  if (ingestion && ingestion.suspectedIngestionLoss > 0)
    advisories.push(`${ingestion.suspectedIngestionLoss} suspected ingestion losses (window).`);

  const rolloutRecommendation =
    maturityBand === 'enterprise'
      ? 'enterprise_ready'
      : maturityBand === 'operational'
        ? 'operational_ready'
        : (beta?.rolloutRecommendation === 'hold' ? 'hold' : 'beta_only');

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    operationalMaturityScore,
    maturityBand,
    rolloutRecommendation,
    axes: {
      publishing: String(pubAxis),
      attribution: String(attrAxis),
      intelligence: String(intelAxis),
      resilience: resilience >= 80 ? 'ready' : 'partial',
      observability: observability >= 80 ? 'ready' : 'partial',
      security: auditAvailable ? 'partial' : 'not_ready',
      oauthLifecycle: oauthLifecycle >= 80 ? 'ready' : 'partial',
    },
    unresolvedEnterpriseBlockers,
    advisories,
    signals: {
      betaRollout: beta?.rolloutRecommendation ?? null,
      operationalRisk: beta?.operationalRisk ?? null,
      trackingOverall: tracking?.overall ?? null,
      attributionConfidence: attribution?.attributionConfidence ?? null,
      ingestionDeliveryConfidence: ingestion?.deliveryConfidence ?? null,
      oauth: oauth?.summary ?? null,
      queueAvailable,
      queueSnapshot,
      selfHealAttempts: selfHeal.length,
      durableOrchestration: durabilityAvailable,
      immutableAuditAvailable: auditAvailable,
      distributedLockAvailable,
      durableHistorySample: durableHistory.length,
      scaleHarnessAvailable,
      feedbackCapable,
      feedbackAcceptanceRate: feedback?.acceptanceRate ?? null,
    },
    grades: {
      enterpriseMaturity:
        operationalMaturityScore >= 85 ? 'A'
        : operationalMaturityScore >= 70 ? 'B'
        : operationalMaturityScore >= 50 ? 'C'
        : 'D',
      // Scalability invariants are now simulation-validated (in-memory suite),
      // still capped because no persistent DLQ + no real load infra.
      operationalScalability: distributedLockAvailable ? 'partial' : 'not_ready',
      // Deterministic explainable recs + feedback capture; no predictive ML.
      aiReadiness: feedbackCapable ? 'partial' : 'partial',
      complianceReadiness: auditAvailable
        ? 'Append-only audit with correlation + actor/entity lineage available; DB-level immutability requires the controlled 20260690 migration; credential-rotation workflow still absent.'
        : 'Audit substrate unavailable in this environment — compliance not verifiable.',
      finalEnterpriseMaturityGrade:
        operationalMaturityScore >= 85 ? 'A'
        : operationalMaturityScore >= 70 ? 'B'
        : operationalMaturityScore >= 50 ? 'C'
        : 'D',
      // Invariants validated by the deterministic in-memory suite, but real
      // load/infra validation is absent → 'simulated_only', not 'validated'.
      scalabilityReadinessGrade: scaleHarnessAvailable ? 'simulated_only' : 'unvalidated',
      // Feedback loop captured/measured but no active learner → not 'adaptive'.
      aiMaturityGrade: feedbackCapable ? 'feedback_capable' : 'deterministic_only',
      // Append-only audit + RBAC exist; no automated rotation/anomaly response.
      securityAutomationGrade: auditAvailable ? 'audited_manual' : 'basic',
    },
    unresolvedCriticalBlockers: [
      'OAuth automatic refresh/rotation not implemented (guided reconnect only; no provider OAuth client/secret store).',
      'Persistent DLQ + replay write-path not implemented (would change live ingestion/queue paths — excluded for regression safety).',
      'Enterprise control-center UI consoles not built (read-only data endpoints available).',
      'Real load/stress validation absent — scalability is simulation-validated only (deterministic in-memory suite).',
      'Adaptive ML learning loop not implemented (feedback is captured + measured, not learned from).',
      'Automated credential rotation + security-response orchestration not implemented.',
    ],
  };
}
