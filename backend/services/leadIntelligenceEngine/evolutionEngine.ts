/**
 * WS-2 Milestone-3 — evolution intelligence (intent, funnel, journey).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW "EVOLUTION" WORKS WITHOUT BREAKING THE FROZEN ARCHITECTURE
 * ─────────────────────────────────────────────────────────────────────────────
 * Every engine here is pure: a snapshot in, intelligence out, with an injected
 * `now`. Evolution appears to need history — a previous envelope to diff
 * against — but taking that route would mean feeding persisted output back into
 * the engines, coupling them to storage and destroying determinism (the same
 * inputs would produce different results depending on what was stored before).
 *
 * Instead, evolution is REPLAYED from the evidence already in the snapshot.
 * The snapshot contains the whole captured history, so intent at any past
 * moment is recomputable by running the EXISTING intent engine over the prefix
 * of events up to that moment. That keeps three properties intact:
 *
 *   • PURE — no storage read, no clock read, no new pattern.
 *   • DETERMINISTIC — identical input yields an identical evolution history,
 *     every time, on any instance, forever. A diff against stored state could
 *     not promise that.
 *   • SELF-HEALING — the history is reconstructed, never accumulated, so it
 *     cannot drift, corrupt, or need a backfill.
 *
 * Checkpoints are bounded by `evolution.maxCheckpoints`: replay is O(checkpoints
 * × events), so an unbounded checkpoint count would make a lead with a long
 * history quadratically expensive. When there are more session boundaries than
 * the cap, the FIRST and the most-recent ones are kept (the two ends that carry
 * the signal) and the middle is thinned deterministically.
 */

import type {
  CapturedEvent,
  FunnelProgression,
  FunnelStage,
  FunnelTransition,
  IntentBand,
  IntentCheckpoint,
  IntentEvolution,
  IntentTransition,
  JourneyEvolution,
  JourneyMilestone,
  LeadCaptureSnapshot,
  LeadEvolutionIntelligence,
} from './types';
import { resolveEngineConfig, type LeadIntelligenceEngineConfig } from './engineConfig';
import { analyzeBehavior, type BehaviorAnalysis } from './behaviorAnalysis';
import { computeIntentIntelligence } from './intentEngine';
import { classifyPage } from './pageClassifier';

const DAY_MS = 86_400_000;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const clampConf = (n: number): number => round2(Math.min(0.95, Math.max(0.05, n)));

const toMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};

/** Funnel stages in progression order — index IS the depth. */
export const FUNNEL_STAGES: readonly FunnelStage[] = [
  'unaware',
  'awareness',
  'interest',
  'consideration',
  'evaluation',
  'decision',
] as const;

const stageIndex = (s: FunnelStage): number => FUNNEL_STAGES.indexOf(s);

/**
 * Deterministic checkpoint times: one per session start, plus the snapshot's
 * own `now` as the final observation. Falls back to distinct active days when a
 * lead has events but no session rows.
 */
function checkpointTimes(snapshot: LeadCaptureSnapshot, maxCheckpoints: number): number[] {
  const nowMs = toMs(snapshot.now);

  // A checkpoint marks the state AFTER a session, not entering it — measuring
  // at the start would place every observation before its own session's events
  // and report a first checkpoint that saw nothing.
  const ends = snapshot.sessions
    .map((s) => toMs(s.lastSeenAt) ?? toMs(s.startedAt))
    .filter((v): v is number => v !== null);

  let times = [...new Set(ends)].sort((a, b) => a - b);

  if (times.length === 0) {
    // No usable session rows — fall back to the LAST event of each active day.
    const byDay = new Map<string, number>();
    for (const e of snapshot.events) {
      const ms = toMs(e.occurredAt);
      if (ms === null) continue;
      const day = new Date(ms).toISOString().slice(0, 10);
      if (!byDay.has(day) || ms > byDay.get(day)!) byDay.set(day, ms);
    }
    times = [...byDay.values()].sort((a, b) => a - b);
  }

  // No activity at all means no history — not a single empty observation.
  if (times.length === 0) return [];

  // Always observe the present, so decay since the last session is visible.
  if (nowMs !== null && nowMs > times[times.length - 1]) times.push(nowMs);

  if (times.length <= maxCheckpoints) return times;

  // Thin the middle, keep both ends: the first checkpoint establishes the
  // baseline and the last is the current state — those must never be dropped.
  const kept: number[] = [times[0]];
  const inner = times.slice(1, -1);
  const take = Math.max(0, maxCheckpoints - 2);
  for (let i = 0; i < take; i += 1) {
    kept.push(inner[Math.floor(((i + 1) * inner.length) / (take + 1))]);
  }
  kept.push(times[times.length - 1]);
  return [...new Set(kept)].sort((a, b) => a - b);
}

