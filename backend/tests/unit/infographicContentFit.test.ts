import { estimateDenseBodyHeight } from '../../services/creatorAssetRenderer';
import { DEFAULT_INFOGRAPHIC_STYLE } from '../../../lib/creator-templates/infographicStyle';

const STYLE = DEFAULT_INFOGRAPHIC_STYLE;
const W = 440; // ~framework card body width
const FM = 1.0;

const thin = { body: 'Brand awareness is the extent to which consumers recognize a brand.' };
const rich = {
  body: 'Brand awareness is the extent to which consumers recognize a brand.',
  bullets: [
    'Increases customer trust and loyalty',
    'Enhances market visibility and reach',
    'Drives organic traffic and referrals',
    'Compounds into qualified pipeline over time',
  ],
  impact: 'Naming the unspoken assumption unlocks momentum',
  risk: 'Calling it out can feel exposing at first',
  example: 'A regional team doubled inbound in one quarter',
  take: 'Consistency beats intensity for brand recall',
};

describe('infographic content-fit sizing', () => {
  it('estimates a larger body height for rich content than for thin content', () => {
    const hThin = estimateDenseBodyHeight(thin, W, STYLE, FM);
    const hRich = estimateDenseBodyHeight(rich, W, STYLE, FM);
    expect(hThin).toBeGreaterThan(0);
    expect(hRich).toBeGreaterThan(hThin + 100); // rich adds bullets + panels + footer
  });

  it('thin content drives a shorter-than-full canvas via the renderer formula', () => {
    // Mirror renderInfographicAsset: 2 rows, framework bodyInset 114, header ~364.
    const headerH = 364;
    const bottomMargin = STYLE.spacing.bottomMargin;
    const rowGap = STYLE.geometry.engine.framework.gapY;
    const bodyInset = STYLE.geometry.layouts.framework.bodyHeightInset;
    const fullFill = 510; // uncapped card height on the 1500 canvas for this header
    const canvasFor = (section: Record<string, unknown>): number => {
      const est = estimateDenseBodyHeight(section, W, STYLE, FM);
      const targetCardH = Math.min(fullFill, Math.max(220, Math.round((est + bodyInset) / 0.9)));
      const gridH = 2 * targetCardH + rowGap;
      return Math.max(900, Math.min(1500, headerH + gridH + bottomMargin));
    };
    const thinCanvas = canvasFor(thin);
    const richCanvas = canvasFor(rich);
    expect(thinCanvas).toBeLessThan(1500); // sparse deck no longer fills a tall box
    expect(richCanvas).toBeGreaterThanOrEqual(thinCanvas); // richer content → taller canvas
  });
});
