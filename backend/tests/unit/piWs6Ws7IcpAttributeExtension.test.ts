/**
 * PI WS-6 / WS-7 — the ICP attribute extension.
 *
 * IMPLEMENTATION-MANIFEST-001 §17 listed eight fields as REQUIRED — NOT YET
 * IMPLEMENTED. Six are implemented here; two are deliberately not, and one of
 * these tests pins that so the omission cannot be mistaken for an oversight.
 *
 * The property that matters most is the one the ICP contract depends on: a
 * criterion may only name an attribute the platform actually stores. So every
 * attribute added to the criterion vocabulary must also be a real, writable
 * column — otherwise the criterion evaluates as permanently `unknown` and looks
 * like a data gap rather than the modelling error it is.
 */

import {
  BUYING_ROLES,
  isBuyingRole,
  toAccountAttributes,
  toPersonAttributes,
  ACCOUNT_ATTRIBUTE_COLUMNS,
  PERSON_ATTRIBUTE_COLUMNS,
} from '../../services/prospectIdentity/attributes';
import { attributeKind, attributesFor } from '../../services/prospectIcp/criteria';

describe('WS-6 — company ICP attributes (FR-16)', () => {
  it('adds market, business_model and growth_stage to the criterion vocabulary', () => {
    expect(attributeKind('account', 'market')).toBe('exact_text');
    expect(attributeKind('account', 'business_model')).toBe('exact_text');
    expect(attributeKind('account', 'growth_stage')).toBe('exact_text');
  });

  it('makes each one a WRITABLE column — a criterion may not name what cannot be stored', () => {
    for (const c of ['market', 'business_model', 'growth_stage']) {
      expect(ACCOUNT_ATTRIBUTE_COLUMNS as readonly string[]).toContain(c);
    }
  });

  it('normalises them as display text, imposing no vocabulary', () => {
    const out = toAccountAttributes({ market: '  Fintech  ', businessModel: 'Marketplace', growthStage: 'Series B' });
    expect(out.market).toBe('Fintech');
    expect(out.businessModel).toBe('Marketplace');
    expect(out.growthStage).toBe('Series B');
  });

  it('turns a blank assertion into null — an empty string is not an observation', () => {
    const out = toAccountAttributes({ market: '   ', businessModel: '', growthStage: null });
    expect(out.market).toBeNull();
    expect(out.businessModel).toBeNull();
    expect(out.growthStage).toBeNull();
  });

  it('invents nothing when a provider says nothing', () => {
    const out = toAccountAttributes({});
    expect(out.market).toBeNull();
    expect(out.businessModel).toBeNull();
    expect(out.growthStage).toBeNull();
  });

  it('adds NO identity column to the account surface', () => {
    for (const c of ['market', 'business_model', 'growth_stage']) {
      expect(['name', 'legal_name', 'domain_normalized', 'website_url', 'source', 'source_reference'])
        .not.toContain(c);
    }
  });
});

describe('WS-7 — buying role (FR-21)', () => {
  it('uses the vocabulary the Playbook fixes, and only that', () => {
    expect([...BUYING_ROLES]).toEqual([
      'decision_maker', 'economic_buyer', 'champion',
      'influencer', 'evaluator', 'blocker', 'unknown',
    ]);
  });

  it('is a CLOSED vocabulary in the criterion surface, unlike authority and influence', () => {
    expect(attributeKind('person', 'buying_role')).toBe('closed_vocabulary');
    expect(attributeKind('person', 'authority')).toBe('exact_text');
    expect(attributeKind('person', 'influence')).toBe('exact_text');
  });

  it('accepts a real role and refuses anything outside the vocabulary', () => {
    expect(isBuyingRole('champion')).toBe(true);
    expect(isBuyingRole('decision_maker')).toBe(true);
    expect(isBuyingRole('Decision Maker')).toBe(false);
    expect(isBuyingRole('gatekeeper')).toBe(false);
    expect(isBuyingRole(null)).toBe(false);
  });

  it('nulls an unrecognised role rather than storing it — an unknown role is not a role', () => {
    expect(toPersonAttributes({ buyingRole: 'gatekeeper' as never }).buyingRole).toBeNull();
    expect(toPersonAttributes({ buyingRole: 'champion' }).buyingRole).toBe('champion');
  });

  it('normalises authority and influence as free text, imposing no vocabulary', () => {
    const out = toPersonAttributes({ authority: '  Budget owner ', influence: 'High' });
    expect(out.authority).toBe('Budget owner');
    expect(out.influence).toBe('High');
  });

  it('makes all three writable columns', () => {
    for (const c of ['authority', 'influence', 'buying_role']) {
      expect(PERSON_ATTRIBUTE_COLUMNS as readonly string[]).toContain(c);
    }
  });
});

describe('WS-6/WS-7 — the criterion surface stays honest', () => {
  it('every account criterion attribute is a writable account column', () => {
    const nonColumn = new Set(['attributes_source', 'attributes_updated_at']);
    for (const a of attributesFor('account')) {
      if (nonColumn.has(a)) continue;
      expect(ACCOUNT_ATTRIBUTE_COLUMNS as readonly string[]).toContain(a);
    }
  });

  it('every person criterion attribute is a writable person column', () => {
    const nonColumn = new Set(['attributes_source', 'attributes_updated_at']);
    for (const a of attributesFor('person')) {
      if (nonColumn.has(a)) continue;
      expect(PERSON_ATTRIBUTE_COLUMNS as readonly string[]).toContain(a);
    }
  });

  it('does NOT add the two FIT concepts — they are relational, not intrinsic', () => {
    // `product/service alignment` and `problem relevance` describe a relationship
    // between the TENANT'S offering and the prospect, not a property the prospect
    // has. Storing one as a source-asserted attribute would let an ICP match
    // against a value the ICP itself produced. They await a product decision.
    expect(attributeKind('account', 'product_alignment')).toBeNull();
    expect(attributeKind('person', 'problem_relevance')).toBeNull();
    expect(ACCOUNT_ATTRIBUTE_COLUMNS as readonly string[]).not.toContain('product_alignment');
    expect(PERSON_ATTRIBUTE_COLUMNS as readonly string[]).not.toContain('problem_relevance');
  });

  it('the TypeScript vocabulary mirrors the database CHECK, and must not drift', () => {
    const sql = require('fs').readFileSync(
      require('path').join(__dirname, '../../../supabase/migrations/20261013000000_pi_ws6_ws7_icp_attribute_extension.sql'),
      'utf8');
    for (const role of BUYING_ROLES) expect(sql).toContain(`'${role}'`);
    expect(sql).toContain('unified_persons_buying_role_valid');
  });
});