/** The snapshot as it stood at `atMs` — a prefix, never a mutation. */
function snapshotAt(snapshot: LeadCaptureSnapshot, atMs: number): LeadCaptureSnapshot {
  // The lead's own creation is a fact with a timestamp like any other, so it
  // must be clamped too. Leaving it in place would make "became a lead" true at
  // every historical checkpoint, which collapses the whole funnel history to
  // the final stage and erases the transitions this engine exists to find.
  const createdMs = toMs(snapshot.lead.createdAt);
  const lead = createdMs !== null && createdMs > atMs ? { ...snapshot.lead, createdAt: null } : snapshot.lead;

  return {
    ...snapshot,
    lead,
    events: snapshot.events.filter((e) => {
      const ms = toMs(e.occurredAt);
      return ms !== null && ms <= atMs;
    }),
    sessions: snapshot.sessions.filter((s) => {
      const ms = toMs(s.startedAt);
      return ms === null || ms <= atMs;
    }),
    now: new Date(atMs).toISOString(),
  };
}

/**
 * Funnel stage implied by what the lead has done SO FAR. Deepest satisfied
 * stage wins — a visitor who booked a demo is at `decision` even though they
 * also once read the blog.
 */
export function funnelStageOf(
  snapshot: LeadCaptureSnapshot,
  behavior: BehaviorAnalysis,
  config: LeadIntelligenceEngineConfig,
): { stage: FunnelStage; evidence: string[] } {
  const evidence: string[] = [];
  const pages = (c: string): number => behavior.categoryPages.get(c as never)?.size ?? 0;
  const converted = snapshot.events.some((e) => e.eventName === 'form_submit' || e.eventName === 'cta_click');
  const submitted = snapshot.lead.createdAt !== null && toMs(snapshot.lead.createdAt) !== null;

  let stage: FunnelStage = 'unaware';
  const at = (s: FunnelStage, why: string) => {
    if (stageIndex(s) > stageIndex(stage)) stage = s;
    evidence.push(why);
  };

  if (behavior.totalEvents > 0 || snapshot.sessions.length > 0) at('awareness', 'site visit recorded');
  if (behavior.distinctPages.length >= 2 || pages('documentation') > 0 || pages('blog') > 0) {
    at('interest', `${behavior.distinctPages.length} distinct pages viewed`);
  }
  if (pages('pricing') > 0) at('consideration', 'pricing page viewed');
  if (pages('case_study') > 0) at('consideration', 'case study viewed');
  if (behavior.downloadCount > 0) at('consideration', 'content downloaded');
  if (behavior.searchQueries.length > 0) at('consideration', `searched for ${behavior.searchQueries[0]}`);
  if (pages('comparison') > 0) at('evaluation', 'comparison page viewed');
  if (pages('security') > 0) at('evaluation', 'security/compliance reviewed');
  if (pages('enterprise') > 0) at('evaluation', 'enterprise page viewed');
  if (behavior.videoCompleteCount > 0) at('evaluation', 'watched a video to completion');
  if (pages('demo') > 0) at('decision', 'demo page viewed');
  if (converted) at('decision', 'submitted a form / clicked a primary CTA');
  if (submitted) at('decision', 'became a lead');

  void config;
  return { stage, evidence: [...new Set(evidence)] };
}

