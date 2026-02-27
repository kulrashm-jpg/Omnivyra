import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, CheckCircle2, Loader2, MessageSquare, Plus, Save, Sparkles, Trash2, X } from 'lucide-react';

type ScheduleItem = {
  id: string;
  platform: string;
  contentType: string;
  date?: string;
  time?: string;
  status?: string;
  description?: string;
  title?: string;
};

type WorkspacePayload = {
  campaignId?: string | null;
  weekNumber?: number;
  day?: string;
  activityId?: string;
  title?: string;
  topic?: string;
  description?: string;
  dailyExecutionItem?: Record<string, unknown> | null;
  schedules?: ScheduleItem[];
};

type RefineChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export default function ActivityWorkspacePage() {
  const router = useRouter();
  const workspaceKey = useMemo(() => {
    const raw = Array.isArray(router.query.workspaceKey) ? router.query.workspaceKey[0] : router.query.workspaceKey;
    return String(raw || '').trim();
  }, [router.query.workspaceKey]);

  const [payload, setPayload] = useState<WorkspacePayload | null>(null);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isGeneratingMaster, setIsGeneratingMaster] = useState(false);
  const [latestMasterContent, setLatestMasterContent] = useState<Record<string, unknown> | null>(null);
  const [repurposingByScheduleId, setRepurposingByScheduleId] = useState<Record<string, boolean>>({});
  const [isHydratingContext, setIsHydratingContext] = useState(false);
  const [hasTriedHydration, setHasTriedHydration] = useState(false);
  const [showRefineByScheduleId, setShowRefineByScheduleId] = useState<Record<string, boolean>>({});
  const [isRefiningByScheduleId, setIsRefiningByScheduleId] = useState<Record<string, boolean>>({});
  const [refineInputByScheduleId, setRefineInputByScheduleId] = useState<Record<string, string>>({});
  const [refineMessagesByScheduleId, setRefineMessagesByScheduleId] = useState<Record<string, RefineChatMessage[]>>({});
  const [finalizedByScheduleId, setFinalizedByScheduleId] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const notify = (type: 'success' | 'error' | 'info', message: string) => setNotice({ type, message });

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!router.isReady) return;
    if (!workspaceKey) {
      setIsLoaded(true);
      return;
    }
    try {
      const raw = window.sessionStorage.getItem(workspaceKey);
      if (!raw) {
        setIsLoaded(true);
        return;
      }
      const parsed = JSON.parse(raw) as WorkspacePayload;
      setPayload(parsed);
      setSchedules(Array.isArray(parsed?.schedules) ? parsed.schedules : []);
    } catch (error) {
      console.error('Failed to load workspace payload:', error);
    } finally {
      setIsLoaded(true);
    }
  }, [router.isReady, workspaceKey]);

  const dailyRaw = asObject(payload?.dailyExecutionItem);
  const nestedBrief = asObject(dailyRaw?.writer_content_brief);
  const nestedIntent = asObject(dailyRaw?.intent);
  // Derive Writer Context from flat week/daily details when nested writer_content_brief/intent are missing (e.g. from calendar daily-plans or v2 daily object)
  const topicText = String((payload?.topic || payload?.title || (dailyRaw?.topicTitle ?? dailyRaw?.topic)) ?? '').trim();
  const writerBrief = nestedBrief || (dailyRaw && (dailyRaw.topicTitle || dailyRaw.writingIntent || dailyRaw.whatShouldReaderLearn || dailyRaw.whatProblemAreWeAddressing || dailyRaw.desiredAction || dailyRaw.narrativeStyle || dailyRaw.introObjective || dailyRaw.summary || dailyRaw.objective || dailyRaw.cta || dailyRaw.brandVoice || dailyRaw.dailyObjective) ? {
    topicTitle: (dailyRaw.topicTitle ?? dailyRaw.topic ?? payload?.title ?? payload?.topic) as string,
    writingIntent: (dailyRaw.writingIntent ?? dailyRaw.description) as string,
    whatShouldReaderLearn: (dailyRaw.whatShouldReaderLearn ?? dailyRaw.introObjective) as string,
    whatProblemAreWeAddressing: (dailyRaw.whatProblemAreWeAddressing ?? dailyRaw.summary) as string,
    desiredAction: (dailyRaw.desiredAction ?? dailyRaw.cta) as string,
    narrativeStyle: (dailyRaw.narrativeStyle ?? dailyRaw.brandVoice) as string,
    topicGoal: (dailyRaw.dailyObjective ?? dailyRaw.objective) as string,
  } as Record<string, unknown> : null);
  const intent = nestedIntent || (dailyRaw && (dailyRaw.dailyObjective || dailyRaw.objective || dailyRaw.pain_point || dailyRaw.outcome_promise || dailyRaw.whatProblemAreWeAddressing || dailyRaw.whatShouldReaderLearn || dailyRaw.desiredAction || dailyRaw.cta) ? {
    objective: (dailyRaw.dailyObjective ?? dailyRaw.objective) as string,
    pain_point: (dailyRaw.whatProblemAreWeAddressing ?? dailyRaw.summary ?? dailyRaw.pain_point) as string,
    outcome_promise: (dailyRaw.whatShouldReaderLearn ?? dailyRaw.introObjective ?? dailyRaw.outcome_promise) as string,
    cta_type: (dailyRaw.desiredAction ?? dailyRaw.cta ?? dailyRaw.cta_type) as string,
  } as Record<string, unknown> : null);
  const effectiveWhatReaderLearns = String(writerBrief?.whatShouldReaderLearn || '').trim() || (topicText ? `Reader understands ${topicText} and why it matters.` : '—');
  const effectiveProblemAddressed = String(writerBrief?.whatProblemAreWeAddressing || intent?.pain_point || '').trim() || (topicText ? `Uncertainty about ${topicText}` : '—');
  const masterContentFromPayload = asObject(payload?.dailyExecutionItem && asObject(payload.dailyExecutionItem)?.master_content);
  const masterContent = latestMasterContent || masterContentFromPayload;
  const platformVariants = Array.isArray(asObject(payload?.dailyExecutionItem)?.platform_variants)
    ? (asObject(payload?.dailyExecutionItem)?.platform_variants as Array<Record<string, unknown>>)
    : [];
  const hasMasterGenerated =
    String(masterContent?.generation_status || '').toLowerCase() === 'generated' ||
    String(masterContent?.content || '').trim().length > 0;

  const normalizeKey = (value: unknown) => String(value || '').trim().toLowerCase();
  const platformOptions = ['linkedin', 'facebook', 'instagram', 'x', 'youtube', 'tiktok', 'reddit', 'pinterest'];
  const contentTypeOptionsByPlatform: Record<string, string[]> = {
    linkedin: ['feed_post', 'article', 'white_paper', 'case_study', 'carousel', 'video', 'newsletter'],
    facebook: ['post', 'carousel', 'video', 'story', 'reel'],
    instagram: ['feed_post', 'carousel', 'reel', 'story', 'video'],
    x: ['tweet', 'thread', 'video', 'carousel'],
    youtube: ['video', 'short', 'description', 'live'],
    tiktok: ['video', 'short', 'carousel'],
    reddit: ['post', 'discussion', 'carousel'],
    pinterest: ['pin', 'carousel', 'video'],
  };
  const getContentTypeOptions = (platform: string) => {
    const key = normalizeKey(platform);
    const defaults = ['post', 'article', 'white_paper', 'video', 'carousel'];
    return contentTypeOptionsByPlatform[key] || defaults;
  };
  const labelize = (value: string) =>
    String(value || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (m) => m.toUpperCase());
  const normalizeComparableText = (value: unknown) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

  const buildScheduleRowsFromExecutionItem = (item: Record<string, unknown>, existingSchedules: ScheduleItem[]) => {
    const existingByKey = new Map<string, ScheduleItem>();
    for (const row of existingSchedules) {
      const key = `${normalizeKey(row.platform)}::${normalizeKey(row.contentType)}`;
      existingByKey.set(key, row);
    }

    const targets: Array<{ platform: string; contentType: string }> = [];
    const addTarget = (platform: unknown, contentType: unknown) => {
      const p = normalizeKey(platform);
      const c = normalizeKey(contentType) || 'post';
      if (!p) return;
      if (!targets.some((t) => t.platform === p && t.contentType === c)) {
        targets.push({ platform: p, contentType: c });
      }
    };

    const variants = Array.isArray((item as any)?.platform_variants) ? (item as any).platform_variants : [];
    variants.forEach((v: any) => addTarget(v?.platform, v?.content_type));

    const activeTargets = Array.isArray((item as any)?.active_platform_targets) ? (item as any).active_platform_targets : [];
    activeTargets.forEach((t: any) => addTarget(t?.platform, t?.content_type));

    const plannedTargets = Array.isArray((item as any)?.planned_platform_targets) ? (item as any).planned_platform_targets : [];
    plannedTargets.forEach((t: any) => addTarget(t?.platform, t?.content_type));

    const selectedPlatforms = Array.isArray((item as any)?.selected_platforms) ? (item as any).selected_platforms : [];
    selectedPlatforms.forEach((platform: any) => addTarget(platform, (item as any)?.content_type));

    addTarget((item as any)?.platform, (item as any)?.content_type);

    if (targets.length === 0 && existingSchedules.length > 0) return existingSchedules;

    return targets.map((t, idx) => {
      const key = `${t.platform}::${t.contentType}`;
      const existing = existingByKey.get(key);
      return {
        id: existing?.id || `hydrated-${t.platform}-${t.contentType}-${idx}`,
        platform: t.platform,
        contentType: t.contentType,
        date: existing?.date || existingSchedules[0]?.date || '',
        time: existing?.time || existingSchedules[0]?.time || '09:00',
        status: existing?.status,
        description: existing?.description,
        title: existing?.title,
      };
    });
  };

  const findVariantForSchedule = (item: ScheduleItem) => {
    const targetPlatform = normalizeKey(item.platform);
    const targetType = normalizeKey(item.contentType);
    return (
      platformVariants.find(
        (variant) =>
          normalizeKey(variant.platform) === targetPlatform &&
          normalizeKey(variant.content_type) === targetType
      ) ||
      platformVariants.find((variant) => normalizeKey(variant.platform) === targetPlatform) ||
      null
    );
  };

  const buildMarketingSupport = (
    platform: string,
    contentType: string,
    content: string,
    variant?: Record<string, unknown> | null
  ) => {
    const cleaned = String(content || '').trim();
    const platformKey = normalizeKey(platform);
    const typeKey = normalizeKey(contentType);
    const variantTrace = asObject((variant as any)?.adaptation_trace);
    const variantLimit = Number((variantTrace as any)?.character_limit_used);
    const defaultContentLimits: Record<string, number> = {
      'x::tweet': 280,
      'x::thread': 1800,
      'twitter::tweet': 280,
      'linkedin::feed_post': 3000,
      'linkedin::post': 3000,
      'facebook::post': 2000,
      'instagram::caption': 2200,
      'instagram::feed_post': 2200,
      'youtube::description': 5000,
      'youtube::video': 5000,
    };
    const fallbackContentLimit =
      defaultContentLimits[`${platformKey}::${typeKey}`] ||
      defaultContentLimits[`${platformKey}::post`] ||
      1200;
    const contentMax = Number.isFinite(variantLimit) && variantLimit > 0 ? variantLimit : fallbackContentLimit;
    const titleMax = platformKey === 'youtube' ? 100 : 80;
    const metaTitleMax = 60;
    const metaDescriptionMax = 160;
    const hashtagsMax = platformKey === 'instagram' ? 30 : platformKey === 'x' || platformKey === 'twitter' ? 10 : 8;
    const keywordsMax = 10;
    const targetRatio = 0.9;

    const sourceWords = Array.from(
      new Set(
        cleaned
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .map((w) => w.trim())
          .filter((w) => w.length >= 4)
      )
    );
    const sourceSentence = cleaned.replace(/\s+/g, ' ').trim();
    const fillTextAtTarget = (seed: string, max: number) => {
      const target = Math.max(1, Math.floor(max * targetRatio));
      let out = String(seed || '').replace(/\s+/g, ' ').trim();
      const source = sourceSentence || String(payload?.title || payload?.topic || 'Campaign content').trim();
      if (!out) out = source;
      if (out.length >= target) return out.slice(0, max).trim();
      const sourceTokens = source.split(/\s+/).filter(Boolean);
      let idx = 0;
      while (out.length < target && sourceTokens.length > 0) {
        out = `${out} ${sourceTokens[idx % sourceTokens.length]}`.trim();
        idx += 1;
      }
      return out.slice(0, max).trim();
    };
    const fillListAtTarget = (
      seeds: string[],
      maxCount: number,
      formatter?: (v: string) => string
    ) => {
      const targetCount = Math.max(1, Math.ceil(maxCount * targetRatio));
      const cleanedSeeds = seeds
        .map((v) => normalizeKey(v).replace(/[^a-z0-9_]+/g, ''))
        .filter(Boolean);
      const values: string[] = [];
      for (const seed of cleanedSeeds) {
        if (!values.includes(seed)) values.push(seed);
      }
      for (const word of sourceWords) {
        if (values.length >= targetCount) break;
        if (!values.includes(word)) values.push(word);
      }
      const capped = values.slice(0, maxCount);
      return formatter ? capped.map(formatter) : capped;
    };

    const lines = cleaned
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const firstSentence =
      cleaned.split(/[.!?]/).map((p) => p.trim()).find(Boolean) ||
      lines[0] ||
      String(payload?.title || payload?.topic || 'Campaign content').trim();
    const title = fillTextAtTarget(firstSentence, titleMax);
    const metaTitle = fillTextAtTarget(`${title} | ${String(platform).toUpperCase()}`, metaTitleMax);
    const metaDescription = fillTextAtTarget(cleaned || title, metaDescriptionMax);
    const extractedHashtags = Array.from(
      new Set((cleaned.match(/#[A-Za-z0-9_]+/g) || []).map((tag) => tag.toLowerCase()))
    );
    const seededHashtags = [
      `#${normalizeKey(platform).replace(/[^a-z0-9]+/g, '') || 'social'}`,
      '#marketing',
      '#contentstrategy',
    ];
    const hashtags = fillListAtTarget(
      [...extractedHashtags, ...seededHashtags],
      hashtagsMax,
      (v) => (v.startsWith('#') ? v : `#${v}`)
    );
    const keywordSeed = `${payload?.topic || payload?.title || ''} ${title}`;
    const keywords = fillListAtTarget(
      keywordSeed
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 4),
      keywordsMax
    );
    const cta =
      normalizeKey(platform) === 'linkedin'
        ? 'Ask a professional question to drive comments.'
        : normalizeKey(platform) === 'x'
          ? 'End with a concise action line and a hashtag.'
          : 'Use a clear CTA to encourage engagement or clicks.';

    return {
      title,
      metaTitle,
      metaDescription,
      hashtags,
      keywords,
      cta,
      limits: {
        contentMax,
        titleMax,
        metaTitleMax,
        metaDescriptionMax,
        hashtagsMax,
        keywordsMax,
      },
      utilization: {
        contentPct: contentMax > 0 ? Math.round((cleaned.length / contentMax) * 100) : null,
        titlePct: titleMax > 0 ? Math.round((title.length / titleMax) * 100) : null,
        metaTitlePct: metaTitleMax > 0 ? Math.round((metaTitle.length / metaTitleMax) * 100) : null,
        metaDescriptionPct: metaDescriptionMax > 0 ? Math.round((metaDescription.length / metaDescriptionMax) * 100) : null,
        hashtagsPct: hashtagsMax > 0 ? Math.round((hashtags.length / hashtagsMax) * 100) : null,
        keywordsPct: keywordsMax > 0 ? Math.round((keywords.length / keywordsMax) * 100) : null,
      },
    };
  };

  useEffect(() => {
    if (!payload || hasTriedHydration || isHydratingContext) return;
    const campaignId = String(payload.campaignId || '').trim();
    const weekNumber = Number(payload.weekNumber);
    const currentTitle = normalizeComparableText(payload.title || payload.topic || '');
    if (!campaignId || !Number.isFinite(weekNumber) || !currentTitle) {
      setHasTriedHydration(true);
      return;
    }

    const currentDaily = asObject(payload.dailyExecutionItem) || {};
    const hasRichContext =
      Boolean(asObject(currentDaily.intent)) &&
      Boolean(asObject(currentDaily.writer_content_brief));
    if (hasRichContext && schedules.length > 1) {
      setHasTriedHydration(true);
      return;
    }

    let cancelled = false;
    const hydrate = async () => {
      try {
        setIsHydratingContext(true);
        const [weeklyRes, dailyRes] = await Promise.all([
          fetch(`/api/campaigns/get-weekly-plans?campaignId=${encodeURIComponent(campaignId)}`),
          fetch(`/api/campaigns/daily-plans?campaignId=${encodeURIComponent(campaignId)}`),
        ]);

        const weeklyData = weeklyRes.ok ? await weeklyRes.json().catch(() => []) : [];
        const dailyData = dailyRes.ok ? await dailyRes.json().catch(() => []) : [];
        if (cancelled) return;

        const weeks = Array.isArray(weeklyData) ? weeklyData : [];
        const weekMatch =
          weeks.find((w: any) => Number(w?.weekNumber) === weekNumber) ||
          weeks.find((w: any) => Number(w?.week_number) === weekNumber) ||
          null;
        const executionItems = Array.isArray((weekMatch as any)?.execution_items)
          ? (weekMatch as any).execution_items
          : [];

        const matchedExecution = executionItems.find((item: any) => {
          const t1 = normalizeComparableText(item?.title || '');
          const t2 = normalizeComparableText(item?.topic || '');
          return t1 === currentTitle || t2 === currentTitle;
        }) || null;

        const dailyPlans = Array.isArray(dailyData) ? dailyData : [];
        const matchedDailyRows = dailyPlans.filter((row: any) => {
          const rowWeek = Number(row?.weekNumber || row?.week_number);
          const rowTitle = normalizeComparableText(row?.title || row?.topic || '');
          return rowWeek === weekNumber && rowTitle === currentTitle;
        });

        if (!matchedExecution && matchedDailyRows.length === 0) {
          setHasTriedHydration(true);
          return;
        }

        const fromDailyRow = matchedDailyRows[0];
        const dailyRowBrief = fromDailyRow && (asObject((fromDailyRow as any)?.dailyObject) || fromDailyRow);
        const builtBriefFromRow = dailyRowBrief && !asObject((currentDaily as any)?.writer_content_brief) && !asObject((matchedExecution as any)?.writer_content_brief) ? {
          topicTitle: (dailyRowBrief.topicTitle ?? dailyRowBrief.topic ?? payload?.title ?? payload?.topic) as string,
          writingIntent: (dailyRowBrief.writingIntent ?? dailyRowBrief.description) as string,
          whatShouldReaderLearn: (dailyRowBrief.whatShouldReaderLearn ?? dailyRowBrief.introObjective) as string,
          whatProblemAreWeAddressing: (dailyRowBrief.whatProblemAreWeAddressing ?? dailyRowBrief.summary) as string,
          desiredAction: (dailyRowBrief.desiredAction ?? dailyRowBrief.cta) as string,
          narrativeStyle: (dailyRowBrief.narrativeStyle ?? dailyRowBrief.brandVoice) as string,
          topicGoal: (dailyRowBrief.dailyObjective ?? dailyRowBrief.objective) as string,
        } as Record<string, unknown> : null;
        const builtIntentFromRow = dailyRowBrief && !asObject((currentDaily as any)?.intent) && !asObject((matchedExecution as any)?.intent) ? {
          objective: (dailyRowBrief.dailyObjective ?? dailyRowBrief.objective) as string,
          pain_point: (dailyRowBrief.whatProblemAreWeAddressing ?? dailyRowBrief.summary ?? dailyRowBrief.pain_point) as string,
          outcome_promise: (dailyRowBrief.whatShouldReaderLearn ?? dailyRowBrief.introObjective ?? dailyRowBrief.outcome_promise) as string,
          cta_type: (dailyRowBrief.desiredAction ?? dailyRowBrief.cta ?? dailyRowBrief.cta_type) as string,
        } as Record<string, unknown> : null;

        const nextDailyExecution = {
          ...(matchedExecution || {}),
          ...currentDaily,
          intent: asObject((currentDaily as any)?.intent) || asObject((matchedExecution as any)?.intent) || builtIntentFromRow || undefined,
          writer_content_brief:
            asObject((currentDaily as any)?.writer_content_brief) ||
            asObject((matchedExecution as any)?.writer_content_brief) ||
            builtBriefFromRow ||
            undefined,
          master_content:
            asObject((currentDaily as any)?.master_content) ||
            asObject((matchedExecution as any)?.master_content) ||
            undefined,
          platform_variants:
            Array.isArray((currentDaily as any)?.platform_variants) && (currentDaily as any).platform_variants.length > 0
              ? (currentDaily as any).platform_variants
              : (Array.isArray((matchedExecution as any)?.platform_variants) ? (matchedExecution as any).platform_variants : undefined),
        };

        const hydratedSchedules = buildScheduleRowsFromExecutionItem(
          nextDailyExecution,
          schedules
        ).map((row) => {
          const matchingDaily = matchedDailyRows.find(
            (d: any) =>
              normalizeKey(d?.platform) === normalizeKey(row.platform) &&
              normalizeKey(d?.contentType) === normalizeKey(row.contentType)
          );
          const scheduledTime = String(matchingDaily?.scheduledTime || '').trim();
          const normalizedTime = scheduledTime ? scheduledTime.split(':').slice(0, 2).join(':') : row.time;
          return {
            ...row,
            time: normalizedTime || row.time || '09:00',
          };
        });

        setPayload((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            dailyExecutionItem: nextDailyExecution,
          };
        });
        setSchedules(hydratedSchedules);
      } catch (error) {
        console.warn('Workspace hydration failed:', error);
      } finally {
        if (!cancelled) {
          setIsHydratingContext(false);
          setHasTriedHydration(true);
        }
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [payload, hasTriedHydration, isHydratingContext, schedules]);

  const updateSchedule = (id: string, updates: Partial<ScheduleItem>) => {
    setSchedules((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));
    if (Object.prototype.hasOwnProperty.call(updates, 'platform') || Object.prototype.hasOwnProperty.call(updates, 'contentType')) {
      setFinalizedByScheduleId((prev) => ({ ...prev, [id]: false }));
    }
  };

  const addScheduleRow = () => {
    const first = schedules[0];
    const platform = normalizeKey(first?.platform) || 'linkedin';
    const contentType = normalizeKey(first?.contentType) || getContentTypeOptions(platform)[0];
    const row: ScheduleItem = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      platform,
      contentType,
      date: first?.date || '',
      time: first?.time || '09:00',
      status: 'planned',
      title: payload?.title,
      description: payload?.description,
    };
    setSchedules((prev) => [...prev, row]);
  };

  const removeScheduleRow = (id: string) => {
    setSchedules((prev) => prev.filter((row) => row.id !== id));
  };

  const upsertVariantForSchedule = (schedule: ScheduleItem, updates: Record<string, unknown>) => {
    const next = [...platformVariants];
    const existingIndex = next.findIndex(
      (variant) =>
        normalizeKey((variant as any)?.platform) === normalizeKey(schedule.platform) &&
        normalizeKey((variant as any)?.content_type) === normalizeKey(schedule.contentType)
    );
    const base =
      existingIndex >= 0
        ? (next[existingIndex] as Record<string, unknown>)
        : ({
            platform: schedule.platform,
            content_type: schedule.contentType,
            generated_content: '',
            generation_status: 'generated',
            adapted_from_master: true,
            locked_variant: false,
          } as Record<string, unknown>);
    const merged = {
      ...base,
      platform: schedule.platform,
      content_type: schedule.contentType,
      ...updates,
    };
    if (existingIndex >= 0) {
      next[existingIndex] = merged;
    } else {
      next.push(merged);
    }
    const nextDaily = {
      ...(payload?.dailyExecutionItem || {}),
      platform_variants: next,
    };
    setPayload((prev) => (prev ? { ...prev, dailyExecutionItem: nextDaily } : prev));
  };

  const handleRefineWithAi = async (schedule: ScheduleItem) => {
    const prompt = String(refineInputByScheduleId[schedule.id] || '').trim();
    if (!prompt) {
      notify('info', 'Type refinement instruction first.');
      return;
    }
    const variant = findVariantForSchedule(schedule);
    const currentContent = String((variant as any)?.generated_content || '').trim();
    if (!currentContent) {
      notify('info', 'Generate repurposed content first.');
      return;
    }
    try {
      setIsRefiningByScheduleId((prev) => ({ ...prev, [schedule.id]: true }));
      const response = await fetch('/api/activity-workspace/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'refine_variant',
          activity: buildActivityRequestPayload(),
          schedule,
          refinement_prompt: prompt,
          current_content: currentContent,
          dailyExecutionItem: payload?.dailyExecutionItem || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.message || data?.error || 'Failed to refine content'));
      }
      const refinedContent = String(data?.refined_content || '').trim();
      if (!refinedContent) {
        throw new Error('AI returned empty refined content');
      }
      upsertVariantForSchedule(schedule, {
        generated_content: refinedContent,
        generation_status: 'generated',
        refinement_status: 'in_progress',
        refinement_finalized: false,
      });
      setRefineMessagesByScheduleId((prev) => ({
        ...prev,
        [schedule.id]: [
          ...(prev[schedule.id] || []),
          { role: 'user', content: prompt },
          { role: 'assistant', content: refinedContent },
        ],
      }));
      setRefineInputByScheduleId((prev) => ({ ...prev, [schedule.id]: '' }));
      setFinalizedByScheduleId((prev) => ({ ...prev, [schedule.id]: false }));
      updateSchedule(schedule.id, { status: 'in-progress' });
    } catch (error) {
      console.error('Refine with AI failed:', error);
      notify('error', `Failed to refine content: ${String((error as any)?.message || error)}`);
    } finally {
      setIsRefiningByScheduleId((prev) => ({ ...prev, [schedule.id]: false }));
    }
  };

  const finalizeRepurposeForSchedule = (schedule: ScheduleItem) => {
    const variant = findVariantForSchedule(schedule);
    const content = String((variant as any)?.generated_content || '').trim();
    if (!content) {
      notify('info', 'Generate content before finalizing.');
      return;
    }
    setFinalizedByScheduleId((prev) => ({ ...prev, [schedule.id]: true }));
    upsertVariantForSchedule(schedule, {
      refinement_status: 'finalized',
      refinement_finalized: true,
    });
    updateSchedule(schedule.id, { status: 'finalized' });
  };

  const scheduleFinalizedContent = (schedule: ScheduleItem) => {
    updateSchedule(schedule.id, { status: 'scheduled' });
    notify('success', `Scheduled ${labelize(schedule.platform)} ${labelize(schedule.contentType)}.`);
  };

  const saveAndSendBack = () => {
    if (workspaceKey) {
      try {
        const nextPayload = { ...(payload || {}), schedules };
        window.sessionStorage.setItem(workspaceKey, JSON.stringify(nextPayload));
      } catch (error) {
        console.warn('Failed to persist workspace payload:', error);
      }
    }
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        {
          type: 'ACTIVITY_WORKSPACE_SAVE',
          workspaceKey,
          schedules,
          dailyExecutionItem: payload?.dailyExecutionItem || null,
        },
        window.location.origin
      );
    }
    notify('success', 'Changes saved to daily planner.');
  };

  const buildActivityRequestPayload = () => {
    const primary = schedules[0];
    return {
      id: payload?.activityId || primary?.id || `workspace-${Date.now()}`,
      platform: primary?.platform || 'linkedin',
      contentType: primary?.contentType || 'post',
      topic: payload?.topic || payload?.title || '',
      title: payload?.title || payload?.topic || '',
      description: payload?.description || '',
    };
  };

  const handleGenerateMasterContent = async () => {
    try {
      setIsGeneratingMaster(true);
      const response = await fetch('/api/activity-workspace/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_master',
          activity: buildActivityRequestPayload(),
          schedules,
          dailyExecutionItem: payload?.dailyExecutionItem || null,
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

  const handleRepurposeForPlatform = async (schedule: ScheduleItem) => {
    try {
      setRepurposingByScheduleId((prev) => ({ ...prev, [schedule.id]: true }));
      const currentDaily = asObject(payload?.dailyExecutionItem) || {};
      const response = await fetch('/api/activity-workspace/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_variants',
          activity: buildActivityRequestPayload(),
          schedules: [schedule],
          dailyExecutionItem: {
            ...currentDaily,
            master_content: masterContent || currentDaily.master_content || null,
            platform_variants: platformVariants,
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.message || data?.error || 'Failed to repurpose content'));
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

  if (!isLoaded) {
    return <div className="p-6 text-gray-600">Loading activity workspace...</div>;
  }

  if (!payload) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-md w-full text-center">
          <h1 className="text-lg font-semibold text-gray-900">Workspace not found</h1>
          <p className="text-sm text-gray-600 mt-2">
            This activity workspace is missing or expired. Please open it again from Daily Planning.
          </p>
          <button
            onClick={() => window.close()}
            className="mt-4 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {notice && (
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              notice.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-indigo-200 bg-indigo-50 text-indigo-800'
            }`}
            role="status"
            aria-live="polite"
          >
            {notice.message}
          </div>
        )}
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Activity Content Workspace</h1>
            <p className="text-sm text-gray-600">
              Week {payload.weekNumber || '—'} • {payload.day || '—'} • {payload.title || 'Untitled activity'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.back()}
              className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              onClick={saveAndSendBack}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              Save Changes
            </button>
            <button
              onClick={() => window.close()}
              className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Writer Context</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-gray-500">Topic</div>
              <div className="text-gray-900">{payload.topic || payload.title || '—'}</div>
            </div>
            <div>
              <div className="text-gray-500">Objective</div>
              <div className="text-gray-900">{String(intent?.objective || writerBrief?.topicGoal || '—')}</div>
            </div>
            <div>
              <div className="text-gray-500">What reader should learn</div>
              <div className="text-gray-900">{effectiveWhatReaderLearns}</div>
            </div>
            <div>
              <div className="text-gray-500">Problem addressed</div>
              <div className="text-gray-900">{effectiveProblemAddressed}</div>
            </div>
            <div>
              <div className="text-gray-500">Desired action</div>
              <div className="text-gray-900">{String(writerBrief?.desiredAction || intent?.cta_type || '—')}</div>
            </div>
            <div>
              <div className="text-gray-500">Narrative style</div>
              <div className="text-gray-900">{String(writerBrief?.narrativeStyle || '—')}</div>
            </div>
          </div>
          {payload.description && (
            <div>
              <div className="text-gray-500 text-sm">Current activity brief</div>
              <div className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{payload.description}</div>
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Content Inputs by Platform</h2>
            <button
              onClick={handleGenerateMasterContent}
              disabled={isGeneratingMaster}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
            >
              {isGeneratingMaster ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {hasMasterGenerated ? 'Regenerate Master Content' : 'Create Master Content'}
            </button>
          </div>
          {!hasMasterGenerated && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Create master content first, then use per-platform Repurpose Content buttons below.
            </div>
          )}
          {isHydratingContext && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              Syncing matching weekly/daily details for this title...
            </div>
          )}
          <p className="text-sm text-gray-600">
            Repurposed output will appear under each platform schedule inside Master Content Reference.
          </p>

          {masterContent && (
            <div className="rounded-lg border border-gray-200 p-3 bg-indigo-50">
              <div className="text-sm font-medium text-indigo-900">Master Content Reference</div>
              <p className="text-sm text-indigo-800 whitespace-pre-wrap mt-2">
                {String(masterContent.content || '')}
              </p>
            </div>
          )}

          <div className="rounded-lg border border-gray-200 p-3 bg-gray-50 mt-3">
            <div className="text-sm font-medium text-gray-900 mb-2">
              {masterContent ? 'Platform Schedules (linked to this master content)' : 'Platform Schedules'}
            </div>
            <div className="mb-3">
              <button
                type="button"
                onClick={addScheduleRow}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Content Format (white paper, video, carousel...)
              </button>
            </div>
            {schedules.length === 0 ? (
              <p className="text-sm text-gray-600">No platform schedule rows. Add one above to set platform, format, date/time and repurpose content.</p>
            ) : (
              <div className="space-y-3">
                {schedules.map((item) => {
                      const matchedVariant = findVariantForSchedule(item);
                      const marketing = buildMarketingSupport(
                        item.platform,
                        item.contentType,
                        String((matchedVariant as any)?.generated_content || ''),
                        matchedVariant
                      );
                      return (
                      <div key={item.id} className="rounded-lg border border-indigo-200 p-3 bg-white">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {finalizedByScheduleId[item.id] && (
                              <button
                                type="button"
                                onClick={() => scheduleFinalizedContent(item)}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Schedule
                              </button>
                            )}
                            <select
                              value={item.platform}
                              onChange={(e) => {
                                const nextPlatform = normalizeKey(e.target.value);
                                const allowed = getContentTypeOptions(nextPlatform);
                                const nextType = allowed.includes(normalizeKey(item.contentType))
                                  ? normalizeKey(item.contentType)
                                  : allowed[0];
                                updateSchedule(item.id, {
                                  platform: nextPlatform,
                                  contentType: nextType,
                                });
                              }}
                              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                            >
                              {platformOptions.map((p) => (
                                <option key={p} value={p}>
                                  {labelize(p)}
                                </option>
                              ))}
                            </select>
                            <select
                              value={item.contentType}
                              onChange={(e) => updateSchedule(item.id, { contentType: normalizeKey(e.target.value) })}
                              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                            >
                              {getContentTypeOptions(item.platform).map((ct) => (
                                <option key={ct} value={ct}>
                                  {labelize(ct)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleRepurposeForPlatform(item)}
                              disabled={!hasMasterGenerated || !!repurposingByScheduleId[item.id]}
                              title={!hasMasterGenerated ? 'Create master content first' : undefined}
                              className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
                            >
                              {repurposingByScheduleId[item.id] ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Sparkles className="h-3.5 w-3.5" />
                              )}
                              Repurpose Content
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setShowRefineByScheduleId((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                              }
                              disabled={!matchedVariant}
                              className="inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              Refine with AI
                            </button>
                            <button
                              type="button"
                              onClick={() => finalizeRepurposeForSchedule(item)}
                              disabled={!matchedVariant || !!isRefiningByScheduleId[item.id]}
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Finalize
                            </button>
                            <button
                              type="button"
                              onClick={() => removeScheduleRow(item.id)}
                              disabled={schedules.length <= 1}
                              className="rounded-lg border border-red-200 p-1.5 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                              title="Remove format row"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <label className="text-xs text-gray-600">
                            Date
                            <input
                              type="date"
                              value={item.date || ''}
                              onChange={(e) => updateSchedule(item.id, { date: e.target.value })}
                              className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                            />
                          </label>
                          <label className="text-xs text-gray-600">
                            Time
                            <input
                              type="time"
                              value={item.time || '09:00'}
                              onChange={(e) => updateSchedule(item.id, { time: e.target.value })}
                              className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                            />
                          </label>
                        </div>
                        <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
                          <div className="text-xs font-semibold text-gray-700">Repurposed Output</div>
                          {!matchedVariant ? (
                            <p className="text-xs text-gray-500">
                              No repurposed content yet. Click Repurpose Content.
                            </p>
                          ) : (
                            <>
                              {showRefineByScheduleId[item.id] && (
                                <div className="rounded-lg border border-violet-200 bg-violet-50 p-2">
                                  <div className="text-[11px] font-semibold text-violet-800 mb-2">
                                    AI Refinement Chat
                                  </div>
                                  <div className="space-y-1 max-h-36 overflow-y-auto mb-2">
                                    {(refineMessagesByScheduleId[item.id] || []).length === 0 ? (
                                      <div className="text-[11px] text-violet-700">
                                        Ask AI to refine tone, hook, CTA, structure, or platform fit.
                                      </div>
                                    ) : (
                                      (refineMessagesByScheduleId[item.id] || []).map((msg, idx) => (
                                        <div
                                          key={`${item.id}-msg-${idx}`}
                                          className={`rounded px-2 py-1 text-[11px] ${
                                            msg.role === 'user'
                                              ? 'bg-white border border-violet-200 text-violet-900'
                                              : 'bg-indigo-100 border border-indigo-200 text-indigo-900'
                                          }`}
                                        >
                                          <span className="font-semibold mr-1">{msg.role === 'user' ? 'You:' : 'AI:'}</span>
                                          {msg.content}
                                        </div>
                                      ))
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="text"
                                      value={refineInputByScheduleId[item.id] || ''}
                                      onChange={(e) =>
                                        setRefineInputByScheduleId((prev) => ({ ...prev, [item.id]: e.target.value }))
                                      }
                                      placeholder="e.g., Make it sharper for executives and stronger CTA"
                                      className="flex-1 rounded border border-violet-300 bg-white px-2 py-1 text-xs text-gray-700"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleRefineWithAi(item)}
                                      disabled={!!isRefiningByScheduleId[item.id]}
                                      className="inline-flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                                    >
                                      {isRefiningByScheduleId[item.id] ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Sparkles className="h-3.5 w-3.5" />
                                      )}
                                      Refine
                                    </button>
                                  </div>
                                </div>
                              )}
                              <div className="text-[11px] text-gray-600">
                                Utilization: content {marketing.utilization.contentPct ?? '—'}% (target 90%), title {marketing.utilization.titlePct ?? '—'}%, meta {marketing.utilization.metaDescriptionPct ?? '—'}%, hashtags {marketing.utilization.hashtagsPct ?? '—'}%, keywords {marketing.utilization.keywordsPct ?? '—'}%
                              </div>
                              <textarea
                                className="w-full min-h-[120px] rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700"
                                value={String((matchedVariant as any)?.generated_content || '')}
                                onChange={(e) => {
                                  const next = [...platformVariants];
                                  const existingIndex = next.findIndex(
                                    (variant) =>
                                      normalizeKey((variant as any)?.platform) === normalizeKey(item.platform) &&
                                      normalizeKey((variant as any)?.content_type) === normalizeKey(item.contentType)
                                  );
                                  const nextVariant = {
                                    ...(matchedVariant as any),
                                    platform: item.platform,
                                    content_type: item.contentType,
                                    generated_content: e.target.value,
                                  };
                                  if (existingIndex >= 0) {
                                    next[existingIndex] = nextVariant;
                                  } else {
                                    next.push(nextVariant);
                                  }
                                  const nextDaily = {
                                    ...(payload.dailyExecutionItem || {}),
                                    platform_variants: next,
                                  };
                                  setPayload((prev) => (prev ? { ...prev, dailyExecutionItem: nextDaily } : prev));
                                }}
                              />
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                                <div className="rounded border border-gray-200 bg-gray-50 p-2">
                                  <div className="font-semibold text-gray-700">Title</div>
                                  <div className="text-gray-600 mt-1">{marketing.title || '—'}</div>
                                </div>
                                <div className="rounded border border-gray-200 bg-gray-50 p-2">
                                  <div className="font-semibold text-gray-700">Meta Title</div>
                                  <div className="text-gray-600 mt-1">{marketing.metaTitle || '—'}</div>
                                </div>
                                <div className="rounded border border-gray-200 bg-gray-50 p-2 md:col-span-2">
                                  <div className="font-semibold text-gray-700">Meta Description</div>
                                  <div className="text-gray-600 mt-1">{marketing.metaDescription || '—'}</div>
                                </div>
                                <div className="rounded border border-gray-200 bg-gray-50 p-2">
                                  <div className="font-semibold text-gray-700">Hashtags</div>
                                  <div className="text-gray-600 mt-1 break-words">{marketing.hashtags.join(' ') || '—'}</div>
                                </div>
                                <div className="rounded border border-gray-200 bg-gray-50 p-2">
                                  <div className="font-semibold text-gray-700">Keywords</div>
                                  <div className="text-gray-600 mt-1 break-words">{marketing.keywords.join(', ') || '—'}</div>
                                </div>
                                <div className="rounded border border-gray-200 bg-gray-50 p-2 md:col-span-2">
                                  <div className="font-semibold text-gray-700">Platform CTA / Marketing Support</div>
                                  <div className="text-gray-600 mt-1">{marketing.cta}</div>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )})}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

