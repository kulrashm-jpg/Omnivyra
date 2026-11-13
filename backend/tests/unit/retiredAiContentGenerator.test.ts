/**
 * The fake /ai-content-generator page (setTimeout "generation", "DrishiQ" placeholder)
 * is retired: the URL now redirects to the real content creation hub.
 */
import * as RetiredPage from '../../../pages/ai-content-generator';

describe('/ai-content-generator is retired', () => {
  it('redirects to the content creation hub', async () => {
    const result = await (RetiredPage as any).getServerSideProps({} as never);
    expect(result).toEqual({ redirect: { destination: '/command-center/content', permanent: false } });
  });

  it('renders nothing itself', () => {
    expect((RetiredPage as any).default()).toBeNull();
  });

  it('no longer contains a fake timer generator or any Drishiq text', () => {
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'pages/ai-content-generator.tsx'),
      'utf8',
    ) as string;
    // Only the retirement note (a comment) may mention why the page was removed.
    const nonComment = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    expect(nonComment).not.toMatch(/setTimeout/);
    expect(nonComment).not.toMatch(/drishiq/i);
  });
});
