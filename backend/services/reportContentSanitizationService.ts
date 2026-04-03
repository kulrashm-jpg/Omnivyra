const SIGNAL_BASED_FALLBACK =
  'Available signals indicate limited data coverage, but early patterns suggest gaps in coverage and structure.';

type SignalId = 'authority_gap' | 'content_gap' | 'technical_constraint';

const IDEA_SIGNAL_PATTERNS: Array<{ id: SignalId; pattern: RegExp }> = [
  {
    id: 'authority_gap',
    pattern: /\b(authority|backlink|credibility|trust signal|domain strength|brand trust)\b/i,
  },
  {
    id: 'content_gap',
    pattern: /\b(content gap|coverage|topic gap|missing page|thin content|buyer question|intent coverage)\b/i,
  },
  {
    id: 'technical_constraint',
    pattern: /\b(technical|crawl|metadata|index|site structure|internal link|page speed|render issue)\b/i,
  },
];

function sentenceSignalId(sentence: string): SignalId | null {
  for (const item of IDEA_SIGNAL_PATTERNS) {
    if (item.pattern.test(sentence)) return item.id;
  }
  return null;
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r?\n+/g, ' ')
    .replace(/([A-Za-z])-\s+([A-Za-z])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function fixRepeatedPrefixes(value: string): string {
  return value
    .replace(/\b(Step\s+\d+:)\s*\1/gi, '$1 ')
    .replace(/\b([A-Za-z][A-Za-z ]{1,24}:)\s*\1/g, '$1 ')
    .replace(/\b(?:[A-Za-z]\s){3,}[A-Za-z]\b/g, (match) => match.replace(/\s+/g, ''));
}

function cleanupFallback(value: string): string {
  const cleaned = value.replace(/\u2026|\.{3}/g, '').trim();
  if (/summary is limited for this run/i.test(cleaned)) return SIGNAL_BASED_FALLBACK;
  if (/limited data available for this section/i.test(cleaned)) return SIGNAL_BASED_FALLBACK;
  return cleaned;
}

function splitSentences(text: string): string[] {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];
  const parts = normalized
    .split(/[.!?]+\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return parts.map((part) => (/[.!?]$/.test(part) ? part : `${part}.`));
}

function normalizeSentenceKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sanitizeText(
  value: unknown,
  usedSentences: Set<string>,
  signalUsage: Map<SignalId, number>,
  options?: {
    maxSentences?: number;
    fallback?: string;
    allowEmpty?: boolean;
  },
): string {
  const raw = typeof value === 'string' ? value : '';
  const cleaned = cleanupFallback(fixRepeatedPrefixes(normalizeWhitespace(raw)));
  const sentences = splitSentences(cleaned);
  const uniqueSentences: string[] = [];
  for (const sentence of sentences) {
    const key = normalizeSentenceKey(sentence);
    if (!key) continue;
    if (usedSentences.has(key)) continue;
    const signalId = sentenceSignalId(sentence);
    if (signalId) {
      const seen = signalUsage.get(signalId) ?? 0;
      if (seen >= 2) continue;
      signalUsage.set(signalId, seen + 1);
    }
    usedSentences.add(key);
    uniqueSentences.push(sentence);
    if (options?.maxSentences && uniqueSentences.length >= options.maxSentences) break;
  }
  if (uniqueSentences.length > 0) return uniqueSentences.join(' ');
  if (options?.allowEmpty) return '';
  const fallback = options?.fallback || SIGNAL_BASED_FALLBACK;
  const fallbackKey = normalizeSentenceKey(fallback);
  if (fallbackKey && !usedSentences.has(fallbackKey)) {
    usedSentences.add(fallbackKey);
    return fallback;
  }
  return fallback;
}

function sanitizeSteps(steps: unknown, usedSentences: Set<string>, signalUsage: Map<SignalId, number>): string[] {
  if (!Array.isArray(steps)) return [];
  const sanitized = steps
    .map((step) => sanitizeText(step, usedSentences, signalUsage, { maxSentences: 1, allowEmpty: true }))
    .filter(Boolean);
  const unique = Array.from(new Set(sanitized.map((item) => normalizeWhitespace(item))));
  return unique.map((item, index) => {
    const withoutPrefix = item.replace(/^Step\s+\d+:\s*/i, '').trim();
    return `Step ${index + 1}: ${withoutPrefix}`;
  });
}

export function sanitizeReportViewPayload<T extends Record<string, any>>(payload: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const next: any = JSON.parse(JSON.stringify(payload));
  const usedSentences = new Set<string>();
  const signalUsage = new Map<SignalId, number>();

  next.diagnosis = sanitizeText(next.diagnosis, usedSentences, signalUsage, { maxSentences: 3, fallback: SIGNAL_BASED_FALLBACK });
  next.summary = sanitizeText(next.summary, usedSentences, signalUsage, { maxSentences: 2, fallback: SIGNAL_BASED_FALLBACK });
  next.confidenceSource = sanitizeText(next.confidenceSource, usedSentences, signalUsage, { maxSentences: 1, fallback: SIGNAL_BASED_FALLBACK });

  if (Array.isArray(next.insights)) {
    next.insights = next.insights.map((insight: any) => ({
      ...insight,
      text: sanitizeText(insight?.text, usedSentences, signalUsage, { maxSentences: 1, fallback: SIGNAL_BASED_FALLBACK }),
      whyItMatters: sanitizeText(insight?.whyItMatters, usedSentences, signalUsage, { maxSentences: 1, fallback: SIGNAL_BASED_FALLBACK }),
      businessImpact: sanitizeText(insight?.businessImpact, usedSentences, signalUsage, { maxSentences: 1, fallback: SIGNAL_BASED_FALLBACK }),
    }));
  }

  if (Array.isArray(next.opportunities)) {
    next.opportunities = next.opportunities.map((opportunity: any) => ({
      ...opportunity,
      title: sanitizeText(opportunity?.title, usedSentences, signalUsage, { maxSentences: 1, fallback: SIGNAL_BASED_FALLBACK }),
      description: sanitizeText(opportunity?.description, usedSentences, signalUsage, { maxSentences: 1, fallback: SIGNAL_BASED_FALLBACK }),
      priority: sanitizeText(opportunity?.priority, usedSentences, signalUsage, { maxSentences: 1, fallback: 'Plan next based on available signals.' }),
    }));
  }

  if (Array.isArray(next.nextSteps)) {
    next.nextSteps = next.nextSteps.map((step: any) => ({
      ...step,
      action: sanitizeText(step?.action, usedSentences, signalUsage, { maxSentences: 1, fallback: 'Execute the highest-impact action first.' }),
      description: sanitizeText(step?.description, usedSentences, signalUsage, { maxSentences: 1, fallback: SIGNAL_BASED_FALLBACK }),
      steps: sanitizeSteps(step?.steps, usedSentences, signalUsage),
      expectedOutcome: sanitizeText(step?.expectedOutcome, usedSentences, signalUsage, { maxSentences: 1, fallback: 'This should improve visibility, trust, or conversion readiness.' }),
      expectedUpside: sanitizeText(step?.expectedUpside, usedSentences, signalUsage, { maxSentences: 1, fallback: 'Expected upside is inferred from current impact and confidence signals.' }),
      priorityWhy: sanitizeText(step?.priorityWhy, usedSentences, signalUsage, { maxSentences: 1, fallback: 'This action is prioritized by impact-effort profile.' }),
    }));
  }

  if (Array.isArray(next.topPriorities)) {
    next.topPriorities = next.topPriorities.map((item: any) => ({
      ...item,
      title: sanitizeText(item?.title, usedSentences, signalUsage, { maxSentences: 1, fallback: 'Priority action.' }),
      whyNow: sanitizeText(item?.whyNow, usedSentences, signalUsage, { maxSentences: 1, fallback: SIGNAL_BASED_FALLBACK }),
      expectedOutcome: sanitizeText(item?.expectedOutcome, usedSentences, signalUsage, { maxSentences: 1, fallback: 'This should improve core growth constraints.' }),
      expectedUpside: sanitizeText(item?.expectedUpside, usedSentences, signalUsage, { maxSentences: 1, fallback: 'Upside inferred from available impact signals.' }),
      priorityWhy: sanitizeText(item?.priorityWhy, usedSentences, signalUsage, { maxSentences: 1, fallback: 'Prioritized by impact, effort, and confidence.' }),
    }));
  }

  if (next.decisionSnapshot) {
    next.decisionSnapshot.whatsBroken = sanitizeText(next.decisionSnapshot.whatsBroken, usedSentences, signalUsage, {
      maxSentences: 2,
      fallback: SIGNAL_BASED_FALLBACK,
    });
    next.decisionSnapshot.whatToFixFirst = sanitizeText(next.decisionSnapshot.whatToFixFirst, usedSentences, signalUsage, {
      maxSentences: 1,
      fallback: 'Prioritize the highest-impact fix first.',
    });
    next.decisionSnapshot.whatToDelay = sanitizeText(next.decisionSnapshot.whatToDelay, usedSentences, signalUsage, {
      maxSentences: 1,
      fallback: 'Delay lower-impact expansion until core constraints improve.',
    });
    next.decisionSnapshot.ifIgnored = sanitizeText(next.decisionSnapshot.ifIgnored, usedSentences, signalUsage, {
      maxSentences: 1,
      fallback: 'If ignored, current growth constraints will continue.',
    });
    next.decisionSnapshot.ifExecutedWell = sanitizeText(next.decisionSnapshot.ifExecutedWell, usedSentences, signalUsage, {
      maxSentences: 2,
      fallback: 'If executed well, visibility, trust, and conversion quality should improve.',
    });
    next.decisionSnapshot.executionSequence = sanitizeSteps(next.decisionSnapshot.executionSequence, usedSentences, signalUsage);
  }

  if (next.seoExecutiveSummary?.primaryProblem) {
    next.seoExecutiveSummary.primaryProblem.reasoning = sanitizeText(next.seoExecutiveSummary.primaryProblem.reasoning, usedSentences, signalUsage, {
      maxSentences: 2,
      fallback: SIGNAL_BASED_FALLBACK,
    });
  }
  if (next.seoVisuals?.seoCapabilityRadar) {
    next.seoVisuals.seoCapabilityRadar.insightSentence = sanitizeText(next.seoVisuals.seoCapabilityRadar.insightSentence, usedSentences, signalUsage, {
      maxSentences: 1,
      fallback: SIGNAL_BASED_FALLBACK,
    });
  }
  if (next.seoVisuals?.searchVisibilityFunnel) {
    next.seoVisuals.searchVisibilityFunnel.insightSentence = sanitizeText(next.seoVisuals.searchVisibilityFunnel.insightSentence, usedSentences, signalUsage, {
      maxSentences: 1,
      fallback: SIGNAL_BASED_FALLBACK,
    });
  }
  if (next.unifiedIntelligenceSummary) {
    next.unifiedIntelligenceSummary.marketContextSummary = sanitizeText(next.unifiedIntelligenceSummary.marketContextSummary, usedSentences, signalUsage, {
      maxSentences: 2,
      fallback: SIGNAL_BASED_FALLBACK,
    });
    next.unifiedIntelligenceSummary.primaryConstraint.reasoning = sanitizeText(
      next.unifiedIntelligenceSummary.primaryConstraint.reasoning,
      usedSentences,
      signalUsage,
      { maxSentences: 2, fallback: SIGNAL_BASED_FALLBACK },
    );
  }
  if (next.competitorIntelligenceSummary) {
    next.competitorIntelligenceSummary.competitorExplanation = sanitizeText(next.competitorIntelligenceSummary.competitorExplanation, usedSentences, signalUsage, {
      maxSentences: 2,
      fallback: SIGNAL_BASED_FALLBACK,
    });
    next.competitorIntelligenceSummary.primaryGap.reasoning = sanitizeText(next.competitorIntelligenceSummary.primaryGap.reasoning, usedSentences, signalUsage, {
      maxSentences: 2,
      fallback: SIGNAL_BASED_FALLBACK,
    });
  }

  return next;
}
