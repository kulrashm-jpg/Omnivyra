/**
 * K3 — the profile fallback is degraded, not authoritative.
 *
 * buildProfileFallbackFeatures is derived purely from profile signals, so it can
 * speak for exactly three of the nineteen canonical feature keys. It was
 * previously handed to card-state logic unmarked and indistinguishable from a
 * real feature dataset, which is how a transient feature-API failure turned a
 * configured workspace into "Setup needed" / "In progress".
 *
 * The fallback is retained for the three keys it genuinely knows; what changes
 * is that the result is now MARKED, and cards whose required keys it cannot
 * cover resolve to `unknown` rather than to a fabricated product state.
 */
import {
  PROFILE_FALLBACK_FEATURE_KEYS,
  getCardStateFromFeatures,
} from '../../services/commandCenterReadinessService';
import { FeatureKey } from '../../types/featureCompletion';

const SOURCE_PATH = 'backend/services/commandCenterReadinessService.ts';
const SHARED_PATH = 'lib/shared/commandCenterReadinessService.ts';
const read = (p: string) =>
  require('fs').readFileSync(require('path').join(process.cwd(), p), 'utf-8');

describe('K3 — the fallback covers exactly the keys it can know', () => {
  it('exposes exactly three keys', () => {
    expect([...PROFILE_FALLBACK_FEATURE_KEYS]).toEqual([
      'company_profile_completed',
      'website_connected',
      'social_accounts_connected',
    ]);
  });

  it('covers a strict minority of the canonical feature set', () => {
    const canonical = Object.values(FeatureKey);
    expect(canonical.length).toBeGreaterThan(PROFILE_FALLBACK_FEATURE_KEYS.length);
    PROFILE_FALLBACK_FEATURE_KEYS.forEach((k) => expect(canonical).toContain(k));
  });

  it('cannot represent any achievement-derived feature', () => {
    const achievementKeys = [
      FeatureKey.REPORT_GENERATED,
      FeatureKey.BLOG_CREATED,
      FeatureKey.CAMPAIGN_CREATED,
      FeatureKey.CAMPAIGN_PUBLISHED,
      FeatureKey.API_CONFIGURED,
      FeatureKey.CHROME_EXTENSION_INSTALLED,
      FeatureKey.FREE_CREDITS_USED,
      FeatureKey.MARKET_PULSE_USED,
    ];
    achievementKeys.forEach((k) =>
      expect(PROFILE_FALLBACK_FEATURE_KEYS as readonly string[]).not.toContain(k),
    );
  });

  it('builds only from profile signals — no achievement source', () => {
    const src = read(SOURCE_PATH);
    const body = src.slice(
      src.indexOf('function buildProfileFallbackFeatures'),
      src.indexOf('function statusFromScore'),
    );
    PROFILE_FALLBACK_FEATURE_KEYS.forEach((k) => expect(body).toContain(k));
    expect(body).not.toContain('report_generated');
    expect(body).not.toContain('campaign_created');
    expect(body).not.toContain('blog_created');
  });
});

describe('K3 — the degraded result is marked', () => {
  it('MUTATION GUARD: the fallback branch sets featuresDegraded before building', () => {
    [SOURCE_PATH, SHARED_PATH].forEach((p) => {
      const src = read(p);
      expect(src).toMatch(
        /featuresDegraded = true;\s*\n\s*features = buildProfileFallbackFeatures\(profileSignals\);/,
      );
    });
  });

  it('the flag is initialised false so the success path stays authoritative', () => {
    [SOURCE_PATH, SHARED_PATH].forEach((p) => {
      expect(read(p)).toContain('let featuresDegraded = false;');
    });
  });

  it('the flag is returned to the caller', () => {
    [SOURCE_PATH, SHARED_PATH].forEach((p) => {
      expect(read(p)).toContain('return { features, readiness, featuresDegraded };');
    });
  });

  it('the success path never marks the dataset degraded', () => {
    [SOURCE_PATH, SHARED_PATH].forEach((p) => {
      const src = read(p);
      // Exactly one assignment to true, and it lives in the !ok branch.
      expect(src.match(/featuresDegraded = true/g) || []).toHaveLength(1);
      // The single assignment must sit in the !ok branch — i.e. strictly before
      // the success branch begins parsing the response body.
      const flagAt = src.indexOf('featuresDegraded = true');
      const successBranchAt = src.indexOf('const featuresData = await featuresRes.json()');
      expect(flagAt).toBeGreaterThan(-1);
      expect(successBranchAt).toBeGreaterThan(-1);
      expect(flagAt).toBeLessThan(successBranchAt);
    });
  });

  it('both copies expose the same result contract', () => {
    [SOURCE_PATH, SHARED_PATH].forEach((p) => {
      const src = read(p);
      expect(src).toContain('export interface ReadinessFetchResult');
      expect(src).toContain('featuresDegraded: boolean;');
      expect(src).toContain('Promise<ReadinessFetchResult | null>');
    });
  });
});

describe('K3 — a degraded dataset cannot fabricate card state', () => {
  const fallbackDataset = PROFILE_FALLBACK_FEATURE_KEYS.map((key) => ({
    key,
    status: 'completed' as const,
    score: 1,
  }));

  it('cards requiring keys the fallback cannot cover become unknown', () => {
    // reports needs report_generated; blogs needs blog_created; campaigns needs
    // campaign_created/published + api_configured; engagement needs the extension.
    ['reports', 'blogs', 'campaigns', 'engagement'].forEach((card) => {
      expect(getCardStateFromFeatures(card, fallbackDataset as any)).toBe('unknown');
    });
  });

  it('MUTATION GUARD: a degraded dataset never yields in_progress or not_started', () => {
    ['reports', 'blogs', 'campaigns', 'engagement'].forEach((card) => {
      const state = getCardStateFromFeatures(card, fallbackDataset as any);
      expect(state).not.toBe('in_progress');
      expect(state).not.toBe('not_started');
      expect(state).not.toBe('ready');
    });
  });

  it('a genuinely known key keeps its value inside the degraded set', () => {
    // The fallback still carries real profile information; it is simply not a
    // complete dataset. A card whose ENTIRE requirement is covered still resolves.
    const covered = getCardStateFromFeatures('engagement', [
      { key: 'social_accounts_connected', status: 'completed', score: 1 },
      { key: 'chrome_extension_installed', status: 'completed', score: 1 },
    ] as any);
    expect(covered).toBe('ready');
  });

  it('a successful API response is unaffected by the fallback implementation', () => {
    const authoritative = [
      { key: 'blog_created', status: 'completed', score: 1 },
      { key: 'company_profile_completed', status: 'completed', score: 1 },
    ];
    expect(getCardStateFromFeatures('blogs', authoritative as any)).toBe('ready');
  });
});
