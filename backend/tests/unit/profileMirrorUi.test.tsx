/**
 * @jest-environment jsdom
 *
 * UI step 6.4c: one input per merged concept, with Market Pulse disclosure.
 * Owner decision 6 + 55's wording ("The first 8 are sent to the AI; all items are used
 * for relevance scoring"; over-cap = "not sent to the AI", never "ignored"); 05: the
 * shape filter is disclosed by the same badge list.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { MirrorStatusList } from '../../../components/company/profileWizard/MirrorStatusList';

describe('MirrorStatusList', () => {
  it("shows 55's wording and a badge per item", () => {
    render(<MirrorStatusList items={['CRM setup', 'Audits']} existingMarketPulse={[]} />);
    expect(screen.getByText('The first 8 are sent to the AI; all items are used for relevance scoring.')).toBeInTheDocument();
    expect(screen.getAllByText('Sent to the AI')).toHaveLength(2);
    expect(screen.queryByText(/ignored/i)).not.toBeInTheDocument();
  });

  it('over the cap: extra items say "not sent to the AI", and are still used for scoring', () => {
    const existing = Array.from({ length: 8 }, (_, i) => `MP ${i + 1}`);
    render(<MirrorStatusList items={['User item']} existingMarketPulse={existing} />);
    expect(screen.getByText(/the extra ones are not sent to the AI/)).toBeInTheDocument();
    expect(screen.getByText('Used for scoring (not sent to the AI)')).toBeInTheDocument();
  });

  it('shape-filtered items are disclosed with the reason and how to fix it', () => {
    render(<MirrorStatusList items={['x'.repeat(90), 'We grow clinics. We hire fast. We win.']} existingMarketPulse={[]} />);
    expect(screen.getByText('Too long for Market Pulse: shorten it to include it')).toBeInTheDocument();
    expect(screen.getByText(/Looks like a paragraph/)).toBeInTheDocument();
  });

  it('renders nothing for an empty list', () => {
    const { container } = render(<MirrorStatusList items={[]} existingMarketPulse={['A']} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('one input per merged concept (wiring)', () => {
  const read = (p: string) => require('fs').readFileSync(require('path').join(process.cwd(), p), 'utf8') as string;
  const B = read('components/CompanyProfileFormSectionsB.tsx');
  const C = read('components/CompanyProfileFormSectionsC.tsx');

  it('"What you offer" edits update the text AND the list (D1 fixed here) and show mirror status', () => {
    expect(B).toMatch(/updateActiveProfile\(\{ \.\.\.activeProfile, products_services: e\.target\.value, products_services_list: splitOfferings\(e\.target\.value\) \}\)/);
    expect(B).toMatch(/<MirrorStatusList items=\{splitOfferings\(offeringsText\)\} existingMarketPulse=\{marketPulseSettings\.core_offerings\} \/>/);
    expect(B).toMatch(/unionOfferings\(activeProfile\.products_services_list, marketPulseSettings\.core_offerings, activeProfile\.products_services\)/);
  });

  it('the Market Pulse copies are read-only mirrors (no second editable input)', () => {
    expect(C).not.toMatch(/handleMarketPulseSettingArrayChange\('core_offerings'/);
    expect(C).not.toMatch(/handleMarketPulseSettingArrayChange\('growth_priorities'/);
    expect(C).toMatch(/Mirrored from "What you offer"\. Edit it on the Offering step\./);
    expect(C).toMatch(/Mirrored from Growth priorities\. Edit it on the Goals step\./);
  });

  it('Growth priorities has exactly one editable input', () => {
    expect((C.match(/handleChange\('growth_priorities'/g) ?? []).length).toBe(1);
  });
});
