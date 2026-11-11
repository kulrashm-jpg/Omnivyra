/**
 * SECURITY (2026-11-11): the creator render pipeline resolved user templates
 * from ONE process-global registry, and loaded them by id ALONE
 * (loadAndRegisterUserTemplate / ensureUserTemplateRegisteredForAsset /
 * resolvePlanTemplate). Company A could put company B's template id into A's
 * own plan or asset and have B's template loaded, registered and rendered - and
 * once B's own render had registered it, ANY later caller in the process
 * resolved it. Now the registry is keyed by tenant (AsyncLocalStorage scope per
 * render on the server), and every load is company-scoped.
 */
const CO_A = '00000000-0000-4000-8000-0000000000aa';
const CO_B = '00000000-0000-4000-8000-0000000000bb';

type Row = Record<string, unknown>;
let rows: Row[] = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => {
      const eqs: Array<[string, unknown]> = [];
      const match = () => rows.filter((r) => eqs.every(([c, v]) => r[c] === v));
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.order = () => Promise.resolve({ data: match(), error: null });
      b.eq = (c: string, v: unknown) => { eqs.push([c, v]); return b; };
      b.maybeSingle = () => Promise.resolve({ data: match()[0] ?? null, error: null });
      return b;
    },
  },
}));

import {
  listTemplatesForFamily, serializeTemplate, getTemplateById, resolveTemplate, registerUserTemplate,
  clearUserTemplateRegistry, setTemplateTenantProvider,
} from '../../../lib/creator-templates';
import { cloneTemplate } from '../../../lib/creator-templates/userTemplate';
import { runWithTemplateTenant, installTemplateTenantProvider } from '../../services/creator/templateTenantContext';
import { ensureUserTemplateRegisteredForAsset, getUserTemplate } from '../../services/creator/userTemplateService';
import { resolvePlanTemplate } from '../../services/creator/campaignPlanValidationService';

const sys = listTemplatesForFamily('infographic')[0];
function templateRow(id: string, company: string, name: string): Row {
  const t = cloneTemplate(sys, 'infographic', { id, ownerUserId: 'u' });
  return {
    id, company_id: company, owner_user_id: 'u', team_id: null, asset_family: 'infographic', name, category: t.category,
    description: t.description, status: 'draft', version: 1, parent_template_id: sys.id, preview_url: null,
    template_json: JSON.parse(JSON.stringify(serializeTemplate({ ...t, name }))), updated_at: '', created_at: '',
  };
}
const asset = (templateId: string) => ({ media_bundle: { metadata: { template_id: templateId } } });
const inA = <T>(fn: () => T) => runWithTemplateTenant(CO_A, fn);
const inB = <T>(fn: () => T) => runWithTemplateTenant(CO_B, fn);

beforeEach(() => {
  clearUserTemplateRegistry();
  rows = [templateRow('ut-a', CO_A, 'A template'), templateRow('ut-b', CO_B, 'B SECRET')];
});

describe("company A cannot resolve or render company B's template", () => {
  it("after B's OWN render registered it, it is invisible to A's scope and to unscoped server code", async () => {
    await ensureUserTemplateRegisteredForAsset(asset('ut-b'), CO_B); // B's legitimate render
    expect(inB(() => getTemplateById('ut-b'))?.name).toBe('B SECRET');
    expect(inA(() => getTemplateById('ut-b'))).toBeNull();
    expect(inA(() => resolveTemplate('ut-b', { family: 'infographic' }).matched)).toBe(false);
    expect(getTemplateById('ut-b')).toBeNull(); // outside any scope: platform only
  });

  it("A's ASSET carrying B's template id loads nothing and registers nothing", async () => {
    await ensureUserTemplateRegisteredForAsset(asset('ut-b'), CO_A);
    expect(inA(() => getTemplateById('ut-b'))).toBeNull();
    expect(inB(() => getTemplateById('ut-b'))).toBeNull(); // nor was it registered for B as a side effect
  });

  it("A's PLAN carrying B's template id resolves to nothing", async () => {
    expect(await resolvePlanTemplate('ut-b', CO_A)).toBeNull();
  });

  it("hydrating B's row inside A's scope (the by-id getUserTemplate) does NOT register it for A", async () => {
    await inA(() => getUserTemplate('ut-b'));
    expect(inA(() => getTemplateById('ut-b'))).toBeNull();
  });

  it('two interleaved renders each see ONLY their own template', async () => {
    const seen = await Promise.all([
      runWithTemplateTenant(CO_A, async () => {
        await ensureUserTemplateRegisteredForAsset(asset('ut-a'), CO_A);
        await new Promise((r) => setTimeout(r, 5));
        return [getTemplateById('ut-a')?.name ?? null, getTemplateById('ut-b')?.name ?? null];
      }),
      runWithTemplateTenant(CO_B, async () => {
        await ensureUserTemplateRegisteredForAsset(asset('ut-b'), CO_B);
        return [getTemplateById('ut-a')?.name ?? null, getTemplateById('ut-b')?.name ?? null];
      }),
    ]);
    expect(seen).toEqual([['A template', null], [null, 'B SECRET']]);
  });
});

describe('same tenant, platform templates and the browser are unaffected', () => {
  it("A's own template registers and resolves (asset and plan)", async () => {
    await ensureUserTemplateRegisteredForAsset(asset('ut-a'), CO_A);
    expect(inA(() => resolveTemplate('ut-a', { family: 'infographic' }).matched)).toBe(true);
    expect((await resolvePlanTemplate('ut-a', CO_A))?.name).toBe('A template');
  });

  it('platform (system) templates resolve everywhere, scoped or not', () => {
    expect(getTemplateById(sys.id)).not.toBeNull();
    expect(inA(() => getTemplateById(sys.id))).not.toBeNull();
  });

  it('a server with NO provider refuses to register a user template (fails closed)', () => {
    setTemplateTenantProvider(null);
    try {
      const t = { ...sys, id: 'ut-x', ownership: 'user' as const };
      expect(registerUserTemplate(t as never)).toBe(false);
      expect(getTemplateById('ut-x')).toBeNull();
    } finally {
      installTemplateTenantProvider(); // restore the backend provider
    }
  });

  it('in the BROWSER (no provider, window defined) the single-tenant gallery still works', () => {
    setTemplateTenantProvider(null);
    const g = globalThis as { window?: unknown };
    const had = 'window' in g;
    g.window = {};
    try {
      const t = { ...sys, id: 'ut-browser', ownership: 'user' as const };
      expect(registerUserTemplate(t as never)).toBe(true);
      expect(getTemplateById('ut-browser')?.id).toBe('ut-browser');
    } finally {
      if (!had) delete g.window;
      installTemplateTenantProvider();
    }
  });
});
