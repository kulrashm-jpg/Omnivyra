/**
 * Phase 106 — a failed publish is visible on the activity that planned it.
 *
 * Campaign 4ead230b's LinkedIn post failed with "Your linkedin session has
 * expired". Its `daily_content_plans` row still read:
 *
 *     status = 'planned',  failure_reason = null,  attempts = 0
 *
 * indistinguishable from an activity that simply had not run yet. The failure
 * existed only inside the individual post's error_message, which is why five
 * more activities could sit apparently healthy while nothing worked.
 *
 * The annotation is written in the canonical failure writer so every publish
 * path inherits it, and it is non-fatal: the post is already correctly marked
 * failed, and losing the annotation must never turn a handled failure into a
 * thrown one.
 */

export {};

const updates: Array<{ table: string; payload: Record<string, unknown>; eq: [string, string][] }> = [];
let scheduledPostsError: { message: string } | null = null;
let plansThrows = false;

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => {
        const eq: [string, string][] = [];
        const builder: any = {
          eq: (col: string, val: string) => {
            eq.push([col, val]);
            if (table === 'daily_content_plans') {
              if (plansThrows) throw new Error('plans table unavailable');
              updates.push({ table, payload, eq });
              return Promise.resolve({ error: null });
            }
            return builder;
          },
          select: () => {
            updates.push({ table, payload, eq });
            return Promise.resolve({ data: [{ id: 'sp-1' }], error: scheduledPostsError });
          },
          then: (res: any) => {
            updates.push({ table, payload, eq });
            return Promise.resolve({ error: scheduledPostsError }).then(res);
          },
        };
        return builder;
      },
    }),
  },
}));

let updateScheduledPostOnFailure: typeof import('../../db/queries').updateScheduledPostOnFailure;

beforeAll(async () => {
  ({ updateScheduledPostOnFailure } = await import('../../db/queries'));
});

beforeEach(() => {
  updates.length = 0;
  scheduledPostsError = null;
  plansThrows = false;
});

const planWrite = () => updates.find((u) => u.table === 'daily_content_plans');

describe('A — the plan row records the failure', () => {
  it('CRITICAL: a publish failure annotates the linked activity', async () => {
    await updateScheduledPostOnFailure('sp-1', 'Your linkedin session has expired.');

    const plan = planWrite();
    expect(plan).toBeDefined();
    expect(plan!.payload.failure_type).toBe('publish_failed');
    expect(String(plan!.payload.failure_reason)).toMatch(/session has expired/i);
  });

  it('CRITICAL: it is linked by scheduled_post_id, not by guesswork', async () => {
    await updateScheduledPostOnFailure('sp-1', 'boom');
    expect(planWrite()!.eq).toContainEqual(['scheduled_post_id', 'sp-1']);
  });

  it('CRITICAL: the scheduled post is still marked failed', async () => {
    await updateScheduledPostOnFailure('sp-1', 'boom');
    const post = updates.find((u) => u.table === 'scheduled_posts');
    expect(post!.payload.status).toBe('failed');
    expect(post!.payload.error_message).toBe('boom');
  });

  it('a very long provider message is bounded', async () => {
    await updateScheduledPostOnFailure('sp-1', 'x'.repeat(2000));
    expect(String(planWrite()!.payload.failure_reason).length).toBeLessThanOrEqual(500);
  });
});

describe('B — the annotation never makes things worse', () => {
  it('CRITICAL: a failure writing the annotation does not throw', async () => {
    plansThrows = true;
    // The post is already correctly marked failed; losing the annotation must
    // not turn a handled failure into an unhandled one.
    await expect(updateScheduledPostOnFailure('sp-1', 'boom')).resolves.toEqual({ applied: true });
  });

  it('CRITICAL: a CAS mismatch annotates nothing', async () => {
    // Another writer already moved the row — this publish did not fail it, so
    // it must not stamp a failure onto someone else's activity.
    const mod = await import('../../db/supabaseClient');
    (mod.supabase as any).from = (table: string) => ({
      update: () => ({
        eq: () => ({
          eq: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
        }),
      }),
    });

    const r = await updateScheduledPostOnFailure('sp-1', 'boom', 'scheduled');
    expect(r).toEqual({ applied: false, reason: 'cas_mismatch' });
  });
});
