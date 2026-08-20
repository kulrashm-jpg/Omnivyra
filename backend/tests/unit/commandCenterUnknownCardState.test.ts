/**
 * K2 — `unknown` card state.
 *
 * Absent feature data and incomplete feature data are different facts. The old
 * logic could not tell them apart: completedCount counted only the keys the
 * dataset contained but compared against the full required count, so a partial
 * dataset could never reach `ready`, and an empty one fell through to
 * `not_started` — rendering "Setup needed" on a workspace that was configured.
 *
 * These tests pin BOTH halves: complete data must behave exactly as before, and
 * absent data must resolve to `unknown` rather than to any product state.
 */
import { getCardStateFromFeatures } from '../../services/commandCenterReadinessService';

type F = { key: string; status: 'completed' | 'in_progress' | 'not_started'; score: number };
const f = (key: string, status: F['status'], score = status === 'completed' ? 1 : 0): F => ({ key, status, score });

// Required sets, from FEATURE_CARD_MAP.
const REPORTS = ['report_generated', 'company_profile_completed', 'website_connected'];
const BLOGS = ['blog_created', 'company_profile_completed'];
const CAMPAIGNS = ['campaign_created', 'campaign_published', 'social_accounts_connected', 'api_configured', 'company_profile_completed'];
const ENGAGEMENT = ['social_accounts_connected', 'chrome_extension_installed'];

const allOf = (keys: string[], status: F['status']): F[] => keys.map((k) => f(k, status));

describe('K2 — complete data behaves exactly as before', () => {
  it('every required key completed → ready', () => {
    expect(getCardStateFromFeatures('reports', allOf(REPORTS, 'completed') as any)).toBe('ready');
    expect(getCardStateFromFeatures('blogs', allOf(BLOGS, 'completed') as any)).toBe('ready');
    expect(getCardStateFromFeatures('campaigns', allOf(CAMPAIGNS, 'completed') as any)).toBe('ready');
    expect(getCardStateFromFeatures('engagement', allOf(ENGAGEMENT, 'completed') as any)).toBe('ready');
  });

  it('all keys present, none completed → not_started (a genuine product state)', () => {
    expect(getCardStateFromFeatures('blogs', allOf(BLOGS, 'not_started') as any)).toBe('not_started');
    expect(getCardStateFromFeatures('engagement', allOf(ENGAGEMENT, 'not_started') as any)).toBe('not_started');
  });

  it('all keys present, some completed → in_progress', () => {
    const partial = [f('blog_created', 'completed'), f('company_profile_completed', 'not_started')];
    expect(getCardStateFromFeatures('blogs', partial as any)).toBe('in_progress');
  });

  it('all keys present, one merely in_progress → in_progress, NOT unknown', () => {
    const present = [f('blog_created', 'in_progress', 0.5), f('company_profile_completed', 'not_started')];
    expect(getCardStateFromFeatures('blogs', present as any)).toBe('in_progress');
  });

  it('present-but-incomplete is never reclassified as unknown', () => {
    const present = allOf(CAMPAIGNS, 'not_started');
    expect(getCardStateFromFeatures('campaigns', present as any)).toBe('not_started');
  });
});

