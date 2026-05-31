/**
 * Blueprint validation guard.
 *
 * Runs IMMEDIATELY after the AI-generated plan is shaped into a
 * structured weeks array (just before the commit-plan stage writes
 * it to campaign_versions / draft blueprint). The goal is to catch
 * the half-formed shapes that survive the planner's own repair
 * loop — once they're committed, downstream stages either silently
 * skip rows or fail deep inside generate-weekly-structure with a
 * generic message.
 *
 * Validation rules (each maps to a stable BOLT_ERROR_CODE):
 *
 *   - At least one week present                → BLUEPRINT_MISSING_WEEKS
 *   - Each week has an integer `week_number`   → BLUEPRINT_INVALID_WEEK_STRUCTURE
 *   - Each week declares ≥1 platform           → BLUEPRINT_MISSING_PLATFORM_MAPPING
 *   - Total activity count > 0 across weeks    → BLUEPRINT_INVALID_ACTIVITY_COUNT
 *   - Every declared content type is registered → BLUEPRINT_INVALID_CONTENT_TYPE
 *   - At least one CTA present somewhere       → BLUEPRINT_MISSING_CTA
 *
 * The validator is shape-tolerant: it reads from multiple legacy
 * field names (platform_allocation, platform_content_breakdown,
 * platforms_active, activities, content_type_mix) so it works
 * against both the new structured plan and older shapes still in
 * flight after a deploy. None of the rules require ALL legacy
 * fields to be present — they require at least one.
 *
 * Pure function. Returns errors as a list; the strict wrapper
 * throws the first one as a BoltError.
 */

import { BoltError, BOLT_ERROR_CODES, type BoltErrorCode } from './boltErrorCodes';
import { isSupportedTextFormat } from './formatGovernance';
import { isAutonomousRenderableFormat, isAttachmentRequiredFormat } from '../creatorGovernanceRegistry';

export interface BlueprintValidationError {
  code: BoltErrorCode;
  message: string;
  weekIndex?: number;
  details?: Record<string, unknown>;
}

