import {
  calculateQualityScore as calculateSharedQualityScore,
  getPublishBlockers as getSharedPublishBlockers,
  type FormMeta,
  type QualityScore,
  type ValidationIssue,
} from '../blog/blogValidation';

// Company context scoring — re-exported for convenience.
// BUILD-CERTIFICATION-001: source the VALUE (scoreCompanyContext) directly from
// the pure Scoring sub-module, NOT the companyContextBlock barrel. The barrel
// also re-exports the Builders part, which imports the Redis-backed
// canonicalContentContextResolver — reaching this scoring code from the
// ContentQualityPanel CLIENT component would pull child_process/net/fs/dns/
// worker_threads into the client bundle and fail `next build`. Types are erased
// at compile time, so importing them from the barrel is bundle-safe.
export { scoreCompanyContext } from './companyContextBlockScoring';
export type { CompanyIdentity, CompanyContextScoreResult } from './companyContextBlock';
import { scoreCompanyContext } from './companyContextBlockScoring';
import type { CompanyIdentity } from './companyContextBlock';

export type ContentFormMeta = FormMeta;
export type ContentQualityScore = QualityScore;
export type ContentValidationIssue = ValidationIssue;

// ── Company Alignment Score (human-readable report layer) ────────────────────

export interface CompanyAlignmentResult {
  score: number | null;    // 0–100, null if profile unavailable
  verdict: 'Strong' | 'Moderate' | 'Weak' | 'Unavailable';
  highlights: string[];
  issues: string[];
  suggestions: string[];   // max 2, actionable fixes
}

export function calculateCompanyAlignment(
  contentText: string,
  identity: CompanyIdentity | null | undefined,
): CompanyAlignmentResult {
  if (!identity || (!identity.companyName && !identity.industry && !identity.coreProblem)) {
    return { score: null, verdict: 'Unavailable', highlights: [], issues: ['Company profile not available'], suggestions: [] };
  }

  const result = scoreCompanyContext(contentText, identity);
  const highlights: string[] = [];
  const issues: string[] = [];

  // Build human-readable highlights
  if (result.companyMentions >= 3) {
    highlights.push('Company identity clearly integrated throughout');
  } else if (result.companyMentions >= 2) {
    highlights.push('Company identity present in content');
  }

  if (result.painPointHits >= 2) {
    highlights.push('Pain points integrated across sections');
  } else if (result.painPointHits >= 1) {
    highlights.push('At least one pain point referenced');
  }

  if (result.icpReferences >= 2) {
    highlights.push('Audience context well integrated');
  } else if (result.icpReferences >= 1) {
    highlights.push('Audience context included');
  }

  if (result.genericPhraseCount === 0) {
    highlights.push('No generic buzzwords detected');
  }

  // Build human-readable issues from scorer output
  for (const issue of result.issues) {
    if (issue.includes('not mentioned')) {
      issues.push('Company name missing from content');
    } else if (issue.includes('only once')) {
      issues.push('Company mentioned only once — may appear as name-dropping');
    } else if (issue.includes('intro only')) {
      issues.push('Company references concentrated in introduction only');
    } else if (issue.includes('No pain points')) {
      issues.push('No connection to company pain points');
    } else if (issue.includes('ICP')) {
      issues.push('Target audience not referenced in content');
    } else if (issue.includes('generic')) {
      issues.push('Generic buzzwords detected — consider replacing with specifics');
    } else if (issue.includes('never appears in the same sentence')) {
      issues.push('Company name not integrated with context — appears as decoration');
    } else {
      issues.push(issue);
    }
  }

  // Determine verdict
  let verdict: 'Strong' | 'Moderate' | 'Weak';
  if (result.score >= 80) {
    verdict = 'Strong';
  } else if (result.score >= 60) {
    verdict = 'Moderate';
  } else {
    verdict = 'Weak';
  }

  // Generate max 2 context-aware suggestions using available identity fields
  const suggestions: string[] = [];
  const _name = identity.companyName;
  const _icp = identity.idealCustomerProfile || identity.targetAudience;
  const _pain = identity.painPoints?.[0];
  const _product = identity.productsServices;
  const _industry = identity.industry;

  if (result.companyMentions < 2) {
    suggestions.push(
      _product
        ? `Reference ${_product} more explicitly in the body`
        : _name
          ? `Mention ${_name}'s domain or offering in at least two sections`
          : 'Reference the company\'s product or domain more explicitly in the body',
    );
  }
  if (result.painPointHits === 0 && result.icpReferences === 0) {
    suggestions.push(
      _icp && _industry
        ? `Add a real workflow involving ${_icp} in ${_industry}`
        : _pain
          ? `Show how "${_pain}" plays out in a real scenario`
          : 'Add a real example or workflow involving your target audience',
    );
  }
  if (result.genericPhraseCount >= 2) {
    suggestions.push(
      _pain && _product
        ? `Show how ${_product} helps solve "${_pain}" instead of using generic phrasing`
        : _pain
          ? `Explain how "${_pain}" shows up in a real scenario instead of generic claims`
          : 'Replace generic statements with specific situations or outcomes',
    );
  }
  if (suggestions.length === 0 && result.score < 60) {
    suggestions.push(
      _pain
        ? `Tie each section to "${_pain}" or a related customer challenge`
        : 'Tie each section to a specific customer challenge or use case',
    );
  }

  return { score: result.score, verdict, highlights, issues, suggestions: suggestions.slice(0, 2) };
}

// ── Core quality scoring ─────────────────────────────────────────────────────

export function calculateContentQualityScore(
  blocks: Parameters<typeof calculateSharedQualityScore>[0],
  form: ContentFormMeta,
): ContentQualityScore {
  return calculateSharedQualityScore(blocks, form);
}

export function getContentPublishBlockers(score: ContentQualityScore): ContentValidationIssue[] {
  return getSharedPublishBlockers(score);
}
