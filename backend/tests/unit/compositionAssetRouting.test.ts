/**
 * Composition asset routing — usage decides how an asset is consumed.
 *
 * WHY THIS EXISTS
 * ---------------
 * Phase 43 said what a file is, Phase 44 said how it is used, and neither made
 * the declaration do anything. This suite pins the layer that acts on it, and
 * the property it protects is one a user cannot see until it has already gone
 * wrong: a logo marked as an exact brand mark must never be handed to a
 * generative model, and a photograph meant to steer generation must never be
 * pasted on as a deterministic overlay. Both produce plausible output. Only one
 * is what was asked for.
 *
 * So the rules here fail closed, and the mutation guards target exactly the
 * edits that would make them stop failing: collapsing the two lanes, letting an
 * undeclared template accept anything, or "helpfully" correcting a stated mode.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import * as fs from 'fs';
import * as path from 'path';

/* ── stores backing the resolution tests ───────────────────────────────────*/
type Row = Record<string, unknown>;
const assets: Row[] = [];
const refs: Row[] = [];
let seq = 0;

function applyFilters(rows: Row[], f: Record<string, unknown>): Row[] {
  return rows.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v));
}

function builderFor(table: string) {
  const rows = table === 'canonical_media_assets' ? assets : refs;
  const filters: Record<string, unknown> = {};
  const b: Record<string, unknown> = {
    select: () => b,
    order: () => b,
    limit: () => b,
    eq(col: string, val: unknown) { filters[col] = val; return b; },
    then(resolve: (r: { data: Row[]; error: null }) => unknown) {
      return Promise.resolve(resolve({ data: applyFilters(rows, filters), error: null }));
    },
    maybeSingle() {
      return Promise.resolve({ data: applyFilters(rows, filters)[0] ?? null, error: null });
    },
    single() {
      return Promise.resolve({ data: applyFilters(rows, filters)[0] ?? null, error: null });
    },
  };
  return b;
}

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => ({
    select: () => builderFor(table),
    insert: () => builderFor(table),
    update: () => builderFor(table),
    delete: () => builderFor(table),
  }),
}));

import {
  COMPOSITION_ASSET_PURPOSES,
  type CompositionAssetMode,
  type CompositionAssetPurpose,
  type CompositionAssetReference,
} from '../../../lib/content/compositionAssetReference';
import {
  defaultModeForPurpose,
  isModeAllowedForPurpose,
  modePolicyForPurpose,
  purposesWithoutPolicy,
  routeCompositionReferences,
  templateAcceptsReferences,
  toAdditionalReferences,
  type TemplateAssetSlot,
} from '../../../lib/content/compositionAssetRouting';
import { resolveCompositionAssets } from '../../services/compositionAssetResolutionService';

const COMPANY_A = 'company-aaaa';
const COMPANY_B = 'company-bbbb';
const NO_REF_PROVIDER = { acceptsReferenceImages: false, maxReferenceImages: 0 };
const REF_PROVIDER = { acceptsReferenceImages: true, maxReferenceImages: 4 };

function ref(
  purpose: CompositionAssetPurpose,
  mode: CompositionAssetMode,
  over: Partial<CompositionAssetReference> = {},
): CompositionAssetReference {
  seq += 1;
  return {
    id: `ref-${seq}`,
    companyId: COMPANY_A,
    compositionType: 'creator_card',
    compositionId: 'comp-1',
    assetId: `asset-${seq}`,
    purpose,
    mode,
    ordinal: seq,
    // Required by the foundation contract: per-USE attributes, always an object
    // so consumers never branch on null. Empty here because routing reads none
    // of it — metadata is trace and presentation, never a routing input.
    metadata: {},
    createdAt: `T${seq}`,
    updatedAt: `T${seq}`,
    ...over,
  };
}

const item = (r: CompositionAssetReference) => ({ reference: r, sourceUrl: `media-uploads/${r.assetId}.png` });

/**
 * Phase 59B: a compose-mode slot must declare placement or the reference is
 * refused — there is no fallback geometry. These fixtures therefore carry
 * placement on every slot that can accept compose. The value is arbitrary here
 * (routing never reads the numbers, only their validity); the DECIDED
 * production geometry is pinned separately in composeLogoPlacement.test.ts.
 */
const FIXTURE_PLACEMENT = { top: 0.1, left: 0.1, maxWidth: 0.2, maxHeight: 0.2, fit: 'contain' as const };

