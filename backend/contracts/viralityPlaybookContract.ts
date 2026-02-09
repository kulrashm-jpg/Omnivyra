/**
 * Virality Playbooks V1 Contract (Planning Only)
 *
 * This contract defines how planning components read playbooks and how
 * API inputs are used as planning signals. No execution, scheduling, or
 * automation is defined here.
 */

export type ViralityPlaybookObjective = 'awareness' | 'growth' | 'conversion' | 'authority';
export type ViralityPlaybookStatus = 'draft' | 'active' | 'archived';

export interface ViralityPlaybook {
  id: string;
  company_id: string;
  name: string;
  objective: ViralityPlaybookObjective;
  platforms: string[];
  content_types: string[];
  api_inputs: string[]; // external_api_sources ids
  tone_guidelines?: string | null;
  cadence_guidelines?: string | null;
  success_metrics?: Record<string, any> | null;
  status: ViralityPlaybookStatus;
  created_at: string;
  updated_at: string;
}

/**
 * Planning Read Contract
 * - Campaign planning UI reads playbooks for a company via GET /api/virality/playbooks.
 * - Users select a playbook to seed planning fields (intent, themes, mix, cadence).
 * - No execution or scheduling logic is allowed in this flow.
 */
export interface ViralityPlaybookReadContract {
  listPlaybooks: (companyId: string) => Promise<ViralityPlaybook[]>;
  selectPlaybook: (playbookId: string) => Promise<ViralityPlaybook>;
}

/**
 * How Campaigns Consume Playbooks
 * - Campaigns reference playbooks by ID (virality_playbook_id).
 * - Reference-only: campaigns do not inherit execution or automation.
 * - Campaign updates do not mutate playbook content.
 * - Playbook must be active and belong to the same company.
 */
export interface ViralityPlaybookCampaignBindingContract {
  bindPlaybook: (campaignId: string, playbookId: string | null) => Promise<void>;
  readPlaybookMetadata: (campaignId: string) => Promise<{
    playbook_id: string | null;
    name?: string;
    objective?: ViralityPlaybookObjective;
    platforms?: string[];
    content_types?: string[];
  }>;
}

/**
 * Campaign Read Model (Enriched with Playbook Context)
 * - playbook is informational only
 * - playbook does NOT affect campaign behavior
 * - campaign remains independently executable
 */
export interface CampaignReadModel {
  id: string;
  name: string;
  status: string;
  // Playbook metadata is contextual only and does not change behavior.
  // Campaigns remain the source of truth for execution.
  playbook: {
    id: string;
    name: string;
    objective: ViralityPlaybookObjective;
    platforms: string[];
    content_types: string[];
  } | null;
}

/**
 * Campaign Report/Export Context (Observability Only)
 * - playbook fields are informational metadata
 * - KPIs are evaluated independently of playbook data
 * - No downstream system should infer execution behavior
 */
export interface CampaignReportExportContext {
  playbook_id: string | null;
  playbook_name: string | null;
  playbook_objective: ViralityPlaybookObjective | null;
}

/**
 * API Input Usage Contract
 * - api_inputs reference External API sources for planning signals only.
 * - Planners may surface trend/competitor/topic signals derived elsewhere.
 * - Credentials and execution policies remain outside Virality Playbooks.
 */
export interface ViralityPlaybookApiInputsContract {
  resolveSignals: (apiSourceIds: string[]) => Promise<{
    topics: string[];
    competitors: string[];
    trends: string[];
  }>;
}

/**
 * Future Automation Hook (Comment Only)
 * - Automation MAY read playbooks in the future.
 * - It must live outside this contract and outside Virality planning code.
 * - No writeback or execution paths are defined here.
 */
export interface ViralityPlaybookAutomationExtension {
  // Intentionally empty: defined by future automation systems.
}
