/**
 * CONDITION runtime integration — the wire that was missing.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every piece of the CONDITION pipeline was built and validated, and none of it
 * ran: `resolveCompositionAssets` had zero runtime callers, so a user could
 * attach an image, generate, and receive a picture that never saw it — with no
 * error anywhere. That is the failure this suite exists to prevent recurring,
 * and it is invisible in output.
 *
 * The guards below therefore pin the CHAIN, not just the pieces:
 * composition_id leaves the client, survives the route, reaches the resolver,
 * and the resolver's branded result reaches RenderOptions.
 */

import * as fs from 'fs';
import * as path from 'path';

const P = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PAYLOAD = P('../../../lib/creator-content/creatorSuggestionAndPayload.ts');
const ACTIONS = P('../../../components/creator/workflow/useCreatorWorkflowActions.tsx');
const PREP = P('../../services/creator/generateRoute/generatePrep.ts');
const HANDLER = P('../../services/creator/generateRoute/generateHandler.ts');
const ORCH = P('../../services/creator/creatorOrchestrator.ts');
const CALLER = P('../../services/creator/resolveCompositionReferencesForRender.ts');
const TEMPLATES = P('../../../lib/creator-templates/systemTemplates.ts');

describe('A — client sends the existing composition id', () => {
  it('the generation body carries composition_id', () => {
    expect(strip(PAYLOAD)).toContain('composition_id: compositionId');
  });

  it('MUTATION GUARD: it is the SAME hook the upload panel uses — no second identity', () => {
    // useCreatorCompositionId reads sessionStorage by a per-type key and only
    // mints when absent, so both callers resolve to one draft. Minting a second
    // id here would strand every attachment the panel wrote.
    expect(ACTIONS).toContain("import { useCreatorCompositionId } from '../useCreatorCompositionId'");
    expect(strip(ACTIONS)).toContain('useCreatorCompositionId(type)');
    expect(strip(ACTIONS)).not.toMatch(/mintCreatorCompositionId/);
  });

  it('it is omitted rather than sent empty', () => {
    // An empty string would be a lookup key that matches nothing while looking
    // deliberate; absence is honest.
    expect(strip(PAYLOAD)).toMatch(/\.\.\.\(compositionId \? \{ composition_id: compositionId \} : \{\}\)/);
  });
});