const SLOTS: TemplateAssetSlot[] = [
  { purpose: 'subject', mode: 'condition' },
  { purpose: 'background', placement: FIXTURE_PLACEMENT },
  { purpose: 'logo', mode: 'compose', placement: FIXTURE_PLACEMENT },
  { purpose: 'product', max: 2, placement: FIXTURE_PLACEMENT },
  { purpose: 'overlay', placement: FIXTURE_PLACEMENT },
  { purpose: 'style_reference' },
];

beforeEach(() => { assets.length = 0; refs.length = 0; seq = 0; });

describe('A — mode policy', () => {
  it('every purpose has a policy', () => {
    expect(purposesWithoutPolicy()).toEqual([]);
    expect(COMPOSITION_ASSET_PURPOSES.length).toBeGreaterThan(0);
  });

  it('overlay is compose-only — conditioning on it is a contradiction', () => {
    expect(modePolicyForPurpose('overlay').allowed).toEqual(['compose']);
    expect(isModeAllowedForPurpose('overlay', 'condition')).toBe(false);
  });

  it('style/composition/realism references are condition-only', () => {
    for (const p of ['style_reference', 'composition_reference', 'realism_reference'] as const) {
      expect(modePolicyForPurpose(p).allowed).toEqual(['condition']);
      expect(isModeAllowedForPurpose(p, 'compose')).toBe(false);
    }
  });

  it('a brand mark defaults to exact, a photograph defaults to generative', () => {
    expect(defaultModeForPurpose('logo')).toBe('compose');
    expect(defaultModeForPurpose('favicon')).toBe('compose');
    expect(defaultModeForPurpose('subject')).toBe('condition');
    expect(defaultModeForPurpose('background')).toBe('condition');
    expect(defaultModeForPurpose('product')).toBe('condition');
  });

  it('a default is only a default — the other mode stays available', () => {
    expect(isModeAllowedForPurpose('logo', 'condition')).toBe(true);
    expect(isModeAllowedForPurpose('subject', 'compose')).toBe(true);
  });
});

describe('B — COMPOSE vs CONDITION routing', () => {
  it('splits the lanes by declared mode', () => {
    const r = routeCompositionReferences({
      references: [item(ref('logo', 'compose')), item(ref('subject', 'condition'))],
      templateSlots: SLOTS,
      provider: REF_PROVIDER,
    });
    expect(r.compose.map((x) => x.reference.purpose)).toEqual(['logo']);
    expect(r.condition.map((x) => x.reference.purpose)).toEqual(['subject']);
    expect(r.rejected).toEqual([]);
  });

  it('CRITICAL: a stated mode is never silently converted', () => {
    // overlay is compose-only. Asking for condition must FAIL, not be corrected.
    const r = routeCompositionReferences({
      references: [item(ref('overlay', 'condition'))],
      templateSlots: SLOTS,
      provider: REF_PROVIDER,
    });
    expect(r.compose).toHaveLength(0);
    expect(r.condition).toHaveLength(0);
    expect(r.rejected[0].reason).toBe('mode_not_allowed_for_purpose');
  });

  it('CRITICAL: an exact logo never reaches the generative lane', () => {
    const r = routeCompositionReferences({
      references: [item(ref('logo', 'compose'))],
      templateSlots: SLOTS,
      provider: REF_PROVIDER,
    });
    expect(r.condition).toHaveLength(0);
    expect(toAdditionalReferences(r.condition)).toHaveLength(0);
    expect(r.compose).toHaveLength(1);
  });

  it('a template slot may narrow a purpose to one mode', () => {
    // slot for logo is compose-only, even though the purpose allows both.
    const r = routeCompositionReferences({
      references: [item(ref('logo', 'condition'))],
      templateSlots: SLOTS,
      provider: REF_PROVIDER,
    });
    expect(r.rejected[0].reason).toBe('mode_not_allowed_by_template_slot');
  });

  it('nothing is ever silently discarded — every refusal carries a reason', () => {
    const r = routeCompositionReferences({
      references: [item(ref('overlay', 'condition')), item(ref('favicon', 'compose'))],
      templateSlots: SLOTS,
      provider: REF_PROVIDER,
    });
    const accounted = r.compose.length + r.condition.length + r.rejected.length;
    expect(accounted).toBe(2);
    for (const rej of r.rejected) expect(rej.detail.length).toBeGreaterThan(0);
  });
});

