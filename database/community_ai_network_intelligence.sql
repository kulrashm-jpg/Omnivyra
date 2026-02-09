DROP VIEW IF EXISTS community_ai_network_intelligence;

CREATE VIEW community_ai_network_intelligence (
  tenant_id,
  organization_id,
  platform,
  discovered_user_id,
  discovery_source,
  first_seen_at,
  last_seen_at,
  classification,
  eligibility,
  playbook_id,
  playbook_name,
  automation_level,
  total_actions_created,
  total_actions_executed,
  last_action_type,
  last_action_at
) AS
SELECT
  du.tenant_id,
  du.organization_id,
  du.platform,
  du.id AS discovered_user_id,
  du.discovery_source,
  du.first_seen_at,
  du.last_seen_at,
  du.classification,
  du.eligible_for_engagement AS eligibility,
  last_action.playbook_id,
  last_action.playbook_name,
  playbook.automation_levels->>'network_expansion' AS automation_level,
  COALESCE(action_counts.total_actions_created, 0) AS total_actions_created,
  COALESCE(action_counts.total_actions_executed, 0) AS total_actions_executed,
  last_action.action_type AS last_action_type,
  last_action.created_at AS last_action_at
FROM community_ai_discovered_users du
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS total_actions_created,
    COUNT(*) FILTER (WHERE status = 'executed') AS total_actions_executed
  FROM community_ai_actions actions
  WHERE actions.discovered_user_id = du.id
) action_counts ON TRUE
LEFT JOIN LATERAL (
  SELECT
    action_type,
    created_at,
    playbook_id,
    playbook_name
  FROM community_ai_actions actions
  WHERE actions.discovered_user_id = du.id
  ORDER BY created_at DESC NULLS LAST
  LIMIT 1
) last_action ON TRUE
LEFT JOIN community_ai_playbooks playbook
  ON playbook.id = last_action.playbook_id
  AND playbook.tenant_id = du.tenant_id
  AND playbook.organization_id = du.organization_id;
