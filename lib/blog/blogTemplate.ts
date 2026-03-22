/**
 * Default blog structure template.
 * Pre-fills every new blog with the required block sequence for SEO,
 * GEO readiness, and thought leadership formatting.
 */

import { createBlock, newId } from './blockUtils';
import type { ContentBlock, KeyInsightsBlock, ReferencesBlock } from './blockTypes';

export function createDefaultBlogTemplate(): ContentBlock[] {
  // ── 1. Key Insights (required — always first) ──────────────────────────────
  const keyInsights = createBlock('key_insights') as KeyInsightsBlock;
  keyInsights.items = ['', '', ''];

  // ── 2. Introduction paragraph ─────────────────────────────────────────────
  const intro = createBlock('paragraph');

  // ── 3. Section 1 ──────────────────────────────────────────────────────────
  const s1Heading = createBlock('heading');
  const s1Para    = createBlock('paragraph');

  // ── 4. Section 2 ──────────────────────────────────────────────────────────
  const s2Heading = createBlock('heading');
  const s2Para    = createBlock('paragraph');

  // ── 5. Section 3 ──────────────────────────────────────────────────────────
  const s3Heading = createBlock('heading');
  const s3Para    = createBlock('paragraph');

  // ── 6. Section break ──────────────────────────────────────────────────────
  const divider = createBlock('divider');

  // ── 7. Summary (required) ─────────────────────────────────────────────────
  const summary = createBlock('summary');

  // ── 8. References (required, 3 empty slots) ───────────────────────────────
  const references = createBlock('references') as ReferencesBlock;
  references.items = [
    { id: newId(), title: '', url: '' },
    { id: newId(), title: '', url: '' },
    { id: newId(), title: '', url: '' },
  ];

  return [
    keyInsights,
    intro,
    s1Heading,
    s1Para,
    s2Heading,
    s2Para,
    s3Heading,
    s3Para,
    divider,
    summary,
    references,
  ];
}
