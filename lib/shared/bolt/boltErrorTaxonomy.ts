/**
 * BOLT pipeline error taxonomy inventory.
 *
 * Per the closure pass spec, this file lists EVERY execution stage
 * and the BoltError codes / normalised categories / user-friendly
 * messages that can surface from it. The dashboard reads this to
 * render a coverage matrix and verify 100% stage coverage.
 *
 * This is documentation-as-code: the taxonomy compiles, every code
 * reference is type-checked, and the test suite asserts no stage
 * has an empty code list (which would indicate a coverage gap).
 *
 * If you add a new BoltErrorCode, add it to the appropriate stage
 * entry here and (if used by a new stage) add the stage entry too.
 */

import {
  BOLT_ERROR_CODES,
  BOLT_ERROR_CODE_CATEGORY,
  BOLT_ERROR_CODE_FRIENDLY_MESSAGES,
  type BoltErrorCode,
} from './boltErrorCodes';
import type { BoltFailureCategory } from './classifyBoltFailure';

export interface StageTaxonomyEntry {
  stage: string;
  description: string;
  codes: BoltErrorCode[];
  /** When true, the dashboard treats UNKNOWN failures here as a coverage gap. */
  expects_full_coverage: boolean;
}

export const BOLT_STAGE_TAXONOMY: StageTaxonomyEntry[] = [
  {
    stage: 'pre-validate',
    description: 'HTTP-side preflight (POST /api/bolt/execute) — runs before the run row is inserted.',
    codes: [
      BOLT_ERROR_CODES.STRATEGY_MISSING_COMPANY_ID,
      BOLT_ERROR_CODES.STRATEGY_INVALID_CAMPAIGN_MODE,
      BOLT_ERROR_CODES.STRATEGY_MISSING_FORMATS,
      BOLT_ERROR_CODES.STRATEGY_INVALID_FREQUENCY,
      BOLT_ERROR_CODES.STRATEGY_INVALID_DURATION,
      BOLT_ERROR_CODES.STRATEGY_MISSING_GOAL,
      BOLT_ERROR_CODES.STRATEGY_MISSING_AUDIENCE,
      BOLT_ERROR_CODES.STRATEGY_MISSING_PLATFORMS,
      BOLT_ERROR_CODES.STRATEGY_INVALID_PLATFORMS,
      BOLT_ERROR_CODES.THEME_MISSING,
      BOLT_ERROR_CODES.THEME_INVALID_SHAPE,
      BOLT_ERROR_CODES.THEME_MISSING_REQUIRED_FIELD,
      BOLT_ERROR_CODES.THEME_SERIALIZATION_FAILED,
      BOLT_ERROR_CODES.UNSUPPORTED_CREATOR_FORMAT,
      BOLT_ERROR_CODES.UNSUPPORTED_TEXT_FORMAT,
      BOLT_ERROR_CODES.FORMAT_PLATFORM_INCOMPATIBLE,
      BOLT_ERROR_CODES.CAMPAIGN_VERSION_NOT_FOUND,
      BOLT_ERROR_CODES.CAMPAIGN_VERSION_MISMATCH,
      BOLT_ERROR_CODES.CAMPAIGN_VERSION_ACCESS_DENIED,
    ],
    expects_full_coverage: true,
  },
  {
    stage: 'source-recommendation',
    description: 'Mints (or hydrates) the campaign + campaign_versions row at run start.',
    codes: [
      BOLT_ERROR_CODES.CAMPAIGN_INSERT_FAILED,
      BOLT_ERROR_CODES.CAMPAIGN_VERSION_INSERT_FAILED,
      BOLT_ERROR_CODES.CAMPAIGN_VERSION_UPDATE_FAILED,
      BOLT_ERROR_CODES.CAMPAIGN_VERSION_NOT_FOUND,
      BOLT_ERROR_CODES.SCHEDULING_CAMPAIGN_NOT_FOUND,
      BOLT_ERROR_CODES.RUN_NOT_FOUND,
      BOLT_ERROR_CODES.RUN_UPDATE_FAILED,
    ],
    expects_full_coverage: true,
  },
  {
    stage: 'ai/plan',
    description: 'Calls the planner orchestrator to produce the structured weeks plan.',
    codes: [
      BOLT_ERROR_CODES.AI_PLAN_INVALID,
      BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID,
      BOLT_ERROR_CODES.STAGE_TIMEOUT,
    ],
    expects_full_coverage: false,
  },
  {
    stage: 'commit-plan',
    description: 'Runs the blueprint guard then persists structured plan + draft blueprint.',
    codes: [
      BOLT_ERROR_CODES.BLUEPRINT_MISSING_WEEKS,
      BOLT_ERROR_CODES.BLUEPRINT_INVALID_WEEK_STRUCTURE,
      BOLT_ERROR_CODES.BLUEPRINT_INVALID_ACTIVITY_COUNT,
      BOLT_ERROR_CODES.BLUEPRINT_MISSING_PLATFORM_MAPPING,
      BOLT_ERROR_CODES.BLUEPRINT_INVALID_CONTENT_TYPE,
      BOLT_ERROR_CODES.BLUEPRINT_MISSING_CTA,
      BOLT_ERROR_CODES.BLUEPRINT_SAVE_FAILED,
    ],
    expects_full_coverage: true,
  },
  {
    stage: 'generate-weekly-structure',
    description: 'Expands the blueprint into daily_content_plans rows for each week.',
    codes: [
      BOLT_ERROR_CODES.WEEK_STRUCTURE_GENERATION_FAILED,
      BOLT_ERROR_CODES.WEEK_STRUCTURE_PERSISTENCE_FAILED,
      BOLT_ERROR_CODES.WEEK_STRUCTURE_VALIDATION_FAILED,
      BOLT_ERROR_CODES.DAILY_PLAN_ROW_GENERATION_FAILED,
      BOLT_ERROR_CODES.DAILY_PLAN_ROW_INVALID,
      BOLT_ERROR_CODES.DAILY_PLAN_SAVE_FAILED,
      BOLT_ERROR_CODES.DAILY_PLAN_INVALID_PLATFORM,
      BOLT_ERROR_CODES.DAILY_PLAN_INVALID_CONTENT_TYPE,
      BOLT_ERROR_CODES.DAILY_PLAN_INVALID_ACTIVITY,
      BOLT_ERROR_CODES.DAILY_PLAN_INVALID_WEEK,
      BOLT_ERROR_CODES.DAILY_PLAN_INVALID_CTA,
      BOLT_ERROR_CODES.DAILY_PLAN_UNSCHEDULABLE,
      BOLT_ERROR_CODES.BLUEPRINT_NOT_FOUND,
      BOLT_ERROR_CODES.WEEK_NOT_FOUND,
      BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID,
    ],
    expects_full_coverage: true,
  },
  {
    stage: 'creator-asset-generation',
    description: 'Renders / queues creator assets for the autonomous / attachment-required rows.',
    codes: [
      BOLT_ERROR_CODES.CREATOR_ASSET_TIMEOUT,
      BOLT_ERROR_CODES.CREATOR_ASSET_PROVIDER_FAILURE,
      BOLT_ERROR_CODES.CREATOR_ASSET_RENDER_FAILED,
      BOLT_ERROR_CODES.CREATOR_ASSET_SAVE_FAILED,
      BOLT_ERROR_CODES.CREATOR_ASSET_QUEUE_FAILURE,
      BOLT_ERROR_CODES.CREATOR_ASSET_INVALID_REQUEST,
      BOLT_ERROR_CODES.CREATOR_ASSET_CONTEXT_INCOMPLETE,
      BOLT_ERROR_CODES.CREATOR_ASSET_DAILY_PLANS_LOAD_FAILED,
    ],
    expects_full_coverage: true,
  },
  {
    stage: 'schedule-structured-plan',
    description: 'Maps daily-plan rows to scheduled_posts and persists them with target accounts.',
    codes: [
      BOLT_ERROR_CODES.SCHEDULING_PLAN_INVALID,
      BOLT_ERROR_CODES.SCHEDULING_CAMPAIGN_NOT_FOUND,
      BOLT_ERROR_CODES.SCHEDULING_CONFIG_INCOMPLETE,
      BOLT_ERROR_CODES.SCHEDULING_NOT_ELIGIBLE,
      BOLT_ERROR_CODES.SCHEDULING_STALE_PLAN_VERSION,
      BOLT_ERROR_CODES.SCHEDULING_CREATOR_OUTPUT_INVALID,
      BOLT_ERROR_CODES.SCHEDULING_USER_RESOLUTION_FAILED,
      BOLT_ERROR_CODES.SCHEDULING_SOCIAL_ACCOUNTS_FAILED,
      BOLT_ERROR_CODES.SCHEDULING_PLATFORM_UNSUPPORTED,
      BOLT_ERROR_CODES.SCHEDULING_CONTENT_TYPE_UNSUPPORTED,
      BOLT_ERROR_CODES.SCHEDULING_INVALID_SCHEDULED_TIME,
      BOLT_ERROR_CODES.SCHEDULING_ACCOUNT_PLATFORM_MISMATCH,
      BOLT_ERROR_CODES.SCHEDULING_NO_ACCOUNT_FOR_PLATFORM,
      BOLT_ERROR_CODES.SCHEDULED_POST_PERSISTENCE_FAILED,
    ],
    expects_full_coverage: true,
  },
  {
    stage: 'pipeline-outer',
    description: 'Outer safety net — any throw NOT caught by a per-stage catch surfaces here.',
    codes: [
      // No native codes — the outer catch wraps whatever bubbled up.
      // The classifier defaults this to PROVIDER_TIMEOUT (most common
      // cause: a stage overran its budget).
    ],
    expects_full_coverage: false,
  },
];

