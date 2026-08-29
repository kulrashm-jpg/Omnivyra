/**
 * TRACK D — the shared campaign contract for the ONE semantic-validation gate.
 *
 * Every campaign mode routes through `validateAsset`:
 *   Bold Text        — boltScheduleBlockProcessor / boltContentGenerationForSchedule
 *   Bold Creator     — creatorOrchestrator, via creatorAssetToGenerated
 *   Intelligent Mix  — both of the above, plus the planner's diagnostics lanes
 *
 * so the contract is asserted ONCE, here, over the REAL
 * PLATFORM_CAPABILITY_REGISTRY (11 platforms, not the 8 the schedulers happen to
 * order) and over the real dimension taxonomy. A mode-specific carve-out would
 * fail these tests by construction: nothing below names a mode.
 */

import {
  validateAsset,
  ValidationContext,
  InMemoryLedger,
  creatorAssetToGenerated,
  plannerDropReasonFor,
  cardIdOf,
  type GeneratedAsset,
  type ValidationDimension,
} from '../../../lib/shared/campaign/semanticValidation';
import { PLATFORM_CAPABILITY_REGISTRY } from '../../../lib/shared/social/platformCapabilities';
import { publicDropReason, dropReasonMessage, type DropReasonCode } from '../../../lib/shared/campaign/plannerDiagnostics';

const ALL_PLATFORMS = Object.keys(PLATFORM_CAPABILITY_REGISTRY);

/** One card fanned out to a platform: card-constant fields, per-platform text. */
const sibling = (platform: string, cardId: string, text: string): GeneratedAsset => ({
  content_type: 'post',
  platform,
  text,
  group_id: cardId,
  headline: 'The one card headline',
  cta: 'Book a walkthrough',
  idea_fingerprint: 'idea-card-1',
  narrative_fingerprint: 'narrative-card-1',
});

describe('Track D — registry coverage', () => {
  test('the registry is the source of truth, and it is not eight platforms', () => {
    expect(ALL_PLATFORMS).toHaveLength(11);
    expect(ALL_PLATFORMS).toEqual(expect.arrayContaining([
      'linkedin', 'x', 'facebook', 'instagram', 'pinterest',
      'tiktok', 'youtube', 'reddit', 'whatsapp', 'threads', 'blog',
    ]));
  });
});

describe('Track D — a card may reach every registered platform', () => {
  test('campaign-constant headline/CTA/fingerprints never reject a sibling', () => {
    const ctx = new ValidationContext();
    const accepted: string[] = [];

    for (const platform of ALL_PLATFORMS) {
      const asset = sibling(platform, 'card-1', `Platform-native body for ${platform}.`);
      const verdict = validateAsset(asset, ctx);
      expect(verdict.decision).toBe('ACCEPT');
      ctx.commit(asset);
      accepted.push(platform);
    }

    // All ELEVEN, not the eight the scheduler's PLATFORM_ORDER happens to list.
    expect(accepted).toEqual(ALL_PLATFORMS);
  });

  test('repeated platform + content-type slots are legal when the content differs', () => {
    const ctx = new ValidationContext();
    for (const [i, text] of ['First LinkedIn angle.', 'Second LinkedIn angle.', 'Third LinkedIn angle.'].entries()) {
      const asset = sibling('linkedin', `card-${i}`, text);
      // Distinct cards, so even the card-constant fields differ.
      asset.headline = `Headline ${i}`;
      asset.idea_fingerprint = `idea-${i}`;
      asset.narrative_fingerprint = `narrative-${i}`;
      asset.cta = `CTA ${i}`;
      expect(validateAsset(asset, ctx).decision).toBe('ACCEPT');
      ctx.commit(asset);
    }
  });

  test('content types rotate within one card without colliding', () => {
    const ctx = new ValidationContext();
    for (const contentType of ['post', 'article', 'carousel', 'video']) {
      const asset = { ...sibling('linkedin', 'card-1', `Body for ${contentType}.`), content_type: contentType };
      expect(validateAsset(asset, ctx).decision).toBe('ACCEPT');
      ctx.commit(asset);
    }
  });
});

