export function ensureNonEmptyString(value: unknown): string | null {
  const s = typeof value === 'string' ? value : String(value ?? '');
  const t = s.trim();
  return t ? t : null;
}

export function deriveWritingAngle(input: { themeRaw: unknown; topicRaw: unknown }): string | null {
  const t = String(input.themeRaw ?? '').toLowerCase();
  const topic = String(input.topicRaw ?? '').toLowerCase();
  if (!t.trim()) return null;
  if (topic.includes('how') || topic.includes('guide') || topic.includes('tutorial')) return 'education';
  if (topic.includes('case study') || topic.includes('proof') || topic.includes('results')) return 'authority';
  if (topic.includes('pricing') || topic.includes('demo') || topic.includes('book') || topic.includes('signup')) return 'conversion';
  if (topic.includes('why') || topic.includes('what is') || topic.includes('problem')) return 'awareness';
  if (t.includes('awareness')) return 'awareness';
  if (t.includes('authority') || t.includes('trust')) return 'authority';
  if (t.includes('conversion') || t.includes('lead') || t.includes('pipeline')) return 'conversion';
  if (t.includes('engage') || t.includes('community')) return 'engagement';
  if (t.includes('education') || t.includes('how-to')) return 'education';
  return null;
}

export function deriveStrategicRole(writingAngle: string | null): string {
  if (writingAngle === 'education') return 'Authority Building';
  if (writingAngle === 'awareness') return 'Audience Expansion';
  if (writingAngle === 'conversion') return 'Demand Capture';
  if (writingAngle === 'engagement') return 'Community Interaction';
  return 'Strategic Support';
}

function normalizeText(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(raw: unknown): string[] {
  const t = normalizeText(raw);
  if (!t) return [];
  const stop = new Set([
    'the', 'and', 'for', 'with', 'from', 'this', 'that', 'your', 'their', 'into', 'within',
    'why', 'what', 'how', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'by',
  ]);
  return t
    .split(' ')
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !stop.has(w));
}

function matchScore(topicRaw: unknown, candidateRaw: unknown): number {
  const topic = normalizeText(topicRaw);
  const cand = normalizeText(candidateRaw);
  if (!topic || !cand) return 0;
  if (topic.includes(cand) || cand.includes(topic)) return 1.0;
  const a = tokenize(topic);
  const b = tokenize(cand);
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let overlap = 0;
  for (const w of a) if (setB.has(w)) overlap += 1;
  const denom = Math.max(1, Math.min(a.length, b.length));
  const ratio = overlap / denom;
  if (overlap >= 2 && ratio >= 0.4) return ratio;
  return 0;
}

function pickBestMatch(topic: string | null, candidates: string[]): { value: string | null; score: number } {
  let best: { value: string | null; score: number } = { value: null, score: 0 };
  for (const c of candidates) {
    const s = matchScore(topic, c);
    if (s > best.score) best = { value: c, score: s };
  }
  return best;
}

export function extractRecommendationAlignmentSources(recommendationContext: any): {
  primary_topic: string | null;
  messaging_hooks: string[];
  campaign_angle: string | null;
  pain_symptoms: string[];
} {
  const payload = (recommendationContext?.context_payload ?? {}) as any;
  const intelligence = (payload?.intelligence ?? payload?.recommendation_intelligence ?? null) as any;
  const companySnap = (payload?.company_context_snapshot ?? payload?.companyContextSnapshot ?? null) as any;

  const primary_topic =
    String(
      payload?.polished_title ??
      payload?.polishedTitle ??
      payload?.trend_topic ??
      payload?.trendTopic ??
      payload?.topic ??
      payload?.title ??
      ''
    ).trim() || null;

  const hooksRaw =
    payload?.messaging_hooks ??
    payload?.messagingHooks ??
    intelligence?.messaging_hooks ??
    intelligence?.messagingHooks ??
    null;
  const messaging_hooks = Array.isArray(hooksRaw)
    ? hooksRaw.map((h: any) => String(h ?? '').trim()).filter(Boolean)
    : typeof hooksRaw === 'string'
      ? hooksRaw.split(/\n|;|,|\u2022/g).map((s: string) => s.trim()).filter(Boolean)
      : [];

  const campaign_angle =
    String(payload?.campaign_angle ?? payload?.campaignAngle ?? intelligence?.campaign_angle ?? intelligence?.campaignAngle ?? '').trim() ||
    null;

  const painRaw =
    companySnap?.pain_symptoms ??
    companySnap?.painSymptoms ??
    payload?.pain_symptoms ??
    payload?.painSymptoms ??
    intelligence?.problem_being_solved ??
    intelligence?.problemBeingSolved ??
    null;
  const pain_symptoms = Array.isArray(painRaw)
    ? painRaw.map((p: any) => String(p ?? '').trim()).filter(Boolean)
    : typeof painRaw === 'string'
      ? painRaw.split(/\n|;|\u2022/g).map((s: string) => s.trim()).filter(Boolean)
      : [];

  return { primary_topic, messaging_hooks, campaign_angle, pain_symptoms };
}

