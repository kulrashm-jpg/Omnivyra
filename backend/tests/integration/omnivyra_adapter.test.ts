import { getOmniVyraAdvisory } from '../../services/omnivyraAdapterService';

describe('OmniVyra adapter', () => {
  beforeEach(() => {
    process.env.OMNIVYRA_BASE_URL = 'https://omnivyra.test';
  });

  afterEach(() => {
    delete process.env.USE_OMNIVYRA;
  });

  it('returns placeholder advisory when OmniVyra disabled', async () => {
    const advisory = await getOmniVyraAdvisory({ recommendation: '' });
    expect(advisory.source).toBe('placeholder');
  });

  it('returns advisory from OmniVyra when enabled', async () => {
    process.env.USE_OMNIVYRA = 'true';
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          decision_id: 'dec-1',
          confidence: 0.7,
          placeholders: [],
          explanation: 'Explain intent',
          contract_version: 'v1',
          data: { notes: 'Use short form', timing: '09:00', format: 'text', hashtags: ['#viral'] },
        }),
    });
    const advisory = await getOmniVyraAdvisory({ recommendation: 'Use short form' });
    expect(advisory.source).toBe('omnivyra');
    expect(advisory.notes).toContain('Use short form');
    expect(advisory.hashtags).toContain('#viral');
  });
});
