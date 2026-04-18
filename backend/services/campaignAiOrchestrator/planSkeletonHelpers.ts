import type { DeliverableType, PlanDeliverables, PlanSkeleton } from './types';

export function normalizeDeliverableType(raw: string): DeliverableType | null {
  const n = raw.toLowerCase().trim();
  if (!n) return null;
  if (/(^|\b)(video|videos|reel|reels)(\b|$)/.test(n)) return 'video';
  if (/(^|\b)(blog|blogs|article|articles|white\s*papers?|white_papers?)(\b|$)/.test(n)) return 'blog';
  if (/(^|\b)(carousel|carousels)(\b|$)/.test(n)) return 'carousel';
  if (/(^|\b)(story|stories)(\b|$)/.test(n)) return 'story';
  if (/(^|\b)(thread|threads)(\b|$)/.test(n)) return 'thread';
  if (/(^|\b)(short|shorts)(\b|$)/.test(n)) return 'short';
  if (/(^|\b)(post|posts)(\b|$)/.test(n)) return 'post';
  return null;
}

export function parseContentCapacityToDeliverables(contentCapacity: unknown): PlanDeliverables {
  const emptyDeliverables: PlanDeliverables = { videos: 0, posts: 0, blogs: 0, stories: 0 };
  const text = String(contentCapacity ?? '').trim();
  if (!text) {
    return { videos: 2, posts: 5, blogs: 1, stories: 0 };
  }

  const counters = new Map<DeliverableType, number>();
  const patterns: RegExp[] = [
    /([a-zA-Z_ ]+)\s*:\s*(\d{1,2})\s*\/\s*week/gi,
    /(\d{1,2})\s*([a-zA-Z_ ]+?)(?:\s*\/\s*week|\s+per\s+week|\b)/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(text)) !== null) {
      const a = match[1] ?? '';
      const b = match[2] ?? '';
      const maybeCount = Number(a);
      const count = Number.isFinite(maybeCount) ? maybeCount : Number(b);
      const label = Number.isFinite(maybeCount) ? b : a;
      const type = normalizeDeliverableType(label);
      if (!type || !Number.isFinite(count) || count <= 0) continue;
      counters.set(type, (counters.get(type) ?? 0) + count);
    }
  }

  if (counters.size === 0) {
    return { videos: 2, posts: 5, blogs: 1, stories: 0 };
  }
  const out = { ...emptyDeliverables };
  out.videos = counters.get('video') ?? 0;
  out.posts = counters.get('post') ?? 0;
  out.blogs = counters.get('blog') ?? 0;
  out.stories = counters.get('story') ?? 0;
  return out;
}

export function buildDeterministicPlanSkeleton(params: {
  durationWeeks: number;
  contentCapacity?: unknown;
}): PlanSkeleton {
  const requiredDeliverables = parseContentCapacityToDeliverables(params.contentCapacity);
  const weeklySlots = Array.from({ length: params.durationWeeks }, (_, idx) => ({
    weekNumber: idx + 1,
    requiredDeliverables,
  }));
  return {
    durationWeeks: params.durationWeeks,
    weeklySlots,
  };
}

export function sumSkeletonDeliverables(deliverables: PlanDeliverables): number {
  return (
    (Number(deliverables.videos) || 0) +
    (Number(deliverables.posts) || 0) +
    (Number(deliverables.blogs) || 0) +
    (Number(deliverables.stories) || 0)
  );
}

export function deliverablesToArray(deliverables: PlanDeliverables): Array<{ type: DeliverableType; count: number }> {
  const arr: Array<{ type: DeliverableType; count: number }> = [];
  if ((deliverables.videos ?? 0) > 0) arr.push({ type: 'video', count: deliverables.videos });
  if ((deliverables.posts ?? 0) > 0) arr.push({ type: 'post', count: deliverables.posts });
  if ((deliverables.blogs ?? 0) > 0) arr.push({ type: 'blog', count: deliverables.blogs });
  if ((deliverables.stories ?? 0) > 0) arr.push({ type: 'story', count: deliverables.stories ?? 0 });
  return arr;
}

