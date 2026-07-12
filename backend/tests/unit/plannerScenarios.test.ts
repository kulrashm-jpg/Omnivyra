/**
 * CAMPAIGN-IMPL-003A — planner scenario matrix.
 *
 * Exercises the deterministic framework's CONTRACT across every scenario the
 * ticket lists: Writer / Creator / Intelligent Mix / duplicate / retry / partial
 * regeneration / blocked platform / disconnected account / generation failure /
 * render failure. Each scenario runs through a tiny deterministic planner
 * simulation built from the SAME primitives the live paths use
 * (regenerateBeforeDrop + PlannerTrace + buildReconciliation) and asserts:
 *
 *   1. Requested === Generated + Dropped          (the canonical invariant)
 *   2. regeneration is attempted BEFORE a duplicate is dropped
 *
 * This validates the framework composition without standing up the full
 * generateWeeklyStructure handler (which needs Supabase + AI infra); the live
 * wiring of these primitives is covered by the worker/CI typecheck + manual
 * validation. See the phase report's "Remaining gaps" for end-to-end coverage.
 */
import {
  regenerateBeforeDrop,
  PlannerTrace,
  computePlannerMetrics,
  DEFAULT_MAX_REGEN_ATTEMPTS,
} from '../../../lib/shared/campaign/campaignLifecycle';
import { buildReconciliation, type DropReasonCode } from '../../../lib/shared/campaign/plannerDiagnostics';

/** One requested piece the simulated planner must resolve to exactly one outcome. */
interface Req {
  content_type: string;
  platform: string;
  /** The text the "generator" would produce (used to force duplicates). */
  text: string;
  /** Force a specific failure at generation time. */
  fail?: DropReasonCode;
  /** Platforms this format may run on (empty ⇒ no_eligible_platform). */
  eligible?: string[];
  /** Connected accounts (missing platform ⇒ account_unavailable). */
  connected?: string[];
}

/**
 * A deterministic mini-planner. For each request it produces exactly one
 * outcome — generated OR a structured drop — regenerating duplicates before
 * dropping. Returns the reconciliation + regeneration stats, so the invariant
 * can be asserted per scenario.
 */
async function runPlan(reqs: Req[], maxRegen = DEFAULT_MAX_REGEN_ATTEMPTS) {
  const trace = new PlannerTrace();
  const seenByPlatform = new Map<string, Set<string>>();
  let generated = 0;

  for (const r of reqs) {
    // Eligibility / blocking gates (structured drops, never silent).
    if (r.eligible && r.eligible.length === 0) {
      trace.drop({ content_type: r.content_type, platform: r.platform, reason: 'no_eligible_platform', stage: 'structure_generation' });
      continue;
    }
    if (r.connected && !r.connected.includes(r.platform)) {
      trace.drop({ content_type: r.content_type, platform: r.platform, reason: 'account_unavailable', stage: 'scheduling' });
      continue;
    }
    if (r.fail) {
      trace.drop({ content_type: r.content_type, platform: r.platform, reason: r.fail, stage: 'validation' });
      continue;
    }

    const seen = seenByPlatform.get(r.platform) ?? new Set<string>();
    // Regenerate-before-drop: on a duplicate, derive a fresh variant (append an
    // attempt suffix — the deterministic stand-in for deriveSubTopic) up to the
    // budget; only drop if every attempt still collides.
    const outcome = await regenerateBeforeDrop<string>(
      (attempt) => Promise.resolve(attempt === 0 ? r.text : `${r.text}#${attempt}`),
      (cand) => !seen.has(cand),
      maxRegen,
    );
    if (outcome.result == null) {
      trace.drop({ content_type: r.content_type, platform: r.platform, reason: 'duplicate_content', stage: 'structure_generation' });
      continue;
    }
    if (outcome.regenerated) trace.regenerated(outcome.attempts);
    seen.add(outcome.result);
    seenByPlatform.set(r.platform, seen);
    generated += 1;
  }

  const drops = trace.getDrops();
  const recon = buildReconciliation(reqs.length, generated, drops);
  const metrics = computePlannerMetrics(recon, trace.getRegeneration());
  return { recon, metrics, regeneration: trace.getRegeneration() };
}

/** Assert the canonical invariant for a scenario result. */
function expectInvariant(recon: ReturnType<typeof buildReconciliation>) {
  expect(recon.ok).toBe(true);
  expect(recon.planned).toBe(recon.generated + recon.dropped.length);
}

