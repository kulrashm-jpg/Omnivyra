/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render } from '@testing-library/react';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href?: unknown }) => (
    <a href={typeof href === 'string' ? href : '#'}>{children}</a>
  ),
}));

import { BlockRenderer } from '../../../components/blog/BlockRenderer';
import { getTemplateShowcases } from '../../../lib/blog/showcaseLoader';

const REAL = ['Classic', 'Visual Feature', 'Comparison', 'Tutorial', 'Magazine', 'Narrative Article', 'Investigative Deep Dive', 'Opinion Piece'];

describe('Showcase JSON renders through the PRODUCTION BlockRenderer (preview == published)', () => {
  it.each(REAL)('%s — every example renders substantial DOM, no throw', (name) => {
    for (const doc of getTemplateShowcases(name)) {
      const { container } = render(<BlockRenderer blocks={doc.blocks} />);
      expect(container.textContent!.length).toBeGreaterThan(250);
      Array.from(container.querySelectorAll('img')).forEach((img) =>
        expect(img.getAttribute('src')).toMatch(/^(https:\/\/picsum\.photos|\/showcase-assets\/)/));
    }
  });

  it('layout signatures render: Comparison grid, Magazine grid, Investigative references, Tutorial code', () => {
    const first = (n: string) => getTemplateShowcases(n)[0].blocks;
    expect(render(<BlockRenderer blocks={first('Comparison')} />).container.querySelectorAll('.grid').length).toBeGreaterThan(0);
    expect(render(<BlockRenderer blocks={first('Magazine')} />).container.querySelectorAll('.grid').length).toBeGreaterThan(0);
    expect(render(<BlockRenderer blocks={first('Investigative Deep Dive')} />).container.querySelectorAll('a[href^="http"]').length).toBeGreaterThan(0);
    expect(render(<BlockRenderer blocks={getTemplateShowcases('Tutorial')[1].blocks} />).container.querySelectorAll('pre code').length).toBeGreaterThan(0);
  });
});
