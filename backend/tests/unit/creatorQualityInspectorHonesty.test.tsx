/**
 * @jest-environment jsdom
 *
 * Quality inspector honesty + the publish gate.
 *
 *  - "Rendering completed" was actually `visualVal.passed`: a rendered asset
 *    with a failed visual check read as "not rendered". Render status and
 *    visual-check status are now two rows.
 *  - Every visual warning read "Visual check warning": failures now carry a
 *    human message per flag/category plus the slide number.
 *  - Readiness was capped at min(base, 60) on a visual failure while it passes
 *    at >= 60, so a capped asset showed "Readiness passed".
 *  - The campaign package ignored visual failures, so a failing asset was
 *    "Ready for publishing".
 */
import React from 'react';
import { render } from '@testing-library/react';
import { buildGenerationReview } from '../../../lib/creator-templates';
import { buildCampaignPackage, type PackageAsset } from '../../../lib/creator-templates/campaignPackage';
import { creatorResultToPackageAssets, buildCreatorCampaignPackage } from '../../../lib/creator-templates/creatorPackageBridge';
import { describeVisualFailure, validateCreatorVisual } from '../../services/creator/creatorVisualValidation';
import { buildCreatorDiagnosticReport, READINESS_PASS_THRESHOLD } from '../../services/creator/creatorDiagnosticReport';
import CreatorQualityInspector from '../../../components/creator/CreatorQualityInspector';
import CampaignPackagePanel from '../../../components/creator/CampaignPackagePanel';

const FAILING_VISUAL = {
  passed: false,
  checks: {},
  failures: [
    { category: 'typography', flag: 'headline_likely_unreadable_mobile', slide: 3 },
    { category: 'text_fit', flag: 'severe_layout_overflow_risk' },
    { category: 'overlap', flag: 'severe_layout_overflow_risk' },
    { category: 'contrast', flag: 'contrast_2.10' },
  ],
};

const resultWith = (visualValidation: Record<string, unknown>, readiness = 60) => ({
  success: true,
  primary_platform: 'linkedin',
  persisted_asset_id: 'asset-1',
  output: {
    asset_type: 'image',
    asset_instruction: { template_id: 't' },
    packaging: { cta: 'Start free', caption: 'Caption' },
    asset_payload: {
      media_bundle: {
        url: 'https://cdn/x.png',
        files: ['https://cdn/x.png'],
        metadata: {
          creator_diagnostic_report: {
            generation: { assetType: 'image', platform: 'linkedin' },
            template: { id: 't', name: 'T' },
            contentValidation: { warnings: [], missingRequiredTerms: [] },
            rendering: {},
            visualValidation,
            scores: { overallReadiness: { value: readiness } },
          },
        },
      },
    },
  },
});

describe('visual failure messages', () => {
  it('each flag gets a human message, with the slide number', () => {
    expect(describeVisualFailure({ category: 'typography', flag: 'headline_likely_unreadable_mobile', slide: 3 }))
      .toBe('Headline is too small to read on mobile (slide 3)');
    expect(describeVisualFailure({ category: 'text_fit', flag: 'severe_layout_overflow_risk' })).toBe('Text overflows the safe area');
    expect(describeVisualFailure({ category: 'contrast', flag: 'contrast_2.10' })).toBe('Low contrast between text and background');
    expect(describeVisualFailure({ category: 'branding', flag: 'unknown_flag' })).toBe('Branding is missing or misplaced');
  });

  it('new failures carry their message', () => {
    const v = validateCreatorVisual({ overlay_quality: { flags: ['headline_truncated_or_tight'] } });
    expect(v.failures[0].message).toBe('Headline is cut off or too tight to fit');
  });
});

describe('generation review — honest rows', () => {
  it('CRITICAL: a rendered asset that failed visual checks: rendered = yes, visual checks = no', () => {
    const m = buildGenerationReview({ result: resultWith(FAILING_VISUAL) });
    expect(m.quality.renderingCompleted).toBe(true);
    expect(m.quality.visualChecksPassed).toBe(false);
  });

  it('CRITICAL: warnings are human and deduped, never the generic text', () => {
    const m = buildGenerationReview({ result: resultWith(FAILING_VISUAL) });
    expect(m.quality.warnings).toEqual(expect.arrayContaining([
      'Headline is too small to read on mobile (slide 3)',
      'Text overflows the safe area',
      'Low contrast between text and background',
    ]));
    expect(m.quality.warnings.filter((w) => w === 'Text overflows the safe area')).toHaveLength(1);
    expect(m.quality.warnings).not.toContain('Visual check warning');
  });

  it('CRITICAL: a capped asset never shows "Readiness passed" (old cap of exactly 60)', () => {
    const m = buildGenerationReview({ result: resultWith(FAILING_VISUAL, 60) });
    expect(m.quality.readinessPassed).toBe(false);
  });

  it('a passing asset at the threshold still passes', () => {
    const m = buildGenerationReview({ result: resultWith({ passed: true, checks: {}, failures: [] }, READINESS_PASS_THRESHOLD) });
    expect(m.quality.readinessPassed).toBe(true);
    expect(m.quality.visualChecksPassed).toBe(true);
  });
});

