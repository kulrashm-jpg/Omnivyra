import {
  listTemplatesForFamily,
  resolveStageRequirements,
  canSkipBlueprint,
  canSkipContentIngestion,
  canSkipStage,
} from '../../../lib/creator-templates';
import type { CreatorTemplate } from '../../../lib/creator-templates';

const img = listTemplatesForFamily('image')[0];
const car = listTemplatesForFamily('carousel')[0];
const info = listTemplatesForFamily('infographic')[0];

describe('Creator stage requirements — canonical capability contract', () => {
  it('system default: every current template is skippable (no behavior change)', () => {
    for (const t of [img, car, info]) {
      expect(resolveStageRequirements(t)).toEqual({ requiresBlueprint: false, requiresContentIngestion: false });
      expect(canSkipBlueprint(t)).toBe(true);
      expect(canSkipContentIngestion(t)).toBe(true);
    }
    // null/undefined template → system default skippable.
    expect(canSkipBlueprint(null)).toBe(true);
    expect(canSkipContentIngestion(undefined)).toBe(true);
  });

  it('template contract OVERRIDES the default (required stage cannot be skipped)', () => {
    const required: CreatorTemplate = { ...img, stageRequirements: { requiresBlueprint: true, requiresContentIngestion: true } };
    expect(resolveStageRequirements(required)).toEqual({ requiresBlueprint: true, requiresContentIngestion: true });
    expect(canSkipBlueprint(required)).toBe(false);
    expect(canSkipContentIngestion(required)).toBe(false);
  });

  it('partial template override leaves other stages at default', () => {
    const t: CreatorTemplate = { ...img, stageRequirements: { requiresBlueprint: true } };
    expect(canSkipBlueprint(t)).toBe(false);       // overridden → required
    expect(canSkipContentIngestion(t)).toBe(true); // inherits default → skippable
  });

  it('priority: Template Contract > Asset Type Contract > System Default', () => {
    // A template that explicitly sets requiresContentIngestion=false wins even if a
    // future asset-type default required it — template is highest priority.
    const t: CreatorTemplate = { ...info, stageRequirements: { requiresContentIngestion: false } };
    expect(canSkipContentIngestion(t)).toBe(true);
  });

  it('canSkipStage routes to the right stage', () => {
    const t: CreatorTemplate = { ...img, stageRequirements: { requiresBlueprint: true } };
    expect(canSkipStage('blueprint', t)).toBe(false);
    expect(canSkipStage('contentIngestion', t)).toBe(true);
  });

  it('is deterministic', () => {
    expect(resolveStageRequirements(info)).toEqual(resolveStageRequirements(info));
  });
});
