type RecommendationContextLike = {
  target_regions?: string[] | null;
  context_payload?: Record<string, unknown> | null;
  source_opportunity_id?: string | null;
} | null | undefined;

type PlatformContentTypePrefs = Record<string, string[]>;

export function toValidWeeks(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.floor(value);
    return n >= 1 && n <= 52 ? n : null;
  }
  const text = String(value ?? '').trim();
  if (!text) return null;
  const match = text.match(/\b(\d{1,2})\s*(?:week|weeks)\b/i) ?? text.match(/\b(\d{1,2})\b/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n >= 1 && n <= 52 ? n : null;
}

export function getNextMondayISO(): string {
  const d = new Date();
  const dow = d.getUTCDay();
  const daysToAdd = dow === 0 ? 1 : dow === 1 ? 0 : 8 - dow;
  const target = new Date(d);
  target.setUTCDate(d.getUTCDate() + daysToAdd);
  return target.toISOString().slice(0, 10);
}

export function recommendationDurationSeed(ctx: RecommendationContextLike): number | null {
  const payload = (ctx?.context_payload ?? {}) as Record<string, unknown>;
  return (
    toValidWeeks(payload.duration_weeks) ??
    toValidWeeks(payload.campaign_duration) ??
    toValidWeeks(payload.recommended_duration_weeks)
  );
}

export function detectAskedKeyFromAiMessage(aiMessage: string): string | null {
  const n = String(aiMessage ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!n) return null;
  if (n.includes('target audience') || n.includes('who will see your content')) return 'target_audience';
  if ((n.includes('which professionals') && n.includes('mainly speaking')) || n.includes('which group fits')) return 'audience_professional_segment';
  if (n.includes('how do you want your content to sound') || n.includes('how should your posts sound')) return 'communication_style';
  if ((n.includes('after reading your content') && n.includes('what should people do')) || n.includes('what do you want people to do after')) return 'action_expectation';
  if (
    n.includes('same content across all platforms') ||
    (n.includes('shared') && n.includes('unique')) ||
    n.includes('unique content for each platform') ||
    (n.includes('shared') && n.includes('platform')) ||
    (n.includes('unique') && n.includes('platform'))
  )
    return 'cross_platform_sharing';
  if (n.includes('short easy reads') || (n.includes('detailed insights') && n.includes('short')) || n.includes('short reads or longer') || n.includes('longer pieces')) return 'content_depth';
  if (n.includes('connected series') && n.includes('mostly independent')) return 'topic_continuity';
  if (n.includes('ongoing story') || n.includes('different topics each time')) return 'topic_continuity';
  if (n.includes('existing content') || n.includes('do you have any existing content')) return 'available_content';
  if (n.includes('which category') || n.includes('which specific week') || n.includes('should it serve')) return 'available_content_allocation';
  if ((n.includes('start') && n.includes('campaign')) || n.includes('yy-mm-dd') || (n.includes('start') && n.includes('date')) || n.includes('when do you want to start')) return 'tentative_start';
  if (n.includes('campaign types') || n.includes("what's the main goal")) return 'campaign_types';
  if (
    n.includes('produce per week') ||
    n.includes('produce each week') ||
    n.includes('production capacity') ||
    n.includes('weekly production capacity') ||
    n.includes('content capacity') ||
    n.includes('how much content') ||
    n.includes('how will you create') ||
    n.includes('how many pieces per week') ||
    (n.includes('how many') && n.includes('per week') && (n.includes('posts') || n.includes('videos') || n.includes('blogs'))) ||
    n.includes('how many can you create per week') ||
    n.includes('how many can you and your team create every week')
  )
    return 'content_capacity';
  if (
    (n.includes('duration') && n.includes('campaign')) ||
    (n.includes('how many') && n.includes('week')) ||
    n.includes('campaign run') ||
    n.includes('duration') ||
    n.includes('how many weeks') ||
    /2[, ]*4[, ]*6[, ]*8[, ]*12\s*weeks/i.test(n)
  )
    return 'campaign_duration';
  if (n.includes('which platforms') || n.includes('platforms will you focus') || n.includes('where will you post')) return 'platforms';
  if (n.includes('platform-exclusive campaigns') || n.includes('only for one platform') || n.includes('anything only for one platform')) return 'exclusive_campaigns';
  if (n.includes('content types') && n.includes('count per week')) return 'platform_content_requests';
  if (n.includes('how many of each type per week')) return 'platform_content_requests';
  if (n.includes('set how often') || n.includes('same topic across platforms') || n.includes('publish same day on all platforms') || n.includes('let AI decide')) return 'platform_content_requests';
  if (n.includes('content types') && n.includes('platform')) return 'platform_content_types';
  if (n.includes('what will you post on each') || n.includes('which content types will you use') || n.includes('for each platform you selected')) return 'platform_content_types';
  if (n.includes('key messages') || n.includes('pain points') || n.includes('one thing you want people to remember') || n.includes('core message') || n.includes('audience to remember')) return 'key_messages';
  if (n.includes('success metrics') || (n.includes('metrics') && n.includes('track')) || n.includes('like to see improve')) return 'success_metrics';
  return null;
}

