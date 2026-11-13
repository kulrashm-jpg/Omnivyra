/**
 * UI step 6.2: each existing company-profile block shows on exactly one wizard step
 * (approved plan, screens-not-columns). Before the profile exists (onboarding
 * pre-refine), showStep() is always true, so that flow is unchanged.
 * Mixed blocks ("Messaging & Audience", "Commercial Strategy") are split field by field
 * in 6.3; until then they sit on Audience / Goals.
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/** The step whose `{showStep('x') && (<>` wrapper most closely precedes `marker`. */
function stepOf(src: string, marker: string): string | null {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  const before = src.slice(0, at);
  // Both wrapper forms close with `</>)}`; count both kinds of opener.
  const opens = [...before.matchAll(/\{(?:showStep\('([a-z]+)'\)|!showOnboardingContinuation) && \(<>/g)];
  const closes = (before.match(/<\/>\)\}/g) ?? []).length;
  // Wrappers aren't nested, so the block is wrapped iff opens exceed closes.
  return opens.length > closes ? opens[opens.length - 1][1] ?? null : null;
}

describe('company-profile blocks → wizard steps', () => {
  const A = read('components/CompanyProfileFormSectionsA.tsx');
  const B = read('components/CompanyProfileFormSectionsB.tsx');
  const C = read('components/CompanyProfileFormSectionsC.tsx');
  const M = read('components/companyProfileFormMain.tsx');

  it.each([
    [A, 'title="Please Provide This Information"', 'sources'],
    [A, '{renderOnboardingRefineAction()}', 'sources'],
    [A, 'title="Guided Capture"', 'sources'],
    [A, 'title="Brand Assets"', 'voice'],
    [A, 'title="AI-Populated Company Profile"', 'basics'],
    [B, 'title="Company Facts"', 'basics'],
    [B, 'title="Messaging & Audience"', 'audience'],
    [C, '<CompanyStrategyProfileCard', 'advanced'],
    [C, '>Commercial Strategy</h3>', 'goals'],
    [C, '<IntelligenceContextSections', 'advanced'],
    [C, 'title="Market Pulse Defaults"', 'advanced'],
    [C, '>Marketing Intelligence</h3>', 'voice'],
    [C, 'title="Intelligence Operating Target"', 'goals'],
    [C, '>Problem & Transformation</h3>', 'problem'],
    [M, 'Latest Refinement Insights', 'review'],
  ])('block %#: %s → %s', (src, marker, step) => {
    expect(stepOf(src as string, marker as string)).toBe(step);
  });

  it('wrappers are balanced in every file (valid structure, nothing left open)', () => {
    for (const src of [A, B, C, M]) {
      const opens = (src.match(/\{(?:showStep\('[a-z]+'\)|!showOnboardingContinuation) && \(<>/g) ?? []).length;
      const closes = (src.match(/<\/>\)\}/g) ?? []).length;
      expect(closes).toBe(opens);
    }
  });

  it('showStep keeps the pre-wizard (onboarding pre-refine) flow unchanged', () => {
    const c = read('components/companyProfileFormController.tsx');
    expect(c).toMatch(/const showStep = \(id: WizardStepId\) => !showOnboardingContinuation \|\| wizardStep === id;/);
  });

  it('the decorative "Step 1-4" row is hidden once the real wizard shows', () => {
    expect(M).toMatch(/\{!showOnboardingContinuation && \(<>\s*<div[^>]*>\s*\{\[\s*\['1', 'Source intake'/);
  });
});
