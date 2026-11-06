#!/usr/bin/env node
/**
 * SAFETY-GATE-001 — select the execution-safety unit-test suites for CI.
 *
 * WHY THIS EXISTS (and why it is not an extension of pi-test-suites.js)
 * --------------------------------------------------------------------
 * The only derived unit-test gate is scripts/ci/pi-test-suites.js. It selects
 * a suite when its basename starts with `pi` OR its source mentions one of the
 * PI_MARKERS (prospectIdentity, leadIngestion, pages/api/outreach, ...). The
 * orchestration / community-executor / extension-dispatch / RPA-session /
 * engagement-idempotency safety suites match neither rule, so they were never
 * selected and never ran in CI.
 *
 * Widening PI_MARKERS to cover them was measured and rejected: markers such as
 * `orchestration`, `communityAiActionExecutor`, `extension` or
 * `engagementRequest` also match dozens of pre-existing engagement suites whose
 * CI status is unknown, which would change the PI gate's meaning and could turn
 * it red for reasons unrelated to this work. This selector is therefore
 * SEPARATE, and deliberately narrow.
 *
 * SELECTION RULE (both parts are explicit and reviewable)
 * ------------------------------------------------------
 *   1. REGISTRY — every path in SAFETY_SUITE_REGISTRY below. A registered path
 *      that does not exist (renamed, moved, deleted) FAILS the run: it is never
 *      silently dropped.
 *   2. NAMING CONVENTION — a file directly in backend/tests/unit/ whose
 *      basename is `<camelArea>Safety.<facet>.test.ts` or
 *      `<camelArea>Idempotency.<facet>.test.ts` (the dotted facet is required).
 *      Measured against the tree at dd320365 this matches only stack suites;
 *      undotted names such as aiSafetyWave1 / executionSafety /
 *      boltExecuteIdempotency are deliberately NOT matched.
 *
 * TO GATE A NEW SAFETY SUITE: either name it by the convention, or add its
 * path to SAFETY_SUITE_REGISTRY (the registry is the preferred route for any
 * name that does not fit the convention). Nothing else is ever selected.
 *
 * Usage:
 *   node scripts/ci/safety-test-suites.js            # newline-separated paths
 *   node scripts/ci/safety-test-suites.js --count    # count only
 *   node scripts/ci/safety-test-suites.js --explain  # per-suite reason
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const UNIT_DIR = 'backend/tests/unit';

/**
 * Explicit registry. Repo-relative POSIX paths. Grouped by area; every entry is
 * a suite added or changed by the orchestration / execution-safety stack
 * (d51360b0..dd320365) that the PI gate does not already select, plus this
 * selector's own regression test.
 */
