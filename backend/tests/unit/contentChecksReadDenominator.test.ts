/**
 * Content checks count only pages that were READ.
 *
 * omnivyra.com (2026-10-24): 90 stored URLs, 14 returned an HTTP response, 76 did not. The
 * content engine counted all 90, printing "14/90 pages have an H1" and "Contact page found among
 * the 90 pages read", while the website evidence section described the 14 that answered.
 */
import { scoreContentIntelligence } from '../../services/websiteIntelligence/contentIntelligenceEngine';

type Page = Parameters<typeof scoreContentIntelligence>[0][number];

const page = (id: string, path: string, http_status: number | null): Page => ({
  id, url: `https://x.test${path}`, title: `T${id}`,
  meta_title: `T${id}`, meta_description: 'x', page_type: null,
  headings: [{ level: 1, text: `T${id}` }], ctas: [{ text: 'Contact us' }],
  internal_link_count: 4, http_status, last_crawled_at: '2026-10-18T00:00:00.000Z',
  crawl_metadata: undefined,
} as Page);

const detail = (pages: Page[], key: string) =>
  scoreContentIntelligence(pages, [], Date.parse('2026-10-24T00:00:00.000Z')).checks.find((c) => c.key === key)?.detail;

describe('content check denominators', () => {
  const read = [page('1', '/', 200), page('2', '/contact', 200)];
  const neverAnswered = [page('3', '/a', 0), page('4', '/b', null), page('5', '/c', 0)];

  it('excludes URLs that never returned an HTTP response', () => {
    expect(detail([...read, ...neverAnswered], 'headline_clarity')).toBe('2/2 pages have an H1');
    expect(detail([...read, ...neverAnswered], 'contact_info')).toBe('Contact page found among the 2 pages read');
  });

  it('still counts a page that answered with an error as read', () => {
    expect(detail([...read, page('6', '/gone', 404)], 'headline_clarity')).toBe('3/3 pages have an H1');
  });

  it('abstains when no page answered, rather than scoring an empty corpus', () => {
    const checks = scoreContentIntelligence(neverAnswered, [], Date.now()).checks;
    expect(checks.find((c) => c.key === 'crawl')?.status).toBe('not_evaluable');
  });
});
