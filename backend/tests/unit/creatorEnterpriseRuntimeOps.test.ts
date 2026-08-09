import fs from 'fs';
import path from 'path';
import { assertRenderManifestExportable, createRenderManifest } from '../../services/creatorRenderManifest';
import { validateLayoutGeometry } from '../../services/creatorRenderGeometry';
import { resolvePlatformGeometryProfile } from '../../services/creatorPlatformGeometry';
import { detectSemanticThreadDuplication } from '../../services/creatorSemanticDuplication';
import { validateCreatorPublishSemantics } from '../../services/creatorPublishValidation';
import { compareVisualRegressionSnapshots, createVisualRegressionSnapshot } from '../../services/creatorVisualRegression';
import { validateVisualGovernance, scoreCreatorQuality, resolveAssetGovernanceProfile, resolvePlatformVisualProfile } from '../../services/creatorAssetGovernance';

/** Read one file relative to the repo root. */
function readEntry(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

/**
 * Read an entry file PLUS the local modules it reaches, following relative
 * `from '...'` and `import('...')` specifiers up to `maxDepth` hops.
 *
 * These assertions verify that a BEHAVIOUR is wired behind a documented entry
 * point. Both entry points have since become barrels — `generate.ts` re-exports
 * `backend/services/creator/generateRoute/*`, and `creatorAssetRenderer.ts`
 * re-exports 10 `creatorAssetRenderer*` parts — so the implementations moved out of
 * the file being read while remaining reachable from it. Following the graph keeps
 * the assertion about wiring rather than about which file happens to hold a line,
 * so a further split cannot break it again.
 */
function readReachable(rel: string, maxDepth = 3): string {
  const seen = new Set<string>();
  const chunks: string[] = [];
  const walk = (relPath: string, depth: number) => {
    const abs = path.join(process.cwd(), relPath);
    if (seen.has(abs) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return;
    seen.add(abs);
    const text = fs.readFileSync(abs, 'utf8');
    chunks.push(text);
    if (depth >= maxDepth) return;
    const dir = path.dirname(relPath);
    const specifiers = [...text.matchAll(/(?:from\s*|import\(\s*)['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of specifiers) {
      const base = path.join(dir, spec);
      for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(path.join(process.cwd(), candidate))) { walk(candidate, depth + 1); break; }
      }
    }
  };
  walk(rel, 0);
  return chunks.join('\n');
}

describe('creator enterprise runtime operations', () => {
  it('uses durable queue in live heavy render API path', () => {
    const ENTRY = 'pages/api/command-center/creator-content/generate.ts';
    // Positive assertions follow the barrel: the durable-queue enqueue and the
    // async render policy now live in creator/creatorOrchestrator.ts, which
    // generateRoute/generateHandler.ts dynamic-imports and invokes (:606-610).
    const reachable = readReachable(ENTRY);
    expect(reachable).toContain('enqueueDurableCreatorRenderJob');
    expect(reachable).toContain('render_async');
    // The negative assertion stays scoped to the ENTRY file — the point is that the
    // route itself must not reach for the retired queue module directly.
    expect(readEntry(ENTRY)).not.toContain("from '../../../../backend/services/creatorRenderQueue'");
  });

  it('wires creator render worker into production worker bootstrap', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'backend/workers/main.ts'), 'utf8');
    expect(source).toContain('createCreatorRenderWorker');
    expect(source).toContain('processCreatorRenderJob');
    expect(source).toContain('recoverOrphanedCreatorRenderJobs');
  });

  it('fails closed for governed renderer failures', () => {
    // creatorAssetRenderer.ts is now a barrel over 10 parts; the fail-closed throw
    // lives in the re-exported creatorAssetRendererRuntime part (:422, :429).
    const source = readReachable('backend/services/creatorAssetRenderer.ts');
    expect(source).toContain('governed_render_failed_closed');
    expect(source).toContain('throw new Error(`governed_render_failed_closed');
  });

  it('blocks export when accessibility manifest fails', () => {
    const validation = validateVisualGovernance({ assetType: 'banner', platform: 'linkedin', textBlocks: ['Clear headline'] });
    const quality = scoreCreatorQuality({ assetType: 'banner', platform: 'linkedin', textBlocks: ['Clear headline'] });
    const geometry = validateLayoutGeometry({
      width: 1200,
      height: 628,
      boxes: [],
      foreground: '#ffffff',
      background: '#000000',
    });
    const manifest = createRenderManifest({
      rendererId: 'banner-renderer',
      platformProfile: resolvePlatformVisualProfile('linkedin') as unknown as Record<string, unknown>,
      governanceProfile: resolveAssetGovernanceProfile('banner') as unknown as Record<string, unknown>,
      qualityScore: quality,
      validationResult: validation,
      ocrResult: { ok: true, flags: [], mode: 'embedded_copy' },
      typographySafetyResult: geometry,
      altText: 'short',
      readingOrder: [],
      accessibilityValidation: {
        ok: false,
        errors: ['alt_text_missing_or_too_short'],
        warnings: [],
        altText: 'short',
        readingOrder: [],
        minFontSize: 18,
        contrastRatio: 21,
        screenReaderMetadata: {},
      },
    });
    expect(() => assertRenderManifestExportable(manifest)).toThrow(/alt_text_missing/);
  });

  it('blocks publish without accessibility and manifest integrity', () => {
    const result = validateCreatorPublishSemantics({
      platform: 'linkedin',
      contentType: 'post',
      text: 'A concise post',
      creatorAttachmentMetadata: [{
        attachment_mode: 'embedded_copy',
        asset_composition_intent: { assetType: 'banner', attachmentMode: 'embedded_copy' },
        renderer_id: 'banner-renderer',
        render_manifest: {
          validationResult: { ok: true },
          ocrResult: { ok: true },
          typographySafetyResult: { ok: true },
          qualityScore: { clutterRisk: 1, readability: 90 },
          accessibility: { altText: '', readingOrder: [] },
          accessibilityValidation: { ok: false },
        },
      }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toEqual(expect.arrayContaining(['attachment_0_accessibility_manifest_failed']));
  });

  it('materially differentiates platform geometry engines', () => {
    expect(resolvePlatformGeometryProfile('linkedin').engine).toBe('framework_grid');
    expect(resolvePlatformGeometryProfile('instagram').engine).toBe('immersive_visual');
    expect(resolvePlatformGeometryProfile('x').engine).toBe('rapid_scan');
    expect(resolvePlatformGeometryProfile('facebook').engine).toBe('balanced_engagement');
  });

  it('detects semantic paraphrase duplication with embedding similarity', () => {
    const result = detectSemanticThreadDuplication({
      rawSourceText: 'Confusing onboarding causes customers to churn before they reach value.',
      visualItems: ['Customers churn when onboarding is confusing and value is delayed.'],
      transform: 'support_visual_only',
    });
    expect(result.ok).toBe(false);
  });

  it('keeps visual regression failures blocking', () => {
    const baseline = createVisualRegressionSnapshot({ buffer: Buffer.from('platform-a'), rendererId: 'r1', platform: 'linkedin', assetType: 'banner', width: 1200, height: 628 });
    const candidate = createVisualRegressionSnapshot({ buffer: Buffer.from('platform-b'), rendererId: 'r1', platform: 'linkedin', assetType: 'banner', width: 1200, height: 628 });
    expect(compareVisualRegressionSnapshots({ baseline, candidate, maxDriftScore: 0.1 }).ok).toBe(false);
  });

  it('provides operational dashboard endpoint and CI visual regression script', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'pages/api/super-admin/creator-render-ops.ts'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts/creator-visual-regression-ci.js'))).toBe(true);
  });
});
