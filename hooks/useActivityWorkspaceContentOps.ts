import { executeMasterContentPipeline } from '@/lib/planning/executeMasterContentPipeline';
import { apiFetch } from '@/lib/apiFetch';
import type { ScheduleItem } from '../types/activityWorkspace';
import { asObject, type WorkspacePayload } from '@/lib/activity-workspace/shared';

type NotifyFn = (type: 'success' | 'error' | 'info', message: string) => void;

type Params = {
  payload: WorkspacePayload | null;
  schedules: ScheduleItem[];
  selectedCompanyId: string | null | undefined;
  queryCampaignId: string;
  masterContent: Record<string, unknown> | null;
  creatorAsset: Record<string, unknown> | null;
  platformVariants: Array<Record<string, any>>;
  normalizeKey: (value: unknown) => string;
  notify: NotifyFn;
  setIsGeneratingMaster: React.Dispatch<React.SetStateAction<boolean>>;
  setIsGeneratingVariants: React.Dispatch<React.SetStateAction<boolean>>;
  setLatestMasterContent: React.Dispatch<React.SetStateAction<Record<string, unknown> | null>>;
  setPayload: React.Dispatch<React.SetStateAction<WorkspacePayload | null>>;
  setRepurposingByScheduleId: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setFinalizedByScheduleId: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setShowRefineByScheduleId: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  updateSchedule: (id: string, updates: Partial<ScheduleItem>) => void;
  findVariantForSchedule: (item: ScheduleItem) => Record<string, unknown> | null;
};

function buildActivityRequestPayload(payload: WorkspacePayload | null, schedules: ScheduleItem[]) {
  const primary = schedules[0];
  return {
    id: payload?.activityId || primary?.id || `workspace-${Date.now()}`,
    platform: primary?.platform || 'linkedin',
    contentType: primary?.contentType || 'post',
    topic: payload?.topic || payload?.title || '',
    title: payload?.title || payload?.topic || '',
    description: payload?.description || '',
  };
}