describe('Track D — real duplication is still protected', () => {
  test('identical text on the same platform+type is caught even inside one card', () => {
    const ctx = new ValidationContext();
    const first = sibling('linkedin', 'card-1', 'Byte-identical body.');
    expect(validateAsset(first, ctx).decision).toBe('ACCEPT');
    ctx.commit(first);

    const repeat = sibling('linkedin', 'card-1', 'Byte-identical body.');
    const verdict = validateAsset(repeat, ctx);
    expect(verdict.decision).toBe('REGENERATE');
    expect(verdict.findings.map((f) => f.dimension)).toContain('duplicate_asset');
  });

  test('a DIFFERENT card reusing the headline is still a duplicate', () => {
    const ctx = new ValidationContext();
    const a = sibling('linkedin', 'card-1', 'Body A.');
    ctx.commit(a);

    const b = sibling('x', 'card-2', 'Completely different body B.');
    const verdict = validateAsset(b, ctx);
    expect(verdict.decision).toBe('REGENERATE');
    expect(verdict.findings.map((f) => f.dimension)).toEqual(
      expect.arrayContaining(['duplicate_headline', 'duplicate_cta', 'duplicate_semantic_idea', 'duplicate_narrative']),
    );
  });

  test('an asset with no card identity keeps the strict pre-existing behaviour', () => {
    const ctx = new ValidationContext();
    const a = { ...sibling('linkedin', '', 'Body A.'), group_id: undefined };
    ctx.commit(a);
    const b = { ...sibling('x', '', 'Body B.'), group_id: undefined };
    expect(validateAsset(b, ctx).decision).toBe('REGENERATE');
  });

  test('historical duplication is still caught regardless of card', () => {
    const ledger = new InMemoryLedger();
    ledger.add('idea-card-1');
    const ctx = new ValidationContext(ledger);

    const verdict = validateAsset(sibling('linkedin', 'card-1', 'Fresh body.'), ctx);
    expect(verdict.findings.map((f) => f.dimension)).toContain('historical_duplication');
    expect(verdict.decision).toBe('REGENERATE');
  });

  test('cross-platform duplication of the same text is still flagged when not shared', () => {
    const ctx = new ValidationContext();
    const a = sibling('linkedin', 'card-1', 'The very same body.');
    ctx.commit(a);
    const b = sibling('x', 'card-1', 'The very same body.');
    const verdict = validateAsset(b, ctx);
    expect(verdict.findings.map((f) => f.dimension)).toContain('cross_platform_duplication');
  });

  test('an explicitly shared cross-post is exempt, as before', () => {
    const ctx = new ValidationContext();
    const a = { ...sibling('linkedin', 'card-1', 'Shared body.'), shared: true };
    ctx.commit(a);
    const b = { ...sibling('x', 'card-1', 'Shared body.'), shared: true };
    expect(validateAsset(b, ctx).findings.map((f) => f.dimension)).not.toContain('cross_platform_duplication');
  });

  test('master-idea inconsistency still DROPs, and card scope cannot rescue it', () => {
    const ctx = new ValidationContext();
    const a = { ...sibling('linkedin', 'card-1', 'Body A.'), variant_id: 'v1', master_idea_id: 'm1' };
    ctx.commit(a);
    const b = { ...sibling('x', 'card-1', 'Body B.'), variant_id: 'v1', master_idea_id: 'm2' };
    expect(validateAsset(b, ctx).decision).toBe('DROP');
  });
});

