'use client';

import React, { useMemo } from 'react';
import { Globe, Loader2, TrendingUp, Zap } from 'lucide-react';
import type { ContentBlock } from '../../lib/content/blockTypes';
import {
  calculateContentQualityScore,
  getContentPublishBlockers,
  calculateCompanyAlignment,
  type ContentFormMeta,
  type CompanyIdentity,
  type CompanyAlignmentResult,
} from '../../lib/content/qualityScoringCore';
import {
  calculateNewsletterQualityScore,
  getNewsletterPublishBlockers,
} from '../../lib/newsletter/newsletterValidation';
import { flattenBlocks } from '../../lib/blog/blockUtils';

export type ImproveArea = 'structure' | 'depth' | 'geo' | 'linking' | 'seo';
export type PostBlogStatus = {
  type: 'info' | 'success' | 'error';
  message: string;
};

interface ContentQualityPanelProps {
  blocks: ContentBlock[];
  formState: ContentFormMeta;
  onImprove: (area: ImproveArea) => void;
  onAutoImprove: (area: ImproveArea) => Promise<void>;
  improvingArea: ImproveArea | null;
  onCreateCampaign?: () => void;
  /** When provided, shows Company Alignment Score section. */
  companyIdentity?: CompanyIdentity;
  /** Called when user clicks "Improve Alignment" (shown when score < 60). */
  onImproveAlignment?: () => void;
  /** Optional per-issue auto-apply. Called with the issue category, exact message, and the row key (use this same key as improvingIssueKey to surface the row spinner). */
  onAutoImproveIssue?: (area: ImproveArea, message: string, key: string) => Promise<void>;
  /** Stable key identifying the issue currently being auto-fixed (for spinner state). Must match the key passed into onAutoImproveIssue. */
  improvingIssueKey?: string | null;
  /** When provided, replaces the Create Campaign button with Post Blog (website). */
  onPostBlogToWebsite?: () => void;
  /** Whether website CMS + lead-capture integration is in place. Disables the post button when false. */
  websiteIntegrationAvailable?: boolean;
  /** Tooltip / helper text shown when website integration is not available. */
  websiteIntegrationReason?: string;
  /** Whether a post-blog-to-website call is currently in flight. */
  isPostingBlog?: boolean;
  /** Inline publish status/error shown beside the website posting action. */
  postBlogStatus?: PostBlogStatus | null;
}

type ScoreConfig = {
  total: number;
  structure: number;
  depth: number;
  seo: number;
  geo: number;
  linking: number;
};

const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  total: 100,
  structure: 25,
  depth: 25,
  seo: 25,
  geo: 15,
  linking: 10,
};

const NEWSLETTER_SCORE_CONFIG: ScoreConfig = {
  total: 90,
  structure: 25,
  depth: 20,
  seo: 15,
  geo: 20,
  linking: 10,
};

const AREA_LABELS: Record<ImproveArea, string> = {
  structure: 'Structure',
  depth: 'Depth',
  seo: 'SEO',
  geo: 'GEO',
  linking: 'Linking',
};

function getScoreConfig(contentType?: string): ScoreConfig {
  return contentType === 'newsletter' ? NEWSLETTER_SCORE_CONFIG : DEFAULT_SCORE_CONFIG;
}

function scoreColor(pct: number): string {
  if (pct >= 80) return 'text-emerald-600';
  if (pct >= 50) return 'text-amber-600';
  return 'text-red-500';
}

function barColor(pct: number): string {
  if (pct >= 80) return 'bg-emerald-500';
  if (pct >= 50) return 'bg-amber-400';
  return 'bg-red-400';
}

function scoreLabel(totalPct: number): string {
  if (totalPct >= 85) return 'Excellent';
  if (totalPct >= 70) return 'Good';
  if (totalPct >= 50) return 'Needs Work';
  return 'Incomplete';
}