export function buildRecommendationAlignment(params: {
  topic: string | null;
  sources: ReturnType<typeof extractRecommendationAlignmentSources>;
}): { source_type: string; source_value: string; alignment_reason: string } {
  const topic = String(params.topic ?? '').trim();
  const { primary_topic, messaging_hooks, campaign_angle, pain_symptoms } = params.sources;

  const bestHook = pickBestMatch(topic, messaging_hooks);
  if (bestHook.value && bestHook.score > 0) {
    return {
      source_type: 'messaging_hook',
      source_value: bestHook.value,
      alignment_reason: `This topic supports messaging_hook by addressing ${topic} within the campaign theme.`,
    };
  }
  if (campaign_angle && matchScore(topic, campaign_angle) > 0) {
    return {
      source_type: 'campaign_angle',
      source_value: campaign_angle,
      alignment_reason: `This topic supports campaign_angle by addressing ${topic} within the campaign theme.`,
    };
  }
  const bestPain = pickBestMatch(topic, pain_symptoms);
  if (bestPain.value && bestPain.score > 0) {
    return {
      source_type: 'pain_symptom',
      source_value: bestPain.value,
      alignment_reason: `This topic supports pain_symptom by addressing ${topic} within the campaign theme.`,
    };
  }
  const source_value = primary_topic || topic || 'campaign topic';
  return {
    source_type: 'primary_topic',
    source_value,
    alignment_reason: `This topic supports primary_topic by addressing ${topic || source_value} within the campaign theme.`,
  };
}

export function derivePainPoint(input: { keyMessages: unknown; topic: string | null }): string {
  const km = String(input.keyMessages ?? '').trim();
  if (km) {
    const first = km.split(/\n|;|\.|\u2022|- /g).map((s) => s.trim()).filter(Boolean)[0];
    if (first) return first.slice(0, 180);
  }
  const topic = String(input.topic ?? '').trim();
  const t = topic.toLowerCase();
  if (t.includes('pricing')) return 'Unclear value and pricing expectations';
  if (t.includes('onboarding')) return 'Slow onboarding and time-to-value';
  if (t.includes('trust') || t.includes('credibility')) return 'Low trust in the solution';
  if (t.includes('lead') || t.includes('pipeline')) return 'Inconsistent lead flow';
  if (topic) return `Uncertainty about ${topic}`;
  return 'Unclear next steps and priorities';
}

export function deriveOutcomePromise(topic: string | null): string {
  const t = String(topic ?? '').trim();
  const safe = t || 'this topic';
  return `Reader understands ${safe} and why it matters.`;
}

export function pickBriefSummary(w: any, topicTitle: string): string | null {
  const tt = String(topicTitle ?? '').trim();
  if (!tt) return null;
  const briefs: any[] = Array.isArray(w?.topics) ? w.topics : [];
  const match = briefs.find((b) => String(b?.topicTitle ?? b?.title ?? '').trim() === tt);
  const candidate = String(
    match?.brief_summary ??
      match?.briefSummary ??
      match?.topicContext?.writingIntent ??
      match?.topicContext?.brief_summary ??
      ''
  ).trim();
  return candidate || null;
}

export function deriveCampaignStageForWeek(weekOrdinal: number): string {
  if (weekOrdinal <= 1) return 'awareness';
  if (weekOrdinal === 2) return 'education';
  if (weekOrdinal === 3) return 'consideration';
  return 'conversion';
}

export function deriveAudienceAwarenessTarget(campaign_stage: string): string {
  if (campaign_stage === 'awareness') return 'problem_aware';
  if (campaign_stage === 'education') return 'solution_aware';
  if (campaign_stage === 'consideration') return 'product_aware';
  return 'most_aware';
}

export function deriveWeekTheme(w: any, weekOrdinal: number): string {
  const direct = String(w?.theme ?? '').trim();
  if (direct) return direct;
  const fromPhase = String(w?.phase_label ?? w?.phaseLabel ?? '').trim();
  if (fromPhase) return fromPhase;
  const fromTopicFocus = String(w?.topic_focus ?? w?.topicFocus ?? w?.week_extras?.topic_focus ?? w?.week_extras?.topicFocus ?? '').trim();
  if (fromTopicFocus) return fromTopicFocus;
  const topicsToCover: any[] = Array.isArray(w?.topics_to_cover) ? w.topics_to_cover : Array.isArray(w?.topicsToCover) ? w.topicsToCover : [];
  const firstTopic = String(topicsToCover[0] ?? '').trim();
  if (firstTopic) return firstTopic;
  return `Week ${weekOrdinal} focus`;
}

export function deriveWeeklyNarrativeSpine(input: {
  campaign_stage: string;
  audience_awareness_target: string;
  theme: string;
  objective: string;
}): string {
  return `Stage ${input.campaign_stage}: use "${input.theme}" to move the audience to ${input.audience_awareness_target} while advancing "${input.objective}".`;
}

export function spreadDaysForCount(n: number, days = 7): number[] {
  const c = Math.max(0, Math.floor(n));
  if (c <= 0) return [];
  if (c === 1) return [1];
  const out: number[] = [];
  for (let i = 0; i < c; i += 1) {
    const idx0 = Math.round(((i + 0.5) * days) / c - 0.5);
    const clamped = Math.min(days - 1, Math.max(0, idx0));
    out.push(clamped + 1);
  }
  return out;
}
