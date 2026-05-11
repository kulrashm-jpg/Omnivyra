/**
 * useCompanyIdentity — Fetches company identity for the ContentQualityPanel.
 * Cache is keyed by (userId, companyId) so a different signed-in user can never
 * read another user's previously-cached identity for the same company.
 */
import { useState, useEffect, useRef } from 'react';
import type { CompanyIdentity } from '../lib/content/companyContextBlock';
import { useCompanyContext } from '../components/CompanyContext';

const _cache = new Map<string, CompanyIdentity>();

const cacheKey = (userId: string, companyId: string) => `${userId}::${companyId}`;

export function useCompanyIdentity(companyId: string | undefined): CompanyIdentity | undefined {
  const { user } = useCompanyContext();
  const userId = user?.userId;
  const initialKey = userId && companyId ? cacheKey(userId, companyId) : null;
  const [identity, setIdentity] = useState<CompanyIdentity | undefined>(
    initialKey ? _cache.get(initialKey) : undefined,
  );
  const fetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!companyId || !userId) {
      // Identity not yet known — clear any prior render's value to prevent
      // a previous user's cached company from bleeding into the current render.
      setIdentity(undefined);
      fetchedRef.current = null;
      return;
    }
    const key = cacheKey(userId, companyId);
    if (fetchedRef.current === key) return;
    if (_cache.has(key)) {
      setIdentity(_cache.get(key));
      fetchedRef.current = key;
      return;
    }

    fetchedRef.current = key;
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
        _cache.set(key, id);
        setIdentity(id);
      })
      .catch(() => { /* non-blocking — panel works without it */ });
  }, [companyId, userId]);

  return identity;
}
