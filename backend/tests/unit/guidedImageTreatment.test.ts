/**
 * Phase 60G-N — "Let us choose": proposing how a user's image should be used.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * A novice can attach a photograph but cannot answer "is this a subject, a
 * product, a background or a style reference?" — that is the product's question,
 * not theirs. "Let us choose" answers it for them.
 *
 * The failure that matters is a proposal the runtime would refuse: telling
 * someone "we'll use your image as the main subject" and then having routing
 * discard it. So the central assertion here is not that the chooser is clever —
 * it is that **every proposal it can ever make is one the router would admit**,
 * checked against all 242 canonical designs through the same predicate the
 * router itself uses.
 *
 * The second failure is a persisted half-decision. "Let us choose" must create
 * NO composition reference until a concrete treatment is accepted, because a
 * row whose purpose the user never agreed to is exactly the kind of untruth
 * this architecture has spent its whole life removing.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import * as fs from 'fs';
import * as path from 'path';

import {
  proposeImageTreatment,
  describeTreatment,
  PROPOSABLE_PURPOSES,
} from '../../../lib/content/guidedCreativeDirection';
import {
  slotAcceptance,
  defaultModeForPurpose,
  type TemplateAssetSlot,
} from '../../../lib/content/compositionAssetRouting';
import { listCanonicalTemplatesForFamily } from '../../../lib/creator-templates';
import { registerCuratedSystemTemplates } from '../../../lib/creator-outcomes/curatedSystemTemplatesFull';
import type { CreatorTemplate } from '../../../lib/creator-templates/types';

const ALL_FOUR: TemplateAssetSlot[] = [
  { purpose: 'subject' }, { purpose: 'product' },
  { purpose: 'background' }, { purpose: 'style_reference' },
];
const BACKGROUND_ONLY: TemplateAssetSlot[] = [{ purpose: 'background' }];
const LOGO_ONLY: TemplateAssetSlot[] = [{
  purpose: 'logo', mode: 'compose', max: 1,
  placement: { top: 0.35, left: 0.35, maxWidth: 0.3, maxHeight: 0.3, fit: 'contain' },
}];

/* ── A. One answer, always, and only from the four ──────────────────────────*/

describe('A — the proposal is bounded and total', () => {
  it('only ever proposes a CONDITION purpose', () => {
    expect([...PROPOSABLE_PURPOSES].sort())
      .toEqual(['background', 'product', 'style_reference', 'subject']);
    for (const p of PROPOSABLE_PURPOSES) expect(defaultModeForPurpose(p)).toBe('condition');
  });

  it('CRITICAL: never proposes a COMPOSE purpose, even when that is all the template has', () => {
    // `sys-image-logo-only` accepts logo and nothing else. Proposing it would
    // mean proposing exact placement, which the chooser must never do.
    const out = proposeImageTreatment({ templateSlots: LOGO_ONLY });
    expect(out.purpose).toBeNull();
    expect(out.basis).toBe('cannot_decide');
  });

  it('returns cannot_decide rather than guessing when nothing is acceptable', () => {
    for (const slots of [null, undefined, []]) {
      expect(proposeImageTreatment({ templateSlots: slots as never }).purpose).toBeNull();
    }
  });

  it('is deterministic — same inputs, same answer', () => {
    const input = { templateSlots: ALL_FOUR, subject: 'person' as const, instruction: 'keep me prominent' };
    const a = proposeImageTreatment(input);
    for (let i = 0; i < 25; i += 1) expect(proposeImageTreatment(input)).toEqual(a);
  });
});

/* ── B. Signal priority ─────────────────────────────────────────────────────*/

