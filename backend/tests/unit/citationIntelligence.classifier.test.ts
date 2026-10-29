/**
 * Source-domain classifier: rule table on the label boundary, relational checks first, explicit unknown.
 * The table's real hosts are what is under test here; no fixture that could ship uses them.
 */
import { CLASSIFIER_LIST_VERSION, classifySourceHost, isSearchEngineHost } from '../../services/intelligence/citations/sourceDomainClassifier';

const ctx = { subjectDomains: ['acme.test'], competitorDomains: ['rival.test'] };

describe('source-domain classifier', () => {
  it.each([
    ['g2.com', 'review_directory'], ['www.capterra.com', 'review_directory'], ['reddit.com', 'forum_community'], ['old.reddit.com', 'forum_community'],
    ['en.wikipedia.org', 'knowledge_reference'], ['www.youtube.com', 'video'], ['in.linkedin.com', 'social'], ['crunchbase.com', 'business_database'],
    ['medium.com', 'publishing_platform'], ['forbes.com', 'editorial'], ['economictimes.indiatimes.com', 'editorial'], ['chatgpt.com', 'ai_vendor_or_search'],
    ['www.google.com', 'ai_vendor_or_search'], ['www.google.de', 'ai_vendor_or_search'],
  ])('%s → %s, with the rule that fired', (host, category) => {
    const c = classifySourceHost(host, ctx);
    expect(c.category).toBe(category);
    expect(c.rule).not.toBe('none');
    expect(c.list_version).toBe(CLASSIFIER_LIST_VERSION);
  });

  it('matches on the label boundary only', () => {
    expect(classifySourceHost('notg2.com', ctx).category).toBe('unknown');
    expect(classifySourceHost('g2.com.evil.test', ctx).category).toBe('unknown');
    expect(classifySourceHost('notacme.test', ctx).category).toBe('unknown');
  });

  it('decides subject and validated competitor relationally, before the table', () => {
    expect(classifySourceHost('blog.acme.test', ctx)).toMatchObject({ category: 'subject_owned', rule: 'relational:subject:acme.test' });
    expect(classifySourceHost('rival.test', ctx)).toMatchObject({ category: 'competitor_owned', rule: 'relational:validated_competitor:rival.test' });
    // A subject hosted on a listed platform is still the subject's own.
    expect(classifySourceHost('acme.medium.com', { subjectDomains: ['acme.medium.com'], competitorDomains: [] }).category).toBe('subject_owned');
  });

  it('an unvalidated competitor (not in the context) is not competitor_owned', () => {
    expect(classifySourceHost('other.test', ctx).category).toBe('unknown');
  });

  it('an unlisted host is unknown, explicitly, with rule none', () => {
    expect(classifySourceHost('somesite.test', ctx)).toEqual({ category: 'unknown', rule: 'none', list_version: CLASSIFIER_LIST_VERSION });
  });

  it('search-engine detection excludes social hosts that the never-fetch list also contains', () => {
    expect(isSearchEngineHost('bing.com')).toBe(true);
    expect(isSearchEngineHost('reddit.com')).toBe(false);
    expect(isSearchEngineHost('youtube.com')).toBe(false);
  });
});