describe('C — template compatibility', () => {
  it('a template declaring no slots accepts nothing (fail closed)', () => {
    expect(templateAcceptsReferences(undefined)).toBe(false);
    expect(templateAcceptsReferences([])).toBe(false);
    const r = routeCompositionReferences({
      references: [item(ref('subject', 'condition'))],
      templateSlots: undefined,
      provider: REF_PROVIDER,
    });
    expect(r.rejected[0].reason).toBe('template_accepts_no_references');
  });

  it('an undeclared purpose is refused', () => {
    const r = routeCompositionReferences({
      references: [item(ref('dashboard', 'condition'))],
      templateSlots: SLOTS,
      provider: REF_PROVIDER,
    });
    expect(r.rejected[0].reason).toBe('purpose_not_accepted_by_template');
  });

  it('slot capacity is enforced, default 1', () => {
    const r = routeCompositionReferences({
      references: [
        item(ref('subject', 'condition')),
        item(ref('subject', 'condition')),
        item(ref('product', 'condition')),
        item(ref('product', 'condition')),
      ],
      templateSlots: SLOTS,
      provider: REF_PROVIDER,
    });
    // subject max defaults to 1 -> second refused; product max 2 -> both kept.
    expect(r.condition.filter((x) => x.reference.purpose === 'subject')).toHaveLength(1);
    expect(r.condition.filter((x) => x.reference.purpose === 'product')).toHaveLength(2);
    expect(r.rejected.filter((x) => x.reason === 'slot_capacity_exceeded')).toHaveLength(1);
  });
});

describe('D — provider cardinality and degradation', () => {
  it('the condition lane is capped by provider capability', () => {
    const r = routeCompositionReferences({
      references: [
        item(ref('subject', 'condition')), item(ref('background', 'condition')),
        item(ref('product', 'condition')), item(ref('product', 'condition')),
        item(ref('style_reference', 'condition')),
      ],
      templateSlots: SLOTS,
      provider: { acceptsReferenceImages: true, maxReferenceImages: 3 },
    });
    expect(r.condition).toHaveLength(3);
    expect(r.rejected.some((x) => x.reason === 'provider_reference_limit_exceeded')).toBe(true);
  });

  it('the compose lane is NOT capped by provider limits — it never reaches the provider', () => {
    const r = routeCompositionReferences({
      references: [item(ref('logo', 'compose')), item(ref('overlay', 'compose'))],
      templateSlots: SLOTS,
      provider: NO_REF_PROVIDER,
    });
    expect(r.compose).toHaveLength(2);
    expect(r.rejected).toEqual([]);
  });

  it('text degradation is REPORTED, not hidden', () => {
    // Acceptable for a style reference; emphatically not for a person. The
    // caller must be able to tell, so it is surfaced rather than swallowed.
    const r = routeCompositionReferences({
      references: [item(ref('subject', 'condition'))],
      templateSlots: SLOTS,
      provider: NO_REF_PROVIDER,
    });
    expect(r.conditionDegradedToText).toBe(true);
    expect(r.condition).toHaveLength(1); // preserved, not dropped
  });

  it('ordering is deterministic and preserved within a lane', () => {
    const a = ref('subject', 'condition');
    const b = ref('background', 'condition');
    const c = ref('style_reference', 'condition');
    const r = routeCompositionReferences({
      references: [item(a), item(b), item(c)],
      templateSlots: SLOTS,
      provider: REF_PROVIDER,
    });
    expect(r.condition.map((x) => x.reference.id)).toEqual([a.id, b.id, c.id]);
  });
});

describe('E — adapter onto the existing provider seam', () => {
  it('composition-only purposes map to a provider purpose and keep intent in hint', () => {
    const r = routeCompositionReferences({
      references: [item(ref('subject', 'condition')), item(ref('background', 'condition'))],
      templateSlots: SLOTS,
      provider: REF_PROVIDER,
    });
    const out = toAdditionalReferences(r.condition);
    expect(out).toHaveLength(2);
    for (const o of out) {
      // Only the eight provider purposes may cross the seam.
      expect(['logo', 'favicon', 'dashboard', 'ui_surface', 'product_screenshot',
        'style_reference', 'composition_reference', 'realism_reference']).toContain(o.purpose);
      expect(typeof o.hint).toBe('string');
      expect(o.hint!.length).toBeGreaterThan(0);
    }
    expect(out[0].hint).toMatch(/subject/i);
    expect(out[1].hint).toMatch(/background/i);
  });

  it('an already-provider purpose passes through unchanged', () => {
    const r = routeCompositionReferences({
      references: [item(ref('style_reference', 'condition'))],
      templateSlots: SLOTS,
      provider: REF_PROVIDER,
    });
    expect(toAdditionalReferences(r.condition)[0].purpose).toBe('style_reference');
  });

  it('the adapter emits the ReferenceImage shape the existing seam accepts', () => {
    const r = routeCompositionReferences({
      references: [item(ref('subject', 'condition'))],
      templateSlots: SLOTS,
      provider: REF_PROVIDER,
    });
    const [first] = toAdditionalReferences(r.condition);
    expect(Object.keys(first).sort()).toEqual(['hint', 'purpose', 'url']);
  });
});

