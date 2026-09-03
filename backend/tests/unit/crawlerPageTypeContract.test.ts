/**
 * U2 — the crawler's page classification must stay inside the persistence contract.
 *
 * `inferPageType()` feeds `canonical_pages.page_type` on two paths in crawlerService:
 * the fetch-error upsert and `persistCrawledPage`. Neither is wrapped in a try/catch,
 * so a value outside `canonical_pages_page_type_valid` does not merely skip one row —
 * it throws out of the crawl loop and aborts the remainder of the crawl.
 *
 * `inferPageType` is module-private, so these assertions read the source and the
 * migration rather than calling it. That is deliberate: the point of the test is that
 * the two contracts cannot drift apart, and exporting an internal helper purely to test
 * it would widen the module's surface for no runtime benefit.
 */
import fs from 'fs';
import path from 'path';

const CRAWLER = path.join(process.cwd(), 'backend/services/crawlerService.ts');
const MIGRATION = path.join(process.cwd(), 'supabase/migrations/20260409_canonical_intelligence_model.sql');

const crawlerSource = fs.readFileSync(CRAWLER, 'utf8');
const migrationSource = fs.readFileSync(MIGRATION, 'utf8');

/** The literals `inferPageType` can actually return. */
function inferPageTypeReturns(): string[] {
  const fn = crawlerSource.match(/function inferPageType\(url: string\): string \{[\s\S]*?\n\}/);
  expect(fn).not.toBeNull();
  return [...new Set([...(fn as RegExpMatchArray)[0].matchAll(/return '([a-z_]+)'/g)].map((m) => m[1]))];
}

/** The values the CHECK constraint accepts, read from the authoritative migration. */
function allowedPageTypes(): string[] {
  const c = migrationSource.match(/canonical_pages_page_type_valid[\s\S]*?CHECK \(page_type IN \(([^)]*)\)\)/);
  expect(c).not.toBeNull();
  return [...(c as RegExpMatchArray)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('U2 — crawler page_type honours the persistence contract', () => {
  it('every value inferPageType can return is accepted by canonical_pages_page_type_valid', () => {
    const allowed = allowedPageTypes();
    const violations = inferPageTypeReturns().filter((t) => !allowed.includes(t));
    expect(violations).toEqual([]);
  });

  it("'legal' can never be produced as a page_type", () => {
    expect(inferPageTypeReturns()).not.toContain('legal');
  });

  it('the legal/privacy/terms branch maps to a constraint-valid value', () => {
    // The branch that recognises privacy / terms / cookie / imprint / legal / disclosure.
    const branch = crawlerSource.match(
      /if \(\/\(\?:\^\|\\\/\)\(\?:privacy\|terms[\s\S]*?\) return '([a-z_]+)';/,
    );
    expect(branch).not.toBeNull();
    expect(allowedPageTypes()).toContain((branch as RegExpMatchArray)[1]);
  });

  it('the previously supported page types are unchanged', () => {
    const returns = inferPageTypeReturns();
    for (const t of ['home', 'landing', 'blog', 'product', 'pricing', 'feature', 'docs', 'contact', 'other']) {
      expect(returns).toContain(t);
    }
  });

  it('unrecognised pages still fall back to a constraint-valid value', () => {
    const fn = crawlerSource.match(/function inferPageType\(url: string\): string \{[\s\S]*?\n\}/);
    const tail = (fn as RegExpMatchArray)[0].trimEnd();
    const fallback = tail.match(/return '([a-z_]+)';\s*\}$/);
    expect(fallback).not.toBeNull();
    expect(allowedPageTypes()).toContain((fallback as RegExpMatchArray)[1]);
  });

  it('legal-transparency detection does not depend on page_type === legal', () => {
    // publicDomainAuditService matches on `${page_type} ${url}`, so the URL alone still
    // identifies /privacy and /terms once page_type is the generic 'other'.
    const audit = fs.readFileSync(path.join(process.cwd(), 'backend/services/publicDomainAuditService.ts'), 'utf8');
    const line = audit.split(/\r?\n/).find((l) => l.includes('legal_pages:'));
    expect(line).toBeDefined();
    expect(line).toContain('page.url');
  });
});
