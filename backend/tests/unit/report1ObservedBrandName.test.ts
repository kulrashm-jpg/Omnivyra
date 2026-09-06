/**
 * GAP-17 — the AI surface must be able to ask "What is X?".
 *
 * THE DEFECT
 * `deriveCitationQueries` builds the `branded` query class only when it is handed a brand name.
 * That name comes from the company profile, which is frequently empty — in production it was null
 * for a report on calendly.com. Every branded cell was therefore recorded as
 * `unavailable / "No queries derived for branded."`: the provider was credentialed and answering
 * (the `category` class measured fine), it was simply never asked anything.
 *
 * THE FIX UNDER TEST
 * `resolveObservedBrandName` falls back to the name the SITE ITSELF declares on pages already
 * crawled for the report's domain — `og:site_name`, then `application-name`, then the brand
 * segment of the homepage title. It reports that declaration verbatim and never manufactures one
 * from the domain — both trimming a declared name and inventing one are inferences about identity,
 * so where the site says nothing, absence stays absence.
 */
import { selectObservedBrandName, normalizeHost } from '../../services/intelligence/observedBrandName';

type Page = {
  url: string | null;
  title: string | null;
  meta_title: string | null;
  crawl_metadata: { meta_tags?: Record<string, string> | null } | null;
};

const page = (url: string, meta: Record<string, string> = {}, title: string | null = null): Page => ({
  url, title, meta_title: title, crawl_metadata: { meta_tags: meta },
});

describe('GAP-17 — observed brand name for the AI surface', () => {
  // ── 1. The production case ────────────────────────────────────────────────
  describe('1. the production case: profile has no name, the site declares one', () => {
    it('takes the site-declared name from the homepage', () => {
      // Exactly what production holds for this tenant.
      const pages = [
        page('https://calendly.com/', { 'og:site_name': 'Calendly.com' },
          'Meeting Scheduling Software and AI Meeting Tools | Calendly'),
        page('https://calendly.com/blog', { 'og:site_name': 'Calendly.com' }),
      ];
      expect(selectObservedBrandName(pages, 'calendly.com')).toBe('Calendly.com');
    });

    it('prefers og:site_name over the page title', () => {
      const pages = [page('https://calendly.com/', { 'og:site_name': 'Calendly.com' }, 'Something Else | Calendly')];
      expect(selectObservedBrandName(pages, 'calendly.com')).toBe('Calendly.com');
    });

    it('falls back to application-name when og:site_name is absent', () => {
      const pages = [page('https://example.com/', { 'application-name': 'Example Labs' })];
      expect(selectObservedBrandName(pages, 'example.com')).toBe('Example Labs');
    });
  });

  // ── 2. The declaration is used verbatim ───────────────────────────────────
  describe('2. a declared name is never rewritten', () => {
    it('keeps a name that carries the domain suffix', () => {
      // "Calendly.com" is what the site calls itself. Trimming it to "Calendly" would be our
      // inference about the entity, and the label only has to phrase "What is X?".
      expect(selectObservedBrandName([page('https://calendly.com/', { 'og:site_name': 'Calendly.com' })], 'calendly.com'))
        .toBe('Calendly.com');
    });

    it('keeps a suffix that is genuinely part of the name', () => {
      // python.org calls itself "Python.org"; "Python" is a different entity (the language).
      expect(selectObservedBrandName([page('https://python.org/', { 'og:site_name': 'Python.org' })], 'python.org'))
        .toBe('Python.org');
    });

    it('leaves a name that carries no suffix untouched', () => {
      expect(selectObservedBrandName([page('https://acme.io/', { 'og:site_name': 'Acme' })], 'acme.io')).toBe('Acme');
    });
  });

  // ── 3. It must never invent a name ────────────────────────────────────────
  describe('3. absence stays absence — no name is manufactured', () => {
    it('returns null when no page declares a name', () => {
      expect(selectObservedBrandName([page('https://acme.io/', {})], 'acme.io')).toBeNull();
    });

    it('does not derive a name from the domain itself', () => {
      const result = selectObservedBrandName([page('https://calendly.com/', {})], 'calendly.com');
      expect(result).toBeNull();
      expect(result).not.toBe('Calendly');
    });

    it('returns null when there are no crawled pages at all', () => {
      expect(selectObservedBrandName([], 'acme.io')).toBeNull();
    });

    it('returns null without a domain to anchor on', () => {
      expect(selectObservedBrandName([page('https://acme.io/', { 'og:site_name': 'Acme' })], null)).toBeNull();
    });

    it('rejects an empty or absurdly long declaration', () => {
      expect(selectObservedBrandName([page('https://acme.io/', { 'og:site_name': '   ' })], 'acme.io')).toBeNull();
      expect(selectObservedBrandName([page('https://acme.io/', { 'og:site_name': 'x'.repeat(120) })], 'acme.io')).toBeNull();
    });
  });

  // ── 4. The page set can contain more than one host ────────────────────────
  describe('4. only pages on the report domain count', () => {
    it('ignores a declaration from a different host in the same company page set', () => {
      // Production reality: this tenant's canonical_pages carry both calendly.com and python.org.
      const pages = [
        page('https://python.org/', { 'og:site_name': 'Python.org' }),
        page('https://calendly.com/', { 'og:site_name': 'Calendly.com' }),
      ];
      expect(selectObservedBrandName(pages, 'calendly.com')).toBe('Calendly.com');
      expect(selectObservedBrandName(pages, 'python.org')).toBe('Python.org');
    });

    it('returns null when the report domain has no crawled page', () => {
      expect(selectObservedBrandName([page('https://python.org/', { 'og:site_name': 'Python.org' })], 'calendly.com'))
        .toBeNull();
    });

    it('matches the host regardless of www or scheme', () => {
      expect(selectObservedBrandName([page('https://www.acme.io/', { 'og:site_name': 'Acme' })], 'https://acme.io/x'))
        .toBe('Acme');
    });
  });

  // ── 5. Title fallback is corroborated, not guessed ────────────────────────
  describe('5. the title fallback only accepts a name the domain corroborates', () => {
    it('takes the trailing brand segment when it matches the domain label', () => {
      const pages = [page('https://calendly.com/', {}, 'Meeting Scheduling Software | Calendly')];
      expect(selectObservedBrandName(pages, 'calendly.com')).toBe('Calendly');
    });

    it('rejects a trailing segment that is a marketing phrase', () => {
      const pages = [page('https://acme.io/', {}, 'Widgets | The Best Platform For Teams')];
      expect(selectObservedBrandName(pages, 'acme.io')).toBeNull();
    });

    it('rejects a title with no separator', () => {
      expect(selectObservedBrandName([page('https://acme.io/', {}, 'Acme')], 'acme.io')).toBeNull();
    });
  });

  // ── 6. Host normalisation ─────────────────────────────────────────────────
  describe('6. host normalisation', () => {
    it.each([
      ['https://www.acme.io/path', 'acme.io'],
      ['http://ACME.io', 'acme.io'],
      ['acme.io', 'acme.io'],
      ['www.acme.io/', 'acme.io'],
    ])('normalises %s → %s', (input, expected) => {
      expect(normalizeHost(input)).toBe(expected);
    });

    it('returns null for empty input', () => {
      expect(normalizeHost(null)).toBeNull();
      expect(normalizeHost('   ')).toBeNull();
    });
  });
});
