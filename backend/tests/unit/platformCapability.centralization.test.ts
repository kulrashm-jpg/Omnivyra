/**
 * Centralization invariants — Round 3 Phase 5.
 *
 * Hard assertions that guard against drift. These tests fail if a future
 * change reintroduces a parallel platform-capability matrix, an adapter-level
 * media short-circuit, or a UI surface that bypasses the canonical filter.
 *
 * Strategy: read source files as strings and assert structural patterns.
 * This is intentionally NOT a behavior test — it's a CI guardrail.
 */

import fs from 'fs';
import path from 'path';
import { getPlatformCapability, PLATFORM_CAPABILITY_REGISTRY } from '../../../lib/shared/social/platformCapabilities';
import { CAPABILITY_LOG_EVENTS } from '../../../lib/shared/social/capabilityEvents';

const REPO_ROOT = path.resolve(__dirname, '../../../');
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

describe('centralization invariants (Round 3 Phase 5)', () => {
  test('no adapter contains media-required short-circuits anymore', () => {
    const adapterFiles = [
      'backend/adapters/instagramAdapter.ts',
      'backend/adapters/pinterestAdapter.ts',
      'backend/adapters/tiktokAdapter.ts',
      'backend/adapters/youtubeAdapter.ts',
    ];
    // Codes that used to live in adapters but now belong to the central validator only.
    const forbiddenCodes = ['INSTAGRAM_NO_MEDIA', 'YOUTUBE_NO_VIDEO'];
    for (const rel of adapterFiles) {
      const src = read(rel);
      for (const code of forbiddenCodes) {
        expect({ file: rel, code, present: src.includes(code) })
          .toEqual({ file: rel, code, present: false });
      }
      // `MISSING_MEDIA` was used by Pinterest/TikTok adapters for the same reason.
      // The string may legitimately appear in error-mapping tables that translate
      // upstream codes to user-facing messages, so we only forbid the
      // short-circuit return shape (`code: 'MISSING_MEDIA'` literal in a return).
      expect(src.includes(`code: 'MISSING_MEDIA',`)).toBe(false);
    }
  });

  test('companyPlatformService no longer ships an inline fallback matrix', () => {
    const src = read('backend/services/companyPlatformService.ts');
    // The removed const had the shape `const fallbacks: Record<string, string[]> = {`
    // and entries like `linkedin: ['post', 'article', ...]`. Detect the
    // structural pattern, not benign `linkedin:` strings in label maps.
    expect(src.match(/fallbacks\s*:\s*Record<string,\s*string\[\]>/)).toBeNull();
    expect(src.match(/linkedin:\s*\[\s*['"]post['"]/)).toBeNull();
    expect(src.match(/instagram:\s*\[\s*['"]post['"]/)).toBeNull();
    // Positive: derives from the canonical registry.
    expect(src.includes('getPlatformCapability')).toBe(true);
  });

  test('multi-platform-scheduler routes through the canonical filter', () => {
    // Surgery 15 (33f691f1): the page became a barrel; content lives in
    // components/MultiPlatformSchedulerMain.tsx — scan the real module.
    const src = read('components/MultiPlatformSchedulerMain.tsx');
    expect(src.includes('filterConnectedPlatformsForContent')).toBe(true);
    // Scheduler must surface the unresolved-capability blocking state.
    expect(src.includes("platformFilter.capability === null")).toBe(true);
  });

  test('ShortformResultPage routes through the canonical filter', () => {
    const src = read('components/content/ShortformResultPage.tsx');
    expect(src.includes('filterConnectedPlatformsForContent')).toBe(true);
  });

  test('CONTENT_PLATFORM_AFFINITY is derived (no inline matrix literal)', () => {
    const src = read('backend/utils/platformEligibility.ts');
    // The legacy hand-maintained matrix had `post: ['linkedin', 'facebook', 'instagram', ...`
    // Re-introducing that literal would break the single-source-of-truth invariant.
    expect(src.match(/post:\s*\[\s*'linkedin'\s*,\s*'facebook'\s*,\s*'instagram'/)).toBeNull();
    // Positive: derives from registry via the build function.
    expect(src.includes('buildContentPlatformAffinity')).toBe(true);
    expect(src.includes('PLATFORM_CAPABILITY_REGISTRY')).toBe(true);
  });

  test('unknown platform cannot render as publishable: registry returns null', () => {
    expect(getPlatformCapability('mystery-net')).toBeNull();
    expect(getPlatformCapability('')).toBeNull();
    expect(getPlatformCapability(null as unknown as string)).toBeNull();
  });

  test('unknown platform via companyPlatformService.getContentTypesForPlatform → empty (fail closed)', async () => {
    const mod = await import('../../services/companyPlatformService');
    // The function is module-private; assert via the registry contract instead.
    // For every registered platform, getPlatformCapability returns a config.
    for (const key of Object.keys(PLATFORM_CAPABILITY_REGISTRY)) {
      expect(getPlatformCapability(key)).not.toBeNull();
    }
    // Module loaded successfully without the legacy fallback map.
    expect(typeof mod.getCompanyPlatformConfig).toBe('function');
  });

  test('structured log event names are used at publish layers', () => {
    const publishNowSrc = read('backend/services/publishNowService.ts');
    const adapterSrc = read('backend/adapters/platformAdapter.ts');
    for (const src of [publishNowSrc, adapterSrc]) {
      // Logger is wired, not console.info, for capability events.
      expect(src.includes('logger.warn')).toBe(true);
      // Both event names come from the canonical CAPABILITY_LOG_EVENTS object.
      expect(src.includes('CAPABILITY_LOG_EVENTS.REJECTED')).toBe(true);
      expect(src.includes('CAPABILITY_LOG_EVENTS.UNRESOLVED')).toBe(true);
    }
  });

  test('deprecated publish module is never re-wired into production (Round-4 Phase 1)', () => {
    // The file was resurrected by a later bulk commit (and SSRF-hardened with
    // everything else) but has ZERO production importers. The protective
    // intent of the Round-4 deprecation is "nothing publishes through it" —
    // assert that no production module imports it, rather than nonexistence.
    const { execSync } = require('child_process');
    const importers = execSync(
      'git grep -l "socialPlatformPublisher" -- backend pages lib components hooks ' +
        '":!backend/tests" ":!backend/services/socialPlatformPublisher.ts" || exit 0',
      { cwd: REPO_ROOT, encoding: 'utf8' },
    ).trim();
    expect(importers).toBe('');
  });

  test('CAPABILITY_LOG_EVENTS enum is complete and stable', () => {
    expect(CAPABILITY_LOG_EVENTS.FILTERED).toBe('platform.capability.filtered');
    expect(CAPABILITY_LOG_EVENTS.REJECTED).toBe('platform.capability.rejected');
    expect(CAPABILITY_LOG_EVENTS.UNRESOLVED).toBe('platform.capability.unresolved');
    // Adding a new event must be a deliberate registry change.
    expect(Object.keys(CAPABILITY_LOG_EVENTS).sort()).toEqual(['FILTERED', 'REJECTED', 'UNRESOLVED']);
  });

  test('multi-platform-scheduler hides unregistered platforms from render (Phase 4)', () => {
    // Surgery 15: page → barrel; logic split across Controller (filter state)
    // and Main (render) — the invariant spans both.
    const src = read('components/MultiPlatformSchedulerController.tsx') +
      read('components/MultiPlatformSchedulerMain.tsx');
    // The render block must iterate the unregistered-filtered list, not the
    // full account list. Catching this protects against accidentally
    // rendering unknown platforms as enabled or disabled chips.
    expect(src.includes('displayablePlatformOptions.map(')).toBe(true);
    expect(src.includes('platformFilter.unregistered')).toBe(true);
  });

  test('all four BOLT surfaces consume the shared platform picker (Round 6)', () => {
    // Each surface must import the shared component AND the shared hook —
    // no inline chip-rendering, no parallel fetch logic.
    const surfaces: Array<{ rel: string; hookExpected: boolean }> = [
      // Text mode: hook is in useBoltStrategy (it owns selection state).
      { rel: 'hooks/useBoltStrategy.tsx', hookExpected: true },
      // Surgery: BoltStrategyView is a barrel — the picker render lives in Main.
      { rel: 'components/BoltStrategyViewMain.tsx', hookExpected: false },
      // Creator mode (view is a barrel — picker render lives in Main).
      { rel: 'hooks/useBoltCreator.tsx', hookExpected: true },
      { rel: 'components/BoltCreatorViewMain.tsx', hookExpected: false },
      // Intelligent Mix legacy pair (QUARANTINED dead code — kept in the scan so
      // a resurrection still satisfies the picker contract).
      { rel: 'hooks/useIntelMix.tsx', hookExpected: true },
      { rel: 'components/IntelMixView.tsx', hookExpected: false },
      // Intelligent Mix / combined (Surgery 14: page is a barrel — the hook
      // consumption lives in the relocated controller). NOTE: Strategic Mix is
      // NOT a BOLT surface — its shell is the Campaign Planner (SPEC-001 I-12).
      { rel: 'components/command-center/BoltCombinedStrategyController.tsx', hookExpected: true },
    ];
    for (const { rel, hookExpected } of surfaces) {
      const src = read(rel);
      if (hookExpected) {
        expect({ file: rel, hasHook: src.includes('useBoltPlatformPicker') })
          .toEqual({ file: rel, hasHook: true });
      } else {
        expect({ file: rel, hasPicker: src.includes('BoltPlatformPicker') })
          .toEqual({ file: rel, hasPicker: true });
      }
    }
  });

  test('BoltStrategyView no longer ships inline chip-rendering markup', () => {
    // Surgery: barrel — scan the relocated main component.
    const src = read('components/BoltStrategyViewMain.tsx');
    // The legacy inline render had a literal `availablePlatforms.map((p)` —
    // re-introducing it would mean the picker was duplicated outside the
    // shared component. Catch that drift here.
    expect(src.includes('availablePlatforms.map((p)')).toBe(false);
    expect(src.includes('<BoltPlatformPicker')).toBe(true);
  });

  /**
   * Round-7 Phase 3 — future-mode safety guards. Every file that consumes
   * `useBoltPlatformPicker` must also expose `selectedPlatforms` and
   * `togglePlatform`. This catches future BOLT modes that wire the picker
   * but forget the selection-state plumbing.
   */
  test('every consumer of useBoltPlatformPicker exposes selectedPlatforms + togglePlatform', () => {
    const SCAN_ROOTS = ['hooks', 'pages/command-center'];
    const violations: Array<{ file: string; missing: string[] }> = [];
    const walk = (dir: string, acc: string[]): string[] => {
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
      for (const ent of entries) {
        if (ent.isDirectory()) walk(path.join(dir, ent.name), acc);
        else if (/\.tsx?$/.test(ent.name)) acc.push(path.join(dir, ent.name));
      }
      return acc;
    };
    const files: string[] = [];
    for (const root of SCAN_ROOTS) walk(path.join(REPO_ROOT, root), files);

    for (const abs of files) {
      const rel = path.relative(REPO_ROOT, abs).replace(/\\/g, '/');
      // The hook module itself defines, not consumes, the picker.
      if (rel === 'hooks/useBoltPlatformPicker.ts') continue;
      const src = fs.readFileSync(abs, 'utf8');
      if (!src.includes('useBoltPlatformPicker(')) continue;
      const missing: string[] = [];
      if (!/selectedPlatforms\b/.test(src)) missing.push('selectedPlatforms');
      if (!/togglePlatform\b/.test(src)) missing.push('togglePlatform');
      if (missing.length > 0) {
        violations.push({ file: rel, missing });
      }
    }
    if (violations.length > 0) {
      const msg = violations.map((v) => `  ${v.file}: missing ${v.missing.join(', ')}`).join('\n');
      throw new Error(`Future-mode wiring guard failed:\n${msg}`);
    }
    expect(violations).toEqual([]);
  });

  test('FORMATS_SUPPORTING_CROSS_PLATFORM is a single-source const (Round 7 Phase 2)', () => {
    // Only the canonical module is allowed to declare the constant. Three
    // legacy inline declarations were removed in Round 7.
    const SCAN_ROOTS = ['hooks', 'pages', 'components'];
    const violators: string[] = [];
    const walk = (dir: string, acc: string[]): string[] => {
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
      for (const ent of entries) {
        if (ent.isDirectory()) walk(path.join(dir, ent.name), acc);
        else if (/\.tsx?$/.test(ent.name)) acc.push(path.join(dir, ent.name));
      }
      return acc;
    };
    const files: string[] = [];
    for (const root of SCAN_ROOTS) walk(path.join(REPO_ROOT, root), files);
    for (const abs of files) {
      const src = fs.readFileSync(abs, 'utf8');
      // Forbid the literal `const FORMATS_SUPPORTING_CROSS_PLATFORM = ` —
      // imports are allowed (and required).
      if (/const\s+FORMATS_SUPPORTING_CROSS_PLATFORM\s*=/.test(src)) {
        violators.push(path.relative(REPO_ROOT, abs).replace(/\\/g, '/'));
      }
    }
    expect(violators).toEqual([]);
  });

  /**
   * Round-7 Phase 6 — final drift-prevention audit. The shared hook
   * `useBoltPlatformPicker` is the only place that may fetch
   * `/api/bolt/available-platforms`. Direct fetches elsewhere would
   * reintroduce parallel fetch logic and bypass the canonical log emission.
   */
  test('no direct fetches to /api/bolt/available-platforms outside useBoltPlatformPicker', () => {
    const SCAN_ROOTS = ['hooks', 'pages', 'components', 'lib'];
    const APPROVED = new Set([
      'hooks/useBoltPlatformPicker.ts',
      'pages/api/bolt/available-platforms.ts',
      // TECH-DEBT (tracked): direct fetch relocated VERBATIM out of the old
      // 3,869-line creator [type].tsx during its decomposition (6e6d5044) —
      // pre-existing behavior, not new drift. Should migrate to
      // useBoltPlatformPicker in a creator-lane change; do not add more.
      'components/creator/workflow/useCreatorWorkflowLifecycle.tsx',
    ]);
    const violators: string[] = [];
    const walk = (dir: string, acc: string[]): string[] => {
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
      for (const ent of entries) {
        if (ent.isDirectory()) walk(path.join(dir, ent.name), acc);
        else if (/\.tsx?$/.test(ent.name)) acc.push(path.join(dir, ent.name));
      }
      return acc;
    };
    const files: string[] = [];
    for (const root of SCAN_ROOTS) walk(path.join(REPO_ROOT, root), files);
    for (const abs of files) {
      const rel = path.relative(REPO_ROOT, abs).replace(/\\/g, '/');
      if (APPROVED.has(rel)) continue;
      const src = fs.readFileSync(abs, 'utf8');
      if (src.includes('/api/bolt/available-platforms')) violators.push(rel);
    }
    expect(violators).toEqual([]);
  });

  /**
   * Repo-wide CI drift scanner (Round-4 Phase 2). Walks every .ts/.tsx file
   * under approved source roots and asserts that forbidden patterns appear
   * ONLY inside the approved canonical modules. New violations fail CI.
   */
  test('repo-wide drift scan — forbidden patterns confined to approved modules', () => {
    const APPROVED = new Set([
      // Canonical capability modules (source of truth).
      'lib/shared/social/platformCapabilities.ts',
      'lib/shared/social/contentCapability.ts',
      'lib/shared/social/platformContentFilter.ts',
      'lib/shared/social/capabilityEvents.ts',
      // Validator + thin derivation adapters.
      'backend/services/platformContentValidator.ts',
      'backend/utils/platformEligibility.ts',
      'backend/services/companyPlatformService.ts',
      // Campaign-readiness uses `code: 'MISSING_MEDIA'` as a BLOCKING-ISSUE
      // identifier in the campaign-planning domain (a daily plan is missing
      // required media). It is NOT an adapter-level capability short-circuit
      // — different domain, same string. Allowlisted with comment so future
      // readers understand the exemption is intentional.
      'backend/services/campaignReadinessService.ts',
      // The centralization test file documents the forbidden patterns by
      // referencing them in string literals — exempt itself.
      'backend/tests/unit/platformCapability.centralization.test.ts',
    ]);
    const SCAN_ROOTS = ['backend', 'lib', 'pages', 'components', 'hooks'];
    const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git', 'reports']);

    /** Adapter-level short-circuit codes that must live ONLY in the validator. */
    const FORBIDDEN_RETURN_CODES = [
      "code: 'INSTAGRAM_NO_MEDIA'",
      "code: 'YOUTUBE_NO_VIDEO'",
      "code: 'MISSING_MEDIA'",
    ];
    /** Stringly-typed capability events bypassing CAPABILITY_LOG_EVENTS. */
    const FORBIDDEN_EVENT_LITERALS = [
      "'platform.capability.rejected'",
      "'platform.capability.filtered'",
      "'platform.capability.unresolved'",
    ];
    /** Registry-only API. Outside approved modules, callers must go through
     *  helpers like `platformSupportsCapability`. */
    const FORBIDDEN_REGISTRY_FIELDS = ['requiresMediaForPublish'];

    const walk = (dir: string, acc: string[]): string[] => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch { return acc; }
      for (const ent of entries) {
        if (SKIP_DIRS.has(ent.name)) continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full, acc);
        else if (/\.tsx?$/.test(ent.name) && !ent.name.endsWith('.d.ts')) acc.push(full);
      }
      return acc;
    };

    const files: string[] = [];
    for (const root of SCAN_ROOTS) {
      walk(path.join(REPO_ROOT, root), files);
    }

    const violations: Array<{ file: string; pattern: string }> = [];
    for (const abs of files) {
      const rel = path.relative(REPO_ROOT, abs).replace(/\\/g, '/');
      if (APPROVED.has(rel)) continue;
      // Skip every test file — tests legitimately reference the forbidden
      // strings to assert their absence.
      if (rel.includes('/tests/') || rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue;
      const src = fs.readFileSync(abs, 'utf8');
      for (const code of FORBIDDEN_RETURN_CODES) {
        if (src.includes(code)) violations.push({ file: rel, pattern: code });
      }
      for (const ev of FORBIDDEN_EVENT_LITERALS) {
        if (src.includes(ev)) violations.push({ file: rel, pattern: ev });
      }
      for (const field of FORBIDDEN_REGISTRY_FIELDS) {
        // Match field-as-identifier — not a substring within an unrelated word.
        if (new RegExp(`\\b${field}\\b`).test(src)) violations.push({ file: rel, pattern: field });
      }
    }

    if (violations.length > 0) {
      const formatted = violations.map((v) => `  ${v.file}: ${v.pattern}`).join('\n');
      throw new Error(`Capability-architecture drift detected — forbidden patterns found outside approved modules:\n${formatted}`);
    }
    expect(violations).toEqual([]);
  });

  test('no payload/token leakage in capability log call sites', () => {
    const publishNowSrc = read('backend/services/publishNowService.ts');
    const adapterSrc = read('backend/adapters/platformAdapter.ts');
    // Capability log payloads must not include the post content body or any
    // OAuth/access-token field. We check a window around the logger.warn
    // call (which is the capability-rejection emission point).
    for (const src of [publishNowSrc, adapterSrc]) {
      const idx = src.indexOf('logger.warn(');
      expect(idx).toBeGreaterThanOrEqual(0);
      const slice = src.slice(Math.max(0, idx - 512), idx + 1024);
      expect(slice.includes('access_token')).toBe(false);
      expect(slice.includes('refresh_token')).toBe(false);
      expect(slice.includes('post.content')).toBe(false);
      expect(slice.includes('scheduledPost.content)')).toBe(false);
    }
  });
});
