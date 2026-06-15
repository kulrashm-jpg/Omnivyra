import { createEditorGradeResult } from '../../../lib/shared/editorGradeReadiness';
import { evaluateGenerationAcceptance } from '../../../lib/shared/generationAcceptanceEvaluator';

function approvedQualityResult() {
  return createEditorGradeResult({
    checks: [{
      id: 'test.quality_pass',
      phase: 'variant_generation',
      passed: true,
      severity: 'informational',
      score: 100,
    }],
  });
}

describe('generationAcceptanceEvaluator scoring calibration', () => {
  it('does not penalize a valid poll represented as a publishing post', () => {
    const result = evaluateGenerationAcceptance({
      content: 'Which bottleneck should teams fix first?\n\n1 Reporting\n2 Attribution\n3 Reviews\n\nVote below.',
      logicalContentType: 'poll',
      publishContentType: 'post',
      phase: 'variant_generation',
      editorGradeResults: [approvedQualityResult()],
    });

    expect(result.editor_grade_status).toBe('approved');
    expect(result.editor_grade_score).toBe(100);
    expect(result.warnings).not.toContain('acceptance.logical_content_type_match');
    expect(result.representation_warnings).toContain('acceptance.logical_content_type_match');
  });

  it('does not penalize a valid thread represented as a publishing post', () => {
    const result = evaluateGenerationAcceptance({
      content: '1/ Start with the decision.\n\n2/ Attach one signal.\n\n3/ Review the result.',
      logicalContentType: 'thread',
      publishContentType: 'post',
      phase: 'variant_generation',
      editorGradeResults: [approvedQualityResult()],
    });

    expect(result.editor_grade_status).toBe('approved');
    expect(result.editor_grade_score).toBe(100);
    expect(result.warnings).toEqual([]);
    expect(result.representation_warnings).toContain('acceptance.logical_content_type_match');
  });

  it('still rejects placeholder content even when representation is expected', () => {
    const result = evaluateGenerationAcceptance({
      content: '[PLATFORM ADAPTATION FAILED]\nBased on master content.',
      logicalContentType: 'thread',
      publishContentType: 'post',
      phase: 'variant_generation',
      editorGradeResults: [approvedQualityResult()],
    });

    expect(result.editor_grade_status).toBe('rejected');
    expect(result.failing_checks).toContain('acceptance.placeholder_content');
    expect(result.representation_warnings).toContain('acceptance.logical_content_type_match');
  });

  it('reports unexpected representation separately without damaging content readiness', () => {
    const result = evaluateGenerationAcceptance({
      content: 'A concise campaign post with a clear next action.',
      logicalContentType: 'poll',
      publishContentType: 'newsletter',
      phase: 'variant_generation',
      editorGradeResults: [approvedQualityResult()],
    });

    expect(result.editor_grade_status).toBe('approved');
    expect(result.editor_grade_score).toBe(100);
    expect(result.warnings).toEqual([]);
    expect(result.representation_warnings).toContain('acceptance.logical_content_type_match');
  });

  it('keeps minor-only observations approved without capping score at 84', () => {
    const result = evaluateGenerationAcceptance({
      content: 'Which bottleneck should teams fix first?\n\n1 Reporting\n2 Attribution\n3 Reviews\n\nVote below.',
      logicalContentType: 'poll',
      publishContentType: 'post',
      phase: 'variant_generation',
      editorGradeResults: [
        createEditorGradeResult({
          checks: [{
            id: 'poll.closing_present',
            phase: 'variant_generation',
            passed: false,
            severity: 'minor',
            score: 92,
          }],
        }),
      ],
    });

    expect(result.editor_grade_status).toBe('approved');
    expect(result.editor_grade_score).toBeGreaterThan(84);
    expect(result.warnings).toContain('poll.closing_present');
    expect(result.failing_checks).toEqual([]);
    expect(result.recommended_actions).toContain('Content is currently editor-grade by calibrated checks.');
  });

  it('keeps planner topic mismatch as a minor score-only observation', () => {
    const result = evaluateGenerationAcceptance({
      content: 'Frame 1: The dashboard looked busy, but the decision was still unclear.',
      logicalContentType: 'story',
      publishContentType: 'post',
      phase: 'variant_generation',
      editorGradeResults: [
        createEditorGradeResult({
          checks: [{
            id: 'planner_title.topic_mismatch',
            phase: 'planner',
            passed: false,
            severity: 'minor',
            score: 96,
          }],
        }),
      ],
    });

    expect(result.editor_grade_status).toBe('approved');
    expect(result.editor_grade_score).toBe(98);
    expect(result.warnings).toContain('planner_title.topic_mismatch');
  });

  it('marks important failures as repair_required without blanket 84 score cap', () => {
    const result = evaluateGenerationAcceptance({
      content: 'Which bottleneck should teams fix first?\n\n1 Reporting\n2 Attribution\n\nVote below.',
      logicalContentType: 'poll',
      publishContentType: 'post',
      phase: 'variant_generation',
      editorGradeResults: [
        createEditorGradeResult({
          checks: [{
            id: 'poll.option_count_minimum',
            phase: 'variant_generation',
            passed: false,
            severity: 'important',
            score: 90,
          }],
        }),
      ],
    });

    expect(result.editor_grade_status).toBe('repair_required');
    expect(result.editor_grade_score).toBeGreaterThan(84);
    expect(result.failing_checks).toContain('poll.option_count_minimum');
  });

  it('marks critical failures as repair_required', () => {
    const result = evaluateGenerationAcceptance({
      content: 'Question 1 Option A 2 Option B 3 Option C',
      logicalContentType: 'poll',
      publishContentType: 'post',
      phase: 'variant_generation',
      editorGradeResults: [
        createEditorGradeResult({
          checks: [{
            id: 'poll.collapsed_poll_structure',
            phase: 'variant_generation',
            passed: false,
            severity: 'critical',
            score: 55,
          }],
        }),
      ],
    });

    expect(result.editor_grade_status).toBe('repair_required');
    expect(result.failing_checks).toContain('poll.collapsed_poll_structure');
  });
});
