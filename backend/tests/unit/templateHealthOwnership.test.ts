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
jest.mock('../../services/creator/userTemplateService', () => ({
  listTemplateAudit: async () => [],
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
