import {
  getCompanyProfileReviewStatus,
  upsertCompanyProfileGovernanceSettings,
  type CompanyProfile,
} from '../../services/companyProfileService';

describe('company profile governance', () => {
  it('confirms company facts for six months when an admin saves them', () => {
    const settings = upsertCompanyProfileGovernanceSettings({
      existingReportSettings: null,
      incomingReportSettings: {
        company_facts: {
          team_size: '11-50',
          founded_year: '2022',
          revenue_range: '$1M-$5M',
        },
      },
      confirmedByRole: 'COMPANY_ADMIN',
      now: new Date('2026-04-03T00:00:00.000Z'),
    });

    expect(settings?.company_facts?.team_size).toBe('11-50');
    expect(settings?.profile_review?.pending_confirmation).toBe(false);
    expect(settings?.profile_review?.last_confirmed_by_role).toBe('COMPANY_ADMIN');
    expect(settings?.profile_review?.next_confirmation_due_at).toBeTruthy();
  });

  it('marks company facts pending when the confirmation window has expired', () => {
    const profile = {
      company_id: 'company-1',
      report_settings: {
        company_facts: {
          team_size: '11-50',
        },
        profile_review: {
          last_confirmed_at: '2025-01-01T00:00:00.000Z',
          next_confirmation_due_at: '2025-07-03T00:00:00.000Z',
          confirmation_interval_days: 183,
          pending_confirmation: false,
        },
      },
    } as CompanyProfile;

    const status = getCompanyProfileReviewStatus(profile);

    expect(status.facts_present).toBe(true);
    expect(status.due).toBe(true);
    expect(status.pending_confirmation).toBe(true);
  });
});
