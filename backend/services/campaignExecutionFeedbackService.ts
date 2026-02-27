export type ExecutionValidationSummary = {
  invalid_count: number;
  adjusted_count: number;
  invalid_by_platform: Record<string, number>;
  invalid_by_content_type: Record<string, number>;
  common_issues: Array<{ issue: string; count: number }>;
};

type DailyValidationLike = {
  platform?: string;
  contentType?: string;
  content_type?: string;
  validation_status?: 'valid' | 'adjusted' | 'invalid';
  validation_notes?: string[];
};

function normalizeKey(s: any): string {
  return String(s || '').trim().toLowerCase();
}

export function analyzeValidationResults(dailyItems: DailyValidationLike[]): ExecutionValidationSummary {
  const invalid_by_platform: Record<string, number> = {};
  const invalid_by_content_type: Record<string, number> = {};
  const issueCounts: Record<string, number> = {};

  let invalid_count = 0;
  let adjusted_count = 0;

  for (const raw of dailyItems || []) {
    const status = raw?.validation_status ?? 'valid';
    if (status === 'invalid') invalid_count += 1;
    if (status === 'adjusted') adjusted_count += 1;

    if (status === 'invalid') {
      const platform = normalizeKey(raw.platform);
      const contentType = normalizeKey(raw.contentType ?? raw.content_type);
      if (platform) invalid_by_platform[platform] = (invalid_by_platform[platform] ?? 0) + 1;
      if (contentType) invalid_by_content_type[contentType] = (invalid_by_content_type[contentType] ?? 0) + 1;
    }

    const notes = Array.isArray(raw?.validation_notes) ? raw.validation_notes : [];
    for (const note of notes) {
      const key = String(note || '').trim();
      if (!key) continue;
      issueCounts[key] = (issueCounts[key] ?? 0) + 1;
    }
  }

  const common_issues = Object.entries(issueCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([issue, count]) => ({ issue, count }));

  return {
    invalid_count,
    adjusted_count,
    invalid_by_platform,
    invalid_by_content_type,
    common_issues,
  };
}

export function generatePlanningFeedback(summary: ExecutionValidationSummary): string[] {
  const recs: string[] = [];

  if (summary.invalid_count === 0 && summary.adjusted_count === 0) {
    return ['All daily items passed platform validation; current weekly/daily distribution is execution-ready.'];
  }

  if (summary.invalid_count > 0) {
    const platforms = Object.entries(summary.invalid_by_platform).sort((a, b) => b[1] - a[1]);
    for (const [platform, count] of platforms.slice(0, 3)) {
      recs.push(`Reduce unsupported items on platform "${platform}" (invalid=${count}) or ensure DB rules exist for the intended formats.`);
    }

    const types = Object.entries(summary.invalid_by_content_type).sort((a, b) => b[1] - a[1]);
    for (const [type, count] of types.slice(0, 3)) {
      recs.push(`Switch "${type}" items to a supported short format for the target platform(s) (invalid=${count}).`);
    }

    if (platforms.length > 0) {
      const worstPlatform = platforms[0]?.[0];
      if (worstPlatform) {
        recs.push(`Consider moving some weekly volume away from "${worstPlatform}" until validation stabilizes.`);
      }
    }
  }

  if (summary.adjusted_count > 0) {
    recs.push(`High adjustment rate detected (adjusted=${summary.adjusted_count}); prefer formats aligned to platform limits to reduce downstream editing.`);
  }

  const placeholderIssue = summary.common_issues.find((i) => i.issue.includes('Added placeholder for required field'));
  if (placeholderIssue) {
    recs.push('Pre-fill required metadata fields earlier in planning (CTA, SEO fields, etc.) to avoid placeholder-driven content debt.');
  }

  const trimIssue = summary.common_issues.find((i) => i.issue.includes('Auto-trimmed draftContent'));
  if (trimIssue) {
    recs.push('Reduce long-form density in the weekly mix on platforms with tight limits; prioritize short-form variants.');
  }

  // Keep deterministic + bounded output
  const unique = Array.from(new Set(recs.map((r) => r.trim()).filter(Boolean)));
  return unique.slice(0, 8);
}

