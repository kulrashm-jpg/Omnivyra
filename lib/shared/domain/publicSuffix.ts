/**
 * publicSuffix.ts — PURE Public Suffix List lookup (no I/O, no npm dependency).
 *
 * Rules come from the vendored, dated PSL snapshot compiled into
 * publicSuffixRules.generated.ts (see scripts/generate-public-suffix-rules.js
 * and publicSuffixList.meta.json for the retrieval date). Safe for client and
 * server bundles.
 *
 * Algorithm (https://github.com/publicsuffix/list/wiki/Format):
 *   - BOTH the ICANN and the PRIVATE sections apply (the standard behaviour),
 *     so `foo.github.io` is its own registrable domain, not `github.io`.
 *   - A matching exception rule (`!www.ck`) prevails over everything; the
 *     public suffix is the exception rule minus its leftmost label.
 *   - Otherwise the matching rule with the most labels prevails; a wildcard
 *     rule (`*.ck`) matches exactly one extra label to the left.
 *   - No rule matches → the implicit default rule `*` (the last label).
 * Hosts are compared label-wise, lowercased. IDN rules exist in both Unicode
 * and punycode form, so either host form matches.
 */

import { PUBLIC_SUFFIX_RULES } from './publicSuffixRules.generated';

interface RuleSets {
  normal: Set<string>;
  wildcard: Set<string>;   // stored WITHOUT the leading `*.`
  exception: Set<string>;  // stored WITHOUT the leading `!`
}

let cached: RuleSets | null = null;

function ruleSets(): RuleSets {
  if (cached) return cached;
  const sets: RuleSets = { normal: new Set(), wildcard: new Set(), exception: new Set() };
  for (const rule of PUBLIC_SUFFIX_RULES.split(' ')) {
    if (!rule) continue;
    if (rule.startsWith('!')) sets.exception.add(rule.slice(1));
    else if (rule.startsWith('*.')) sets.wildcard.add(rule.slice(2));
    else sets.normal.add(rule);
  }
  cached = sets;
  return sets;
}

/**
 * Number of trailing labels that form the public suffix of `labels`
 * (already split, lowercased, no empty labels). Always >= 1 for a non-empty
 * input (default rule `*`), and may equal labels.length when the whole input
 * is itself a public suffix.
 */
export function publicSuffixLabelCount(labels: readonly string[]): number {
  const k = labels.length;
  if (k === 0) return 0;
  const { normal, wildcard, exception } = ruleSets();

  // Exception rules prevail. Scan longest-first.
  for (let i = 0; i < k; i++) {
    if (exception.has(labels.slice(i).join('.'))) return k - i - 1;
  }

  let best = 1; // default rule `*`
  for (let i = 0; i < k; i++) {
    const candidate = labels.slice(i).join('.');
    if (normal.has(candidate)) best = Math.max(best, k - i);
    if (i > 0 && wildcard.has(candidate)) best = Math.max(best, k - i + 1);
  }
  return best;
}

/** True when `host` is itself a public suffix (e.g. `com.sg`, `co.uk`, `github.io`). */
export function isPublicSuffix(host: string): boolean {
  if (!host) return false;
  const labels = host.toLowerCase().split('.').filter(Boolean);
  if (labels.length === 0) return false;
  return publicSuffixLabelCount(labels) >= labels.length;
}
