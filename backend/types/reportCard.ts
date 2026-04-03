/**
 * Report Card Frontend Integration Types
 */

import type { CardState } from '@/config/commandCenterCards';

export type ReportUiState = 'free_available' | 'generating' | 'used';

/**
 * Input context for report card state computation
 */
export interface ReportCardComputeInput {
  userRole: string;
  companyId: string;
  domain: string;
  hasFreeReportUsed?: boolean;
  hasReportGenerated?: boolean;
  hasGeneratingReport?: boolean;
}

/**
 * Output state for rendering the report card
 */
export interface ReportCardComputedState {
  reportState: ReportUiState;
  badge?: 'FREE_AVAILABLE' | 'GENERATING' | 'USED';
  badgeLabel?: string;
  badgeTooltip?: string;
  ctaLabel: string;
  ctaRoute: string;
  ctaDisabled?: boolean;
  showSpinner?: boolean;
  showCard: boolean;
  canGenerateFree: boolean;
  adminRequired?: boolean;
  freeUsedByOthers?: boolean;
  cardState: CardState;
  hint?: string;
  warningMessage?: string;
}

export interface GetReportsAPIResponse {
  success: boolean;
  reports: ReportRecord[];
  domain: string;
  hasFreeReportUsed: boolean;
  hasGeneratingReport: boolean;
  reportState: ReportUiState;
  canGenerateFreeReport: boolean;
}

export interface GenerateReportAPIResponse {
  success: boolean;
  reportId: string;
  status: 'generating';
  message: string;
}

export interface ReportRecord {
  id: string;
  company_id: string;
  domain: string;
  is_free: boolean;
  report_type: string;
  status: 'generating' | 'completed' | 'failed';
  created_at: string;
  completed_at?: string | null;
  data?: Record<string, unknown> | null;
}

export function computeReportCardState(
  input: ReportCardComputeInput,
): ReportCardComputedState {
  const isAdmin = ['COMPANY_ADMIN', 'SUPER_ADMIN'].includes(input.userRole);
  const hasGeneratingReport = Boolean(input.hasGeneratingReport);
  const hasFreeReportUsed = Boolean(input.hasFreeReportUsed);

  const reportState: ReportUiState = hasGeneratingReport
    ? 'generating'
    : hasFreeReportUsed
      ? 'used'
      : 'free_available';

  const badge = isAdmin
    ? reportState === 'generating'
      ? 'GENERATING'
      : reportState === 'used'
        ? 'USED'
        : 'FREE_AVAILABLE'
    : undefined;

  const ctaLabel = !isAdmin
    ? 'View Reports'
    : reportState === 'generating'
      ? 'Generating...'
      : reportState === 'used'
        ? 'Upgrade to Generate Report'
        : 'Generate Free Report';

  const ctaRoute = !isAdmin
    ? '/reports'
    : reportState === 'used'
      ? '/pricing?upgrade=reports'
      : '/reports/generate?type=free';

  return {
    reportState,
    badge,
    badgeLabel:
      badge === 'FREE_AVAILABLE'
        ? 'Free Report Available'
        : badge === 'GENERATING'
          ? 'Generating'
          : badge === 'USED'
            ? 'Free Used'
            : undefined,
    badgeTooltip:
      badge === 'FREE_AVAILABLE'
        ? 'Generate your free content analysis report (available once per domain)'
        : badge === 'GENERATING'
          ? 'A report is already being generated for this domain'
          : badge === 'USED'
            ? 'Free report already used for this domain. Upgrade for more reports.'
            : undefined,
    ctaLabel,
    ctaRoute,
    ctaDisabled: reportState === 'generating' || (!isAdmin && !input.hasReportGenerated),
    showSpinner: reportState === 'generating',
    showCard: true,
    canGenerateFree: isAdmin && reportState === 'free_available',
    adminRequired: !isAdmin,
    freeUsedByOthers: hasFreeReportUsed,
    cardState:
      reportState === 'generating'
        ? 'in_progress'
        : input.hasReportGenerated || hasFreeReportUsed
          ? 'ready'
          : 'not_started',
    hint: !isAdmin
      ? 'Only Company Admins can generate the free report'
      : reportState === 'generating'
        ? 'Your report is currently being generated'
        : reportState === 'used'
          ? 'Upgrade to generate another report'
          : 'You have one free report available',
    warningMessage:
      reportState === 'used' && isAdmin
        ? 'Free report already used. Upgrade to generate additional reports.'
        : undefined,
  };
}
