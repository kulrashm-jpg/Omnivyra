jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

import { supabase } from '../../db/supabaseClient';
import { getPlatformRules, getPostingRequirements, listPlatformCatalog } from '../../services/platformIntelligenceService';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  const mock: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

describe('platformIntelligenceService (DB-driven with fallback)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('falls back when platform_master table is missing', async () => {
    (supabase.from as jest.Mock).mockImplementation(() =>
      chain({ data: null, error: { message: 'relation "platform_master" does not exist' } })
    );

    const bundle = await getPlatformRules('x');
    expect(bundle?.platform?.canonical_key).toBe('x');
    expect(Array.isArray(bundle?.content_rules)).toBe(true);
    expect(bundle?.content_rules?.length).toBeGreaterThan(0);
  });

  it('aliases twitter -> x for posting requirements', async () => {
    (supabase.from as jest.Mock).mockImplementation(() =>
      chain({ data: null, error: { message: 'relation "platform_master" does not exist' } })
    );

    const req = await getPostingRequirements('twitter', 'tweet');
    expect(req.source).toBe('fallback');
    expect(Array.isArray(req.required_fields)).toBe(true);
    expect(Array.isArray(req.optional_fields)).toBe(true);
  });

  it('returns fallback catalog when DB tables are missing', async () => {
    (supabase.from as jest.Mock).mockImplementation(() =>
      chain({ data: null, error: { message: 'relation "platform_master" does not exist' } })
    );

    const catalog = await listPlatformCatalog({ activeOnly: true });
    const keys = catalog.platforms.map((p) => p.canonical_key);
    expect(keys).toEqual(expect.arrayContaining(['linkedin', 'facebook', 'instagram', 'youtube', 'x', 'tiktok']));
  });
});

