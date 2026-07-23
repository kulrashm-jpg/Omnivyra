/**
 * CONVERSATION-INTELLIGENCE-001 Phase D — multi-field chat extraction seam.
 *
 * Proves the seam REUSES the canonical machinery and never discards recoverable
 * knowledge:
 *   - one mocked answer yields MULTIPLE profile fields (not just the asked one);
 *   - partial answers populate every applicable field, discarding nothing;
 *   - persistence goes through the ONE write seam (saveProfile) with the merged
 *     fields — NO raw write, and field_confidence is merged over existing (not wiped);
 *   - an empty / non-recoverable answer writes nothing.
 *
 * The LLM completion is the only non-determinism → it is mocked. The prompt
 * construction, the zod validation, the field-merge, and the saveProfile call are
 * deterministic and are what is asserted here. No real model is ever called.
 */

jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: jest.fn(),
}));
jest.mock('../../services/companyProfileServiceRest1Rest2Pulse', () => ({
  saveProfile: jest.fn(),
}));

import { runCompletionWithOperation } from '../../services/aiGateway';
import { saveProfile } from '../../services/companyProfileServiceRest1Rest2Pulse';
import {
  extractProfileKnowledgeFromMessage,
  extractAndPersistProfileKnowledge,
  mapExtractionToProfileFields,
} from '../../services/companyProfile/chatKnowledgeExtraction';
import { buildExtractionWithDefaults } from '../../services/companyProfile/extractionSchema';
import type { CompanyProfile } from '../../services/companyProfile/types';

const F = (value: unknown, confidence: 'High' | 'Medium' | 'Low' = 'High', source = 'inferred') => ({
  value,
  source,
  confidence,
});

const setModel = (payload: Record<string, unknown>) =>
  (runCompletionWithOperation as jest.Mock).mockResolvedValue({ output: JSON.stringify(payload) });

beforeEach(() => jest.clearAllMocks());

describe('Phase D — multi-field extraction from ONE answer', () => {
  test('a single answer yields MULTIPLE profile fields, not just the asked one', async () => {
    // The interviewer asked only about target audience, but the answer reveals
    // products, industry, geography and audience all at once.
    setModel({
      products_services: F('Retail analytics dashboards'),
      industry: F(['Software']),
      geography: F(['United States']),
      target_audience: F('Retail operations leaders'),
    });

    const { fields } = await extractProfileKnowledgeFromMessage({
      companyId: 'acme',
      message: 'We sell retail analytics dashboards to retail ops leaders across the US.',
      questionAsked: 'Who is your target audience?',
      profile: null,
    });

    expect(fields.products_services).toBe('Retail analytics dashboards');
    expect(fields.industry).toBe('Software');
    expect(fields.geography).toBe('United States');
    expect(fields.target_audience).toBe('Retail operations leaders');
    // more than the single asked field was captured
    expect(Object.keys(fields).filter((k) => k !== 'field_confidence').length).toBeGreaterThan(1);
  });

  test('reuses the gateway completion path with the shared extraction operation', async () => {
    setModel({ products_services: F('Analytics') });
    await extractProfileKnowledgeFromMessage({
      companyId: 'acme',
      message: 'We build analytics.',
      questionAsked: null,
      profile: null,
    });
    expect(runCompletionWithOperation as jest.Mock).toHaveBeenCalledTimes(1);
    const callArg = (runCompletionWithOperation as jest.Mock).mock.calls[0][0];
    expect(callArg.operation).toBe('profileExtraction');
    expect(callArg.temperature).toBe(0);
    expect(callArg.response_format).toEqual({ type: 'json_object' });
    // the user's answer is carried into the (reused) extraction prompt as evidence
    expect(callArg.messages[1].content).toContain('We build analytics.');
  });

  test('empty message → no model call, no fields', async () => {
    const { fields } = await extractProfileKnowledgeFromMessage({
      companyId: 'acme',
      message: '   ',
      profile: null,
    });
    expect(fields).toEqual({});
    expect(runCompletionWithOperation as jest.Mock).not.toHaveBeenCalled();
  });
});

describe('Phase D — partial answers populate every applicable field, discard nothing', () => {
  test('present fields map; missing fields are absent (never fabricated)', () => {
    const extraction = buildExtractionWithDefaults({
      products_services: F('Analytics'),
      unique_value_proposition: F('Real-time'),
      // everything else missing
      industry: { value: null, source: 'missing', confidence: 'Low' },
    });
    const fields = mapExtractionToProfileFields(extraction, null);
    expect(fields.products_services).toBe('Analytics');
    expect(fields.unique_value).toBe('Real-time');
    expect(fields).not.toHaveProperty('industry');
    expect(fields).not.toHaveProperty('target_audience');
  });

  test('field_confidence is MERGED over existing, never wiped', () => {
    const existing = {
      company_id: 'acme',
      field_confidence: { name: 'High', website_url: 'High' },
    } as unknown as CompanyProfile;
    const extraction = buildExtractionWithDefaults({ products_services: F('Analytics', 'Medium') });
    const fields = mapExtractionToProfileFields(extraction, existing);
    const fc = fields.field_confidence as Record<string, string>;
    // pre-existing bands preserved
    expect(fc.name).toBe('High');
    expect(fc.website_url).toBe('High');
    // new band added under the canonical key the knowledge graph reads
    expect(fc.products_services).toBe('Medium');
  });

  test('nothing recoverable → empty fields, no field_confidence key', () => {
    const extraction = buildExtractionWithDefaults({});
    expect(mapExtractionToProfileFields(extraction, null)).toEqual({});
  });
});

describe('Phase D — persist through the ONE write seam (saveProfile), no raw write', () => {
  test('extracted fields go through saveProfile with the merged payload + source user', async () => {
    setModel({
      products_services: F('Analytics'),
      target_audience: F('Retailers'),
    });
    (saveProfile as jest.Mock).mockImplementation(async (input) => ({ ...input }));

    const { persisted, savedProfile } = await extractAndPersistProfileKnowledge({
      companyId: 'acme',
      message: 'We sell analytics to retailers.',
      profile: null,
    });

    expect(persisted).toBe(true);
    expect(saveProfile as jest.Mock).toHaveBeenCalledTimes(1);
    const [input, options] = (saveProfile as jest.Mock).mock.calls[0];
    expect(input.company_id).toBe('acme');
    expect(input.products_services).toBe('Analytics');
    expect(input.target_audience).toBe('Retailers');
    expect(options).toEqual({ source: 'user' });
    expect(savedProfile?.products_services).toBe('Analytics');
  });

  test('no recoverable field → saveProfile is NOT called (nothing persisted)', async () => {
    setModel({}); // model returned nothing usable
    const { persisted } = await extractAndPersistProfileKnowledge({
      companyId: 'acme',
      message: 'hmm not sure',
      profile: null,
    });
    expect(persisted).toBe(false);
    expect(saveProfile as jest.Mock).not.toHaveBeenCalled();
  });
});