export function extractPlanningContextFromHistory(
  history: Array<{ type: string; message: string }> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const historyArr = Array.isArray(history) ? history : [];
  const pairs: Array<{ ai: string; user: string }> = [];
  for (let i = 0; i < historyArr.length - 1; i += 1) {
    const curr = historyArr[i];
    const next = historyArr[i + 1];
    if (curr?.type === 'ai' && next?.type === 'user') {
      pairs.push({ ai: String(curr?.message ?? ''), user: String(next?.message ?? '').trim() });
    }
  }
  for (const pair of pairs) {
    const key = detectAskedKeyFromAiMessage(pair.ai);
    if (!key || !pair.user) continue;
    out[key] = pair.user;
  }
  return out;
}

export function mapRecommendationContextToGatherKeys(
  ctx: RecommendationContextLike
): Record<string, unknown> {
  if (!ctx) return {};
  const payload = (ctx.context_payload ?? {}) as Record<string, unknown>;
  const mapped: Record<string, unknown> = {};

  const audience =
    payload.target_audience ??
    payload.audience ??
    payload.ideal_customer_profile ??
    payload.icp;
  if (typeof audience === 'string' && audience.trim()) {
    mapped.target_audience = audience.trim();
  }

  const keyMessages =
    payload.key_messages ??
    payload.problem ??
    payload.problem_statement ??
    payload.angle ??
    payload.transformation ??
    payload.positioning;
  if (typeof keyMessages === 'string' && keyMessages.trim()) {
    mapped.key_messages = keyMessages.trim();
  }

  const suggestedPlatforms = payload.platforms;
  if (Array.isArray(suggestedPlatforms) && suggestedPlatforms.length > 0) {
    mapped.platforms = suggestedPlatforms.map((p) => String(p).trim()).filter(Boolean).join(', ');
  }

  const strategicThemes = payload.strategic_themes ?? payload.themes;
  if (Array.isArray(strategicThemes) && strategicThemes.length > 0) {
    mapped.strategic_themes = strategicThemes.map((t) => String(t ?? '').trim()).filter(Boolean);
  }
  const progressionSummary = payload.progression_summary ?? payload.progressionSummary;
  if (typeof progressionSummary === 'string' && progressionSummary.trim()) {
    mapped.strategic_theme_progression = progressionSummary.trim();
  }
  const themeDurationWeeks = payload.duration_weeks ?? payload.durationWeeks;
  if (typeof themeDurationWeeks === 'number' && Number.isFinite(themeDurationWeeks)) {
    mapped.strategic_theme_duration_weeks = themeDurationWeeks;
  }
  const themeIntelligence = payload.intelligence ?? payload.recommendation_intelligence;
  if (themeIntelligence && typeof themeIntelligence === 'object' && !Array.isArray(themeIntelligence)) {
    mapped.strategic_theme_intelligence = themeIntelligence;
  }

  return mapped;
}

