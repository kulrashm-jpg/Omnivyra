/**
 * @jest-environment jsdom
 *
 * Free Audit confirmation — evidence-consistency governance.
 *
 * The decisive assertions are NEGATIVE: this public page must never present a score, index
 * or grade for the domain a prospect just submitted, because nothing has been measured at
 * that point. It previously rendered five hardcoded values (67/62/58/71/64) under the
 * heading "Your Website Audit Report" with the submitted URL directly beneath.
 *
 * This suite fails if any of that returns.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import FreeAuditReport from '../../../pages/free-audit/report';

const SUBMITTED = 'https://example-prospect.test';

jest.mock('next/router', () => ({
  useRouter: () => ({ query: { url: SUBMITTED }, push: jest.fn() }),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

jest.mock('../../../components/seo/MarketingPageMeta', () => ({
  __esModule: true,
  default: ({ title, noindex }: { title: string; noindex?: boolean }) => (
    <div data-testid="meta" data-title={title} data-noindex={String(Boolean(noindex))} />
  ),
}));

/** The exact fabricated values the page used to render. */
const REMOVED_SAMPLE_VALUES = ['67', '62', '58', '71', '64'];

describe('Free Audit — no fabricated assessment', () => {
  it('renders no numeric score for the submitted domain', () => {
    const { container } = render(<FreeAuditReport />);
    const text = container.textContent ?? '';
    // No "N/100" score rows.
    expect(text).not.toMatch(/\d+\s*\/\s*100/);
    // No bare score-like figures that a reader could take as an assessment.
    for (const value of REMOVED_SAMPLE_VALUES) {
      expect(text).not.toMatch(new RegExp(`\\b${value}\\b`));
    }
  });

  it('does not reintroduce the scored-row framing', () => {
    const { container } = render(<FreeAuditReport />);
    const text = container.textContent ?? '';
    // The score container and its heading must be gone entirely.
    expect(screen.queryByText(/sample intelligence score/i)).toBeNull();
    // A dimension name may legitimately appear inside a CAPABILITY DESCRIPTION
    // ("information accessibility, value communication, conversion readiness…").
    // What must never appear is a dimension name PAIRED WITH A VALUE, which is the
    // pattern that reads as an assessment.
    for (const label of ['Website Intelligence', 'Conversion Readiness', 'SEO Visibility', 'Trust Signals', 'User Experience']) {
      expect(text).not.toMatch(new RegExp(`${label}[^.]{0,40}\\d`, 'i'));
    }
  });

  it('does not claim a report is ready or that the site was analysed', () => {
    const { container } = render(<FreeAuditReport />);
    // Normalise typographic apostrophes so the assertion tests meaning, not glyphs.
    const text = (container.textContent ?? '').toLowerCase().replace(/[‘’]/g, "'");
    expect(text).not.toContain('report ready');
    expect(text).not.toContain('your website audit report');
    // It must say the opposite — plainly.
    expect(text).toContain("haven't analysed this site yet");
  });

  it('acknowledges the submitted domain without attributing findings to it', () => {
    const { container } = render(<FreeAuditReport />);
    expect(screen.getByText(new RegExp(SUBMITTED.replace(/[./]/g, '\\$&')))).toBeTruthy();
    // The URL is framed as a request, not as an analysed subject.
    expect((container.textContent ?? '').toLowerCase()).toContain('requested for');
  });

  it('describes what the Digital Snapshot measures without scoring it', () => {
    const { container } = render(<FreeAuditReport />);
    const text = container.textContent ?? '';
    expect(text).toContain('What the Digital Snapshot measures');
    // Capability descriptions must be present…
    for (const capability of ['Website & technical health', 'Digital experience', 'Competitive position', 'Evidence coverage']) {
      expect(text).toContain(capability);
    }
    // …but never paired with a value.
    expect(text).not.toMatch(/\d+\s*\/\s*100/);
  });

  it('states the evidence philosophy that the real report follows', () => {
    const { container } = render(<FreeAuditReport />);
    const text = (container.textContent ?? '').toLowerCase().replace(/[‘’]/g, "'");
    expect(text).toContain('only report what we can actually observe');
    expect(text).toContain('rather than filling the gap with a number');
  });

  it('makes no network call — it cannot reach a scoring engine or a provider', () => {
    const fetchSpy = jest.fn();
    const original = global.fetch;
    (global as unknown as { fetch: unknown }).fetch = fetchSpy;
    try {
      render(<FreeAuditReport />);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      (global as unknown as { fetch: unknown }).fetch = original;
    }
  });

  it('preserves the noindex intent', () => {
    render(<FreeAuditReport />);
    expect(screen.getByTestId('meta').getAttribute('data-noindex')).toBe('true');
  });

  it('renders no assessment even before the url resolves from the router', () => {
    // Guards the pre-hydration path: the page must be scoreless from first paint, not
    // scoreless only once a url is present.
    const { container } = render(<FreeAuditReport />);
    expect(container.textContent).toContain('What the Digital Snapshot measures');
    expect(container.textContent).not.toMatch(/\d+\s*\/\s*100/);
    expect(container.textContent).not.toMatch(/\bscore\b/i);
  });
});
