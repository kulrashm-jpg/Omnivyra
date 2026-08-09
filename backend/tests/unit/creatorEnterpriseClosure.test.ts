// HARDEN-005A moved the OCR transport onto `lib/security/safeFetch`
// (creatorOcrProvider.ts:213), which issues its request through undici — NOT
// `global.fetch`. Stubbing `global.fetch` therefore intercepted nothing: the real
// safeFetch ran, resolved DNS for the fixture host, and threw
// `SsrfBlockedError (dns_resolution_failed)`.
//
// The transport boundary is mocked here instead, at the seam production actually
// uses. safeFetch itself is NOT modified and its SSRF policy is NOT relaxed — no
// host is whitelisted and no guard is disabled; safeFetch's own suite owns that
// behaviour. Everything on both sides of the boundary inside runCreatorOcr is the
// real implementation, which is what this test exists to exercise.
// `requireActual` spread keeps every other export (readCapped, assertUrlSafe, the
// SSRF policy helpers) REAL — only the transport function itself is replaced.
jest.mock('../../../lib/security/safeFetch', () => ({
  ...jest.requireActual('../../../lib/security/safeFetch'),
  safeFetch: jest.fn(),
}));

import fs from 'fs';
import path from 'path';
import { safeFetch } from '../../../lib/security/safeFetch';
import { runCreatorOcr, resolveCreatorOcrThresholds, validateCreatorOcrResult } from '../../services/creatorOcrProvider';
import { buildCreatorRenderJobOptions, isDurableCreatorRenderQueueConfigured } from '../../services/creatorRenderDurableQueue';
import { createCreatorAuditId, listCreatorRenderMetrics, recordCreatorRenderMetric } from '../../services/creatorRenderObservability';
import { validateCreatorPublishSemantics } from '../../services/creatorPublishValidation';
import { createVisualRegressionSnapshot, compareVisualRegressionSnapshots } from '../../services/creatorVisualRegression';
import { validateCreatorAccessibility } from '../../services/creatorAccessibilityValidation';

const mockSafeFetch = safeFetch as jest.MockedFunction<typeof safeFetch>;

/** Minimal stand-in for the HTTP response shape runCreatorOcr consumes: it reads
 *  `ok`, `status` and `json()` (creatorOcrProvider.ts:228-241). */
function ocrHttpResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  mockSafeFetch.mockReset();
});

describe('creator enterprise closure', () => {
  // The retired contract is the PERSISTED key `image_mode`, superseded by
  // `attachment_mode` in supabase/migrations/20260667_creator_enterprise_closure.sql,
  // carrying the values 'embedded_copy' | 'supporting_visual'.
  //
  // The previous guard tested `text.includes(...)` on the whole file, which cannot
  // distinguish that contract from two unrelated LIVE identifiers, and so reported
  // both as offenders:
  //
  //   • `image_models` — an OpenAI/DALL·E billing row field
  //     (backend/services/billing/reconciliation/{openaiAdapter,imageAdapter}.ts).
  //     It contains `image_mode` as a substring: "image_models".includes("image_mode").
  //
  //   • `branding.imageMode` — creator branding DENSITY, declared at
  //     lib/creator-templates/imageStyle.ts:98 as 'compact' | 'standard'. A different
  //     contract that merely shares the token, with a disjoint value domain.
  //
  // Narrowed on two axes, so a genuine reintroduction is still caught:
  //   1. word-boundary anchoring, which excludes `image_models`;
  //   2. a camelCase hit counts only when its line does not also reference
  //      `branding` — the density contract's sole owner. A reintroduced attachment
  //      /visual mode field carries no `branding` qualifier and still fails.
  const retiredSnakeKey = ['image', 'mode'].join('_');
  const retiredCamelKey = ['image', 'Mode'].join('');
  const retiredSnakeRe = new RegExp(`\\b${retiredSnakeKey}\\b`);
  const retiredCamelRe = new RegExp(`\\b${retiredCamelKey}\\b`);
  /** Owner of the unrelated, still-live branding-density contract. */
  const DENSITY_CONTRACT_OWNER = 'branding';

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
        const rel = path.relative(process.cwd(), current);
        fs.readFileSync(current, 'utf8').split(/\r?\n/).forEach((line, idx) => {
          const snakeHit = retiredSnakeRe.test(line);
          const camelHit = retiredCamelRe.test(line) && !line.includes(DENSITY_CONTRACT_OWNER);
          if (snakeHit || camelHit) offenders.push(`${rel}:${idx + 1}`);
        });
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
    mockSafeFetch.mockResolvedValueOnce(ocrHttpResponse({
      text: 'Visible text',
      confidence: 0.91,
      regions: [{ text: 'Visible text', confidence: 0.91, language: 'en' }],
    }));

    const result = await runCreatorOcr({
      image: Buffer.from('fake-png'),
      assetType: 'banner',
      platform: 'linkedin',
      attachmentMode: 'embedded_copy',
    });

    // Response-side production logic really ran: provider tagging, confidence
    // clamping, text compaction and region normalization are all downstream of
    // the mocked transport.
    expect(result.provider).toBe('external-http-ocr-v1');
    expect(result.confidence).toBe(0.91);
    expect(result.text).toBe('Visible text');

    // Request-side production logic really ran, and ran THROUGH safeFetch — this
    // is what the retired `global.fetch` stub could no longer observe.
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockSafeFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://ocr.test/extract');
    expect(calledInit.method).toBe('POST');
    expect(JSON.parse(String(calledInit.body))).toEqual(expect.objectContaining({
      image_base64: Buffer.from('fake-png').toString('base64'),
      asset_type: 'banner',
      platform: 'linkedin',
      attachment_mode: 'embedded_copy',
    }));

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
