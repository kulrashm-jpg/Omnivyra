/**
 * Unread-error census, WhatsApp TEMPLATES (e9 package 2026-11-12, main-only file). A failed read
 * or write must not be taken as "no versions", "not our template" or "done": each F site either
 * fails with the real cause (the webhook job retries) or, where Meta already holds the template,
 * is logged instead of being mis-marked. Real service on the fake database.
 */
const mockFetch = { calls: 0 };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
}));
jest.mock('../../auth/metaAuthService', () => ({ getValidAccessToken: async () => 'test-token' }));

import { failNext, fakeDb, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import { activateTemplate, getActiveTemplate, handleTemplateStatusWebhook, submitTemplate } from '../../services/whatsappTemplateService';

const ORG = 'co-a';
const tpl = (over: Row): Row => ({
  company_id: ORG, social_account_id: 'sa1', template_name: 'hello', template_category: 'MARKETING',
  language_code: 'en_US', components: [], status: 'APPROVED', is_active: true, version: 1, meta_template_id: 'meta-1', ...over,
});
const seed = (templates: Row[]) => resetFakeDb({
  whatsapp_templates: templates,
  social_accounts: [{ id: 'sa1', company_id: ORG, waba_id: 'waba-1' }],
});
const row = (id: string): Row => fakeDb.tables.whatsapp_templates.find((x) => x.id === id)!;
const input = { company_id: ORG, social_account_id: 'sa1', template_name: 'hello', template_category: 'MARKETING' as const, components: [] };

beforeEach(() => {
  mockFetch.calls = 0;
  (global as any).fetch = async () => { mockFetch.calls += 1; return { ok: true, status: 200, json: async () => ({ id: 'meta-new' }) }; };
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('webhook: a PAUSED / DISABLED template must stop being sendable', () => {
  it.each(['PAUSED', 'DISABLED', 'REJECTED'] as const)('%s whose status write FAILS: the job throws (retries); never silently left sendable', async (event) => {
    seed([tpl({ id: 't1' })]);
    failNext('whatsapp_templates', 'update');
    await expect(handleTemplateStatusWebhook({ message_template_id: 'meta-1', message_template_name: 'hello', event })).rejects.toThrow('not recorded');
  });

  it('the LOOKUP fails: the job throws (retries) - not "not our template, ignore"', async () => {
    seed([tpl({ id: 't1' })]);
    failNext('whatsapp_templates', 'select');
    await expect(handleTemplateStatusWebhook({ message_template_id: 'meta-1', message_template_name: 'hello', event: 'PAUSED' })).rejects.toThrow('Template lookup failed');
    expect(row('t1')).toMatchObject({ is_active: true }); // unchanged: the retry will apply it
  });

  it('NEGATIVE CONTROL: PAUSED recorded -> no longer sendable; an unknown template id is still ignored', async () => {
    seed([tpl({ id: 't1' })]);
    await handleTemplateStatusWebhook({ message_template_id: 'meta-1', message_template_name: 'hello', event: 'PAUSED' });
    expect(row('t1')).toMatchObject({ status: 'PAUSED', is_active: false });
    await expect(getActiveTemplate(ORG, 'hello')).rejects.toThrow('No active approved template');
    await expect(handleTemplateStatusWebhook({ message_template_id: 'not-ours', message_template_name: 'x', event: 'PAUSED' })).resolves.toBeUndefined();
  });
});

describe('activation never leaves zero or two active versions silently', () => {
  it('deprecating the old version FAILS: throws, and the new version is NOT activated beside the old', async () => {
    seed([tpl({ id: 'old', version: 1 }), tpl({ id: 'new', version: 2, status: 'PENDING', is_active: false, meta_template_id: 'meta-2' })]);
    failNext('whatsapp_templates', 'update');
    await expect(activateTemplate('new')).rejects.toThrow('not deprecated');
    expect(row('new')).toMatchObject({ is_active: false });
    expect(row('old')).toMatchObject({ is_active: true });
  });

  it('activating the new version FAILS: throws (the webhook retries) rather than reporting done', async () => {
    seed([tpl({ id: 'old', version: 1 }), tpl({ id: 'new', version: 2, status: 'PENDING', is_active: false, meta_template_id: 'meta-2' })]);
    failNext('whatsapp_templates', 'update', 1);
    await expect(activateTemplate('new')).rejects.toThrow('not activated');
  });
});

describe('submit', () => {
  it('a failed VERSION read is not "first version": refused, nothing inserted, Meta not called', async () => {
    seed([tpl({ id: 't1', version: 3 })]);
    failNext('whatsapp_templates', 'select');
    await expect(submitTemplate(input)).rejects.toThrow('Template versions unreadable');
    expect(fakeDb.tables.whatsapp_templates).toHaveLength(1);
    expect(mockFetch.calls).toBe(0);
  });

  it('a failed ACCOUNT read records the REAL cause on the REJECTED row, not "waba_id not found"', async () => {
    seed([]);
    failNext('social_accounts', 'select');
    await expect(submitTemplate(input)).rejects.toThrow('Social account unreadable');
    expect(fakeDb.tables.whatsapp_templates[0]).toMatchObject({ status: 'REJECTED', rejection_reason: expect.stringContaining('Social account unreadable') });
  });

  it('storing Meta’s id fails ONCE: retried, and the id is stored (no orphan)', async () => {
    seed([]);
    failNext('whatsapp_templates', 'update');
    const id = await submitTemplate(input);
    expect(row(id)).toMatchObject({ status: 'PENDING', meta_template_id: 'meta-new' });
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('ORPHANED'), expect.anything());
  });

  it('storing Meta’s id fails PERSISTENTLY: logged as ORPHANED with both ids, NOT marked rejected', async () => {
    seed([]);
    const { fakeDb: db } = require('../helpers/fakeWhatsappDb');
    db.failures.set('whatsapp_templates:update', { skip: 0, times: 3 });
    const id = await submitTemplate(input);
    expect(row(id)).toMatchObject({ status: 'PENDING' });
    expect(row(id).meta_template_id).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('ORPHANED'),
      expect.objectContaining({ template_id: id, meta_template_id: 'meta-new' }));
  });

  it('NEGATIVE CONTROL: the next version is max+1 and Meta’s id is stored', async () => {
    seed([tpl({ id: 't1', version: 3 })]);
    const id = await submitTemplate(input);
    expect(row(id)).toMatchObject({ version: 4, status: 'PENDING', meta_template_id: 'meta-new' });
  });
});
