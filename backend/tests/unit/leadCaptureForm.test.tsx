/**
 * @jest-environment jsdom
 *
 * Phase 8 — lead-capture form + experience: validation, end-to-end submission to the
 * canonical endpoint, attribution attached, configurable confirmation, CTA routing.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const pushMock = jest.fn();
jest.mock('next/router', () => ({ useRouter: () => ({ push: pushMock, query: {} }) }));
const safeFetchJson = jest.fn();
jest.mock('../../../lib/utils/safeFetchJson', () => ({ safeFetchJson: (...a: unknown[]) => safeFetchJson(...a) }));
const trackWebsiteEvent = jest.fn();
jest.mock('../../../lib/websiteAnalytics', () => ({ trackWebsiteEvent: (...a: unknown[]) => trackWebsiteEvent(...a) }));
jest.mock('../../../lib/website/attributionCapture', () => ({ captureAttribution: () => ({ utm_source: 'google', session_id: 's1', current_page: 'https://x/contact-sales' }) }));

import LeadCaptureForm from '../../../components/website/LeadCaptureForm';
import LeadCaptureExperience from '../../../components/website/LeadCaptureExperience';

beforeEach(() => { jest.clearAllMocks(); });

describe('Phase 8 — lead capture form', () => {
  it('blocks submit + shows errors when required fields are empty', async () => {
    render(<LeadCaptureForm intent="contact_sales" />);
    fireEvent.click(screen.getByRole('button', { name: /contact sales/i }));
    expect(await screen.findByText('First name is required')).toBeInTheDocument();
    expect(screen.getByText('Last name is required')).toBeInTheDocument();
    expect(screen.getByText('Work email is required')).toBeInTheDocument();
    expect(screen.getByText('Please accept to continue')).toBeInTheDocument();
    expect(safeFetchJson).not.toHaveBeenCalled();
  });

  it('end-to-end: posts to the canonical endpoint with fields + attribution + honeypot, then shows inline confirmation', async () => {
    safeFetchJson.mockResolvedValue({ ok: true, status: 201, data: { status: 'created', confirmation: { mode: 'inline', message: 'A sales specialist will reach out.' } }, message: 'ok' });
    render(<LeadCaptureForm intent="contact_sales" />);
    fireEvent.change(screen.getByLabelText('First name *'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Last name *'), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText('Work email *'), { target: { value: 'jane@acme.com' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /contact sales/i }));

    await waitFor(() => expect(safeFetchJson).toHaveBeenCalled());
    const [url, init] = safeFetchJson.mock.calls[0];
    expect(url).toBe('/api/website/lead-capture');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ intent: 'contact_sales', firstName: 'Jane', lastName: 'Doe', email: 'jane@acme.com', consent: true, company_website: '', utm_source: 'google', session_id: 's1' });
    expect(await screen.findByText('A sales specialist will reach out.')).toBeInTheDocument();
    expect(trackWebsiteEvent).toHaveBeenCalledWith('lead_created', expect.objectContaining({ intent: 'contact_sales' }));
  });

  it('page-mode confirmation routes to the success page', async () => {
    safeFetchJson.mockResolvedValue({ ok: true, status: 201, data: { status: 'created', confirmation: { mode: 'page', message: 'done', successPath: '/thank-you?intent=request_demo' } }, message: 'ok' });
    render(<LeadCaptureForm intent="request_demo" />);
    fireEvent.change(screen.getByLabelText('First name *'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Last name *'), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText('Work email *'), { target: { value: 'jane@acme.com' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /request my demo/i }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/thank-you?intent=request_demo'));
  });

  it('surfaces server-side field errors', async () => {
    safeFetchJson.mockResolvedValue({ ok: false, status: 400, data: { error: 'VALIDATION', fields: { email: 'Enter a valid email address' } }, message: 'bad' });
    render(<LeadCaptureForm intent="talk_to_expert" />);
    fireEvent.change(screen.getByLabelText('First name *'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Last name *'), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText('Work email *'), { target: { value: 'jane@acme.com' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /talk to an expert/i }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
  });

  it('CTA routing: each entry experience renders its configured heading + form', () => {
    const { rerender } = render(<LeadCaptureExperience intent="request_demo" />);
    expect(screen.getByText('See OmniVyra in action')).toBeInTheDocument();
    rerender(<LeadCaptureExperience intent="book_consultation" />);
    expect(screen.getByText('Book a strategy consultation')).toBeInTheDocument();
  });
});
