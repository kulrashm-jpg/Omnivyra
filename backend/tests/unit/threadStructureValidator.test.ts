import { validateThreadStructure } from '../../../lib/shared/threadStructureValidator';
import { evaluateGenerationAcceptance } from '../../../lib/shared/generationAcceptanceEvaluator';

describe('threadStructureValidator', () => {
  it('approves a structured thread with hook, progression, conclusion, and CTA', () => {
    const content = [
      '1/ Most campaign teams do not need more AI insights. They need a clearer decision for each insight.',
      '',
      '2/ First, name the decision before opening the dashboard. Budget, audience, message, or timing each need different evidence.',
      '',
      '3/ Next, compare only the signals that can change that decision. This keeps the thread of analysis practical.',
      '',
      '4/ Then turn the signal into one action and review whether the action improved the next campaign outcome.',
      '',
      '5/ Bottom line: AI insights become useful when every signal has an owner, a decision, and a next step. Reply with the step you would fix first.',
    ].join('\n');

    const result = validateThreadStructure({
      title: 'How Campaign Teams Should Use AI Insights',
      content,
      logicalContentType: 'thread',
      phase: 'generation',
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe('approved');
    expect(result?.score).toBeGreaterThanOrEqual(85);
  });

  it('flags thread content that is collapsed into one paragraph', () => {
    const result = validateThreadStructure({
      content: '1/ Start with the actual decision 2/ Pick the signal that can change it 3/ Turn the signal into one action 4/ Reply with the step you would fix first',
      logicalContentType: 'thread',
      phase: 'variant_generation',
    });

    const failedIds = result?.checks.filter((check) => !check.passed).map((check) => check.id) ?? [];
    expect(result?.status).toBe('repair_required');
    expect(failedIds).toContain('thread.collapsed_thread_structure');
  });

  it('flags marker-only threads with missing progression', () => {
    const result = validateThreadStructure({
      content: ['1.', '2.', '3.'].join('\n'),
      logicalContentType: 'thread',
      phase: 'generation',
    });

    const failedIds = result?.checks.filter((check) => !check.passed).map((check) => check.id) ?? [];
    expect(result?.status).toBe('repair_required');
    expect(failedIds).toContain('thread.opening_hook_present');
    expect(failedIds).toContain('thread.numbering_continuity');
    expect(failedIds).toContain('thread.sequential_progression');
  });

  it('flags a single generic post disguised as a thread', () => {
    const result = validateThreadStructure({
      content: 'AI insights help campaign teams make better decisions. Start by reviewing your data and taking action.',
      logicalContentType: 'thread',
      phase: 'scheduling',
    });

    const failedIds = result?.checks.filter((check) => !check.passed).map((check) => check.id) ?? [];
    expect(result?.status).toBe('repair_required');
    expect(failedIds).toContain('thread.generic_post_rendering');
    expect(failedIds).toContain('thread.single_post_disguised_as_thread');
  });

  it('does not run for non-thread content types', () => {
    const result = validateThreadStructure({
      content: 'A normal social post.',
      logicalContentType: 'post',
      phase: 'generation',
    });

    expect(result).toBeNull();
  });

  it('feeds thread defects into generation acceptance without enforcement', () => {
    const thread = validateThreadStructure({
      content: '1/ Hook 2/ Same idea 3/ Same idea',
      logicalContentType: 'thread',
      phase: 'variant_generation',
    });
    const readiness = evaluateGenerationAcceptance({
      content: '1/ Hook 2/ Same idea 3/ Same idea',
      logicalContentType: 'thread',
      publishContentType: 'post',
      phase: 'variant_generation',
      editorGradeResults: [thread],
    });

    expect(readiness.editor_grade_status).toBe('repair_required');
    expect(readiness.failing_checks).toContain('thread.collapsed_thread_structure');
    expect(readiness.representation_warnings).toContain('acceptance.logical_content_type_match');
    expect(readiness.recommended_actions).toContain('Repair thread structure before treating content as editor-grade.');
  });
});
