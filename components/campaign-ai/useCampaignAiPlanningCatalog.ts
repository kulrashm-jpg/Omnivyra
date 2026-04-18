import { useEffect, useMemo, useState } from 'react';
import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import { PLATFORM_OPTIONS, PLATFORM_LABELS } from '../../backend/constants/platforms';
import {
  CREATOR_DEPENDENT_PLANNING_LABELS,
  PLANNING_CONTENT_TYPE_LABELS,
  canonicalPlanningTypeLabel,
  prettyContentTypeLabel,
} from './planningCatalog';

type UseCampaignAiPlanningCatalogParams = {
  resolvedCompanyId: string;
};

export function useCampaignAiPlanningCatalog({
  resolvedCompanyId,
}: UseCampaignAiPlanningCatalogParams) {
  const [companyKeyMessages, setCompanyKeyMessages] = useState<string | null>(null);
  const [companyProblemTransformation, setCompanyProblemTransformation] = useState<{
    desired_transformation?: string;
    life_after_solution?: string;
  } | null>(null);
  const [planDurationLimit, setPlanDurationLimit] = useState<{
    max_campaign_duration_weeks: number;
    plan_key: string | null;
  } | null>(null);
  const [platformCatalogPlatforms, setPlatformCatalogPlatforms] = useState<any[]>([]);
  const [companyConfiguredPlatforms, setCompanyConfiguredPlatforms] = useState<
    Array<{ platform: string; content_types: string[] }> | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    const catalogParams = new URLSearchParams({ activeOnly: 'true', strict: 'false' });
    if (resolvedCompanyId) catalogParams.set('companyId', resolvedCompanyId);

    const fetches: Promise<unknown>[] = [
      fetchWithAuth(`/api/platform-intelligence/catalog?${catalogParams.toString()}`).then((r) => (r.ok ? r.json() : null)),
    ];
    if (resolvedCompanyId) {
      fetches.push(
        fetchWithAuth(`/api/company/platform-config?companyId=${encodeURIComponent(resolvedCompanyId)}`).then((r) => (r.ok ? r.json() : null)),
        fetchWithAuth(`/api/company-profile?companyId=${encodeURIComponent(resolvedCompanyId)}`).then((r) => (r.ok ? r.json() : null)),
        fetchWithAuth(`/api/company-plan-duration-limit?companyId=${encodeURIComponent(resolvedCompanyId)}`).then((r) => (r.ok ? r.json() : null)),
      );
    } else {
      setCompanyConfiguredPlatforms(null);
      setCompanyKeyMessages(null);
      setCompanyProblemTransformation(null);
      setPlanDurationLimit(null);
    }

    Promise.all(fetches).then((results) => {
      if (cancelled) return;
      const catalogData = results[0] as any;
      const platforms = Array.isArray(catalogData?.platforms) ? catalogData.platforms : [];
      setPlatformCatalogPlatforms(platforms);

      if (resolvedCompanyId && results.length >= 4) {
        const platformConfigData = results[1] as any;
        const profileData = results[2] as any;
        const durationData = results[3] as any;

        const list = Array.isArray(platformConfigData?.platforms) ? platformConfigData.platforms : [];
        setCompanyConfiguredPlatforms(list.length > 0 ? list : null);

        const p = profileData?.profile;
        const km = p?.key_messages;
        if (typeof km === 'string' && km.trim()) setCompanyKeyMessages(km.trim().slice(0, 150));
        else if (Array.isArray(km) && km.length > 0 && typeof km[0] === 'string' && km[0].trim()) setCompanyKeyMessages(String(km[0]).trim().slice(0, 150));
        else setCompanyKeyMessages(null);

        const dt = p?.desired_transformation;
        const las = p?.life_after_solution;
        if ((typeof dt === 'string' && dt.trim()) || (typeof las === 'string' && las.trim())) {
          setCompanyProblemTransformation({
            desired_transformation: typeof dt === 'string' && dt.trim() ? dt.trim().slice(0, 150) : undefined,
            life_after_solution: typeof las === 'string' && las.trim() ? las.trim().slice(0, 150) : undefined,
          });
        } else {
          setCompanyProblemTransformation(null);
        }

        if (durationData) {
          setPlanDurationLimit({
            max_campaign_duration_weeks: Number(durationData.max_campaign_duration_weeks) || 12,
            plan_key: durationData.plan_key ?? null,
          });
        } else {
          setPlanDurationLimit(null);
        }
      }
    }).catch(() => {
      if (!cancelled && resolvedCompanyId) {
        setCompanyKeyMessages(null);
        setCompanyProblemTransformation(null);
        setPlanDurationLimit(null);
      }
    });

    return () => { cancelled = true; };
  }, [resolvedCompanyId]);

  const platformLabels = useMemo(() => {
    const next: Record<string, string> = {};
    for (const p of platformCatalogPlatforms) {
      const key = String(p?.canonical_key || '').toLowerCase().trim();
      const name = String(p?.name || '').trim();
      if (key && name) next[key] = name;
    }
    if (Object.keys(next).length === 0) {
      for (const { label, value } of PLATFORM_OPTIONS) {
        next[value] = label;
      }
    }
    return next;
  }, [platformCatalogPlatforms]);

  const platformQuickPickOptions = useMemo(() => {
    if (companyConfiguredPlatforms && companyConfiguredPlatforms.length > 0) {
      return companyConfiguredPlatforms.map((p) => {
        const key = String(p.platform || '').toLowerCase().replace(/^twitter$/i, 'x').trim();
        return PLATFORM_LABELS[key] || PLATFORM_LABELS[p.platform?.toLowerCase() ?? ''] || String(p.platform || '').replace(/\b\w/g, (c) => c.toUpperCase());
      }).filter(Boolean);
    }
    const names = platformCatalogPlatforms
      .map((p) => String(p?.name || '').trim())
      .filter(Boolean);
    if (names.length === 0) {
      return PLATFORM_OPTIONS.map((o) => o.label);
    }
    return names;
  }, [companyConfiguredPlatforms, platformCatalogPlatforms]);

  const configuredPlatformKeys = useMemo(() => {
    if (!companyConfiguredPlatforms || companyConfiguredPlatforms.length === 0) return [];
    return Array.from(
      new Set(
        companyConfiguredPlatforms
          .map((p) => String(p.platform || '').toLowerCase().replace(/^twitter$/i, 'x').trim())
          .filter(Boolean)
      )
    );
  }, [companyConfiguredPlatforms]);

  const platformContentTypeOptions = useMemo(() => {
    const next: Record<string, string[]> = {};
    if (companyConfiguredPlatforms && companyConfiguredPlatforms.length > 0) {
      for (const p of companyConfiguredPlatforms) {
        const key = String(p.platform || '').toLowerCase().replace(/^twitter$/i, 'x').trim();
        const rawTypes = Array.isArray(p.content_types) ? p.content_types : [];
        const labels = rawTypes.map((ct) => prettyContentTypeLabel(String(ct))).filter(Boolean);
        if (key && labels.length > 0) next[key] = labels;
      }
    }
    if (Object.keys(next).length === 0) {
      for (const p of platformCatalogPlatforms) {
        const key = String(p?.canonical_key || '').toLowerCase().trim();
        const rawTypes = Array.isArray(p?.supported_content_types) ? p.supported_content_types : [];
        const labels = rawTypes.map((ct: any) => prettyContentTypeLabel(String(ct))).filter(Boolean);
        if (key && labels.length > 0) next[key] = labels;
      }
    }
    if (Object.keys(next).length === 0) {
      const defaultTypes = ['post', 'video', 'image', 'carousel', 'blog'];
      for (const { value } of PLATFORM_OPTIONS) {
        next[value] = defaultTypes.map((ct) => prettyContentTypeLabel(ct)).filter(Boolean);
      }
    }
    return next;
  }, [companyConfiguredPlatforms, platformCatalogPlatforms]);

  const platformContentTypeRawOptions = useMemo(() => {
    const next: Record<string, string[]> = {};
    if (companyConfiguredPlatforms && companyConfiguredPlatforms.length > 0) {
      for (const p of companyConfiguredPlatforms) {
        const key = String(p.platform || '').toLowerCase().replace(/^twitter$/i, 'x').trim();
        const types = Array.isArray(p.content_types) ? p.content_types.map((ct) => String(ct || '').trim()).filter(Boolean) : [];
        if (key && types.length > 0) next[key] = types;
      }
    }
    if (Object.keys(next).length === 0) {
      for (const p of platformCatalogPlatforms) {
        const key = String(p?.canonical_key || '').toLowerCase().trim();
        const rawTypes = Array.isArray(p?.supported_content_types) ? p.supported_content_types : [];
        const types = rawTypes.map((ct: any) => String(ct || '').trim()).filter(Boolean);
        if (key && types.length > 0) next[key] = types;
      }
    }
    if (Object.keys(next).length === 0) {
      const defaultTypes = ['post', 'video', 'image', 'carousel', 'blog'];
      for (const { value } of PLATFORM_OPTIONS) {
        next[value] = defaultTypes;
      }
    }
    return next;
  }, [companyConfiguredPlatforms, platformCatalogPlatforms]);

  const allCatalogContentTypeQuickPickOptions = useMemo(() => {
    const raw = new Set<string>();
    if (companyConfiguredPlatforms && companyConfiguredPlatforms.length > 0) {
      for (const p of companyConfiguredPlatforms) {
        const types = Array.isArray(p?.content_types) ? p.content_types : [];
        for (const t of types) {
          const label = canonicalPlanningTypeLabel(prettyContentTypeLabel(String(t || '').trim()));
          if (label) raw.add(label);
        }
      }
    }
    if (raw.size === 0 && platformCatalogPlatforms && platformCatalogPlatforms.length > 0) {
      for (const p of platformCatalogPlatforms) {
        const types = Array.isArray((p as any)?.supported_content_types) ? (p as any).supported_content_types : [];
        for (const t of types) {
          const label = canonicalPlanningTypeLabel(prettyContentTypeLabel(String(t || '').trim()));
          if (label) raw.add(label);
        }
      }
    }
    if (raw.size === 0) {
      for (const l of PLANNING_CONTENT_TYPE_LABELS) {
        const c = canonicalPlanningTypeLabel(l);
        if (c) raw.add(c);
      }
    }
    const priority = new Map<string, number>([
      ['Text posts', 1], ['Videos', 2], ['Reels', 3], ['Shorts', 4], ['Long Videos', 5],
      ['Blogs', 6], ['Articles', 7], ['White Papers', 8], ['Carousels', 9], ['Images', 10],
      ['Stories', 11], ['Threads', 12], ['Spaces', 13], ['Songs', 14], ['Audio', 15],
      ['Podcasts', 16], ['Newsletters', 17], ['Webinars', 18], ['Slides', 19], ['Slideware', 20],
    ]);
    return Array.from(raw)
      .map((s) => String(s).trim())
      .filter(Boolean)
      .sort((a, b) => {
        const pa = priority.get(a) ?? 999;
        const pb = priority.get(b) ?? 999;
        if (pa !== pb) return pa - pb;
        return a.localeCompare(b);
      });
  }, [companyConfiguredPlatforms, platformCatalogPlatforms]);

  const creatorDependentQuickPickOptions = useMemo(() => {
    const creatorSet = new Set(CREATOR_DEPENDENT_PLANNING_LABELS);
    return allCatalogContentTypeQuickPickOptions.filter((label) => creatorSet.has(label as typeof CREATOR_DEPENDENT_PLANNING_LABELS[number]));
  }, [allCatalogContentTypeQuickPickOptions]);

  const platformExtractCandidates = useMemo(() => {
    const keys =
      configuredPlatformKeys.length > 0
        ? configuredPlatformKeys
        : platformCatalogPlatforms && platformCatalogPlatforms.length > 0
          ? platformCatalogPlatforms
              .map((p) => String(p?.canonical_key || '').toLowerCase().trim())
              .filter(Boolean)
          : PLATFORM_OPTIONS.map((o) => o.value);
    const out = new Set<string>(keys);
    if (out.has('x')) out.add('twitter');
    return Array.from(out);
  }, [configuredPlatformKeys, platformCatalogPlatforms]);

  const hasEffectiveCatalog = platformCatalogPlatforms?.length > 0 || PLATFORM_OPTIONS.length > 0;

  return {
    companyKeyMessages,
    companyProblemTransformation,
    planDurationLimit,
    platformCatalogPlatforms,
    companyConfiguredPlatforms,
    platformLabels,
    platformQuickPickOptions,
    configuredPlatformKeys,
    platformContentTypeOptions,
    platformContentTypeRawOptions,
    allCatalogContentTypeQuickPickOptions,
    creatorDependentQuickPickOptions,
    platformExtractCandidates,
    hasEffectiveCatalog,
  };
}
