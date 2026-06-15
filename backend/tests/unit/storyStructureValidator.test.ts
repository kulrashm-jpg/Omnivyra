import { validateStoryStructure } from '../../../lib/shared/storyStructureValidator';
import { evaluateGenerationAcceptance } from '../../../lib/shared/generationAcceptanceEvaluator';

describe('storyStructureValidator', () => {
  it('approves a specific story with setup, tension, progression, resolution, and payoff', () => {
    const content = [
      'Frame 1: Maya opened Monday campaign dashboard and saw reach climbing, but conversions slipping.',
      'Frame 2: Instead of celebrating, she asked which audience segment changed behavior after the launch.',
      'Frame 3: The team found one buyer group clicking without booking because the message promised speed but the landing page sold control.',
      'Frame 4: They shifted budget and rewrote the message before the next spend cycle.',
      'Frame 5: The takeaway: a useful signal changes the next decision, not just the report.',
    ].join('\n');

    const result = validateStoryStructure({
      title: 'The Missed Dashboard Signal',
      content,
      logicalContentType: 'story',
      phase: 'generation',
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe('approved');
    expect(result?.score).toBeGreaterThanOrEqual(85);
  });

  it('flags generic motivational story content', () => {
    const result = validateStoryStructure({
      content: ['One day everything changed.', 'Believe in yourself.', 'Keep going.'].join('\n'),
      logicalContentType: 'story',
      phase: 'variant_generation',
    });

    const failedIds = result?.checks.filter((check) => !check.passed).map((check) => check.id) ?? [];
    expect(result?.status).toBe('repair_required');
    expect(failedIds).toContain('story.generic_motivational_story');
    expect(failedIds).toContain('story.generic_inspirational_template');
    expect(failedIds).toContain('story.missing_specificity');
  });

  it('flags collapsed story frames', () => {
    const result = validateStoryStructure({
      content: 'Frame 1: Maya saw conversions slipping. Frame 2: She found the wrong audience segment. Frame 3: The team shifted budget and improved the next campaign.',
      logicalContentType: 'story',
      phase: 'generation',
    });

    const failedIds = result?.checks.filter((check) => !check.passed).map((check) => check.id) ?? [];
    expect(result?.status).toBe('repair_required');
    expect(failedIds).toContain('story.collapsed_story_structure');
  });

  it('runs for short_story logical content type', () => {
    const result = validateStoryStructure({
      content: 'Maya saw campaign conversions slipping. She found the audience mismatch. The team shifted budget and learned the next decision mattered.',
      logicalContentType: 'short_story',
      phase: 'generation',
    });

    expect(result).not.toBeNull();
  });

  it('does not run for non-story content types', () => {
    const result = validateStoryStructure({
      content: 'A normal social post.',
      logicalContentType: 'post',
      phase: 'generation',
    });

    expect(result).toBeNull();
  });

  it('feeds story defects into generation acceptance without enforcement', () => {
    const story = validateStoryStructure({
      content: 'One day everything changed. Believe in yourself. Keep going.',
      logicalContentType: 'story',
      phase: 'variant_generation',
    });
    const readiness = evaluateGenerationAcceptance({
      content: 'One day everything changed. Believe in yourself. Keep going.',
      logicalContentType: 'story',
      publishContentType: 'post',
      phase: 'variant_generation',
      editorGradeResults: [story],
    });

    expect(readiness.editor_grade_status).toBe('repair_required');
    expect(readiness.failing_checks).toContain('story.narrative_completeness');
    expect(readiness.recommended_actions).toContain('Repair story structure before treating content as editor-grade.');
  });
});
