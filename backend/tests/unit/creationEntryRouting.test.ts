import {
  resolveCreationEntry, UNIFIED_CREATION_ENTRY, getContentNavRoutes, CONTENT_NAV_SECTIONS,
} from '../../../components/layout/contentNavigationConfig';

describe('CREATOR-062 — Unified creation entry routing', () => {
  it('STEP 2/4 — when enabled, EVERY content-creation nav target resolves to the one Workspace', () => {
    for (const route of getContentNavRoutes()) {
      expect(resolveCreationEntry(route, true)).toBe(UNIFIED_CREATION_ENTRY);
    }
    // Sections + items alike.
    for (const s of CONTENT_NAV_SECTIONS) {
      expect(resolveCreationEntry(s.href, true)).toBe(UNIFIED_CREATION_ENTRY);
      for (const i of s.items) expect(resolveCreationEntry(i.route, true)).toBe(UNIFIED_CREATION_ENTRY);
    }
  });

  it('STEP 7 — when disabled, every route is byte-identical to the legacy route', () => {
    for (const route of getContentNavRoutes()) {
      expect(resolveCreationEntry(route, false)).toBe(route);
    }
  });

  it('the unified entry is the marketing workspace', () => {
    expect(UNIFIED_CREATION_ENTRY).toBe('/command-center/marketing-create');
  });
});
