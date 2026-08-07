/**
 * WS-3 Milestone-7 — the intelligence feedback envelope.
 *
 * PURE AND DETERMINISTIC. No I/O, no clock, no randomness. `now` is injected
 * exactly as WS-2's engines take it, so the same inputs always produce the same
 * envelope — which is what makes the output testable, diffable and safe to
 * cache.
 *
 * DERIVED DATA ONLY — NO SCORING. This module counts, orders and explains. It
 * does not weight, normalise, rank or grade. There is no score, no index, no
 * 0–1 composite anywhere in the output, and that is a contract rather than an
 * omission: the moment a feedback score exists, something downstream will
 * consume it, and the one-way pipeline WS-3 was built to preserve would have
 * grown its return arrow through the back door. Rates ARE reported, but only
 * as an observed count over an exposed denominator — the numerator and
 * denominator both travel with the figure, so a reader can see that "0% opened"
 * means "we cannot observe opens", not "nobody opened".
 *
 * The envelope is a REPORT for operators and reporting surfaces. Nothing in
 * WS-2 reads it; nothing in WS-2 may ever read it. See feedbackIngestion.ts.
 */

import { UNOBSERVABLE_BUSINESS_OUTCOMES } from './types';
import { FEEDBACK_VERSION } from './feedbackIngestion';
import type { BusinessOutcomeType, DeliveryStatus, FeedbackSource, OutreachTask } from './types';

/** Schema version of the envelope. Independent of the ingestion contract. */
export const FEEDBACK_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Input — rows exactly as stored, so a caller never has to pre-map
// ---------------------------------------------------------------------------

export interface FeedbackSummaryInput {
  companyId: string;
  leadId: string;
  tasks: readonly OutreachTask[];
  /** `outreach_delivery_evidence` rows for those tasks. */
  deliveryEvidence: readonly Record<string, unknown>[];
  /** `outreach_outcomes` rows for those tasks. */
  outcomes: readonly Record<string, unknown>[];
  /** Injected clock. The ONLY source of "now" in this module. */
  now: string;
}

// ---------------------------------------------------------------------------
// Explainability — every summary answers the same five questions
// ---------------------------------------------------------------------------

/**
 * One explanation. Deliberately five fields and not a prose string: a sentence
 * cannot be filtered, grouped or asserted on, and an explanation nobody can
 * query is decoration.
 */
