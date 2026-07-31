/**
 * AI-ORCH 2B.1B — Execution Metadata foundation: separated fingerprint versioning
 * constants + the ResolutionTrace / ExecutionMetadata contracts.
 *
 * These are dormant contracts. This test proves (a) the separated version constants
 * exist and DECOMPOSE the legacy combined tag without changing it, and (b) the type
 * contracts are structurally usable (compile-time smoke). No runtime consumer.
 */
import {
  CONFIG_FINGERPRINT_ALGO,
  EXECUTION_SCHEMA_VERSION,
  CANONICALIZATION_VERSION,
  FINGERPRINT_ALGORITHM,
  computeConfigFingerprint,
} from '../../services/aiOrchestration/configFingerprint';
import type { ResolutionTrace } from '../../services/aiOrchestration/types/ResolutionTrace';
import type { ExecutionMetadata } from '../../services/aiOrchestration/types/ExecutionMetadata';

describe('AI-ORCH 2B.1B — separated fingerprint versioning', () => {
  test('the separated constants exist with the seeded values', () => {
    expect(EXECUTION_SCHEMA_VERSION).toBe(1);
    expect(CANONICALIZATION_VERSION).toBe(1);
    expect(FINGERPRINT_ALGORITHM).toBe('sha256');
  });

  test('the separated fields DECOMPOSE the legacy combined tag (no value change)', () => {
    // Legacy tag 'sha256:v1' === '<algorithm>:v<canonicalization_version>'.
    expect(CONFIG_FINGERPRINT_ALGO).toBe(`${FINGERPRINT_ALGORITHM}:v${CANONICALIZATION_VERSION}`);
  });

  test('existing fingerprints are UNCHANGED (BALANCED anchor)', () => {
    // The 2B.1A BALANCED semantics must still produce the exact seeded fingerprint —
    // proving 2B.1B added no behavior and perturbed no hash.
    const balanced = {
      mode: 'tier', quality_tier: 'balanced', capability_requirements: {},
      params: { temperature: 0.4, max_output_tokens: 2000, seed_policy: 'none' },
      modality: { streaming: false, structured_output: false },
      reliability: { timeout_ms: 60000, max_retries: 2, partial_allowed: false },
      limits: {}, caching: { cacheable: true },
      safety: { moderation: 'off', prompt_injection_guard: false },
    };
    expect(computeConfigFingerprint(balanced)).toBe(
      'sha256:v1:9dbba7cc97a50e79c8bd4bde455514865dad37c3d0ab7601025eb980ffc92910',
    );
  });
});

describe('AI-ORCH 2B.1B — metadata contracts (compile-time smoke)', () => {
  test('a ResolutionTrace can be constructed to the contract', () => {
    const trace: ResolutionTrace = {
      steps: [
        { sequence: 0, step: 'resolve binding', decisionCode: 'USE_CAPABILITY_DEFAULT', reasonCode: 'CAP_DEFAULT_APPLIED', source: 'capability_default', metadata: { capability: 'CONTENT_WRITER' } },
        { sequence: 1, step: 'select model', decisionCode: 'SELECT_MODEL', reasonCode: 'PLATFORM_DEFAULT_APPLIED', metadata: { model: 'gpt-4o-mini' }, durationMs: 2 },
      ],
      totalDurationMs: 2,
    };
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[0].sequence).toBe(0);
    expect(trace.steps[1].decisionCode).toBe('SELECT_MODEL');
  });

  test('an ExecutionMetadata can be constructed to the contract (all optional)', () => {
    const empty: ExecutionMetadata = {};
    expect(empty).toEqual({});
    const full: ExecutionMetadata = {
      executionProfileKey: 'BALANCED',
      profileVersion: 1,
      configFingerprint: 'sha256:v1:9dbba7cc97a50e79c8bd4bde455514865dad37c3d0ab7601025eb980ffc92910',
      executionSchemaVersion: EXECUTION_SCHEMA_VERSION,
      canonicalizationVersion: CANONICALIZATION_VERSION,
      fingerprintAlgorithm: FINGERPRINT_ALGORITHM,
      fingerprintAlgoLegacy: CONFIG_FINGERPRINT_ALGO,
      resolutionSource: 'platform_default',
      resolutionDecisionCode: 'SELECT_PROFILE',
      resolutionReasonCode: 'PLATFORM_DEFAULT_APPLIED',
      resolutionReasonCategory: 'PlatformDefault',
      resolutionTrace: { steps: [] },
    };
    expect(full.fingerprintAlgorithm).toBe('sha256');
    expect(full.fingerprintAlgoLegacy).toBe('sha256:v1');
  });
});
