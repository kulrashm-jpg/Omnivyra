import type {
  ContentFormMeta,
  ContentQualityScore,
  ContentValidationIssue,
} from '../content/qualityScoringCore';
import {
  calculateContentQualityScore,
  getContentPublishBlockers,
} from '../content/qualityScoringCore';
import type { ContentBlock } from '../content/blockTypes';
import { flattenBlocks } from '../content/blockUtils';

const NEWSLETTER_SECTION_LABELS: Record<string, string[]> = {
  'insight-letter': ['hook', 'context', 'insight', 'expansion', 'implication', 'closing'],
  'weekly-brief': ['week summary', 'top signals', 'pattern', 'quick takes', 'closing'],
  'strategic-letter': ['situation', 'shift', 'analysis', 'positioning', 'strategic moves', 'thesis'],
  'action-letter': ['problem', 'outcome', 'framework', 'breakdown', 'mistakes', 'cta'],
};

const NEWSLETTER_REFERENCE_TARGETS: Record<string, number> = {
  'insight-letter': 0,
  'weekly-brief': 2,
  'strategic-letter': 2,
  'action-letter': 1,
};

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function countWords(text: string): number {
  const normalized = text.trim();
  return normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function calculateNewsletterQualityScore(
  blocks: ContentBlock[],
  form: ContentFormMeta,
): ContentQualityScore {
  const base = calculateContentQualityScore(blocks, {
    ...form,
    content_type: 'newsletter',
  });

  const flat = flattenBlocks(blocks);
  const formatType = typeof form.format_type === 'string' ? form.format_type : 'weekly-brief';
  const requiredSections = NEWSLETTER_SECTION_LABELS[formatType] ?? [];
  const requiredReferenceCount = NEWSLETTER_REFERENCE_TARGETS[formatType] ?? 1;
  const headings = flat
    .filter((block): block is Extract<ContentBlock, { type: 'heading' }> => block.type === 'heading')
    .map((block) => block.text.trim().toLowerCase())
    .filter(Boolean);

  const paragraphs = flat.filter((block): block is Extract<ContentBlock, { type: 'paragraph' }> => block.type === 'paragraph');
  const quoteBlocks = flat.filter((block): block is Extract<ContentBlock, { type: 'quote' }> => block.type === 'quote');
  const calloutBlocks = flat.filter((block): block is Extract<ContentBlock, { type: 'callout' }> => block.type === 'callout');
  const summaryBlocks = flat.filter((block): block is Extract<ContentBlock, { type: 'summary' }> => block.type === 'summary');
  const keyInsightBlocks = flat.filter((block): block is Extract<ContentBlock, { type: 'key_insights' }> => block.type === 'key_insights');
  const referenceBlocks = flat.filter((block): block is Extract<ContentBlock, { type: 'references' }> => block.type === 'references');

  const paragraphWordCounts = paragraphs
    .map((block) => countWords(stripHtml(block.html)))
    .filter((count) => count > 0);
  const avgParagraphWords = paragraphWordCounts.length
    ? paragraphWordCounts.reduce((sum, count) => sum + count, 0) / paragraphWordCounts.length
    : 0;
  const strategicMoveWordCounts = flat
    .filter((block): block is Extract<ContentBlock, { type: 'list' }> => block.type === 'list')
    .flatMap((block) => block.items.map((item) => countWords(item.text)));
  const avgStrategicMoveWords = strategicMoveWordCounts.length
    ? strategicMoveWordCounts.reduce((sum, count) => sum + count, 0) / strategicMoveWordCounts.length
    : 0;
  const calloutWordCounts = flat
    .filter((block): block is Extract<ContentBlock, { type: 'callout' }> => block.type === 'callout')
    .map((block) => countWords(`${block.title ?? ''} ${block.body ?? ''}`));

  const filledQuoteCount = quoteBlocks.filter((block) => countWords(`${block.text ?? ''} ${block.author ?? ''} ${block.source ?? ''}`) >= 12).length;
  const filledCalloutCount = calloutBlocks.filter((block) => countWords(`${block.title ?? ''} ${block.body ?? ''}`) >= 12).length;
  const filledSummaryCount = summaryBlocks.filter((block) => countWords(block.body) >= 24).length;
  const filledKeyInsightsCount = keyInsightBlocks.filter((block) => block.items.filter((item) => item.trim()).length >= 3).length;
  const filledReferenceCount = referenceBlocks.reduce(
    (sum, block) => sum + block.items.filter((item) => item.title.trim() || item.url.trim()).length,
    0,
  );
  const extractableSignals = filledQuoteCount + filledCalloutCount + filledSummaryCount + filledKeyInsightsCount;

  const presentSections = requiredSections.filter((label) =>
    headings.some((heading) => heading === label || heading.includes(label)),
  );
  const missingSections = requiredSections.filter((label) => !presentSections.includes(label));

  let structure = 0;
  if (presentSections.length === requiredSections.length) structure += 12;
  else if (presentSections.length >= Math.max(4, requiredSections.length - 1)) structure += 8;
  else if (presentSections.length >= 3) structure += 5;
  if (filledKeyInsightsCount > 0) structure += 5;
  if (filledSummaryCount > 0) structure += 4;
  if (filledQuoteCount > 0 || filledCalloutCount > 0) structure += 4;
  if (formatType === 'insight-letter' && filledQuoteCount > 0 && filledCalloutCount > 0 && filledSummaryCount > 0 && filledKeyInsightsCount > 0) {
    structure += 2;
  }
  if (formatType === 'insight-letter' && filledQuoteCount > 0 && filledCalloutCount >= 2 && filledSummaryCount > 0 && filledKeyInsightsCount > 0) {
    structure += 2;
  }

  let depth = 0;
  if (base.meta.wordCount >= base.meta.targetWordCount) depth += 10;
  else if (base.meta.wordCount >= base.meta.targetWordCount * 0.8) depth += 8;
  else if (base.meta.wordCount >= base.meta.targetWordCount * 0.65) depth += 6;
  else if (base.meta.wordCount >= base.meta.targetWordCount * 0.45) depth += 3;
  if (avgParagraphWords >= 95) depth += 5;
  else if (avgParagraphWords >= 75) depth += 3;
  else if (avgParagraphWords >= 55) depth += 1;
  if (base.meta.shortParaCount === 0) depth += 3;
  else if (base.meta.shortParaCount <= 2) depth += 2;
  if (filledQuoteCount > 0 || filledCalloutCount > 0) depth += 2;
  if (formatType === 'insight-letter' && avgParagraphWords >= 100) depth += 2;
  if (formatType === 'insight-letter' && base.meta.wordCount >= base.meta.targetWordCount * 0.9) depth += 2;
  if (formatType === 'strategic-letter') {
    const analysisWords = paragraphWordCounts[4] ?? 0;
    const positioningWords = paragraphWordCounts[5] ?? 0;
    const thesisWords = paragraphWordCounts[6] ?? 0;
    const noticeWords = paragraphWordCounts[2] ?? 0;
    const shiftWords = paragraphWordCounts[3] ?? 0;
    const bestCalloutWords = calloutWordCounts.length ? Math.max(...calloutWordCounts) : 0;

    if (analysisWords >= 160) depth += 2;
    else if (analysisWords >= 125) depth += 1;
    if (positioningWords >= 110) depth += 2;
    else if (positioningWords >= 85) depth += 1;
    if (thesisWords >= 75) depth += 2;
    else if (thesisWords >= 55) depth += 1;
    if (avgStrategicMoveWords >= 14 && strategicMoveWordCounts.length >= 3) depth += 2;
    else if (avgStrategicMoveWords >= 10 && strategicMoveWordCounts.length >= 3) depth += 1;
    if (bestCalloutWords >= 16) depth += 1;
    if (noticeWords >= 65 || shiftWords >= 80) depth += 1;
  }
  if (formatType === 'action-letter') {
    const frameworkItems = flat
      .filter((block): block is Extract<ContentBlock, { type: 'list' }> => block.type === 'list' && block.listType === 'numbered')
      .flatMap((block) => block.items.map((item) => countWords(item.text)));
    const mistakesItems = flat
      .filter((block): block is Extract<ContentBlock, { type: 'list' }> => block.type === 'list' && block.listType === 'bullet')
      .flatMap((block) => block.items.map((item) => countWords(item.text)));
    const avgFrameworkWords = frameworkItems.length
      ? frameworkItems.reduce((sum, count) => sum + count, 0) / frameworkItems.length
      : 0;
    const avgMistakeWords = mistakesItems.length
      ? mistakesItems.reduce((sum, count) => sum + count, 0) / mistakesItems.length
      : 0;

    if (frameworkItems.length >= 3 && avgFrameworkWords >= 7) depth += 2;
    else if (frameworkItems.length >= 3 && avgFrameworkWords >= 5) depth += 1;
    if (mistakesItems.length >= 3 && avgMistakeWords >= 8) depth += 1;
  }

  let seo = 0;
  const titleLen = form.title.trim().length;
  const excerptLen = form.excerpt.trim().length;
  if (titleLen >= 20 && titleLen <= 80) seo += 4;
  else if (titleLen >= 12) seo += 2;
  if (excerptLen >= 70) seo += 4;
  else if (excerptLen >= 35) seo += 2;
  if (form.seo_meta_title?.trim()) seo += 3;
  if (form.seo_meta_description?.trim()) seo += 2;
  if (presentSections.length >= Math.max(4, requiredSections.length - 1)) seo += 2;

  let geo = 0;
  if (filledKeyInsightsCount > 0) geo += 6;
  if (filledSummaryCount > 0) geo += 5;
  if (filledQuoteCount > 0 || filledCalloutCount > 0) geo += 4;
  if (presentSections.length >= Math.max(4, requiredSections.length - 1)) geo += 2;
  if (requiredReferenceCount > 0) {
    if (filledReferenceCount >= requiredReferenceCount) geo += 3;
    else if (filledReferenceCount >= 1) geo += 1;
  } else if (extractableSignals >= 4) {
    geo += 3;
  } else if (extractableSignals >= 3) {
    geo += 2;
  }
  if (formatType === 'insight-letter' && filledQuoteCount > 0 && filledCalloutCount > 0 && extractableSignals >= 4) {
    geo += 2;
  }
  if (formatType === 'insight-letter' && filledQuoteCount > 0 && filledCalloutCount >= 2 && extractableSignals >= 4) {
    geo += 2;
  }
  if (formatType === 'insight-letter' && filledKeyInsightsCount > 0 && filledSummaryCount > 0 && filledQuoteCount > 0 && filledCalloutCount >= 2) {
    geo += 2;
  }

  const linking = base.breakdown.linking;

  const issues: ContentValidationIssue[] = [
    ...base.issues.filter((issue) => issue.category !== 'structure' && issue.category !== 'depth' && issue.category !== 'geo'),
  ];

  if (missingSections.length > 0) {
    issues.push({
      severity: missingSections.length >= 2 ? 'error' : 'warning',
      category: 'structure',
      message: `Missing newsletter sections: ${missingSections.join(', ')}`,
    });
  }
  if (filledKeyInsightsCount === 0) {
    issues.push({
      severity: 'error',
      category: 'structure',
      message: 'Newsletter needs a filled Key Insights block for scanability and extraction.',
    });
  }
  if (filledSummaryCount === 0) {
    issues.push({
      severity: 'warning',
      category: 'geo',
      message: 'Add a stronger summary block so the newsletter can be extracted and cited cleanly.',
    });
  }
  if (avgParagraphWords < 75) {
    issues.push({
      severity: 'warning',
      category: 'depth',
      message: `Average paragraph depth is light (${Math.round(avgParagraphWords)} words). Expand reasoning, examples, and implications.`,
    });
  }
  if (formatType === 'insight-letter' && base.meta.wordCount < base.meta.targetWordCount * 0.9) {
    issues.push({
      severity: 'warning',
      category: 'depth',
      message: 'Insight letters perform better when they reach at least 90% of the target length with real reasoning, not just section placeholders.',
    });
  }
  if (formatType === 'insight-letter' && avgParagraphWords < 90) {
    issues.push({
      severity: 'warning',
      category: 'depth',
      message: 'Insight letter paragraphs are still too light. Add fuller reasoning, one grounded example, and a clearer implication in each major section.',
    });
  }
  if (formatType === 'strategic-letter') {
    const analysisWords = paragraphWordCounts[4] ?? 0;
    const positioningWords = paragraphWordCounts[5] ?? 0;
    const thesisWords = paragraphWordCounts[6] ?? 0;
    if (analysisWords < 140) {
      issues.push({
        severity: 'warning',
        category: 'depth',
        message: `Strategic analysis is still thin (${analysisWords} words). Expand forces, leverage, risks, and second-order effects.`,
      });
    }
    if (positioningWords < 95) {
      issues.push({
        severity: 'warning',
        category: 'depth',
        message: `Positioning is still thin (${positioningWords} words). Clarify what strong teams should do, what to avoid, and why now.`,
      });
    }
    if (thesisWords < 65) {
      issues.push({
        severity: 'warning',
        category: 'depth',
        message: `Strategic thesis is still light (${thesisWords} words). End with a stronger judgment and decision frame.`,
      });
    }
    if (avgStrategicMoveWords > 0 && avgStrategicMoveWords < 12) {
      issues.push({
        severity: 'warning',
        category: 'depth',
        message: `Strategic moves are still generic on average (${Math.round(avgStrategicMoveWords)} words each). Make each move more decision-grade and differentiated.`,
      });
    }
  }
  if (formatType === 'action-letter') {
    const frameworkItems = flat
      .filter((block): block is Extract<ContentBlock, { type: 'list' }> => block.type === 'list' && block.listType === 'numbered')
      .flatMap((block) => block.items.map((item) => countWords(item.text)));
    const mistakesItems = flat
      .filter((block): block is Extract<ContentBlock, { type: 'list' }> => block.type === 'list' && block.listType === 'bullet')
      .flatMap((block) => block.items.map((item) => countWords(item.text)));
    const avgFrameworkWords = frameworkItems.length
      ? frameworkItems.reduce((sum, count) => sum + count, 0) / frameworkItems.length
      : 0;
    const avgMistakeWords = mistakesItems.length
      ? mistakesItems.reduce((sum, count) => sum + count, 0) / mistakesItems.length
      : 0;

    if (frameworkItems.length < 3) {
      issues.push({
        severity: 'warning',
        category: 'depth',
        message: `Action letter framework is still too thin (${frameworkItems.length} steps). Add a clearer multi-step execution path.`,
      });
    }
    if (frameworkItems.length > 0 && avgFrameworkWords < 6) {
      issues.push({
        severity: 'warning',
        category: 'depth',
        message: `Framework steps are still generic on average (${Math.round(avgFrameworkWords)} words each). Make each step more executable.`,
      });
    }
    if (mistakesItems.length > 0 && avgMistakeWords < 8) {
      issues.push({
        severity: 'warning',
        category: 'depth',
        message: `Mistakes section is still too generic (${Math.round(avgMistakeWords)} words each). Use more realistic operator failure modes.`,
      });
    }
  }
  if (filledQuoteCount === 0 && filledCalloutCount === 0) {
    issues.push({
      severity: 'warning',
      category: 'geo',
      message: 'Add at least one sharp quote or callout block to create more extractable insights.',
    });
  }
  if (formatType === 'insight-letter' && filledCalloutCount === 0) {
    issues.push({
      severity: 'warning',
      category: 'structure',
      message: 'Insight letters should include a filled callout block to sharpen the thesis or practical shift.',
    });
  }
  if (formatType === 'insight-letter' && filledCalloutCount < 2) {
    issues.push({
      severity: 'warning',
      category: 'geo',
      message: 'Minimal insight letters are stronger when both extractable callouts are filled: the thesis line and the practical-shift line.',
    });
  }
  if (formatType === 'insight-letter' && filledQuoteCount === 0) {
    issues.push({
      severity: 'warning',
      category: 'geo',
      message: 'Insight letters need one strong quote line so the core idea is easier to extract, cite, and forward.',
    });
  }
  if (requiredReferenceCount > 0 && filledReferenceCount < requiredReferenceCount) {
    issues.push({
      severity: filledReferenceCount === 0 ? 'error' : 'warning',
      category: 'geo',
      message: `Add ${requiredReferenceCount - filledReferenceCount} more reference${requiredReferenceCount - filledReferenceCount > 1 ? 's' : ''} to improve GEO authority.`,
    });
  }
  if (formatType !== 'insight-letter' && extractableSignals < 3) {
    issues.push({
      severity: 'warning',
      category: 'geo',
      message: 'This newsletter needs stronger extractable signals: solid key insights, a real summary, and at least one quote or callout worth lifting.',
    });
  }
  if (formatType === 'insight-letter' && extractableSignals < 3) {
    issues.push({
      severity: 'warning',
      category: 'geo',
      message: 'Insight letters need stronger extractable signals: key insights, a real synthesis, and one quotable line or callout.',
    });
  }
  if (formatType === 'insight-letter' && extractableSignals < 4) {
    issues.push({
      severity: 'warning',
      category: 'geo',
      message: 'Strong insight letters usually need four extraction surfaces working together: key insights, summary, a quote, and a callout.',
    });
  }
  if (formatType === 'insight-letter' && filledCalloutCount < 2) {
    issues.push({
      severity: 'warning',
      category: 'geo',
      message: 'This insight letter still needs both GEO surfaces working: the thesis callout and the practical-shift callout.',
    });
  }

  const breakdown = {
    structure: clamp(structure, 0, 25),
    depth: clamp(depth, 0, 20),
    seo: clamp(seo, 0, 15),
    geo: clamp(geo, 0, 20),
    linking,
  };

  // ── Phase 1 false-positive prevention gates ───────────────────────────────
  // The shared `evaluatePhase1QualityGates` ALREADY ran inside
  // `calculateContentQualityScore` above (`base`). The newsletter scorer
  // recomputes its own total/issues, so it must PROPAGATE — not re-run — the
  // gate cap and the gate failures here. This keeps a single source of truth:
  // a placeholder / leaked planner artifact / undelivered framework / broken
  // title promise caps the newsletter score and blocks newsletter publish,
  // exactly as on the blog/article path. Category scoring is unchanged.
  const gateIssues = base.issues.filter((i) => i.category === 'publishing');
  for (const gateIssue of gateIssues) issues.push(gateIssue);

  const newsletterTotal = clamp(breakdown.structure + breakdown.depth + breakdown.seo + breakdown.geo + breakdown.linking, 0, 90);

  return {
    total: base.scoreCap != null ? Math.min(newsletterTotal, base.scoreCap) : newsletterTotal,
    breakdown,
    issues,
    gates: base.gates,
    scoreCap: base.scoreCap,
    meta: base.meta,
  };
}

// Newsletter publish blockers inherit the Phase 1 gate failures automatically:
// they were added to `score.issues` as `severity:'error'` (category 'publishing')
// by `calculateNewsletterQualityScore`, and this delegates to the shared
// `getContentPublishBlockers` which returns all error-severity issues.
export function getNewsletterPublishBlockers(score: ContentQualityScore): ContentValidationIssue[] {
  return getContentPublishBlockers(score);
}