/** Signals present at a checkpoint, used to attribute WHAT moved the score. */
const signalsOf = (snapshot: LeadCaptureSnapshot, config: LeadIntelligenceEngineConfig, behavior: BehaviorAnalysis): Set<string> =>
  new Set(computeIntentIntelligence(snapshot, config, behavior).contributions.filter((c) => c.points > 0).map((c) => c.signal));

export function buildEvolutionIntelligence(
  snapshot: LeadCaptureSnapshot,
  configOverride?: Partial<LeadIntelligenceEngineConfig>,
  precomputed?: BehaviorAnalysis,
): LeadEvolutionIntelligence {
  const config = resolveEngineConfig(configOverride);
  const evoCfg = config.evolution;
  const current = precomputed ?? analyzeBehavior(snapshot, config);
  const nowMs = toMs(snapshot.now);

  const times = checkpointTimes(snapshot, evoCfg.maxCheckpoints);

  // ── Replay ────────────────────────────────────────────────────────────────
  const checkpoints: IntentCheckpoint[] = [];
  const funnelHistory: Array<{ at: string; stage: FunnelStage; evidence: string[] }> = [];
  const seenSignals = new Set<string>();
  let previousSignals = new Set<string>();

  for (const [i, t] of times.entries()) {
    const prefix = snapshotAt(snapshot, t);
    // The LAST checkpoint is the present, so it can reuse the behaviour the
    // caller already computed — no duplicate work for the common case.
    const isLast = i === times.length - 1 && nowMs !== null && t === nowMs;
    const behavior = isLast ? current : analyzeBehavior(prefix, config);
    const intent = computeIntentIntelligence(prefix, config, behavior);

    const signals = new Set(intent.contributions.filter((c) => c.points > 0).map((c) => c.signal));
    const newSignals = [...signals].filter((s) => !seenSignals.has(s)).sort();
    for (const s of signals) seenSignals.add(s);
    previousSignals = signals;

    checkpoints.push({
      at: new Date(t).toISOString(),
      sessionIndex: i + 1,
      score: intent.score,
      band: intent.band,
      eventsSoFar: behavior.totalEvents,
      newSignals,
    });

    const fs = funnelStageOf(prefix, behavior, config);
    funnelHistory.push({ at: new Date(t).toISOString(), stage: fs.stage, evidence: fs.evidence });
  }
  void previousSignals;

  // ── Intent evolution ──────────────────────────────────────────────────────
  const transitions: IntentTransition[] = [];
  for (let i = 1; i < checkpoints.length; i += 1) {
    const prev = checkpoints[i - 1];
    const cur = checkpoints[i];
    const delta = cur.score - prev.score;
    if (delta === 0 && cur.band === prev.band) continue; // nothing moved
    const direction: IntentTransition['direction'] = delta > 0 ? 'growth' : delta < 0 ? 'decay' : 'flat';
    const gapDays = (Date.parse(cur.at) - Date.parse(prev.at)) / DAY_MS;
    const triggeringEvidence =
      cur.newSignals.length > 0
        ? cur.newSignals
        : direction === 'decay'
          ? ['no new activity — recency and cadence signals aged out']
          : ['existing signals strengthened'];
    transitions.push({
      at: cur.at,
      previous: { score: prev.score, band: prev.band },
      current: { score: cur.score, band: cur.band },
      delta,
      direction,
      triggeringEvidence,
      // More evidence and a shorter gap make the attribution more trustworthy.
      confidence: clampConf(0.35 + Math.min(cur.newSignals.length, 4) * 0.1 + (gapDays <= 7 ? 0.1 : 0)),
      reasoning:
        direction === 'growth'
          ? `Intent rose ${delta} point(s) (${prev.band} → ${cur.band}) driven by ${triggeringEvidence.join(', ')}`
          : direction === 'decay'
            ? `Intent fell ${Math.abs(delta)} point(s) (${prev.band} → ${cur.band}); ${triggeringEvidence.join(', ')}`
            : `Intent band moved ${prev.band} → ${cur.band} without a score change`,
    });
  }

  const first = checkpoints[0] ?? null;
  const last = checkpoints[checkpoints.length - 1] ?? null;
  const peak = checkpoints.reduce<IntentCheckpoint | null>((acc, c) => (acc === null || c.score > acc.score ? c : acc), null);
  const currentScore = last?.score ?? 0;
  const decayFromPeak = peak ? Math.max(0, peak.score - currentScore) : 0;

  const spanDays = first && last ? (Date.parse(last.at) - Date.parse(first.at)) / DAY_MS : null;
  const growthRatePerDay =
    first && last && spanDays !== null && spanDays > 0 ? round2((last.score - first.score) / spanDays) : null;

  // Acceleration compares the most recent transition against the mean of the
  // earlier ones: rising faster than its own history, not against a constant.
  const growthDeltas = transitions.map((t) => t.delta);
  const recentDelta = growthDeltas.length > 0 ? growthDeltas[growthDeltas.length - 1] : null;
  const earlierMean =
    growthDeltas.length > 1 ? growthDeltas.slice(0, -1).reduce((a, b) => a + b, 0) / (growthDeltas.length - 1) : null;
  const accelerating = recentDelta !== null && earlierMean !== null && recentDelta > earlierMean && recentDelta > 0;

  const daysSince = current.daysSinceLastActivity;
  /**
   * Trend describes which way intent is moving NOW, not whether it ever grew.
   * A lead that peaked and is sliding must read `decaying` even though it is
   * still far above its first-ever reading — otherwise every once-hot lead
   * reports "growing" forever and the signal is worthless for triage. Hence
   * the most recent transition decides direction, with peak decay as a second
   * trigger for the slower slides that no single step makes obvious.
   */
  const trend: IntentEvolution['trend'] =
    checkpoints.length === 0
      ? 'unknown'
      : daysSince !== null && daysSince > evoCfg.dormantAfterDays
        ? 'dormant'
        : accelerating
          ? 'accelerating'
          : (recentDelta !== null && recentDelta < 0) || decayFromPeak >= evoCfg.decayPointsForDecaying
            ? 'decaying'
            : (recentDelta !== null && recentDelta > 0) || (growthRatePerDay !== null && growthRatePerDay > 0)
              ? 'growing'
              : 'stable';

  const persistenceDays =
    current.firstVisitAt && current.lastActivityAt
      ? round2(Math.max(0, (Date.parse(current.lastActivityAt) - Date.parse(current.firstVisitAt)) / DAY_MS))
      : spanDays !== null
        ? round2(Math.max(0, spanDays))
        : null;

  const intentEvolution: IntentEvolution = {
    checkpoints,
    transitions,
    trend,
    growthRatePerDay,
    peakScore: peak?.score ?? 0,
    peakAt: peak?.at ?? null,
    currentScore,
    decayFromPeak,
    persistenceDays,
    // Confidence in the EVOLUTION reading, not in the score: more observation
    // points over a longer span make the trend more trustworthy.
    confidence: clampConf(0.2 + Math.min(checkpoints.length, 6) * 0.08 + (persistenceDays !== null && persistenceDays >= 1 ? 0.1 : 0)),
    reasoning:
      checkpoints.length === 0
        ? 'No captured activity to derive an intent history from'
        : checkpoints.length === 1
          ? `Single observation point at ${checkpoints[0].at} — intent ${currentScore}/100 with no history to compare against`
          : `${checkpoints.length} observation points over ${persistenceDays ?? 0} day(s): intent ${first?.score ?? 0} → ${currentScore}, peak ${peak?.score ?? 0}; trend ${trend}`,
  };

  // ── Funnel progression ────────────────────────────────────────────────────
  const funnelTransitions: FunnelTransition[] = [];
  for (let i = 1; i < funnelHistory.length; i += 1) {
    const prev = funnelHistory[i - 1];
    const cur = funnelHistory[i];
    if (prev.stage === cur.stage) continue;
    const advance = stageIndex(cur.stage) > stageIndex(prev.stage);
    const gained = cur.evidence.filter((e) => !prev.evidence.includes(e));
    funnelTransitions.push({
      at: cur.at,
      from: prev.stage,
      to: cur.stage,
      direction: advance ? 'advance' : 'regress',
      evidence: gained.length > 0 ? gained : cur.evidence,
      confidence: clampConf(0.4 + Math.min(gained.length, 4) * 0.1),
      reasoning: advance
        ? `Advanced ${prev.stage} → ${cur.stage} on ${(gained.length > 0 ? gained : cur.evidence).join(', ')}`
        : `Recorded stage moved back ${prev.stage} → ${cur.stage}; the deeper stage remains the furthest reached`,
    });
  }

  const currentStage = funnelHistory.length > 0 ? funnelHistory[funnelHistory.length - 1].stage : 'unaware';
  const furthestStage = funnelHistory.reduce<FunnelStage>(
    (acc, h) => (stageIndex(h.stage) > stageIndex(acc) ? h.stage : acc),
    'unaware',
  );
  const advancementCount = funnelTransitions.filter((t) => t.direction === 'advance').length;
  const regressionCount = funnelTransitions.filter((t) => t.direction === 'regress').length;

  const funnel: FunnelProgression = {
    stage: currentStage,
    furthestStage,
    history: funnelHistory,
    transitions: funnelTransitions,
    regressed: stageIndex(currentStage) < stageIndex(furthestStage),
    advancementCount,
    regressionCount,
    confidence: clampConf(0.25 + Math.min(funnelHistory.length, 5) * 0.1 + (advancementCount > 0 ? 0.1 : 0)),
    reasoning:
      funnelHistory.length === 0
        ? 'No activity from which to place the lead in the funnel'
        : `Currently ${currentStage} (furthest reached: ${furthestStage}) after ${advancementCount} advancement(s) and ${regressionCount} regression(s)`,
  };

  // ── Journey evolution ─────────────────────────────────────────────────────
  const milestones = journeyMilestones(snapshot, config);
  const sessionStarts = snapshot.sessions
    .map((s) => toMs(s.startedAt))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  // Acceleration: the most recent inter-session gap against the mean of the
  // earlier ones. > 1 means they are returning faster than they used to.
  let acceleration: number | null = null;
  if (sessionStarts.length >= 3) {
    const gaps: number[] = [];
    for (let i = 1; i < sessionStarts.length; i += 1) gaps.push(sessionStarts[i] - sessionStarts[i - 1]);
    const recent = gaps[gaps.length - 1];
    const earlier = gaps.slice(0, -1).reduce((a, b) => a + b, 0) / (gaps.length - 1);
    if (recent > 0 && earlier > 0) acceleration = round2(earlier / recent);
  }

  const stagnantDays = daysSince !== null ? round2(daysSince) : null;
  const state: JourneyEvolution['state'] =
    milestones.length === 0
      ? 'new'
      : stagnantDays !== null && stagnantDays > evoCfg.dormantAfterDays
        ? 'dormant'
        : stagnantDays !== null && stagnantDays > evoCfg.stagnantAfterDays
          ? 'stagnant'
          : acceleration !== null && acceleration >= evoCfg.accelerationRatio
            ? 'accelerating'
            : acceleration !== null && acceleration <= 1 / evoCfg.accelerationRatio
              ? 'slowing'
              : 'active';

  const journey: JourneyEvolution = {
    milestones,
    state,
    acceleration,
    stagnantDays,
    confidence: clampConf(0.25 + Math.min(milestones.length, 5) * 0.08 + (sessionStarts.length >= 3 ? 0.1 : 0)),
    reasoning:
      milestones.length === 0
        ? 'No journey milestones reached yet'
        : `${milestones.length} milestone(s) reached, latest "${milestones[milestones.length - 1].label}"; ${
          stagnantDays === null ? 'no activity timestamps' : `${stagnantDays} day(s) since last activity`
        }${acceleration !== null ? `, return cadence ${acceleration >= 1 ? 'faster' : 'slower'} than before (×${acceleration})` : ''}`,
  };

  return { intent: intentEvolution, funnel, journey };
}

