import fs from 'fs';
import path from 'path';
import { runCreatorOcr, resolveCreatorOcrThresholds, validateCreatorOcrResult } from '../../services/creatorOcrProvider';
import { buildCreatorRenderJobOptions, isDurableCreatorRenderQueueConfigured } from '../../services/creatorRenderDurableQueue';
import { createCreatorAuditId, listCreatorRenderMetrics, recordCreatorRenderMetric } from '../../services/creatorRenderObservability';
import { validateCreatorPublishSemantics } from '../../services/creatorPublishValidation';
import { createVisualRegressionSnapshot, compareVisualRegressionSnapshots } from '../../services/creatorVisualRegression';
import { validateCreatorAccessibility } from '../../services/creatorAccessibilityValidation';

describe('creator enterprise closure', () => {
  const retiredSnakeKey = ['image', 'mode'].join('_');
  const retiredCamelKey = ['image', 'Mode'].join('');

  it('keeps the retired visual-mode contract out of source files', () => {
    const roots = ['backend/services', 'lib/content', 'pages/api', 'pages/command-center', 'supabase/migrations'];
    const offenders: string[] = [];
    for (const root of roots) {
      const stack = [path.join(process.cwd(), root)];
      while (stack.length) {
        const current = stack.pop() as string;
        if (!fs.existsSync(current)) continue;
        const stat = fs.statSync(current);
        if (stat.isDirectory()) {
          fs.readdirSync(current).forEach((child) => stack.push(path.join(current, child)));
          continue;
        }
        if (!/\.(ts|tsx|sql)$/.test(current)) continue;
        const text = fs.readFileSync(current, 'utf8');
        if (text.includes(retiredSnakeKey) || text.includes(retiredCamelKey)) offenders.push(path.relative(process.cwd(), current));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('enforces OCR confidence and supporting visual thresholds', () => {
    const thresholds = resolveCreatorOcrThresholds({
      assetType: 'supporting_image',
      platform: 'instagram',
      attachmentMode: 'supporting_visual',
    });
    const result = validateCreatorOcrResult({
      result: {
        provider: 'external-http-ocr-v1',
        text: 'Book a demo today',
        confidence: 0.44,
        regions: [{ text: 'Book a demo today', confidence: 0.44, language: 'en', bbox: null }],
      },
      thresholds,
    });
    expect(result.ok).toBe(false);
    expect(result.flags).toEqual(expect.arrayContaining([
      'ocr_confidence_below_threshold',
      'ocr_visible_text_exceeds_threshold',
      'ocr_region_count_exceeds_threshold',
      'ocr_cta_phrase_detected',
    ]));
  });

  it('integrates with the configured OCR provider endpoint', async () => {
    const originalEndpoint = process.env.CREATOR_OCR_ENDPOINT;
    process.env.CREATOR_OCR_ENDPOINT = 'https://ocr.test/extract';
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        text: 'Visible text',
        confidence: 0.91,
        regions: [{ text: 'Visible text', confidence: 0.91, language: 'en' }],
      }),
    })) as unknown as typeof fetch;
    const result = await runCreatorOcr({
      image: Buffer.from('fake-png'),
      assetType: 'banner',
      platform: 'linkedin',
      attachmentMode: 'embedded_copy',
    });
    expect(result.provider).toBe('external-http-ocr-v1');
    expect(result.confidence).toBe(0.91);
    expect(result.text).toBe('Visible text');
    global.fetch = originalFetch;
    if (originalEndpoint === undefined) delete process.env.CREATOR_OCR_ENDPOINT;
    else process.env.CREATOR_OCR_ENDPOINT = originalEndpoint;
  });

  it('builds idempotent durable render job options', () => {
    const first = buildCreatorRenderJobOptions({ idempotencyKey: 'render:infographic:1', timeoutMs: 5000, maxAttempts: 4 });
    const second = buildCreatorRenderJobOptions({ idempotencyKey: 'render:infographic:1', timeoutMs: 5000, maxAttempts: 4 });
    expect(first.jobId).toBe(second.jobId);
    expect(first.attempts).toBe(4);
    expect(first.backoff).toMatchObject({ type: 'exponential', delay: 5000 });
    expect(typeof isDurableCreatorRenderQueueConfigured()).toBe('boolean');
  });

  it('records production render observability metrics with audit ids', () => {
    const auditId = createCreatorAuditId({ renderer: 'infographic', id: '1' });
    const metric = recordCreatorRenderMetric({
      name: 'ocr_rejection',
      auditId,
      tags: { renderer: 'infographic', platform: 'linkedin' },
    });
    expect(metric.auditId).toBe(auditId);
    expect(listCreatorRenderMetrics().some((item) => item.auditId === auditId)).toBe(true);
  });

  it('blocks publish when attachment semantics lose render manifest integrity', () => {
    const result = validateCreatorPublishSemantics({
      platform: 'instagram',
      contentType: 'post',
      text: 'Book a demo',
      mediaUrls: ['https://cdn.test/a.png'],
      creatorAttachmentMetadata: [{
        attachment_mode: 'supporting_visual',
        asset_composition_intent: { assetType: 'supporting_image', attachmentMode: 'supporting_visual' },
        renderer_id: null,
      }],
      scheduledPostId: 'sp1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(expect.arrayContaining([
        'attachment_0_missing_renderer_identity',
        'attachment_0_missing_render_manifest',
      ]));
    }
  });

  it('detects visual regression drift', () => {
    const baseline = createVisualRegressionSnapshot({
      buffer: Buffer.from('aaa'),
      rendererId: 'banner-renderer-v1',
      platform: 'linkedin',
      assetType: 'banner',
      width: 1200,
      height: 628,
    });
    const candidate = createVisualRegressionSnapshot({
      buffer: Buffer.from('bbb'),
      rendererId: 'banner-renderer-v1',
      platform: 'linkedin',
      assetType: 'banner',
      width: 1200,
      height: 628,
    });
    expect(compareVisualRegressionSnapshots({ baseline, candidate, maxDriftScore: 0.1 }).ok).toBe(false);
  });

  it('enforces final accessibility metadata', () => {
    const result = validateCreatorAccessibility({
      altText: 'Short',
      readingOrder: [],
      minFontSize: 12,
      contrastRatio: 3.1,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'alt_text_missing_or_too_short',
      'reading_order_missing',
      'minimum_typography_below_accessibility_floor',
      'wcag_contrast_below_aa',
    ]));
  });
});
