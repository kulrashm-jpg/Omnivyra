/**
 * useRecommendedPurposeOptions (Creator Company-Context Strategy
 * Bridge — Phase 3).
 *
 * React hook that fetches the company-context-reordered purpose
 * options for a given company. Falls back to the native
 * PURPOSE_OPTIONS order when:
 *
 *   - the fetch is in flight (loading state)
 *   - the company has no profile signal (falls back gracefully on the
 *     server too — the engine returns native order)
 *   - the fetch fails (caller still has a workable list)
 *
 * No new generation logic. The hook only changes WHICH option the
 * UI surfaces first; the strategy-id resolution downstream is
 * unchanged.
 */

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/apiFetch';
import { PURPOSE_OPTIONS, type PurposeOption } from '../../lib/variants/purposeOptions';
import type { CreatorTypeForVariant } from '../../lib/variants/creatorStrategyMapping';

export type RecommendedPurposeOption = PurposeOption & {
  score: number;
  reasons: string[];
  applies_as_cold_start_prior: boolean;
};

export type GovernedPurposeOption = RecommendedPurposeOption & {
  classification: 'recommended' | 'allowed' | 'restricted';
  restriction_reason: string | null;
  deprioritized: boolean;
  /** Creator Validation P1 Remediation — Phase 3. Learning fields
   *  surfaced on every option so the picker can render performance
   *  context alongside the governance classification. */
  context_score: number;
  learning_score: number;
  learning_confidence: 'low' | 'medium' | 'high';
  learning_reasons: string[];
  learning_applied: boolean;
};

export type GovernancePerType = {
  options: GovernedPurposeOption[];
  recommended: GovernedPurposeOption[];
  allowed: GovernedPurposeOption[];
  restricted: GovernedPurposeOption[];
  default_strategy_override: string | null;
  /** Creator Validation P1 Remediation — Phase 3. True when learning
   *  contributed a non-zero bonus to any option in this lane. */
  learning_applied: boolean;
  /** Cold-start note from the learning engine, surfaced for UI. */
  cold_start_note: string | null;
};

export type GovernancePayload = {
  industry: 'healthcare' | 'finance' | 'insurance' | 'legal' | 'none';
  risk_level: 'none' | 'low' | 'medium' | 'high';
  required_warnings: string[];
  per_content_type: Record<CreatorTypeForVariant, GovernancePerType>;
};

/** Creator Validation P2 Hardening — Phase 2 + 4. Multi-industry
 *  contribution surface. Returned alongside `recommended` so the
 *  picker can render "Healthcare (+18) · SaaS (+18) → Final +36". */
export type IndustryContribution = {
  industry: string;
  label: string;
  matched_triggers: string[];
  applies_to_strategies: string[];
  weight_per_strategy: number;
  total_score: number;
};

export type IndustryAnalysis = {
  primary: IndustryContribution | null;
  secondary: IndustryContribution | null;
  all: IndustryContribution[];
  combined_influence: number;
  is_multi_industry: boolean;
};

export type UseRecommendedPurposeOptionsState = {
  loading: boolean;
  error: string | null;
  has_profile: boolean;
  /** Reordered options per content type. Always present — falls back
   *  to the native PURPOSE_OPTIONS order when no profile / signal. */
  recommended: Record<CreatorTypeForVariant, RecommendedPurposeOption[]>;
  /** Governance overlay. Always present — `industry='none'` and empty
   *  arrays when the company is not in a regulated vertical. */
  governance: GovernancePayload;
  /** Multi-industry contribution breakdown. Empty `all` array means no
   *  industry rule matched (engine fell back to native order). */
  industry_analysis: IndustryAnalysis;
};

function nativeFallback(): Record<CreatorTypeForVariant, RecommendedPurposeOption[]> {
  return {
    image: PURPOSE_OPTIONS.image.map((o) => ({ ...o, score: 0, reasons: [], applies_as_cold_start_prior: false })),
    carousel: PURPOSE_OPTIONS.carousel.map((o) => ({ ...o, score: 0, reasons: [], applies_as_cold_start_prior: false })),
    infographic: PURPOSE_OPTIONS.infographic.map((o) => ({ ...o, score: 0, reasons: [], applies_as_cold_start_prior: false })),
  };
}