/**
 * First occurrence of each journey milestone, chronologically ordered.
 * Deterministic: ties break on the milestone key, so equal timestamps never
 * reorder between runs.
 */
function journeyMilestones(snapshot: LeadCaptureSnapshot, config: LeadIntelligenceEngineConfig): JourneyMilestone[] {
  const out: JourneyMilestone[] = [];
  const push = (key: string, label: string, at: string | null, evidence: string) => {
    if (at && Number.isFinite(Date.parse(at))) out.push({ key, label, at, evidence });
  };

  const events = [...snapshot.events]
    .filter((e) => toMs(e.occurredAt) !== null)
    .sort((a, b) => (toMs(a.occurredAt) ?? 0) - (toMs(b.occurredAt) ?? 0));

  const firstWhere = (pred: (e: CapturedEvent) => boolean): CapturedEvent | null => events.find(pred) ?? null;
  const firstCategory = (cat: string): CapturedEvent | null =>
    firstWhere((e) => e.eventName === 'page_view' && classifyPage(e.pageUrl, config.pageClassifier) === cat);

  const sessionStarts = snapshot.sessions.map((s) => s.startedAt).filter((s): s is string => !!s).sort();
  push('first_visit', 'First visit', sessionStarts[0] ?? events[0]?.occurredAt ?? null, 'first recorded session or event');
  if (sessionStarts.length > 1) push('returned', 'Returned', sessionStarts[1], 'second session recorded');

  push('first_pricing', 'Viewed pricing', firstCategory('pricing')?.occurredAt ?? null, 'pricing page view');
  push('first_docs', 'Read documentation', firstCategory('documentation')?.occurredAt ?? null, 'documentation page view');
  push('first_comparison', 'Compared alternatives', firstCategory('comparison')?.occurredAt ?? null, 'comparison page view');
  push('first_security', 'Reviewed security', firstCategory('security')?.occurredAt ?? null, 'security page view');

  const dl = new Set(config.intent.downloadEventNames);
  push('first_download', 'Downloaded content', firstWhere((e) => dl.has(e.eventName))?.occurredAt ?? null, 'download event');

  const search = new Set(config.intent.search.eventNames);
  push('first_search', 'Searched the site', firstWhere((e) => search.has(e.eventName))?.occurredAt ?? null, 'search event');

  const vc = new Set(config.intent.video.completedEventNames);
  push('video_completed', 'Finished a video', firstWhere((e) => vc.has(e.eventName))?.occurredAt ?? null, 'video completion');

  push('first_demo', 'Explored the demo', firstCategory('demo')?.occurredAt ?? null, 'demo page view');
  push('lead_submitted', 'Became a lead', snapshot.lead.createdAt, 'lead record created');

  return out.sort((a, b) => (Date.parse(a.at) - Date.parse(b.at)) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Band ordering helper shared with consumers that describe intent movement. */
export const INTENT_BAND_ORDER: readonly IntentBand[] = ['none', 'low', 'medium', 'high'] as const;
