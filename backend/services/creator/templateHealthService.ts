/**
 * Template Operational Health Service (CAMPAIGN-007).
 *
 * Aggregates the EXISTING template audit/operational events (one store, one
 * model) + version info into deterministic health via the pure
 * `operationalHealth` module. Read-only; no analytics storage, no new events.
 */

import {
  getTemplateById,
  computeTemplateHealth, computeSystemHealth,
  type TemplateHealth, type TemplateHealthEvent, type SystemHealth,
} from '../../../lib/creator-templates';
import { listTemplateAudit, listUserTemplateVersions, getUserTemplateForCompany, listUserTemplates } from './userTemplateService';

/**
 * THE system-template predicate (05, 2026-11-12: one definition for authorization AND data shape).
 * A PLATFORM template is catalog metadata every tenant may read. NOT "any id the registry
 * resolves": the registry also serves runtime-registered USER templates (hydrate sets
 * ownership 'user'), which are tenant data.
 */
export function isSystemTemplate(id: string): boolean {
  return getTemplateById(id)?.ownership === 'system';
}

/**
 * Operational health for one template, FOR ONE COMPANY (05 NB-1, 2026-11-12: the tenant
 * invariant lives in the service, so any caller - a route, a cron, a report - inherits it).
 * A system template: catalog metadata. A user template: only if it belongs to `companyId`,
 * else null (the caller answers it like an unknown id).
 */
export async function getTemplateHealth(id: string, companyId: string): Promise<TemplateHealth | null> {
  if (isSystemTemplate(id)) {
    const sys = getTemplateById(id)!;
    // e9 RULING (2026-11-12): a SYSTEM template is used by every tenant, and its audit rows carry
    // no company (creator_user_template_audit: template_id / action / version / actor / detail /
    // created_at), so they cannot be scoped to the caller's company. Restrictive default: a
    // tenant never sees platform-wide aggregates - system health is catalog metadata only, with
    // NO audit-derived events. (If the audit rows gain a company column, scope them by it here.)
    return computeTemplateHealth(id, [], { ownership: 'system', latestVersion: sys.version, activeVersion: sys.version, status: 'published' });
  }

  // A USER template: scoped to the company FIRST; its audit trail is then that tenant's own.
  const user = await getUserTemplateForCompany(id, companyId);
  if (!user) return null;
  const audit = await listTemplateAudit(id);
  const events: TemplateHealthEvent[] = audit.map((a) => ({ action: a.action, templateId: a.templateId, templateVersion: a.templateVersion, at: a.at }));
  const versions = await listUserTemplateVersions(id);
  const latestVersion = versions[0]?.version ?? user?.version ?? null;
  const status = (user?.metadata as Record<string, unknown> | undefined)?.status as string | undefined ?? user?.status ?? null;
  return computeTemplateHealth(id, events, { ownership: 'user', latestVersion, activeVersion: latestVersion, status });
}

/**
 * Deterministic operational dashboard for ONE company's templates (+ extra ids). Every id is
 * resolved through getTemplateHealth(id, companyId), so another tenant's id is dropped exactly
 * like an unknown one, inside the service (05 NB-1). No company -> an empty dashboard.
 */
export async function getTemplateOperationalDashboard(input: { companyId: string; templateIds?: string[] }): Promise<{ templates: TemplateHealth[]; system: SystemHealth }> {
  if (!input.companyId) return { templates: [], system: computeSystemHealth([]) };
  let ids = [...(input.templateIds ?? [])];
  if (input.templateIds === undefined) {
    const userTpls = await listUserTemplates({ companyId: input.companyId });
    ids = userTpls.map((t) => t.id);
  }
  const resolved = await Promise.all(Array.from(new Set(ids)).map((id) => getTemplateHealth(id, input.companyId)));
  const templates = resolved.filter((h): h is TemplateHealth => h !== null);
  return { templates, system: computeSystemHealth(templates) };
}