describe('B — the server accepts it as a lookup key only', () => {
  it('the request contract declares composition_id', () => {
    expect(PREP).toMatch(/composition_id\?: string;/);
  });

  it('the handler reads it from the body', () => {
    expect(strip(HANDLER)).toContain("compositionId: String(body.composition_id || '').trim() || null");
  });

  it('CRITICAL: the authenticated company remains authoritative', () => {
    const body = strip(HANDLER);
    // companyId is resolved from the authenticated context, never from the
    // client-supplied composition payload.
    expect(body).toMatch(/companyId,/);
    expect(body).not.toMatch(/companyId:\s*String\(body\.composition/);
    expect(body).not.toMatch(/companyId:\s*body\.company_id/);
  });

  it('MUTATION GUARD: the resolver is called with the authenticated company', () => {
    expect(strip(CALLER)).toContain('const companyId = String(input.companyId');
    expect(strip(CALLER)).toContain('companyId,');
    // The composition id is a key, never an authorization input.
    expect(strip(CALLER)).not.toMatch(/companyId:\s*[^,\n]*compositionId/);
  });
});

describe('C — exactly one runtime caller of the resolver', () => {
  it('MUTATION GUARD: the orchestrator invokes it before rendering', () => {
    const body = strip(ORCH);
    expect(body).toContain('resolveCompositionReferencesForRender({');
    expect(body).toContain('compositionReferences,');
  });

  it('the helper is the only module calling resolveCompositionAssets', () => {
    expect(strip(CALLER)).toContain('resolveCompositionAssets({');
    // The orchestrator must go through the helper, not call the resolver itself.
    expect(strip(ORCH)).not.toContain('resolveCompositionAssets(');
  });

  it('the branded carrier is what reaches RenderOptions', () => {
    expect(strip(CALLER)).toContain('return resolved.renderer;');
  });

  it('capability is asked of the edit endpoint, not the model in the abstract', () => {
    // Asking `generate` would report zero capacity and silently strand every
    // condition reference.
    expect(strip(CALLER)).toContain("resolveProviderCapabilities('openai-gpt-image-1', 'edit')");
  });

  it('MUTATION GUARD: routing / tenancy / bytes are not re-implemented here', () => {
    const body = strip(CALLER);
    expect(body).not.toMatch(/routeCompositionReferences|getCanonicalMediaAsset|storage\.from|images\.edit/);
  });
});

describe('D — absent identity leaves generation unchanged', () => {
  it('no company or no composition id returns null', () => {
    expect(strip(CALLER)).toContain('if (!companyId || !compositionId) return null;');
  });

  it('MUTATION GUARD: a reference that could not be used is reported, never dropped in silence', () => {
    expect(strip(CALLER)).toContain('resolved.rejected.length > 0');
    expect(CALLER).toContain('[creator-composition-references][rejected]');
  });
});

describe('E — the CONDITION template opt-in', () => {
  it('sys-image-product-highlight declares one condition slot', () => {
    const block = TEMPLATES.slice(
      TEMPLATES.indexOf("id: 'sys-image-product-highlight'"),
      TEMPLATES.indexOf("id: 'sys-image-testimonial'"),
    );
    expect(block).toContain("assetSlots: [{ purpose: 'product', mode: 'condition', max: 1 }]");
  });

  it('the purpose is justified by the template itself', () => {
    const block = TEMPLATES.slice(
      TEMPLATES.indexOf("id: 'sys-image-product-highlight'"),
      TEMPLATES.indexOf("id: 'sys-image-testimonial'"),
    );
    // Every signal on this template names a product; `subject` would be looser.
    expect(block).toContain("name: 'Product Highlight'");
    expect(block).toContain("category: 'Product'");
    expect(block).toContain("imageContract('product-showcase-image')");
  });

  it('MUTATION GUARD: CONDITION was not enabled across the catalogue', () => {
    // Exactly two opt-ins exist: the COMPOSE logo proof and this one.
    expect(TEMPLATES.split('assetSlots:').length - 1).toBe(2);
    expect(TEMPLATES.split("mode: 'condition'").length - 1).toBe(1);
  });

  it('MUTATION GUARD: the COMPOSE logo proof is untouched', () => {
    expect(TEMPLATES).toContain("purpose: 'logo', mode: 'compose', max: 1");
    expect(TEMPLATES).toContain("placement: { top: 0.35, left: 0.35, maxWidth: 0.30, maxHeight: 0.30, fit: 'contain' }");
  });
});

describe('F — existing guards are untouched', () => {
  it('fail-closed routing still rejects undeclared slots', () => {
    const ROUTING = P('../../../lib/content/compositionAssetRouting.ts');
    expect(ROUTING).toContain("reject(r, 'template_accepts_no_references'");
    expect(ROUTING).toContain("reject(r, 'mode_not_allowed_for_purpose'");
  });

  it('COMPOSE still cannot reach the provider', () => {
    const COMPOSE = P('../../services/compositionAssetComposeService.ts');
    expect(strip(COMPOSE)).not.toMatch(/generateProviderImage|images\.(edit|generate)/);
  });

  it('the condition service still enforces tenancy and lifecycle', () => {
    const COND = P('../../services/compositionAssetConditionService.ts');
    expect(COND).toContain('getCanonicalMediaAsset(input.companyId, reference.assetId)');
    expect(COND).toContain('isUsableMediaAsset(asset)');
    expect(COND).toContain("reject('provider_reference_limit_exceeded'");
  });

  it('no public or signed URL was introduced by the integration', () => {
    for (const src of [strip(CALLER), strip(ORCH), strip(HANDLER)]) {
      expect(src).not.toMatch(/getPublicUrl|createSignedUrl/);
    }
  });
});
