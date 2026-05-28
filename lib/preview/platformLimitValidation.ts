/**
 * G11.A — Canonical platform char-limit validation.
 *
 * Pure-function validator wrapping the canonical limits at
 * lib/shared/contentFormatter.ts (the single source of truth for per-platform
 * maxChars). NO truncation. NO text mutation. Returns explicit state objects
 * the UI surfaces can render directly.
 *
 * Used by:
 *   - ThreadSequencePreview (per-node visual state)
 *   - ThreadSegmentsEditor (live per-segment count)
 *   - PostToSocialPlatformPanel (scheduler-side editor)
 *   - multi-platform-scheduler (CTA over-limit guard)
 *   - Any future preview / editor surface that needs validation
 *
 * Counting: raw character count. We do NOT emulate Twitter's t.co URL
 * weighting or any platform-specific reduction algorithm — none of those are
 * implemented in the codebase today and the spec explicitly forbids
 * inventing them.
 */

import { getPlatformLimits } from '../shared/contentFormatter';
import type { ThreadNode } from './unifiedPreviewContract';

export type PlatformValidationRule = {
  platform: string;
  maxChars: number;
  /** char count at which we surface a "warning" state — convention: 90% of max */
  warningThreshold: number;
};

export type PlatformValidationState = {
  state: 'valid' | 'warning' | 'invalid';
  platform: string;
  currentCount: number;
  maxCount: number;
  /** chars remaining before hitting max; clamped at 0 when over */
  remaining: number;
  /** amount over max; 0 when at/under max */
  exceeded: number;
};

export type ThreadValidationSummary = {
  perNode: PlatformValidationState[];
  invalidCount: number;
  warningCount: number;
  isAnyInvalid: boolean;
};

const DEFAULT_WARNING_RATIO = 0.9;

export function resolvePlatformValidationRule(platform: string): PlatformValidationRule {
  const key = (platform || '').toLowerCase().trim();
  const limits = getPlatformLimits(key);
  const maxChars = Math.max(0, Number(limits.maxChars) || 0);
  return {
    platform: key || 'default',
    maxChars,
    warningThreshold: Math.max(0, Math.floor(maxChars * DEFAULT_WARNING_RATIO)),
  };
}

function buildState(rule: PlatformValidationRule, count: number): PlatformValidationState {
  const safeCount = Math.max(0, Math.floor(count));
  if (rule.maxChars === 0) {
    // Unknown platform — treat as always valid, expose the count for UI.
    return {
      state: 'valid',
      platform: rule.platform,
      currentCount: safeCount,
      maxCount: 0,
      remaining: 0,
      exceeded: 0,
    };
  }
  if (safeCount > rule.maxChars) {
    return {
      state: 'invalid',
      platform: rule.platform,
      currentCount: safeCount,
      maxCount: rule.maxChars,
      remaining: 0,
      exceeded: safeCount - rule.maxChars,
    };
  }
  if (safeCount >= rule.warningThreshold) {
    return {
      state: 'warning',
      platform: rule.platform,
      currentCount: safeCount,
      maxCount: rule.maxChars,
      remaining: rule.maxChars - safeCount,
      exceeded: 0,
    };
  }
  return {
    state: 'valid',
    platform: rule.platform,
    currentCount: safeCount,
    maxCount: rule.maxChars,
    remaining: rule.maxChars - safeCount,
    exceeded: 0,
  };
}

export function validatePostForPlatform(text: string, platform: string): PlatformValidationState {
  const rule = resolvePlatformValidationRule(platform);
  return buildState(rule, (text ?? '').length);
}

export function validateThreadNodeForPlatform(
  node: { content: string; platform?: string },
  fallbackPlatform: string,
): PlatformValidationState {
  const rule = resolvePlatformValidationRule(node.platform || fallbackPlatform);
  return buildState(rule, (node.content ?? '').length);
}

export function validateThreadForPlatform(
  nodes: ThreadNode[],
  fallbackPlatform: string,
): ThreadValidationSummary {
  const perNode = (nodes ?? []).map((n) => validateThreadNodeForPlatform(n, fallbackPlatform));
  const invalidCount = perNode.filter((s) => s.state === 'invalid').length;
  const warningCount = perNode.filter((s) => s.state === 'warning').length;
  return {
    perNode,
    invalidCount,
    warningCount,
    isAnyInvalid: invalidCount > 0,
  };
}

/** Alias for posts. Kept separate so call-sites can express intent. */
export function validateLongformSnippetForPlatform(
  text: string,
  platform: string,
): PlatformValidationState {
  return validatePostForPlatform(text, platform);
}

/** Convenience helper for UI: returns Tailwind classes for the state's badge. */
export function platformValidationBadgeClass(state: PlatformValidationState['state']): string {
  if (state === 'invalid') return 'bg-red-100 text-red-700 border-red-200';
  if (state === 'warning') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
}

/** Convenience helper for UI: short human-readable label. */
export function platformValidationLabel(state: PlatformValidationState): string {
  if (state.maxCount === 0) return `${state.currentCount} chars`;
  if (state.state === 'invalid') return `${state.currentCount} / ${state.maxCount} — over by ${state.exceeded}`;
  return `${state.currentCount} / ${state.maxCount}`;
}
