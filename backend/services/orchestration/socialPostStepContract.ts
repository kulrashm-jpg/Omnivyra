/**
 * The `social_post` journey step — the contract between a workflow step and the
 * EXISTING social publishing engine (BOLT scheduler + publish queue).
 *
 * ─── TWO DIFFERENT THINGS, TWO DIFFERENT CHANNELS ───────────────────────────
 *   content       UNCHANGED. Share a resource WITH this prospect (case study,
 *                 whitepaper, guide — qualificationPlanning/planningConfig.ts,
 *                 automationExecution/taskGenerator.ts). Person-addressed. No
 *                 engine adapter claims it today; it stays visibly unsupported.
 *   social_post   NEW. A PUBLIC, tenant-wide post on a connected social account.
 *                 It is not addressed to anyone, so it is never "sent to a person".
 *
 * ─── WHAT A social_post STEP MAY REFERENCE ──────────────────────────────────
 * Exactly one already-RELEASED `scheduled_posts` row of the same tenant:
 *
 *   { "channel": "social_post", "social_post": { "scheduled_post_id": "<uuid>" } }
 *
 * A released row is the engine's own approved publishing object: approval is
 * enforced at the campaign release seam (lib/campaign/campaignRelease.ts), and
 * `lib/campaign/publishAuthorization.ts` treats a released row's existence as its
 * authorization. The step adds NO approval, creates NO post, carries NO copy and
 * names NO account, platform or time — all of those belong to the released row.
 * An `instruction` is refused on a social_post step, so authoring text can never
 * be mistaken for post copy.
 *
 * ─── SEMANTICS: THE STEP AWAITS THE PUBLICATION; IT NEVER CAUSES IT ─────────
 * A released row is already owned by the engine: the scheduler publishes it at its
 * released time, once, under the engine's post-level claim
 * (publishNowService.claimScheduledPostForPublish). A journey step runs once PER
 * PERSON; a post is ONE public object. So a social_post step is a GATE on that one
 * object: it completes when the engine has published it, waits while the engine
 * has not, and reports to a person anything only a person can resolve.
 *
 *   N enrolled people → N execution tasks → N READS of one row → at most ONE
 *   publication, performed by the engine's own schedule. No task ever triggers,
 *   re-triggers, reschedules or cancels the post.
 *
 * A step that should CAUSE a publication ("publish now when this person reaches
 * the step") is NOT supported: the engine has no per-task publish request — see
 * SOCIAL_POST_TRIGGER_UNSUPPORTED (./socialPostPublicationStatus.ts) and the
 * adapter header.
 *
 * Pure and import-free (workflowStore validates authored steps with it).
 * Execution-time status mapping: ./socialPostPublicationStatus.ts.
 */

export const SOCIAL_POST_CHANNEL = 'social_post' as const;

/** The optional step field. Required on (and only allowed on) a social_post step. */
export interface SocialPostStepSettings {
  /** A released `scheduled_posts` row of the step's own tenant. */
  readonly scheduled_post_id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only these keys may appear in `social_post`; anything else is refused, never ignored. */
const ALLOWED_KEYS: ReadonlySet<string> = new Set(['scheduled_post_id']);

export type SocialPostSettingsParse =
  | { ok: true; settings: SocialPostStepSettings }
  | { ok: false; code: 'invalid_step_social_post'; message: string };

/**
 * Validate the authored `social_post` field. Structural only: whether the row
 * exists, is this tenant's and is released is decided at execution time, against
 * the engine's own record (an authored reference can be withdrawn later).
 */
export function parseSocialPostSettings(raw: unknown, stepKey: string): SocialPostSettingsParse {
  const bad = (why: string): SocialPostSettingsParse =>
    ({ ok: false, code: 'invalid_step_social_post', message: `step "${stepKey}" social_post ${why}` });
  if (raw === undefined || raw === null) {
    return bad('is required: name the released scheduled post this step awaits ({ scheduled_post_id })');
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return bad('must be an object');
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!ALLOWED_KEYS.has(k)) return bad(`does not accept "${k}" (only scheduled_post_id; post copy, account and time belong to the released post)`);
  }
  const id = typeof o.scheduled_post_id === 'string' ? o.scheduled_post_id.trim() : '';
  if (!UUID.test(id)) return bad('scheduled_post_id must be a uuid');
  return { ok: true, settings: { scheduled_post_id: id.toLowerCase() } };
}

