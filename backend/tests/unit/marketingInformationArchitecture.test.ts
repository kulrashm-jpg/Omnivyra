import {
  MARKETING_IA, CREATE_MARKETING_LANES, CREATE_MARKETING_ENTRY, primaryCreationEntry,
  UNIFIED_CREATION_ENTRY,
} from '../../../components/layout/contentNavigationConfig';

describe('CREATOR-070 — Canonical Marketing Information Architecture', () => {
  it('STEP 2 — one hierarchy with exactly ONE primary creation entry = Create Marketing', () => {
    const primary = MARKETING_IA.filter((s) => s.primary);
    expect(primary).toHaveLength(1);
    expect(primary[0].id).toBe('create');
    expect(primary[0].label).toBe('Create Marketing');
    expect(primary[0].route).toBe(UNIFIED_CREATION_ENTRY);
    // The six canonical sections.
    expect(MARKETING_IA.map((s) => s.label)).toEqual([
      'Create Marketing', 'Content Library', 'Campaigns', 'Publish Center', 'Brand Assets', 'Analytics',
    ]);
  });

  it('STEP 4 — top-level sections carry NO Writer/Creator/Template terminology', () => {
    for (const s of MARKETING_IA) {
      expect(s.label).not.toMatch(/Writer|Creator|Template|Blueprint/i);
    }
  });

  it('STEP 3 — four lanes INSIDE Create Marketing, reusing the canonical content types', () => {
    expect(CREATE_MARKETING_LANES.map((l) => l.id)).toEqual(['writer', 'creator', 'campaigns', 'assets']);
    const byId = Object.fromEntries(CREATE_MARKETING_LANES.map((l) => [l.id, l.items.length]));
    expect(byId.writer).toBe(7);
    expect(byId.creator).toBe(5);
    expect(byId.campaigns).toBe(3);
    expect(byId.assets).toBe(5);
  });

  it('STEP 5/6 — single primary entry, flag-gated route, legacy alias preserved', () => {
    expect(CREATE_MARKETING_ENTRY.label).toBe('Create Marketing');
    expect(primaryCreationEntry(true).route).toBe(UNIFIED_CREATION_ENTRY);          // unified
    expect(primaryCreationEntry(false).route).toBe('/command-center/creator-content'); // legacy alias, not broken
  });
});
