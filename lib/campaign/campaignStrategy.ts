/**
 * LC-401 (W4) — Campaign Strategy + Channel Recommendation engine (pure, explainable).
 *
 * Deterministic, CONFIGURABLE recommendations over an audience's already-materialized
 * intelligence — it introduces NO new scoring engine and NO hidden heuristics. Every
 * recommendation answers why / evidence / confidence. It RECOMMENDS only; it never
 * executes or sends. Inputs are the audience intelligence aggregate (reused from W3)
 * plus the channels available to the tenant.
 */

export interface AudienceSignal {
  members: number;
  avgIntent: number;                 // 0..1
  intentBands: { high: number; medium: number; low: number };
  bySource: Record<string, number>;
}

export interface StrategyConfig {
  highIntent: number;   // avg-intent threshold for "act now / convert"
  mediumIntent: number; // threshold for "nurture to meeting"
  volumeForFullConfidence: number; // members count at which data confidence saturates
}
export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = { highIntent: 0.7, mediumIntent: 0.4, volumeForFullConfidence: 50 };

export interface Recommendation<T> { value: T; why: string; evidence: string[]; confidence: number }
export interface Cadence { touches: number; intervalDays: number }

export interface CampaignStrategy {
  objective: Recommendation<string>;
  timing: Recommendation<string>;
  cadence: Recommendation<Cadence>;
  channelMix: Recommendation<string[]>;
  successMetrics: Recommendation<string[]>;
}

export interface ChannelPlan {
  bestChannel: Recommendation<string>;
  sequence: Recommendation<string[]>;
  cadence: Recommendation<Cadence>;
  sendWindow: Recommendation<string>;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Data confidence: saturates with audience volume. Explainable, not magic. */
function dataConfidence(s: AudienceSignal, cfg: StrategyConfig): number {
  return clamp01(s.members / Math.max(1, cfg.volumeForFullConfidence));
}

/** Channel affinity from the audience's source mix (reused evidence, not a new score). */
function channelAffinity(s: AudienceSignal): { channel: string; sources: string[] }[] {
  const has = (k: string) => (s.bySource[k] ?? 0) > 0;
  const out: { channel: string; sources: string[] }[] = [];
  out.push({ channel: 'email', sources: Object.keys(s.bySource) }); // universal baseline
  if (has('community') || has('social') || has('engagement')) out.push({ channel: 'linkedin', sources: ['community', 'social', 'engagement'].filter(has) });
  if (has('website') || has('blog')) out.push({ channel: 'in_app', sources: ['website', 'blog'].filter(has) });
  return out;
}

export function recommendStrategy(s: AudienceSignal, availableChannels: string[] = ['email', 'linkedin', 'in_app', 'manual'], cfg: StrategyConfig = DEFAULT_STRATEGY_CONFIG): CampaignStrategy {
  const conf = dataConfidence(s, cfg);
  const highShare = s.members ? s.intentBands.high / s.members : 0;

  const objective: Recommendation<string> = s.avgIntent >= cfg.highIntent || highShare >= 0.3
    ? { value: 'book_meetings', why: 'High aggregate buying intent — prioritize direct conversion.', evidence: [`avg intent ${pct(s.avgIntent)}`, `${s.intentBands.high} high-intent members`], confidence: clamp01(0.5 * conf + 0.5 * s.avgIntent) }
    : s.avgIntent >= cfg.mediumIntent
      ? { value: 'nurture_to_meeting', why: 'Moderate intent — nurture with value before a meeting ask.', evidence: [`avg intent ${pct(s.avgIntent)}`, `${s.intentBands.medium} medium-intent members`], confidence: clamp01(0.5 * conf + 0.4) }
      : { value: 'educate_awareness', why: 'Low aggregate intent — build awareness and problem-education first.', evidence: [`avg intent ${pct(s.avgIntent)}`, `${s.intentBands.low} low-intent members`], confidence: clamp01(0.4 * conf + 0.3) };

  const timing: Recommendation<string> = s.intentBands.high > 0
    ? { value: 'now', why: 'High-intent members present — act while intent is fresh.', evidence: [`${s.intentBands.high} high-intent members`], confidence: conf }
    : { value: 'scheduled', why: 'No high-intent members — schedule against a nurture calendar.', evidence: [`0 high-intent members`], confidence: conf };

  const cadence: Recommendation<Cadence> = objective.value === 'book_meetings'
    ? { value: { touches: 4, intervalDays: 2 }, why: 'Tighter cadence converts high intent.', evidence: [objective.value], confidence: objective.confidence }
    : objective.value === 'nurture_to_meeting'
      ? { value: { touches: 5, intervalDays: 4 }, why: 'Spaced value-led cadence for warming.', evidence: [objective.value], confidence: objective.confidence }
      : { value: { touches: 6, intervalDays: 7 }, why: 'Long, light-touch education cadence.', evidence: [objective.value], confidence: objective.confidence };

  const affinity = channelAffinity(s).filter((a) => availableChannels.includes(a.channel));
  const channelMix: Recommendation<string[]> = {
    value: affinity.map((a) => a.channel),
    why: 'Channels matched to the audience source mix and availability.',
    evidence: affinity.map((a) => `${a.channel} ← sources: ${a.sources.join(', ') || 'n/a'}`),
    confidence: conf,
  };

  const successMetrics: Recommendation<string[]> = {
    value: objective.value === 'book_meetings' ? ['meetings_booked', 'reply_rate', 'pipeline_created']
      : objective.value === 'nurture_to_meeting' ? ['reply_rate', 'engagement_rate', 'meetings_booked']
        : ['open_rate', 'content_engagement', 'intent_lift'],
    why: 'KPIs aligned to the recommended objective.',
    evidence: [`objective=${objective.value}`],
    confidence: conf,
  };

  return { objective, timing, cadence, channelMix, successMetrics };
}

export function recommendChannelPlan(s: AudienceSignal, availableChannels: string[] = ['email', 'linkedin', 'in_app', 'manual'], cfg: StrategyConfig = DEFAULT_STRATEGY_CONFIG): ChannelPlan {
  const conf = dataConfidence(s, cfg);
  const affinity = channelAffinity(s).filter((a) => availableChannels.includes(a.channel));
  const primary = affinity[0]?.channel ?? 'email';
  const sequence = affinity.map((a) => a.channel);
  const strategy = recommendStrategy(s, availableChannels, cfg);
  return {
    bestChannel: { value: primary, why: 'Highest-affinity available channel for this audience.', evidence: affinity.slice(0, 1).map((a) => `${a.channel} ← ${a.sources.join(', ')}`), confidence: conf },
    sequence: { value: sequence, why: 'Multi-touch order across affinity channels.', evidence: [sequence.join(' → ')], confidence: conf },
    cadence: strategy.cadence,
    sendWindow: { value: s.avgIntent >= cfg.highIntent ? 'business_hours_next_day' : 'tue_thu_morning', why: 'Window matched to intent urgency.', evidence: [`avg intent ${pct(s.avgIntent)}`], confidence: conf },
  };
}
