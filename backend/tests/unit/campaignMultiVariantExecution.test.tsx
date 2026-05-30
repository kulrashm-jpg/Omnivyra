/**
 * @jest-environment jsdom
 *
 * Campaign Multi-Variant Execution Completion — focused tests covering:
 *
 *   Phase 1  resolveCampaignVariantPlan() multi-decision contract
 *   Phase 2  runCampaignVariantFanOut() loop semantics
 *   Phase 3  single_variant + best_variant produce exactly 1 asset
 *   Phase 4  per-asset attribution (variant_id / variant_family /
 *            strategy_id / experiment_id) preserved across invocations
 *   Phase 5  every fan-out invocation registers with the tracker
 *            (experiment mode → 'experiment', non-experiment → 'tracking')
 *   Phase 6  Back-compat — `generated_asset` mirrors first success;
 *            `generated_assets[]` always present.
 *
 * The orchestrator is stubbed via a jest.mock so the loop semantics
 * are verified without exercising network / DB / engine.
 */

import '@testing-library/jest-dom';
import {
  clearExperimentTracker,
  listExperiments,
} from '../../services/creator/variantExperimentTracker';
import {
  clearVariantTelemetry,
} from '../../services/creator/variantPerformanceTelemetry';
import {
  resolveCampaignAppliedVariant,
  resolveCampaignVariantPlan,
} from '../../services/creator/campaignVariantApplier';
import { applyVariantConfigToExecutionConfig } from '../../../lib/variants/campaignVariantConfig';

/* ── Stub the orchestrator so we observe loop semantics only ──── */

jest.mock('../../services/creator/creatorOrchestrator', () => {
  const runs: Array<Record<string, unknown>> = [];
  return {
    __runs: runs,
    runCreatorOrchestration: jest.fn(async (input: any) => {
      runs.push(input);
      return {
        output: {
          intent_type: 'creator',
          asset_type: 'image',
          asset_instruction: { blueprint: {} },
          asset_payload: {
            asset_kind: 'image',
            media_bundle: {
              metadata: {
                applied_variant: input.appliedVariant ?? null,
                variant_id: input.appliedVariant?.variant_id ?? null,
                variant_family: input.appliedVariant?.variant_family ?? null,
              },
            },
          },
          packaging: { caption: '', hashtags: [], cta: '', platform_variants: {} },
          metadata: {},
        },
        renderStrategy: 'skipped',
        renderJob: null,
        persistedAssetId: `asset-${input.appliedVariant?.variant_family ?? 'none'}`,
        readiness: undefined,
        lifecycleTransition: null,
      };
    }),
  };
});

const orchestratorMock = require('../../services/creator/creatorOrchestrator') as {
  __runs: Array<Record<string, unknown>>;
  runCreatorOrchestration: jest.Mock;
};

import { runCampaignVariantFanOut } from '../../services/creator/campaignVariantFanOut';

const COMPANY = 'co-fanout';
const STRATEGY = 'image:quote-image';

beforeEach(() => {
  clearExperimentTracker();
  clearVariantTelemetry();
  orchestratorMock.__runs.length = 0;
  orchestratorMock.runCreatorOrchestration.mockClear();
});

/* ── Phase 1: resolveCampaignVariantPlan ────────────────────────── */

