/**
 * What a REVIEWER sees of a held candidate: a projection (never contact data)
 * with a homograph-safe profile link and a stated basis for the hold.
 */
import { candidateView, displayProfileLink } from '../../services/prospectImportReview/display';

describe('candidateView', () => {
  it('shows name, title, company, location and the basis; never email or phone', () => {
    const v = candidateView({
      name: 'Jane Doe', title: 'VP Marketing', city: 'London', country: 'United Kingdom',
      organization: { name: 'Acme' }, email: 'jane@acme.com', phone_numbers: [{ raw_number: '+44 1' }],
      linkedin_url: 'http://www.linkedin.com/in/jane-doe',
    }, 'name_match');
    expect(v).toEqual({
      name: 'Jane Doe', title: 'VP Marketing', company: 'Acme', location: 'London, United Kingdom',
      profile: { shown: 'https://www.linkedin.com/in/jane-doe', mixedScript: false, form: 'vanity' },
      matchedOn: expect.stringContaining('Same first and last name'),
    });
    expect(JSON.stringify(v)).not.toMatch(/jane@acme|\+44/);
  });

  it('every hold reason states its basis', () => {
    expect(candidateView(null, 'role_contact').matchedOn).toContain('shared mailbox');
    expect(candidateView(null, 'shared_phone').matchedOn).toContain('switchboard');
  });
});

describe('displayProfileLink: homograph-safe', () => {
  it('a non-ASCII slug is shown ASCII-escaped, so no lookalike character reaches the screen', () => {
    const d = displayProfileLink('https://www.linkedin.com/in/јane')!; // Cyrillic je + Latin "ane"
    expect(d.shown).toMatch(/^[\x20-\x7e]+$/);
    expect(d.shown).not.toBe('https://www.linkedin.com/in/jane');
    expect(d.mixedScript).toBe(true);
  });

  it('a single-script non-Latin slug is escaped but not flagged as mixed', () => {
    const d = displayProfileLink('https://www.linkedin.com/in/张伟')!;
    expect(d.shown).toMatch(/^[\x20-\x7e]+$/);
    expect(d.mixedScript).toBe(false);
  });

  it('a refused URL shows no link at all', () => {
    expect(displayProfileLink('https://www.linkedin.com/sales/lead/ACwAAA1,NAME_SEARCH,tok')).toBeNull();
    expect(displayProfileLink('https://evil.com/in/jane')).toBeNull();
  });
});
