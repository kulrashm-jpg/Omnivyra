/**
 * Wave 4 — unit tests for the deterministic section-block splitter.
 */
import { splitIntoBlocks, joinBlocks } from '../../../lib/content/quality/sectionBlocks';
import type { ContentBlock } from '../../../lib/content/quality/types';

const SAMPLES: string[] = [
  '',
  'Single line hook only',
  'Hook line\nSecond line',
  'Hook line\nOpening line\nBody line one\nBody line two',
  'How much time do you lose?\n\nWe automate your scheduling across channels.\n\nTeams reclaim hours every week.\n\nTry it free today.\n\n#marketing #automation',
  'Just a thought\n\nHere is the body.\n\n#one #two #three',
  'Line with CRLF\r\n#tag',
  '#only #hashtags #here',
  '\n\n',
  'Hook\n\nBody paragraph one.\nStill paragraph one.\n\nBody paragraph two.\n\nFollow us for more.\n\n#a #b',
];

describe('sectionBlocks.splitIntoBlocks', () => {
  it('empty text is safe and yields no blocks', () => {
    expect(splitIntoBlocks('')).toEqual([]);
    expect(joinBlocks([])).toBe('');
  });

  it('is deterministic (same input → identical blocks)', () => {
    for (const text of SAMPLES) {
      expect(splitIntoBlocks(text)).toEqual(splitIntoBlocks(text));
    }
  });

  it('round-trips exactly through joinBlocks for every sample', () => {
    for (const text of SAMPLES) {
      expect(joinBlocks(splitIntoBlocks(text))).toBe(text);
    }
  });

  it('is idempotent: split(join(split(x))) deep-equals split(x)', () => {
    for (const text of SAMPLES) {
      const once = splitIntoBlocks(text);
      const twice = splitIntoBlocks(joinBlocks(once));
      expect(twice).toEqual(once);
    }
  });

  it('assigns contiguous 0-based positions', () => {
    for (const text of SAMPLES) {
      const blocks = splitIntoBlocks(text);
      blocks.forEach((b, i) => expect(b.position).toBe(i));
    }
  });

  it('freshly split blocks are unlocked with no id', () => {
    const blocks = splitIntoBlocks(SAMPLES[4]);
    for (const b of blocks) {
      expect(b.locked).toBe(false);
      expect(b.id).toBeUndefined();
    }
  });

  it('labels the first line as the hook', () => {
    const blocks = splitIntoBlocks('Hook line\nSecond line');
    expect(blocks[0].blockType).toBe('hook');
    expect(blocks[0].text).toBe('Hook line');
  });

  it('detects a trailing hashtag block', () => {
    const blocks = splitIntoBlocks(SAMPLES[4]);
    const tags = blocks.find((b) => b.blockType === 'hashtags');
    expect(tags).toBeDefined();
    expect(tags!.text.trim()).toBe('#marketing #automation');
  });

  it('detects a trailing CTA block', () => {
    const blocks = splitIntoBlocks(SAMPLES[4]);
    const cta = blocks.find((b) => b.blockType === 'cta');
    expect(cta).toBeDefined();
    expect(cta!.text.trim()).toBe('Try it free today.');
  });

  it('produces a body block for multi-paragraph content', () => {
    const blocks = splitIntoBlocks(SAMPLES[9]);
    const types = blocks.map((b) => b.blockType);
    expect(types).toContain('hook');
    expect(types).toContain('body');
    expect(types).toContain('cta');
    expect(types).toContain('hashtags');
  });

  it('handles whitespace-only input as a single other block that round-trips', () => {
    const blocks = splitIntoBlocks('\n\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].blockType).toBe('other');
    expect(joinBlocks(blocks)).toBe('\n\n');
  });

  it('never throws on odd input', () => {
    const odd = ['   ', '\t\t', '###', '#', 'a', '👍\n#tag', 'line\n\n\n\nmore'];
    for (const text of odd) {
      expect(() => splitIntoBlocks(text)).not.toThrow();
      expect(joinBlocks(splitIntoBlocks(text))).toBe(text);
    }
  });
});

describe('sectionBlocks.joinBlocks', () => {
  it('concatenates block texts with newline separators', () => {
    const blocks: ContentBlock[] = [
      { blockType: 'hook', position: 0, text: 'A', locked: false },
      { blockType: 'body', position: 1, text: 'B', locked: false },
    ];
    expect(joinBlocks(blocks)).toBe('A\nB');
  });
});
