/**
 * Canonical platform text-limit wiring.
 *
 * `PLATFORM_CONFIGS` carried `twitter` but no `x`, while the adaptation layer
 * keeps BOTH as direct profile keys (normalizePlatformKey returns each
 * unchanged rather than collapsing them). `getPlatformConfig` is an exact-key
 * lookup, so `getPlatformConfig('x')` returned undefined — which left the
 * single-variant `constraints.max_length` null and dropped every length
 * instruction from the X variant prompt.
 *
 * SCOPE NOTE: platformVariantGenerator has MORE THAN ONE variant path. The
 * batch path (`:255`, `:288`) already applied X_CHAR_LIMIT via an explicit
 * platform-string comparison and was already length-constrained. Only the
 * SINGLE-variant path was unconstrained, and only it is fixed here. The batch
 * path's two string comparisons are deliberately left unchanged.
 */

import {
  getPlatformConfig,
  PLATFORM_CONFIGS,
  SELECTABLE_PLATFORM_CONFIGS,
} from '../../../lib/platforms';
import { X_CHAR_LIMIT } from '../../services/contentGeneration/contentTypeHelpers';
import { toPositiveNumber } from '../../services/contentGeneration/contentTypeHelpers';

/**
 * The resolution the generator performs at platformVariantGenerator.ts:468.
 * Mirrored here so the PRECEDENCE contract is asserted behaviourally without
 * standing up the full generator (which needs a live AI gateway).
 */
function resolveMaxLength(
  callerMaxLength: unknown,
  normalizedPlatform: string,
): number | null {
  const caller = toPositiveNumber(callerMaxLength);
  const platformTextLimit =
    getPlatformConfig(normalizedPlatform)?.constraints?.textLimit ?? null;
  return caller ?? platformTextLimit;
}

const targetFor = (maxLength: number | null) =>
  maxLength ? Math.floor(maxLength * 0.9) : null;

/* ── A. Platform configuration ───────────────────────────────────────────── */

describe('canonical platform configuration', () => {
  it('resolves an "x" configuration', () => {
    expect(getPlatformConfig('x')).toBeDefined();
    expect(getPlatformConfig('x')?.constraints?.textLimit).toBeGreaterThan(0);
  });

  it('resolves a "twitter" configuration', () => {
    expect(getPlatformConfig('twitter')).toBeDefined();
    expect(getPlatformConfig('twitter')?.constraints?.textLimit).toBeGreaterThan(0);
  });

  it('x and twitter share the same canonical text limit', () => {
    // Compared against each other, never against a literal — so the assertion
    // survives a future change to the platform's real limit.
    expect(getPlatformConfig('x')?.constraints?.textLimit)
      .toBe(getPlatformConfig('twitter')?.constraints?.textLimit);
  });

  it('x mirrors twitter across the whole constraint contract, not just textLimit', () => {
    expect(getPlatformConfig('x')?.constraints)
      .toEqual(getPlatformConfig('twitter')?.constraints);
  });

  it('LinkedIn remains independently configured and is not affected', () => {
    const linkedin = getPlatformConfig('linkedin');
    expect(linkedin).toBeDefined();
    expect(linkedin?.constraints?.textLimit)
      .not.toBe(getPlatformConfig('x')?.constraints?.textLimit);
  });

  it('adds exactly one new platform entry — no unrelated platforms were introduced', () => {
    expect(PLATFORM_CONFIGS.map((c) => c.key).sort()).toEqual(['linkedin', 'twitter', 'x']);
  });
});

/* ── A2. UI picker is unaffected ─────────────────────────────────────────── */

describe('selectable platform list', () => {
  it('is byte-identical to the pre-change picker contents', () => {
    // The lookup table gained an `x` entry; the picker must NOT. Same keys,
    // same order, same submitted values as before this change.
    expect(SELECTABLE_PLATFORM_CONFIGS.map((c) => c.key)).toEqual(['linkedin', 'twitter']);
  });

  it('shows no duplicated platform name', () => {
    const names = SELECTABLE_PLATFORM_CONFIGS.map((c) => c.name);
    expect(names).toEqual([...new Set(names)]);
  });

  it('holds no limits of its own — every entry is the same object as the lookup entry', () => {
    for (const config of SELECTABLE_PLATFORM_CONFIGS) {
      expect(config).toBe(getPlatformConfig(config.key));
    }
  });

  it('the scheduler renders the selectable view, never the raw lookup table', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../pages/scheduler.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/(?<!SELECTABLE_)PLATFORM_CONFIGS\.map/);
    expect(src.match(/SELECTABLE_PLATFORM_CONFIGS\.map/g)).toHaveLength(2);
  });
});

