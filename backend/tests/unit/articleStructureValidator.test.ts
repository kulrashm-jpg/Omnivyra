import { validateArticleStructure } from '../../../lib/shared/articleStructureValidator';
import { evaluateGenerationAcceptance } from '../../../lib/shared/generationAcceptanceEvaluator';

describe('articleStructureValidator', () => {
  it('approves a structured article with intro, sections, list, and conclusion', () => {
    const content = [
      'INTRO',
      'AI insights become useful when teams connect each signal to a real campaign decision. Without that decision context, the same report can create motion without improving judgment.',
      '',
      'THE MISREAD',
      'Teams often compare metrics before agreeing on the decision those metrics should inform. That creates debates about dashboards instead of clarity about budget, message, audience, or channel choices.',
      '',
      'THE FIX',
      '- Name the decision first',
      '- Choose the smallest useful signal',
      '- Review whether the action improved the outcome',
      '',
      'CONCLUSION',
      'The value of AI insights rises when every signal has an owner, a decision, and a next action. That is what turns analysis into execution discipline.',
    ].join('\n');

    const result = validateArticleStructure({
      title: 'Why Campaign Teams Misread AI Insights',
      content,
      logicalContentType: 'article',
      phase: 'generation',
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe('approved');
    expect(result?.score).toBeGreaterThanOrEqual(85);
  });

  it('flags article content that is collapsed into one paragraph', () => {
    const content = 'INTRO AI insights become useful when teams connect each signal to a real campaign decision. THE MISREAD Teams compare metrics before agreeing on the decision those metrics should inform. THE FIX Name the decision first, choose the smallest useful signal, and review whether the action improved the outcome. CONCLUSION The value rises when every signal has an owner, a decision, and a next action.';

    const result = validateArticleStructure({
      content,
      logicalContentType: 'article',
      phase: 'variant_generation',
    });

    const failedIds = result?.checks.filter((check) => !check.passed).map((check) => check.id) ?? [];
    expect(result?.status).toBe('repair_required');
    expect(failedIds).toContain('article.collapsed_article_structure');
  });

  it('flags a generic short post rendered as an article', () => {
    const result = validateArticleStructure({
      content: 'AI insights help campaign teams make better decisions. Start by reviewing your data and taking action.',
      logicalContentType: 'article',
      phase: 'generation',
    });

    const failedIds = result?.checks.filter((check) => !check.passed).map((check) => check.id) ?? [];
    expect(result?.status).toBe('repair_required');
    expect(failedIds).toContain('article.generic_post_rendering');
    expect(failedIds).toContain('article.section_count_minimum');
  });

  it('does not run for non-article content types', () => {
    const result = validateArticleStructure({
      content: 'A normal social post.',
      logicalContentType: 'post',
      phase: 'generation',
    });

    expect(result).toBeNull();
  });

  it('feeds article defects into generation acceptance without enforcement', () => {
    const article = validateArticleStructure({
      content: 'AI insights help campaign teams make better decisions. Start by reviewing your data and taking action.',
      logicalContentType: 'article',
      phase: 'variant_generation',
    });
    const readiness = evaluateGenerationAcceptance({
      content: 'AI insights help campaign teams make better decisions. Start by reviewing your data and taking action.',
      logicalContentType: 'article',
      publishContentType: 'post',
      phase: 'variant_generation',
      editorGradeResults: [article],
    });

    expect(readiness.editor_grade_status).toBe('repair_required');
    expect(readiness.failing_checks).toContain('article.generic_post_rendering');
    expect(readiness.representation_warnings).toContain('acceptance.logical_content_type_match');
    expect(readiness.recommended_actions).toContain('Repair article structure before treating content as editor-grade.');
  });
});
