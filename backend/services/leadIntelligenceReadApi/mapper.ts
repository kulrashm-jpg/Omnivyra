/**
 * INT-001 Phase 6 — tolerant persistence → DTO normalization.
 *
 * Consumes the persisted Phase 4 record and produces stable read models.
 * Missing / partial / malformed / legacy payloads degrade section-by-section
 * to null/empty — this module NEVER throws, NEVER recomputes a score, and
 * NEVER mutates its input. Freshness comes from the Phase 4 resolver over
 * stored record fields only (no snapshot loads, no fingerprint recomputation).
 */

import { resolveIntelligenceFreshness } from '../leadIntelligenceOrchestration/freshness';
import type { LeadIntelligenceRecord } from '../leadIntelligenceOrchestration/types';
import { LEAD_RECOMMENDATION_KEYS } from '../leadIntelligenceEngine/types';
import type {
  AutomationPlanningDTO,
  AutomationTaskDTO,
  AutomationTimelineEntryDTO,
  IntentDTO,
  IntentContributionDTO,
  LeadIntelligenceListItemDTO,
  LeadIntelligenceViewDTO,
  OutreachPlanStepDTO,
  PersonaDTO,
  PlanningActionDTO,
  PlanningChannelDTO,
  PlanningDimensionDTO,
  QualificationDTO,
  QualificationPlanningDTO,
  QualificationSectionDTO,
  RecommendationItemDTO,
  SegmentDTO,
  TimelineEntryDTO,
} from './dto';
import { primaryPersonaOf, primarySegmentOf, topActionOf } from './presentation';

type Unknown = Record<string, unknown>;

const obj = (v: unknown): Unknown | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Unknown) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strArr = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');

function mapIntent(v: unknown): IntentDTO | null {
  const o = obj(v);
  if (!o) return null;
  const score = num(o.score);
  const band = str(o.band);
  if (score === null || band === null) return null;
  const contributions: IntentContributionDTO[] = arr(o.contributions)
    .map((c) => obj(c))
    .filter((c): c is Unknown => c !== null)
    .map((c) => ({
      signal: str(c.signal) ?? '',
      label: str(c.label) ?? '',
      points: num(c.points) ?? 0,
      evidence: str(c.evidence) ?? '',
    }))
    .filter((c) => c.signal !== '');
  return { score, band, contributions };
}

function mapPersona(v: unknown): PersonaDTO | null {
  const o = obj(v);
  if (!o) return null;
  const persona = str(o.persona);
  const confidence = num(o.confidence);
  if (persona === null || confidence === null) return null;
  return { persona, confidence, reasons: strArr(o.reasons) };
}

function mapQualification(v: unknown): QualificationDTO | null {
  const o = obj(v);
  if (!o) return null;
  const totalScore = num(o.totalScore);
  const band = str(o.band);
  if (totalScore === null || band === null) return null;
  const sections: QualificationSectionDTO[] = arr(o.sections)
    .map((s) => obj(s))
    .filter((s): s is Unknown => s !== null)
    .map((s) => ({
      key: str(s.key) ?? '',
      score: num(s.score) ?? 0,
      weight: num(s.weight) ?? 0,
      weightedScore: num(s.weightedScore) ?? 0,
      reason: str(s.reason) ?? '',
    }))
    .filter((s) => s.key !== '');
  return { totalScore, band, sections };
}

function mapSegments(v: unknown): SegmentDTO[] {
  return arr(v)
    .map((s) => obj(s))
    .filter((s): s is Unknown => s !== null)
    .map((s) => ({
      segment: str(s.segment) ?? '',
      confidence: num(s.confidence) ?? 0,
      reasons: strArr(s.reasons),
    }))
    .filter((s) => s.segment !== '');
}

// INT-001A (Finding 4): the key list is the engine's canonical constant —
// no duplicated recommendation metadata lives in the read layer. The fixed
// order remains part of the stable DTO contract (owned by the engine).
function mapRecommendations(v: unknown): RecommendationItemDTO[] {
  const o = obj(v);
  if (!o) return [];
  const out: RecommendationItemDTO[] = [];
  for (const { key, label } of LEAD_RECOMMENDATION_KEYS) {
    const item = obj(o[key]);
    if (!item) continue;
    const confidence = num(item.confidence);
    const raw = item.value;
    const value =
      typeof raw === 'string' || typeof raw === 'number'
        ? raw
        : Array.isArray(raw)
          ? raw.filter((x): x is string => typeof x === 'string')
          : null;
    if (confidence === null || value === null) continue;
    out.push({ key, label, value, confidence, explanation: str(item.explanation) ?? '' });
  }
  return out;
}

