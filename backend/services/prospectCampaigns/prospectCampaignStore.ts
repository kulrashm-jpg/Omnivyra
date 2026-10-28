/**
 * PI-CAMPAIGN-IDENTITY-014 — the canonical Prospect Campaign. THE writer.
 *
 * One module owns every write to `prospect_campaigns`. A test asserts no other
 * non-test file reaches that table.
 *
 * ─── A CAMPAIGN IS AN IDENTITY, NOT A PLAN ────────────────────────────────
 * It names a tenant, a name, a description and a status. It names no list, no
 * ICP, no Offering, no prospect, no person and no task — so nothing in this
 * module can reach the population layer or the execution layer. Creating a
 * campaign is structurally incapable of contacting anyone: there is no target
 * table yet, and no import here touches one.
 *
 * ─── IT IS NEITHER OF THE TWO EXISTING CAMPAIGN TABLES ────────────────────
 * 013 established `campaigns` is the content/social entity (virality playbooks,
 * weekly themes, blog types; 27 live rows) and `gtm_campaigns` is a strategy
 * artifact that "RECOMMENDS and SIMULATES only", targeting through
 * `audience_memberships.entity_id` — the source-scoped legacy identity 010
 * replaced. Nothing here reads, writes or references either, nor `audiences`,
 * `audience_memberships`, `entity_id`, `entity_type`, `leadKeyFor`,
 * `CanonicalLeadView` or `searchLeads`.
 *
 * ─── NO OFFERING, NO LIST, NO ICP — ALL THREE DELIBERATE ──────────────────
 * Offering is commercial context carried by the LIST (010A), where a composite
 * foreign key already forces it to target that list's ICP; a campaign may span
 * several lists whose Offerings differ, so a campaign-level copy could not say
 * which one governed a contact. A campaign is not known to have exactly one
 * list (013) and the platform deliberately supports one prospect across many
 * ICPs (006). The future `campaign_targets` owns those relationships.
 *
 * ─── NO SCORE, NO READINESS ───────────────────────────────────────────────
 * No threshold, no hot/warm/cold, no readiness verdict. The Score → List edge
 * is an open product decision (011) and a campaign exists without any scoring
 * policy at all.
 */

import { ownedDbTable } from '../../db/writeOwner';

export const PROSPECT_CAMPAIGNS_TABLE = 'prospect_campaigns';

/**
 * The smallest vocabulary the evidence supports.
 *
 *   draft    — DEFAULT. Defined, targeting nobody.
 *   active   — the definition is settled. NOT a claim that anything executes.
 *   archived — retired. There is no delete, matching `prospect_lists`.
 *
 * `paused` and `completed` exist on `gtm_campaigns` and are deliberately absent
 * here: both describe an execution lifecycle, and no execution exists to define
 * them. Widening the CHECK later is additive.
 */
export type ProspectCampaignStatus = 'draft' | 'active' | 'archived';
export const PROSPECT_CAMPAIGN_STATUSES: readonly ProspectCampaignStatus[] = [
  'draft', 'active', 'archived',
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME = 300;
const MAX_DESCRIPTION = 2000;

export class ProspectCampaignError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ProspectCampaignError';
  }
}

/** A declaration, not an arrow: only a declaration's `never` narrows control flow. */
function fail(message: string, code: string): never {
  throw new ProspectCampaignError(message, code);
}

function assertTenant(organizationId: string): void {
  if (!UUID.test(String(organizationId ?? '').trim())) {
    fail('organizationId must be a uuid — a campaign is never tenant-less', 'tenant_required');
  }
}

export interface ProspectCampaign {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: ProspectCampaignStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type Row = Record<string, unknown>;

const CAMPAIGN_COLUMNS =
  'id, organization_id, name, description, status, created_at, updated_at';

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
};

