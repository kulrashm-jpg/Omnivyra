/**
 * PHASE 14J — Generate font parity guard.
 *
 * The Generate button uses /generate (synchronous inline render via the
 * orchestrator), NOT render-inline. Both flow through creatorAssetRenderer, so
 * font initialization belongs there (before sharp loads) and the vendored fonts
 * must be traced into BOTH serverless functions. This guard asserts both halves
 * of that contract so the Generate path can't silently lose the font fix again.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Generate font parity (render-inline ↔ generate)', () => {
  it('creatorAssetRenderer initializes fonts BEFORE sharp loads (covers every render path)', () => {
    const src = read('backend/services/creatorAssetRenderer.ts');
    const ensureIdx = src.indexOf('ensureRenderFonts()');
    const sharpIdx = src.indexOf("require('sharp')");
    expect(ensureIdx).toBeGreaterThan(-1);
    expect(sharpIdx).toBeGreaterThan(-1);
    // ensureRenderFonts() must execute before the sharp require statement.
    expect(ensureIdx).toBeLessThan(sharpIdx);
    expect(src).toContain("import { ensureRenderFonts } from './creatorRenderFonts'");
  });

  it('the vendored fonts are traced into BOTH the render-inline AND generate functions', () => {
    const cfg = read('next.config.js');
    expect(cfg).toMatch(/outputFileTracingIncludes/);
    expect(cfg).toMatch(/'\/api\/command-center\/creator-content\/render-inline':\s*\[\s*'\.\/assets\/fonts\/\*\*'/);
    expect(cfg).toMatch(/'\/api\/command-center\/creator-content\/generate':\s*\[\s*'\.\/assets\/fonts\/\*\*'/);
  });

  it('the Generate path renders via the same shared renderer (renderAsset), so it inherits the init', () => {
    // generate → orchestrator inline branch → renderAsset (same module that now
    // initializes fonts). render-inline → renderAsset too. Single chokepoint.
    const orchestrator = read('backend/services/creator/creatorOrchestrator.ts');
    expect(orchestrator).toContain("import { renderAsset } from '../creatorAssetRenderer'");
    expect(orchestrator).toContain('renderAsset(');
  });
});