export interface TaxonomyEntry {
  code: BoltErrorCode;
  category: BoltFailureCategory;
  message: string;
  stages: string[];
}

/** Inverse view: per-code, which stages can emit it. */
export function buildCodeIndex(): TaxonomyEntry[] {
  const index = new Map<BoltErrorCode, Set<string>>();
  for (const entry of BOLT_STAGE_TAXONOMY) {
    for (const code of entry.codes) {
      const set = index.get(code) ?? new Set<string>();
      set.add(entry.stage);
      index.set(code, set);
    }
  }
  const out: TaxonomyEntry[] = [];
  for (const code of Object.values(BOLT_ERROR_CODES)) {
    const stages = index.get(code as BoltErrorCode);
    out.push({
      code: code as BoltErrorCode,
      category: BOLT_ERROR_CODE_CATEGORY[code as BoltErrorCode],
      message: BOLT_ERROR_CODE_FRIENDLY_MESSAGES[code as BoltErrorCode],
      stages: stages ? [...stages].sort() : [],
    });
  }
  return out;
}

/** Coverage rollups for the dashboard / report. */
export function getTaxonomyCoverage(): {
  total_codes: number;
  total_stages: number;
  codes_with_stage: number;
  codes_without_stage: BoltErrorCode[];
  stages_with_codes: number;
  stages_without_codes: string[];
  coverage_percentage: number;
} {
  const index = buildCodeIndex();
  const totalCodes = index.length;
  const codesWithStage = index.filter((e) => e.stages.length > 0).length;
  const codesWithoutStage = index.filter((e) => e.stages.length === 0).map((e) => e.code);
  const stagesWithCodes = BOLT_STAGE_TAXONOMY.filter((s) => s.codes.length > 0).length;
  const stagesWithoutCodes = BOLT_STAGE_TAXONOMY.filter((s) => s.codes.length === 0).map((s) => s.stage);
  return {
    total_codes: totalCodes,
    total_stages: BOLT_STAGE_TAXONOMY.length,
    codes_with_stage: codesWithStage,
    codes_without_stage: codesWithoutStage,
    stages_with_codes: stagesWithCodes,
    stages_without_codes: stagesWithoutCodes,
    coverage_percentage: Math.round((codesWithStage / totalCodes) * 100),
  };
}
