/**
 * PI-LDB: `account.description` must stay INERT - shown, exported and
 * arbitrated, never inferred from (virality-05, 2026-11-11, closing 811b02b04).
 *
 * WHY THIS IS LOAD-BEARING: two paths put operator-chosen text into
 * prospect_accounts.description, and both are safe ONLY because nothing derives
 * a durable claim from its content:
 *   1. the manual/CSV writer (811b02b04: ManualLeadInput.description), and
 *   2. the header synonym 'title' -> candidates ['jobTitle', 'description'] in
 *      canonicalFieldRegistry (a human approves the destination).
 * 0005's write boundary exists because adapters once manufactured
 * classifications from typed labels; this keeps `description` from becoming
 * such a label.
 *
 * SCOPE, stated honestly: this guards the ICP path only (the closed attribute
 * surface every ICP criterion must name). It does NOT cover a new scoring
 * reader touching the column directly, the enrichment conflict path if a
 * provider ever claims a description attribute, or the facts rollup if it ever
 * derives rather than displays. None of those is guardable in one line.
 */
jest.mock('@/config', () => ({ config: {} }), { virtual: true });

import { attributeKind, attributesFor, validateCriterion } from '../../services/prospectIcp/criteria';

const WHY =
  "`description` must stay out of the ICP attribute list: the manual/CSV writer (811b02b04) and the "
  + "'title' -> 'description' mapping candidate in canonicalFieldRegistry both depend on its content never "
  + 'producing a durable claim. If `description` must become inferable, both paths need re-judging first - '
  + "see 20270211000005's write boundary.";

describe('account.description stays inert (ICP path)', () => {
  it('is not an ICP account attribute', () => {
    const account = attributesFor('account');
    // Anti-vacuity: the surface is real and populated.
    expect(account).toContain('industry');
    if (account.includes('description') || attributeKind('account', 'description') !== null) {
      throw new Error(WHY);
    }
  });

  it('a criterion naming it is refused (attribute_unknown), whatever predicate it asks for', () => {
    for (const predicate of [{ op: 'one_of', values: ['saas'] }, { op: 'contains', value: 'saas' }]) {
      let refused: unknown = null;
      try {
        validateCriterion({ id: 'desc-check', kind: 'optional', subject: 'account', attribute: 'description', predicate });
      } catch (e) {
        refused = e;
      }
      if (!refused) throw new Error(WHY);
      expect(String((refused as { code?: string }).code ?? (refused as Error).message)).toMatch(/attribute_unknown|not a account attribute/);
    }
  });
});
