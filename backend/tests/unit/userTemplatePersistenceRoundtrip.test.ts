// Mock the DB so getUserTemplate returns a persisted (JSON-safe encoded) row.
jest.mock('../../db/supabaseClient', () => {
  const lib = require('../../../lib/creator-templates');
  const { cloneTemplate } = require('../../../lib/creator-templates/userTemplate');
  const sys = lib.listTemplatesForFamily('infographic')[0];
  const ut = cloneTemplate(sys, 'infographic', { id: 'ut-round', ownerUserId: 'u1' });
  // Simulate the DB column: the JSON-safe ENCODED template (what we now store).
  const ROW: Record<string, unknown> = {
    id: 'ut-round', company_id: 'co', owner_user_id: 'u1', team_id: null,
    asset_family: 'infographic', name: ut.name, category: ut.category, description: ut.description,
    status: 'draft', version: 1, parent_template_id: sys.id, preview_url: null,
    template_json: JSON.parse(JSON.stringify(lib.serializeTemplate(ut))), // through real JSON, sentinels survive
    updated_at: '', created_at: '',
  };
  const builder = () => {
    const b: any = {
      select: () => b, eq: () => b,
      order: () => Promise.resolve({ data: [ROW], error: null }),
      maybeSingle: () => Promise.resolve({ data: ROW, error: null }),
      insert: () => b, update: () => b,
    };
    return b;
  };
  return { supabase: { from: () => builder() } };
});

import {
  listTemplatesForFamily, resolveTemplate, getTemplateById, clearUserTemplateRegistry,
  serializeTemplate, deserializeTemplate, encodeJsonSafe, decodeJsonSafe,
} from '../../../lib/creator-templates';
import { cloneTemplate } from '../../../lib/creator-templates/userTemplate';
import { getUserTemplate, ensureUserTemplateRegisteredForAsset } from '../../services/creator/userTemplateService';

const sysInfo = listTemplatesForFamily('infographic')[0];

describe('TEMPLATE-019 Part B — JSON-safe style serialization', () => {
  it('preserves Infinity / -Infinity / NaN across a real JSON round-trip', () => {
    const v = { a: Infinity, b: -Infinity, c: NaN, d: 42, e: 'x', nested: [{ m: Infinity }] };
    const round = decodeJsonSafe<any>(JSON.parse(JSON.stringify(encodeJsonSafe(v))));
    expect(round.a).toBe(Infinity);
    expect(round.b).toBe(-Infinity);
    expect(Number.isNaN(round.c)).toBe(true);
    expect(round.d).toBe(42);
    expect(round.nested[0].m).toBe(Infinity);
  });

  it('documents the corruption the serializer fixes (raw JSON → null)', () => {
    const raw = JSON.parse(JSON.stringify(sysInfo.infographicStyle));
    const lastBand = raw.typography.fontMultiplierScale.slice(-1)[0];
    expect(lastBand.maxSectionChars).toBeNull(); // raw JSON corrupts Infinity → null
  });

  it('serializeTemplate → JSON → deserializeTemplate is byte-faithful', () => {
    const ut = cloneTemplate(sysInfo, 'infographic', { id: 'rt', ownerUserId: 'u1' });
    const restored = deserializeTemplate(JSON.parse(JSON.stringify(serializeTemplate(ut))));
    expect(restored.infographicStyle).toEqual(sysInfo.infographicStyle); // Infinity intact
  });
});

describe('TEMPLATE-019 Part A — worker resolution + round-trip fidelity', () => {
  beforeEach(() => clearUserTemplateRegistry());
  afterAll(() => clearUserTemplateRegistry());

  it('getUserTemplate decodes the persisted style faithfully (Infinity restored)', async () => {
    const t = await getUserTemplate('ut-round');
    expect(t).toBeTruthy();
    expect(t!.infographicStyle).toEqual(sysInfo.infographicStyle); // matches source after DB round-trip
  });

  it('ensureUserTemplateRegisteredForAsset registers from the asset payload → resolveTemplate resolves it', async () => {
    expect(getTemplateById('ut-round')).toBeNull(); // not registered yet
    await ensureUserTemplateRegisteredForAsset({ media_bundle: { metadata: { template_id: 'ut-round' } } });
    const rt = resolveTemplate('ut-round', { family: 'infographic' });
    expect(rt.matched).toBe(true);
    expect(rt.infographicStyle).toEqual(sysInfo.infographicStyle); // same pipeline + faithful style
  });

  it('is a no-op for system ids and missing ids', async () => {
    await ensureUserTemplateRegisteredForAsset({ media_bundle: { metadata: { template_id: sysInfo.id } } });
    await ensureUserTemplateRegisteredForAsset({});
    expect(resolveTemplate(sysInfo.id).matched).toBe(true); // system unaffected
  });
});
