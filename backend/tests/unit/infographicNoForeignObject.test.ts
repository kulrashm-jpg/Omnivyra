import { readFileSync } from 'fs';
import path from 'path';

/**
 * Infographic P0 regression guard.
 *
 * librsvg/resvg (which `sharp` uses to rasterize SVG) does NOT render
 * <foreignObject> HTML — body text inside it comes out BLANK in the PNG. Every
 * infographic engine body was migrated to native SVG <text> (renderWrappedBodyText).
 * This guard fails if any <foreignObject> is reintroduced into the infographic
 * render function, so the blank-body defect can never silently return.
 *
 * Deterministic + cheap + CI-friendly: a static source scan, no render / LLM / DB.
 */
describe('infographic render correctness — no foreignObject', () => {
  const SRC = readFileSync(
    path.join(__dirname, '..', '..', 'services', 'creatorAssetRendererInfographic.ts'), // split part holding renderInfographicAsset
    'utf8',
  );

  /** Body of `renderInfographicAsset`, up to the next top-level function.
   *  Uses column-0 (`^`, multiline) declaration matching so comment mentions
   *  and indented inner closures are ignored. */
  function infographicRegion(): string {
    const decl = /^(?:export )?(?:async )?function (\w+)/gm;
    const positions: Array<{ name: string; idx: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = decl.exec(SRC)) !== null) positions.push({ name: m[1], idx: m.index });
    const i = positions.findIndex((p) => p.name === 'renderInfographicAsset');
    expect(i).toBeGreaterThan(-1);
    const start = positions[i].idx;
    const end = i + 1 < positions.length ? positions[i + 1].idx : SRC.length;
    return SRC.slice(start, end);
  }

  it('renderInfographicAsset emits no foreignObject element (blank in librsvg/sharp PNG)', () => {
    // Match the CLOSING tag: it appears only in real SVG elements, never in the
    // prose comments that reference "<foreignObject>" / "foreignObject" to
    // explain why the migration happened.
    expect(infographicRegion()).not.toContain('</foreignObject>');
  });

  it('infographic bodies render via the native-text helper', () => {
    expect(infographicRegion()).toContain('renderWrappedBodyText(');
  });
});
