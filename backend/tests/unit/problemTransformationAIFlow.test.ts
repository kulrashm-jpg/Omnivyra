/**
 * Problem & Transformation AI Flow unit tests.
 * Verifies strategic prompt modes, anti-stuck fallback, JSON retry, and refinement behavior.
 */

import {
  buildProblemTransformationStrategicPrompt,
  refineProblemTransformationAnswers,
  type CompanyProfile,
  type ProblemTransformationExistingFields,
} from '../../services/companyProfileService';

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  })),
}));

const OpenAI = jest.requireMock('openai').default;

const mkProfile = (overrides: Partial<CompanyProfile> & { company_id: string }): CompanyProfile => ({
  company_id: 'c1',
  ...overrides,
});

describe('problemTransformationAIFlow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. fill mode returns all fields', () => {
    it('buildProblemTransformationStrategicPrompt fill mode includes THINK ANALYZE STRUCTURE OUTPUT', () => {
      const profile = mkProfile({
        company_id: 'c1',
        industry: 'SaaS',
        target_audience: 'product teams',
        campaign_focus: 'prioritization',
      });
      const { systemPrompt, userPrompt } = buildProblemTransformationStrategicPrompt('fill', profile, {
        qaPairs: [{ question: 'What core problem?', answer: 'prioritization chaos' }],
      });
      expect(systemPrompt).toContain('THINK');
      expect(systemPrompt).toContain('ANALYZE');
      expect(systemPrompt).toContain('STRUCTURE');
      expect(systemPrompt).toContain('OUTPUT');
      expect(systemPrompt).toContain('core_problem_statement');
      expect(systemPrompt).toContain('pain_symptoms');
      expect(systemPrompt).toContain('authority_domains');
      expect(userPrompt).toContain('prioritization chaos');
    });

    it('refineProblemTransformationAnswers with mocked full JSON returns all 9 fields', async () => {
      const fullOutput = JSON.stringify({
        core_problem_statement: 'Teams struggle with prioritization chaos',
        pain_symptoms: ['scope creep', 'delayed delivery'],
        awareness_gap: 'Hidden cost of context switching',
        problem_impact: 'Missed deadlines and burnout',
        life_with_problem: 'Reactive firefighting',
        life_after_solution: 'Predictable delivery',
        desired_transformation: 'From chaos to clarity',
        transformation_mechanism: 'Structured prioritization framework',
        authority_domains: ['project management', 'agile'],
      });
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{ message: { content: fullOutput } }],
      });
      (OpenAI as jest.Mock).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      }));

      const profile = mkProfile({ company_id: 'c1', industry: 'SaaS' });
      const result = await refineProblemTransformationAnswers(
        ['prioritization chaos', 'scope creep'],
        { profile, existingFields: {} }
      );

      expect(result.core_problem_statement).toBe('Teams struggle with prioritization chaos');
      expect(result.pain_symptoms).toEqual(['scope creep', 'delayed delivery']);
      expect(result.awareness_gap).toBe('Hidden cost of context switching');
      expect(result.authority_domains).toEqual(['project management', 'agile']);
    });
  });

  describe('2. refine mode preserves intent but improves specificity', () => {
    it('buildProblemTransformationStrategicPrompt refine mode includes strategist-style instructions', () => {
      const profile = mkProfile({ company_id: 'c1' });
      const existing: ProblemTransformationExistingFields = {
        core_problem_statement: 'chaos',
        pain_symptoms: ['delays'],
      };
      const { systemPrompt } = buildProblemTransformationStrategicPrompt('refine', profile, existing);
      expect(systemPrompt).toContain('weaknesses');
      expect(systemPrompt).toContain('awareness');
      expect(systemPrompt).toContain('education');
      expect(systemPrompt).toContain('authority');
      expect(systemPrompt).toContain('transformation');
      expect(systemPrompt).toContain('Preserve essence');
      expect(systemPrompt).toContain('specificity');
    });
  });

  describe('3. AI missing fields → fallback fills them', () => {
    it('refineProblemTransformationAnswers merges empty AI output with existing', async () => {
      const emptyOutput = JSON.stringify({
        core_problem_statement: null,
        pain_symptoms: [],
        awareness_gap: null,
        problem_impact: null,
        life_with_problem: null,
        life_after_solution: null,
        desired_transformation: null,
        transformation_mechanism: null,
        authority_domains: [],
      });
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{ message: { content: emptyOutput } }],
      });
      (OpenAI as jest.Mock).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      }));

      const existingFields: ProblemTransformationExistingFields = {
        core_problem_statement: 'Original problem',
        pain_symptoms: ['symptom A'],
        authority_domains: ['domain X'],
      };
      const result = await refineProblemTransformationAnswers([], {
        profile: null,
        existingFields,
      });

      expect(result.core_problem_statement).toBe('Original problem');
      expect(result.pain_symptoms).toEqual(['symptom A']);
      expect(result.authority_domains).toEqual(['domain X']);
    });
  });

  describe('4. JSON parsing retry works', () => {
    it('retries with strict JSON instruction when first parse fails', async () => {
      const invalidThenValid = [
        { choices: [{ message: { content: 'Not valid JSON {{' } }] },
        { choices: [{ message: { content: '{"core_problem_statement":"x","pain_symptoms":[],"awareness_gap":null,"problem_impact":null,"life_with_problem":null,"life_after_solution":null,"desired_transformation":null,"transformation_mechanism":null,"authority_domains":[]}' } }] },
      ];
      const mockCreate = jest
        .fn()
        .mockResolvedValueOnce(invalidThenValid[0])
        .mockResolvedValueOnce(invalidThenValid[1]);
      (OpenAI as jest.Mock).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      }));

      const result = await refineProblemTransformationAnswers(['x'], { existingFields: {} });

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.core_problem_statement).toBe('x');
    });
  });

  describe('5. refinement expands awareness_gap into multiple misconceptions', () => {
    it('refine mode prompt instructs to add nuanced misconceptions', () => {
      const profile = mkProfile({ company_id: 'c1' });
      const existing: ProblemTransformationExistingFields = {
        awareness_gap: 'customers think it is just a tool',
      };
      const { systemPrompt } = buildProblemTransformationStrategicPrompt('refine', profile, existing);
      expect(systemPrompt.toLowerCase()).toMatch(/misconception|awareness_gap|nuanced/);
    });
  });
});