const SAFETY_SUITE_REGISTRY = [
  // Community executor execution safety
  'backend/tests/unit/communityExecutionSafety.executor.test.ts',
  'backend/tests/unit/communityExecutionSafety.migration.test.ts',
  'backend/tests/unit/communityExecutionSafety.retryQueue.test.ts',
  'backend/tests/unit/communityExecutionSafety.rpa.test.ts',
  'backend/tests/unit/communityExecutionSafety.targets.test.ts',
  'backend/tests/unit/communityAiActionExecutor.manualApi.test.ts',
  // Extension dispatch / claim-lease / DM dispatch safety
  'backend/tests/unit/extensionDispatchSafety.migration.test.ts',
  'backend/tests/unit/extensionDispatchSafety.routes.test.ts',
  'backend/tests/unit/extensionClaimLeaseDeliverySafety.test.ts',
  'backend/tests/unit/extensionDispatchLeaseRenewal.test.ts',
  'backend/tests/unit/dmDispatchSafety.extension.test.ts',
  // RPA session security
  'backend/tests/unit/rpaSessionSecurity.test.ts',
  // Engagement idempotency and send boundaries
  'backend/tests/unit/engagementReplyLikeIdempotency.test.ts',
  'backend/tests/unit/engagementRequestIdempotency.migration.test.ts',
  'backend/tests/unit/engagementRequestIdempotencyDurable.test.ts',
  'backend/tests/unit/engagementAiSendBoundaryF5.test.ts',
  'backend/tests/unit/engagementBulkDispatchAcceptance.test.ts',
  'backend/tests/unit/engagementBulkDmClosureP11.test.ts',
  'backend/tests/unit/engagementBulkGovernanceP12.test.ts',
  'backend/tests/unit/w0cWhatsappBroadcastGovernance.test.ts',
  // Identity verification
  'backend/tests/unit/identityVerificationContract.test.ts',
  // Orchestration engine / community seam / targeting
  'backend/tests/unit/orchestrationCommunityAdapter.test.ts',
  'backend/tests/unit/orchestrationCommunityEngineSeam.test.ts',
  'backend/tests/unit/orchestrationCommunityIdentityLink.test.ts',
  'backend/tests/unit/orchestrationCommunityJourneyLink.test.ts',
  'backend/tests/unit/orchestrationDefinitionReadback.test.ts',
  'backend/tests/unit/orchestrationEngineContract.test.ts',
  'backend/tests/unit/orchestrationTargetingContract.test.ts',
  // Engine adapters / social publish
  'backend/tests/unit/browserEngineAdapter.test.ts',
  'backend/tests/unit/socialPostAdapterSafety.test.ts',
  'backend/tests/unit/socialPostStepContract.test.ts',
  'backend/tests/unit/socialPublishEngineAdapter.test.ts',
  'backend/tests/unit/publishChannelVocabulary.test.ts',
  // Migration re-run / rollback-order safety (20261231000009)
  'backend/tests/unit/migrationRerunSafety.test.ts',
  // Legacy RPA session invalidation (20261231000010) and RPA login-token pruning
  'backend/tests/unit/rpaLegacySessionInvalidation.test.ts',
  'backend/tests/unit/rpaAuthTokenRedemptionPrune.test.ts',
  // Bulk-like durable request identity
  'backend/tests/unit/engagementBulkLikeIdempotency.test.ts',
  // Extension suites made portable (OMNIVYRA_EXTENSION_ROOT) and their portability check
  'backend/tests/unit/extensionProductionTargeting.test.ts',
  'backend/tests/unit/extensionSourceRootPortability.test.ts',
  // Gate self-check: the regression test for this selector
  'backend/tests/unit/safetyTestSuitesSelector.test.ts',
  // real-schema-ci.yml path-filter regression: the filter decides whether the
  // stack's migrations and stores ever replay against real PostgreSQL. (The PI
  // selector also picks it up, but only because it quotes PI path strings; the
  // registry entry is the deliberate gate.)
  'backend/tests/unit/realSchemaCiPathFilter.test.ts',
  // Schema-parity manifest covers every object the stack's migrations create, and
  // PREDEPLOY_STRICT_SCHEMA=1 fails closed (connection unavailable / check skipped)
  'backend/tests/unit/verifySchemaParityCoverage.test.ts',
  'backend/tests/unit/predeployStrictSchema.test.ts',
  // Release-gate production tooling: the verifier only uses the explicit read-only
  // credential, the session self-check fails closed, the catalog comparator never
  // hides owner / MAINTAIN / role-mapped differences, and recovered SQL is judged
  // byte-for-byte only.
  'backend/tests/unit/verifySchemaParityCredentialSource.test.ts',
  'backend/tests/unit/sessionReadinessCheck.test.ts',
  'backend/tests/unit/semanticCatalogCompare.test.ts',
  'backend/tests/unit/recoveryIntake.test.ts',
  // C1 grants/ACL check stays read-only and keeps its absolute anon/authenticated
  // assertions (P10), which catch exposures shared by both compared databases.
  'backend/tests/unit/grantsAclCheck.test.ts',
  // Outreach engine fixes: a lost STOP, a false delivery status, a queued journey
  // send after a reply or kill switch, an unauthorized cron publish, a mock id read
  // as published, and a network candidate escaping the observation lock.
  'backend/tests/unit/whatsappWebhookRedelivery.test.ts',
  'backend/tests/unit/whatsappWebhookReplay.test.ts',
  'backend/tests/unit/whatsappDeliveryStatus.test.ts',
  'backend/tests/unit/whatsappEnqueuePagination.test.ts',
  'backend/tests/unit/whatsappJourneySendControls.test.ts',
  'backend/tests/unit/processScheduledPostsAuthorization.test.ts',
  'backend/tests/unit/publishToPlatformHonestRefusals.test.ts',
  'backend/tests/unit/networkActionCandidateService.test.ts',
  'backend/tests/unit/orchestrationCommunityAdapterGates.test.ts',
  'backend/tests/unit/outreachFutureEngineCompatibility.test.ts',
  'backend/tests/unit/orchestrationExecutionContract.test.ts',
  'backend/tests/unit/orchestrationJourneyExit.test.ts',
  // Prompt 3 community execution safety (OD-1): L-3 enforcement, the execute route
  // mapping and pre-claim gates, tenant-policy scheduler, the skip CAS, the UI
  // response reader, and journey steps (LD-4: not auto, approval of record).
  'backend/tests/unit/communityL3RecheckEnforcement.test.ts',
  'backend/tests/unit/communityExecuteRouteMapping.test.ts',
  'backend/tests/unit/communitySchedulerTenantPolicy.test.ts',
  'backend/tests/unit/communityActionsSkipCas.test.ts',
  'backend/tests/unit/communityExecuteResponseReader.test.ts',
  'backend/tests/unit/orchestrationCommunityJourneyApproval.test.ts',
  'backend/tests/unit/extensionLeaseHandoutPolicyGate.test.ts',
  'backend/tests/unit/rpaRetryFlushGates.test.ts',
  'backend/tests/unit/rpaRetryHeldClaimDispatch.test.ts',
  // Prompt 4: restrictions before any pause (STOP, complaint, unsubscribe), RV-1, and
  // the follow-up retiming engine (never wired to classifier output while SC-7 is open).
  'backend/tests/unit/p4GovernancePrecedence.test.ts',
  'backend/tests/unit/q4FollowUpRetiming.test.ts',
  // Prompt 5: O2-F1 (every resume moves a run only from paused), a person's reply
  // evaluation on the run route, the reply consequence matrix, and the classifier wiring
  // that stays switched off until SC7-R.
  'backend/tests/unit/o2f1ResumeCompareAndSet.test.ts',
  'backend/tests/unit/journeyReplyEvaluationRoute.test.ts',
  'backend/tests/unit/replyConsequenceMatrix.test.ts',
  'backend/tests/unit/replyClassificationGuard.test.ts',
  // Prompt 5 X-3: an unevaluated WhatsApp inbound is never `replied`, never PI `engaged`,
  // never positive engagement; the PI feed takes a STOP only.
  'backend/tests/unit/x3WhatsAppInboundUnclassified.test.ts',
  // Prompt 5 producer compatibility: real SES, WhatsApp and operator producers into the
  // Orchestration readers (STOP stays unsubscribed, operator replied stays replied).
  'backend/tests/unit/orch_c5_producer_compat.test.ts',
];