describe('B — the user is listened to in the right order', () => {
  it('CRITICAL: their own words about the image outrank everything else', () => {
    // They said "featured: a person", then wrote "use this as the background".
    // The sentence they typed about THIS image wins.
    const out = proposeImageTreatment({
      templateSlots: ALL_FOUR, subject: 'person', instruction: 'use this as the background please',
    });
    expect(out.purpose).toBe('background');
    expect(out.basis).toBe('user_instruction');
  });

  it('an instruction asking for inspiration becomes a style reference, not a copy', () => {
    const out = proposeImageTreatment({
      templateSlots: ALL_FOUR, instruction: 'use this as inspiration but don\'t copy it exactly',
    });
    expect(out.purpose).toBe('style_reference');
    expect(out.basis).toBe('user_instruction');
  });

  it('the featured-subject answer decides when there is no instruction', () => {
    expect(proposeImageTreatment({ templateSlots: ALL_FOUR, subject: 'person' }))
      .toEqual({ purpose: 'subject', basis: 'subject_choice' });
    expect(proposeImageTreatment({ templateSlots: ALL_FOUR, subject: 'product' }))
      .toEqual({ purpose: 'product', basis: 'subject_choice' });
  });

  it('CRITICAL: "just text and background" never makes their photo the subject', () => {
    // They explicitly asked for no person and no product in the frame.
    const out = proposeImageTreatment({ templateSlots: ALL_FOUR, subject: 'text-only' });
    expect(out.purpose).toBe('background');
    expect(['subject', 'product']).not.toContain(out.purpose);
  });

  it('the brief is read only when the user answered nothing', () => {
    const out = proposeImageTreatment({ templateSlots: ALL_FOUR, brief: 'launch our new product' });
    expect(out.purpose).toBe('product');
    expect(out.basis).toBe('brief');
  });

  it('a product design asks for a product when nothing else has spoken', () => {
    expect(proposeImageTreatment({ templateSlots: ALL_FOUR, templateCategory: 'Product' }))
      .toEqual({ purpose: 'product', basis: 'template_contract' });
  });

  it('a photographic look invites a real subject; an illustrated one a style anchor', () => {
    expect(proposeImageTreatment({ templateSlots: ALL_FOUR, visualDirectionId: 'real-photography' }))
      .toEqual({ purpose: 'subject', basis: 'visual_look' });
    expect(proposeImageTreatment({ templateSlots: ALL_FOUR, visualDirectionId: 'watercolor' }))
      .toEqual({ purpose: 'style_reference', basis: 'visual_look' });
  });

  it('CRITICAL: ambiguity resolves to background, never to subject', () => {
    // A background that should have been a subject is a muted result. A subject
    // that should have been a background puts a person at the centre of a
    // composition nobody asked for.
    const out = proposeImageTreatment({ templateSlots: ALL_FOUR });
    expect(out.purpose).toBe('background');
    expect(out.basis).toBe('conservative_default');
  });
});

/* ── C. It can only propose what the design accepts ─────────────────────────*/

describe('C — compatibility is consulted, never re-implemented', () => {
  it('falls through to the next candidate when the first is unacceptable', () => {
    // Wants `subject`, template offers only `background`.
    const out = proposeImageTreatment({ templateSlots: BACKGROUND_ONLY, subject: 'person' });
    expect(out.purpose).toBe('background');
  });

  it('CRITICAL: every proposal it can make is one routing would ADMIT — all 242 designs', () => {
    registerCuratedSystemTemplates();
    const templates = (['image', 'carousel', 'infographic'] as const)
      .flatMap((f) => listCanonicalTemplatesForFamily(f) as CreatorTemplate[]);
    expect(templates).toHaveLength(242);

    const rejected: string[] = [];
    const subjects = [null, 'person', 'product', 'both', 'text-only'] as const;
    const instructions = [null, 'use this as the background', 'keep me prominent', 'just inspiration'];
    for (const t of templates) {
      for (const subject of subjects) {
        for (const instruction of instructions) {
          const out = proposeImageTreatment({
            templateSlots: t.assetSlots, templateCategory: t.category,
            templatePurposeKey: t.renderingContract?.purposeKey ?? null,
            subject: subject as never, instruction,
          });
          if (!out.purpose) continue; // cannot_decide is always safe
          const ok = slotAcceptance(t.assetSlots, out.purpose, defaultModeForPurpose(out.purpose)).ok;
          if (!ok) rejected.push(`${t.id}:${out.purpose}`);
        }
      }
    }
    expect(rejected).toEqual([]);
  });

  it('infographics are never proposed a subject', () => {
    registerCuratedSystemTemplates();
    for (const t of listCanonicalTemplatesForFamily('infographic') as CreatorTemplate[]) {
      const out = proposeImageTreatment({ templateSlots: t.assetSlots, subject: 'person' });
      expect(out.purpose).not.toBe('subject');
    }
  });
});

