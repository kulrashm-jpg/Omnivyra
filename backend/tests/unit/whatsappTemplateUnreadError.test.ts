/**
 * Unread-error census, WhatsApp TEMPLATES (e9 package 2026-11-12, main-only file). A failed read
 * or write must not be taken as "no versions", "not our template" or "done": each F site either
 * fails with the real cause (the webhook job retries) or, where Meta already holds the template,
 * is logged instead of being mis-marked. Real service on the fake database.
 */
const mockFetch = { calls: 0 };
const mockRpc = { fail: false };
const AT = new Date('2026-01-01T10:00:00Z'); // in the PAST: a mutant stamping "now" must look NEWER

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
  // whatsapp_apply_template_status (migration 20270217000006), as the SQL does it - one
  // transaction: a failure changes NOTHING; an event older than the last applied is 'stale'; on
  // APPROVED the other active versions are deprecated and this one activated. Never kinder.
  ownedDbRpc: async (fn: string, a: Record<string, unknown>) => {
    if (fn !== 'whatsapp_apply_template_status') return { data: null, error: { message: `no function ${fn}` } };
    if (mockRpc.fail) return { data: null, error: { message: 'canceling statement due to statement timeout' } };
    const rows = require('../helpers/fakeWhatsappDb').fakeDb.tables.whatsapp_templates as Array<Record<string, unknown>>;
    const t = rows.find((r) => r.id === a.p_template_id);
    if (!t) return { data: 'not_found', error: null };
    if (t.status_event_at && String(a.p_event_at) < String(t.status_event_at)) return { data: 'stale', error: null };
    const rank = ['APPROVED', 'PAUSED', 'REJECTED', 'DISABLED'];
    if (t.status_event_at && String(a.p_event_at) === String(t.status_event_at)
        && rank.indexOf(String(a.p_event)) + 1 < rank.indexOf(String(t.status)) + 1) return { data: 'stale', error: null };
    if (a.p_event === 'APPROVED') {
      for (const r of rows) if (r.id !== t.id && r.company_id === t.company_id && r.template_name === t.template_name && r.is_active) Object.assign(r, { is_active: false, status: 'DEPRECATED' });
      Object.assign(t, { is_active: true, status: 'APPROVED', status_event_at: a.p_event_at });
    } else {
      Object.assign(t, { status: a.p_event, rejection_reason: a.p_reason ?? null, is_active: false, status_event_at: a.p_event_at });
    }
    return { data: 'applied', error: null };
  },
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
  mockRpc.fail = false;
  (global as any).fetch = async () => { mockFetch.calls += 1; return { ok: true, status: 200, json: async () => ({ id: 'meta-new' }) }; };
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('webhook: a PAUSED / DISABLED template must stop being sendable', () => {
  it.each(['PAUSED', 'DISABLED', 'REJECTED'] as const)('%s whose status apply FAILS: the job throws (retries); never silently left sendable', async (event) => {
    seed([tpl({ id: 't1' })]);
    mockRpc.fail = true;
    await expect(handleTemplateStatusWebhook({ message_template_id: 'meta-1', message_template_name: 'hello', event, event_at: AT })).rejects.toThrow('not applied');
    expect(row('t1')).toMatchObject({ is_active: true }); // unchanged: the retry will apply it
  });

  it('CLASS-2 B9: a LATE older APPROVED after a PAUSED is ignored - the template stays paused', async () => {
    seed([tpl({ id: 't1' })]);
    await handleTemplateStatusWebhook({ message_template_id: 'meta-1', message_template_name: 'hello', event: 'PAUSED', event_at: new Date('2026-11-12T10:10:00Z') });
    await handleTemplateStatusWebhook({ message_template_id: 'meta-1', message_template_name: 'hello', event: 'APPROVED', event_at: new Date('2026-11-12T10:07:00Z') });
    expect(row('t1')).toMatchObject({ status: 'PAUSED', is_active: false });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('older status event arrived late'), expect.objectContaining({ template_id: 't1' }));
  });

  it('05 (a): an event with NO time is REFUSED (never stamped "now"): status untouched, logged by name', async () => {
    seed([tpl({ id: 't1' })]);
    await handleTemplateStatusWebhook({ message_template_id: 'meta-1', message_template_name: 'hello', event: 'PAUSED', event_at: AT });
    // an old APPROVED of unknown time must NOT be applied over the PAUSED as if it were newest
    await expect(handleTemplateStatusWebhook({ message_template_id: 'meta-1', message_template_name: 'hello', event: 'APPROVED' })).resolves.toBeUndefined();
    await handleTemplateStatusWebhook({ message_template_id: 'meta-1', message_template_name: 'hello', event: 'APPROVED', event_at: new Date('invalid') });
    expect(row('t1')).toMatchObject({ status: 'PAUSED', is_active: false });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('TEMPLATE_STATUS_NO_EVENT_TIME'), expect.objectContaining({ template_id: 't1', event: 'APPROVED' }));
  });

  it('05 (b): at an EQUAL event time the more restrictive outcome wins, whichever arrives second', async () => {
    seed([tpl({ id: 't1' }), tpl({ id: 't2', meta_template_id: 'meta-2', template_name: 'other' })]);
    // REJECTED then APPROVED (same second): APPROVED is stale
    await handleTemplateStatusWebhook({ message_template_id: 'meta-1', message_template_name: 'hello', event: 'REJECTED', event_at: AT });
    await handleTemplateStatusWebhook({ message_template_id: 'meta-1', message_template_name: 'hello', event: 'APPROVED', event_at: AT });
    expect(row('t1')).toMatchObject({ status: 'REJECTED', is_active: false });
    // APPROVED then PAUSED (same second): PAUSED applies
    await handleTemplateStatusWebhook({ message_template_id: 'meta-2', message_template_name: 'other', event: 'APPROVED', event_at: AT });
    await handleTemplateStatusWebhook({ message_template_id: 'meta-2', message_template_name: 'other', event: 'PAUSED', event_at: AT });
    expect(row('t2')).toMatchObject({ status: 'PAUSED', is_active: false });
    // a duplicate delivery of the same event re-applies (idempotent)
    await handleTemplateStatusWebhook({ message_template_id: 'meta-2', message_template_name: 'other', event: 'PAUSED', event_at: AT });
    expect(row('t2')).toMatchObject({ status: 'PAUSED', is_active: false });
  });

  it('the LOOKUP fails: the job throws (retries) - not "not our template, ignore"', async () => {
    seed([tpl({ id: 't1' })]);
    failNext('whatsapp_templates', 'select');
    await expect(handleTemplateStatusWebhook({ message_template_id: 'meta-1', message_template_name: 'hello', event: 'PAUSED', event_at: AT })).rejects.toThrow('Template lookup failed');
    expect(row('t1')).toMatchObject({ is_active: true }); // unchanged: the retry will apply it
  });

  it('NEGATIVE CONTROL: PAUSED recorded -> no longer sendable; an unknown template id is still ignored', async () => {
    seed([tpl({ id: 't1' })]);
    await handleTemplateStatusWebhook({ message_template_id: 'meta-1', message_template_name: 'hello', event: 'PAUSED', event_at: AT });
    expect(row('t1')).toMatchObject({ status: 'PAUSED', is_active: false });
    await expect(getActiveTemplate(ORG, 'hello')).rejects.toThrow('No active approved template');
    await expect(handleTemplateStatusWebhook({ message_template_id: 'not-ours', message_template_name: 'x', event: 'PAUSED', event_at: AT })).resolves.toBeUndefined();
  });
});

