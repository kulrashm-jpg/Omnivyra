/**
 * ONBOARD-003 — onboarding state consolidation. Deterministic guards proving the
 * duplicate onboarding progress models / orphaned UI are removed and every onboarding
 * surface consumes the single canonical authority (onboardingJourneyService via the
 * one hook / the one API). No DB — reads the source tree.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

// The live onboarding surfaces after consolidation.
const CARD = 'components/onboarding/DashboardOnboardingCard.tsx';
const RESUME = 'components/onboarding/ResumeSetupLink.tsx';
const HOOK = 'hooks/useOnboardingJourney.ts';
const JOURNEY_PAGE = 'pages/onboarding/journey.tsx';
const POST_LOGIN = 'pages/api/auth/post-login-route.ts';

describe('ONBOARD-003 §3/§8 — duplicate onboarding models & orphaned UI removed', () => {
  test('the four-model duplication (localStorage hook + orphaned onboarding UI) is gone', () => {
    for (const f of [
      'hooks/useOnboarding.ts',                       // localStorage onboarding model
      'components/onboarding/OnboardingWizard.tsx',    // orphaned duplicate wizard
      'components/onboarding/ProgressBar.tsx',         // orphaned onboarding progress bar
      'components/SetupProgress.tsx',                  // orphaned onboarding checklist
      'components/ContextualSetupPrompt.tsx',          // orphaned onboarding nudge
    ]) {
      expect(exists(f)).toBe(false);
    }
  });

  test('the canonical journey surfaces still exist', () => {
    for (const f of [CARD, RESUME, HOOK, JOURNEY_PAGE]) expect(exists(f)).toBe(true);
  });
});

describe('ONBOARD-003 §1/§2 — single canonical authority', () => {
  test('the onboarding hook reads the canonical journey API only', () => {
    const src = read(HOOK);
    expect(src).toMatch(/\/api\/onboarding\/journey/);
    expect(src).not.toMatch(/useSetupProgress/);
    expect(src).not.toMatch(/feature-completion|feature_completion/);
  });

  test('every live onboarding surface consumes the canonical authority (not a duplicate model)', () => {
    // Card + resume link go through the ONE hook; journey page hits the ONE API.
    expect(read(CARD)).toMatch(/useOnboardingJourney/);
    expect(read(RESUME)).toMatch(/useOnboardingJourney/);
    expect(read(JOURNEY_PAGE)).toMatch(/\/api\/onboarding\/journey/);
    // None of them pull in a competing progress model.
    for (const f of [CARD, RESUME, JOURNEY_PAGE]) {
      const src = read(f);
      expect(src).not.toMatch(/useSetupProgress/);
      expect(src).not.toMatch(/hooks\/useOnboarding'/); // the deleted localStorage hook (not ...Journey)
      expect(src).not.toMatch(/feature-completion|feature_completion/);
    }
  });
});

describe('ONBOARD-003 §6 — resume is server-derived', () => {
  test('post-login routing derives resume from the journey authority', () => {
    const src = read(POST_LOGIN);
    expect(src).toMatch(/buildOnboardingJourney/);
    expect(src).toMatch(/onboarding\/journey/);
  });
});

describe('ONBOARD-003 §5 — no localStorage onboarding progress', () => {
  test('no live onboarding surface persists progress in localStorage', () => {
    for (const f of [CARD, RESUME, HOOK, JOURNEY_PAGE]) {
      const src = read(f);
      expect(src).not.toMatch(/omnivyra_onboarding/); // the retired localStorage key
      expect(src).not.toMatch(/localStorage/);
    }
  });
});

describe('ONBOARD-003 §4 — one status vocabulary', () => {
  test('the shared hook exposes exactly the canonical seven statuses', () => {
    const src = read(HOOK);
    for (const s of ['not_started', 'pending', 'in_progress', 'completed', 'skipped', 'dismissed', 'blocked']) {
      expect(src).toContain(`'${s}'`);
    }
  });
});
