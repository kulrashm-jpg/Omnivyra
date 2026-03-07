/**
 * React data hooks for Growth Intelligence APIs.
 * Consumes existing endpoints. Uses lib/intelligence/growthIntelligenceTypes.
 */

import { useState, useEffect } from 'react';
import type { GrowthSummary, CompanyGrowthSummary } from '../lib/intelligence/growthIntelligenceTypes';

// ─────────────────────────────────────────────────────────────────────────────
// Campaign Summary Hook
// ─────────────────────────────────────────────────────────────────────────────

interface CampaignGrowthState {
  summary: GrowthSummary | null;
  loading: boolean;
  error: string | null;
}

export function useCampaignGrowthSummary(
  companyId: string,
  campaignId?: string
): CampaignGrowthState {
  const [summary, setSummary] = useState<GrowthSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId?.trim()) {
      setSummary(null);
      setLoading(false);
      setError(null);
      return;
    }

    const params = new URLSearchParams({ companyId });
    if (campaignId?.trim()) params.set('campaignId', campaignId.trim());

    setLoading(true);
    setError(null);

    fetch(`/api/growth-intelligence/summary?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json();
      })
      .then((json: { success: boolean; data: GrowthSummary }) => {
        if (json.success && json.data) {
          setSummary(json.data);
          setError(null);
        } else {
          setError('Invalid response');
          setSummary(null);
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to fetch growth summary');
        setSummary(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [companyId, campaignId]);

  return { summary, loading, error };
}

// ─────────────────────────────────────────────────────────────────────────────
// Company Summary Hook
// ─────────────────────────────────────────────────────────────────────────────

interface CompanyGrowthState {
  summary: CompanyGrowthSummary | null;
  loading: boolean;
  error: string | null;
}

export function useCompanyGrowthSummary(companyId: string): CompanyGrowthState {
  const [summary, setSummary] = useState<CompanyGrowthSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId?.trim()) {
      setSummary(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`/api/growth-intelligence/company-summary?companyId=${encodeURIComponent(companyId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json();
      })
      .then((json: { success: boolean; data: CompanyGrowthSummary }) => {
        if (json.success && json.data) {
          setSummary(json.data);
          setError(null);
        } else {
          setError('Invalid response');
          setSummary(null);
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to fetch company growth summary');
        setSummary(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [companyId]);

  return { summary, loading, error };
}
