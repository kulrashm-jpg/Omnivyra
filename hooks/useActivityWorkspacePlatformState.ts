import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import { computeVariantIntelligence } from '@/lib/intelligence/executionIntelligence';
import { asObject, type WorkspacePayload } from '@/lib/activity-workspace/shared';
import type { ScheduleItem } from '../types/activityWorkspace';

type VariantIntelligenceStatus = 'pending' | 'generated' | 'adapted' | 'ready';

type Params = {
  payload: WorkspacePayload | null;
  schedules: ScheduleItem[];
  finalizedByScheduleId: Record<string, boolean>;
  selectedVariantTab: string;
  platformRulesByPlatform: Record<string, { guidelines: string[] }>;
  strategicMemoryProfile: {
    campaign_id: string;
    action_acceptance_rate: Record<string, number>;
    platform_confidence_average: Record<string, number>;
    total_events: number;
  } | null;
  normalizeKey: (value: unknown) => string;
  setPlatformRulesByPlatform: Dispatch<SetStateAction<Record<string, { guidelines: string[] }>>>;
  setSelectedVariantTab: Dispatch<SetStateAction<string>>;
};

export function useActivityWorkspacePlatformState({
  payload,
  schedules,
  finalizedByScheduleId,
  selectedVariantTab,
  platformRulesByPlatform,
  strategicMemoryProfile,
  normalizeKey,
  setPlatformRulesByPlatform,
  setSelectedVariantTab,
}: Params) {
  const platformVariants = useMemo(
    () =>
      Array.isArray(asObject(payload?.dailyExecutionItem)?.platform_variants)
        ? (asObject(payload?.dailyExecutionItem)?.platform_variants as Array<Record<string, unknown>>)
        : [],
    [payload?.dailyExecutionItem]
  );

  const getVariantIntelligenceStatus = (variant: Record<string, unknown> | null | undefined, scheduleId: string): VariantIntelligenceStatus => {
    if (!variant || !String((variant as any)?.generated_content ?? '').trim()) return 'pending';
    if (finalizedByScheduleId[scheduleId]) return 'ready';
    if ((variant as any)?.adaptation_trace && typeof (variant as any).adaptation_trace === 'object') return 'adapted';
    return 'generated';
  };

  const variantStatusLabel: Record<VariantIntelligenceStatus, string> = {
    pending: 'Pending',
    generated: 'Generated',
    adapted: 'Adapted to platform rules',
    ready: 'Ready to publish',
  };

  const variantStatusDot: Record<VariantIntelligenceStatus, string> = {
    pending: '🟡',
    generated: '🟢',
    adapted: '🔵',
    ready: '🟣',
  };

  const fetchPlatformRules = (platform: string) => {
    const key = String(platform || '').trim().toLowerCase();
    if (!key || platformRulesByPlatform[key]?.guidelines?.length) return;
    fetch(`/api/content/platform-rules?platform=${encodeURIComponent(key)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.guidelines?.length) {
          setPlatformRulesByPlatform((prev) => ({ ...prev, [key]: { guidelines: data.guidelines } }));
        }
      })
      .catch(() => {});
  };

  const variantTabPlatforms = useMemo(() => {
    const platforms = new Set<string>();
    schedules.forEach((schedule) => platforms.add(normalizeKey(schedule.platform)));
    return Array.from(platforms);
  }, [schedules]);

  const selectedScheduleId =
    selectedVariantTab && schedules.some((schedule) => schedule.id === selectedVariantTab)
      ? selectedVariantTab
      : schedules[0]?.id ?? '';

  const confidenceByPlatform = useMemo(() => {
    const out: Record<string, number> = {};
    variantTabPlatforms.forEach((platform) => {
      const variantsForPlatform = platformVariants.filter((variant) => normalizeKey((variant as any)?.platform) === platform);
      let maxScore = 0;
      variantsForPlatform.forEach((variant) => {
        const intelligence = computeVariantIntelligence(variant, platform, strategicMemoryProfile);
        if (intelligence.confidence_score > maxScore) maxScore = intelligence.confidence_score;
      });
      if (variantsForPlatform.length > 0) out[platform] = maxScore;
    });
    return out;
  }, [variantTabPlatforms, platformVariants, strategicMemoryProfile]);

  useEffect(() => {
    if (schedules.length > 0 && !selectedScheduleId) {
      setSelectedVariantTab(schedules[0].id);
      if (schedules[0]) fetchPlatformRules(schedules[0].platform);
    }
  }, [schedules.length, selectedScheduleId, schedules]);

  useEffect(() => {
    if (schedules.length > 0 && selectedVariantTab && !schedules.some((schedule) => schedule.id === selectedVariantTab)) {
      setSelectedVariantTab(schedules[0].id);
      if (schedules[0]) fetchPlatformRules(schedules[0].platform);
    }
  }, [schedules, selectedVariantTab]);

  const schedulePlatformsKey = useMemo(
    () => [...new Set(schedules.map((schedule) => normalizeKey(schedule.platform)))].sort().join(','),
    [schedules]
  );

  useEffect(() => {
    schedules.forEach((schedule) => {
      fetchPlatformRules(schedule.platform);
    });
  }, [schedulePlatformsKey]);

  return {
    confidenceByPlatform,
    fetchPlatformRules,
    getVariantIntelligenceStatus,
    platformVariants,
    schedulePlatformsKey,
    selectedScheduleId,
    variantStatusDot,
    variantStatusLabel,
    variantTabPlatforms,
  };
}