describe('Phase 1 — resolveCampaignVariantPlan()', () => {
  test('returns null when no variant_strategy persisted', () => {
    expect(resolveCampaignVariantPlan({
      campaign: { campaign_snapshot: { execution_config: {} } },
      companyId: COMPANY,
    })).toBeNull();
  });

  test('single_variant → 1 decision, experiment_id=null', () => {
    const plan = resolveCampaignVariantPlan({
      campaign: {
        campaign_snapshot: {
          execution_config: applyVariantConfigToExecutionConfig(null, {
            strategy_id: STRATEGY,
            variant_mode: 'v2',
          }),
        },
      },
      companyId: COMPANY,
    });
    expect(plan).not.toBeNull();
    expect(plan!.mode).toBe('single_variant');
    expect(plan!.decisions).toHaveLength(1);
    expect(plan!.decisions[0].variant_family).toBe('v2');
    expect(plan!.experiment_id).toBeNull();
  });

  test('best_variant → 1 decision, experiment_id=null', () => {
    const plan = resolveCampaignVariantPlan({
      campaign: {
        campaign_snapshot: {
          execution_config: applyVariantConfigToExecutionConfig(null, {
            strategy_id: STRATEGY,
            variant_mode: 'best_variant',
          }),
        },
      },
      companyId: COMPANY,
    });
    expect(plan).not.toBeNull();
    expect(plan!.mode).toBe('best_variant');
    expect(plan!.decisions).toHaveLength(1);
    expect(plan!.experiment_id).toBeNull();
  });

  test('top_3_variants → N decisions, experiment_id=null', () => {
    const plan = resolveCampaignVariantPlan({
      campaign: {
        campaign_snapshot: {
          execution_config: applyVariantConfigToExecutionConfig(null, {
            strategy_id: STRATEGY,
            variant_mode: 'top_3_variants',
          }),
        },
      },
      companyId: COMPANY,
    });
    expect(plan).not.toBeNull();
    expect(plan!.mode).toBe('top_3_variants');
    expect(plan!.decisions.length).toBeGreaterThan(1);
    expect(plan!.experiment_id).toBeNull();
    // Decisions are ranked + distinct families.
    const families = plan!.decisions.map((d) => d.variant_family);
    expect(new Set(families).size).toBe(families.length);
  });

  test('experiment → N decisions, experiment_id is a tracker id', () => {
    const plan = resolveCampaignVariantPlan({
      campaign: {
        campaign_snapshot: {
          execution_config: applyVariantConfigToExecutionConfig(null, {
            strategy_id: STRATEGY,
            variant_mode: 'experiment',
          }),
        },
      },
      companyId: COMPANY,
      campaignId: 'campaign-X',
    });
    expect(plan).not.toBeNull();
    expect(plan!.mode).toBe('experiment');
    expect(plan!.decisions.length).toBeGreaterThan(1);
    expect(plan!.experiment_id).toMatch(/^exp_/);
  });

  test('resolveCampaignAppliedVariant (back-compat) returns first decision', () => {
    const applied = resolveCampaignAppliedVariant({
      campaign: {
        campaign_snapshot: {
          execution_config: applyVariantConfigToExecutionConfig(null, {
            strategy_id: STRATEGY,
            variant_mode: 'top_3_variants',
          }),
        },
      },
      companyId: COMPANY,
    });
    expect(applied).not.toBeNull();
    expect(applied!.variant_family).toBe('v1');
  });
});

/* ── Phase 2 + 3: Fan-out loop semantics ────────────────────────── */

describe('Phase 2 + 3 — runCampaignVariantFanOut()', () => {
  function planFor(mode: 'single_variant' | 'best_variant' | 'top_3_variants' | 'experiment') {
    return resolveCampaignVariantPlan({
      campaign: {
        campaign_snapshot: {
          execution_config: applyVariantConfigToExecutionConfig(null, {
            strategy_id: STRATEGY,
            variant_mode: mode === 'single_variant' ? 'v1' : mode,
          }),
        },
      },
      companyId: COMPANY,
      campaignId: 'campaign-A',
    })!;
  }

  const baseInput = {
    campaignId: 'campaign-A',
    companyId: COMPANY,
    userId: null,
    topic: 'topic',
    contentType: 'image',
    targetPlatforms: ['linkedin'],
    origin: 'direct' as const,
  };

  test('single_variant → exactly 1 orchestrator invocation', async () => {
    const plan = planFor('single_variant');
    const result = await runCampaignVariantFanOut({ plan, orchestratorInput: baseInput });
    expect(orchestratorMock.runCreatorOrchestration).toHaveBeenCalledTimes(1);
    expect(result.generated_assets).toHaveLength(1);
    expect(result.generated_asset).not.toBeNull();
  });

  test('best_variant → exactly 1 orchestrator invocation', async () => {
    const plan = planFor('best_variant');
    const result = await runCampaignVariantFanOut({ plan, orchestratorInput: baseInput });
    expect(orchestratorMock.runCreatorOrchestration).toHaveBeenCalledTimes(1);
    expect(result.generated_assets).toHaveLength(1);
  });

  test('top_3_variants → N orchestrator invocations matching plan.decisions', async () => {
    const plan = planFor('top_3_variants');
    const result = await runCampaignVariantFanOut({ plan, orchestratorInput: baseInput });
    expect(orchestratorMock.runCreatorOrchestration).toHaveBeenCalledTimes(plan.decisions.length);
    expect(result.generated_assets).toHaveLength(plan.decisions.length);
  });

  test('experiment → N orchestrator invocations matching plan.decisions', async () => {
    const plan = planFor('experiment');
    const result = await runCampaignVariantFanOut({ plan, orchestratorInput: baseInput });
    expect(orchestratorMock.runCreatorOrchestration).toHaveBeenCalledTimes(plan.decisions.length);
    expect(result.generated_assets).toHaveLength(plan.decisions.length);
    expect(result.experiment_id).toMatch(/^exp_/);
  });
});

