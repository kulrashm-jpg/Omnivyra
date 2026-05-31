/**
 * @jest-environment jsdom
 *
 * Creator Rendering Forensic Audit — Phase 7+8 fixes.
 *
 * Locks in:
 *   - Carousel CreatorAssetBlock renders ALL slides, not just the first.
 *   - Infographic CreatorAssetBlock renders ALL sections, not just the first.
 *   - Image CreatorAssetBlock continues to render a single image (regression guard).
 *   - Thought-leadership quality reports remain inspectable while the
 *     throw-based helper remains available for production blocking.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import { BlockRenderer } from '../../../components/blog/BlockRenderer';
import type { CreatorAssetBlock } from '../../../lib/blog/blockTypes';
import type { BlogGenerationOutput } from '../../../lib/blog/blogGenerationEngine';
import {
  evaluateThoughtLeadershipQuality,
  assertThoughtLeadershipQuality,
  ThoughtLeadershipQualityGateError,
} from '../../services/longForm/thoughtLeadershipQualityGate';

/* ── Rendering — multi-asset content types ───────────────────────── */

function makeBlock(overrides: Partial<CreatorAssetBlock>): CreatorAssetBlock {
  return {
    id: 'block-1',
    type: 'creator_asset',
    assetId: 'asset-1',
    title: 'Test asset',
    ...overrides,
  } as CreatorAssetBlock;
}

describe('RenderCreatorAsset — carousel + infographic render every slide / section', () => {
  test('carousel block renders every slide, not just the first', () => {
    const block = makeBlock({
      creatorType: 'carousel',
      files: [
        'https://cdn.example.com/slide-1.png',
        'https://cdn.example.com/slide-2.png',
        'https://cdn.example.com/slide-3.png',
        'https://cdn.example.com/slide-4.png',
        'https://cdn.example.com/slide-5.png',
      ],
    });
    const { container, getByText } = render(<BlockRenderer blocks={[block]} />);
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(5);
    expect(imgs[0].getAttribute('src')).toBe('https://cdn.example.com/slide-1.png');
    expect(imgs[4].getAttribute('src')).toBe('https://cdn.example.com/slide-5.png');
    expect(getByText(/Slide 1 of 5/i)).toBeInTheDocument();
    expect(getByText(/Slide 5 of 5/i)).toBeInTheDocument();
  });

  test('infographic block renders every section', () => {
    const block = makeBlock({
      creatorType: 'infographic',
      files: [
        'https://cdn.example.com/section-1.png',
        'https://cdn.example.com/section-2.png',
        'https://cdn.example.com/section-3.png',
      ],
    });
    const { container, getByText } = render(<BlockRenderer blocks={[block]} />);
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(3);
    expect(getByText(/Section 1 of 3/i)).toBeInTheDocument();
    expect(getByText(/Section 3 of 3/i)).toBeInTheDocument();
  });

  test('image block still renders exactly one img (regression guard)', () => {
    const block = makeBlock({
      creatorType: 'supporting_image',
      url: 'https://cdn.example.com/image.png',
    });
    const { container } = render(<BlockRenderer blocks={[block]} />);
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe('https://cdn.example.com/image.png');
  });

  test('carousel block with only 1 file falls back to single-image render', () => {
    // Edge case: a one-frame "carousel" should render as a single image,
    // not as a "Slide 1 of 1" gallery.
    const block = makeBlock({
      creatorType: 'carousel',
      files: ['https://cdn.example.com/only.png'],
    });
    const { container, queryByText } = render(<BlockRenderer blocks={[block]} />);
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(queryByText(/Slide 1 of 1/i)).toBeNull();
  });

  test('carousel block with no files + assetId still renders the placeholder, not null', () => {
    const block = makeBlock({
      creatorType: 'carousel',
      assetId: 'pending-1',
      files: [],
    });
    const { container } = render(<BlockRenderer blocks={[block]} />);
    expect(container.textContent).toMatch(/Creator asset/);
  });
});

/* ── Blog quality gate — non-fatal evaluation ────────────────────── */

const failingOutput: BlogGenerationOutput = {
  title: 'Generic AI tips',
  excerpt: 'AI tips',
  content_html: '<p>AI is changing everything. AI is helpful. AI is important. Companies should adopt AI.</p>',
  tags: ['ai'],
  category: 'blog',
  seo_meta_title: 'Generic AI tips',
  seo_meta_description: 'AI tips',
  key_insights: ['AI is useful.'],
};

describe('Thought leadership quality gate — non-fatal behavior contract', () => {
  test('evaluateThoughtLeadershipQuality never throws, even on failure', () => {
    expect(() => evaluateThoughtLeadershipQuality({
      output: failingOutput,
      organizationPerspective: undefined,
    })).not.toThrow();
  });

  test('evaluateThoughtLeadershipQuality returns a report with a passed flag', () => {
    const report = evaluateThoughtLeadershipQuality({
      output: failingOutput,
      organizationPerspective: undefined,
    });
    expect(report).toHaveProperty('passed');
    expect(typeof report.passed).toBe('boolean');
  });

  test('assertThoughtLeadershipQuality remains exported for legacy direct callers (throws on failure)', () => {
    // The throw-based helper still exists; it's only the production
    // pipeline (runBlogGeneration + unifiedLongFormEngine) that swapped
    // to the non-throwing evaluator. The legacy contract is preserved
    // so any out-of-tree caller still sees the same behavior.
    if (!evaluateThoughtLeadershipQuality({ output: failingOutput, organizationPerspective: undefined }).passed) {
      expect(() => assertThoughtLeadershipQuality({
        output: failingOutput,
        organizationPerspective: undefined,
      })).toThrow(ThoughtLeadershipQualityGateError);
    }
  });
});
