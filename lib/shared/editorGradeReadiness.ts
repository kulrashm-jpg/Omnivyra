export const EDITOR_GRADE_CONTRACT_VERSION = '2026-06-14.foundation.v1' as const;

export type EditorGradeStatus = 'approved' | 'repair_required' | 'rejected';

export type EditorGradePhase =
  | 'planner'
  | 'generation'
  | 'refinement'
  | 'validation'
  | 'variant_generation'
  | 'scheduling'
  | 'publishing';

export type CalibratedEditorGradeSeverity =
  | 'informational'
  | 'minor'
  | 'important'
  | 'critical'
  | 'blocking';

export type EditorGradeSeverity = CalibratedEditorGradeSeverity | 'info' | 'warning';

export type EditorGradeCheck = {
  id: string;
  phase: EditorGradePhase;
  passed: boolean;
  severity: EditorGradeSeverity;
  message?: string;
  score?: number;
  metadata?: Record<string, unknown>;
};

export type EditorGradeResult = {
  contract_version: typeof EDITOR_GRADE_CONTRACT_VERSION;
  status: EditorGradeStatus;
  checks: EditorGradeCheck[];
  score: number;
  reasons: string[];
};

export type EditorGradeResultInput = {
  status?: EditorGradeStatus;
  checks?: EditorGradeCheck[];
  score?: number;
  reasons?: string[];
};

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function normalizeEditorGradeSeverity(severity: EditorGradeSeverity): CalibratedEditorGradeSeverity {
  if (severity === 'info') return 'informational';
  if (severity === 'warning') return 'minor';
  return severity;
}

export function isRepairSeverity(severity: EditorGradeSeverity): boolean {
  const normalized = normalizeEditorGradeSeverity(severity);
  return normalized === 'critical' || normalized === 'important';
}

export function isBlockingSeverity(severity: EditorGradeSeverity): boolean {
  return normalizeEditorGradeSeverity(severity) === 'blocking';
}

function deriveStatus(checks: EditorGradeCheck[], explicit?: EditorGradeStatus): EditorGradeStatus {
  if (explicit) return explicit;
  if (checks.some((check) => !check.passed && isBlockingSeverity(check.severity))) return 'rejected';
  if (checks.some((check) => !check.passed && isRepairSeverity(check.severity))) return 'repair_required';
  return 'approved';
}

function fallbackScoreForCheck(check: EditorGradeCheck): number {
  if (check.passed) return 100;
  switch (normalizeEditorGradeSeverity(check.severity)) {
    case 'blocking':
      return 0;
    case 'critical':
      return 25;
    case 'important':
      return 65;
    case 'minor':
      return 85;
    case 'informational':
      return 100;
  }
}

function deriveScore(checks: EditorGradeCheck[], explicit?: number): number {
  if (typeof explicit === 'number') return clampScore(explicit);
  if (checks.length === 0) return 100;

  const total = checks.reduce((sum, check) => {
    if (typeof check.score === 'number') return sum + clampScore(check.score);
    return sum + fallbackScoreForCheck(check);
  }, 0);

  return clampScore(total / checks.length);
}

export function createEditorGradeResult(input: EditorGradeResultInput = {}): EditorGradeResult {
  const checks = input.checks ?? [];
  const status = deriveStatus(checks, input.status);
  const score = deriveScore(checks, input.score);
  const checkReasons = checks
    .filter((check) => !check.passed)
    .map((check) => check.message || check.id);

  return {
    contract_version: EDITOR_GRADE_CONTRACT_VERSION,
    status,
    checks,
    score,
    reasons: [...(input.reasons ?? []), ...checkReasons],
  };
}

export function isEditorGradeApproved(result: EditorGradeResult | null | undefined): boolean {
  return result?.status === 'approved';
}

export function mergeEditorGradeResults(results: EditorGradeResult[]): EditorGradeResult {
  const checks = results.flatMap((result) => result.checks);
  const reasons = results.flatMap((result) => result.reasons);
  const score = results.length
    ? clampScore(results.reduce((sum, result) => sum + result.score, 0) / results.length)
    : 100;

  return createEditorGradeResult({
    status: results.some((result) => result.status === 'rejected') ? 'rejected' : undefined,
    checks,
    score,
    reasons,
  });
}