/* ── D. What we tell the user ───────────────────────────────────────────────*/

describe('D — the promise matches what the renderer actually does', () => {
  it('every proposable purpose is described referentially, because every one conditions', () => {
    for (const p of PROPOSABLE_PURPOSES) {
      const { headline, promise } = describeTreatment(p as never);
      expect(headline).toMatch(/^We’ll use your image/);
      expect(promise).toContain('may differ from the original');
      expect(promise).not.toContain('placed exactly');
    }
  });

  it('the wording is DERIVED from mode, so it cannot drift from the runtime', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../lib/content/guidedCreativeDirection.ts'), 'utf8');
    expect(src).toContain("defaultModeForPurpose(purpose) === 'compose'");
  });

  it('no internal vocabulary reaches the user-facing strings', () => {
    // Plain words like "background" are fine — they are English. What must never
    // surface is the machinery: purposes as identifiers, modes, slots, routing.
    for (const p of PROPOSABLE_PURPOSES) {
      const text = JSON.stringify(describeTreatment(p as never)).toLowerCase();
      for (const jargon of ['style_reference', 'purpose', 'condition', 'compose',
                            'slot', 'resolver', 'asset', 'metadata', 'null']) {
        expect(text).not.toContain(jargon);
      }
    }
  });
});

/* ── E. Nothing is persisted until it is accepted ───────────────────────────*/

