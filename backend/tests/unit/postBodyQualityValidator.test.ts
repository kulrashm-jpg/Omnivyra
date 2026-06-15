import { validatePostBodyQuality } from '../../../lib/shared/postBodyQualityValidator';
import { evaluateGenerationAcceptance } from '../../../lib/shared/generationAcceptanceEvaluator';

describe('postBodyQualityValidator', () => {
  it('approves a specific, useful standard post body', () => {
    const content = [
      'AI campaign insights only help when they change a decision.',
      '',
      'Before reviewing the dashboard, name the choice you need to make: budget, audience, message, or channel. That constraint turns a broad report into a practical signal.',
      '',
      'Try this on your next campaign review: write the decision first, then keep only the 2 metrics that could change it.',
    ].join('\n');

    const result = validatePostBodyQuality({
      title: 'Make AI Campaign Insights Useful',
      content,
      logicalContentType: 'post',
      phase: 'generation',
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe('approved');
    expect(result?.score).toBeGreaterThanOrEqual(85);
  });

  it('flags generic, low-information post copy', () => {
    const content = 'In today\'s digital landscape, it is important to provide value and engage with your audience. Be consistent and stay authentic to drive growth.';

    const result = validatePostBodyQuality({
      content,
      logicalContentType: 'post',
      phase: 'variant_generation',
    });

    const failedIds = result?.checks.filter((check) => !check.passed).map((check) => check.id) ?? [];
    expect(result?.status).toBe('repair_required');
    expect(failedIds).toContain('post.generic_advice');
    expect(failedIds).toContain('post.missing_insight');
    expect(failedIds).toContain('post.shallow_content');
  });

  it('flags visible template content in a post body', () => {
    const result = validatePostBodyQuality({
      content: ['Hook: AI changes everything.', 'Body: Use data-driven decisions to boost engagement.', 'CTA: Let me know.'].join('\n\n'),
      logicalContentType: 'post',
      phase: 'generation',
    });

    const failedIds = result?.checks.filter((check) => !check.passed).map((check) => check.id) ?? [];
    expect(result?.status).toBe('repair_required');
    expect(failedIds).toContain('post.obvious_template_content');
  });

  it('does not run for non-post content types', () => {
    const result = validatePostBodyQuality({
      content: '1/ This is a thread opening.',
      logicalContentType: 'thread',
      phase: 'generation',
    });

    expect(result).toBeNull();
  });

  it('feeds post body defects into generation acceptance without enforcement', () => {
    const bodyQuality = validatePostBodyQuality({
      content: 'Provide value. Be consistent. Engage with your audience. Drive growth.',
      logicalContentType: 'post',
      phase: 'variant_generation',
    });
    const readiness = evaluateGenerationAcceptance({
      content: 'Provide value. Be consistent. Engage with your audience. Drive growth.',
      logicalContentType: 'post',
      publishContentType: 'post',
      phase: 'variant_generation',
      editorGradeResults: [bodyQuality],
    });

    expect(readiness.editor_grade_status).toBe('repair_required');
    expect(readiness.failing_checks).toContain('post.low_information_content');
    expect(readiness.recommended_actions).toContain('Review post body quality before treating content as editor-grade.');
  });
});
