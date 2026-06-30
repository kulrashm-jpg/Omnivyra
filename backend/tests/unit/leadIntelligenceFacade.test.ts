// Verify the facade REUSES the existing identity resolver (no duplication) + emits to the caller sink.
jest.mock('../../services/identityResolutionService', () => ({
  resolveUnifiedPerson: jest.fn(async () => ({ unifiedPersonId: 'up_real', matchedBy: 'email', created: false })),
}));
import { resolveUnifiedPerson } from '../../services/identityResolutionService';
import { createLeadIntelligenceIngestor } from '../../services/leadIntelligence/leadIntelligenceFacade';
import { createInMemorySink } from '../../services/leadIntelligence/leadIntelligencePorts';

describe('Lead Intelligence facade (identity reuse)', () => {
  it('wires the real unified-person resolver and emits to the caller sink', async () => {
    const { sink, emitted } = createInMemorySink();
    const ingestor = createLeadIntelligenceIngestor({ sink, now: () => 't' });
    const lead = await ingestor.ingestFromSource('website', { company_id: 'co1', email: 'a@b.com', source: 'form_embed' });
    expect((resolveUnifiedPerson as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'co1', email: 'a@b.com' }));
    expect(lead.unifiedPersonId).toBe('up_real');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].source).toBe('website');
  });

  it('does not call the resolver when there are no identity hints', async () => {
    (resolveUnifiedPerson as jest.Mock).mockClear();
    const { sink, emitted } = createInMemorySink();
    const ingestor = createLeadIntelligenceIngestor({ sink, now: () => 't' });
    await ingestor.ingestFromSource('marketpulse', { company_id: 'co1', signal_category: 'hiring', title: 't' });
    expect((resolveUnifiedPerson as jest.Mock)).not.toHaveBeenCalled();
    expect(emitted[0].unifiedPersonId).toBeNull();
  });
});
