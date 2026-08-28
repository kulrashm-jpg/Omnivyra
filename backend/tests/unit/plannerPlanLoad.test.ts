/**
 * CP-STRUCT-002 — the plan-adoption decision.
 *
 * The Structure stage looped because `PlanLoader` wrote every retrieve-plan
 * response into canonical planner state, including empty ones. Since both
 * setters reset `skeleton_confirmed`, an empty response erased a structure the
 * user had just accepted and sent them back to the generation controls.
 *
 * These tests pin the decision that now guards that write.
 */

import {
  decidePlanAdoption,
  serverPlanHasContent,
} from '../../../lib/campaign/plannerPlanLoad';

const WEEK = { week: 1, theme: 'Kickoff', days: [] };

describe('serverPlanHasContent', () => {
  it('is false for every shape that carries no week', () => {
    for (const v of [undefined, null, [], 'weeks', 0, {}]) {
      expect(serverPlanHasContent(v)).toBe(false);
    }
  });

  it('is true only for a non-empty array', () => {
    expect(serverPlanHasContent([WEEK])).toBe(true);
  });
});

describe('an empty server plan never overwrites canonical state', () => {
  it('THE REGRESSION — a refresh returning no weeks must not adopt', () => {
    // This is the exact sequence that broke the Structure stage: the user
    // accepts a structure, acceptProposal fires onGenerate → refreshTrigger
    // becomes 1, retrieve-plan has nothing persisted yet, and the old loader
    // wrote the resulting EMPTY plan straight over the accepted one.
    expect(decidePlanAdoption({ refreshTrigger: 1, hasLocalPlan: true, weeks: [] }))
      .toEqual({ adopt: false, reason: 'empty_server_plan' });
  });

  it('declines an empty plan regardless of trigger or local state', () => {
    for (const refreshTrigger of [0, 1, 7]) {
      for (const hasLocalPlan of [true, false]) {
        expect(decidePlanAdoption({ refreshTrigger, hasLocalPlan, weeks: [] }).adopt).toBe(false);
      }
    }
  });

  it('a malformed payload is treated as empty, never adopted', () => {
    for (const weeks of [undefined, null, 'nope', 42, {}]) {
      expect(decidePlanAdoption({ refreshTrigger: 1, hasLocalPlan: true, weeks }).adopt).toBe(false);
    }
  });
});

describe('a server plan WITH content is still adopted', () => {
  it('initial load with nothing local adopts', () => {
    expect(decidePlanAdoption({ refreshTrigger: 0, hasLocalPlan: false, weeks: [WEEK] }))
      .toEqual({ adopt: true, reason: 'initial_load' });
  });

  it('an explicit refresh over existing local state adopts', () => {
    expect(decidePlanAdoption({ refreshTrigger: 1, hasLocalPlan: true, weeks: [WEEK] }))
      .toEqual({ adopt: true, reason: 'server_plan_has_content' });
  });

  it('the initial pass does NOT clobber a resumed session that already has state', () => {
    // Preserves the loader's original refreshTrigger === 0 guard.
    expect(decidePlanAdoption({ refreshTrigger: 0, hasLocalPlan: true, weeks: [WEEK] }))
      .toEqual({ adopt: false, reason: 'local_plan_preserved' });
  });

  it('is pure — same input, same decision', () => {
    const input = { refreshTrigger: 1, hasLocalPlan: true, weeks: [WEEK] };
    expect(decidePlanAdoption(input)).toEqual(decidePlanAdoption(input));
  });
});
