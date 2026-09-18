/**
 * WSF-ORD-004 — pages/api/engagement/ai-suggestion.ts
 *
 * THE DEFECT: the `accepted` / `rejected` branch had NO authorization at all.
 * It called resolveUserContext, which returns an UNAUTHENTICATED context
 * rather than rejecting (AUTH-CTX-001), and then updated an ai_suggestions row
 * selected purely by the caller-supplied suggestion_id / correlation_id.
 *
 * The risk was integrity, not disclosure: anyone — signed in as another tenant
 * or not signed in at all — could resolve any tenant's suggestion as accepted
 * or rejected, poisoning the accept/reject signal the intelligence layer
 * learns from.
 *
 * The fix authenticates, resolves the suggestion's owning organization,
 * authorizes the caller against it with the canonical guard, and carries that
 * organization into the UPDATE's own predicate.
 *
 * Only the database and the identity provider are faked.
 */
import { seed, invoke, rows, writeCalls, CO_A, CO_B, UNKNOWN_ID } from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

/* eslint-disable @typescript-eslint/no-var-requires */
const aiSuggestion = require('../../../pages/api/engagement/ai-suggestion').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const SUG_A = 'sug-a-000-0000-0000-00000000000a';
const SUG_B = 'sug-b-000-0000-0000-00000000000b';
const CORR_B = 'corr-b-00-0000-0000-00000000000b';

function world() {
  seed({
    ai_suggestions: [
      {
        id: SUG_A, organization_id: CO_A, platform: 'linkedin', action_type: 'reply',
        execution_correlation_id: 'corr-a-00-0000-0000-00000000000a',
        accepted_at: null, rejected_at: null,
      },
      {
        id: SUG_B, organization_id: CO_B, platform: 'linkedin', action_type: 'reply',
        execution_correlation_id: CORR_B,
        accepted_at: null, rejected_at: null,
      },
    ],
  });
}
beforeEach(world);

const suggestion = (id: string) => rows('ai_suggestions').find((r) => r.id === id)!;
/** Writes that actually landed on the suggestions table. */
const suggestionWrites = () => writeCalls(['ai_suggestions']);

describe('WSF-ORD-004 — engagement/ai-suggestion accepted/rejected authorization', () => {
  for (const event of ['accepted', 'rejected'] as const) {
    describe(`event=${event}`, () => {
      it('THE EXPLOIT: an ANONYMOUS caller could resolve any suggestion — now 401, row untouched', async () => {
        const r = await invoke(aiSuggestion, { method: 'POST', as: null, body: { event, suggestion_id: SUG_B } });
        expect(r.status).toBe(401);
        expect(suggestionWrites()).toHaveLength(0);
        expect(suggestion(SUG_B).accepted_at).toBeNull();
        expect(suggestion(SUG_B).rejected_at).toBeNull();
      });

      it("THE EXPLOIT: a member of A could resolve B's suggestion by id — now 403, row untouched", async () => {
        const r = await invoke(aiSuggestion, { method: 'POST', as: 'A', body: { event, suggestion_id: SUG_B } });
        expect(r.status).toBe(403);
        expect(suggestionWrites()).toHaveLength(0);
        expect(suggestion(SUG_B).accepted_at).toBeNull();
        expect(suggestion(SUG_B).rejected_at).toBeNull();
      });

      it("THE EXPLOIT: the correlation_id route into B's suggestion is closed too — 403, row untouched", async () => {
        const r = await invoke(aiSuggestion, { method: 'POST', as: 'A', body: { event, correlation_id: CORR_B } });
        expect(r.status).toBe(403);
        expect(suggestionWrites()).toHaveLength(0);
        expect(suggestion(SUG_B).accepted_at).toBeNull();
        expect(suggestion(SUG_B).rejected_at).toBeNull();
      });

      it('an unknown suggestion id → 404, nothing written', async () => {
        const r = await invoke(aiSuggestion, { method: 'POST', as: 'A', body: { event, suggestion_id: UNKNOWN_ID } });
        expect(r.status).toBe(404);
        expect(suggestionWrites()).toHaveLength(0);
      });

      it('the owning tenant still resolves its OWN suggestion → 200, and the UPDATE is scoped to that tenant', async () => {
        const r = await invoke(aiSuggestion, { method: 'POST', as: 'A', body: { event, suggestion_id: SUG_A } });
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ success: true });
        const writes = suggestionWrites();
        expect(writes).toHaveLength(1);
        // The authorized tenant is part of the write's predicate, so the
        // authorization and the mutation are a single statement.
        expect(writes[0].filters).toMatchObject({ organization_id: CO_A, id: SUG_A });
        expect(suggestion(SUG_A)[event === 'accepted' ? 'accepted_at' : 'rejected_at']).toEqual(expect.any(String));
      });

      it('missing both ids is still a 400 before anything is read', async () => {
        const r = await invoke(aiSuggestion, { method: 'POST', as: 'A', body: { event } });
        expect(r.status).toBe(400);
        expect(suggestionWrites()).toHaveLength(0);
      });
    });
  }

  describe('event=shown (unchanged)', () => {
    it('a member of A naming company B is still refused → 403, nothing inserted', async () => {
      const r = await invoke(aiSuggestion, {
        method: 'POST', as: 'A',
        body: { event: 'shown', organization_id: CO_B, platform: 'linkedin', action_type: 'reply' },
      });
      expect(r.status).toBe(403);
      expect(suggestionWrites()).toHaveLength(0);
    });

    it('a member of A still records its own → 200', async () => {
      const r = await invoke(aiSuggestion, {
        method: 'POST', as: 'A',
        body: { event: 'shown', organization_id: CO_A, platform: 'linkedin', action_type: 'reply' },
      });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ success: true });
      expect(suggestionWrites()).toHaveLength(1);
    });
  });
});