function mapTimeline(v: unknown): TimelineEntryDTO[] {
  return arr(v)
    .map((e) => obj(e))
    .filter((e): e is Unknown => e !== null)
    .map((e) => ({
      type: str(e.type) ?? '',
      label: str(e.label) ?? '',
      occurredAt: str(e.occurredAt) ?? '',
      pageUrl: str(e.pageUrl),
      category: str(e.category),
      source: str(e.source) ?? '',
    }))
    .filter((e) => e.type !== '' && e.occurredAt !== '');
}

// ── INT-002 Wave 2: planning-layer normalization (tolerant, selection only) ──

function mapPlanningChannels(v: unknown): PlanningChannelDTO[] {
  return arr(v)
    .map((c) => obj(c))
    .filter((c): c is Unknown => c !== null)
    .map((c) => ({
      channel: str(c.channel) ?? '',
      confidence: num(c.confidence) ?? 0,
      reasoning: str(c.reasoning) ?? str(c.explanation) ?? '',
    }))
    .filter((c) => c.channel !== '');
}

function mapQualificationPlanning(v: unknown): QualificationPlanningDTO | null {
  const o = obj(v);
  if (!o) return null;
  const qualification = obj(o.qualification);
  const totalScore = num(qualification?.totalScore ?? o.overallScore);
  const band = str(qualification?.band);
  if (totalScore === null || band === null) return null;

  const dimensions: PlanningDimensionDTO[] = arr(qualification?.dimensions)
    .map((d) => obj(d))
    .filter((d): d is Unknown => d !== null)
    .map((d) => ({
      key: str(d.key) ?? '',
      score: num(d.score) ?? 0,
      weight: num(d.weight) ?? 0,
      confidence: num(d.confidence) ?? 0,
      explanation: str(d.explanation) ?? '',
    }))
    .filter((d) => d.key !== '');

  const planObj = obj(o.recommendedPlan);
  const steps: OutreachPlanStepDTO[] = arr(planObj?.steps)
    .map((s) => obj(s))
    .filter((s): s is Unknown => s !== null)
    .map((s) => ({
      order: num(s.order) ?? 0,
      step: str(s.step) ?? '',
      channel: str(s.channel) ?? '',
      detail: str(s.detail) ?? '',
    }))
    .filter((s) => s.step !== '');
  const playbook = str(planObj?.playbook);

  const actions: PlanningActionDTO[] = arr(o.recommendedActions)
    .map((a) => obj(a))
    .filter((a): a is Unknown => a !== null)
    .map((a) => ({
      action: str(a.action) ?? '',
      priority: str(a.priority) ?? '',
      rank: num(a.rank) ?? 0,
      confidence: num(a.confidence) ?? 0,
      explanation: str(a.explanation) ?? '',
    }))
    .filter((a) => a.action !== '');

  return {
    totalScore,
    band,
    confidence: num(o.confidence) ?? num(qualification?.confidence) ?? 0,
    dimensions,
    reasoning: strArr(qualification?.reasoning),
    channels: mapPlanningChannels(o.recommendedChannels),
    plan: playbook
      ? { playbook, confidence: num(planObj?.confidence) ?? 0, reasoning: str(planObj?.reasoning) ?? '', steps }
      : null,
    actions,
  };
}

