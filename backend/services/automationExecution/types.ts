/**
 * INT-001 Phase 5 — Automation & Execution Framework: shared contracts.
 *
 * Converts Phase 3 planning intelligence into executable-but-NON-RUNNING
 * automation plans. Nothing here executes, schedules, queues, or touches the
 * network/DB — the "execution queue" is logical only. Pure and deterministic:
 * identical input always yields identical output; time comes exclusively from
 * the upstream summary's generatedAt.
 */

import type { QualificationPlanningSummary, OutreachChannel } from '../qualificationPlanning/types';

export type { QualificationPlanningSummary, OutreachChannel };

/** Caller-known execution context. Every field optional; absent = unknown. */
export interface AutomationContext {
  hasEmail?: boolean;
  hasPhone?: boolean;
  linkedinProfileKnown?: boolean;
  /** Explicit capture consent state; false blocks automation outright. */
  consentGranted?: boolean;
  /** Hard legal/operational stop (suppression list, DNC, litigation hold…). */
  doNotContact?: boolean;
  /** ISO 3166-1 alpha-2 region, when known (used for restriction checks). */
  region?: string | null;
}

export interface AutomationInput {
  summary: QualificationPlanningSummary;
  context?: AutomationContext;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type AutomationTaskKind = 'human' | 'outreach' | 'content' | 'wait';

export interface AutomationTask {
  /** Deterministic id: task-<order>-<slug>. */
  id: string;
  /** 1-based execution order. */
  order: number;
  /** Id of the task this one depends on; null for roots. */
  dependsOn: string | null;
  kind: AutomationTaskKind;
  action: string;
  channel: OutreachChannel | 'content' | 'internal' | null;
  /** Delay AFTER the dependency completes, in hours. Deterministic ladder. */
  estimatedDelayHours: number;
  confidence: number; // 0..1
  explanation: string;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export interface ExecutionTimelineEntry {
  /** Whole days after plan start (day 0 = generatedAt). */
  day: number;
  /** Deterministic ISO timestamp: generatedAt + cumulative delay. */
  scheduledAt: string;
  taskId: string;
  action: string;
  channel: AutomationTask['channel'];
}

// ---------------------------------------------------------------------------
// Channel sequencing
// ---------------------------------------------------------------------------

export interface ChannelSequenceEntry {
  order: number; // 1-based
  channel: OutreachChannel;
  confidence: number; // 0..1
  explanation: string;
}

// ---------------------------------------------------------------------------
// Readiness + human review
// ---------------------------------------------------------------------------

export type AutomationStatus = 'ready' | 'waiting' | 'manual_review' | 'blocked' | 'insufficient_data';

export interface ReadinessAssessment {
  status: AutomationStatus;
  reasons: string[];
}

export interface HumanReviewAssessment {
  reviewRequired: boolean;
  reasons: string[];
  missingInformation: string[];
}

// ---------------------------------------------------------------------------
// Consolidated outputs
// ---------------------------------------------------------------------------

export interface AutomationPlan {
  tasks: AutomationTask[];
  timeline: ExecutionTimelineEntry[];
  channelSequence: ChannelSequenceEntry[];
}

export interface AutomationSummary {
  leadId: string | null;
  status: AutomationStatus;
  statusReasons: string[];
  executionTimeline: ExecutionTimelineEntry[];
  tasks: AutomationTask[];
  channelSequence: ChannelSequenceEntry[];
  review: HumanReviewAssessment;
  confidence: number; // 0..1
  generatedAt: string; // === summary.generatedAt
}
