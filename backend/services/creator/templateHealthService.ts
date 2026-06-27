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
import { listTemplateAudit, listUserTemplateVersions, getUserTemplate, listUserTemplates } from './userTemplateService';

/** Operational health for one template (system or user). */
export async function getTemplateHealth(id: string): Promise<TemplateHealth> {
  const audit = await listTemplateAudit(id);
  const events: TemplateHealthEvent[] = audit.map((a) => ({ action: a.action, templateId: a.templateId, templateVersion: a.templateVersion, at: a.at }));

  const sys = getTemplateById(id);
  if (sys) {
    return computeTemplateHealth(id, events, { ownership: 'system', latestVersion: sys.version, activeVersion: sys.version, status: 'published' });
  }
  const user = await getUserTemplate(id);
  const versions = await listUserTemplateVersions(id);
  const latestVersion = versions[0]?.version ?? user?.version ?? null;
  const status = (user?.metadata as Record<string, unknown> | undefined)?.status as string | undefined ?? user?.status ?? null;
  return computeTemplateHealth(id, events, { ownership: 'user', latestVersion, activeVersion: latestVersion, status });
}

/** Deterministic operational dashboard for a company's templates (+ any extra ids). */
export async function getTemplateOperationalDashboard(input: { companyId?: string; templateIds?: string[] }): Promise<{ templates: TemplateHealth[]; system: SystemHealth }> {
  let ids = [...(input.templateIds ?? [])];
  if (ids.length === 0 && input.companyId) {
    const userTpls = await listUserTemplates({ companyId: input.companyId });
    ids = userTpls.map((t) => t.id);
  }
  const templates = await Promise.all(Array.from(new Set(ids)).map((id) => getTemplateHealth(id)));
  return { templates, system: computeSystemHealth(templates) };
}