/** Narrow naming convention; see header. Applied to basenames in UNIT_DIR only. */
const SAFETY_NAME_CONVENTION = /^[a-z][A-Za-z0-9]*(?:Safety|Idempotency)\.[a-z][A-Za-z0-9]*\.test\.ts$/;

/**
 * Floor guard. Every registered suite must exist and is always selected, so a
 * selection smaller than the registry means the selector itself broke.
 */
const MIN_EXPECTED = SAFETY_SUITE_REGISTRY.length;

const toPosix = (p) => p.split(path.sep).join('/');

/**
 * Pure selection. Returns { selected: [{rel, reasons}], missing: [rel], errors: [string] }.
 * `root` and `registry` are injectable so the selector's own regression test can
 * exercise the failure paths against a temporary tree.
 */
function selectSafetySuites({ root = ROOT, registry = SAFETY_SUITE_REGISTRY, minExpected } = {}) {
  const floor = typeof minExpected === 'number' ? minExpected : registry.length;
  const errors = [];
  const missing = [];
  const reasons = new Map();
  const add = (rel, reason) => {
    if (!reasons.has(rel)) reasons.set(rel, []);
    if (!reasons.get(rel).includes(reason)) reasons.get(rel).push(reason);
  };

  const seen = new Set();
  for (const rel of registry) {
    if (seen.has(rel)) errors.push(`registry lists ${rel} more than once`);
    seen.add(rel);
    if (!/\.test\.tsx?$/.test(rel)) errors.push(`registry entry is not a test file: ${rel}`);
    if (/(^|\/)(realschema|manual)\//.test(rel)) {
      errors.push(`registry entry is in a directory jest.config.js ignores: ${rel}`);
    }
    if (!fs.existsSync(path.join(root, rel))) {
      missing.push(rel);
      continue;
    }
    add(rel, 'registry');
  }

  const unitAbs = path.join(root, UNIT_DIR);
  if (fs.existsSync(unitAbs)) {
    for (const entry of fs.readdirSync(unitAbs, { withFileTypes: true })) {
      if (entry.isFile() && SAFETY_NAME_CONVENTION.test(entry.name)) {
        add(`${UNIT_DIR}/${entry.name}`, 'convention');
      }
    }
  } else {
    errors.push(`unit test directory not found: ${UNIT_DIR}`);
  }

  if (missing.length) {
    errors.push(
      `registered safety suite(s) missing — rename/move/delete must update SAFETY_SUITE_REGISTRY:\n  `
      + missing.join('\n  '),
    );
  }

  const selected = [...reasons.keys()].sort().map((rel) => ({ rel: toPosix(rel), reasons: reasons.get(rel) }));
  if (selected.length < floor) {
    errors.push(`safety suite selection has ${selected.length} suites, below the floor of ${floor}`);
  }
  return { selected, missing, errors };
}

function main(argv) {
  const { selected, errors } = selectSafetySuites();
  if (errors.length) {
    process.stderr.write(`SAFETY SUITE SELECTION FAILED:\n${errors.map((e) => `- ${e}`).join('\n')}\n`);
    process.exit(1);
  }
  if (argv.includes('--count')) {
    process.stdout.write(`${selected.length}\n`);
  } else if (argv.includes('--explain')) {
    for (const s of selected) process.stdout.write(`${s.reasons.join('+').padEnd(20)} ${s.rel}\n`);
    process.stdout.write(`\ntotal: ${selected.length}\n`);
  } else {
    for (const s of selected) process.stdout.write(`${s.rel}\n`);
  }
}

module.exports = {
  SAFETY_SUITE_REGISTRY,
  SAFETY_NAME_CONVENTION,
  MIN_EXPECTED,
  selectSafetySuites,
};

if (require.main === module) main(process.argv.slice(2));