const toCampaign = (r: Row): ProspectCampaign => ({
  id: String(r.id),
  organizationId: String(r.organization_id),
  name: String(r.name),
  description: str(r.description),
  status: String(r.status) as ProspectCampaignStatus,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

const rows = (data: unknown): Row[] => (Array.isArray(data) ? (data as Row[]) : []);

/**
 * Translate the SQLSTATEs the schema deliberately raises.
 *
 * `23514` is the interesting one: it carries BOTH the status vocabulary and the
 * immutable-tenant guard, and the message is what distinguishes them. A caller
 * told only "check violation" would not know which rule it broke.
 */
function translate(error: unknown, context: string): never {
  const code = String((error as { code?: string } | null)?.code ?? '');
  const message = String((error as { message?: string } | null)?.message ?? 'unknown error');

  if (code === '23503') {
    fail(`${context}: that organization does not exist`, 'unknown_tenant');
  }
  if (code === '23514') {
    if (message.includes('organization_id is immutable')) {
      fail(`${context}: a campaign's tenant cannot be changed`, 'tenant_immutable');
    }
    if (message.includes('prospect_campaigns_status_valid')) {
      fail(
        `${context}: status must be one of ${PROSPECT_CAMPAIGN_STATUSES.join(', ')}`,
        'invalid_status',
      );
    }
    if (message.includes('prospect_campaigns_name_not_blank')) {
      fail(`${context}: name cannot be blank`, 'invalid_name');
    }
    fail(`${context}: ${message}`, 'invariant_violation');
  }
  fail(`${context} (${code || 'no code'}): ${message}`, code || 'write_failed');
}

export interface CreateCampaignInput {
  organizationId: string;
  name: string;
  description?: string | null;
  /** Optional. Omitted means `draft`, which is the database's own default. */
  status?: ProspectCampaignStatus;
}

/**
 * Create a campaign.
 *
 * INERT BY CONSTRUCTION. This performs exactly one INSERT into one table. It
 * creates no target, no list, no membership, no lead, no person, no task and no
 * outcome; it invokes no enrichment, scoring, recommendation or contact
 * governance; and it sends nothing.
 */
export async function createProspectCampaign(
  input: CreateCampaignInput,
): Promise<ProspectCampaign> {
  assertTenant(input.organizationId);

  const name = String(input.name ?? '').trim();
  if (!name) fail('name is required', 'invalid_name');
  if (name.length > MAX_NAME) fail(`name must be at most ${MAX_NAME} characters`, 'invalid_name');

  const description = input.description == null ? null : String(input.description).trim() || null;
  if (description !== null && description.length > MAX_DESCRIPTION) {
    fail(`description must be at most ${MAX_DESCRIPTION} characters`, 'invalid_description');
  }

  // Stated here as well as in the CHECK: an unknown status is a caller error,
  // and reporting it as a database constraint would be the wrong register.
  if (input.status != null && !PROSPECT_CAMPAIGN_STATUSES.includes(input.status)) {
    fail(`status must be one of ${PROSPECT_CAMPAIGN_STATUSES.join(', ')}`, 'invalid_status');
  }

  const res = await ownedDbTable(PROSPECT_CAMPAIGNS_TABLE)
    .insert({
      organization_id: input.organizationId,
      name,
      description,
      // Omitted rather than defaulted in code, so the database's own DEFAULT
      // stays the single source of what a new campaign is.
      ...(input.status != null ? { status: input.status } : {}),
    })
    .select(CAMPAIGN_COLUMNS)
    .single();

  if (res.error) translate(res.error, 'campaign create failed');
  return toCampaign(res.data as unknown as Row);
}

/**
 * One campaign, or null.
 *
 * Another tenant's campaign is NULL, not an error — the route maps that to 404,
 * so a caller cannot distinguish "does not exist" from "is not yours".
 */
export async function getProspectCampaign(
  organizationId: string,
  campaignId: string,
): Promise<ProspectCampaign | null> {
  assertTenant(organizationId);
  if (!UUID.test(String(campaignId ?? ''))) {
    fail('campaignId must be a uuid', 'invalid_campaign');
  }

  const res = await ownedDbTable(PROSPECT_CAMPAIGNS_TABLE)
    .select(CAMPAIGN_COLUMNS)
    .eq('organization_id', organizationId)   // tenant boundary — never optional, always first
    .eq('id', campaignId)
    .maybeSingle();

  if (res.error) translate(res.error, 'campaign read failed');
  return res.data ? toCampaign(res.data as unknown as Row) : null;
}

/** This tenant's campaigns, optionally narrowed to one status. */
export async function listProspectCampaigns(
  organizationId: string,
  options: { status?: ProspectCampaignStatus } = {},
): Promise<readonly ProspectCampaign[]> {
  assertTenant(organizationId);
  if (options.status != null && !PROSPECT_CAMPAIGN_STATUSES.includes(options.status)) {
    fail(`status must be one of ${PROSPECT_CAMPAIGN_STATUSES.join(', ')}`, 'invalid_status');
  }

  let q = ownedDbTable(PROSPECT_CAMPAIGNS_TABLE)
    .select(CAMPAIGN_COLUMNS)
    .eq('organization_id', organizationId);  // tenant boundary — never optional, always first
  if (options.status != null) q = q.eq('status', options.status);

  const res = await q.order('created_at', { ascending: false });
  if (res.error) translate(res.error, 'campaign listing failed');
  return rows(res.data).map(toCampaign);
}

export interface UpdateCampaignInput {
  organizationId: string;
  campaignId: string;
  name?: string;
  description?: string | null;
  status?: ProspectCampaignStatus;
}

/**
 * Edit a campaign in place.
 *
 * A FIELD NOT NAMED IS NOT TOUCHED. The payload carries only what the caller
 * passed, which is what keeps a status change from silently clearing a
 * description. `organization_id` is never in the payload — the trigger would
 * refuse it, and this never tries.
 *
 * `changed: false` means no row in THIS tenant matched, which the route maps to
 * 404 exactly as it maps another tenant's id.
 */
export async function updateProspectCampaign(
  input: UpdateCampaignInput,
): Promise<{ campaign: ProspectCampaign | null; changed: boolean }> {
  assertTenant(input.organizationId);
  if (!UUID.test(String(input.campaignId ?? ''))) {
    fail('campaignId must be a uuid', 'invalid_campaign');
  }

  const payload: Row = {};
  if (input.name !== undefined) {
    const name = String(input.name ?? '').trim();
    if (!name) fail('name cannot be blank', 'invalid_name');
    if (name.length > MAX_NAME) fail(`name must be at most ${MAX_NAME} characters`, 'invalid_name');
    payload.name = name;
  }
  if (input.description !== undefined) {
    const description = input.description == null ? null : String(input.description).trim() || null;
    if (description !== null && description.length > MAX_DESCRIPTION) {
      fail(`description must be at most ${MAX_DESCRIPTION} characters`, 'invalid_description');
    }
    payload.description = description;
  }
  if (input.status !== undefined) {
    if (!PROSPECT_CAMPAIGN_STATUSES.includes(input.status)) {
      fail(`status must be one of ${PROSPECT_CAMPAIGN_STATUSES.join(', ')}`, 'invalid_status');
    }
    payload.status = input.status;
  }
  if (Object.keys(payload).length === 0) {
    fail('nothing to update', 'empty_patch');
  }

  const res = await ownedDbTable(PROSPECT_CAMPAIGNS_TABLE)
    .update(payload)
    .eq('organization_id', input.organizationId)  // tenant boundary — never optional, always first
    .eq('id', input.campaignId)
    .select(CAMPAIGN_COLUMNS);

  if (res.error) translate(res.error, 'campaign update failed');
  const found = rows(res.data);
  return { campaign: found.length ? toCampaign(found[0]) : null, changed: found.length > 0 };
}

/**
 * A status transition, which is an update of one column.
 *
 * Kept separate from `updateProspectCampaign` so a lifecycle move reads as one
 * at the call site — and so no caller has to construct a partial patch to
 * archive something. There is no delete: archiving preserves the record, which a
 * future outcome attributed to this campaign will need.
 */
export async function setProspectCampaignStatus(
  organizationId: string,
  campaignId: string,
  status: ProspectCampaignStatus,
): Promise<{ campaign: ProspectCampaign | null; changed: boolean }> {
  return updateProspectCampaign({ organizationId, campaignId, status });
}
