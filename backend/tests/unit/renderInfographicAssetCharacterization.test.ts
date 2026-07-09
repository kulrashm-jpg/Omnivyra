/**
 * CHARACTERIZATION SUITE — backend/services/creatorAssetRendererInfographic.ts
 * (renderInfographicAsset — the production infographic render path).
 *
 * Locks CURRENT observable behavior. The rasterizer (`sharp`) is mocked as a
 * PASS-THROUGH so the "rendered buffer" is the composed SVG text itself — a
 * deterministic, platform-independent golden master that captures layout,
 * geometry, typography, palette, cards, wave, header, and CTA footer exactly.
 * PNG bytes would vary by libvips version; the SVG is the render contract.
 *
 * Seams mocked (external boundaries only): sharp + render-buffer cache,
 * fontconfig init, brand runtime (DB), LLM copy composer, OCR provider,
 * validation-manifest persistence (fire-and-forget DB), PNG upload (storage),
 * brand-mark loader (remote image), observability/metrics/billing, supabase.
 *
 * Kept REAL (the unit under characterization): the renderer itself, section
 * resolution/planning/density (creatorAssetRendererCompose), governance +
 * quality scoring (creatorAssetGovernance), geometry validation, render
 * manifest, accessibility validation, platform geometry, template/style
 * registries (lib/creator-templates), prompt-directive stripping, contracts
 * helpers (resolveRenderSize, balanceTextLines, escapeXml, …).
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: () => { throw new Error('unexpected DB access in render characterization'); } },
}));
jest.mock('../../services/creatorRenderFonts', () => ({
  ensureRenderFonts: jest.fn(() => {}),
}));
jest.mock('../../services/brand/brandRuntime', () => ({
  resolveBrand: jest.fn(async () => null),
}));
jest.mock('../../services/creator/infographicCopyComposer', () => ({
  composeInfographicCopy: jest.fn(async (input: any) => ({
    sections: (input.sectionTitles as string[]).map((title: string, i: number) => ({
      lead: (input.sectionBodies as string[])[i] || `Deterministic lead for ${title}.`,
      bullets: [],
      stat: null,
      example: null,
      take: null,
      impact: null,
      risk: null,
    })),
    narrative: 'One deterministic narrative line.',
    cta: input.cta || '',
  })),
}));
jest.mock('../../services/creatorOcrProvider', () => ({
  runCreatorOcr: jest.fn(async () => ({ ok: true, flags: [], confidence: 0.99, provider: 'mock-ocr' })),
  isLightweightSocialEmbeddedCopy: jest.fn(() => false),
}));
jest.mock('../../services/creatorRenderPersistence', () => ({
  persistCreatorValidationManifest: jest.fn(async () => {}),
}));
jest.mock('../../services/creatorAssetRendererMedia', () => ({
  uploadRenderedPng: jest.fn(async () => 'https://cdn.example/infographic.png'),
}));
jest.mock('../../services/creatorAssetRendererOverlay', () => ({
  loadBrandMark: jest.fn(async () => null),
}));
jest.mock('../../services/creatorAssetRendererSvg', () => ({
  bufferFromRemoteImage: jest.fn(async () => Buffer.from('remote-image')),
}));
jest.mock('../../../lib/shared/observability', () => ({
  logPipelineEvent: jest.fn(),
}));
jest.mock('../../services/creatorObservation', () => ({
  creatorEvent: jest.fn(),
}));
jest.mock('../../services/creatorRuntimeMetrics', () => ({
  recordCreatorDuration: jest.fn(),
}));
jest.mock('../../services/billing/blackHoleCostCapture', () => ({
  captureImageProviderCost: jest.fn(async () => {}),
}));
jest.mock('../../services/aiUsageCollector', () => ({
  recordAssetCredits: jest.fn(async () => {}),
}));
jest.mock('../../services/creator/costProfiles', () => ({
  resolveCostProfile: jest.fn(() => ({ provider: 'mock', usd: 0 })),
}));
jest.mock('../../services/creator/rendering/providers/betaMockRenderProvider', () => ({
  isBetaAiRenderMode: jest.fn(() => false),
  createBetaMockImage: jest.fn(),
  BETA_MOCK_MODEL: 'beta-mock',
}));
// Pass-through sharp: .png().toBuffer() returns the input unchanged, so the
// final buffer is the SVG string the renderer composed.
jest.mock('../../services/creatorAssetRendererContracts', () => {
  const actual = jest.requireActual('../../services/creatorAssetRendererContracts');
  const toBuf = (input: any) => (Buffer.isBuffer(input) ? input : Buffer.from(String(input)));
  const chain = (input: any): any => ({
    png: () => ({ toBuffer: async () => toBuf(input) }),
    resize: () => chain(input),
    composite: () => chain(input),
  });
  return {
    ...actual,
    sharp: (input: any) => chain(input),
    getCachedRenderBuffer: jest.fn(async (_key: string, producer: () => Promise<Buffer>) => producer()),
  };
});

import { renderInfographicAsset } from '../../services/creatorAssetRendererInfographic';
import { composeInfographicCopy } from '../../services/creator/infographicCopyComposer';
import { uploadRenderedPng } from '../../services/creatorAssetRendererMedia';
import { persistCreatorValidationManifest } from '../../services/creatorRenderPersistence';

const baseMetadata = {
  platform: 'linkedin',
  topic: 'Automation Payoffs',
  summary: 'Four ways automation compounds.',
  cta: 'Book a demo',
  thread_visual_transform: {
    items: [
      'Speed: Ship faster with automated checks',
      'Quality: Fewer defects reach production',
      'Cost: Lower spend through reuse',
      'Trust: Auditable pipelines build confidence',
    ],
  },
};

function payloadWith(metadata: Record<string, unknown>) {
  return { media_bundle: { metadata } } as Record<string, unknown>;
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('renderInfographicAsset — gradient default path', () => {
  it('golden master: composed SVG + renderer metadata are deterministic', async () => {
    const bundle = await renderInfographicAsset(payloadWith(baseMetadata), {
      previewBufferOnly: true,
    } as any);

    const svg = bundle.buffer!.toString();
    // Structural contract: header band, inner panel, wave, 4 section cards, CTA footer.
    expect(svg).toContain('<svg');
    expect(svg).toContain('infographicHeaderGradient');
    expect(svg).toContain('Automation Payoffs');
    expect(svg).toContain('Book a demo');
    expect((svg.match(/accentStripe|rx="/g) ?? []).length).toBeGreaterThan(0);

    const md = bundle.metadata as Record<string, any>;
    expect(md.generated_by).toBe('infographicRenderer');
    expect(md.preview_kind).toBe('infographic_composition');
    expect(md.renderer_pipeline).toBe('dedicated_infographic_svg_v1');
    expect(md.infographic_sections).toHaveLength(4);
    expect(md.infographic_sections.map((s: any) => s.title)).toEqual([
      'Speed',
      'Quality',
      'Cost',
      'Trust',
    ]);
    expect(md.overlay_renderer).toBe('none');
    expect(md.render_manifest).toBeDefined();
    expect(md.validation_manifest.final_ocr.provider).toBe('mock-ocr');

    // Full golden masters.
    expect(svg).toMatchSnapshot('infographic-svg');
    expect({
      width: md.width,
      height: md.height,
      engine: md.infographic_engine,
      layout: md.infographic_layout,
      density: md.infographic_density,
      quality: md.creator_quality_score,
      governance: md.visual_governance,
      warnings: md.visual_governance_warnings,
      auto_corrections: md.auto_corrections,
      icon_zones: md.icon_zone_allocation,
    }).toMatchSnapshot('infographic-metadata');
  });

  it('previewBufferOnly renders with STATIC copy (no LLM) and never uploads', async () => {
    await renderInfographicAsset(payloadWith(baseMetadata), { previewBufferOnly: true } as any);
    expect(composeInfographicCopy).toHaveBeenCalledWith(
      expect.objectContaining({ staticOnly: true })
    );
    expect(uploadRenderedPng).not.toHaveBeenCalled();
  });

  it('non-preview path uploads the PNG and returns the URL', async () => {
    const bundle = await renderInfographicAsset(payloadWith(baseMetadata), {
      campaignId: 'camp-1',
      userId: 'user-1',
      companyId: 'co-1',
    } as any);
    expect(bundle.url).toBe('https://cdn.example/infographic.png');
    expect(bundle.buffer).toBeUndefined();
    expect(uploadRenderedPng).toHaveBeenCalledWith(
      expect.objectContaining({ fileNamePrefix: 'infographic', campaignId: 'camp-1' })
    );
    // Validation manifest persistence is fired (fire-and-forget observability).
    expect(persistCreatorValidationManifest).toHaveBeenCalledTimes(1);
  });

  it('omits the CTA footer when no CTA is provided', async () => {
    const { cta: _cta, ...noCta } = baseMetadata;
    (composeInfographicCopy as jest.Mock).mockImplementationOnce(async (input: any) => ({
      sections: (input.sectionTitles as string[]).map(() => ({
        lead: 'Lead.', bullets: [], stat: null, example: null, take: null, impact: null, risk: null,
      })),
      narrative: '',
      cta: '',
    }));
    const bundle = await renderInfographicAsset(payloadWith(noCta), {
      previewBufferOnly: true,
    } as any);
    expect(bundle.buffer!.toString()).not.toContain('CTA footer band');
  });

  it('sample accent (blueprint_color_primary) re-tints the render', async () => {
    const bundle = await renderInfographicAsset(
      payloadWith({ ...baseMetadata, blueprint_color_primary: '#00ff88' }),
      { previewBufferOnly: true } as any
    );
    expect(bundle.buffer!.toString()).toContain('#00ff88');
  });

  it('strips leaked LLM design directives from section copy', async () => {
    const bundle = await renderInfographicAsset(
      payloadWith({
        ...baseMetadata,
        thread_visual_transform: {
          items: [
            'Speed: Use a modern font for the headline with a clean layout. Ship faster with automated checks',
            'Quality: Fewer defects reach production',
            'Cost: Lower spend through reuse',
            'Trust: Auditable pipelines build confidence',
          ],
        },
      }),
      { previewBufferOnly: true } as any
    );
    expect(bundle.buffer!.toString()).not.toContain('Use a modern font');
  });

  it('pads a sparse overlay to a minimum 4-section grid', async () => {
    const bundle = await renderInfographicAsset(
      payloadWith({
        platform: 'linkedin',
        topic: 'Single Idea',
        summary: '',
        thread_visual_transform: { items: ['Only one item here'] },
      }),
      { previewBufferOnly: true } as any
    );
    const md = bundle.metadata as Record<string, any>;
    expect(md.infographic_sections.length).toBeGreaterThanOrEqual(4);
  });
});
