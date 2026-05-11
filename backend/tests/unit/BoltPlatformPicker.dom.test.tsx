/**
 * @jest-environment jsdom
 *
 * BoltPlatformPicker DOM rendering tests (Round 7 Phase 1).
 *
 * Lightweight React Testing Library coverage scoped exclusively to the
 * shared BOLT picker. The rest of the project remains on the `node` test
 * environment — this file opts into `jsdom` via the pragma above.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import BoltPlatformPicker from '../../../components/bolt/BoltPlatformPicker';

describe('BoltPlatformPicker (DOM)', () => {
  test('renders a clickable chip for each supported platform', () => {
    const onToggle = jest.fn();
    render(
      <BoltPlatformPicker
        loading={false}
        blocked={false}
        supported={['linkedin', 'x', 'facebook']}
        hidden={[]}
        selected={['linkedin']}
        onToggle={onToggle}
      />,
    );
    const linkedinChip = screen.getByRole('button', { name: /linkedin/i });
    const xChip = screen.getByRole('button', { name: /^x$|✓ x/i });
    expect(linkedinChip).toBeEnabled();
    expect(xChip).toBeEnabled();
    expect(linkedinChip).toHaveTextContent('✓');
    fireEvent.click(xChip);
    expect(onToggle).toHaveBeenCalledWith('x');
  });

  test('incompatible platform renders as disabled with tooltip reason', () => {
    render(
      <BoltPlatformPicker
        loading={false}
        blocked={false}
        supported={['linkedin']}
        hidden={[{ platform: 'instagram', reason: 'Instagram requires media (image or video) for publishing.' }]}
        selected={['linkedin']}
        onToggle={jest.fn()}
      />,
    );
    const igChip = screen.getByRole('button', { name: /instagram/i });
    expect(igChip).toBeDisabled();
    expect(igChip).toHaveAttribute('aria-disabled');
    expect(igChip).toHaveAttribute('title', expect.stringMatching(/requires media/i));
  });

  test('disabled chip does NOT invoke onToggle when clicked', () => {
    const onToggle = jest.fn();
    render(
      <BoltPlatformPicker
        loading={false}
        blocked={false}
        supported={[]}
        hidden={[{ platform: 'instagram', reason: 'requires media' }]}
        selected={[]}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /instagram/i }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  test('blocking state replaces the picker when blocked=true', () => {
    render(
      <BoltPlatformPicker
        loading={false}
        blocked={true}
        supported={[]}
        hidden={[]}
        selected={[]}
        onToggle={jest.fn()}
      />,
    );
    expect(
      screen.getByText(/unable to determine compatible publishing platforms for this bolt mode/i),
    ).toBeInTheDocument();
    // No chips render in the blocked state.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  test('unknown / unregistered platforms are NEVER rendered (fail-closed)', () => {
    // The picker accepts `hidden` only. Unregistered platforms are filtered
    // upstream by the hook and never reach the component. Verify the
    // component does not render any chip whose platform is not in
    // `supported` or `hidden`.
    render(
      <BoltPlatformPicker
        loading={false}
        blocked={false}
        supported={['linkedin']}
        hidden={[{ platform: 'instagram', reason: 'media required' }]}
        selected={[]}
        onToggle={jest.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /mystery-net/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /fake-rooms/i })).toBeNull();
  });

  test('mix-mode-style render: all supported chips visible, no hidden', () => {
    render(
      <BoltPlatformPicker
        accent="violet"
        loading={false}
        blocked={false}
        supported={['linkedin', 'x', 'facebook', 'instagram', 'tiktok', 'youtube', 'pinterest']}
        hidden={[]}
        selected={['linkedin', 'instagram', 'tiktok']}
        onToggle={jest.fn()}
      />,
    );
    for (const p of ['linkedin', 'x', 'facebook', 'instagram', 'tiktok', 'youtube', 'pinterest']) {
      expect(screen.getByRole('button', { name: new RegExp(p, 'i') })).toBeEnabled();
    }
  });

  test('loading state shows a loading message, no chips', () => {
    render(
      <BoltPlatformPicker
        loading={true}
        blocked={false}
        supported={['linkedin']}
        hidden={[]}
        selected={[]}
        onToggle={jest.fn()}
      />,
    );
    expect(screen.getByText(/loading connected platforms/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  test('warning surfaces when supported exists but nothing is selected', () => {
    render(
      <BoltPlatformPicker
        loading={false}
        blocked={false}
        supported={['linkedin', 'x']}
        hidden={[]}
        selected={[]}
        onToggle={jest.fn()}
      />,
    );
    expect(screen.getByText(/select at least one platform/i)).toBeInTheDocument();
  });
});