/* ── Phase 4: Per-asset attribution ─────────────────────────────── */

describe('Phase 4 — per-asset attribution', () => {
  test('each invocation receives its own appliedVariant', async () => {
    const plan = resolveCampaignVariantPlan({
      campaign: {
        campaign_snapshot: {
          execution_config: applyVariantConfigToExecutionConfig(null, {
            strategy_id: STRATEGY,
            variant_mode: 'top_3_variants',
          }),
        },
      },
      companyId: COMPANY,
    })!;
    await runCampaignVariantFanOut({
      plan,
      orchestratorInput: {
        campaignId: 'campaign-A',
        companyId: COMPANY,
        userId: null,
        topic: 'topic',
        contentType: 'image',
        targetPlatforms: ['linkedin'],
        origin: 'direct',
      },
    });
    expect(orchestratorMock.__runs).toHaveLength(plan.decisions.length);
    for (let i = 0; i < plan.decisions.length; i++) {
      const applied = (orchestratorMock.__runs[i] as any).appliedVariant;
      expect(applied.strategy_id).toBe(STRATEGY);
      expect(applied.variant_id).toBe(plan.decisions[i].variant_id);
      expect(applied.variant_family).toBe(plan.decisions[i].variant_family);
    }
  });

  test('generated_assets carry variant + strategy + experiment_id', async () => {
    const plan = resolveCampaignVariantPlan({
      campaign: {
        campaign_snapshot: {
          execution_config: applyVariantConfigToExecutionConfig(null, {
            strategy_id: STRATEGY,
            variant_mode: 'experiment',
          }),
        },
      },
      companyId: COMPANY,
      campaignId: 'campaign-A',
    })!;
    const result = await runCampaignVariantFanOut({
      plan,
      orchestratorInput: {
        campaignId: 'campaign-A',
        companyId: COMPANY,
        userId: null,
        topic: 'topic',
        contentType: 'image',
        targetPlatforms: ['linkedin'],
        origin: 'direct',
      },
    });
    for (const asset of result.generated_assets) {
      expect(asset.strategy_id).toBe(STRATEGY);
      expect(asset.variant_id).toBeTruthy();
      expect(asset.variant_family).toMatch(/^v[123]$/);
      expect(asset.experiment_id).toBe(plan.experiment_id);
    }
  });
});

/* ── Phase 5: Tracker registration ──────────────────────────────── */

describe('Phase 5 — tracker registration', () => {
  test('top_3_variants registers a tracking-type entry covering all decisions', () => {
    const plan = resolveCampaignVariantPlan({
      campaign: {
        campaign_snapshot: {
          execution_config: applyVariantConfigToExecutionConfig(null, {
            strategy_id: STRATEGY,
            variant_mode: 'top_3_variants',
          }),
        },
      },
      companyId: COMPANY,
    })!;
    const rows = listExperiments({ companyId: COMPANY, trackingType: 'tracking' });
    expect(rows).toHaveLength(1);
    expect(rows[0].assets.length).toBe(plan.decisions.length);
  });

  test('experiment mode registers an experiment-type entry with N assets', () => {
    const plan = resolveCampaignVariantPlan({
      campaign: {
        campaign_snapshot: {
          execution_config: applyVariantConfigToExecutionConfig(null, {
            strategy_id: STRATEGY,
            variant_mode: 'experiment',
          }),
        },
      },
      companyId: COMPANY,
    })!;
    const rows = listExperiments({ companyId: COMPANY, trackingType: 'experiment' });
    expect(rows).toHaveLength(1);
    expect(rows[0].experiment_id).toBe(plan.experiment_id);
    expect(rows[0].assets.length).toBe(plan.decisions.length);
    // Initial state is 'created' (advances when notifyExperimentAssetGenerated
    // fires inside the orchestrator — covered by variantFinalCorrectivePass).
    for (const asset of rows[0].assets) {
      expect(asset.state).toBe('created');
    }
  });

  test('single_variant + best_variant do NOT pollute experiment-type list', () => {
    resolveCampaignVariantPlan({
      campaign: {
        campaign_snapshot: {
          execution_config: applyVariantConfigToExecutionConfig(null, {
            strategy_id: STRATEGY,
            variant_mode: 'v1',
          }),
        },
      },
      companyId: COMPANY,
    });
    expect(listExperiments({ companyId: COMPANY, trackingType: 'experiment' })).toHaveLength(0);
    expect(listExperiments({ companyId: COMPANY, trackingType: 'tracking' })).toHaveLength(1);
  });
});

