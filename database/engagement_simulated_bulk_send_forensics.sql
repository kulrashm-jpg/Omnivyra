-- ============================================================================
-- Engagement Center — historical simulated bulk-send forensics
--
-- READ-ONLY. Every statement below is a SELECT. Nothing here mutates, deletes,
-- or repairs anything, and it must not be turned into a repair script without
-- explicit operator sign-off (see the remediation note at the bottom).
--
-- BACKGROUND
--   Until the F5-P1.2 fix, `bulkEngagementService.sendReply` dispatched with
--   `execution_mode: 'manual'`. The executor routes that to
--   `recordManualSimulation`, which returns:
--       { ok: true, status: 'sent_unverified', response: { simulated: true } }
--   `bulkReplyThreads` checked only `result.ok`, so every simulated no-op was
--   counted as a real send. Nothing was ever posted to any platform.
--
--   Both bulk routes were affected:
--       /api/engagement/thread/bulk-ai-reply
--       /api/engagement/thread/bulk-pattern-reply
--
--   Single replies via /api/engagement/reply are NOT affected: that route has
--   always resolved a real execution mode from the capability map.
--
-- HOW AFFECTED ROWS ARE IDENTIFIED
--   `executeAction` ran with persist + auto_insert, so each attempt left a
--   community_ai_actions row. The simulation signature is:
--       status = 'sent_unverified'
--    AND execution_result -> 'response' ->> 'simulated' = 'true'
--    AND execution_mode = 'manual'
--   Use `source`/playbook context to separate bulk from any other manual-mode
--   caller if one is later discovered.
-- ============================================================================


-- ── 1. Scope: how many simulated sends exist, by company and month ──────────
SELECT
    a.organization_id,
    date_trunc('month', a.created_at)          AS month,
    a.platform,
    a.action_type,
    count(*)                                   AS simulated_sends,
    min(a.created_at)                          AS first_seen,
    max(a.created_at)                          AS last_seen
FROM community_ai_actions a
WHERE a.status = 'sent_unverified'
  AND a.execution_mode = 'manual'
  AND (a.execution_result -> 'response' ->> 'simulated') = 'true'
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2 DESC;


-- ── 2. The affected action rows themselves (the forensic spine) ─────────────
SELECT
    a.id                                       AS action_id,
    a.organization_id,
    a.platform,
    a.action_type,
    a.target_id,
    a.acting_user_id,
    a.created_at,
    a.executed_at,
    a.execution_correlation_id,
    left(coalesce(a.final_text, a.suggested_text), 120) AS text_preview
FROM community_ai_actions a
WHERE a.status = 'sent_unverified'
  AND a.execution_mode = 'manual'
  AND (a.execution_result -> 'response' ->> 'simulated') = 'true'
ORDER BY a.organization_id, a.created_at DESC;


-- ── 3. PRIORITY: opportunities that may have been resolved by a reply that
--       was never sent.
--
--    `resolveOpportunityByReply(thread_id, ...)` fired unconditionally after a
--    "successful" simulated send. It is keyed by THREAD, not by action, so the
--    join below is a temporal correlation, not a proof of causation: an
--    opportunity may legitimately have been resolved by a human in the same
--    window. Treat every row as a CANDIDATE requiring review.
-- ---------------------------------------------------------------------------
WITH simulated AS (
    SELECT a.id, a.organization_id, a.target_id, a.created_at
    FROM community_ai_actions a
    WHERE a.status = 'sent_unverified'
      AND a.execution_mode = 'manual'
      AND (a.execution_result -> 'response' ->> 'simulated') = 'true'
),
sim_threads AS (
    -- action.target_id is the platform message id (or the message uuid when no
    -- platform id existed); resolve both shapes back to a thread.
    SELECT s.id AS action_id, s.organization_id, s.created_at, m.thread_id
    FROM simulated s
    JOIN engagement_messages m
      ON m.platform_message_id = s.target_id
      OR m.id::text            = s.target_id
)
SELECT
    o.id                                       AS opportunity_id,
    o.organization_id,
    st.thread_id,
    st.action_id                               AS simulated_action_id,
    st.created_at                              AS simulated_at,
    o.status                                   AS current_opportunity_status,
    o.updated_at                               AS opportunity_updated_at,
    -- Tight temporal correlation is the strongest available signal.
    (o.updated_at BETWEEN st.created_at AND st.created_at + interval '5 minutes')
                                               AS likely_caused_by_simulation
FROM sim_threads st
JOIN engagement_opportunities o
  ON o.thread_id = st.thread_id
 AND o.organization_id = st.organization_id
ORDER BY likely_caused_by_simulation DESC, st.created_at DESC;


-- ── 4. Reply-performance rows attributed to simulated sends ─────────────────
--    recordReplyPerformance fired on the simulated path with ai_generated=true.
SELECT
    p.*,
    st.action_id                               AS simulated_action_id
FROM (
    SELECT a.id AS action_id, a.organization_id, a.target_id, a.created_at
    FROM community_ai_actions a
    WHERE a.status = 'sent_unverified'
      AND a.execution_mode = 'manual'
      AND (a.execution_result -> 'response' ->> 'simulated') = 'true'
) st
JOIN engagement_messages m
  ON m.platform_message_id = st.target_id OR m.id::text = st.target_id
JOIN response_performance p
  ON p.thread_id = m.thread_id
 AND p.organization_id = st.organization_id
 AND p.created_at BETWEEN st.created_at - interval '1 minute'
                      AND st.created_at + interval '5 minutes'
ORDER BY st.created_at DESC;


-- ── 5. Sanity check: simulated sends should have produced NO outbound message.
--    Any row here would mean something else wrote an outbound message in the
--    same window — worth understanding before any remediation.
WITH simulated AS (
    SELECT a.id, a.organization_id, a.target_id, a.created_at
    FROM community_ai_actions a
    WHERE a.status = 'sent_unverified'
      AND a.execution_mode = 'manual'
      AND (a.execution_result -> 'response' ->> 'simulated') = 'true'
)
SELECT s.id AS action_id, s.organization_id, m.thread_id, out.id AS outgoing_message_id
FROM simulated s
JOIN engagement_messages m
  ON m.platform_message_id = s.target_id OR m.id::text = s.target_id
JOIN engagement_messages out
  ON out.thread_id = m.thread_id
 AND out.direction = 'outgoing'
 AND out.platform_created_at BETWEEN s.created_at AND s.created_at + interval '5 minutes'
ORDER BY s.created_at DESC;


-- ============================================================================
-- REMEDIATION NOTE — DO NOT AUTOMATE
--
-- Query 3 identifies CANDIDATES, not confirmed corruption. A deterministic
-- reversal is only defensible where ALL of the following hold for a row:
--   (a) likely_caused_by_simulation = true;
--   (b) query 5 returns no outbound message for that thread in the window
--       (i.e. no human actually replied around the same time);
--   (c) the opportunity has not since been modified by a human — check the
--       audit trail / updated_at against later activity;
--   (d) the business owner confirms the opportunity should reopen.
--
-- Condition (d) cannot be established from data. Any repair therefore requires
-- OPERATOR REVIEW. Do not bulk-reopen opportunities from this query.
--
-- Historical metrics (bulk_reply_count, reply performance) should be QUALIFIED
-- with a dashboard annotation for the affected window rather than rewritten:
-- the underlying events did occur as *attempts*, they simply never reached a
-- platform. Deleting them would destroy the evidence this file depends on.
-- ============================================================================
