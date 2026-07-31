/**
 * AI-ORCH 2B.1 — the five AI Orchestration rollout flags are registered and OFF
 * by default. Importing the orchestrationFlags module is what registers them
 * (defineRolloutFlag side effect), mirroring the 'data-lifecycle' pattern in
 * platformWave6.test.ts.
 *
 * This is the ONLY consumer of the flags in Phase 2B.1 — a test. Nothing in the
 * runtime reads their decisions yet, so behavior is byte-identical to today.
 */
import { listRolloutFlags, resolveRolloutSync } from '../../../lib/platform/rollout';
import { AI_ORCHESTRATION_FLAGS } from '../../services/aiOrchestration/orchestrationFlags';

const EXPECTED_KEYS = [
  'ai-config-resolver-shadow',
  'ai-config-resolver-enabled',
  'ai-admin-console',
  'ai-profile-params-enabled',
  'ai-multiprovider-live',
] as const;

describe('AI Orchestration flags: registered and OFF by default', () => {
  test('all five flags are exported in phase order', () => {
    expect(AI_ORCHESTRATION_FLAGS.map((f) => f.key)).toEqual(EXPECTED_KEYS);
  });

  test.each(EXPECTED_KEYS)('%s is registered on the operator surface', (key) => {
    const flag = listRolloutFlags().find((f) => f.key === key);
    expect(flag).toBeDefined();
  });

  test.each(EXPECTED_KEYS)('%s resolves to OFF by default', (key) => {
    const flag = listRolloutFlags().find((f) => f.key === key)!;
    expect(resolveRolloutSync(flag).mode).toBe('off');
  });

  test('default mode is off for every AI orchestration flag object', () => {
    for (const flag of AI_ORCHESTRATION_FLAGS) {
      expect(flag.defaultMode).toBe('off');
    }
  });
});