/* ── Phase 6: Output contract back-compat ───────────────────────── */

describe('Phase 6 — output contract back-compat', () => {
  test('generated_asset mirrors the first successful entry of generated_assets[]', async () => {
    const plan = resolveCampaignVariantPlan({
      campaign: {
        campaign_snapshot: {
          execution_config: applyVariantConfigToExecutionConfig(null, {
            strategy_id: STRATEGY,
            variant_mode: 'top_3_variants',
          }),
        },
      },
      companyId: COMPANY,
    })!;
    const result = await runCampaignVariantFanOut({
      plan,
      orchestratorInput: {
        campaignId: 'campaign-A',
        companyId: COMPANY,
        userId: null,
        topic: 'topic',
        contentType: 'image',
        targetPlatforms: ['linkedin'],
        origin: 'direct',
      },
    });
    expect(result.generated_asset).not.toBeNull();
    expect(result.generated_asset).toBe(result.generated_assets[0]);
    expect(result.generated_assets.length).toBeGreaterThan(1);
  });

  test('partial failure: remaining decisions still attempted; failed asset has ok=false', async () => {
    // Fail the second invocation only.
    orchestratorMock.runCreatorOrchestration.mockImplementationOnce(async (input: any) => ({
      output: { intent_type: 'creator', asset_type: 'image', asset_instruction: { blueprint: {} }, asset_payload: { asset_kind: 'image' }, packaging: { caption: '', hashtags: [], cta: '', platform_variants: {} }, metadata: {} },
      renderStrategy: 'skipped',
      renderJob: null,
      persistedAssetId: `asset-${input.appliedVariant?.variant_family}`,
      readiness: undefined,
      lifecycleTransition: null,
    }));
    orchestratorMock.runCreatorOrchestration.mockImplementationOnce(async () => {
      throw new Error('simulated render failure');
    });
    orchestratorMock.runCreatorOrchestration.mockImplementation(async (input: any) => ({
      output: { intent_type: 'creator', asset_type: 'image', asset_instruction: { blueprint: {} }, asset_payload: { asset_kind: 'image' }, packaging: { caption: '', hashtags: [], cta: '', platform_variants: {} }, metadata: {} },
      renderStrategy: 'skipped',
      renderJob: null,
      persistedAssetId: `asset-${input.appliedVariant?.variant_family}`,
      readiness: undefined,
      lifecycleTransition: null,
    }));
    const plan = resolveCampaignVariantPlan({
      campaign: {
        campaign_snapshot: {
          execution_config: applyVariantConfigToExecutionConfig(null, {
            strategy_id: STRATEGY,
            variant_mode: 'top_3_variants',
          }),
        },
      },
      companyId: COMPANY,
    })!;
    const result = await runCampaignVariantFanOut({
      plan,
      orchestratorInput: {
        campaignId: 'campaign-A',
        companyId: COMPANY,
        userId: null,
        topic: 'topic',
        contentType: 'image',
        targetPlatforms: ['linkedin'],
        origin: 'direct',
      },
    });
    expect(result.generated_assets).toHaveLength(plan.decisions.length);
    const failedAssets = result.generated_assets.filter((a) => !a.ok);
    expect(failedAssets).toHaveLength(1);
    expect(failedAssets[0].error).toMatch(/simulated render failure/);
    // First successful asset is still resolvable.
    expect(result.generated_asset).not.toBeNull();
    expect(result.generated_asset?.ok).toBe(true);
  });
});
