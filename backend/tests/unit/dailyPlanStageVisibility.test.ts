/**
 * PHASE DAILY-PLAN-STAGE-VISIBILITY — the "Building Activities" stage now carries
 * intra-stage substages + a heartbeat (orchestrator-emitted, generate-weekly-
 * structure:<sub>) so the UI never looks frozen. These verify the resolution
 * contract that lets ProgressCard render those substages for ALL builders,
 * without any stage rename or completion change.
 */
import {
  getProgressPipeline,
  resolveCanonicalStageIndex,
} from '../../../lib/shared/bolt/progressModel';

const MODES = ['TEXT', 'CREATOR', 'COMBINED'] as const;
const baIndex = (mode: typeof MODES[number]) =>
  getProgressPipeline(mode).findIndex((s) => s.label === 'Building Activities');

describe('A. substage emission resolves to Building Activities (all builders)', () => {
  const subs = ['preparing', 'allocating', 'building-rows', 'validating', 'saving'];
  for (const mode of MODES) {
    for (const sub of subs) {
      it(`${mode}: generate-weekly-structure:${sub}`, () => {
        const p = getProgressPipeline(mode);
        expect(resolveCanonicalStageIndex(`generate-weekly-structure:${sub}`, p)).toBe(baIndex(mode));
      });
    }
  }
});

describe('B. week progression forms resolve to Building Activities', () => {
  for (const mode of MODES) {
    it(`${mode}: per-week + batch range`, () => {
      const p = getProgressPipeline(mode);
      expect(resolveCanonicalStageIndex('generate-weekly-structure-week-2', p)).toBe(baIndex(mode));
      expect(resolveCanonicalStageIndex('generate-weekly-structure-weeks-1-4', p)).toBe(baIndex(mode));
      expect(resolveCanonicalStageIndex('generate-weekly-structure-weeks-9-12', p)).toBe(baIndex(mode));
    });
  }
});

describe('C. heartbeat substage keeps visibility (never -1)', () => {
  for (const mode of MODES) {
    it(`${mode}: building-rows heartbeat is a valid current step`, () => {
      const p = getProgressPipeline(mode);
      const idx = resolveCanonicalStageIndex('generate-weekly-structure:building-rows', p);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBe(baIndex(mode));
    });
  }
});

describe('D. ProgressCard substage hook — Building Activities step keyed by generate-weekly-structure', () => {
  for (const mode of MODES) {
    it(`${mode}: step.stage is 'generate-weekly-structure' (showWeeklyDetail key)`, () => {
      const step = getProgressPipeline(mode).find((s) => s.label === 'Building Activities');
      expect(step?.stage).toBe('generate-weekly-structure');
    });
  }
});

describe('E. all builders inherit the substage step automatically', () => {
  for (const mode of MODES) {
    it(`${mode}: pipeline contains a Building Activities step`, () => {
      expect(baIndex(mode)).toBeGreaterThanOrEqual(0);
    });
  }
});

describe('F. no stage-name changes', () => {
  it('the backend stage key stays generate-weekly-structure and label stays Building Activities', () => {
    const step = getProgressPipeline('COMBINED').find((s) => s.stage === 'generate-weekly-structure');
    expect(step?.label).toBe('Building Activities');
    // substage colon form must NOT be mistaken for a different stage
    expect(resolveCanonicalStageIndex('generate-weekly-structure:preparing', getProgressPipeline('COMBINED')))
      .toBe(resolveCanonicalStageIndex('generate-weekly-structure', getProgressPipeline('COMBINED')));
  });
});

describe('G. completion behavior unchanged (pipeline shape stable)', () => {
  it('mode pipelines keep their terminal stages + lengths', () => {
    expect(getProgressPipeline('TEXT').length).toBe(8);
    expect(getProgressPipeline('CREATOR').length).toBe(7);
    expect(getProgressPipeline('COMBINED').length).toBe(9);
    for (const mode of MODES) {
      const labels = getProgressPipeline(mode).map((s) => s.label);
      expect(labels[labels.length - 1]).toBe('Campaign Ready');
      expect(labels[labels.length - 2]).toBe('Finalizing Campaign');
    }
  });
});
