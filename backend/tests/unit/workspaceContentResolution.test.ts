/**
 * Strategic Mix R3-P2 — canonical content resolution contract.
 *
 * Locks the resolution ladder (R3-P2.1, Release 3 freeze semantics):
 * APPROVED → adopt — the ONLY adoption tier. Review and draft are planning
 * states and never execution candidates ("review" universally means "not
 * yet approved"); missing/malformed → not adopted, never throws. The body
 * is returned VERBATIM (trimmed) — execution publishes exactly what the
 * workspace stored.
 */

import { resolveWorkspaceContent } from '../../../lib/campaign/workspaceContentResolution';

const envelope = (status: string | undefined, body: string | null = 'Approved copy.') => ({
  placeholder: true,
  label: 'linkedin post',
  draft_content: body === null ? undefined : { body, source: 'ai', updated_at: '2026-07-12T09:00:00.000Z' },
  content_planning_status: status,
});

describe('resolveWorkspaceContent', () => {
  test('approved content adopts at the approved tier, body verbatim', () => {
    const r = resolveWorkspaceContent(envelope('approved', '  Exact body. #tag  '));
    expect(r).toEqual({ adopted: true, body: 'Exact body. #tag', tier: 'approved', reason: 'approved' });
  });

  test('review content is NEVER eligible — planning state only (R3-P2.1)', () => {
    const r = resolveWorkspaceContent(envelope('review'));
    expect(r).toEqual({ adopted: false, body: null, tier: null, reason: 'review_not_eligible' });
  });

  test('draft content is NOT eligible — generation remains the source', () => {
    const r = resolveWorkspaceContent(envelope('draft'));
    expect(r).toMatchObject({ adopted: false, body: null, reason: 'draft_not_eligible' });
  });

  test('status without a body never adopts', () => {
    expect(resolveWorkspaceContent(envelope('approved', '   ')).adopted).toBe(false);
    expect(resolveWorkspaceContent(envelope('approved', null)).reason).toBe('no_workspace_content');
  });

  test('legacy/malformed envelopes resolve not-adopted without throwing', () => {
    for (const input of [null, undefined, 'a string', 42, {}, { draft_content: 'not-an-object' }, { draft_content: { body: 7 } }]) {
      const r = resolveWorkspaceContent(input);
      expect(r.adopted).toBe(false);
      expect(r.reason).toBe('no_workspace_content');
    }
  });

  test('unknown status values fall to draft_not_eligible (closed vocabulary)', () => {
    expect(resolveWorkspaceContent(envelope('shipped')).reason).toBe('draft_not_eligible');
    expect(resolveWorkspaceContent(envelope(undefined)).reason).toBe('draft_not_eligible');
  });
});