export function ContentQualityPanel({
  blocks,
  formState,
  onImprove,
  onAutoImprove,
  improvingArea,
  onCreateCampaign,
  companyIdentity,
  onImproveAlignment,
  onAutoImproveIssue,
  improvingIssueKey,
  onPostBlogToWebsite,
  websiteIntegrationAvailable,
  websiteIntegrationReason,
  isPostingBlog,
  postBlogStatus,
}: ContentQualityPanelProps) {
  const scoreConfig = getScoreConfig(formState.content_type);

  const score = useMemo(() => {
    if (formState.content_type === 'newsletter') {
      return calculateNewsletterQualityScore(blocks, formState);
    }
    return calculateContentQualityScore(blocks, formState);
  }, [
    blocks,
    formState,
  ]);

  // Company alignment scoring — extract text from blocks and score
  const companyAlignment: CompanyAlignmentResult = useMemo(() => {
    if (!companyIdentity) {
      return { score: null, verdict: 'Unavailable' as const, highlights: [], issues: [], suggestions: [] };
    }
    const contentText = flattenBlocks(blocks)
      .map((b) => {
        if (b.type === 'paragraph') return (b as any).html?.replace(/<[^>]+>/g, ' ') || '';
        if (b.type === 'summary') return (b as any).body || '';
        if (b.type === 'key_insights') return ((b as any).items || []).join(' ');
        if (b.type === 'callout') return `${(b as any).title || ''} ${(b as any).body || ''}`;
        return '';
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (contentText.length < 50) {
      return { score: null, verdict: 'Unavailable' as const, highlights: [], issues: ['Not enough content to score'], suggestions: [] };
    }
    return calculateCompanyAlignment(contentText, companyIdentity);
  }, [blocks, companyIdentity]);

  const totalPct = Math.round((score.total / scoreConfig.total) * 100);
  const areas: ImproveArea[] = ['structure', 'depth', 'seo', 'geo', 'linking'];

  const publishBlockers = formState.content_type === 'newsletter'
    ? getNewsletterPublishBlockers(score)
    : getContentPublishBlockers(score);

  const errorIssues = score.issues.filter((issue) => issue.severity === 'error');
  const warnIssues = score.issues.filter((issue) => issue.severity === 'warning');

  return (
    <div className="rounded-xl border border-gray-200 bg-white text-sm shadow-sm">
      <div className="border-b border-gray-100 px-4 pb-3 pt-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold text-gray-800">Quality Score</span>
          <span className={`text-xl font-bold tabular-nums ${scoreColor(totalPct)}`}>
            {score.total}/{scoreConfig.total}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className={`h-full rounded-full transition-all duration-300 ${barColor(totalPct)}`}
            style={{ width: `${totalPct}%` }}
          />
        </div>
        <p className={`mt-1 text-xs font-medium ${scoreColor(totalPct)}`}>{scoreLabel(totalPct)}</p>
      </div>

      <div className="space-y-2.5 px-4 py-3">
        {areas.map((area) => {
          const raw = score.breakdown[area];
          const max = scoreConfig[area];
          const pct = max > 0 ? Math.round((raw / max) * 100) : 0;
          const isImproving = improvingArea === area;

          return (
            <div key={area}>
              <div className="mb-0.5 flex items-center justify-between">
                <span className="capitalize text-gray-600">{AREA_LABELS[area]}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-semibold tabular-nums ${scoreColor(pct)}`}>
                    {raw}/{max}
                  </span>
                  <button
                    type="button"
                    title={`Auto-improve ${AREA_LABELS[area]}`}
                    disabled={!!improvingArea}
                    onClick={() => onAutoImprove(area)}
                    className="flex h-5 w-5 items-center justify-center rounded text-gray-400 transition-colors hover:bg-amber-50 hover:text-amber-600 disabled:opacity-40"
                  >
                    {isImproving ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Zap className="h-3 w-3" />
                    )}
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onImprove(area)}
                className="block w-full text-left"
                title={`Jump to ${AREA_LABELS[area]}`}
              >
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${barColor(pct)}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {score.issues.length > 0 && (
        <div className="space-y-1 border-t border-gray-100 px-4 pb-3 pt-3">
          {errorIssues.map((issue, index) => {
            const key = `error-${issue.category}-${index}`;
            const fixing = improvingIssueKey === key;
            // Phase 1 gate issues (category 'publishing') are not fixable by the
            // area-based auto-improver, so the Apply button is hidden for them.
            const improvable = issue.category === 'publishing' ? null : issue.category;
            return (
              <div key={key} className="flex items-start gap-1.5 text-xs text-red-700">
                <span className="mt-px shrink-0">x</span>
                <span className="flex-1">{issue.message}</span>
                {onAutoImproveIssue && improvable && (
                  <button
                    type="button"
                    title={`Apply fix: ${issue.message}`}
                    disabled={!!improvingArea || !!improvingIssueKey}
                    onClick={() => onAutoImproveIssue(improvable, issue.message, key)}
                    className="flex h-5 items-center gap-0.5 rounded px-1 text-[10px] font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-40"
                  >
                    {fixing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                    Apply
                  </button>
                )}
              </div>
            );
          })}
          {warnIssues.slice(0, 3).map((issue, index) => {
            const key = `warn-${issue.category}-${index}`;
            const fixing = improvingIssueKey === key;
            const improvable = issue.category === 'publishing' ? null : issue.category;
            return (
              <div key={key} className="flex items-start gap-1.5 text-xs text-amber-700">
                <span className="mt-px shrink-0">!</span>
                <span className="flex-1">{issue.message}</span>
                {onAutoImproveIssue && improvable && (
                  <button
                    type="button"
                    title={`Apply fix: ${issue.message}`}
                    disabled={!!improvingArea || !!improvingIssueKey}
                    onClick={() => onAutoImproveIssue(improvable, issue.message, key)}
                    className="flex h-5 items-center gap-0.5 rounded px-1 text-[10px] font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-40"
                  >
                    {fixing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                    Apply
                  </button>
                )}
              </div>
            );
          })}
          {warnIssues.length > 3 && (
            <p className="text-xs text-gray-400">+{warnIssues.length - 3} more suggestions</p>
          )}
        </div>
      )}

      {/* ── Company Alignment Score ──────────────────────────────────── */}
      {companyIdentity && companyAlignment.score !== null && (
        <div className="border-t border-gray-100 px-4 pb-3 pt-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Company Alignment</span>
            <span className={`text-sm font-bold tabular-nums ${scoreColor(companyAlignment.score)}`}>
              {companyAlignment.score}/100
            </span>
          </div>
          <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full transition-all duration-300 ${barColor(companyAlignment.score)}`}
              style={{ width: `${companyAlignment.score}%` }}
            />
          </div>
          {companyAlignment.highlights.length > 0 && (
            <div className="space-y-0.5 mb-1">
              {companyAlignment.highlights.slice(0, 3).map((h, i) => (
                <div key={`ca-h-${i}`} className="flex gap-1.5 text-xs text-emerald-700">
                  <span className="mt-px shrink-0">&#10003;</span>
                  <span>{h}</span>
                </div>
              ))}
            </div>
          )}
          {companyAlignment.issues.length > 0 && (
            <div className="space-y-0.5">
              {companyAlignment.issues.slice(0, 3).map((iss, i) => (
                <div key={`ca-i-${i}`} className="flex gap-1.5 text-xs text-amber-700">
                  <span className="mt-px shrink-0">!</span>
                  <span>{iss}</span>
                </div>
              ))}
            </div>
          )}
          {companyAlignment.suggestions.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {companyAlignment.suggestions.map((s, i) => (
                <div key={`ca-s-${i}`} className="flex gap-1.5 text-xs text-gray-500">
                  <span className="mt-px shrink-0">&rarr;</span>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          )}
          <p className={`mt-1 text-xs font-medium ${
            companyAlignment.verdict === 'Strong' ? 'text-emerald-600' :
            companyAlignment.verdict === 'Moderate' ? 'text-amber-600' :
            'text-red-500'
          }`}>
            {companyAlignment.verdict} alignment with company context
          </p>
          {onImproveAlignment && companyAlignment.score !== null && companyAlignment.score < 60 && (
            <button
              type="button"
              onClick={onImproveAlignment}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
            >
              <Zap className="h-3 w-3" />
              Improve Alignment
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-gray-100 px-4 pb-3 pt-3 text-xs text-gray-500">
        <span>Words: <strong className="text-gray-700">{score.meta.wordCount}</strong></span>
        <span>Target: <strong className="text-gray-700">{score.meta.targetWordCount}</strong></span>
        <span>H2s: <strong className="text-gray-700">{score.meta.h2Count}</strong></span>
        <span>Refs: <strong className="text-gray-700">{score.meta.refsCount}</strong></span>
      </div>

      {publishBlockers.length > 0 && (
        <div className="border-t border-gray-100 px-4 pb-3 pt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Publish blockers</p>
          <div className="space-y-1">
            {publishBlockers.slice(0, 3).map((issue, index) => {
              const key = `blocker-${issue.category}-${index}`;
              const fixing = improvingIssueKey === key;
              const improvable = issue.category === 'publishing' ? null : issue.category;
              return (
                <div key={key} className="flex items-start gap-1.5 text-xs text-red-700">
                  <span className="mt-px shrink-0">x</span>
                  <span className="flex-1">{issue.message}</span>
                  {onAutoImproveIssue && improvable && (
                    <button
                      type="button"
                      title={`Apply fix: ${issue.message}`}
                      disabled={!!improvingArea || !!improvingIssueKey}
                      onClick={() => onAutoImproveIssue(improvable, issue.message, key)}
                      className="flex h-5 items-center gap-0.5 rounded px-1 text-[10px] font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-40"
                    >
                      {fixing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                      Apply
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {onPostBlogToWebsite ? (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3">
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={onPostBlogToWebsite}
              disabled={!websiteIntegrationAvailable || !!isPostingBlog}
              title={
                websiteIntegrationAvailable
                  ? 'Publish this blog to your connected website'
                  : websiteIntegrationReason || 'Connect your website CMS and lead capture to enable posting.'
              }
              className={`flex min-w-[148px] items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-opacity ${
                websiteIntegrationAvailable
                  ? 'bg-amber-600 text-white hover:opacity-90'
                  : 'cursor-not-allowed bg-gray-200 text-gray-500'
              } disabled:opacity-60`}
            >
              {isPostingBlog ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
              Post Blog (website)
            </button>
            {postBlogStatus && (
              <p className={`min-w-0 flex-1 pt-0.5 text-[10px] leading-snug ${
                postBlogStatus.type === 'error'
                  ? 'text-red-600'
                  : postBlogStatus.type === 'success'
                    ? 'text-emerald-600'
                    : 'text-gray-500'
              }`}>
                {postBlogStatus.message}
              </p>
            )}
          </div>
          {!websiteIntegrationAvailable && websiteIntegrationReason && (
            <p className="mt-1.5 text-[10px] leading-snug text-gray-500">{websiteIntegrationReason}</p>
          )}
        </div>
      ) : onCreateCampaign ? (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3">
          <button
            type="button"
            onClick={onCreateCampaign}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          >
            <TrendingUp className="h-3.5 w-3.5" />
            Create Campaign
          </button>
        </div>
      ) : null}
    </div>
  );
}
