/**
 * The shared LinkedIn URL normaliser and slug classifier, driven ENTIRELY by
 * the shared fixture table (`lib/linkedin/profileUrlFixtures.ts`) that
 * Outreach's extension suite also runs, so both sides agree row for row.
 */
import { classifyLinkedinProfile, normalizeLinkedinUrl } from '../../../lib/linkedin/profileUrl';
import {
  CLASSIFY_FIXTURES,
  EQUIVALENCE_FIXTURES,
  NORMALIZE_FIXTURES,
} from '../../../lib/linkedin/profileUrlFixtures';

describe('normalizeLinkedinUrl (shared fixtures)', () => {
  it.each(NORMALIZE_FIXTURES.map((f) => [f.why, f]))('%s', (_why, f) => {
    expect(normalizeLinkedinUrl(f.input, f.space ?? '/in/')).toBe(f.want);
  });

  it.each(EQUIVALENCE_FIXTURES.map((f) => [f.why, f]))('%s', (_why, f) => {
    const a = normalizeLinkedinUrl(f.a, '/in/');
    const b = normalizeLinkedinUrl(f.b, '/in/');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a === b).toBe(f.same);
  });
});

describe('classifyLinkedinProfile (shared fixtures): a label, not a gate', () => {
  it.each(CLASSIFY_FIXTURES.map((f) => [f.why, f]))('%s', (_why, f) => {
    const out = classifyLinkedinProfile(f.input);
    expect(out.form).toBe(f.form);
    if (f.key !== undefined) expect(out.key).toBe(f.key);
    if (f.form === 'refused') expect(out.key).toBeNull();
  });
});
