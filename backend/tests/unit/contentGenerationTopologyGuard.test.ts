/**
 * Generic content processor — topology guard.
 *
 * processContentGenerationJob owns only the content-* queues. In production a
 * second, generic consumer on analytics-ingestion (and the creator queues) took
 * dedicated jobs, called the model to generate angles, then crashed on
 * `CONTENT_TYPE_CONFIG[undefined].target_words` — and an exhausted job was lost.
 * The guard must refuse such a job BEFORE any model/provider call, billing or
 * admission step, while legitimate content-* jobs flow exactly as before.
 */

// ── Model / provider tripwire ────────────────────────────────────────────────
jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: jest.fn(async () => ({ output: '{}' })),
  generateCampaignPlan: jest.fn(),
}));
jest.mock('../../../lib/content/unifiedLongFormEngine', () => ({
  runUnifiedLongFormGeneration: jest.fn(async () => ({ ok: true, body: 'long-form result' })),
}));
jest.mock('../../../lib/content/buildContentContext', () => ({
  buildContentContext: jest.fn(async () => null),
}));
jest.mock('../../services/contentGeneration/platformVariantGenerator', () => ({
  renderPlatformVariantsFromBlueprint: jest.fn(async () => []),
}));
jest.mock('../../services/contentFeedbackLoop', () => ({ recordQuickToneFeedback: jest.fn(async () => undefined) }));
jest.mock('../../services/pricingService', () => ({ estimateLlmCostUsd: jest.fn(async () => 0.0001) }));

// ── Billing / admission seams (all dark / passthrough) ───────────────────────
jest.mock('../../services/billing/creditEconomyShadow', () => ({
  emitCreditEconomyShadowEvaluation: jest.fn(async () => undefined),
}));
jest.mock('../../services/billing/admissionControl', () => ({
  evaluateActivityAdmission: jest.fn(async () => ({ decision: 'passthrough' })),
}));
jest.mock('../../services/billing/billingFeatureFlags', () => ({
  isBillingFlagEnabled: jest.fn(async () => ({ enabled: false })),
  BILLING_FLAGS: { RESERVATIONS_REQUIRED: 'billing.reservations_required' },
}));
jest.mock('../../services/billing/creditEconomyActivation', () => ({
  getCreditEconomyExecutionMode: jest.fn(async () => 'off'),
}));
jest.mock('../../services/creditExecutionService', () => ({
  executeWithEntryConsumption: jest.fn(),
  makeIdempotencyKey: jest.fn(),
}));

import { processContentGenerationJob } from '../../queue/jobProcessors/contentGenerationProcessor';
import { GenericContentJobRejectedError } from '../../queue/jobProcessors/genericContentJobGuard';
import { unifiedEngine } from '../../services/unifiedContentGenerationEngine';
import { runCompletionWithOperation } from '../../services/aiGateway';
import { runUnifiedLongFormGeneration } from '../../../lib/content/unifiedLongFormEngine';
import { evaluateActivityAdmission } from '../../services/billing/admissionControl';
import { isBillingFlagEnabled } from '../../services/billing/billingFeatureFlags';
import { emitCreditEconomyShadowEvaluation } from '../../services/billing/creditEconomyShadow';

type TestJob = { id: string; queueName?: string; data: unknown; updateProgress: jest.Mock };
const makeJob = (queueName: string | undefined, data: unknown): TestJob => ({
  id: 'job-1',
  queueName,
  data,
  updateProgress: jest.fn(),
});
const run = (job: TestJob) => processContentGenerationJob(job as never);

const ANGLE = {
  type: 'analytical' as const,
  label: 'Analytical',
  title: 'Angle title',
  angle_summary: 'Angle summary',
  hook: 'Angle hook',
};
const BLUEPRINT = { hook: 'A strong opening hook here', key_points: ['First point', 'Second point'], cta: 'Book a demo' };