export function normalizeDeliverableCountsBySkeletonTypes(counts: Record<string, number>): PlanDeliverables {
  return {
    videos: counts.video ?? 0,
    posts: counts.post ?? 0,
    blogs: counts.blog ?? 0,
    stories: counts.story ?? 0,
  };
}

export function hasMatchingDeliverables(actual: PlanDeliverables, expected: PlanDeliverables): boolean {
  return (
    (actual.videos ?? 0) === (expected.videos ?? 0) &&
    (actual.posts ?? 0) === (expected.posts ?? 0) &&
    (actual.blogs ?? 0) === (expected.blogs ?? 0) &&
    (actual.stories ?? 0) === (expected.stories ?? 0)
  );
}

export function extractWeekDeliverableCounts(week: any): Record<string, number> {
  const out: Record<string, number> = {};
  const breakdown = week?.platform_content_breakdown as Record<string, Array<{ type?: string; count?: number }>> | undefined;
  if (breakdown && typeof breakdown === 'object') {
    Object.values(breakdown).forEach((items) => {
      if (!Array.isArray(items)) return;
      items.forEach((item) => {
        const type = normalizeDeliverableType(String(item?.type ?? ''));
        const count = Number(item?.count ?? 0);
        if (!type || !Number.isFinite(count) || count <= 0) return;
        out[type] = (out[type] ?? 0) + count;
      });
    });
  }
  return out;
}

export function validatePlanAgainstSkeleton(plan: { weeks: any[] }, skeleton: PlanSkeleton): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!Array.isArray(plan?.weeks)) {
    return { ok: false, reasons: ['Plan has no weeks array'] };
  }

  if (plan.weeks.length !== skeleton.durationWeeks) {
    reasons.push(`Expected ${skeleton.durationWeeks} weeks, got ${plan.weeks.length}`);
  }

  const weekNumbers = new Set(plan.weeks.map((w) => Number(w?.week)));
  for (let i = 1; i <= skeleton.durationWeeks; i++) {
    if (!weekNumbers.has(i)) reasons.push(`Missing week ${i}`);
  }

  const slotByWeek = new Map(skeleton.weeklySlots.map((s) => [s.weekNumber, s]));
  for (const week of plan.weeks) {
    const weekNo = Number(week?.week);
    const slot = slotByWeek.get(weekNo);
    if (!slot) {
      reasons.push(`Unexpected week ${weekNo}`);
      continue;
    }
    const expectedTotal = sumSkeletonDeliverables(slot.requiredDeliverables);
    const actualTotal = Number(week?.total_weekly_content_count ?? 0);
    if (actualTotal !== expectedTotal) {
      reasons.push(`Week ${weekNo}: expected total ${expectedTotal}, got ${actualTotal}`);
    }

    const actualByType = normalizeDeliverableCountsBySkeletonTypes(extractWeekDeliverableCounts(week));
    if ((week?.primary_objective ?? '').toString().trim().length === 0) {
      reasons.push(`Week ${weekNo}: missing objective`);
    }
    if ((week?.theme ?? '').toString().trim().length === 0) {
      reasons.push(`Week ${weekNo}: missing topic focus`);
    }
    if (!week?.platform_allocation || typeof week.platform_allocation !== 'object' || Object.keys(week.platform_allocation).length === 0) {
      reasons.push(`Week ${weekNo}: missing platform hints`);
    }
    if (week?.platform_content_breakdown && typeof week.platform_content_breakdown === 'object') {
      if (!hasMatchingDeliverables(actualByType, slot.requiredDeliverables)) {
        reasons.push(
          `Week ${weekNo}: deliverables mismatch expected=${JSON.stringify(slot.requiredDeliverables)} actual=${JSON.stringify(actualByType)}`
        );
      }
    }
  }

  return { ok: reasons.length === 0, reasons };
}

