/**
 * WS-1c-4 (Zone A1) — long-form runtime adapter transparency / byte-identity.
 *
 * The adapter is the runtime's long-form seam: a FAIL-SAFE observability envelope
 * that delegates to the existing engines UNCHANGED and returns their EXACT native
 * result. This proves:
 *   - runBlog/runArticle/runStory forward the request verbatim and return the
 *     engine's exact object (===), for both success and failure.
 *   - a THROWING observability sink can never alter or break the result.
 */

jest.mock('../../../lib/blog/runBlogGeneration', () => ({ runBlogGeneration: jest.fn() }));
jest.mock('../../../lib/article/runArticleGeneration', () => ({ runArticleGeneration: jest.fn() }));
jest.mock('../../../lib/story/runStoryGeneration', () => ({ runStoryGeneration: jest.fn() }));
// Force EVERY observability write to throw — the envelope must swallow it.
jest.mock('../../observability', () => ({
  recordRawCounter: jest.fn(() => {
    throw new Error('metric sink exploded');
  }),
}));

import { longFormRuntimeAdapter } from '../../services/content/runtime/longFormRuntimeAdapter';
import { runBlogGeneration } from '../../../lib/blog/runBlogGeneration';
import { runArticleGeneration } from '../../../lib/article/runArticleGeneration';
import { runStoryGeneration } from '../../../lib/story/runStoryGeneration';

const mockBlog = runBlogGeneration as jest.Mock;
const mockArticle = runArticleGeneration as jest.Mock;
const mockStory = runStoryGeneration as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('longFormRuntimeAdapter — transparent envelope', () => {
  test('runBlog returns the engine result EXACTLY and forwards the request', async () => {
    const result: any = { needs_clarification: false, mode: 'full', result: { content_html: '<p>x</p>' } };
    mockBlog.mockResolvedValue(result);
    const req: any = { company_id: 'org1', topic: 'T', contentType: 'blog' };

    const out = await longFormRuntimeAdapter.runBlog(req);

    expect(out).toBe(result); // exact same object — byte-identical to calling the engine
    expect(mockBlog).toHaveBeenCalledTimes(1);
    expect(mockBlog).toHaveBeenCalledWith(req);
  });

  test('runArticle / runStory are equally transparent', async () => {
    const aRes: any = { article: true };
    const sRes: any = { story: true };
    mockArticle.mockResolvedValue(aRes);
    mockStory.mockResolvedValue(sRes);

    await expect(longFormRuntimeAdapter.runArticle({ company_id: 'o' } as any)).resolves.toBe(aRes);
    await expect(longFormRuntimeAdapter.runStory({ company_id: 'o' } as any)).resolves.toBe(sRes);
  });

  test('a throwing observability sink NEVER alters or breaks a successful result', async () => {
    const result: any = { ok: 1 };
    mockBlog.mockResolvedValue(result);

    // Must not throw despite recordRawCounter throwing on every call.
    await expect(longFormRuntimeAdapter.runBlog({ company_id: 'o' } as any)).resolves.toBe(result);
  });

  test('engine failures propagate UNCHANGED (envelope only observes)', async () => {
    const err = new Error('engine boom');
    mockBlog.mockRejectedValue(err);

    await expect(longFormRuntimeAdapter.runBlog({ company_id: 'o' } as any)).rejects.toBe(err);
  });

  test('adapter advertises the blog/article/story kinds', () => {
    expect(longFormRuntimeAdapter.kinds).toEqual(['blog', 'article', 'story']);
  });
});