function nativeGovernanceFallback(): GovernancePayload {
  const native = nativeFallback();
  const toGoverned = (opts: RecommendedPurposeOption[]): GovernedPurposeOption[] =>
    opts.map((o) => ({
      ...o,
      classification: 'allowed' as const,
      restriction_reason: null,
      deprioritized: false,
      context_score: o.score,
      learning_score: 0,
      learning_confidence: 'low' as const,
      learning_reasons: [],
      learning_applied: false,
    }));
  const buildPerType = (contentType: CreatorTypeForVariant): GovernancePerType => {
    const all = toGoverned(native[contentType]);
    return {
      options: all,
      recommended: [],
      allowed: all,
      restricted: [],
      default_strategy_override: null,
      learning_applied: false,
      cold_start_note: null,
    };
  };
  return {
    industry: 'none',
    risk_level: 'none',
    required_warnings: [],
    per_content_type: {
      image: buildPerType('image'),
      carousel: buildPerType('carousel'),
      infographic: buildPerType('infographic'),
    },
  };
}

function emptyIndustryAnalysis(): IndustryAnalysis {
  return {
    primary: null,
    secondary: null,
    all: [],
    combined_influence: 0,
    is_multi_industry: false,
  };
}

export function useRecommendedPurposeOptions(input: {
  companyId: string | null | undefined;
  /** When false, the hook returns the native fallback immediately and
   *  never fetches. Useful for unauthenticated / preview surfaces. */
  enabled?: boolean;
}): UseRecommendedPurposeOptionsState {
  const enabled = input.enabled !== false;
  const [state, setState] = useState<UseRecommendedPurposeOptionsState>({
    loading: false,
    error: null,
    has_profile: false,
    recommended: nativeFallback(),
    governance: nativeGovernanceFallback(),
    industry_analysis: emptyIndustryAnalysis(),
  });

  useEffect(() => {
    if (!enabled || !input.companyId) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const params = new URLSearchParams({ company_id: input.companyId! });
        const response = await apiFetch(`/api/creator-intelligence/recommended-purpose-options?${params.toString()}`);
        const payload = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !payload?.success) {
          setState({
            loading: false,
            error: payload?.error || `Request failed (${response.status})`,
            has_profile: false,
            recommended: nativeFallback(),
            governance: nativeGovernanceFallback(),
            industry_analysis: emptyIndustryAnalysis(),
          });
          return;
        }
        setState({
          loading: false,
          error: null,
          has_profile: !!payload.has_profile,
          recommended: payload.recommended as Record<CreatorTypeForVariant, RecommendedPurposeOption[]>,
          governance: (payload.governance as GovernancePayload) ?? nativeGovernanceFallback(),
          industry_analysis: (payload.industry_analysis as IndustryAnalysis) ?? emptyIndustryAnalysis(),
        });
      } catch (err) {
        if (!cancelled) {
          setState({
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to load recommended options',
            has_profile: false,
            recommended: nativeFallback(),
            governance: nativeGovernanceFallback(),
            industry_analysis: emptyIndustryAnalysis(),
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, input.companyId]);

  return state;
}

/**
 * Pure, sync convenience for non-React callers (server-rendered pages,
 * tests). Returns the native PURPOSE_OPTIONS shape upgraded to the
 * recommended-option type with score=0. Used as the fallback in the
 * hook above; exposed so other callers don't have to inline the shim.
 */
export function nativePurposeOptionsAsRecommended(
  contentType: CreatorTypeForVariant,
): RecommendedPurposeOption[] {
  return PURPOSE_OPTIONS[contentType].map((o) => ({
    ...o,
    score: 0,
    reasons: [],
    applies_as_cold_start_prior: false,
  }));
}

/**
 * Stable "first option" for callers that need a single default
 * without computing the full hook. Uses the supplied recommended
 * options when provided; otherwise the native first entry.
 */
export function pickDefaultPurpose(
  contentType: CreatorTypeForVariant,
  recommended?: Record<CreatorTypeForVariant, RecommendedPurposeOption[]> | null,
): string {
  if (recommended?.[contentType]?.length) return recommended[contentType][0].value;
  return PURPOSE_OPTIONS[contentType][0].value;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _unused = useMemo;
