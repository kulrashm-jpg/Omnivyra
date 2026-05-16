import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { validateCreatorPublishSemanticsLive } from '../../services/creatorPublishValidation';
import {
  compareVisualRegressionSnapshots,
  createPerceptualVisualRegressionSnapshot,
  CREATOR_VISUAL_REGRESSION_BASELINE_SUITES,
} from '../../services/creatorVisualRegression';
import {
  listDurableCreatorRenderMetrics,
  purgeOldCreatorRenderMetrics,
  recordCreatorRenderMetric,
  summarizeDurableCreatorRenderMetrics,
} from '../../services/creatorRenderObservability';

describe('creator rollout closure', () => {
  it('revalidates live media OCR at publish time and rejects drift', async () => {
    const originalEndpoint = process.env.CREATOR_OCR_ENDPOINT;
    process.env.CREATOR_OCR_ENDPOINT = 'https://ocr.test/extract';
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        text: 'Book a demo now',
        confidence: 0.41,
        regions: [{ text: 'Book a demo now', confidence: 0.41, language: 'en' }],
      }),
      headers: { get: () => 'application/json' },
      arrayBuffer: async () => Buffer.from('{}').buffer,
    })) as unknown as typeof fetch;

    const result = await validateCreatorPublishSemanticsLive({
      platform: 'instagram',
      contentType: 'post',
      text: 'Clean post',
      mediaUrls: ['data:image/png;base64,ZmFrZS1wbmc='],
      creatorAttachmentMetadata: [{
        attachment_mode: 'supporting_visual',
        asset_composition_intent: { assetType: 'supporting_image', attachmentMode: 'supporting_visual' },
        renderer_id: 'supporting-image-renderer',
        render_manifest: {
          validationResult: { ok: true },
          ocrResult: { ok: true, confidence: 0.95, imageHash: 'old-hash' },
          typographySafetyResult: { ok: true },
          qualityScore: { clutterRisk: 1, readability: 90 },
          accessibility: { altText: 'A clean supporting visual for the post', readingOrder: ['visual'] },
          accessibilityValidation: { ok: true },
        },
      }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(expect.arrayContaining([
        'attachment_0_ocr_confidence_below_threshold',
        'attachment_0_ocr_cta_phrase_detected',
        'attachment_0_live_ocr_visible_text_in_supporting_visual',
      ]));
    }

    global.fetch = originalFetch;
    if (originalEndpoint === undefined) delete process.env.CREATOR_OCR_ENDPOINT;
    else process.env.CREATOR_OCR_ENDPOINT = originalEndpoint;
  });

  it('wires scheduler hard validation before scheduled post insert', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'pages/api/scheduler/schedule.ts'), 'utf8');
    expect(source).toContain('validateCreatorPublishSemantics');
    expect(source).toContain('CREATOR_ATTACHMENT_SCHEDULE_VALIDATION_FAILED');
    expect(source.indexOf('validateCreatorPublishSemantics')).toBeLessThan(source.indexOf(".from('scheduled_posts')"));
  });

  it('uses perceptual visual regression snapshots with baseline suites', async () => {
    const baselineBuffer = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const candidateBuffer = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#000000' } }).png().toBuffer();
    const baseline = await createPerceptualVisualRegressionSnapshot({ buffer: baselineBuffer, rendererId: 'banner-renderer', platform: 'linkedin', assetType: 'banner', width: 32, height: 32 });
    const candidate = await createPerceptualVisualRegressionSnapshot({ buffer: candidateBuffer, rendererId: 'banner-renderer', platform: 'linkedin', assetType: 'banner', width: 32, height: 32 });
    const result = compareVisualRegressionSnapshots({ baseline, candidate, maxDriftScore: 0.01 });
    expect(CREATOR_VISUAL_REGRESSION_BASELINE_SUITES).toEqual(expect.arrayContaining(['linkedin', 'instagram', 'infographic_layouts', 'carousel_layouts', 'brand_cards', 'banners']));
    expect(result.ok).toBe(false);
    expect(result.diffArtifact?.baselinePerceptualHash).toBeDefined();
  });

  it('exposes DLQ replay, timeout, and reconciliation operations', () => {
    const queueSource = fs.readFileSync(path.join(process.cwd(), 'backend/services/creatorRenderDurableQueue.ts'), 'utf8');
    const opsSource = fs.readFileSync(path.join(process.cwd(), 'pages/api/super-admin/creator-render-ops.ts'), 'utf8');
    expect(queueSource).toContain('withRenderTimeout');
    expect(queueSource).toContain('replayCreatorRenderDeadLetterJob');
    expect(queueSource).toContain('reconcileCreatorRenderQueue');
    expect(opsSource).toContain("action === 'replay_dlq'");
    expect(opsSource).toContain("action === 'reconcile'");
    expect(opsSource).toContain("action === 'purge_old_metrics'");
    expect(opsSource).toContain('drilldown');
  });

  it('persists durable observability through metric storage hooks', async () => {
    const metric = recordCreatorRenderMetric({ name: 'queue_reconciliation', tags: { renderer: 'carousel' } });
    expect(metric.name).toBe('queue_reconciliation');
    await expect(summarizeDurableCreatorRenderMetrics()).resolves.toBeDefined();
    await expect(listDurableCreatorRenderMetrics({ limit: 10 })).resolves.toBeDefined();
    await expect(purgeOldCreatorRenderMetrics({ olderThanDays: 30 })).resolves.toHaveProperty('purgedBefore');
    const migration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260668_creator_rollout_operations.sql'), 'utf8');
    expect(migration).toContain('creator_render_metrics');
    expect(migration).toContain('purge_old_creator_render_metrics');
  });
});