describe('F — resolution: tenancy, lifecycle, reuse', () => {
  function seedAsset(companyId: string, id: string, lifecycle = 'ready') {
    assets.push({
      id, company_id: companyId, storage_bucket: 'media-uploads',
      storage_path: `${companyId}/${id}.png`, mime_type: 'image/png',
      origin: 'upload', lifecycle_state: lifecycle, metadata: {},
      created_at: 'T0', updated_at: 'T0', created_by: 'user-1',
      byte_size: 10, width: 10, height: 10, checksum_sha256: null,
      original_filename: null, source_url: null,
    });
  }
  function seedRef(companyId: string, assetId: string, purpose: string, mode: string, ordinal = 0, compId = 'comp-1') {
    seq += 1;
    refs.push({
      id: `r${seq}`, company_id: companyId, composition_type: 'creator_card',
      composition_id: compId, asset_id: assetId, purpose, mode, ordinal,
      created_at: `T${seq}`, updated_at: `T${seq}`,
    });
  }

  const base = { companyId: COMPANY_A, compositionType: 'creator_card', compositionId: 'comp-1', templateSlots: SLOTS, provider: REF_PROVIDER };

  it('resolves a ready asset into the condition lane', async () => {
    seedAsset(COMPANY_A, 'a1');
    seedRef(COMPANY_A, 'a1', 'subject', 'condition');
    const out = await resolveCompositionAssets(base);
    expect(out.routing.condition).toHaveLength(1);
    expect(out.additionalReferences).toHaveLength(1);
    expect(out.rejected).toEqual([]);
  });

  it('CRITICAL: a pending or failed asset is refused, never sent', async () => {
    seedAsset(COMPANY_A, 'p1', 'pending');
    seedAsset(COMPANY_A, 'f1', 'failed');
    seedRef(COMPANY_A, 'p1', 'subject', 'condition');
    seedRef(COMPANY_A, 'f1', 'background', 'condition');
    const out = await resolveCompositionAssets(base);
    expect(out.additionalReferences).toHaveLength(0);
    expect(out.rejected).toHaveLength(2);
    for (const r of out.rejected) expect(r.reason).toBe('asset_not_ready');
  });

  it('CRITICAL: another company\'s asset cannot be resolved', async () => {
    seedAsset(COMPANY_B, 'b1');           // owned by B
    seedRef(COMPANY_A, 'b1', 'subject', 'condition'); // A points at it
    const out = await resolveCompositionAssets(base);
    expect(out.additionalReferences).toHaveLength(0);
    expect(out.rejected[0].reason).toBe('asset_not_found');
  });

  it('created_by is never an authorization input', async () => {
    // Asset uploaded by user-1; resolution is by company only.
    seedAsset(COMPANY_A, 'a1');
    seedRef(COMPANY_A, 'a1', 'subject', 'condition');
    const out = await resolveCompositionAssets(base);
    expect(out.routing.condition).toHaveLength(1);
  });

  it('the SAME asset serves different purposes and modes in different compositions', async () => {
    seedAsset(COMPANY_A, 'shared');
    seedRef(COMPANY_A, 'shared', 'subject', 'condition', 0, 'comp-1');
    seedRef(COMPANY_A, 'shared', 'logo', 'compose', 0, 'comp-2');

    const c1 = await resolveCompositionAssets(base);
    const c2 = await resolveCompositionAssets({ ...base, compositionId: 'comp-2' });

    expect(c1.routing.condition[0].reference.purpose).toBe('subject');
    expect(c2.routing.compose[0].reference.purpose).toBe('logo');
    expect(assets).toHaveLength(1); // one file, two roles
  });

  it('storage location is not a public URL', async () => {
    seedAsset(COMPANY_A, 'a1');
    seedRef(COMPANY_A, 'a1', 'subject', 'condition');
    const out = await resolveCompositionAssets(base);
    const url = out.additionalReferences[0].url;
    expect(url).toBe('media-uploads/company-aaaa/a1.png');
    expect(url).not.toMatch(/^https?:\/\//);
    expect(url).not.toContain('/storage/v1/object/public/');
  });
});

/**
 * Reconciliation against the concurrent foundation change (`5251dec4`), which
 * added the `supporting` purpose and made `metadata` required.
 *
 * Both are the kind of change that a downstream layer can absorb wrongly and
 * quietly: a missing policy entry invites an `as any` or a catch-all default,
 * and a newly-required field invites making it optional again "just for the
 * tests". Either would look like reconciliation while actually eroding the
 * foundation, so both are pinned here.
 */
describe('R — reconciliation with the foundation', () => {
  const SUPPORTING_SLOTS: TemplateAssetSlot[] = [
    ...SLOTS,
    { purpose: 'supporting', max: 2, placement: FIXTURE_PLACEMENT },
  ];

  it('supporting has an explicit policy — no catch-all, no default fallback', () => {
    expect(purposesWithoutPolicy()).toEqual([]);
    expect(modePolicyForPurpose('supporting').allowed).toEqual(['compose', 'condition']);
  });

  it('supporting defaults to COMPOSE, matching the foundation\'s own usage', () => {
    // The contract calls it an image that "occupies its own place in the
    // composition", and the foundation's test exercises mode:'compose'.
    expect(defaultModeForPurpose('supporting')).toBe('compose');
  });

  it('supporting is not compose-ONLY — unlike overlay, conditioning on it is meaningful', () => {
    expect(isModeAllowedForPurpose('supporting', 'condition')).toBe(true);
    expect(isModeAllowedForPurpose('overlay', 'condition')).toBe(false);
  });

  it('supporting routes into both lanes according to its stated mode', () => {
    const r = routeCompositionReferences({
      references: [
        item(ref('supporting', 'compose')),
        item(ref('supporting', 'condition')),
      ],
      templateSlots: SUPPORTING_SLOTS,
      provider: { acceptsReferenceImages: true, maxReferenceImages: 4 },
    });
    expect(r.compose).toHaveLength(1);
    expect(r.condition).toHaveLength(1);
    expect(r.rejected).toEqual([]);
  });

  it('a template that declares no supporting slot still rejects it', () => {
    const r = routeCompositionReferences({
      references: [item(ref('supporting', 'compose'))],
      templateSlots: SLOTS, // no supporting slot
      provider: { acceptsReferenceImages: true, maxReferenceImages: 4 },
    });
    expect(r.rejected[0].reason).toBe('purpose_not_accepted_by_template');
  });

  it('metadata is REQUIRED on the reference contract, and never a ROUTING input', () => {
    const r = ref('subject', 'condition');
    // Present on every reference the routing layer sees...
    expect(r.metadata).toEqual({});

    const ROUTING_SRC = fs.readFileSync(
      path.resolve(__dirname, '../../../lib/content/compositionAssetRouting.ts'), 'utf8');
    const body = ROUTING_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    // ...and never read where a ROUTING DECISION is made. `routeCompositionReferences`
    // and `slotAcceptance` decide lane, acceptance and refusal, and they must do so
    // from purpose, mode and slots alone — those are columns precisely so the
    // database constrains them, and a decision keyed on free-form JSON would be
    // unconstrained by anything.
    const decisionRegion = body.slice(
      body.indexOf('export function slotAcceptance'),
      body.indexOf('export function toAdditionalReferences'),
    );
    expect(decisionRegion.length).toBeGreaterThan(0);
    expect(decisionRegion).not.toMatch(/\.metadata\b/);

    // The PROJECTION into provider references may read it: a user's own words
    // about their image become the reference hint, which is prompt text and not
    // a routing decision. That read is confined to one named accessor.
    expect(body).toContain('export function userInstructionFor');
    const metadataReads = body.match(/\.metadata\b/g) ?? [];
    expect(metadataReads).toHaveLength(1);
  });

  it('MUTATION GUARD: the policy map stays exhaustive by TYPE, not by fallback', () => {
    const SRC = fs.readFileSync(
      path.resolve(__dirname, '../../../lib/content/compositionAssetRouting.ts'), 'utf8');
    // Record<CompositionAssetPurpose, …> is what makes a new foundation purpose
    // a compile error. A Partial<> or an `?? DEFAULT` would silently absorb it.
    expect(SRC).toContain('Record<CompositionAssetPurpose, PurposeModePolicy>');
    expect(SRC).not.toMatch(/Partial<Record<CompositionAssetPurpose/);
    expect(SRC).not.toMatch(/PURPOSE_MODE_POLICY\[[^\]]+\]\s*\?\?/);
    expect(SRC).not.toMatch(/as any/);
  });

  it('MUTATION GUARD: metadata was not made optional to appease downstream tests', () => {
    const CONTRACT = fs.readFileSync(
      path.resolve(__dirname, '../../../lib/content/compositionAssetReference.ts'), 'utf8');
    // Required on the stored shape; optional only on the creation input.
    expect(CONTRACT).toMatch(/^\s{2}metadata: Record<string, unknown>;$/m);
    expect(CONTRACT).toMatch(/^\s{2}metadata\?: Record<string, unknown>;$/m);
  });
});

