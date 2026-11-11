/**
 * R2 (owner decision R2-a, 2026-11-10): an ICP INDUSTRY criterion is searched
 * through Apollo's organization keyword tags, labelled APPROXIMATE, and only
 * with an explicit strict-true acknowledgement. Headcount and location stay
 * refused (their documented reasons are unchanged). The provider's filter
 * allowlist is now enforced BEFORE anything is recorded or called.
 */
import { translateRatifiedIcpToDiscoveryFilters } from '../../services/prospectDiscovery/icpTranslation';
import { buildApolloSearchBody } from '../../services/prospectDiscovery/adapters/apolloDiscovery';
import { createDiscoveryExecution } from '../../services/prospectDiscovery/discoveryExecutor';
import type { IcpCriterion, RatifiedIcp } from '../../services/prospectIcp/types';

const ORG = '00000000-0000-4000-8000-00000000000a';

const crit = (over: Partial<IcpCriterion> & { id: string }): IcpCriterion => ({
  kind: 'mandatory', subject: 'person', attribute: 'job_title',
  predicate: { op: 'one_of', values: ['Head of Platform'] }, ...over,
} as IcpCriterion);
const icp = (criteria: IcpCriterion[]): RatifiedIcp => ({
  organizationId: ORG, icpId: 'icp-1', icpKey: 'primary', version: 2, criteria,
  ratifiedAt: '2026-11-01T00:00:00.000Z', ratifiedBy: 'u1',
} as RatifiedIcp);
const industry = crit({ id: 'ind', subject: 'account', attribute: 'industry', predicate: { op: 'one_of', values: ['Computer Software', 'SaaS'] } });

describe('industry is APPROXIMATE and needs its own acknowledgement', () => {
  it.each([[undefined], [false], ['true'], [1]])('refused without a strict-true acknowledgement (%p)', (ack) => {
    const r = translateRatifiedIcpToDiscoveryFilters({
      organizationId: ORG, ratifiedIcp: icp([crit({ id: 't' }), industry]),
      ...(ack === undefined ? {} : { acknowledgeApproximations: ack as boolean }),
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.refusal).toBe('approximations_unacknowledged');
      expect(r.blocking).toHaveLength(1);
      expect(r.blocking[0]).toMatchObject({ criterionId: 'ind', attribute: 'industry' });
      // The tenant-facing reason never repeats a criterion value.
      expect(r.blocking[0].reason).not.toMatch(/SaaS|Computer Software/);
    }
  });

  it('with the acknowledgement: industry becomes industryKeywords and is LISTED as approximate', () => {
    const r = translateRatifiedIcpToDiscoveryFilters({
      organizationId: ORG, ratifiedIcp: icp([crit({ id: 't' }), industry]), acknowledgeApproximations: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok === true) {
      expect(r.filters).toEqual({ titles: ['Head of Platform'], industryKeywords: ['Computer Software', 'SaaS'] });
      expect(r.approximations).toEqual([{ criterionId: 'ind', filterKey: 'industryKeywords', note: expect.any(String) }]);
      expect(r.approximations[0].note).toMatch(/keyword tags/);
    }
  });

  it('an ICP with no approximate criterion needs no acknowledgement and reports none', () => {
    const r = translateRatifiedIcpToDiscoveryFilters({ organizationId: ORG, ratifiedIcp: icp([crit({ id: 't' })]) });
    expect(r.ok).toBe(true);
    if (r.ok === true) expect(r.approximations).toEqual([]);
  });

  it('the omission gate and the approximation gate are independent', () => {
    const soft = crit({ id: 's', kind: 'optional', attribute: 'seniority', predicate: { op: 'one_of', values: ['vp'] } });
    const onlyOmissionsAck = translateRatifiedIcpToDiscoveryFilters({
      organizationId: ORG, ratifiedIcp: icp([industry, soft]), acknowledgeOmissions: true,
    });
    expect(onlyOmissionsAck.ok === false && onlyOmissionsAck.refusal).toBe('approximations_unacknowledged');
    const both = translateRatifiedIcpToDiscoveryFilters({
      organizationId: ORG, ratifiedIcp: icp([industry, soft]), acknowledgeOmissions: true, acknowledgeApproximations: true,
    });
    expect(both.ok).toBe(true);
  });

  it('headcount and location stay REFUSED as mandatory criteria (documented reasons unchanged)', () => {
    for (const attribute of ['employee_count', 'employee_band', 'country_code', 'city', 'region']) {
      const r = translateRatifiedIcpToDiscoveryFilters({
        organizationId: ORG,
        ratifiedIcp: icp([crit({ id: 'x', subject: 'account', attribute, predicate: { op: 'one_of', values: ['v'] } })]),
        acknowledgeOmissions: true, acknowledgeApproximations: true,
      });
      expect(r.ok).toBe(false);
    }
  });

  it('Apollo receives it as q_organization_keyword_tags', () => {
    expect(buildApolloSearchBody({ filters: { industryKeywords: ['SaaS'] }, page: 1, remaining: 10 }))
      .toMatchObject({ q_organization_keyword_tags: ['SaaS'] });
  });
});

describe('the provider allowlist is enforced before anything is recorded or called', () => {
  const ports = (recorded: string[]) => ({
    gate: (async () => { recorded.push('gate'); return { allowed: true }; }) as never,
    hasTranslator: () => true,
    hasProvider: () => true,
    getProvider: () => ({ provider: 'apollo', label: 'Apollo', filterKeys: ['titles', 'industryKeywords'], discover: async () => { throw new Error('no'); } }) as never,
    nextAttemptNumber: (async () => { recorded.push('next'); return 1; }) as never,
    claim: (async () => { recorded.push('claim'); return null; }) as never,
    now: () => '2026-11-10T00:00:00.000Z',
  });

  it('an unknown filter key is a malformed search: refused, nothing recorded, key NAME only', async () => {
    const recorded: string[] = [];
    const r = await createDiscoveryExecution({
      organizationId: ORG, provider: 'apollo', correlationId: 'c',
      filters: { titles: ['CTO'], reveal_personal_emails: true },
      bounds: { maxPages: 1, maxResults: 10, maxProviderCalls: 1 },
    }, ports(recorded) as never);
    expect(r).toMatchObject({ created: false, refusal: 'malformed_search', reason: 'unsupported search filter key(s): reveal_personal_emails' });
    expect(recorded).toEqual([]);
  });

  it('declared keys pass through to the next stage', async () => {
    const recorded: string[] = [];
    await createDiscoveryExecution({
      organizationId: ORG, provider: 'apollo', correlationId: 'c',
      filters: { titles: ['CTO'], industryKeywords: ['SaaS'] },
      bounds: { maxPages: 1, maxResults: 10, maxProviderCalls: 1 },
    }, ports(recorded) as never).catch(() => undefined);
    expect(recorded[0]).toBe('gate');
  });
});
