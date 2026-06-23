/**
 * PHASE BOLT-PROGRESS-PARITY — canonical progress authority.
 * One source for stage ordering/labels/visibility/resolution across all builders.
 */
import {
  getProgressPipeline,
  resolveCanonicalStageIndex,
  CANONICAL_LABELS,
} from '../../../lib/shared/bolt/progressModel';

const labels = (mode: 'TEXT' | 'CREATOR' | 'COMBINED') => getProgressPipeline(mode).map((s) => s.label);

describe('A. shared progress model authority', () => {
  it('COMBINED is the full 9-stage canonical model in order', () => {
    expect(labels('COMBINED')).toEqual([
      'Getting Ready', 'Building Strategy', 'Building Activities', 'Creating Content',
      'Creating Assets', 'Repurposing Content', 'Scheduling Activities',
      'Finalizing Campaign', 'Campaign Ready',
    ]);
  });
  it('Building Strategy step keeps backend key "ai/plan" (ProgressCard substage hook)', () => {
    expect(getProgressPipeline('COMBINED').find((s) => s.label === 'Building Strategy')?.stage).toBe('ai/plan');
  });
});

describe('B. TEXT visibility — hides Creating Assets', () => {
  const l = labels('TEXT');
  it('shows the writer stages', () => {
    expect(l).toEqual([
      'Getting Ready', 'Building Strategy', 'Building Activities', 'Creating Content',
      'Repurposing Content', 'Scheduling Activities', 'Finalizing Campaign', 'Campaign Ready',
    ]);
  });
  it('hides Creating Assets', () => {
    expect(l).not.toContain('Creating Assets');
  });
});

describe('C. CREATOR visibility — hides Creating Content + Repurposing', () => {
  const l = labels('CREATOR');
  it('shows the creator stages', () => {
    expect(l).toEqual([
      'Getting Ready', 'Building Strategy', 'Building Activities', 'Creating Assets',
      'Scheduling Activities', 'Finalizing Campaign', 'Campaign Ready',
    ]);
  });
  it('hides Creating Content and Repurposing Content', () => {
    expect(l).not.toContain('Creating Content');
    expect(l).not.toContain('Repurposing Content');
  });
});

describe('D. COMBINED visibility — nothing hidden', () => {
  const l = labels('COMBINED');
  for (const stage of Object.values(CANONICAL_LABELS)) {
    it(`shows "${stage}"`, () => expect(l).toContain(stage));
  }
});

describe('Intelligent Mix exposes previously-hidden backend stages', () => {
  const combined = getProgressPipeline('COMBINED');
  const idxOf = (runtime: string) => resolveCanonicalStageIndex(runtime, combined);
  const labelOf = (runtime: string) => combined[idxOf(runtime)]?.label;

  it('E. creator-asset-generation → Creating Assets', () => {
    expect(labelOf('creator-asset-generation')).toBe('Creating Assets');
    expect(labelOf('render-creator-image')).toBe('Creating Assets'); // per-asset render substage
  });
  it('F. schedule-creating-content → Creating Content', () => {
    expect(labelOf('schedule-creating-content')).toBe('Creating Content');
  });
  it('G. schedule-repurposing-content → Repurposing Content', () => {
    expect(labelOf('schedule-repurposing-content')).toBe('Repurposing Content');
  });
  it('H. schedule-writing-posts / schedule-structured-plan → Scheduling Activities', () => {
    expect(labelOf('schedule-writing-posts')).toBe('Scheduling Activities');
    expect(labelOf('schedule-structured-plan')).toBe('Scheduling Activities');
  });
});

describe('I. canonical labels identical across builders (same backend stage → same label)', () => {
  it('every backend stage that appears in ≥2 modes maps to the SAME label', () => {
    const samples = ['source-recommendation', 'ai/plan', 'commit-plan', 'generate-weekly-structure', 'schedule-structured-plan'];
    for (const runtime of samples) {
      const t = (() => { const p = getProgressPipeline('TEXT'); return p[resolveCanonicalStageIndex(runtime, p)]?.label; })();
      const c = (() => { const p = getProgressPipeline('CREATOR'); return p[resolveCanonicalStageIndex(runtime, p)]?.label; })();
      const m = (() => { const p = getProgressPipeline('COMBINED'); return p[resolveCanonicalStageIndex(runtime, p)]?.label; })();
      // present-in-mode labels must agree (undefined = hidden in that mode, allowed)
      const present = [t, c, m].filter(Boolean);
      expect(new Set(present).size).toBe(1);
    }
  });
  it('removes the old builder-specific wording', () => {
    const all = [...labels('TEXT'), ...labels('CREATOR'), ...labels('COMBINED')];
    for (const old of ['Preparing week plan', 'Creating week plan', 'Analysing signals', 'Creating campaign plan', 'Building daily activities', 'Creating daily plans']) {
      expect(all).not.toContain(old);
    }
  });
});

describe('J. ai/plan substages resolve to Building Strategy (substage rendering unaffected)', () => {
  const combined = getProgressPipeline('COMBINED');
  const bsIndex = combined.findIndex((s) => s.stage === 'ai/plan');
  for (const sub of ['ai/plan:context', 'ai/plan:drafting', 'ai/plan:repairing-campaign-skeleton', 'ai/plan:scoring', 'ai/plan:evaluating-alignment', 'ai/plan:refining']) {
    it(`${sub} → Building Strategy index`, () => {
      expect(resolveCanonicalStageIndex(sub, combined)).toBe(bsIndex);
    });
  }
  it('generate-weekly-structure batch substages → Building Activities', () => {
    expect(combined[resolveCanonicalStageIndex('generate-weekly-structure-weeks-1-4', combined)]?.label).toBe('Building Activities');
    expect(combined[resolveCanonicalStageIndex('generate-weekly-structure-week-3', combined)]?.label).toBe('Building Activities');
    expect(combined[resolveCanonicalStageIndex('commit-plan', combined)]?.label).toBe('Building Activities');
  });
});
