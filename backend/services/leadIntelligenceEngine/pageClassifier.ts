/**
 * INT-001 Phase 2 — deterministic page-URL classifier.
 *
 * Maps a captured page URL onto the engine's PageCategory taxonomy using
 * configurable substring patterns. First matching category (in config order)
 * wins, so precedence is explicit and reproducible.
 */

import type { PageCategory } from './types';

export interface PageClassifierConfig {
  /** Ordered list — earlier entries take precedence. */
  rules: Array<{ category: PageCategory; patterns: string[] }>;
}

export const defaultPageClassifierConfig: PageClassifierConfig = {
  rules: [
    { category: 'pricing', patterns: ['/pricing', '/plans', '/cost', 'billing/plans'] },
    { category: 'enterprise', patterns: ['/enterprise', '/teams', '/business-plan'] },
    { category: 'security', patterns: ['/security', '/compliance', '/soc2', '/gdpr', '/trust'] },
    { category: 'demo', patterns: ['/demo', '/book-a-demo', '/request-demo', '/schedule', '/get-started', '/trial'] },
    { category: 'comparison', patterns: ['/compare', '/comparison', '/vs-', '/vs/', '/alternatives', '-alternative'] },
    { category: 'documentation', patterns: ['/docs', '/documentation', '/api-reference', '/developers', '/sdk', '/integration'] },
    { category: 'case_study', patterns: ['/case-stud', '/customers', '/success-stor', '/testimonial'] },
    { category: 'careers', patterns: ['/careers', '/jobs', '/join-us', '/hiring'] },
    { category: 'partners', patterns: ['/partners', '/partnership', '/affiliate', '/reseller'] },
    { category: 'investors', patterns: ['/investors', '/investor-relations', '/press'] },
    { category: 'download', patterns: ['/download', '.pdf', '/whitepaper', '/ebook', '/resources/guide'] },
    { category: 'contact', patterns: ['/contact', '/talk-to-sales', '/sales'] },
    { category: 'blog', patterns: ['/blog', '/articles', '/guides', '/newsletter'] },
  ],
};

/** Extract the path portion of a stored page URL (tolerates bare paths). */
export function pagePathOf(pageUrl: string | null | undefined): string {
  if (!pageUrl || typeof pageUrl !== 'string') return '';
  const trimmed = pageUrl.trim().toLowerCase();
  if (!trimmed) return '';
  try {
    // Absolute URL → path + query; bare path → as-is.
    if (/^https?:\/\//.test(trimmed)) {
      const u = new URL(trimmed);
      return `${u.pathname}${u.search}`;
    }
  } catch {
    /* fall through to raw string */
  }
  return trimmed;
}

export function classifyPage(
  pageUrl: string | null | undefined,
  config: PageClassifierConfig = defaultPageClassifierConfig,
): PageCategory {
  const path = pagePathOf(pageUrl);
  if (!path) return 'other';
  if (path === '/' || path === '' || /^\/(index(\.html?)?)?(\?.*)?$/.test(path)) return 'home';
  for (const rule of config.rules) {
    for (const pattern of rule.patterns) {
      if (path.includes(pattern)) return rule.category;
    }
  }
  return 'other';
}