export function useActivityWorkspaceContentOps({
  payload,
  schedules,
  selectedCompanyId,
  queryCampaignId,
  masterContent,
  creatorAsset,
  platformVariants,
  normalizeKey,
  notify,
  setIsGeneratingMaster,
  setIsGeneratingVariants,
  setLatestMasterContent,
  setPayload,
  setRepurposingByScheduleId,
  setFinalizedByScheduleId,
  setShowRefineByScheduleId,
  updateSchedule,
  findVariantForSchedule,
}: Params) {
  const handleGenerateMasterContent = async () => {
    try {
      setIsGeneratingMaster(true);
      const response = await apiFetch('/api/activity-workspace/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_master',
          activity: buildActivityRequestPayload(payload, schedules),
          schedules,
          dailyExecutionItem: payload?.dailyExecutionItem || null,
          companyId: selectedCompanyId || payload?.companyId || null,
          campaignId: payload?.campaignId || queryCampaignId || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.message || data?.error || 'Failed to generate master content'));
      }
      const masterFromResponse =
        asObject(data?.master_content) ||
        asObject(data?.masterContent) ||
        asObject(data?.result && asObject(data.result)?.master_content) ||
        null;
      if (masterFromResponse) {
        setLatestMasterContent(masterFromResponse);
      }
      setPayload((prev) => {
        if (!prev) return prev;
        const current = asObject(prev.dailyExecutionItem) || {};
        return {
          ...prev,
          dailyExecutionItem: {
            ...current,
            master_content: masterFromResponse || data.master_content,
          },
        };
      });
      notify('success', 'Master content generated.');
    } catch (error) {
      console.error('Master generation failed:', error);
      notify('error', `Failed to generate master content: ${String((error as any)?.message || error)}`);
    } finally {
      setIsGeneratingMaster(false);
    }
  };

  const onGenerateVariants = async () => {
    const campaignId = String(payload?.campaignId ?? '').trim();
    const executionId = String(payload?.activityId ?? (payload?.dailyExecutionItem as any)?.execution_id ?? '').trim();
    const masterDoc = payload?.master_content_document ?? null;
    const dailyExecutionItem = payload?.dailyExecutionItem ?? null;
    if (!campaignId || !executionId) {
      notify('info', 'Campaign and activity context required.');
      return;
    }
    try {
      setIsGeneratingVariants(true);
      const result = await executeMasterContentPipeline({
        campaignId,
        executionId,
        masterDocument: masterDoc,
        dailyExecutionItem,
        schedules,
        companyId: selectedCompanyId || payload?.companyId || null,
      });
      const incomingVariants = Array.isArray(result.platform_variants) ? result.platform_variants : [];
      const mergedByKey = new Map<string, Record<string, unknown>>();
      const existingVariants = Array.isArray((dailyExecutionItem as any)?.platform_variants) ? (dailyExecutionItem as any).platform_variants : [];
      for (const v of existingVariants) {
        const key = `${normalizeKey((v as any)?.platform)}::${normalizeKey((v as any)?.content_type)}`;
        if (key !== '::') mergedByKey.set(key, v as Record<string, unknown>);
      }
      for (const v of incomingVariants) {
        const key = `${normalizeKey((v as any)?.platform)}::${normalizeKey((v as any)?.content_type)}`;
        if (key !== '::') {
          mergedByKey.set(key, {
            ...(v as Record<string, unknown>),
            generated_content: (v as any)?.generated_content ?? (v as any)?.content,
            generation_status: 'generated',
          });
        }
      }
      const mergedVariants = Array.from(mergedByKey.values());
      const nextPlatformVariantsRecord: Record<string, { execution_id: string; status: 'PENDING' | 'GENERATED'; content?: string }> = { ...(masterDoc?.platform_variants ?? {}) };
      for (const v of incomingVariants) {
        const platform = normalizeKey((v as any)?.platform);
        if (!platform) continue;
        const content = String((v as any)?.generated_content ?? (v as any)?.content ?? '').trim();
        const variantExecutionId = (masterDoc?.platform_variants?.[platform] as any)?.execution_id ?? executionId;
        nextPlatformVariantsRecord[platform] = { execution_id: variantExecutionId, status: 'GENERATED' as const, content: content || undefined };
      }
      if (result.master_content) {
        setLatestMasterContent(result.master_content as Record<string, unknown>);
      }
      setPayload((prev) => {
        if (!prev) return prev;
        const current = asObject(prev.dailyExecutionItem) || {};
        return {
          ...prev,
          master_content_document: masterDoc
            ? { ...masterDoc, platform_variants: nextPlatformVariantsRecord }
            : prev.master_content_document,
          dailyExecutionItem: {
            ...current,
            ...(result.master_content ? { master_content: result.master_content } : {}),
            platform_variants: mergedVariants,
          },
        };
      });
      notify('success', 'Platform variants generated.');
    } catch (error) {
      console.error('Generate variants failed:', error);
      notify('error', `Failed to generate variants: ${String((error as any)?.message || error)}`);
    } finally {
      setIsGeneratingVariants(false);
    }
  };

  const handleRepurposeForPlatform = async (schedule: ScheduleItem) => {
    try {
      setRepurposingByScheduleId((prev) => ({ ...prev, [schedule.id]: true }));
      const currentDaily = asObject(payload?.dailyExecutionItem) || {};

      let activeMasterContent = masterContent || currentDaily.master_content || null;
      const masterReady = activeMasterContent && String((activeMasterContent as any)?.content || '').trim().length > 0;
      if (!masterReady) {
        setIsGeneratingMaster(true);
        try {
          const masterRes = await apiFetch('/api/activity-workspace/content', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'generate_master',
              activity: buildActivityRequestPayload(payload, schedules),
              schedules,
              dailyExecutionItem: payload?.dailyExecutionItem || null,
              companyId: selectedCompanyId || payload?.companyId || null,
              campaignId: payload?.campaignId || queryCampaignId || null,
            }),
          });
          const masterData = await masterRes.json().catch(() => ({}));
          if (masterRes.ok) {
            const newMaster = asObject(masterData?.master_content) || asObject(masterData?.masterContent) || null;
            if (newMaster) {
              activeMasterContent = newMaster;
              setLatestMasterContent(newMaster);
              setPayload((prev) => {
                if (!prev) return prev;
                const cur = asObject(prev.dailyExecutionItem) || {};
                return { ...prev, dailyExecutionItem: { ...cur, master_content: newMaster } };
              });
            }
          }
        } finally {
          setIsGeneratingMaster(false);
        }
      }

      const response = await apiFetch('/api/activity-workspace/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_variants',
          activity: buildActivityRequestPayload(payload, schedules),
          schedules: [schedule],
          dailyExecutionItem: {
            ...currentDaily,
            master_content: activeMasterContent || currentDaily.master_content || null,
            platform_variants: platformVariants,
          },
          companyId: selectedCompanyId || payload?.companyId || null,
          campaignId: payload?.campaignId || queryCampaignId || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.message || data?.error || 'Failed to repurpose content'));
      }

      const returnedMaster = asObject(data?.master_content);
      if (returnedMaster && !activeMasterContent) {
        setLatestMasterContent(returnedMaster);
      }

      const incoming = Array.isArray(data.platform_variants) ? data.platform_variants : [];
      const mergedByKey = new Map<string, Record<string, unknown>>();
      for (const variant of platformVariants) {
        const key = `${normalizeKey(variant.platform)}::${normalizeKey(variant.content_type)}`;
        mergedByKey.set(key, variant);
      }
      for (const variant of incoming) {
        const key = `${normalizeKey((variant as any)?.platform)}::${normalizeKey((variant as any)?.content_type)}`;
        if (key !== '::') {
          mergedByKey.set(key, variant as Record<string, unknown>);
        }
      }
      const mergedVariants = Array.from(mergedByKey.values());
      setPayload((prev) => {
        if (!prev) return prev;
        const current = asObject(prev.dailyExecutionItem) || {};
        return {
          ...prev,
          dailyExecutionItem: {
            ...current,
            platform_variants: mergedVariants,
            ...(returnedMaster && !current.master_content ? { master_content: returnedMaster } : {}),
          },
        };
      });
      setFinalizedByScheduleId((prev) => ({ ...prev, [schedule.id]: false }));
      setShowRefineByScheduleId((prev) => ({ ...prev, [schedule.id]: true }));
      updateSchedule(schedule.id, { status: 'in-progress' });
      notify('success', `Repurposed content generated for ${schedule.platform}.`);
    } catch (error) {
      console.error('Repurpose generation failed:', error);
      notify('error', `Failed to repurpose content: ${String((error as any)?.message || error)}`);
    } finally {
      setRepurposingByScheduleId((prev) => ({ ...prev, [schedule.id]: false }));
    }
  };

  const handleRepurposeAll = async () => {
    const pending = schedules.filter((schedule) => {
      const variant = findVariantForSchedule(schedule);
      return !String((variant as any)?.generated_content || '').trim();
    });
    if (pending.length === 0) {
      notify('info', 'All platforms already have generated content.');
      return;
    }
    for (const schedule of pending) {
      await handleRepurposeForPlatform(schedule);
    }
  };

  const handleCreatorAssetSaved = (asset: { type: string; url?: string; files?: string[]; description?: string; transcript?: string; theme?: string }) => {
    setPayload((prev) => {
      if (!prev) return prev;
      const current = asObject(prev.dailyExecutionItem) || {};
      return {
        ...prev,
        dailyExecutionItem: {
          ...current,
          creator_asset: asset,
          content_status: 'READY_FOR_PROMOTION',
        },
      };
    });
  };

  const handleGenerateCreatorPromotion = async () => {
    const campaignId = String(payload?.campaignId ?? '').trim();
    const executionId = String(payload?.activityId ?? (payload?.dailyExecutionItem as any)?.execution_id ?? '').trim();
    const currentDaily = asObject(payload?.dailyExecutionItem) || {};
    if (!campaignId || !executionId) {
      notify('info', 'Campaign and activity context required.');
      return;
    }
    try {
      setIsGeneratingVariants(true);
      const response = await apiFetch('/api/activity-workspace/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_variants',
          activity: buildActivityRequestPayload(payload, schedules),
          schedules: schedules.length > 0 ? schedules : [{ id: 'default', platform: 'linkedin', contentType: 'post' }],
          dailyExecutionItem: {
            ...currentDaily,
            creator_asset: creatorAsset,
            master_content: null,
            platform_variants: platformVariants,
          },
          companyId: selectedCompanyId || payload?.companyId || null,
          campaignId: payload?.campaignId || queryCampaignId || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.message || data?.error || 'Failed to generate promotion content'));
      }
      const incoming = Array.isArray(data.platform_variants) ? data.platform_variants : [];
      const mergedByKey = new Map<string, Record<string, unknown>>();
      for (const variant of platformVariants) {
        const key = `${normalizeKey(variant.platform)}::${normalizeKey(variant.content_type)}`;
        mergedByKey.set(key, variant);
      }
      for (const variant of incoming) {
        const key = `${normalizeKey((variant as any)?.platform)}::${normalizeKey((variant as any)?.content_type)}`;
        if (key !== '::') mergedByKey.set(key, variant as Record<string, unknown>);
      }
      const mergedVariants = Array.from(mergedByKey.values());
      setPayload((prev) => {
        if (!prev) return prev;
        const current = asObject(prev.dailyExecutionItem) || {};
        return {
          ...prev,
          dailyExecutionItem: {
            ...current,
            creator_asset: creatorAsset,
            platform_variants: mergedVariants,
          },
        };
      });
      notify('success', 'Promotion content generated.');
    } catch (error) {
      console.error('Generate creator promotion failed:', error);
      notify('error', `Failed to generate: ${String((error as any)?.message || error)}`);
    } finally {
      setIsGeneratingVariants(false);
    }
  };

  return {
    handleGenerateMasterContent,
    onGenerateVariants,
    handleRepurposeForPlatform,
    handleRepurposeAll,
    handleCreatorAssetSaved,
    handleGenerateCreatorPromotion,
  };
}
