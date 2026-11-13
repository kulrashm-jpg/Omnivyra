/**
 * F3: the client's campaign write / approve gating (lib/access/campaignWriteAccess) must
 * agree with the server (55's campaignWriteRole.campaignWriteDecision, ROLE_FORBIDDEN_BODY
 * and rbacService APPROVE_CONTENT) for every role, so the UI never offers an action the
 * server refuses, and never hides one it allows.
 */
import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: jest.fn() }));

import { campaignWriteDecision, ROLE_FORBIDDEN_BODY } from '../../services/campaignWriteRole';
import {
  canWriteCampaign,
  canPostCampaignMessages,
  canApproveCampaign,
  isRoleForbidden,
  ROLE_FORBIDDEN_CODE,
  ROLE_FORBIDDEN_MESSAGE,
} from '../../../lib/access/campaignWriteAccess';

const ROLES = [
  'SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN', 'CONTENT_MANAGER', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER',
  'CONTENT_PLANNER', 'CONTENT_CREATOR', 'CONTENT_ENGAGER', 'VIEWER', 'VIEW_ONLY',
  // spellings / case the server also normalizes
  'admin', 'Company Admin', 'companyadmin', 'contentplanner', 'viewer', 'content_engager',
  // unknown / empty: the server fails closed
  'MARKETING_LEAD', '', null, undefined,
];
// Synthetic client principals the server bypasses (platform super admin / content architect).
const BYPASS = new Set(['CONTENT_ARCHITECT']);

describe('client campaign gating == server campaignWriteDecision', () => {
  it.each([...ROLES, 'CONTENT_ARCHITECT'].map((r) => [String(r)] as const).map((x, i) => [x[0], i]))('%s', (_label, i) => {
    const role = [...ROLES, 'CONTENT_ARCHITECT'][i as number] as string | null | undefined;
    const bypass = BYPASS.has(String(role));
    const server = (exception: 'campaign_messages' | null) =>
      campaignWriteDecision({ method: 'POST', rawRole: role, bypass, engagerException: exception }) === 'allow';
    expect({ role, write: canWriteCampaign(role) }).toEqual({ role, write: server(null) });
    expect({ role, messages: canPostCampaignMessages(role) }).toEqual({ role, messages: server('campaign_messages') });
  });

  it('the refusal text and code are the server ones', () => {
    expect(ROLE_FORBIDDEN_CODE).toBe(ROLE_FORBIDDEN_BODY.code);
    expect(ROLE_FORBIDDEN_MESSAGE).toBe(ROLE_FORBIDDEN_BODY.error);
    expect(isRoleForbidden(403, ROLE_FORBIDDEN_BODY)).toBe(true);
    expect(isRoleForbidden(403, { code: 'OTHER' })).toBe(false);
    expect(isRoleForbidden(401, ROLE_FORBIDDEN_BODY)).toBe(false);
  });

  it('approve matches the server APPROVE_CONTENT role list', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'backend/services/rbacService.ts'), 'utf8');
    const m = src.match(/APPROVE_CONTENT:\s*\[([^\]]+)\]/);
    expect(m).not.toBeNull();
    const allowed = m![1].split(',').map((s) => s.trim().replace(/^Role\./, ''));
    expect(allowed.sort()).toEqual(['COMPANY_ADMIN', 'CONTENT_REVIEWER', 'SUPER_ADMIN']);
    for (const role of ['SUPER_ADMIN', 'COMPANY_ADMIN', 'ADMIN', 'CONTENT_REVIEWER']) expect({ role, ok: canApproveCampaign(role) }).toEqual({ role, ok: true });
    for (const role of ['CONTENT_CREATOR', 'CONTENT_PUBLISHER', 'VIEWER', 'VIEW_ONLY', 'CONTENT_ENGAGER', '', null]) expect({ role, ok: canApproveCampaign(role) }).toEqual({ role, ok: false });
  });
});