describe('readiness cap and inspector badge agree', () => {
  const report = (passed: boolean) => buildCreatorDiagnosticReport({
    assetType: 'image',
    platform: 'linkedin',
    template: { id: 'sys-image-headline', name: 'Bold Headline', version: 1, assetFamily: 'image', renderingContractVersion: 'v1' },
    companyContext: { description: 'x', products: ['y'], positioning: 'z' },
    brandVoice: { tone: 'confident' },
    contentViolations: [],
    renderMetadata: {
      width: 1200, height: 675, platform: 'linkedin',
      overlay_quality: { preset: 'balanced', flags: [] },
      visual_validation: passed
        ? { passed: true, failures: [] }
        : { passed: false, failures: [{ category: 'text_fit', flag: 'headline_truncated_or_tight' }] },
    },
  });

  it('CRITICAL: a visual failure caps readiness BELOW the pass threshold', () => {
    expect(report(false).scores.overallReadiness.value).toBeLessThan(READINESS_PASS_THRESHOLD);
  });

  it('CRITICAL: the inspector shows "Requires Fixes" for a visually failing asset, even with an old 60 score', () => {
    const r = report(false);
    const legacy = { ...r, scores: { ...r.scores, overallReadiness: { ...r.scores.overallReadiness, value: 60 } } };
    const { container } = render(<CreatorQualityInspector report={legacy as typeof r} />);
    expect(container.textContent).toContain('Requires Fixes');
    expect(container.textContent).not.toContain('Needs Review');
  });
});

describe('publish gate', () => {
  const asset = (over: Partial<PackageAsset> = {}): PackageAsset => ({
    id: 'a', assetType: 'image', template: 'T', templateId: 't', variant: null, platform: 'linkedin',
    cta: 'Start free', branding: 'balanced', status: 'completed', previewUrl: null, url: null, files: [],
    caption: null, generatedAt: null, ...over,
  });

  it('CRITICAL: an asset that failed visual checks blocks publishing and scheduling, with the reason', () => {
    const pkg = buildCampaignPackage({
      campaign: { objective: 'o', platforms: ['linkedin'] },
      assets: [asset({ visualPassed: false, visualIssues: ['Text overflows the safe area'] })],
    });
    expect(pkg.readyForPublishing).toBe(false);
    expect(pkg.readyForScheduling).toBe(false);
    expect(pkg.publishBlockedReasons.join(' ')).toContain('failed visual checks: Text overflows the safe area');
  });

  it('passing / not-assessed assets are unaffected', () => {
    for (const visualPassed of [true, null, undefined]) {
      const pkg = buildCampaignPackage({ campaign: { objective: 'o', platforms: ['linkedin'] }, assets: [asset({ visualPassed })] });
      expect(pkg.readyForPublishing).toBe(true);
      expect(pkg.readyForScheduling).toBe(true);
      expect(pkg.publishBlockedReasons).toEqual([]);
    }
  });

  it('CRITICAL: the bridge reads the diagnostic report\'s visual verdict', () => {
    const ctx = { templateName: 'T', templateId: 't', assetFamily: 'image', campaign: { objective: 'o', platforms: ['linkedin'] } };
    const [a] = creatorResultToPackageAssets(resultWith(FAILING_VISUAL), ctx);
    expect(a.visualPassed).toBe(false);
    expect(a.visualIssues).toContain('Text overflows the safe area');
    expect(buildCreatorCampaignPackage(resultWith(FAILING_VISUAL), ctx).readyForPublishing).toBe(false);
    expect(buildCreatorCampaignPackage(resultWith({ passed: true, failures: [] }), ctx).readyForPublishing).toBe(true);
  });

  it('the panel shows why Publish is disabled', () => {
    const pkg = buildCampaignPackage({
      campaign: { objective: 'o', platforms: ['linkedin'] },
      assets: [asset({ visualPassed: false, visualIssues: ['Low contrast between text and background'] })],
    });
    const { container } = render(<CampaignPackagePanel pkg={pkg} onPublish={() => {}} />);
    expect(container.textContent).toContain('Not ready to publish');
    expect(container.textContent).toContain('Low contrast between text and background');
  });
});
