/**
 * @jest-environment jsdom
 *
 * PROSPECT-IA-001 — the header navigation contract.
 *
 * There was no navigation-shape test before this, so the previous restructure had
 * nothing to protect it. These assertions pin the hierarchy AND the matcher
 * behaviour, because the two failure modes are different: a wrong hierarchy is
 * visible immediately, whereas a matcher overlap silently highlights two menus at
 * once and nobody notices until a user reports it.
 *
 * The decisive assertions are negative — Account Intelligence must NOT appear
 * (its service exists but no UI does), and no route may activate two groups.
 */

import { HEADER_NAV_ITEMS, isPathMatch } from '../../../components/layout/GlobalHeaderNav';

const byId = (id: string) => HEADER_NAV_ITEMS.find((i) => i.id === id);
const byLabel = (label: string) => HEADER_NAV_ITEMS.find((i) => i.label === label);
const prospect = () => byId('prospect')!;
const website = () => byId('website-capture')!;
const childLabels = (id: string) => byId(id)!.children.map((c) => c.label);
const childHref = (id: string, label: string) =>
  byId(id)!.children.find((c) => c.label === label)?.href;

/** Every top-level group whose matchers claim this path. */
const activeGroups = (pathname: string) =>
  HEADER_NAV_ITEMS.filter((i) => i.matchers.some((m) => isPathMatch(pathname, m))).map((i) => i.label);

describe('1 — Prospect is a top-level navigation item', () => {
  it('exists at the top level', () => {
    expect(prospect()).toBeDefined();
    expect(prospect().label).toBe('Prospect');
  });

  it('Lead Intelligence is no longer a top-level item', () => {
    expect(byLabel('Lead Intelligence')).toBeUndefined();
  });
});

describe('2 — Prospects sits beneath Prospect and points at /prospects', () => {
  it('is a child of Prospect', () => {
    expect(childLabels('prospect')).toContain('Prospects');
  });

  it('points at the validated list route', () => {
    expect(childHref('prospect', 'Prospects')).toBe('/prospects');
  });
});

describe('3/4 — Lead Intelligence nests under Prospect and keeps its two items', () => {
  it('Overview and All Leads are grouped under Lead Intelligence', () => {
    const grouped = prospect().children.filter((c) => c.group === 'Lead Intelligence').map((c) => c.label);
    expect(grouped).toEqual(['Overview', 'All Leads']);
  });

  it('their routes are unchanged', () => {
    expect(childHref('prospect', 'Overview')).toBe('/lead-intelligence');
    expect(childHref('prospect', 'All Leads')).toBe('/lead-intelligence?tab=leads');
  });

  it('Prospects itself is not inside the Lead Intelligence group', () => {
    const prospects = prospect().children.find((c) => c.label === 'Prospects');
    expect(prospects?.group).toBeUndefined();
  });
});

describe('5/6 — Web & Capture is separate and complete', () => {
  it('is its own top-level group, not a child of Prospect', () => {
    expect(website()).toBeDefined();
    expect(website().label).toBe('Web & Capture');
    expect(childLabels('prospect')).not.toContain('Website Setup');
  });

  it('retains all five existing routes unchanged', () => {
    expect(website().children.map((c) => c.href)).toEqual([
      '/website-setup',
      '/website-health',
      '/integrations?focus=website',
      '/leads?tab=forms',
      '/lead-capture',
    ]);
  });
});

describe('7 — Account Intelligence is absent', () => {
  it('CRITICAL: appears nowhere in the navigation', () => {
    const everything = JSON.stringify(
      HEADER_NAV_ITEMS.map((i) => ({ l: i.label, c: i.children.map((c) => ({ l: c.label, h: c.href })) })),
    );
    expect(everything).not.toMatch(/Account Intelligence/i);
  });
});

describe('8 — matcher behaviour: no unintended double activation', () => {
  it.each([
    ['/prospects', 'Prospect'],
    ['/prospects/abc-123', 'Prospect'],
    ['/lead-intelligence', 'Prospect'],
    ['/website-setup', 'Web & Capture'],
    ['/website-health', 'Web & Capture'],
    ['/integrations', 'Web & Capture'],
    ['/leads', 'Web & Capture'],
    ['/lead-capture', 'Web & Capture'],
  ])('%s activates exactly one group: %s', (pathname, expected) => {
    expect(activeGroups(pathname as string)).toEqual([expected]);
  });

  it('CRITICAL: /lead-capture does not also activate Prospect via /lead-intelligence', () => {
    expect(activeGroups('/lead-capture')).not.toContain('Prospect');
  });

  it('CRITICAL: /leads does not also activate Prospect', () => {
    expect(activeGroups('/leads')).not.toContain('Prospect');
  });

  it('CRITICAL: /integrations no longer activates Prospect — the old overlap', () => {
    expect(prospect().matchers).not.toContain('/integrations');
    expect(prospect().matchers).not.toContain('/leads');
  });

  it('query strings do not change activation (normalizePath strips them)', () => {
    expect(activeGroups('/lead-intelligence?tab=leads')).toEqual(['Prospect']);
    expect(activeGroups('/leads?tab=forms')).toEqual(['Web & Capture']);
    expect(activeGroups('/integrations?focus=website')).toEqual(['Web & Capture']);
  });
});

