/**
 * Blueprint Execution Resolver unit tests.
 */

import {
  resolveExecutionBlueprint,
  checkExecutionBlueprintGuard,
  resolveAndGuardExecutionBlueprint,
  EXECUTION_SOURCE_VALIDATED,
} from '../../services/blueprintExecutionResolver';

const mkBlueprint = (weeks: number) => ({
  duration_weeks: weeks,
  weekly_plan: Array.from({ length: weeks }, (_, i) => ({
    week_number: i + 1,
    stage: 'awareness' as const,
    stage_objective: 'Test',
    psychological_goal: 'Attention',
    momentum_level: 'low',
    primary_recommendations: [{ topic: `Topic ${i + 1}` }],
    supporting_recommendations: [],
  })),
  progression_summary: 'Test campaign.',
});

describe('blueprintExecutionResolver', () => {
  describe('resolveExecutionBlueprint', () => {
    it('uses validated blueprint when present', () => {
      const validated = mkBlueprint(4);
      const raw = mkBlueprint(2);
      const result = {
        campaign_blueprint_validated: validated,
        campaign_blueprint: raw,
      };
      const resolved = resolveExecutionBlueprint(result);
      expect(resolved).toBe(validated);
      expect(resolved?.duration_weeks).toBe(4);
      expect(resolved?.weekly_plan).toHaveLength(4);
    });

    it('falls back to raw blueprint → validates → returns corrected when validated missing', () => {
      const raw = mkBlueprint(4);
      const result = {
        campaign_blueprint_validated: undefined,
        campaign_blueprint: raw,
      };
      const resolved = resolveExecutionBlueprint(result);
      expect(resolved).not.toBeNull();
      expect(resolved?.duration_weeks).toBe(4);
      expect(resolved?.weekly_plan).toBeDefined();
      expect(Array.isArray(resolved?.weekly_plan)).toBe(true);
    });

    it('returns null when no blueprint exists', () => {
      expect(resolveExecutionBlueprint(null)).toBeNull();
      expect(resolveExecutionBlueprint(undefined)).toBeNull();
      expect(resolveExecutionBlueprint({})).toBeNull();
      expect(
        resolveExecutionBlueprint({
          campaign_blueprint_validated: null,
          campaign_blueprint: null,
        })
      ).toBeNull();
    });

    it('never returns invalid weekly_plan (validation corrects structure)', () => {
      const raw = {
        duration_weeks: 4,
        weekly_plan: [
          {
            week_number: 1,
            stage: 'conversion',
            stage_objective: 'x',
            psychological_goal: 'x',
            momentum_level: 'peak',
            primary_recommendations: [],
            supporting_recommendations: [],
          },
          {
            week_number: 2,
            stage: 'awareness',
            stage_objective: 'x',
            psychological_goal: 'x',
            momentum_level: 'low',
            primary_recommendations: [],
            supporting_recommendations: [],
          },
        ],
        progression_summary: 'x',
      };
      const result = {
        campaign_blueprint_validated: undefined,
        campaign_blueprint: raw,
      };
      const resolved = resolveExecutionBlueprint(result);
      expect(resolved).not.toBeNull();
      expect(resolved?.weekly_plan).toBeDefined();
      expect(resolved!.weekly_plan.length).toBe(4);
    });
  });

  describe('checkExecutionBlueprintGuard', () => {
    it('returns safe failure when blueprint is null', () => {
      const out = checkExecutionBlueprintGuard(null);
      expect(out.ok).toBe(false);
      expect(out.failure).toEqual({
        status: 'no_execution_blueprint',
        reason: 'campaign blueprint missing or invalid',
      });
    });

    it('returns safe failure when blueprint is undefined', () => {
      const out = checkExecutionBlueprintGuard(undefined);
      expect(out.ok).toBe(false);
      expect(out.failure.status).toBe('no_execution_blueprint');
    });

    it('returns safe failure when weekly_plan is empty', () => {
      const out = checkExecutionBlueprintGuard({
        duration_weeks: 4,
        weekly_plan: [],
        progression_summary: 'x',
      });
      expect(out.ok).toBe(false);
      expect(out.failure.status).toBe('no_execution_blueprint');
    });

    it('returns ok when blueprint has valid weekly_plan', () => {
      const bp = mkBlueprint(4);
      const out = checkExecutionBlueprintGuard(bp);
      expect(out.ok).toBe(true);
      expect(out.blueprint).toBe(bp);
      expect(out.blueprint.weekly_plan).toHaveLength(4);
    });
  });

  describe('resolveAndGuardExecutionBlueprint', () => {
    it('returns execution guard failure when missing', () => {
      const out = resolveAndGuardExecutionBlueprint(null);
      expect(out.ok).toBe(false);
      expect(out.failure).toEqual({
        status: 'no_execution_blueprint',
        reason: 'campaign blueprint missing or invalid',
      });
    });

    it('returns blueprint with execution_source when valid', () => {
      const validated = mkBlueprint(4);
      const result = {
        campaign_blueprint_validated: validated,
        campaign_blueprint: mkBlueprint(2),
      };
      const out = resolveAndGuardExecutionBlueprint(result);
      expect(out.ok).toBe(true);
      expect(out.blueprint).toBe(validated);
      expect(out.execution_source).toBe(EXECUTION_SOURCE_VALIDATED);
    });
  });
});
