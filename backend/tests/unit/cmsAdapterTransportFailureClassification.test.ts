/**
 * 05 (2026-11-12): the uncertain-outcome rule protects UNKNOWN failure categories by default, but
 * not a WRONG one - if an adapter turned a transport failure into a message the classifier reads
 * as a definite refusal (validation / auth / not_found / rate_limit), a post that may be live would
 * be retried. Every real CMS adapter is driven to a 500 whose body is stuffed with every keyword
 * the classifier looks for; on a CREATE the result must classify as UNCERTAIN. (A new adapter
 * meets this bar by being added to CONFIGS.)
 */
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: async () => ({
    ok: false, status: 500, headers: { get: () => 'application/json' },
    json: async () => ({ message: 'field required; resource missing; not found; rate limit; auth credential; unsupported', code: 'rate_limited' }),
    text: async () => '{"message":"field required; resource missing; not found; rate limit; auth credential; unsupported"}',
  }),
}));
jest.mock('../../services/cms/cmsApiBaseResolver', () => ({
  resolveCanonicalApiBase: async (_c: unknown, site: string) => ({ apiBase: `${site}/wp-json`, base: `${site}/wp-json` }),
  rediscoverAndRepairApiBase: async () => null,
}));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
}));

import { getCmsAdapter } from '../../services/cms/registry';
import { UNCERTAIN_PUBLISH_CATEGORY, classifyPublishFailure } from '../../services/publishingJobService';

const CONFIGS: Record<string, Record<string, string>> = {
  wordpress: { site_url: 'https://wp.example.com', username: 'u', app_password: 'p' },
  ghost: { site_url: 'https://ghost.example.com', admin_api_key: 'abc123:0123456789abcdef0123456789abcdef' },
  hubspot: { access_token: 't', blog_id: '1' },
  joomla: { site_url: 'https://j.example.com', api_token: 't' },
  shopify: { shop_domain: 'shop.myshopify.com', access_token: 't', blog_id: '1' },
  webflow: { access_token: 't', collection_id: 'c1' },
  wix: { api_key: 'k', wix_site_id: 's' },
  drupal: { site_url: 'https://d.example.com', access_token: 't' },
  custom_blog_api: { endpoint_url: 'https://api.example.com/posts', api_key: 'k' },
};

beforeEach(() => { jest.spyOn(console, 'warn').mockImplementation(() => undefined); jest.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => jest.restoreAllMocks());

it.each(Object.keys(CONFIGS))('%s: a 500 on CREATE classifies as UNCERTAIN', async (provider) => {
  const adapter = getCmsAdapter(provider);
  const ctx: any = { provider, companyId: 'co-a', connectionId: 'c1', websiteId: 'w1', config: CONFIGS[provider], timeoutMs: 1000 };
  const input: any = { blog: { id: 'b1', title: 'Hello', slug: 'hello', excerpt: '', content: '<p>x</p>' }, htmlContent: '<p>x</p>', status: 'publish' };
  // No try/catch: every adapter RETURNS today (checked), so a case is never vacuous. If an adapter
  // starts throwing on a 500, this fails loudly and someone checks it - a throw after the call
  // started is classified uncertain by the job's started flag (publishingUncertainOutcome.test.ts).
  const result: any = await adapter.publishPost(ctx, input);
  expect(result.success).toBe(false);
  expect({ provider, message: result.message, category: classifyPublishFailure({ job_type: 'publish_post' } as any, result) })
    .toEqual({ provider, message: result.message, category: UNCERTAIN_PUBLISH_CATEGORY });
});

it('squarespace: no write API - the adapter says UNSUPPORTED structurally (no call made), never uncertain', async () => {
  const result: any = await getCmsAdapter('squarespace').publishPost({ provider: 'squarespace', config: {} } as any, {} as any);
  expect(result).toMatchObject({ success: false, unsupported: true });
  expect(classifyPublishFailure({ job_type: 'publish_post' } as any, result)).toBe('unsupported');
});

it('NEGATIVE CONTROL: the classifier still reads a genuine refusal as definite', () => {
  expect(classifyPublishFailure({ job_type: 'publish_post' } as any, { message: 'WordPress authentication failed. Check your credentials.' })).toBe('auth');
  expect(classifyPublishFailure({ job_type: 'publish_post' } as any, { message: 'WordPress returned status 429.' })).toBe('rate_limit');
});