let generateAngles: jest.SpyInstance;
let generateMasterContent: jest.SpyInstance;
let validateContentQuality: jest.SpyInstance;
let generateEngagementResponse: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  generateAngles = jest.spyOn(unifiedEngine, 'generateAngles').mockResolvedValue([ANGLE]);
  generateMasterContent = jest.spyOn(unifiedEngine, 'generateMasterContent').mockResolvedValue(BLUEPRINT as never);
  validateContentQuality = jest.spyOn(unifiedEngine, 'validateContentQuality').mockReturnValue({ pass: true } as never);
  generateEngagementResponse = jest.spyOn(unifiedEngine, 'generateEngagementResponse').mockResolvedValue('Thanks for asking!' as never);
});
afterEach(() => jest.restoreAllMocks());

/** Nothing that costs money, charges credits or touches a provider ran. */
function expectNoModelOrBillingCall() {
  expect(runCompletionWithOperation).not.toHaveBeenCalled();
  expect(generateAngles).not.toHaveBeenCalled();
  expect(generateMasterContent).not.toHaveBeenCalled();
  expect(generateEngagementResponse).not.toHaveBeenCalled();
  expect(runUnifiedLongFormGeneration).not.toHaveBeenCalled();
  expect(evaluateActivityAdmission).not.toHaveBeenCalled();
  expect(isBillingFlagEnabled).not.toHaveBeenCalled();
  expect(emitCreditEconomyShadowEvaluation).not.toHaveBeenCalled();
}

async function expectRejected(job: TestJob, reason: string) {
  const error = await run(job).then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(GenericContentJobRejectedError);
  expect((error as GenericContentJobRejectedError).reason).toBe(reason);
  expect((error as Error).message).toContain('No model or provider call was made');
  expectNoModelOrBillingCall();
}

describe('generic content guard — jobs from queues the generic processor does not own', () => {
  // Realistic payloads, copied from each queue's real producer.
  const cases: Array<[string, unknown]> = [
    ['analytics-ingestion', { type: 'oauth-refresh' }],
    ['analytics-ingestion', { type: 'daily-growth' }],
    ['whatsapp-broadcast', { broadcastId: 'b-1', batchIndex: 0 }],
    ['whatsapp-webhook', { payload: { entry: [] } }],
    ['creator-carousel', { bolt_payload: { daily_plan_id: 'r-1' }, company_id: 'c-1', content_type: 'image' }],
    // Valid generic content types — only the queue check can refuse these.
    ['creator-video', { company_id: 'c-1', content_type: 'video_script', topic: 't', creator_context: {} }],
    ['creator-carousel', { company_id: 'c-1', content_type: 'carousel', topic: 't', creator_context: {} }],
    ['creator-story', { company_id: 'c-1', content_type: 'story', topic: 't', creator_context: {} }],
    ['bolt-content-jobs', { company_id: 'c-1', content_type: 'post', topic: 't' }],
    ['longform-unified', { input: { topic: 't' }, meta: {} }],
  ];

  it.each(cases)('refuses a %s job before any model call', async (queue, data) => {
    await expectRejected(makeJob(queue, data), 'non_generic_queue');
  });

  it('refuses a job with no queue name', async () => {
    await expectRejected(makeJob(undefined, { company_id: 'c-1', content_type: 'post', topic: 't' }), 'non_generic_queue');
  });

  it('reproduces the production loss: an oauth-refresh job no longer reaches the model', async () => {
    const error = await run(makeJob('analytics-ingestion', { type: 'oauth-refresh' })).then(() => null, (e: unknown) => e);
    expect(String(error)).not.toContain('target_words');
    expect(runCompletionWithOperation).not.toHaveBeenCalled();
  });

  it('the rejection is an ordinary Error, so BullMQ retries and dead-lettering still apply', async () => {
    const error = await run(makeJob('analytics-ingestion', { type: 'daily-growth' })).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('GenericContentJobRejectedError');
  });
});

