/**
 * useCompanyIdentity — Fetches company identity for the ContentQualityPanel.
 * Lightweight hook that maps the company profile API response to CompanyIdentity.
 * Caches result per company ID to avoid redundant fetches.
 */
import { useState, useEffect, useRef } from 'react';
import type { CompanyIdentity } from '../lib/content/companyContextBlock';

const _cache = new Map<string, CompanyIdentity>();

export function useCompanyIdentity(companyId: string | undefined): CompanyIdentity | undefined {
  const [identity, setIdentity] = useState<CompanyIdentity | undefined>(
    companyId ? _cache.get(companyId) : undefined,
  );
  const fetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!companyId || fetchedRef.current === companyId) return;
    if (_cache.has(companyId)) {
      setIdentity(_cache.get(companyId));
      fetchedRef.current = companyId;
      return;
    }

    fetchedRef.current = companyId;
    fetch(`/api/company-profile?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        const profile = data.profile || data;
        const id: CompanyIdentity = {
          companyName: profile.name || undefined,
          industry: profile.industry || undefined,
          targetAudience: profile.target_audience || undefined,
          idealCustomerProfile: profile.ideal_customer_profile || undefined,
          coreProblem: profile.core_problem_statement || undefined,
          painPoints: profile.pain_symptoms?.filter(Boolean) || undefined,
          uniqueValue: profile.unique_value || undefined,
          productsServices: profile.products_services || undefined,
          desiredTransformation: profile.desired_transformation || undefined,
          competitiveAdvantages: profile.competitive_advantages || undefined,
          authorityDomains: profile.authority_domains?.filter(Boolean) || undefined,
          keyMessages: profile.key_messages || undefined,
          brandVoice: profile.brand_voice || undefined,
        };
        _cache.set(companyId, id);
        setIdentity(id);
      })
      .catch(() => { /* non-blocking — panel works without it */ });
  }, [companyId]);

  return identity;
}
