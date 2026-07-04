/**
 * Evidence Activation Service  (BETA-ENGINE-007, Phase 5/8)
 *
 * The single integration seam between the canonical Evidence Ingestion & Orchestration layer and the
 * decision-engine scheduler. It resolves the company's ingestion subject, runs the orchestrator ONCE per
 * run (one fetch, many consumers), and returns the persisted-Evidence contexts the evidence-aware engines
 * (BETA-ENGINE-006) consume. Best-effort: any failure yields empty contexts and the engines fall back —
 * the decision run is never broken by ingestion.
 *
 * With no provider credentials configured every provider is skipped (isConfigured false) and the contexts
 * are empty — behaviour is identical to before (backward compatible).
 */
import { resolveCompanyWebsite } from './ingestionUtils';
import {
  registerProviderIngestionSpecs, ingestProviderEvidence, getEvidenceStore,
  resolveAuthorityEvidenceContext, resolveTrustEvidenceContext,
  correlateEvidence, correlateForConsumer, diagnoseForConsumer, generateRecommendationsForConsumer,
  assessBusinessImpactForConsumer,
  type IngestionSubject, type IngestionResult,
  type ResolvedAuthorityContext, type ResolvedTrustContext, type CorrelatedEvidence, type RootCause, type ExecutionPlan, type BusinessImpact,
} from './evidencePlatform';

type AuthorityCtx = ResolvedAuthorityContext & { correlations?: CorrelatedEvidence[] | null; rootCauses?: RootCause[] | null; recommendations?: ExecutionPlan[] | null; businessImpact?: BusinessImpact[] | null };
type TrustCtx = ResolvedTrustContext & { correlations?: CorrelatedEvidence[] | null; rootCauses?: RootCause[] | null; recommendations?: ExecutionPlan[] | null; businessImpact?: BusinessImpact[] | null };

export interface ActivatedEvidenceContexts {
  authority: AuthorityCtx;
  trust: TrustCtx;
  ingestion: IngestionResult[];
}

const EMPTY: ActivatedEvidenceContexts = {
  authority: { entityEvidence: null, correlations: null, rootCauses: null, recommendations: null, businessImpact: null },
  trust: { reputationEvidence: null, aiVisibilityEvidence: null, correlations: null, rootCauses: null, recommendations: null, businessImpact: null },
  ingestion: [],
};

/** Resolve the company's ingestion subject (brand + domain). Guarded — never throws. */
async function buildIngestionSubject(companyId: string): Promise<IngestionSubject> {
  let domain: string | null = null;
  try {
    domain = await resolveCompanyWebsite(companyId);
  } catch {
    domain = null;
  }
  const host = domain ? domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null;
  return {
    subjectId: companyId,
    domain: host,
    siteUrl: domain,
    // Brand name defaults to the registrable host label until a richer brand resolver is wired; the entity
    // adapter honestly returns UNAVAILABLE when this cannot resolve to a real entity.
    brandName: host ? host.split('.')[0] : null,
    category: null,
  };
}

/**
 * Run provider ingestion once and return the evidence-aware contexts for the authority + trust engines.
 * `nowIso` is injected by the caller (the scheduler) — the orchestration + engines stay clock-free.
 */
export async function activateProviderEvidence(companyId: string, nowIso: string): Promise<ActivatedEvidenceContexts> {
  try {
    registerProviderIngestionSpecs();
    const subject = await buildIngestionSubject(companyId);
    const store = getEvidenceStore();
    const ingestion = await ingestProviderEvidence(subject, nowIso, { store });

    // BETA-ENGINE-009: correlate ACROSS all persisted (validated) provider Evidence for this subject, then
    // give each engine only the correlations it consumes. Deterministic; empty when there is no Evidence.
    const allEvidence = store.list(companyId).flatMap((r) => r.evidence);
    // Per-engine correlations drive the ENGINE-009 confidence delta; the FULL correlation set drives the
    // BETA-ENGINE-010 root-cause diagnosis (a cause may need a correlation another engine "consumes").
    const allCorrelations = correlateEvidence(allEvidence);
    const authorityCauses = diagnoseForConsumer('authority', allCorrelations);
    const trustCauses = diagnoseForConsumer('trust', allCorrelations);
    // BETA-ENGINE-011: root causes → execution plans. BETA-ENGINE-012: plans → business-prioritized initiatives.
    const authorityPlans = generateRecommendationsForConsumer('authority', authorityCauses);
    const trustPlans = generateRecommendationsForConsumer('trust', trustCauses);
    return {
      authority: {
        ...resolveAuthorityEvidenceContext(companyId), correlations: correlateForConsumer('authority', allEvidence),
        rootCauses: authorityCauses, recommendations: authorityPlans,
        businessImpact: assessBusinessImpactForConsumer('authority', authorityPlans, authorityCauses, allEvidence),
      },
      trust: {
        ...resolveTrustEvidenceContext(companyId), correlations: correlateForConsumer('trust', allEvidence),
        rootCauses: trustCauses, recommendations: trustPlans,
        businessImpact: assessBusinessImpactForConsumer('trust', trustPlans, trustCauses, allEvidence),
      },
      ingestion,
    };
  } catch {
    // Ingestion must never break the decision run — fall back to empty (engines use their prior behaviour).
    return EMPTY;
  }
}