export function buildCompanyContextBlock(
  profile: any,
  buildMode: string,
  contextScope: string[] | null
): string | null {
  if (!profile) return null;
  if (buildMode === 'no_context') return null;

  const sections: string[] = [];
  if (buildMode === 'full_context') {
    sections.push('commercial_strategy', 'marketing_intelligence', 'campaign_purpose', 'brand_positioning', 'competitive_advantages', 'growth_priorities');
  } else if (buildMode === 'focused_context' && contextScope && contextScope.length > 0) {
    sections.push(...contextScope);
  } else {
    return null;
  }

  const parts: string[] = [];
  const commercialFields = ['target_customer_segment', 'ideal_customer_profile', 'pricing_model', 'sales_motion', 'avg_deal_size', 'sales_cycle', 'key_metrics'];
  const marketingFields = ['marketing_channels', 'content_strategy', 'campaign_focus', 'key_messages', 'brand_positioning', 'competitive_advantages', 'growth_priorities'];

  if (sections.includes('commercial_strategy')) {
    const commercial = commercialFields.map((f) => (profile[f] ? `${f}: ${profile[f]}` : null)).filter(Boolean);
    if (commercial.length) parts.push(`Commercial Strategy:\n${commercial.join('\n')}`);
  }
  if (sections.includes('marketing_intelligence')) {
    const marketing = marketingFields.map((f) => (profile[f] ? `${f}: ${profile[f]}` : null)).filter(Boolean);
    if (marketing.length) parts.push(`Marketing Intelligence:\n${marketing.join('\n')}`);
  }
  if (sections.includes('campaign_purpose') && profile.campaign_purpose_intent) {
    parts.push(`Campaign Purpose:\n${JSON.stringify(profile.campaign_purpose_intent)}`);
  }
  if (sections.includes('brand_positioning') && profile.brand_positioning) {
    parts.push(`Brand Positioning: ${profile.brand_positioning}`);
  }
  if (sections.includes('competitive_advantages') && profile.competitive_advantages) {
    parts.push(`Competitive Advantages: ${profile.competitive_advantages}`);
  }
  if (sections.includes('growth_priorities') && profile.growth_priorities) {
    parts.push(`Growth Priorities: ${profile.growth_priorities}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

export function buildPrefilledPlanning(input: {
  campaign: { start_date?: string | null; duration_weeks?: number | null; description?: string | null; name?: string } | null;
  versionRow: {
    campaign_types?: string[];
    campaign_weights?: Record<string, number>;
    campaign_snapshot?: { planning_context?: { content_capacity?: Record<string, { perWeek?: number; creationMethod?: string }> }; target_regions?: string[]; context_payload?: { formats?: string[]; platforms?: string[] } };
  } | null;
}): Record<string, unknown> {
  const prefilled: Record<string, unknown> = {};
  const c = input.campaign;
  const v = input.versionRow;
  if (c?.start_date) prefilled.tentative_start = c.start_date;
  if (c?.duration_weeks != null) prefilled.campaign_duration = c.duration_weeks;
  if (v?.campaign_types?.length) {
    prefilled.campaign_types = v.campaign_types.map((t) => t.replace(/_/g, ' ')).join(', ');
  }
  if (v?.campaign_snapshot?.planning_context?.content_capacity) {
    const cap = v.campaign_snapshot.planning_context.content_capacity;
    const parts: string[] = [];
    for (const [fmt, val] of Object.entries(cap)) {
      if (val && typeof val === 'object' && 'perWeek' in val) {
        const p = val as { perWeek?: number; creationMethod?: string };
        parts.push(`${fmt}: ${p.perWeek ?? 0}/week (${p.creationMethod ?? 'manual'})`);
      }
    }
    if (parts.length) prefilled.content_capacity = parts.join('; ');
  }
  const payload = v?.campaign_snapshot?.context_payload;
  if (payload?.formats?.length) prefilled.suggested_formats = payload.formats.join(', ');
  if (payload?.platforms?.length) prefilled.platforms = payload.platforms.join(', ');
  if (v?.campaign_snapshot?.target_regions?.length) {
    prefilled.target_regions = v.campaign_snapshot.target_regions.join(', ');
  }
  if (c?.description) prefilled.theme_or_description = c.description.slice(0, 300);
  const execConfig = (v?.campaign_snapshot as Record<string, unknown> | undefined)?.execution_config;
  if (execConfig != null && typeof execConfig === 'object' && !Array.isArray(execConfig)) {
    prefilled.execution_config = execConfig;
  }
  return prefilled;
}

function normalizePlatformKeyStrict(raw: string): string | null {
  const n = String(raw || '').toLowerCase().trim();
  if (!n) return null;
  if (n === 'twitter') return 'x';
  if (n === 'x') return 'x';
  if (n === 'linkedin') return 'linkedin';
  if (n === 'facebook') return 'facebook';
  if (n === 'instagram') return 'instagram';
  if (n === 'youtube') return 'youtube';
  if (n === 'tiktok') return 'tiktok';
  return null;
}

function normalizeContentTypeToken(raw: string): string | null {
  const n = String(raw || '').toLowerCase().trim();
  if (!n) return null;
  if (n.includes('blog') || n.includes('article')) return 'article';
  if (n.includes('slide')) return 'slideware';
  if (n.includes('carousel')) return 'carousel';
  if (n.includes('image')) return 'image';
  if (n.includes('song') || n.includes('audio')) return 'song';
  if (n.includes('thread')) return 'thread';
  if (n.includes('space')) return 'space';
  if (n.includes('short')) return 'short';
  if (n.includes('live')) return 'live';
  if (n.includes('reel')) return 'reel';
  if (n.includes('story')) return 'story';
  if (n.includes('video')) return 'video';
  if (n.includes('post')) return 'post';
  return n.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || null;
}

export function parsePlatformContentTypesValue(value: unknown): PlatformContentTypePrefs | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return null;
    if (t.startsWith('{') && t.endsWith('}')) {
      try {
        const obj = JSON.parse(t) as unknown;
        if (obj && typeof obj === 'object') {
          const out: PlatformContentTypePrefs = {};
          for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            const pk = normalizePlatformKeyStrict(k);
            if (!pk || !Array.isArray(v)) continue;
            const items = Array.from(new Set(v.map((x) => normalizeContentTypeToken(String(x))).filter(Boolean) as string[]));
            if (items.length > 0) out[pk] = items;
          }
          return Object.keys(out).length > 0 ? out : null;
        }
      } catch {
        // fall through
      }
    }
    const rx = /(linkedin|facebook|instagram|youtube|tiktok|twitter|x)\s*:\s*([^;]+)/gi;
    const out: PlatformContentTypePrefs = {};
    let m: RegExpExecArray | null = null;
    while ((m = rx.exec(t)) !== null) {
      const pk = normalizePlatformKeyStrict(m[1]);
      if (!pk) continue;
      const rhs = String(m[2] || '').trim();
      const tokens = rhs.split(/[,/|]+/).map((s) => normalizeContentTypeToken(s)).filter(Boolean) as string[];
      const uniq = Array.from(new Set(tokens));
      if (uniq.length > 0) out[pk] = uniq;
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  if (typeof value === 'object') {
    const out: PlatformContentTypePrefs = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const pk = normalizePlatformKeyStrict(k);
      if (!pk || !Array.isArray(v)) continue;
      const items = Array.from(new Set(v.map((x) => normalizeContentTypeToken(String(x))).filter(Boolean) as string[]));
      if (items.length > 0) out[pk] = items;
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  return null;
}

export function extractPlatformContentTypesFromConversation(
  history: Array<{ type: string; message: string }> | undefined
): PlatformContentTypePrefs | null {
  if (!Array.isArray(history) || history.length === 0) return null;
  const recent = [...history].slice(-60);
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    if (m?.type !== 'user') continue;
    const text = String(m.message ?? '').trim();
    if (!text) continue;
    if (!/:\s*/.test(text)) continue;
    if (!/(linkedin|facebook|instagram|youtube|tiktok|twitter|\bx\b)/i.test(text)) continue;
    const parsed = parsePlatformContentTypesValue(text);
    if (parsed) return parsed;
  }
  return null;
}

export function applyPlatformContentTypePrefsToWeeks(
  weeks: any[],
  prefs: PlatformContentTypePrefs
): any[] {
  if (!Array.isArray(weeks) || weeks.length === 0) return weeks;
  if (!prefs || Object.keys(prefs).length === 0) return weeks;

  const unionTypes = Array.from(
    new Set(Object.values(prefs).flat().map((t) => normalizeContentTypeToken(t)).filter(Boolean) as string[])
  );

  const hasNonEmptyBreakdown = (w: any): boolean => {
    const b = w?.platform_content_breakdown;
    if (!b || typeof b !== 'object') return false;
    return Object.values(b).some((arr: any) => Array.isArray(arr) && arr.length > 0);
  };

  return weeks.map((w: any) => {
    const next = { ...w };

    const mix = Array.isArray(next.content_type_mix) ? next.content_type_mix.filter(Boolean) : [];
    if (mix.length === 0 && unionTypes.length > 0) {
      next.content_type_mix = unionTypes;
    }

    if (!hasNonEmptyBreakdown(next)) {
      const allocation: Record<string, number> =
        next.platform_allocation && typeof next.platform_allocation === 'object' ? next.platform_allocation : {};
      const breakdown: Record<string, Array<{ type: string; count: number }>> = {};
      for (const [platformKey, rawCount] of Object.entries(allocation)) {
        const count = Number(rawCount);
        if (!Number.isFinite(count) || count <= 0) continue;
        const normalizedPlatform = normalizePlatformKeyStrict(platformKey) ?? platformKey.toLowerCase().trim();
        const types = prefs[normalizedPlatform] ?? [];
        if (!Array.isArray(types) || types.length === 0) continue;
        const countsByType: Record<string, number> = {};
        for (let i = 0; i < count; i++) {
          const t = normalizeContentTypeToken(types[i % types.length]) ?? 'post';
          countsByType[t] = (countsByType[t] ?? 0) + 1;
        }
        breakdown[platformKey] = Object.entries(countsByType).map(([type, c]) => ({ type, count: c }));
      }
      if (Object.keys(breakdown).length > 0) {
        next.platform_content_breakdown = breakdown as any;
      }
    }

    next.week_extras = {
      ...(next.week_extras && typeof next.week_extras === 'object' ? next.week_extras : {}),
      platform_content_types_selected: prefs,
    };

    return next;
  });
}
