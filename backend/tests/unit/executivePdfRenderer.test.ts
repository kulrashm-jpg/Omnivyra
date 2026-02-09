import { renderExecutiveSummaryPdf } from '../../services/export/executivePdfRenderer';

describe('executivePdfRenderer', () => {
  it('renders a PDF without throwing', async () => {
    const buffer = await renderExecutiveSummaryPdf({
      organizationName: 'Tenant One',
      generatedAt: new Date('2024-02-01T00:00:00.000Z'),
      narrative: {
        overview: 'Overview',
        key_shifts: ['Shift 1'],
        risks_to_watch: ['Risk 1'],
        recommendations_to_review: [],
        explicitly_not_recommended: ['Hold 1'],
        confidence_level: 0.7,
        source: 'omnivyra',
      },
      summary: {
        total_discovered_users: 2,
        total_eligible_users: 1,
        eligibility_rate: 0.5,
        total_actions_created: 3,
        total_actions_executed: 2,
        execution_rate: 0.66,
        automation_mix: { observe: 0.5, assist: 0.5, automate: 0 },
        top_playbooks_by_quality: [],
        top_playbooks_by_volume: [],
        platform_mix: [{ platform: 'linkedin', discovered_users: 2, share: 1 }],
        last_activity_at: '2024-02-01T00:00:00.000Z',
      },
      playbookPerformance: [
        {
          playbook_id: 'playbook-1',
          playbook_name: 'Default Playbook',
          automation_level: 'assist',
          discovered_users_count: 2,
          eligible_users_count: 1,
          ineligible_users_count: 1,
          actions_created_count: 3,
          actions_executed_count: 2,
          execution_rate: 0.66,
          quality_score: 0.5,
          top_platforms: [{ platform: 'linkedin', discovered_users_count: 2 }],
        },
      ],
    });

    expect(buffer.length).toBeGreaterThan(0);
  });
});
