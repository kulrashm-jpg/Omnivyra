/**
 * Governance Contract — Snapshot Test.
 * Freezes contract constants. Editing contract fails this test.
 */

import {
  GOVERNANCE_EVALUATION_ORDER,
  GOVERNANCE_STATUS_RULES,
  TRADE_OFF_PRIORITY_ORDER,
} from '../../governance/GovernanceContract';

describe('Governance Contract — Snapshot', () => {
  it('GOVERNANCE_EVALUATION_ORDER matches expected snapshot', () => {
    const expected = [
      "INVENTORY",
      "CONTENT_TYPE_CAPACITY",
      "CONTENT_COLLISION",
      "PRODUCTION_CAPACITY",
      "BUDGET",
      "BASELINE",
      "CAMPAIGN_TYPE_MINIMUM",
      "PORTFOLIO",
      "TRADE_OFF_GENERATION",
      "FINAL_STATUS"
    ];
    expect(GOVERNANCE_EVALUATION_ORDER).toEqual(expected);
    expect(JSON.stringify(GOVERNANCE_EVALUATION_ORDER)).toBe(JSON.stringify(expected));
  });

  it('GOVERNANCE_STATUS_RULES matches expected snapshot', () => {
    const expected = {
      REJECTED: "Blocking constraint OR max_weeks_allowed <= 0",
      NEGOTIATE: "Requested violates limiting constraint",
      APPROVED: "No blocking and no limiting violations"
    };
    expect(GOVERNANCE_STATUS_RULES).toEqual(expected);
    expect(JSON.stringify(GOVERNANCE_STATUS_RULES)).toBe(JSON.stringify(expected));
  });

  it('TRADE_OFF_PRIORITY_ORDER matches expected snapshot', () => {
    const expected = {
      NORMAL: [
        "SHIFT_START_DATE",
        "PREEMPT_LOWER_PRIORITY_CAMPAIGN",
        "REDUCE_FREQUENCY",
        "EXTEND_DURATION",
        "INCREASE_CAPACITY"
      ],
      HIGH_OR_CRITICAL: [
        "PREEMPT_LOWER_PRIORITY_CAMPAIGN",
        "SHIFT_START_DATE",
        "REDUCE_FREQUENCY",
        "EXTEND_DURATION",
        "INCREASE_CAPACITY"
      ]
    };
    expect(TRADE_OFF_PRIORITY_ORDER.NORMAL).toEqual(expected.NORMAL);
    expect(TRADE_OFF_PRIORITY_ORDER.HIGH_OR_CRITICAL).toEqual(expected.HIGH_OR_CRITICAL);
    expect(JSON.stringify(TRADE_OFF_PRIORITY_ORDER)).toBe(JSON.stringify(expected));
  });
});
