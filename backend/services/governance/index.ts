/**
 * RELEASE-R3D — Governance Runtime Consumers (public barrel).
 *
 * Optional, feature-flagged, invoke-only consumers of the FROZEN Governance
 * Runtime v1.0.0. Nothing here imports runtime internals, duplicates governance
 * logic, or modifies any frozen artifact. The default state is OFF; standard AI
 * requests are unaffected. Independently removable.
 */
export {
  invokeGovernanceRuntime,
  checkCompatibility,
  GovernanceConsumerError,
  CONSUMER_VERSION,
  SUPPORTED_RUNTIME,
  GOVERNANCE_ADMISSION_ENTRYPOINT,
  type GovernanceInvocation,
  type GovernanceInvokeOptions,
  type GovernanceResponse,
  type GovernanceConsumerErrorCode,
  type CompatibilityReport,
  type RuntimeInvoker,
} from './governanceRuntimeConsumer';

export {
  GOVERNANCE_ADMISSION_FLAG,
  GOVERNANCE_DESIGNATED_OPERATIONS,
  isGovernanceDesignated,
  resolveGovernanceAdmissionMode,
  describeGovernanceFlagState,
  type GovernanceFlagState,
} from './governanceAdmissionFlags';

export {
  recordGovernanceDiagnostic,
  getGovernanceObservabilitySnapshot,
  resetGovernanceDiagnostics,
  type GovernanceDiagnostic,
  type InvocationOutcome,
  type GovernanceObservabilitySnapshot,
} from './governanceConsumerDiagnostics';

export {
  evaluateAdmission,
  enforceAdmission,
  getAdmissionHealth,
  GovernanceAdmissionDenied,
  type AdmissionContext,
  type AdmissionResult,
} from './governanceAdmissionAdapter';