/* ── B. Single-variant length resolution ─────────────────────────────────── */

describe('single-variant max_length resolution', () => {
  it('a caller-supplied max_length wins over the canonical platform limit', () => {
    const canonical = getPlatformConfig('x')!.constraints!.textLimit!;
    const caller = canonical + 500;
    expect(resolveMaxLength(caller, 'x')).toBe(caller);
  });

  it('falls back to the canonical limit when the caller omits max_length', () => {
    expect(resolveMaxLength(undefined, 'x'))
      .toBe(getPlatformConfig('x')?.constraints?.textLimit);
  });

  it('resolves the same limit for the "twitter" spelling', () => {
    expect(resolveMaxLength(undefined, 'twitter'))
      .toBe(resolveMaxLength(undefined, 'x'));
  });

  it('an unconfigured platform keeps the previous null behaviour', () => {
    // Regression guard: the fallback must not invent a limit for platforms
    // that have no canonical entry (instagram, youtube, …).
    expect(resolveMaxLength(undefined, 'instagram')).toBeNull();
    expect(resolveMaxLength(undefined, 'unknown')).toBeNull();
  });

  it('a zero/negative caller value falls through rather than pinning to a falsy limit', () => {
    // toPositiveNumber returns undefined for these, so ?? falls through.
    expect(resolveMaxLength(0, 'x')).toBe(getPlatformConfig('x')?.constraints?.textLimit);
    expect(resolveMaxLength(-10, 'x')).toBe(getPlatformConfig('x')?.constraints?.textLimit);
  });

  it('preserves the existing 90% target calculation', () => {
    const max = resolveMaxLength(undefined, 'x')!;
    expect(targetFor(max)).toBe(Math.floor(max * 0.9));
  });

  it('yields a null target when no limit resolves', () => {
    expect(targetFor(resolveMaxLength(undefined, 'instagram'))).toBeNull();
  });
});

/* ── C. Deterministic renderer ───────────────────────────────────────────── */

describe('deterministic X renderer limit', () => {
  it('X_CHAR_LIMIT derives from the canonical X configuration', () => {
    expect(X_CHAR_LIMIT).toBe(getPlatformConfig('x')?.constraints?.textLimit);
  });

  it('the prompt path and the deterministic path agree on one limit', () => {
    // The whole point of the derivation: these two cannot drift apart.
    expect(X_CHAR_LIMIT).toBe(resolveMaxLength(undefined, 'x'));
  });

  it('is a usable positive number at module initialisation', () => {
    // X_CHAR_LIMIT changed from a literal to a module-init expression; guard
    // against it resolving to undefined/NaN at import time.
    expect(Number.isFinite(X_CHAR_LIMIT)).toBe(true);
    expect(X_CHAR_LIMIT).toBeGreaterThan(0);
  });
});

/* ── D. Source-level scope guards ────────────────────────────────────────── */

describe('scope', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');

  it('the generator introduces no hardcoded platform limit', () => {
    const src = read('backend/services/contentGeneration/platformVariantGenerator.ts');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const resolution = code.slice(code.indexOf('const callerMaxLength'), code.indexOf('const formatFamily'));
    expect(resolution).not.toMatch(/\b280\b/);
    expect(resolution).toMatch(/getPlatformConfig\(normalizedPlatform\)/);
  });

  it('X_CHAR_LIMIT is no longer a standalone numeric literal', () => {
    const src = read('backend/services/contentGeneration/contentTypeHelpers.ts');
    expect(src).not.toMatch(/export const X_CHAR_LIMIT = 280;/);
    expect(src).toMatch(/export const X_CHAR_LIMIT = getPlatformConfig\('x'\)/);
  });

  it('the batch variant path is left unchanged (explicitly out of scope)', () => {
    const src = read('backend/services/contentGeneration/platformVariantGenerator.ts');
    expect(src).toMatch(/target\.platform === 'x' \|\| target\.platform === 'twitter' \? X_CHAR_LIMIT/);
  });

  it('the platform-agnostic master contract is untouched', () => {
    const src = read('lib/post/runPostGeneration.ts');
    expect(src).toContain('- Write the master draft as platform-agnostic source content.');
    expect(src).toContain('- Save platform-native shaping for the variant generation step only.');
  });
});
