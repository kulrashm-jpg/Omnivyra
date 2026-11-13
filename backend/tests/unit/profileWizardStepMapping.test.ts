/**
 * UI steps 6.2 + 6.3: each company-profile block or field shows on its wizard step
 * (approved plan: merge the screens, not the columns). Before the profile exists
 * (onboarding pre-refine), showStep / showAnyStep are always true, so that flow is
 * unchanged. Mixed cards ("Messaging & Audience", "Commercial Strategy") show on any
 * step that has one of their fields, and each field is wrapped with its own step.
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const OPEN = /\{(?:showStep\('([a-z]+)'\)|showAnyStep\(\[([^\]]+)\]\)|!showOnboardingContinuation) && \(<>/g;
const CLOSE = /<\/>\)\}/g;

/** The innermost wrapper around `marker`: 'step', 'any:a,b' or 'pre-wizard'; null if none. */
function wrapperOf(src: string, marker: string): string | null {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  const tokens: Array<{ pos: number; kind: 'open' | 'close'; label?: string }> = [];
  for (const m of src.matchAll(OPEN)) {
    const label = m[1] ? m[1] : m[2] ? `any:${m[2].replace(/['\s]/g, '')}` : 'pre-wizard';
    tokens.push({ pos: m.index!, kind: 'open', label });
  }
  for (const m of src.matchAll(CLOSE)) tokens.push({ pos: m.index!, kind: 'close' });
  tokens.sort((a, b) => a.pos - b.pos);
  const stack: string[] = [];
  for (const t of tokens) {
    if (t.pos >= at) break;
    if (t.kind === 'open') stack.push(t.label!);
    else stack.pop();
  }
  return stack.length ? stack[stack.length - 1] : null;
}

const A = read('components/CompanyProfileFormSectionsA.tsx');
const B = read('components/CompanyProfileFormSectionsB.tsx');
const C = read('components/CompanyProfileFormSectionsC.tsx');
const M = read('components/companyProfileFormMain.tsx');

describe('company-profile blocks and fields → wizard steps', () => {
  it.each([
    // whole blocks (6.2)
    [A, 'title="Please Provide This Information"', 'sources'],
    [A, '{renderOnboardingRefineAction()}', 'sources'],
    [A, 'title="Guided Capture"', 'sources'],
    [A, 'title="Brand Assets"', 'voice'],
    [A, 'title="AI-Populated Company Profile"', 'basics'],
    [B, 'title="Company Facts"', 'basics'],
    [C, '<CompanyStrategyProfileCard', 'advanced'],
    [C, '<IntelligenceContextSections', 'advanced'],
    [C, 'title="Market Pulse Defaults"', 'advanced'],
    [C, '>Marketing Intelligence</h3>', 'voice'],
    [C, 'title="Intelligence Operating Target"', 'goals'],
    [C, '>Problem & Transformation</h3>', 'problem'],
    [M, 'Latest Refinement Insights', 'review'],
    // "Messaging & Audience" fields (6.3)
    [B, '>Products & Services<', 'offering'],
    [B, '>Unique Value<', 'offering'],
    [B, '>Target Audience<', 'audience'],
    [B, '>Competitors<', 'audience'],
    [B, '>Brand Voice<', 'voice'],
    [B, '>Content Themes<', 'voice'],
    [B, '>Goals<', 'goals'],
    // "Commercial Strategy" fields (6.3)
    [C, '>Pricing model<', 'offering'],
    [C, '>Target customer segment<', 'audience'],
    [C, '>Ideal customer profile<', 'audience'],
    [C, '>Sales motion<', 'audience'],
    [C, '>Avg deal size<', 'audience'],
    [C, '>Sales cycle<', 'audience'],
    [C, 'Campaign Purpose &', 'goals'],
    [C, '>Key metrics<', 'goals'],
  ])('%#: %s → %s', (src, marker, step) => {
    expect(wrapperOf(src as string, marker as string)).toBe(step);
  });

  it('mixed cards show on any step that has one of their fields, titled after the step', () => {
    expect(wrapperOf(B, "title={wizardStepTitle ?? 'Messaging & Audience'}")).toBe('any:offering,audience,voice,goals');
    expect(wrapperOf(C, 'commercial details')).toBe('any:offering,audience,goals');
  });

  it('wrappers are balanced in every file', () => {
    for (const src of [A, B, C, M]) {
      expect((src.match(CLOSE) ?? []).length).toBe((src.match(OPEN) ?? []).length);
    }
  });

  it('showStep / showAnyStep keep the pre-wizard (onboarding pre-refine) flow unchanged', () => {
    const c = read('components/companyProfileFormController.tsx');
    expect(c).toMatch(/const showStep = \(id: WizardStepId\) => !showOnboardingContinuation \|\| wizardStep === id;/);
    expect(c).toMatch(/const showAnyStep = \(ids: readonly WizardStepId\[\]\) => !showOnboardingContinuation \|\| ids\.includes\(wizardStep\);/);
  });

  it('the decorative "Step 1-4" row is hidden once the real wizard shows', () => {
    expect(wrapperOf(M, "['1', 'Source intake'")).toBe('pre-wizard');
  });
});