export interface FeedbackExplanation {
  /** Which part of the envelope this explains. */
  subject: 'delivery' | 'engagement' | 'response' | 'conversion' | 'timeline' | 'coverage';
  /** WHAT was observed. */
  what: string;
  /** WHEN — ISO-8601, or null when the subject has no observations. */
  when: string | null;
  /** WHY this reading follows from the evidence. */
  why: string;
  /** SOURCE — which feedback sources contributed. Empty when none did. */
  source: FeedbackSource[];
  /** EVIDENCE — the record counts behind the claim. */
  evidence: Record<string, number | string | null>;
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

/** A count with its denominator attached. Never a bare percentage. */
export interface ObservedRate {
  observed: number;
  outOf: number;
  /** null when `outOf` is 0 — an unknown rate, not a zero rate. */
  rate: number | null;
}

export interface DeliverySummary {
  tasksDispatched: number;
  byStatus: Record<DeliveryStatus, number>;
  delivered: ObservedRate;
  bounced: ObservedRate;
  firstDeliveryAt: string | null;
  lastDeliveryAt: string | null;
}

export interface EngagementSummary {
  opened: number;
  clicked: number;
  /** Tasks with at least one engagement outcome, over tasks delivered. */
  engagedTasks: ObservedRate;
  firstEngagementAt: string | null;
  lastEngagementAt: string | null;
  /** Engagement outcomes this platform cannot observe today. */
  unobservable: BusinessOutcomeType[];
}

export interface ResponseSummary {
  replied: number;
  rejected: number;
  unsubscribed: number;
  noResponse: number;
  respondedTasks: ObservedRate;
  firstResponseAt: string | null;
  lastResponseAt: string | null;
  /**
   * Hours between the first delivery and the first response, when both exist.
   * A measurement, not a performance grade.
   */
  hoursToFirstResponse: number | null;
}

export interface ConversionSummary {
  meetingsBooked: number;
  converted: number;
  convertedTasks: ObservedRate;
  firstConversionAt: string | null;
  lastConversionAt: string | null;
}

export interface FeedbackTimelineEntry {
  at: string;
  axis: 'delivery' | 'business';
  type: DeliveryStatus | BusinessOutcomeType;
  taskId: string | null;
  planTaskId: string | null;
  channel: string | null;
  source: FeedbackSource | null;
  provider: string | null;
  /** True when asserted by a rule rather than observed. Business axis only. */
  derived: boolean;
}

export interface FeedbackCoverage {
  /** Business outcomes no transport in this platform can report yet. */
  unobservable: BusinessOutcomeType[];
  /** Outcome types actually present in this lead's records. */
  observedTypes: BusinessOutcomeType[];
  tasksTotal: number;
  tasksWithFeedback: number;
}

export interface FeedbackEnvelope {
  schemaVersion: number;
  feedbackVersion: string;
  companyId: string;
  leadId: string;
  generatedAt: string;
  delivery: DeliverySummary;
  engagement: EngagementSummary;
  response: ResponseSummary;
  conversion: ConversionSummary;
  timeline: FeedbackTimelineEntry[];
  coverage: FeedbackCoverage;
  explainability: FeedbackExplanation[];
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** Canonicalise to ISO-8601; `timestamptz` reads back as `… 12:00:00+00`. */
const iso = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

const rate = (observed: number, outOf: number): ObservedRate => ({
  observed,
  outOf,
  rate: outOf > 0 ? observed / outOf : null,
});

const earliest = (values: readonly (string | null)[]): string | null => {
  const present = values.filter((v): v is string => typeof v === 'string');
  return present.length ? present.reduce((a, b) => (a <= b ? a : b)) : null;
};

const latest = (values: readonly (string | null)[]): string | null => {
  const present = values.filter((v): v is string => typeof v === 'string');
  return present.length ? present.reduce((a, b) => (a >= b ? a : b)) : null;
};

const uniqueSorted = <T extends string>(values: readonly (T | null)[]): T[] =>
  [...new Set(values.filter((v): v is T => typeof v === 'string' && v !== ''))].sort();

const DELIVERY_STATUS_KEYS: readonly DeliveryStatus[] = [
  'queued', 'dispatched', 'confirmed', 'sent_unverified', 'delivered', 'bounced', 'failed', 'suppressed', 'expired',
];

const ENGAGEMENT_TYPES: readonly BusinessOutcomeType[] = ['opened', 'clicked'];
const RESPONSE_TYPES: readonly BusinessOutcomeType[] = ['replied', 'rejected', 'unsubscribed'];
const CONVERSION_TYPES: readonly BusinessOutcomeType[] = ['meeting_booked', 'converted'];

interface NormalOutcome {
  taskId: string | null;
  type: BusinessOutcomeType;
  occurredAt: string | null;
  source: FeedbackSource | null;
  provider: string | null;
  derived: boolean;
}

interface NormalDelivery {
  taskId: string | null;
  status: DeliveryStatus | null;
  observedAt: string | null;
  source: FeedbackSource | null;
  provider: string | null;
}

const normalizeOutcome = (row: Record<string, unknown>): NormalOutcome => ({
  taskId: str(row.task_id),
  type: (str(row.outcome_type) ?? 'no_response') as BusinessOutcomeType,
  occurredAt: iso(row.occurred_at),
  source: str(row.source) as FeedbackSource | null,
  provider: str(row.provider),
  derived: row.derived === true,
});

const normalizeDelivery = (row: Record<string, unknown>): NormalDelivery => ({
  taskId: str(row.task_id),
  status: str(row.delivery_status) as DeliveryStatus | null,
  observedAt: iso(row.observed_at),
  source: str(row.source) as FeedbackSource | null,
  provider: str(row.provider),
});

const countTasksWith = (rows: readonly { taskId: string | null }[]): number =>
  new Set(rows.map((r) => r.taskId).filter((id): id is string => !!id)).size;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build the feedback envelope for one lead.
 *
 * Every figure is a count over records this function was handed. It reads
 * nothing, infers nothing about records it was not given, and produces the same
 * output for the same input forever.
 */
export function buildFeedbackEnvelope(input: FeedbackSummaryInput): FeedbackEnvelope {
  const generatedAt = iso(input?.now) ?? new Date(0).toISOString();
  const tasks = Array.isArray(input?.tasks) ? input.tasks : [];
  const deliveries = (Array.isArray(input?.deliveryEvidence) ? input.deliveryEvidence : []).map(normalizeDelivery);
  const outcomes = (Array.isArray(input?.outcomes) ? input.outcomes : []).map(normalizeOutcome);

  const taskById = new Map(tasks.filter((t) => t.id).map((t) => [String(t.id), t] as const));

  // ── delivery ──────────────────────────────────────────────────────────────

  const byStatus = DELIVERY_STATUS_KEYS.reduce(
    (acc, key) => ({ ...acc, [key]: deliveries.filter((d) => d.status === key).length }),
    {} as Record<DeliveryStatus, number>,
  );

  // The denominator is tasks that reached a transport — a task never dispatched
  // has no delivery outcome to be missing, and counting it as an undelivered
  // task would misreport the transport's behaviour.
  const dispatchedTaskIds = new Set(deliveries.map((d) => d.taskId).filter((id): id is string => !!id));
  const deliveredTaskIds = new Set(
    deliveries.filter((d) => d.status === 'delivered').map((d) => d.taskId).filter((id): id is string => !!id),
  );
  const bouncedTaskIds = new Set(
    deliveries.filter((d) => d.status === 'bounced').map((d) => d.taskId).filter((id): id is string => !!id),
  );

  const delivery: DeliverySummary = {
    tasksDispatched: dispatchedTaskIds.size,
    byStatus,
    delivered: rate(deliveredTaskIds.size, dispatchedTaskIds.size),
    bounced: rate(bouncedTaskIds.size, dispatchedTaskIds.size),
    firstDeliveryAt: earliest(deliveries.filter((d) => d.status === 'delivered').map((d) => d.observedAt)),
    lastDeliveryAt: latest(deliveries.filter((d) => d.status === 'delivered').map((d) => d.observedAt)),
  };

  // ── engagement ────────────────────────────────────────────────────────────

  const engagementRows = outcomes.filter((o) => ENGAGEMENT_TYPES.includes(o.type));
  const engagement: EngagementSummary = {
    opened: outcomes.filter((o) => o.type === 'opened').length,
    clicked: outcomes.filter((o) => o.type === 'clicked').length,
    engagedTasks: rate(countTasksWith(engagementRows), deliveredTaskIds.size),
    firstEngagementAt: earliest(engagementRows.map((o) => o.occurredAt)),
    lastEngagementAt: latest(engagementRows.map((o) => o.occurredAt)),
    unobservable: UNOBSERVABLE_BUSINESS_OUTCOMES.filter((t) => ENGAGEMENT_TYPES.includes(t)),
  };

  // ── response ──────────────────────────────────────────────────────────────

  const responseRows = outcomes.filter((o) => RESPONSE_TYPES.includes(o.type));
  const firstResponseAt = earliest(responseRows.map((o) => o.occurredAt));
  const hoursToFirstResponse =
    delivery.firstDeliveryAt && firstResponseAt
      ? Math.round(((Date.parse(firstResponseAt) - Date.parse(delivery.firstDeliveryAt)) / 3_600_000) * 100) / 100
      : null;

  const response: ResponseSummary = {
    replied: outcomes.filter((o) => o.type === 'replied').length,
    rejected: outcomes.filter((o) => o.type === 'rejected').length,
    unsubscribed: outcomes.filter((o) => o.type === 'unsubscribed').length,
    noResponse: outcomes.filter((o) => o.type === 'no_response').length,
    respondedTasks: rate(countTasksWith(responseRows), deliveredTaskIds.size),
    firstResponseAt,
    lastResponseAt: latest(responseRows.map((o) => o.occurredAt)),
    hoursToFirstResponse,
  };

  // ── conversion ────────────────────────────────────────────────────────────

  const conversionRows = outcomes.filter((o) => CONVERSION_TYPES.includes(o.type));
  const conversion: ConversionSummary = {
    meetingsBooked: outcomes.filter((o) => o.type === 'meeting_booked').length,
    converted: outcomes.filter((o) => o.type === 'converted').length,
    convertedTasks: rate(countTasksWith(conversionRows), deliveredTaskIds.size),
    firstConversionAt: earliest(conversionRows.map((o) => o.occurredAt)),
    lastConversionAt: latest(conversionRows.map((o) => o.occurredAt)),
  };

  // ── timeline ──────────────────────────────────────────────────────────────

  const timeline = buildTimeline(deliveries, outcomes, taskById);

  // ── coverage ──────────────────────────────────────────────────────────────

  const tasksWithFeedback = new Set(
    [...deliveries.map((d) => d.taskId), ...outcomes.map((o) => o.taskId)].filter((id): id is string => !!id),
  ).size;

  const coverage: FeedbackCoverage = {
    unobservable: [...UNOBSERVABLE_BUSINESS_OUTCOMES].sort(),
    observedTypes: uniqueSorted(outcomes.map((o) => o.type)),
    tasksTotal: tasks.length,
    tasksWithFeedback,
  };

  return {
    schemaVersion: FEEDBACK_SCHEMA_VERSION,
    feedbackVersion: FEEDBACK_VERSION,
    companyId: String(input?.companyId ?? ''),
    leadId: String(input?.leadId ?? ''),
    generatedAt,
    delivery,
    engagement,
    response,
    conversion,
    timeline,
    coverage,
    explainability: explain({ delivery, engagement, response, conversion, timeline, coverage, deliveries, outcomes }),
  };
}

/**
 * Merge both axes into one chronological narrative.
 *
 * Sorted by (instant, axis, type, taskId) rather than by instant alone: two
 * events can share a timestamp to the millisecond, and an ordering that depends
 * on the input array's order would make the envelope non-deterministic for the
 * same set of records read back in a different order.
 */
function buildTimeline(
  deliveries: readonly NormalDelivery[],
  outcomes: readonly NormalOutcome[],
  taskById: ReadonlyMap<string, OutreachTask>,
): FeedbackTimelineEntry[] {
  const entry = (
    at: string,
    axis: 'delivery' | 'business',
    type: DeliveryStatus | BusinessOutcomeType,
    taskId: string | null,
    source: FeedbackSource | null,
    provider: string | null,
    derived: boolean,
  ): FeedbackTimelineEntry => {
    const task = taskId ? taskById.get(taskId) ?? null : null;
    return {
      at,
      axis,
      type,
      taskId,
      planTaskId: task?.planTaskId ?? null,
      channel: task?.channel ?? null,
      source,
      provider,
      derived,
    };
  };

  const rows: FeedbackTimelineEntry[] = [
    ...deliveries
      .filter((d) => d.observedAt && d.status)
      .map((d) => entry(d.observedAt as string, 'delivery', d.status as DeliveryStatus, d.taskId, d.source, d.provider, false)),
    ...outcomes
      .filter((o) => o.occurredAt)
      .map((o) => entry(o.occurredAt as string, 'business', o.type, o.taskId, o.source, o.provider, o.derived)),
  ];

  return rows.sort(
    (a, b) =>
      a.at.localeCompare(b.at) ||
      a.axis.localeCompare(b.axis) ||
      String(a.type).localeCompare(String(b.type)) ||
      String(a.taskId ?? '').localeCompare(String(b.taskId ?? '')),
  );
}

// ---------------------------------------------------------------------------
// Explainability
// ---------------------------------------------------------------------------

function explain(ctx: {
  delivery: DeliverySummary;
  engagement: EngagementSummary;
  response: ResponseSummary;
  conversion: ConversionSummary;
  timeline: readonly FeedbackTimelineEntry[];
  coverage: FeedbackCoverage;
  deliveries: readonly NormalDelivery[];
  outcomes: readonly NormalOutcome[];
}): FeedbackExplanation[] {
  const { delivery, engagement, response, conversion, timeline, coverage, deliveries, outcomes } = ctx;

  const sourcesOf = (rows: readonly { source: FeedbackSource | null }[]): FeedbackSource[] =>
    uniqueSorted(rows.map((r) => r.source));

  const engagementRows = outcomes.filter((o) => ENGAGEMENT_TYPES.includes(o.type));
  const responseRows = outcomes.filter((o) => RESPONSE_TYPES.includes(o.type));
  const conversionRows = outcomes.filter((o) => CONVERSION_TYPES.includes(o.type));

  return [
    {
      subject: 'delivery',
      what:
        delivery.tasksDispatched === 0
          ? 'No task for this lead has reached a transport.'
          : `${delivery.delivered.observed} of ${delivery.tasksDispatched} dispatched task(s) were confirmed delivered; ${delivery.bounced.observed} bounced.`,
      when: delivery.lastDeliveryAt ?? latest(deliveries.map((d) => d.observedAt)),
      why:
        delivery.tasksDispatched === 0
          ? 'No delivery evidence rows exist, so the delivery axis has nothing to report. Absence of dispatch, not failure of delivery.'
          : 'Counted from immutable delivery evidence rows, one per observed transport fact, deduplicated by the logical and provider-event keys.',
      source: sourcesOf(deliveries),
      evidence: {
        deliveryEvidenceRows: deliveries.length,
        tasksDispatched: delivery.tasksDispatched,
        delivered: delivery.delivered.observed,
        bounced: delivery.bounced.observed,
      },
    },
    {
      subject: 'engagement',
      what:
        engagementRows.length === 0
          ? 'No engagement has been observed.'
          : `${engagement.opened} open(s) and ${engagement.clicked} click(s) across ${engagement.engagedTasks.observed} task(s).`,
      when: engagement.lastEngagementAt,
      why:
        engagementRows.length === 0
          ? `Opens and clicks require tracking instrumentation no transport in this platform emits yet (${engagement.unobservable.join(', ') || 'none'}). Zero here means UNOBSERVED, not "nobody engaged".`
          : 'Counted from immutable outcome rows of type opened/clicked.',
      source: sourcesOf(engagementRows),
      evidence: {
        engagementOutcomeRows: engagementRows.length,
        opened: engagement.opened,
        clicked: engagement.clicked,
        deliveredTaskDenominator: engagement.engagedTasks.outOf,
      },
    },
    {
      subject: 'response',
      what:
        responseRows.length === 0
          ? `No response has been recorded${response.noResponse > 0 ? `; ${response.noResponse} task(s) were marked no_response by the elapsed-window rule.` : '.'}`
          : `${response.replied} repl(ies), ${response.rejected} rejection(s), ${response.unsubscribed} unsubscribe(s).`,
      when: response.lastResponseAt,
      why:
        responseRows.length === 0
          ? 'No replied/rejected/unsubscribed outcome rows exist. Silence is the normal case in outreach and is not evidence of failure.'
          : `Counted from immutable outcome rows. ${
              response.hoursToFirstResponse === null
                ? 'Time-to-first-response is unavailable because there is no confirmed delivery to measure from.'
                : `First response arrived ${response.hoursToFirstResponse}h after first confirmed delivery.`
            }`,
      source: sourcesOf(responseRows),
      evidence: {
        responseOutcomeRows: responseRows.length,
        replied: response.replied,
        rejected: response.rejected,
        unsubscribed: response.unsubscribed,
        noResponse: response.noResponse,
        hoursToFirstResponse: response.hoursToFirstResponse,
      },
    },
    {
      subject: 'conversion',
      what:
        conversionRows.length === 0
          ? 'No conversion has been recorded.'
          : `${conversion.meetingsBooked} meeting(s) booked and ${conversion.converted} conversion(s) across ${conversion.convertedTasks.observed} task(s).`,
      when: conversion.lastConversionAt,
      why:
        conversionRows.length === 0
          ? 'No meeting_booked/converted outcome rows exist. meeting_booked additionally requires a booking integration this platform does not have, so its absence is not evidence either way.'
          : 'Counted from immutable outcome rows. Conversion is recorded by whoever observed it and is never inferred here.',
      source: sourcesOf(conversionRows),
      evidence: {
        conversionOutcomeRows: conversionRows.length,
        meetingsBooked: conversion.meetingsBooked,
        converted: conversion.converted,
      },
    },
    {
      subject: 'timeline',
      what: `${timeline.length} feedback event(s) across both axes, in chronological order.`,
      when: timeline.length ? timeline[timeline.length - 1].at : null,
      why: 'Delivery evidence and business outcomes merged and sorted by (instant, axis, type, task) so the order is total and reproducible for the same record set.',
      source: uniqueSorted(timeline.map((t) => t.source)),
      evidence: {
        deliveryEvents: timeline.filter((t) => t.axis === 'delivery').length,
        businessEvents: timeline.filter((t) => t.axis === 'business').length,
        derivedEvents: timeline.filter((t) => t.derived).length,
        firstAt: timeline.length ? timeline[0].at : null,
      },
    },
    {
      subject: 'coverage',
      what: `${coverage.tasksWithFeedback} of ${coverage.tasksTotal} task(s) have any feedback; observed outcome types: ${coverage.observedTypes.join(', ') || 'none'}.`,
      when: null,
      why: `${coverage.unobservable.join(', ')} cannot be observed by any transport in this platform today. Reporting them as zero without this note would misread missing instrumentation as recipient indifference.`,
      source: uniqueSorted([...deliveries.map((d) => d.source), ...outcomes.map((o) => o.source)]),
      evidence: {
        tasksTotal: coverage.tasksTotal,
        tasksWithFeedback: coverage.tasksWithFeedback,
        unobservableTypes: coverage.unobservable.length,
        observedTypes: coverage.observedTypes.length,
      },
    },
  ];
}
