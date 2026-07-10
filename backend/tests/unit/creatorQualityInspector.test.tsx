/**
 * @jest-environment jsdom
 *
 * Regression: the Quality Inspector white-screened the whole creator editor
 * (`TypeError: Cannot read properties of undefined (reading 'fg')`) whenever an
 * asset's diagnostic report contained a FAILING visual check. Root cause: the
 * report emits check values as 'PASS' | 'FAIL' | 'N/A', but the pill palette is
 * keyed 'PASS' | 'WARNING' | 'FAILED' | 'REPAIRED' | 'N/A' — so 'FAIL' indexed
 * an undefined palette entry and `.fg` threw. This locks the render as crash-safe.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { buildCreatorDiagnosticReport } from '../../services/creator/creatorDiagnosticReport';
import CreatorQualityInspector from '../../../components/creator/CreatorQualityInspector';

function reportWith(visual: { passed: boolean; failures: Array<{ category: string; flag: string; slide?: number }>; slideCount?: number }) {
  return buildCreatorDiagnosticReport({
    assetType: 'image',
    platform: 'linkedin',
    companyId: 'co-1',
    durationMs: 4200,
    template: { id: 'sys-image-headline', name: 'Bold Headline', version: 1, assetFamily: 'image', renderingContractVersion: 'creator-template-v1' },
    companyContext: { description: 'A RevOps platform', products: ['Router'], positioning: 'Fastest routing' },
    brandVoice: { tone: 'confident', prohibitedPhrases: ['synergy'] },
    contentViolations: [],
    renderMetadata: {
      width: 1200, height: 675, platform: 'linkedin',
      platform_visual_profile: { preferredTypographyScale: 'standard' },
      overlay_quality: { preset: 'balanced', flags: [] },
      visual_validation: visual,
    },
  });
}

describe('CreatorQualityInspector — never white-screens on a failing report', () => {
  it('renders a report with a FAILING visual check without throwing', () => {
    const report = reportWith({
      passed: false,
      failures: [{ category: 'text_fit', flag: 'text_overflow' }],
      slideCount: undefined,
    });
    // sanity: the report really does produce a 'FAIL' value (the crash trigger)
    expect(Object.values(report.visualValidation.checks)).toContain('FAIL');

    const { getAllByText, unmount } = render(<CreatorQualityInspector report={report} />);
    // 'FAIL' must be normalized to the palette's 'FAILED' pill, visibly.
    expect(getAllByText('FAILED').length).toBeGreaterThan(0);
    unmount();
  });

  it('renders a clean (all-PASS) report without throwing', () => {
    const report = reportWith({ passed: true, failures: [], slideCount: undefined });
    const { unmount } = render(<CreatorQualityInspector report={report} />);
    unmount();
  });
});
