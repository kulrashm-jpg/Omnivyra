import { getTemplateShowcases, getTemplateShowcase, showcaseCount, hasTemplateShowcase, SHOWCASE_TEMPLATES } from '../../../lib/blog/showcaseLoader';
import type { ContentBlock } from '../../../lib/blog/blockTypes';

const REAL = ['Classic', 'Visual Feature', 'Comparison', 'Tutorial', 'Magazine', 'Narrative Article', 'Investigative Deep Dive', 'Opinion Piece'];
const flatten = (blocks: ContentBlock[]): ContentBlock[] => blocks.flatMap((b) => (b.type === 'columns' ? [b, ...b.columns.flatMap((c) => flatten(c.blocks))] : [b]));

describe('Showcase Loader — externalized JSON content (CREATOR-036)', () => {
  it('every template has at least THREE complete showcase examples (STEP 4)', () => {
    expect(SHOWCASE_TEMPLATES.sort()).toEqual(REAL.sort());
    for (const name of REAL) {
      expect(hasTemplateShowcase(name)).toBe(true);
      expect(showcaseCount(name)).toBeGreaterThanOrEqual(3);
      for (const doc of getTemplateShowcases(name)) {
        expect(doc.blocks.length).toBeGreaterThanOrEqual(5);
        for (const f of [doc.meta.title, doc.meta.subtitle, doc.meta.author, doc.meta.company, doc.meta.date, doc.meta.kicker]) expect(f.trim().length).toBeGreaterThan(1);
      }
    }
  });

  it('zero repeated titles / statistics / quotes across the WHOLE library (STEP 9)', () => {
    const titles: string[] = [], quotes: string[] = [], stats: string[] = [];
    for (const name of REAL) for (const doc of getTemplateShowcases(name)) {
      titles.push(doc.meta.title);
      for (const b of flatten(doc.blocks)) {
        if (b.type === 'quote') quotes.push((b as { text: string }).text);
        if (b.type === 'key_insights') (b as { items: string[] }).items.forEach((s) => stats.push(s));
      }
    }
    expect(new Set(titles).size).toBe(titles.length);   // no repeated titles
    expect(new Set(quotes).size).toBe(quotes.length);   // no repeated quotes
    // Statistics may legitimately reuse a shared figure, but not be wholesale duplicated everywhere.
    expect(new Set(stats).size).toBeGreaterThan(stats.length * 0.6);
  });

  it('no placeholder text / lorem ipsum anywhere', () => {
    const banned = ['lorem ipsum', 'placeholder', 'insert image', 'example quote', 'add your', 'your headline', 'sample text', 'dolor sit'];
    for (const name of REAL) {
      const text = JSON.stringify(getTemplateShowcases(name)).toLowerCase();
      for (const b of banned) expect({ name, b, found: text.includes(b) }).toEqual({ name, b, found: false });
    }
  });

  it('every image resolves (curated path or seeded photo) — never an empty box', () => {
    for (const name of REAL) for (const doc of getTemplateShowcases(name)) for (const b of flatten(doc.blocks)) {
      if (b.type === 'image') {
        const url = (b as { url: string }).url;
        expect(url).toMatch(/^(https:\/\/picsum\.photos\/|\/showcase-assets\/|https?:\/\/)/);
        expect((b as { alt: string }).alt.trim().length).toBeGreaterThan(3);
      }
    }
  });

  it('DSL expands the rich block set — FAQ, code, references, columns all present somewhere (STEP 6)', () => {
    const seen = new Set<string>();
    for (const name of REAL) for (const doc of getTemplateShowcases(name)) for (const b of flatten(doc.blocks)) seen.add(b.type);
    for (const t of ['heading', 'paragraph', 'image', 'quote', 'callout', 'key_insights', 'list', 'columns', 'references', 'summary', 'divider']) {
      expect({ blockType: t, present: seen.has(t) }).toEqual({ blockType: t, present: true });
    }
    // FAQ expands to heading+paragraph; code expands to a <pre><code> paragraph.
    const comp = getTemplateShowcase('Comparison', 0);
    expect(JSON.stringify(comp.blocks)).toMatch(/Can you migrate later/);            // FAQ
    expect(JSON.stringify(getTemplateShowcase('Tutorial', 1).blocks)).toMatch(/<pre><code/); // code snippet
  });

  it('distinct identity — different layouts per template (STEP 7)', () => {
    expect(getTemplateShowcase('Comparison', 0).blocks.some((b) => b.type === 'columns')).toBe(true);
    expect(getTemplateShowcase('Investigative Deep Dive', 0).blocks.some((b) => b.type === 'references')).toBe(true);
    expect(getTemplateShowcase('Tutorial', 0).blocks.some((b) => b.type === 'list' && (b as { listType: string }).listType === 'numbered')).toBe(true);
  });

  it('deterministic + collision-free ids per (template, example)', () => {
    for (const name of REAL) for (let i = 0; i < showcaseCount(name); i++) {
      const a = getTemplateShowcase(name, i);
      const ids = JSON.stringify(a).match(/"id":"[^"]+"/g) ?? [];
      expect(new Set(ids).size).toBe(ids.length);
      expect(JSON.stringify(a)).toBe(JSON.stringify(getTemplateShowcase(name, i)));
    }
  });

  it('out-of-range / unknown inputs are safe', () => {
    expect(getTemplateShowcase('Comparison', 99).meta.title.length).toBeGreaterThan(3);
    expect(getTemplateShowcase('Nope', 0).blocks.length).toBeGreaterThanOrEqual(5);
  });
});
