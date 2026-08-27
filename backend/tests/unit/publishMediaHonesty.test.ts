/**
 * P3-A — media execution honesty.
 *
 * THE invariant: a post that asked for media can never be reported as a
 * successful text-only publication.
 *
 * Before P3-A both LinkedIn and X had a silent-strip branch — media present,
 * upload unavailable or failed, publish the text anyway, return success, log a
 * warning. A reviewed image campaign shipped as bare text and nothing
 * downstream could tell.
 *
 * The canonical policy already existed (publishReadinessValidator's
 * MEDIA_WOULD_BE_STRIPPED guard, PUBLISH_GUARD_MODE default `enforce`); P3-A
 * reuses it rather than inventing one, and closes the two adapter branches
 * that bypassed it when the guard is in `warn`/`off`.
 */

import { PipelineErrorCode } from '../../../lib/shared/pipelineErrorCodes';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
});

/* ────────────────────────────────────────────────────────────────────────
 * 1. CAPABILITY — LinkedIn is configuration-driven, not a code constant
 * ──────────────────────────────────────────────────────────────────────── */
describe('LinkedIn media capability is configuration-driven', () => {
  const load = () => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../../services/publishReadinessValidator');
  };

  it('DEFAULT (env unset) — LinkedIn cannot publish media, exactly as before', () => {
    delete process.env.LINKEDIN_MEDIA_UPLOAD_ENABLED;
    expect(load().adapterCanPublishMedia('linkedin')).toBe(false);
  });

  it('explicit false — cannot publish media', () => {
    process.env.LINKEDIN_MEDIA_UPLOAD_ENABLED = 'false';
    expect(load().adapterCanPublishMedia('linkedin')).toBe(false);
  });

  it('enabling the env var NOW opens the readiness guard (it previously could not)', () => {
    process.env.LINKEDIN_MEDIA_UPLOAD_ENABLED = 'true';
    expect(load().adapterCanPublishMedia('linkedin')).toBe(true);
  });

  it('the media-capable platforms are unchanged', () => {
    const { adapterCanPublishMedia } = load();
    for (const p of ['instagram', 'youtube', 'tiktok', 'pinterest', 'facebook']) {
      expect(adapterCanPublishMedia(p)).toBe(true);
    }
    expect(adapterCanPublishMedia('x')).toBe(false);
  });

  it('an unregistered platform is NOT treated as media-incapable (semantics preserved)', () => {
    // The previous test was `[platform] === false`, which never fired for
    // platforms absent from the map. That blast radius must not change.
    expect(load().adapterCanPublishMedia('some-future-platform')).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 2. GUARD — the existing canonical policy, exercised end to end
 * ──────────────────────────────────────────────────────────────────────── */
describe('publish-readiness guard (existing policy, reused)', () => {
  const validate = (over: Record<string, unknown> = {}) => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { validatePublishReadiness } = require('../../services/publishReadinessValidator');
    return validatePublishReadiness({
      platform: 'linkedin',
      contentSignals: { contentType: 'post' },
      hasText: true,
      mediaUrls: ['https://cdn.example.com/a.jpg'],
      content: 'Body',
      skipSchedulingReadiness: true,
      ...over,
    });
  };

  it('media + LinkedIn disabled → blocked with MEDIA_WOULD_BE_STRIPPED', () => {
    process.env.LINKEDIN_MEDIA_UPLOAD_ENABLED = 'false';
    process.env.PUBLISH_GUARD_MODE = 'enforce';
    const r = validate();
    expect(r.ok).toBe(false);
    expect(r.code).toBe(PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED);
    expect(r.message).toMatch(/TEXT ONLY/);
  });

  it('media + LinkedIn ENABLED → the guard no longer blocks', () => {
    process.env.LINKEDIN_MEDIA_UPLOAD_ENABLED = 'true';
    process.env.PUBLISH_GUARD_MODE = 'enforce';
    expect(validate().ok).toBe(true);
  });

  it('genuinely text-only LinkedIn post is unaffected either way', () => {
    process.env.LINKEDIN_MEDIA_UPLOAD_ENABLED = 'false';
    expect(validate({ mediaUrls: [] }).ok).toBe(true);
  });

  it('warn mode downgrades to a warning (existing mode semantics preserved)', () => {
    process.env.LINKEDIN_MEDIA_UPLOAD_ENABLED = 'false';
    process.env.PUBLISH_GUARD_MODE = 'warn';
    const r = validate();
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.warnings ?? [])).toContain(PipelineErrorCode.MEDIA_WOULD_BE_STRIPPED);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 3. ADAPTERS — the branches that bypassed the guard in warn/off mode
 * ──────────────────────────────────────────────────────────────────────── */
const linkedinAdapterSource = () =>
  require('fs').readFileSync(require('path').join(__dirname, '../../adapters/linkedinAdapter.ts'), 'utf8');
const xAdapterSource = () =>
  require('fs').readFileSync(require('path').join(__dirname, '../../adapters/xAdapter.ts'), 'utf8');

/** Comment-free source: a docblock explaining a removed behaviour must not
 *  read as the behaviour still existing. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

describe('LinkedIn adapter — media requested but capability off', () => {
  it('returns a structured failure instead of publishing text-only', () => {
    const src = code(linkedinAdapterSource());
    expect(src).toContain('MEDIA_WOULD_BE_STRIPPED');
    // The failure is returned from the capability-off branch…
    expect(src).toMatch(/!linkedinMediaEnabled[\s\S]{0,900}?success:\s*false/);
    // …and is NOT retryable (retrying cannot flip a switched-off capability).
    expect(src).toMatch(/MEDIA_WOULD_BE_STRIPPED[\s\S]{0,400}?retryable:\s*false/);
  });

  it('no longer falls through to a text-only publish on that branch', () => {
    // The old branch logged and continued; there must be no path from
    // "media present + flag off" to the publish fetch.
    expect(code(linkedinAdapterSource())).not.toMatch(/publishing as TEXT ONLY/);
  });

  it('the real upload pipeline (image AND video) is untouched', () => {
    const src = code(linkedinAdapterSource());
    expect(src).toContain('getOrUploadLinkedInAsset');
    expect(src).toContain('multiImage');           // carousel path preserved
    expect(src).toContain('LINKEDIN_MIXED_MEDIA_UNSUPPORTED');
  });

  it('an upload failure still returns the upload error, not a text-only success', () => {
    const src = code(linkedinAdapterSource());
    expect(src).toMatch(/outcome\.ok === false[\s\S]{0,300}?success:\s*false/);
  });
});

describe('X adapter — media upload failure', () => {
  it('no longer posts text-only when the upload throws', () => {
    const src = code(xAdapterSource());
    expect(src).not.toMatch(/posting text-only/);
    expect(src).toContain('refusing to post text-only');
  });

  it('returns a retryable structured failure (existing BullMQ retry applies)', () => {
    const src = code(xAdapterSource());
    expect(src).toContain('MEDIA_WOULD_BE_STRIPPED');
    expect(src).toMatch(/MEDIA_WOULD_BE_STRIPPED[\s\S]{0,400}?retryable:\s*true/);
  });

  it('covers BOTH failure shapes: thrown error and empty media_ids', () => {
    const src = code(xAdapterSource());
    const occurrences = src.split('MEDIA_WOULD_BE_STRIPPED').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('a successful upload still attaches media_ids', () => {
    expect(code(xAdapterSource())).toMatch(/payload\.media = \{ media_ids: mediaIds \}/);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 4. THE INVARIANT — no adapter may report text-only success for a media post
 * ──────────────────────────────────────────────────────────────────────── */
describe('cross-adapter invariant', () => {
  it('no adapter contains a "post text-only anyway" fallback for requested media', () => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '../../adapters');
    const offenders: string[] = [];
    for (const f of fs.readdirSync(dir).filter((n: string) => n.endsWith('Adapter.ts'))) {
      const src = code(fs.readFileSync(path.join(dir, f), 'utf8'));
      // The two shapes P3-A removed.
      if (/posting text-only/i.test(src) || /publishing as TEXT ONLY/i.test(src)) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 5. SCOPE — canonical persistence untouched
 * ──────────────────────────────────────────────────────────────────────── */
describe('P3-A scope protection', () => {
  it('canonical content persistence remains default-DENY', () => {
    delete process.env.CANONICAL_PERSISTENCE_ENABLED;
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isCanonicalPersistenceEnabled } = require('../../services/content/canonicalPersistencePolicy');
    expect(isCanonicalPersistenceEnabled()).toBe(false);
  });
});
