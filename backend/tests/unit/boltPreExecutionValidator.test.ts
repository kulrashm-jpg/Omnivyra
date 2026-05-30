/**
 * Pre-execution validator (Part 1) regression tests.
 *
 * Covers: unsupported creator format, unsupported text format,
 * malformed strategic theme, stale generatedCampaignId, missing
 * campaign version, sibling-isolation behavior, sync vs async modes.
 */

import { validateBoltPreExecution } from '../../services/boltPreExecutionValidator';
import { BOLT_ERROR_CODES } from '../../../lib/shared/bolt/boltErrorCodes';

// Tests that require the DB preflight stub the campaign-version helper.
jest.mock('../../services/boltCampaignVersionGuard', () => ({
  preflightCampaignVersion: jest.fn(),
}));
const { preflightCampaignVersion } = jest.requireMock('../../services/boltCampaignVersionGuard');

beforeEach(() => {
  preflightCampaignVersion.mockReset();
  preflightCampaignVersion.mockResolvedValue({ ok: true });
});

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    companyId: '11111111-1111-1111-1111-111111111111',
    generatedCampaignId: null,
    sourceStrategicTheme: { title: 'Test theme' },
    executionConfig: {
      campaign_mode: 'text',
      text_formats: ['post'],
      target_audience: 'devs',
      campaign_goal: 'awareness',
      frequency_per_week: 3,
      campaign_duration: 2,
      tentative_start: '2026-06-01',
    } as Record<string, unknown>,
    outcomeView: 'week_plan' as const,
    selectedPlatforms: ['linkedin'],
    ...overrides,
  };
}

describe('validateBoltPreExecution — happy path', () => {
  test('valid text strategy passes', async () => {
    const r = await validateBoltPreExecution(baseInput());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.campaignMode).toBe('text');
  });
});

describe('validateBoltPreExecution — format rejection', () => {
  test('unsupported text format produces UNSUPPORTED_TEXT_FORMAT', async () => {
    const r = await validateBoltPreExecution(
      baseInput({ executionConfig: { ...baseInput().executionConfig, text_formats: ['post', 'whitepaper'] } })
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.UNSUPPORTED_TEXT_FORMAT)).toBe(true);
  });

  test('unsupported creator format produces UNSUPPORTED_CREATOR_FORMAT', async () => {
    const r = await validateBoltPreExecution(
      baseInput({
        executionConfig: {
          ...baseInput().executionConfig,
          campaign_mode: 'creator',
          content_formats: ['carousel', 'made_up_format'],
          text_formats: undefined,
        },
      })
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.UNSUPPORTED_CREATOR_FORMAT)).toBe(true);
  });
});

describe('validateBoltPreExecution — required fields', () => {
  test('missing target_audience', async () => {
    const r = await validateBoltPreExecution(
      baseInput({ executionConfig: { ...baseInput().executionConfig, target_audience: '' } })
    );
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.STRATEGY_MISSING_AUDIENCE)).toBe(true);
  });
  test('missing campaign_goal', async () => {
    const r = await validateBoltPreExecution(
      baseInput({ executionConfig: { ...baseInput().executionConfig, campaign_goal: '' } })
    );
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.STRATEGY_MISSING_GOAL)).toBe(true);
  });
  test('invalid frequency', async () => {
    const r = await validateBoltPreExecution(
      baseInput({ executionConfig: { ...baseInput().executionConfig, frequency_per_week: 0 } })
    );
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.STRATEGY_INVALID_FREQUENCY)).toBe(true);
  });
  test('out-of-range duration', async () => {
    const r = await validateBoltPreExecution(
      baseInput({ executionConfig: { ...baseInput().executionConfig, campaign_duration: 8 } })
    );
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.STRATEGY_INVALID_DURATION)).toBe(true);
  });
});

describe('validateBoltPreExecution — strategic theme', () => {
  test('malformed theme (not an object) is rejected', async () => {
    const r = await validateBoltPreExecution(baseInput({ sourceStrategicTheme: 'not-an-object' }));
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.THEME_INVALID_SHAPE)).toBe(true);
  });
  test('theme missing title is rejected', async () => {
    const r = await validateBoltPreExecution(baseInput({ sourceStrategicTheme: { description: 'no title' } }));
    expect(r.errors.some((e) => e.code === BOLT_ERROR_CODES.THEME_MISSING_REQUIRED_FIELD)).toBe(true);
  });
});

describe('validateBoltPreExecution — campaign version preflight', () => {
  test('checkCampaignVersion=false skips the DB lookup', async () => {
    await validateBoltPreExecution(baseInput({
      generatedCampaignId: '22222222-2222-2222-2222-222222222222',
      checkCampaignVersion: false,
    }));
    expect(preflightCampaignVersion).not.toHaveBeenCalled();
  });
  test('preflight ok → validation passes', async () => {
    preflightCampaignVersion.mockResolvedValueOnce({ ok: true, latestVersionId: 'v1' });
    const r = await validateBoltPreExecution(baseInput({
      generatedCampaignId: '22222222-2222-2222-2222-222222222222',
      checkCampaignVersion: true,
    }));
    expect(r.ok).toBe(true);
  });
  test('preflight not-found bubbles up as CAMPAIGN_VERSION_NOT_FOUND', async () => {
    const { BoltError } = jest.requireActual('../../../lib/shared/bolt/boltErrorCodes');
    preflightCampaignVersion.mockResolvedValueOnce({
      ok: false,
      error: new BoltError(BOLT_ERROR_CODES.CAMPAIGN_VERSION_NOT_FOUND, 'not found'),
    });
    const r = await validateBoltPreExecution(baseInput({
      generatedCampaignId: '22222222-2222-2222-2222-222222222222',
      checkCampaignVersion: true,
    }));
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe(BOLT_ERROR_CODES.CAMPAIGN_VERSION_NOT_FOUND);
  });
  test('preflight throwing is contained and reported, not propagated', async () => {
    preflightCampaignVersion.mockRejectedValueOnce(new Error('db down'));
    const r = await validateBoltPreExecution(baseInput({
      generatedCampaignId: '22222222-2222-2222-2222-222222222222',
      checkCampaignVersion: true,
    }));
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe(BOLT_ERROR_CODES.CAMPAIGN_VERSION_NOT_FOUND);
    expect(r.errors[0].message).toMatch(/db down/);
  });
});

describe('validateBoltPreExecution — sibling isolation', () => {
  test('one invalid strategy validation produces only its own errors, no cross-talk', async () => {
    const valid = baseInput();
    const invalid = baseInput({ executionConfig: { ...baseInput().executionConfig, text_formats: ['blog'] } });
    const [r1, r2] = await Promise.all([
      validateBoltPreExecution(valid),
      validateBoltPreExecution(invalid),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect(r2.errors.every((e) => e.code !== BOLT_ERROR_CODES.STRATEGY_MISSING_FORMATS)).toBe(true);
  });
});
