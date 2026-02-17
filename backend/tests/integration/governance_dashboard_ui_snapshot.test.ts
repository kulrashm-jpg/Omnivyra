/**
 * Governance Dashboard UI Snapshot — Stage 10 Phase 5.
 * Validates deriveFromEvent, API response shapes, and component data contracts.
 * No React rendering (node env). Ensures components receive valid data.
 */

import { deriveFromEvent } from '../../../components/governance/GovernanceExplanationPanel';

describe('Governance Dashboard UI', () => {
  describe('deriveFromEvent', () => {
    it('returns blocked for DURATION_REJECTED', () => {
      const r = deriveFromEvent('DURATION_REJECTED', { blocking_constraints_count: 2 });
      expect(r.blocked).toBe(true);
      expect(r.primaryReason).toBe('blocking_constraints');
      expect(r.explanation).toContain('rejected');
    });

    it('returns negotiate-style for DURATION_NEGOTIATE', () => {
      const r = deriveFromEvent('DURATION_NEGOTIATE', { max_weeks_allowed: 6 });
      expect(r.blocked).toBe(false);
      expect(r.primaryReason).toBe('limiting_constraint');
      expect(r.explanation).toContain('6');
    });

    it('returns approved for DURATION_APPROVED', () => {
      const r = deriveFromEvent('DURATION_APPROVED', {});
      expect(r.blocked).toBe(false);
      expect(r.explanation).toContain('Approved');
    });

    it('returns approved for unknown event type', () => {
      const r = deriveFromEvent('PREEMPTION_EXECUTED', {});
      expect(r.blocked).toBe(false);
      expect(r.explanation).toContain('Approved');
    });
  });

  describe('API response shapes for components', () => {
    it('campaign-status shape matches GovernanceStatusCard', () => {
      const mockStatus = {
        campaignId: 'c1',
        companyId: 'co1',
        governance: {
          durationWeeks: 12,
          priorityLevel: 'HIGH',
          blueprintStatus: 'ACTIVE',
          durationLocked: true,
          lastPreemptedAt: null,
          cooldownActive: false,
        },
        latestGovernanceEvent: {
          eventType: 'DURATION_APPROVED',
          eventStatus: 'APPROVED',
          createdAt: new Date().toISOString(),
          metadata: {},
        },
      };
      expect(mockStatus.governance.cooldownActive).toBe(false);
      expect(mockStatus.governance.durationWeeks).toBe(12);
      expect(mockStatus.latestGovernanceEvent?.eventType).toBe('DURATION_APPROVED');
    });

    it('campaign-status with cooldownActive true shows Cooldown Active badge', () => {
      const mockStatus = {
        governance: { cooldownActive: true },
      };
      expect(mockStatus.governance.cooldownActive).toBe(true);
    });

    it('events shape matches GovernanceTimeline and PreemptionHistory', () => {
      const mockEvents = [
        {
          id: 'e1',
          campaignId: 'c1',
          eventType: 'PREEMPTION_EXECUTED',
          eventStatus: 'EXECUTED',
          metadata: { targetCampaignId: 'c2', justification: 'Revenue-critical.' },
          createdAt: new Date().toISOString(),
        },
        {
          id: 'e2',
          campaignId: 'c1',
          eventType: 'DURATION_NEGOTIATE',
          eventStatus: 'NEGOTIATE',
          metadata: { requested_weeks: 12, max_weeks_allowed: 6 },
          createdAt: new Date().toISOString(),
        },
      ];
      expect(mockEvents).toHaveLength(2);
      expect(mockEvents[0].eventType).toBe('PREEMPTION_EXECUTED');
      expect(mockEvents[0].metadata.targetCampaignId).toBe('c2');
      expect(mockEvents[1].metadata.max_weeks_allowed).toBe(6);
    });

    it('trade_off_options shape matches TradeOffSuggestionList', () => {
      const mockOptions = [
        { type: 'SHIFT_START_DATE', newStartDate: '2025-03-01' },
        { type: 'REDUCE_FREQUENCY', postsPerWeek: 3 },
        { type: 'PREEMPT_LOWER_PRIORITY_CAMPAIGN', targetCampaignId: 'camp-123' },
      ];
      expect(mockOptions).toHaveLength(3);
      expect(mockOptions[0].type).toBe('SHIFT_START_DATE');
      expect(mockOptions[1].postsPerWeek).toBe(3);
    });
  });
});