describe('planner scenario matrix — Requested === Generated + Dropped, always', () => {
  it('Writer campaign — all unique, all generated', async () => {
    const { recon } = await runPlan([
      { content_type: 'post', platform: 'linkedin', text: 'a' },
      { content_type: 'article', platform: 'linkedin', text: 'b' },
      { content_type: 'post', platform: 'facebook', text: 'c' },
    ]);
    expectInvariant(recon);
    expect(recon.generated).toBe(3);
    expect(recon.dropped).toHaveLength(0);
  });

  it('Creator campaign — a render failure is dropped, invariant holds', async () => {
    const { recon, metrics } = await runPlan([
      { content_type: 'carousel', platform: 'instagram', text: 'a' },
      { content_type: 'reel', platform: 'instagram', text: 'b', fail: 'creator_render_failure' },
    ]);
    expectInvariant(recon);
    expect(recon.generated).toBe(1);
    expect(recon.dropped[0].reason).toBe('creator_render_failure');
    expect(metrics.generation_success_pct).toBe(50);
  });

  it('Intelligent Mix — writer + creator lanes, mixed outcomes', async () => {
    const { recon } = await runPlan([
      { content_type: 'post', platform: 'linkedin', text: 'a' },
      { content_type: 'carousel', platform: 'instagram', text: 'b' },
      { content_type: 'poll', platform: 'x', text: 'c', eligible: [] }, // poll↛X → no eligible platform
      { content_type: 'article', platform: 'facebook', text: 'd' },
    ]);
    expectInvariant(recon);
    expect(recon.generated).toBe(3);
    expect(recon.dropped[0].reason).toBe('no_eligible_platform');
  });

  it('Duplicate generation — regeneration occurs BEFORE dropping', async () => {
    // Three identical pieces on one platform. With a regen budget the first is
    // taken as-is and the next two regenerate into distinct variants → 0 drops.
    const { recon, regeneration } = await runPlan([
      { content_type: 'post', platform: 'linkedin', text: 'same' },
      { content_type: 'post', platform: 'linkedin', text: 'same' },
      { content_type: 'post', platform: 'linkedin', text: 'same' },
    ], 3);
    expectInvariant(recon);
    expect(recon.generated).toBe(3);
    expect(regeneration.regenerated).toBe(2); // two pieces were regenerated, not dropped
  });

  it('Duplicate generation — drop ONLY after the regen budget is exhausted', async () => {
    // Budget 0 ⇒ no regeneration lever ⇒ the duplicate must drop (structured).
    const { recon } = await runPlan([
      { content_type: 'post', platform: 'linkedin', text: 'same' },
      { content_type: 'post', platform: 'linkedin', text: 'same' },
    ], 0);
    expectInvariant(recon);
    expect(recon.generated).toBe(1);
    expect(recon.dropped[0].reason).toBe('duplicate_content');
  });

  it('Retry generation — a transient failure that later succeeds is not dropped', async () => {
    // Model retry via regenerateBeforeDrop: first attempt "fails" (null), retry succeeds.
    let attempt = 0;
    const out = await regenerateBeforeDrop<string>(
      () => Promise.resolve(attempt++ === 0 ? null : 'ok'),
      () => true,
      2,
    );
    expect(out.result).toBe('ok');
    expect(out.attempts).toBe(2);
    expect(out.regenerated).toBe(true);
  });

  it('Partial regeneration — re-running one week keeps the invariant for that subset', async () => {
    const { recon } = await runPlan([
      { content_type: 'post', platform: 'linkedin', text: 'w2-a' },
      { content_type: 'post', platform: 'linkedin', text: 'w2-a' }, // dup → drop (budget 0)
    ], 0);
    expectInvariant(recon);
    expect(recon.planned).toBe(2);
  });

  it('Blocked platform — poll on X is dropped with FORMAT/eligibility reason', async () => {
    const { recon } = await runPlan([
      { content_type: 'poll', platform: 'x', text: 'a', eligible: [] },
    ]);
    expectInvariant(recon);
    expect(recon.dropped[0].reason).toBe('no_eligible_platform');
  });

  it('Disconnected account — dropped as account_unavailable', async () => {
    const { recon } = await runPlan([
      { content_type: 'post', platform: 'linkedin', text: 'a', connected: ['facebook'] },
    ]);
    expectInvariant(recon);
    expect(recon.dropped[0].reason).toBe('account_unavailable');
  });

  it('Generation failure — dropped as generation_failure', async () => {
    const { recon } = await runPlan([
      { content_type: 'post', platform: 'linkedin', text: 'a', fail: 'generation_failure' },
    ]);
    expectInvariant(recon);
    expect(recon.dropped[0].reason).toBe('generation_failure');
  });

  it('Every mixed scenario still satisfies the invariant with 100% integrity', async () => {
    const { recon, metrics } = await runPlan([
      { content_type: 'post', platform: 'linkedin', text: 'a' },
      { content_type: 'post', platform: 'linkedin', text: 'a' },        // dup (budget 0 → drop)
      { content_type: 'poll', platform: 'x', text: 'b', eligible: [] }, // no platform
      { content_type: 'reel', platform: 'instagram', text: 'c', fail: 'creator_render_failure' },
      { content_type: 'article', platform: 'facebook', text: 'd', connected: ['linkedin'] }, // disconnected
      { content_type: 'article', platform: 'linkedin', text: 'e' },     // ok
    ], 0);
    expectInvariant(recon);
    expect(metrics.planner_integrity_pct).toBe(100);
    expect(recon.generated).toBe(2);
    expect(recon.dropped).toHaveLength(4);
  });
});