export interface BlueprintValidationResult {
  ok: boolean;
  errors: BlueprintValidationError[];
  /** Sanity-checked totals — useful for telemetry. */
  totals: {
    weeks: number;
    activities: number;
    platforms: number;
    ctas: number;
  };
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function extractWeekActivityCount(week: Record<string, unknown>): number {
  const activities = asArray(week.activities ?? week.posts ?? week.daily_posts ?? []);
  if (activities.length > 0) return activities.length;
  const breakdown = asObject(week.platform_content_breakdown);
  if (breakdown) {
    let total = 0;
    for (const items of Object.values(breakdown)) total += asArray(items).length;
    if (total > 0) return total;
  }
  const mix = asArray(week.content_type_mix);
  // mix items can be "5 post" / "2 tweet" — sum the leading integers.
  let total = 0;
  for (const raw of mix) {
    const m = String(raw ?? '').match(/^(\d+)/);
    if (m) total += Number(m[1]);
  }
  return total;
}

function extractWeekPlatforms(week: Record<string, unknown>): string[] {
  const fromAlloc = asObject(week.platform_allocation);
  if (fromAlloc && Object.keys(fromAlloc).length > 0) return Object.keys(fromAlloc);
  const fromActive = asArray(week.platforms_active);
  if (fromActive.length > 0) return fromActive.map((p) => String(p ?? '').trim()).filter(Boolean);
  const fromBreakdown = asObject(week.platform_content_breakdown);
  if (fromBreakdown) return Object.keys(fromBreakdown);
  return [];
}

function extractWeekContentTypes(week: Record<string, unknown>): string[] {
  const types = new Set<string>();
  const activities = asArray(week.activities ?? week.posts ?? []);
  for (const act of activities) {
    const obj = asObject(act);
    if (!obj) continue;
    const t = obj.content_type ?? obj.type ?? obj.format;
    if (typeof t === 'string' && t.trim()) types.add(t.trim().toLowerCase());
  }
  const mix = asArray(week.content_type_mix);
  for (const raw of mix) {
    const s = String(raw ?? '').trim().toLowerCase();
    if (!s) continue;
    // "5 post" → "post"
    const m = s.match(/^\d+\s+(.+)$/);
    types.add(m ? m[1] : s);
  }
  const breakdown = asObject(week.platform_content_breakdown);
  if (breakdown) {
    for (const items of Object.values(breakdown)) {
      for (const it of asArray(items)) {
        const obj = asObject(it);
        if (!obj) continue;
        const t = obj.type ?? obj.content_type;
        if (typeof t === 'string' && t.trim()) types.add(t.trim().toLowerCase());
      }
    }
  }
  return [...types];
}

function isKnownContentType(canonical: string): boolean {
  if (!canonical) return false;
  if (isSupportedTextFormat(canonical)) return true;
  if (isAutonomousRenderableFormat(canonical)) return true;
  if (isAttachmentRequiredFormat(canonical)) return true;
  return false;
}

function extractWeekCtas(week: Record<string, unknown>): number {
  let ctas = 0;
  if (typeof week.cta === 'string' && week.cta.trim()) ctas++;
  if (typeof week.recommended_cta_style === 'string' && week.recommended_cta_style.trim()) ctas++;
  const activities = asArray(week.activities ?? week.posts ?? []);
  for (const act of activities) {
    const obj = asObject(act);
    if (!obj) continue;
    if ((typeof obj.cta === 'string' && obj.cta.trim()) || (typeof obj.cta_text === 'string' && obj.cta_text.trim())) ctas++;
  }
  return ctas;
}

export function validateBoltBlueprint(plan: { weeks: unknown[] } | null | undefined): BlueprintValidationResult {
  const errors: BlueprintValidationError[] = [];
  const totals = { weeks: 0, activities: 0, platforms: 0, ctas: 0 };

  if (!plan || !Array.isArray(plan.weeks) || plan.weeks.length === 0) {
    errors.push({
      code: BOLT_ERROR_CODES.BLUEPRINT_MISSING_WEEKS,
      message: 'Blueprint contains no weeks.',
    });
    return { ok: false, errors, totals };
  }

  totals.weeks = plan.weeks.length;
  const allPlatforms = new Set<string>();
  let totalActivities = 0;
  let totalCtas = 0;
  const badContentTypes: string[] = [];

  for (let i = 0; i < plan.weeks.length; i++) {
    const w = asObject(plan.weeks[i]);
    if (!w) {
      errors.push({
        code: BOLT_ERROR_CODES.BLUEPRINT_INVALID_WEEK_STRUCTURE,
        message: `Week ${i + 1} is not a JSON object (got ${typeof plan.weeks[i]}).`,
        weekIndex: i,
      });
      continue;
    }
    const weekNumber = w.week_number ?? w.week;
    if (weekNumber != null && !Number.isInteger(Number(weekNumber))) {
      errors.push({
        code: BOLT_ERROR_CODES.BLUEPRINT_INVALID_WEEK_STRUCTURE,
        message: `Week ${i + 1} has a non-integer week_number "${weekNumber}".`,
        weekIndex: i,
      });
    }

    const platforms = extractWeekPlatforms(w);
    if (platforms.length === 0) {
      errors.push({
        code: BOLT_ERROR_CODES.BLUEPRINT_MISSING_PLATFORM_MAPPING,
        message: `Week ${i + 1} is missing platform assignments.`,
        weekIndex: i,
      });
    }
    for (const p of platforms) allPlatforms.add(p);

    totalActivities += extractWeekActivityCount(w);
    totalCtas += extractWeekCtas(w);

    for (const ct of extractWeekContentTypes(w)) {
      if (!isKnownContentType(ct)) badContentTypes.push(ct);
    }
  }

  totals.activities = totalActivities;
  totals.platforms = allPlatforms.size;
  totals.ctas = totalCtas;

  if (totalActivities <= 0) {
    errors.push({
      code: BOLT_ERROR_CODES.BLUEPRINT_INVALID_ACTIVITY_COUNT,
      message: 'Blueprint declares zero activities across all weeks.',
    });
  }
  if (badContentTypes.length > 0) {
    errors.push({
      code: BOLT_ERROR_CODES.BLUEPRINT_INVALID_CONTENT_TYPE,
      message: `Blueprint uses unsupported content types: ${[...new Set(badContentTypes)].join(', ')}.`,
      details: { unsupported_content_types: [...new Set(badContentTypes)] },
    });
  }
  if (totalCtas === 0) {
    // CTA absence is a warning-class signal, not always fatal — but
    // we still report it as an error so the operator dashboard sees it.
    // The strict wrapper only throws on the first error so this is the
    // tie-breaker behind harder structural errors above.
    errors.push({
      code: BOLT_ERROR_CODES.BLUEPRINT_MISSING_CTA,
      message: 'Blueprint contains no CTA guidance.',
    });
  }

  return { ok: errors.length === 0, errors, totals };
}

export function assertValidBoltBlueprint(plan: { weeks: unknown[] } | null | undefined): void {
  const r = validateBoltBlueprint(plan);
  if (r.ok) return;
  // BLUEPRINT_MISSING_CTA is warning-class: the planner's week-level
  // shape doesn't always carry a CTA field (CTA guidance is also
  // injected at the daily-row level downstream), so blocking the
  // commit-plan stage on this alone over-rejects. Mirrors the
  // assertDailyPlanRowValid pattern for DAILY_PLAN_INVALID_CTA.
  // Warnings still appear in r.errors so the failure dashboard
  // surfaces them; only hard errors throw.
  const hardErrors = r.errors.filter((e) => e.code !== BOLT_ERROR_CODES.BLUEPRINT_MISSING_CTA);
  if (hardErrors.length === 0) return;
  const first = hardErrors[0];
  throw new BoltError(first.code, first.message, { details: { ...first.details, totals: r.totals } });
}