describe('Track D — drop reasons stay inside the planner taxonomy', () => {
  const DIMENSIONS: ValidationDimension[] = [
    'duplicate_headline', 'duplicate_opening', 'duplicate_cta', 'duplicate_semantic_idea',
    'duplicate_narrative', 'duplicate_slide', 'duplicate_asset', 'cross_platform_duplication',
    'historical_duplication', 'master_idea_consistency',
  ];

  test.each(DIMENSIONS)('%s maps to a real DropReasonCode, never UNKNOWN_ERROR', (dimension) => {
    const decision = dimension === 'master_idea_consistency' ? 'DROP'
      : dimension === 'cross_platform_duplication' ? 'ADAPT' : 'REGENERATE';
    const reason = plannerDropReasonFor({
      decision,
      findings: [{ dimension, detail: 'd' }],
      reason: `${dimension}: d`,
    });
    expect(publicDropReason(reason as DropReasonCode)).not.toBe('UNKNOWN_ERROR');
    expect(dropReasonMessage(reason as DropReasonCode)).not.toBe('This piece could not be scheduled (cause unknown).');
  });

  test('duplication maps to duplicate_content; a structural violation does not', () => {
    expect(plannerDropReasonFor({
      decision: 'REGENERATE',
      findings: [{ dimension: 'duplicate_asset', detail: 'd' }],
      reason: 'x',
    })).toBe('duplicate_content');
    expect(plannerDropReasonFor({
      decision: 'DROP',
      findings: [{ dimension: 'master_idea_consistency', detail: 'd' }],
      reason: 'x',
    })).toBe('validation_failure');
  });

  test('the reason follows the decision, not findings insertion order', () => {
    // duplicate_headline is pushed FIRST, but master_idea_consistency drives the
    // decision — the drop reason must follow the decision.
    expect(plannerDropReasonFor({
      decision: 'DROP',
      findings: [
        { dimension: 'duplicate_headline', detail: 'd' },
        { dimension: 'master_idea_consistency', detail: 'd' },
      ],
      reason: 'x',
    })).toBe('validation_failure');
  });
});

describe('Track D — Bold Creator and Intelligent Mix share the same card identity', () => {
  test('creatorAssetToGenerated carries the card, so creator siblings survive', () => {
    const content = { source_execution_id: 'shared-9', master_idea: { id: 'm1', cta_strategy: 'Book a demo' }, fingerprint: { idea: 'i1', narrative: 'n1' } };
    const ctx = new ValidationContext();

    const first = creatorAssetToGenerated({
      content_type: 'carousel', platform: 'instagram',
      asset_payload: { headline: 'Deck headline', caption: 'Instagram caption.' }, content,
    });
    expect(first.group_id).toBe('shared::shared-9');
    expect(validateAsset(first, ctx).decision).toBe('ACCEPT');
    ctx.commit(first);

    // Same card, different platform, different caption → must NOT be dropped.
    const second = creatorAssetToGenerated({
      content_type: 'carousel', platform: 'pinterest',
      asset_payload: { headline: 'Deck headline', caption: 'Pinterest caption.' }, content,
    });
    expect(validateAsset(second, ctx).decision).toBe('ACCEPT');
  });

  test('a creator asset from ANOTHER card reusing the CTA is still caught', () => {
    const ctx = new ValidationContext();
    const base = { master_idea: { id: 'm1', cta_strategy: 'Book a demo' }, fingerprint: { idea: 'i1', narrative: 'n1' } };

    const first = creatorAssetToGenerated({
      content_type: 'carousel', platform: 'instagram',
      asset_payload: { headline: 'H1', caption: 'Caption one.' },
      content: { ...base, source_execution_id: 'card-a' },
    });
    ctx.commit(first);

    const other = creatorAssetToGenerated({
      content_type: 'carousel', platform: 'pinterest',
      asset_payload: { headline: 'H2', caption: 'Caption two.' },
      content: { ...base, source_execution_id: 'card-b' },
    });
    const verdict = validateAsset(other, ctx);
    expect(verdict.decision).toBe('REGENERATE');
    expect(verdict.findings.map((f) => f.dimension)).toEqual(
      expect.arrayContaining(['duplicate_cta', 'duplicate_semantic_idea']),
    );
  });

  test('card identity precedence is shared: source → master → execution → none', () => {
    expect(cardIdOf({ source_execution_id: 's', master_content_id: 'm', execution_id: 'e' })).toBe('shared::s');
    expect(cardIdOf({ master_content_id: 'm', execution_id: 'e' })).toBe('master::m');
    expect(cardIdOf({ execution_id: 'e' })).toBe('unique::e');
    expect(cardIdOf({})).toBe('');
    expect(cardIdOf(null)).toBe('');
  });
});