describe('activation never leaves zero or two active versions silently', () => {
  // CLASS-2 B8: activation is ONE database function (one transaction) - a failure leaves NOTHING half
  // done, which the two separate writes it replaced could not promise.
  it('the activation FAILS: throws (the webhook retries), and nothing changed - the old version stays the active one', async () => {
    seed([tpl({ id: 'old', version: 1 }), tpl({ id: 'new', version: 2, status: 'PENDING', is_active: false, meta_template_id: 'meta-2' })]);
    mockRpc.fail = true;
    await expect(activateTemplate('new', AT)).rejects.toThrow('not applied');
    expect(row('new')).toMatchObject({ is_active: false });
    expect(row('old')).toMatchObject({ is_active: true });
  });

  it('NEGATIVE CONTROL: activation succeeds -> exactly one active version, the new one', async () => {
    seed([tpl({ id: 'old', version: 1 }), tpl({ id: 'new', version: 2, status: 'PENDING', is_active: false, meta_template_id: 'meta-2' })]);
    await activateTemplate('new', AT);
    expect(fakeDb.tables.whatsapp_templates.filter((r) => r.is_active).map((r) => r.id)).toEqual(['new']);
  });
});

describe('submit', () => {
  it('CLASS-2 B7: a concurrent submit of the same version is refused by the unique index BEFORE Meta is called', async () => {
    seed([tpl({ id: 't1', version: 1 })]);
    failNext('whatsapp_templates', 'insert', 0, '23505');
    await expect(submitTemplate(input)).rejects.toThrow('already in progress');
    expect(mockFetch.calls).toBe(0);
  });

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