function mapAutomationPlanning(v: unknown): AutomationPlanningDTO | null {
  const o = obj(v);
  if (!o) return null;
  const status = str(o.status);
  if (status === null) return null;

  const tasks: AutomationTaskDTO[] = arr(o.tasks)
    .map((t) => obj(t))
    .filter((t): t is Unknown => t !== null)
    .map((t) => ({
      id: str(t.id) ?? '',
      order: num(t.order) ?? 0,
      dependsOn: str(t.dependsOn),
      kind: str(t.kind) ?? '',
      action: str(t.action) ?? '',
      channel: str(t.channel),
      estimatedDelayHours: num(t.estimatedDelayHours) ?? 0,
      confidence: num(t.confidence) ?? 0,
      explanation: str(t.explanation) ?? '',
    }))
    .filter((t) => t.id !== '' && t.action !== '');

  const timeline: AutomationTimelineEntryDTO[] = arr(o.executionTimeline)
    .map((e) => obj(e))
    .filter((e): e is Unknown => e !== null)
    .map((e) => ({
      day: num(e.day) ?? 0,
      scheduledAt: str(e.scheduledAt) ?? '',
      taskId: str(e.taskId) ?? '',
      action: str(e.action) ?? '',
      channel: str(e.channel),
    }))
    .filter((e) => e.taskId !== '' && e.scheduledAt !== '');

  const review = obj(o.review);
  return {
    status,
    statusReasons: strArr(o.statusReasons),
    confidence: num(o.confidence) ?? 0,
    tasks,
    timeline,
    channelSequence: mapPlanningChannels(o.channelSequence),
    review: review
      ? {
          reviewRequired: review.reviewRequired === true,
          reasons: strArr(review.reasons),
          missingInformation: strArr(review.missingInformation),
        }
      : null,
  };
}

/** Normalize one persisted record (or its absence) into the canonical view. */
export function toLeadIntelligenceView(
  record: LeadIntelligenceRecord | null,
  ref: { companyId: string; leadId: string },
): LeadIntelligenceViewDTO {
  // INT-001A (Finding 5): defense-in-depth tenant validation. The default
  // persistence port already filters by company_id; an INJECTED port is not
  // trusted — a record whose companyId differs from the requested tenant is
  // treated exactly like an absent record: never throw, never expose foreign
  // data, fail open as never_generated.
  const safeRecord = record && record.companyId === ref.companyId ? record : null;
  const freshness = resolveIntelligenceFreshness(safeRecord);
  if (!safeRecord) {
    return {
      companyId: ref.companyId,
      leadId: ref.leadId,
      status: 'never_generated',
      freshness, // 'never_generated', exactly as persisted absence
      version: null,
      overallConfidence: null,
      intent: null,
      persona: null,
      qualification: null,
      segments: [],
      recommendations: [],
      timeline: [],
      qualificationPlanning: null,
      automationPlanning: null,
    };
  }

  const intelligence = obj(safeRecord.intelligence) ?? {};
  return {
    companyId: safeRecord.companyId,
    leadId: safeRecord.leadId,
    status: 'available',
    freshness,
    version: {
      engineVersion: safeRecord.engineVersion,
      schemaVersion: safeRecord.schemaVersion,
      generation: safeRecord.generationVersion,
      fingerprint: safeRecord.inputFingerprint,
      generatedAt: safeRecord.generatedAt,
    },
    overallConfidence: num(intelligence.confidence),
    intent: mapIntent(intelligence.intent),
    persona: mapPersona(intelligence.persona),
    qualification: mapQualification(intelligence.qualification),
    segments: mapSegments(intelligence.segments),
    recommendations: mapRecommendations(intelligence.recommendations),
    timeline: mapTimeline(intelligence.timeline),
    qualificationPlanning: mapQualificationPlanning(safeRecord.qualificationPlanning),
    automationPlanning: mapAutomationPlanning(safeRecord.automationPlanning),
  };
}

/** List projection — pure selection from the detail view (parity by construction). */
export function toLeadIntelligenceListItem(view: LeadIntelligenceViewDTO): LeadIntelligenceListItemDTO {
  const persona = primaryPersonaOf(view);
  const segment = primarySegmentOf(view);
  const action = topActionOf(view);
  return {
    leadId: view.leadId,
    status: view.status,
    freshness: view.freshness,
    overallScore: view.qualification?.totalScore ?? null,
    qualificationBand: view.qualification?.band ?? null,
    intentBand: view.intent?.band ?? null,
    primaryPersona: persona?.persona ?? null,
    primarySegment: segment?.segment ?? null,
    topAction: action && typeof action.value === 'string' ? action.value : null,
    confidence: view.overallConfidence,
    generatedAt: view.version?.generatedAt ?? null,
    engineVersion: view.version?.engineVersion ?? null,
  };
}
