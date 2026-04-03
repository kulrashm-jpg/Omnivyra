import { computeReportCardState } from '../../types/reportCard';
import {
  canGenerateFreeReport,
  getReportCTALabel,
  getReportCTARoute,
  getReportCardAvailabilityState,
  getReportCardState,
} from '../../services/reportCardService';

describe('report card state', () => {
  it('returns free_available for admins with no prior free report', () => {
    const state = computeReportCardState({
      userRole: 'COMPANY_ADMIN',
      companyId: 'company-1',
      domain: 'example.com',
      hasFreeReportUsed: false,
      hasGeneratingReport: false,
      hasReportGenerated: false,
    });

    expect(state.reportState).toBe('free_available');
    expect(state.badge).toBe('FREE_AVAILABLE');
    expect(state.ctaLabel).toBe('Generate Free Report');
    expect(state.ctaDisabled).toBe(false);
    expect(state.cardState).toBe('not_started');
  });

  it('returns generating when a report is in progress', () => {
    const state = computeReportCardState({
      userRole: 'COMPANY_ADMIN',
      companyId: 'company-1',
      domain: 'example.com',
      hasFreeReportUsed: true,
      hasGeneratingReport: true,
      hasReportGenerated: true,
    });

    expect(state.reportState).toBe('generating');
    expect(state.badge).toBe('GENERATING');
    expect(state.ctaLabel).toBe('Generating...');
    expect(state.ctaDisabled).toBe(true);
    expect(state.showSpinner).toBe(true);
    expect(state.cardState).toBe('in_progress');
  });

  it('returns used after the free report has been consumed', () => {
    const state = computeReportCardState({
      userRole: 'COMPANY_ADMIN',
      companyId: 'company-1',
      domain: 'example.com',
      hasFreeReportUsed: true,
      hasGeneratingReport: false,
      hasReportGenerated: true,
    });

    expect(state.reportState).toBe('used');
    expect(state.badge).toBe('USED');
    expect(state.ctaLabel).toBe('Upgrade to Generate Report');
    expect(state.cardState).toBe('ready');
  });

  it('blocks free generation while a report is generating', () => {
    expect(
      canGenerateFreeReport({
        userRole: 'COMPANY_ADMIN',
        companyId: 'company-1',
        domain: 'example.com',
        hasFreeReportUsed: false,
        hasGeneratingReport: true,
      }),
    ).toBe(false);
  });

  it('maps server helper state consistently', () => {
    const context = {
      userRole: 'COMPANY_ADMIN',
      companyId: 'company-1',
      domain: 'example.com',
      hasReportGenerated: true,
      hasFreeReportUsed: false,
      hasGeneratingReport: true,
    };

    expect(getReportCardAvailabilityState(context)).toBe('generating');
    expect(getReportCTALabel(context)).toBe('Generating...');
    expect(getReportCTARoute(context)).toBe('/reports/generate?type=free');
    expect(getReportCardState(context)).toBe('in_progress');
  });
});