describe('9 — existing routes and deep links are unchanged', () => {
  it('the four untouched top-level groups still exist', () => {
    for (const label of ['Reports', 'Content', 'Campaigns', 'Engagement']) {
      expect(byLabel(label)).toBeDefined();
    }
  });

  it('every route previously reachable is still reachable somewhere in the nav', () => {
    const hrefs = HEADER_NAV_ITEMS.flatMap((i) => i.children.map((c) => c.href));
    for (const href of [
      '/lead-intelligence',
      '/lead-intelligence?tab=leads',
      '/website-setup',
      '/website-health',
      '/integrations?focus=website',
      '/leads?tab=forms',
      '/lead-capture',
    ]) {
      expect(hrefs).toContain(href);
    }
  });

  it('no route was renamed — only regrouped', () => {
    const all = HEADER_NAV_ITEMS.flatMap((i) => i.children.map((c) => c.href));
    expect(all.filter((h) => h.startsWith('/lead-intelligence'))).toHaveLength(2);
    expect(all).toContain('/prospects');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Home is rendered by GlobalHeaderMain, NOT by HEADER_NAV_ITEMS.
//
// That component pulls in Supabase, the session client, the credits hook and the
// tour context, so mounting it would mean mocking half the app to assert two
// strings. The repository already uses source-level assertions for exactly this
// case, so the contract is verified by reading the file — cheaper, and it fails
// for the right reason when someone deletes the accessible name.
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readFileSync } = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { join } = require('path');

const HEADER_MAIN = readFileSync(
  join(__dirname, '..', '..', '..', 'components', 'layout', 'GlobalHeaderMain.tsx'),
  'utf8',
) as string;

/** The two `href="/dashboard"` Link blocks: [0] desktop nav, [1] mobile drawer. */
const homeLinks = (): string[] => {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = HEADER_MAIN.indexOf('href="/dashboard"', from);
    if (at < 0) break;
    const open = HEADER_MAIN.lastIndexOf('<Link', at);
    const close = HEADER_MAIN.indexOf('</Link>', at);
    out.push(HEADER_MAIN.slice(open, close));
    from = close;
  }
  return out;
};

describe('10 — Home stays outside the nav config and keeps its destination', () => {
  it('Home is not a HEADER_NAV_ITEMS entry', () => {
    expect(HEADER_NAV_ITEMS.map((i) => i.label)).not.toContain('Home');
    expect(HEADER_NAV_ITEMS.flatMap((i) => i.children.map((c) => c.href))).not.toContain('/dashboard');
  });

  it('there are exactly two Home links — desktop and mobile', () => {
    expect(homeLinks()).toHaveLength(2);
  });

  it('both still point at /dashboard', () => {
    for (const link of homeLinks()) expect(link).toContain('href="/dashboard"');
  });

  it('active state is still computed from the path, not a label', () => {
    for (const link of homeLinks()) expect(link).toContain("isPathMatch(router.pathname, '/dashboard')");
  });
});

describe('11 — desktop Home is icon-only but not nameless', () => {
  it('CRITICAL: carries an accessible name', () => {
    const [desktop] = homeLinks();
    expect(desktop).toContain('title="Home"');
    expect(desktop).toContain('aria-label="Home"');
  });

  it('renders the icon', () => {
    expect(homeLinks()[0]).toMatch(/<Home\s+className=/);
  });

  it('CRITICAL: no visible "Home" text node remains', () => {
    const [desktop] = homeLinks();
    // Strip attribute values so title=/aria-label= do not count as visible text.
    const withoutAttrs = desktop.replace(/(title|aria-label)="Home"/g, '');
    expect(withoutAttrs).not.toMatch(/>\s*Home\s*</);
    expect(withoutAttrs.includes('\n              Home\n')).toBe(false);
  });
});

describe('12 — mobile Home is unchanged', () => {
  it('CRITICAL: keeps its visible label', () => {
    const mobile = homeLinks()[1];
    expect(mobile).toMatch(/<Home\s+className=[^>]*\/>\s*\n\s*Home/);
  });

  it('still closes the drawer on click', () => {
    expect(homeLinks()[1]).toContain('setMobileOpen(false)');
  });
});