describe('G — mutation guards', () => {
  const ROUTING = fs.readFileSync(
    path.resolve(__dirname, '../../../lib/content/compositionAssetRouting.ts'), 'utf8');
  const RESOLVER = fs.readFileSync(
    path.resolve(__dirname, '../../services/compositionAssetResolutionService.ts'), 'utf8');
  const TYPES = fs.readFileSync(
    path.resolve(__dirname, '../../../lib/creator-templates/types.ts'), 'utf8');

  it('MUTATION GUARD: the two lanes stay separate', () => {
    // Merging compose into condition would silently send exact assets through
    // generative reinterpretation, and every functional test above would still
    // pass if the lanes were merely concatenated at the end.
    expect(ROUTING).toMatch(/compose:\s*RoutedReference\[\]/);
    expect(ROUTING).toMatch(/condition:\s*RoutedReference\[\]/);
    expect(ROUTING).toContain("if (r.mode === 'compose') compose.push");
    expect(ROUTING).not.toMatch(/\.\.\.compose,\s*\.\.\.condition/);
  });

  it('MUTATION GUARD: only the condition lane crosses the provider seam', () => {
    expect(ROUTING).toMatch(/toAdditionalReferences\(condition: readonly RoutedReference\[\]\)/);
  });

  it('MUTATION GUARD: no auto-correction of a stated mode', () => {
    // A tempting "fix" is to coerce an illegal mode to the purpose's default.
    expect(ROUTING).not.toMatch(/mode\s*=\s*defaultModeForPurpose/);
    // The refusal now lives in the shared `slotAcceptance` predicate — the one
    // both the router and the surface that offers usages consult — so the guard
    // follows it there rather than pinning the call it used to be written as.
    expect(ROUTING).toContain("reason: 'mode_not_allowed_for_purpose'");
  });

  it('MUTATION GUARD: undeclared template slots stay fail-closed', () => {
    expect(ROUTING).toContain("reason: 'template_accepts_no_references'");
    expect(ROUTING).toMatch(/return Array\.isArray\(slots\) && slots\.length > 0;/);
  });

  it('MUTATION GUARD: resolution is company-scoped and lifecycle-gated', () => {
    expect(RESOLVER).toContain('getCanonicalMediaAsset(input.companyId, reference.assetId)');
    expect(RESOLVER).toContain('isUsableMediaAsset(asset)');
    // created_by must never become an authorization input.
    expect(RESOLVER).not.toMatch(/createdBy\s*===/);
  });

  it('MUTATION GUARD: the provider seam is untouched by this phase', () => {
    // The whole point is that the contract feeds an EXISTING parameter rather
    // than reaching into the provider. Comments are stripped first: the docs
    // legitimately NAME these seams to explain what they deliberately do not
    // call, and a guard that cannot tell prose from code is worthless.
    const code = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const src of [code(RESOLVER), code(ROUTING)]) {
      expect(src).not.toMatch(/images\.edit|generateProviderImage|gpt-image/);
      expect(src).not.toMatch(/from '.*creatorAssetRenderer/);
    }
  });

  it('MUTATION GUARD: template slots are optional and additive', () => {
    expect(TYPES).toMatch(/assetSlots\?: TemplateAssetSlot\[\];/);
    expect(TYPES).toContain("import type { TemplateAssetSlot }");
  });
});
