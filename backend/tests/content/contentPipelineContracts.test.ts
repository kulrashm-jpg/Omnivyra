import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('rehype-sanitize', () => ({
  __esModule: true,
  default: jest.fn(),
  defaultSchema: { tagNames: [], attributes: {} },
}));

import { CONTENT_TYPES } from '../../../content/core/contentTypes';
import { validateBlocks, validateContentOrThrow } from '../../../content/core/contentValidator';
import { sanitizeBlocks } from '../../../content/engine/sanitizer';
import { publishContent } from '../../../content/pipeline/publishContent';
import { ContentRenderer } from '../../../content/render/renderer';
import type { ContentBlock } from '../../../lib/blog/blockTypes';

const editorOutput = (): ContentBlock[] => [
  {
    id: 'heading-1',
    type: 'heading',
    level: 2,
    text: 'Editorial System',
    anchor: 'editorial-system',
  },
  {
    id: 'paragraph-1',
    type: 'paragraph',
    html: '<p>Safe <strong>editor</strong> output.</p>',
  },
];

describe('content pipeline contracts', () => {
  it('requires validated content before publishing', () => {
    const blocks = sanitizeBlocks(validateBlocks(editorOutput()));

    expect(() => publishContent({
      type: 'blog',
      blocks,
      state: 'draft',
    })).toThrow('Cannot publish unvalidated content');

    expect(publishContent({
      type: 'blog',
      blocks,
      state: 'validated',
    }).state).toBe('published');
  });

  it('editor output renders without mutation', () => {
    const blocks = sanitizeBlocks(validateBlocks(editorOutput()));
    const before = JSON.stringify(blocks);
    const rendered = renderToStaticMarkup(React.createElement(ContentRenderer, { blocks }));

    expect(JSON.stringify(blocks)).toBe(before);
    expect(rendered).toMatchSnapshot();
  });

  it('renderer rejects unsanitized blocks', () => {
    expect(() => renderToStaticMarkup(React.createElement(ContentRenderer, {
      blocks: validateBlocks(editorOutput()),
    }))).toThrow('Unsafe block detected at render time');
  });

  it('renderer rejects forged sanitizer markers', () => {
    const forged = validateBlocks(editorOutput()).map((block) => ({
      ...block,
      __sanitized: true as const,
      __hash: 'not-the-content-hash',
    }));

    expect(() => renderToStaticMarkup(React.createElement(ContentRenderer, {
      blocks: forged,
    }))).toThrow('Unsafe block detected at render time');
  });

  it('enforces block schema invariants and registry ownership', () => {
    expect(CONTENT_TYPES).toHaveProperty('blog');
    expect(CONTENT_TYPES).toHaveProperty('article');
    expect(CONTENT_TYPES).toHaveProperty('newsletter');
    expect(CONTENT_TYPES).toHaveProperty('guide');

    expect(validateContentOrThrow({
      type: 'blog',
      blocks: editorOutput(),
      state: 'draft',
    }).blocks).toHaveLength(2);

    expect(() => validateBlocks([{ id: 'bad-heading', type: 'heading', level: 2 }]))
      .toThrow('Invalid content block schema');
  });
});