export function buildPlaceholderPlanFromSkeleton(params: {
  skeleton: PlanSkeleton;
  prefilledPlanning?: Record<string, unknown> | null;
}): { weeks: any[] } {
  const platformHints =
    String(params.prefilledPlanning?.platforms ?? '')
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean) || [];

  const normalizeList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.map((v) => String(v ?? '').trim()).filter(Boolean);
  };
  const recommendedTopics = normalizeList(params.prefilledPlanning?.recommended_topics);
  const strategicThemes = normalizeList(params.prefilledPlanning?.strategic_themes);
  const keyMessages = String(params.prefilledPlanning?.key_messages ?? '').trim();
  const audience = String(params.prefilledPlanning?.target_audience ?? '').trim();
  const campaignTypes = String(params.prefilledPlanning?.campaign_types ?? '').trim();
  const primaryIntent = campaignTypes || 'campaign objective';
  const fallbackThemeSeed =
    strategicThemes[0] ||
    recommendedTopics[0] ||
    String(params.prefilledPlanning?.theme_or_description ?? '').trim() ||
    (keyMessages ? `Address ${keyMessages}` : '');

  const buildWeekTopicSet = (weekNo: number): string[] => {
    const pickedTopic = recommendedTopics[(weekNo - 1) % Math.max(1, recommendedTopics.length)] || '';
    const pickedTheme = strategicThemes[(weekNo - 1) % Math.max(1, strategicThemes.length)] || '';
    const seed = pickedTopic || pickedTheme || fallbackThemeSeed || `Week ${weekNo} focus`;
    const topics = [
      seed,
      keyMessages ? `Problem focus: ${keyMessages}` : `Problem focus for week ${weekNo}`,
      audience ? `Audience angle: ${audience}` : `Audience angle for week ${weekNo}`,
    ].filter(Boolean);
    return topics;
  };

  return {
    weeks: params.skeleton.weeklySlots.map((slot) => {
      const total = sumSkeletonDeliverables(slot.requiredDeliverables);
      const allocation: Record<string, number> = {};
      if (platformHints.length > 0) {
        const base = Math.floor(total / platformHints.length);
        let rem = total % platformHints.length;
        for (const p of platformHints) {
          allocation[p] = base + (rem > 0 ? 1 : 0);
          if (rem > 0) rem -= 1;
        }
      } else {
        allocation.linkedin = total;
      }

      const deliverablesArray = deliverablesToArray(slot.requiredDeliverables);
      const contentMix = deliverablesArray.map((d) => `${d.count} ${d.type}`);
      const weekTopics = buildWeekTopicSet(slot.weekNumber);
      const weekTheme = weekTopics[0] || `Week ${slot.weekNumber} focus`;
      const weekObjective =
        `Advance ${primaryIntent}` +
        (audience ? ` for ${audience}` : '') +
        ` using week ${slot.weekNumber} deliverables.`;
      const breakdownForPrimary = deliverablesArray.map((d) => ({
        type: d.type,
        count: d.count,
        topics: Array.from({ length: d.count }, (_, idx) => weekTopics[idx % weekTopics.length]),
      }));
      const primaryPlatform = Object.keys(allocation)[0] || 'linkedin';

      return {
        week: slot.weekNumber,
        phase_label: 'Audience Activation',
        primary_objective: weekObjective,
        platform_allocation: allocation,
        content_type_mix: contentMix,
        cta_type: 'Soft CTA',
        total_weekly_content_count: total,
        weekly_kpi_focus: 'Reach growth',
        theme: weekTheme,
        topics_to_cover: weekTopics,
        platform_content_breakdown: {
          [primaryPlatform]: breakdownForPrimary,
        },
        week_extras: {
          objective: weekObjective,
          topic_focus: weekTheme,
          deliverables_list: deliverablesArray,
          platform_hints: Object.keys(allocation),
          weekNumber: slot.weekNumber,
          deliverables: slot.requiredDeliverables,
        },
      };
    }),
  };
}
