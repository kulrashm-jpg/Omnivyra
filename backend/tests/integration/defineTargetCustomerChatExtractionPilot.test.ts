/**
 * CONVERSATION-INTELLIGENCE-001 Phase D — pilot route wiring (chat extraction).
 *
 * Proves the flag-gated adoption of the multi-field chat extraction seam on
 * /api/company-profile/define-target-customer:
 *   - flag OFF (default) → BYTE-IDENTICAL to before: the user's answer is NEVER
 *     extracted (the seam is not even invoked) and the response is exactly the
 *     AI-emitted nextQuestion.
 *   - flag ON → the user's latest answer is extracted + persisted through the
 *     seam (which persists via saveProfile), and the refreshed profile is used
 *     downstream. The response shape is unchanged.
 *   - the seam is only invoked when there is a user answer to extract.
 *
 * The extraction seam is mocked at its module boundary (its internals are proven
 * in chatKnowledgeExtraction.test.ts); this file asserts only the ROUTE wiring
 * (flag gating + argument plumbing + OFF parity).
 */
import handler from '../../../pages/api/company-profile/define-target-customer';
import { createApiRequestMock, createMockRes } from '../utils';
import type { CompanyProfile } from '../../services/companyProfile/types';

const MODE_ENV = 'ROLLOUT_PROFILE_CHAT_EXTRACTION_MODE';

jest.mock('../../services/contentArchitectService', () => ({
  resolveCompanyAccess: jest.fn().mockResolvedValue({ userId: 'user-1', role: 'SUPER_ADMIN' }),
}));
jest.mock('../../services/context/canonicalProfileAdapter', () => ({
  getCanonicalProfile: jest.fn(),
}));
jest.mock('../../services/aiGateway', () => ({
  runCompletion: jest.fn(),
}));
jest.mock('../../services/companyProfile/chatKnowledgeExtraction', () => ({
  extractAndPersistProfileKnowledge: jest.fn(),
}));

import { getCanonicalProfile } from '../../services/context/canonicalProfileAdapter';
import { runCompletion } from '../../services/aiGateway';
import { extractAndPersistProfileKnowledge } from '../../services/companyProfile/chatKnowledgeExtraction';

const PROFILE: CompanyProfile = {
  company_id: 'acme',
  products_services: 'Retail analytics dashboards',
  field_confidence: { products_services: 'High' },
} as CompanyProfile;

const setAi = (payload: Record<string, unknown>) =>
  (runCompletion as jest.Mock).mockResolvedValue({ output: JSON.stringify(payload) });

const run = async (body: Record<string, unknown> = {}) => {
  (getCanonicalProfile as jest.Mock).mockResolvedValue(PROFILE);
  const req = createApiRequestMock({ method: 'POST', companyId: 'acme', body });
  const res = createMockRes();
  await handler(req, res);
  return res;
};

// A conversation containing a user answer (so there IS something to extract).
const CONVERSATION = [
  { role: 'assistant', content: 'Who is your target audience?' },
  { role: 'user', content: 'We serve retail ops leaders across the US.' },
];

describe('define-target-customer pilot — chat extraction flag', () => {
  const original = process.env[MODE_ENV];
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env[MODE_ENV];
    (extractAndPersistProfileKnowledge as jest.Mock).mockResolvedValue({
      result: { extraction: {}, fields: {} },
      savedProfile: PROFILE,
      persisted: false,
    });
  });
  afterAll(() => {
    if (original === undefined) delete process.env[MODE_ENV];
    else process.env[MODE_ENV] = original;
  });

  test('flag OFF (default): the extraction seam is NEVER invoked (byte-identical)', async () => {
    setAi({ nextQuestion: 'What is your website address?' });
    const res = await run({ conversation: CONVERSATION });
    expect(res.statusCode).toBe(200);
    // byte-identical: exactly the AI string, single key
    expect(res.body).toEqual({ nextQuestion: 'What is your website address?' });
    // the seam was not even called
    expect(extractAndPersistProfileKnowledge as jest.Mock).not.toHaveBeenCalled();
    // no profile reload beyond the single legacy read
    expect(getCanonicalProfile as jest.Mock).toHaveBeenCalledTimes(1);
  });

  test('flag ON: the user answer is extracted + persisted through the seam', async () => {
    process.env[MODE_ENV] = 'enforce';
    setAi({ nextQuestion: 'What is your website address?' });
    const res = await run({ conversation: CONVERSATION });
    expect(res.statusCode).toBe(200);
    expect(extractAndPersistProfileKnowledge as jest.Mock).toHaveBeenCalledTimes(1);
    const arg = (extractAndPersistProfileKnowledge as jest.Mock).mock.calls[0][0];
    expect(arg.companyId).toBe('acme');
    expect(arg.message).toBe('We serve retail ops leaders across the US.');
    expect(arg.questionAsked).toBe('Who is your target audience?');
    // response shape unchanged (question governance is a separate flag/concern)
    expect(res.body).toEqual({ nextQuestion: 'What is your website address?' });
  });

  test('flag ON but no user answer yet → the seam is not invoked', async () => {
    process.env[MODE_ENV] = 'enforce';
    setAi({ nextQuestion: 'What is your company called?' });
    const res = await run({ conversation: [] });
    expect(res.statusCode).toBe(200);
    expect(extractAndPersistProfileKnowledge as jest.Mock).not.toHaveBeenCalled();
  });

  test('flag ON: seam error is fail-safe (conversation still returns a question)', async () => {
    process.env[MODE_ENV] = 'enforce';
    (extractAndPersistProfileKnowledge as jest.Mock).mockRejectedValue(new Error('extraction boom'));
    setAi({ nextQuestion: 'What is your website address?' });
    const res = await run({ conversation: CONVERSATION });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ nextQuestion: 'What is your website address?' });
  });
});
