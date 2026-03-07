/**
 * Unit tests for Prompt Compiler
 */
import {
  compilePrompt,
  SYSTEM_TEMPLATE,
  FORMAT_RULES,
  buildCampaignContextBlock,
} from '../../prompts/promptCompiler';
import type { CampaignContext } from '../../services/contextCompressionService';

describe('promptCompiler', () => {
  describe('compilePrompt', () => {
    it('compiled prompt contains system block', () => {
      const result = compilePrompt({
        system: 'You are a test strategist.',
        context: 'Campaign: Test',
        task: 'Do the task.',
      });
      expect(result).toContain('SYSTEM');
      expect(result).toContain('You are a test strategist.');
    });

    it('compiled prompt contains context block', () => {
      const result = compilePrompt({
        system: 'You are a strategist.',
        context: 'Campaign topic: Launch\nTone: professional',
        task: 'Generate plan.',
      });
      expect(result).toContain('CONTEXT');
      expect(result).toContain('Campaign topic: Launch');
      expect(result).toContain('Tone: professional');
    });

    it('compiled prompt contains task block', () => {
      const result = compilePrompt({
        system: 'You are a strategist.',
        context: 'Some context',
        task: 'Generate 5 strategic themes.',
      });
      expect(result).toContain('TASK');
      expect(result).toContain('Generate 5 strategic themes.');
    });

    it('compiled prompt contains rules block with default FORMAT_RULES', () => {
      const result = compilePrompt({
        system: 'You are a strategist.',
        context: 'Context',
        task: 'Task',
      });
      expect(result).toContain('RULES');
      expect(result).toContain('Output must be structured and deterministic');
      expect(result).toContain('Avoid unnecessary explanations');
    });

    it('uses custom formatRules when provided', () => {
      const result = compilePrompt({
        system: 'You are a strategist.',
        context: 'Context',
        task: 'Task',
        formatRules: 'Output JSON only.',
      });
      expect(result).toContain('Output JSON only.');
      expect(result).not.toContain('Avoid unnecessary explanations');
    });

    it('uses SYSTEM_TEMPLATE when system is omitted', () => {
      const result = compilePrompt({
        context: 'Context',
        task: 'Task',
      });
      expect(result).toContain('You are an expert AI marketing strategist');
      expect(result).toContain('Maintain the campaign tone');
    });

    it('produces deterministic output for same input', () => {
      const input = {
        system: 'You are a test.',
        context: 'Test context',
        task: 'Test task',
      };
      const a = compilePrompt(input);
      const b = compilePrompt(input);
      expect(a).toBe(b);
    });

    it('output has expected structure order: SYSTEM, CONTEXT, RULES, TASK', () => {
      const result = compilePrompt({
        system: 'S',
        context: 'C',
        task: 'T',
      });
      const systemIdx = result.indexOf('SYSTEM');
      const contextIdx = result.indexOf('CONTEXT');
      const rulesIdx = result.indexOf('RULES');
      const taskIdx = result.indexOf('TASK');
      expect(systemIdx).toBeLessThan(contextIdx);
      expect(contextIdx).toBeLessThan(rulesIdx);
      expect(rulesIdx).toBeLessThan(taskIdx);
    });
  });

  describe('buildCampaignContextBlock', () => {
    it('includes topic and tone', () => {
      const context: CampaignContext = {
        topic: 'Product launch',
        tone: 'conversational',
        themes: [],
        top_platforms: [],
        top_content_types: [],
      };
      const block = buildCampaignContextBlock(context);
      expect(block).toContain('Product launch');
      expect(block).toContain('conversational');
    });

    it('includes themes when present', () => {
      const context: CampaignContext = {
        topic: 'X',
        tone: 'professional',
        themes: ['Lead gen', 'Authority'],
        top_platforms: ['linkedin'],
        top_content_types: ['post'],
      };
      const block = buildCampaignContextBlock(context);
      expect(block).toContain('Lead gen');
      expect(block).toContain('Authority');
      expect(block).toContain('linkedin');
      expect(block).toContain('post');
    });

    it('uses fallbacks when arrays are empty', () => {
      const context: CampaignContext = {
        topic: 'X',
        tone: 'professional',
        themes: [],
        top_platforms: [],
        top_content_types: [],
      };
      const block = buildCampaignContextBlock(context);
      expect(block).toContain('(Derive from topic)');
      expect(block).toContain('linkedin, x');
      expect(block).toContain('post, video, article');
    });
  });
});
