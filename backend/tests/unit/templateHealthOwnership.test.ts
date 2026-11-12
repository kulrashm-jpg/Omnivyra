/**
 * templateHealthService.getTemplateHealth took the SYSTEM branch for any id getTemplateById
 * resolved - including a USER template a render had registered at runtime - and reported it as
 * ownership 'system' with no versions. Only a real system template takes that branch now.
 */
jest.mock('../../../lib/creator-templates', () => {
  const actual = jest.requireActual('../../../lib/creator-templates');
  return {
    ...actual,
    getTemplateById: (id: string) => (id === 'tpl-registered' ? { id, ownership: 'user', version: 1 } : actual.getTemplateById(id)),
  };
});
const mockAuditReads: string[] = [];
jest.mock('../../services/creator/userTemplateService', () => ({
  // Rows from EVERY tenant that used the template (the audit table has no company column).
  listTemplateAudit: async (id: string) => { mockAuditReads.push(id); return [
    { action: 'generation_failed', templateId: id, templateVersion: 1, at: '2026-11-01T00:00:00Z' },
    { action: 'generation_succeeded', templateId: id, templateVersion: 1, at: '2026-11-02T00:00:00Z' },
  ]; },
  listUserTemplateVersions: async () => [{ version: 4 }],
  getUserTemplate: async (id: string) => ({ id, version: 4, status: 'published', metadata: {} }),
  listUserTemplates: async () => [],
}));

import { getTemplateHealth } from '../../services/creator/templateHealthService';

it('a registered USER template is reported as a user template with its own versions', async () => {
  const h = await getTemplateHealth('tpl-registered');
  expect(h.ownership).toBe('user');
  expect(h.latestVersion).toBe(4);
});

it('e9 RULING: a SYSTEM template exposes NO cross-tenant audit events (catalog metadata only)', async () => {
  const { ALL_SYSTEM_TEMPLATES } = jest.requireActual('../../../lib/creator-templates');
  const sysId = ALL_SYSTEM_TEMPLATES[0].id as string;
  mockAuditReads.length = 0;
  const h: any = await getTemplateHealth(sysId);
  expect(h.ownership).toBe('system');
  expect(mockAuditReads).toEqual([]); // the shared audit trail is not even read
  expect(JSON.stringify(h)).not.toMatch(/2026-11-0[12]/);
});

it('control: a USER template keeps its own audit-derived events', async () => {
  mockAuditReads.length = 0;
  await getTemplateHealth('tpl-registered');
  expect(mockAuditReads).toEqual(['tpl-registered']);
});