describe('K2 — absent data resolves to unknown', () => {
  it('empty feature array → unknown, not not_started', () => {
    ['reports', 'blogs', 'campaigns', 'engagement'].forEach((card) => {
      expect(getCardStateFromFeatures(card, [] as any)).toBe('unknown');
    });
  });

  it('null / undefined feature data → unknown, not not_started', () => {
    expect(getCardStateFromFeatures('blogs', null as any)).toBe('unknown');
    expect(getCardStateFromFeatures('blogs', undefined as any)).toBe('unknown');
  });

  it('one required key missing → unknown even when the present ones are completed', () => {
    // blogs requires blog_created + company_profile_completed; supply only the latter.
    const missingOne = [f('company_profile_completed', 'completed')];
    expect(getCardStateFromFeatures('blogs', missingOne as any)).toBe('unknown');
  });

  it('MUTATION GUARD: a partial dataset must not be downgraded to in_progress', () => {
    // This is the exact shape the old code turned into "In progress": some
    // required keys completed, the rest simply absent from the response.
    const partialDataset = [
      f('campaign_created', 'completed'),
      f('social_accounts_connected', 'completed'),
      f('company_profile_completed', 'completed'),
      // campaign_published and api_configured absent
    ];
    expect(getCardStateFromFeatures('campaigns', partialDataset as any)).toBe('unknown');
    expect(getCardStateFromFeatures('campaigns', partialDataset as any)).not.toBe('in_progress');
    expect(getCardStateFromFeatures('campaigns', partialDataset as any)).not.toBe('not_started');
  });

  it('reproduces the reported symptom shape and proves it no longer occurs', () => {
    // The 3-key profile fallback: exactly what buildProfileFallbackFeatures emits.
    const fallback = [
      f('company_profile_completed', 'completed'),
      f('website_connected', 'completed'),
      f('social_accounts_connected', 'completed'),
    ];
    // Previously: blogs/campaigns/engagement → in_progress; reports → in_progress.
    // Now every card whose required keys are not fully represented is unknown.
    expect(getCardStateFromFeatures('reports', fallback as any)).toBe('unknown');
    expect(getCardStateFromFeatures('blogs', fallback as any)).toBe('unknown');
    expect(getCardStateFromFeatures('campaigns', fallback as any)).toBe('unknown');
    expect(getCardStateFromFeatures('engagement', fallback as any)).toBe('unknown');
  });

  it('unrelated extra keys do not affect the decision', () => {
    const withExtras = [...allOf(BLOGS, 'completed'), f('market_pulse_used', 'completed')];
    expect(getCardStateFromFeatures('blogs', withExtras as any)).toBe('ready');
  });
});

describe('K2 — the lib/shared copy stays in lockstep', () => {
  // The two implementations are deliberately NOT merged in this task, so the
  // duplicate must be pinned to the same contract or they will drift apart.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const shared = require('../../../lib/shared/commandCenterReadinessService');

  it('agrees with the backend copy on every case above', () => {
    const cases: Array<[string, any]> = [
      ['blogs', allOf(BLOGS, 'completed')],
      ['blogs', allOf(BLOGS, 'not_started')],
      ['blogs', []],
      ['blogs', [f('company_profile_completed', 'completed')]],
      ['campaigns', allOf(CAMPAIGNS, 'completed')],
      ['engagement', []],
    ];
    for (const [card, features] of cases) {
      expect(shared.getCardStateFromFeatures(card, features)).toBe(
        getCardStateFromFeatures(card, features),
      );
    }
  });
});

describe('K2 — rendering contract', () => {
  const VIEW = require('fs').readFileSync(
    require('path').join(process.cwd(), 'components/CommandCenterView.tsx'),
    'utf-8',
  );

  it('renders a neutral "Checking…" label for unknown', () => {
    expect(VIEW).toContain("card.state === 'unknown'");
    expect(VIEW).toContain('Checking…');
  });

  it('never labels unknown as "Setup needed"', () => {
    // Pin the badge ternary itself: unknown must map to Checking…, and
    // "Setup needed" must remain the final else rather than unknown's label.
    expect(VIEW).toMatch(/card\.state === 'unknown'\s*\?\s*'Checking…'\s*:\s*'Setup needed'/);
  });

  it('suppresses the setup nudge for unknown', () => {
    expect(VIEW).toMatch(/card\.state === 'ready' \|\| card\.state === 'unknown'/);
  });
});

describe('K2 — the hook no longer asserts not_started on empty data', () => {
  const HOOK = require('fs').readFileSync(
    require('path').join(process.cwd(), 'hooks/useCommandCenterCore.tsx'),
    'utf-8',
  );

  it('MUTATION GUARD: the empty-array short circuit is gone', () => {
    expect(HOOK).not.toMatch(/features\.length > 0 \? getCardStateFromFeatures\([^)]*\) : 'not_started'/);
    expect(HOOK).toContain('const cardState = getCardStateFromFeatures(card.id, features);');
  });
});