describe('generic content guard — non-generic payloads on a generic queue', () => {
  it('refuses a dedicated analytics payload', async () => {
    await expectRejected(makeJob('content-blog', { type: 'daily-growth' }), 'missing_company_id');
  });

  it('refuses a creator-row payload', async () => {
    await expectRejected(
      makeJob('content-post', { bolt_payload: { daily_plan_id: 'r-1' }, company_id: 'c-1', content_type: 'post' }),
      'dedicated_payload',
    );
  });

  it('refuses a content type the engine cannot generate', async () => {
    await expectRejected(makeJob('content-post', { company_id: 'c-1', content_type: 'image', topic: 't' }), 'unsupported_content_type');
  });

  it.each(['toString', 'constructor', '__proto__'])('refuses an inherited property name as content type (%s)', async (contentType) => {
    await expectRejected(makeJob('content-post', { company_id: 'c-1', content_type: contentType, topic: 't' }), 'unsupported_content_type');
  });

  it('refuses a missing content type', async () => {
    await expectRejected(makeJob('content-post', { company_id: 'c-1', topic: 't' }), 'unsupported_content_type');
  });

  it('refuses an empty company id', async () => {
    await expectRejected(makeJob('content-post', { company_id: '', content_type: 'post', topic: 't' }), 'missing_company_id');
  });

  it('refuses a bulk payload without items', async () => {
    await expectRejected(makeJob('content-engagement', { company_id: 'c-1', content_type: 'engagement_response', bulk_mode: true }), 'bulk_without_items');
  });

  it.each([[null], [[]], ['text']])('refuses a non-object payload (%p)', async (data) => {
    await expectRejected(makeJob('content-post', data), 'payload_not_object');
  });
});

describe('legitimate content-* processing is unchanged', () => {
  it('single post → angles, master content, validation, full text', async () => {
    const result = await run(makeJob('content-post', { company_id: 'c-1', content_type: 'post', topic: 'Pricing' }));
    expect(generateAngles).toHaveBeenCalledTimes(1);
    expect(generateAngles.mock.calls[0][0]).toMatchObject({ company_id: 'c-1', content_type: 'post', topic: 'Pricing' });
    expect(generateMasterContent).toHaveBeenCalledTimes(1);
    expect(generateMasterContent.mock.calls[0][1]).toMatchObject(ANGLE); // selectOptimalAngle adds its score
    expect(validateContentQuality).toHaveBeenCalledWith(BLUEPRINT, 'post');
    expect(result.master_content).toBe('A strong opening hook here\n\nFirst point\n\nSecond point\n\nBook a demo');
    expect(result.blueprint).toEqual(BLUEPRINT);
    expect(evaluateActivityAdmission).toHaveBeenCalledTimes(1);
  });

  it('long-form blog → redirected to the unified long-form engine', async () => {
    const result = await run(makeJob('content-blog', { company_id: 'c-1', content_type: 'blog', topic: 'Guide' }));
    expect(runUnifiedLongFormGeneration).toHaveBeenCalledTimes(1);
    expect((runUnifiedLongFormGeneration as jest.Mock).mock.calls[0][0]).toMatchObject({ company_id: 'c-1', contentType: 'blog', topic: 'Guide' });
    expect(result).toMatchObject({ redirected: true, unified_engine: 'unifiedLongFormEngine' });
    expect(generateAngles).not.toHaveBeenCalled();
  });

  it('engagement response → the fast engagement pipeline', async () => {
    const result = await run(makeJob('content-engagement', {
      company_id: 'c-1', content_type: 'engagement_response', original_message: 'hi', platform: 'linkedin', tone: 'warm',
    }));
    expect(generateEngagementResponse).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ response: 'Thanks for asking!', platform: 'linkedin' });
  });

  it('bulk engagement → one generation per item', async () => {
    const result = await run(makeJob('content-engagement', {
      company_id: 'c-1',
      content_type: 'engagement_response',
      bulk_mode: true,
      items: [
        { message_id: 'm1', original_message: 'a', platform: 'x' },
        { message_id: 'm2', original_message: 'b', platform: 'x' },
      ],
    }));
    expect(generateEngagementResponse).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ total_items: 2, successful: 2, failed: 0 });
  });

  it.each(['content-whitepaper', 'content-story', 'content-newsletter', 'content-refinement'])(
    '%s accepts a supported content type',
    async (queue) => {
      await run(makeJob(queue, { company_id: 'c-1', content_type: 'thread', topic: 't' }));
      expect(generateAngles).toHaveBeenCalledTimes(1);
      expect(generateMasterContent).toHaveBeenCalledTimes(1);
    },
  );
});