describe('E — hold until accepted', () => {
  const PANEL = fs.readFileSync(
    path.resolve(__dirname, '../../../components/creator/CreatorImageAssetPanel.tsx'), 'utf8');

  it('CRITICAL: choosing "Let us choose" attaches nothing', () => {
    // The button only raises the request; `attach` is reachable solely from
    // "Looks right" and from an explicit usage button.
    expect(PANEL).toMatch(/onClick=\{\(\) => setLetUsChoose\(true\)\}/);
    expect(PANEL).not.toMatch(/setLetUsChoose\(true\)[\s\S]{0,120}void attach\(/);
  });

  it('accepting attaches the concrete proposed purpose through the ONE existing path', () => {
    expect(PANEL).toMatch(/onClick=\{\(\) => void attach\(proposal\.purpose!\)\}/);
    // Exactly one attach implementation in the panel.
    expect(PANEL.match(/const attach = async/g) ?? []).toHaveLength(1);
  });

  it('no invented purpose value exists anywhere in the panel', () => {
    // Every purpose the panel can send is one of the real vocabulary terms.
    // A sentinel like 'ai' or 'pending' would be a second, untruthful identity.
    for (const invented of ["'ai'", "'pending'", "'auto'", "'unknown'", 'purpose: null']) {
      expect(PANEL).not.toContain(invented);
    }
    // And the attach signature still takes a concrete purpose, not an optional one.
    expect(PANEL).toContain('const attach = async (purpose: CompositionAssetPurpose');
  });

  it('the proposal is derived, so it can never be stale', () => {
    // Recomputed from template, choices and instruction — there is no stored
    // decision that could stop matching the design it was made for.
    expect(PANEL).toContain('const proposal = React.useMemo(');
    expect(PANEL).toMatch(/\[templateSlots, templateCategory, templatePurposeKey, guidedChoices, instruction, brief\]/);
  });

  it('"Tell us more" reuses the one instruction field rather than adding another', () => {
    expect(PANEL).toContain('instructionRef.current?.focus()');
    expect(PANEL.match(/maxLength=\{400\}/g) ?? []).toHaveLength(1);
  });

  it('cancelling clears the request along with the pending upload', () => {
    expect(PANEL).toMatch(/setInstruction\(''\); setLetUsChoose\(false\);/);
  });
});

/* ── F. One of everything ───────────────────────────────────────────────────*/

describe('F — no second system was introduced', () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

  it('the chooser makes no provider call and reads no clock or randomness', () => {
    const src = read('../../../lib/content/guidedCreativeDirection.ts');
    for (const bad of ['fetch(', 'Math.random', 'Date.now', 'openai', 'images.edit']) {
      expect(src).not.toContain(bad);
    }
  });

  it('compatibility comes from the shared predicate, not a copy of it', () => {
    const src = read('../../../lib/content/guidedCreativeDirection.ts');
    expect(src).toContain('slotAcceptance(');
    // No re-implementation: the chooser must not read placement or mode rules.
    expect(src).not.toContain('slot.placement');
    expect(src).not.toContain('PURPOSE_MODE_POLICY');
  });

  it('provenance is metadata, never a routing input', () => {
    const api = read('../../../pages/api/creator-assets/composition.ts');
    expect(api).toContain('meta.aiProposed = true');
    // It rides the existing metadata mechanism — no column, no migration.
    expect(api).not.toMatch(/ALTER TABLE|CREATE TABLE/i);
    const routing = read('../../../lib/content/compositionAssetRouting.ts');
    expect(routing).not.toContain('aiProposed');
  });

  it('PR #70 remains the only post-generation disclosure', () => {
    const panel = read('../../../components/creator/CreatorImageAssetPanel.tsx');
    // The panel states an INTENTION. It must not claim an outcome.
    expect(panel).not.toContain('could not be applied');
    expect(panel).not.toContain('condition_reference_status');
    const column = read('../../../components/creator/workflow/CreatorResultsColumn.tsx');
    expect(column).toContain('conditionReferenceStatus');
  });
});

/* ── G. The summary tells the truth about their picture ─────────────────────*/

describe('G — the pre-generation summary states the actual treatment', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

  it('CRITICAL: the summary reports what is ATTACHED, not what was proposed', () => {
    // A proposal the user declined, or an attach that failed, must not appear in
    // the summary as though it happened. The panel reports the loaded reference.
    const panel = read('../../../components/creator/CreatorImageAssetPanel.tsx');
    expect(panel).toContain('onAttachmentChange(attached ? {');
    expect(panel).toContain("placedExactly: attached.reference.mode === 'compose'");
    // Reported from `attached`, which comes from load() — never from `proposal`.
    expect(panel).not.toMatch(/onAttachmentChange\([^)]*proposal/);
  });

  it('the summary is actually given the attachment — the row is not dead surface', () => {
    const column = read('../../../components/creator/workflow/CreatorFormColumn.tsx');
    expect(column).toContain('onAttachmentChange={setImageAttachment}');
    expect(column).toContain('attachment={imageAttachment}');
  });

  it('CRITICAL: the summary promise is derived from mode, exactly as the panel is', () => {
    const card = read('../../../components/creator/CreativeSummaryCard.tsx');
    expect(card).toContain('props.attachment.placedExactly');
    expect(card).toContain('used as a reference, so the result may differ');
    // One vocabulary for the usage label, shared with the rest of the screen.
    expect(card).toContain('creatorAssetUsageLabel(props.attachment.purpose)');
  });

  it('an absent attachment produces no image row at all', () => {
    const card = read('../../../components/creator/CreativeSummaryCard.tsx');
    expect(card).toContain('if (props.attachment) {');
  });
});