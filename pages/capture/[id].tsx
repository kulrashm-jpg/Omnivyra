/**
 * Public hosted lead capture landing page.
 * URL: /capture/[formId]
 * No auth required. Brand styling applied from form config.
 * Can be linked to from any external site or used as an iframe.
 */
import React, { useState, useRef } from 'react';
import Head from 'next/head';
import type { GetServerSideProps } from 'next';
import { getForm, CaptureForm } from '../../backend/services/leadService';

interface Props {
  form: CaptureForm;
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ params }) => {
  const id = typeof params?.id === 'string' ? params.id : null;
  if (!id) return { notFound: true };
  const form = await getForm(id);
  if (!form) return { notFound: true };
  return { props: { form } };
};

export default function CapturePage({ form }: Props) {
  const b = form.brand || {};
  const color = b.primary_color || '#6366f1';
  const focusColor = color + '33';
  const heading = b.heading || form.name;
  const desc = b.description || '';
  const submitLabel = b.submit_label || 'Submit';
  const successMsg = b.success_message || "Thank you! We'll be in touch soon.";
  const fontMap: Record<string, string> = {
    serif: 'Georgia, "Times New Roman", serif',
    sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    system: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  };
  const fontStack = fontMap[b.font || 'system'];

  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  function setValue(name: string, value: string) {
    setValues(prev => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const body: Record<string, string> = {
        form_id: form.id,
        company_id: form.company_id,
        source: 'form_embed',
        ...values,
      };
      const r = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (r.ok && data.lead) {
        setSubmitted(true);
      } else {
        setError(data.error || 'Submission failed. Please try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Head>
        <title>{heading}</title>
        {desc && <meta name="description" content={desc} />}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta property="og:title" content={heading} />
        {desc && <meta property="og:description" content={desc} />}
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            min-height: 100vh;
            background: linear-gradient(135deg, #f0f4ff 0%, #faf5ff 50%, #f0fdf4 100%);
            font-family: ${fontStack};
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            padding: 40px 16px;
          }
          .card {
            background: #fff; border-radius: 20px;
            box-shadow: 0 8px 40px rgba(0,0,0,.10), 0 1px 3px rgba(0,0,0,.06);
            padding: 48px 40px; width: 100%; max-width: 480px;
          }
          .badge {
            display: inline-flex; align-items: center; gap: 6px;
            background: ${color}15; color: ${color};
            padding: 4px 12px; border-radius: 100px;
            font-size: 12px; font-weight: 600; letter-spacing: .3px;
            margin-bottom: 20px;
          }
          h1 { font-size: 26px; font-weight: 800; color: #111827; line-height: 1.25; margin-bottom: 10px; }
          .desc { font-size: 15px; color: #6b7280; line-height: 1.65; margin-bottom: 32px; }
          .field { margin-bottom: 18px; }
          label { display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px; }
          .req { color: #ef4444; margin-left: 2px; }
          input {
            width: 100%; padding: 11px 14px;
            border: 1.5px solid #e5e7eb; border-radius: 10px;
            font-size: 15px; font-family: inherit; color: #111827;
            transition: border-color .15s, box-shadow .15s; outline: none;
            background: #fafafa;
          }
          input:focus { border-color: ${color}; box-shadow: 0 0 0 3px ${focusColor}; background: #fff; }
          input::placeholder { color: #9ca3af; }
          .submit-btn {
            width: 100%; padding: 13px; background: ${color}; color: #fff;
            border: none; border-radius: 10px; font-size: 15px; font-weight: 700;
            font-family: inherit; cursor: pointer; transition: opacity .15s, transform .1s;
            margin-top: 8px; letter-spacing: .2px;
          }
          .submit-btn:hover:not(:disabled) { opacity: .9; transform: translateY(-1px); }
          .submit-btn:active:not(:disabled) { transform: translateY(0); }
          .submit-btn:disabled { opacity: .6; cursor: not-allowed; }
          .error-msg {
            margin-top: 14px; padding: 12px 14px; border-radius: 8px;
            background: #fef2f2; color: #991b1b; font-size: 13px; border: 1px solid #fecaca;
          }
          .success-wrap {
            text-align: center; padding: 20px 0;
          }
          .success-icon {
            width: 64px; height: 64px; border-radius: 50%;
            background: ${color}15; display: inline-flex; align-items: center;
            justify-content: center; margin-bottom: 20px;
          }
          .success-icon svg { color: ${color}; }
          .success-title { font-size: 22px; font-weight: 800; color: #111827; margin-bottom: 10px; }
          .success-desc { font-size: 15px; color: #6b7280; line-height: 1.65; }
          .powered {
            margin-top: 28px; text-align: center;
            font-size: 12px; color: #9ca3af;
          }
          .powered a { color: #9ca3af; text-decoration: none; font-weight: 500; }
          .powered a:hover { color: #6b7280; }
          @media (max-width: 520px) {
            .card { padding: 32px 24px; }
            h1 { font-size: 22px; }
          }
        `}</style>
      </Head>
      <div className="card">
        {submitted ? (
          <div className="success-wrap">
            <div className="success-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="success-title">You're in!</div>
            <p className="success-desc">{successMsg}</p>
          </div>
        ) : (
          <>
            <div className="badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="10" />
              </svg>
              Get in touch
            </div>
            <h1>{heading}</h1>
            {desc && <p className="desc">{desc}</p>}
            <form ref={formRef} onSubmit={handleSubmit} noValidate>
              {form.fields.map(field => (
                <div key={field.name} className="field">
                  <label htmlFor={`f_${field.name}`}>
                    {field.label}{field.required && <span className="req">*</span>}
                  </label>
                  <input
                    id={`f_${field.name}`}
                    type={field.type === 'phone' ? 'tel' : field.type}
                    name={field.name}
                    value={values[field.name] || ''}
                    onChange={e => setValue(field.name, e.target.value)}
                    placeholder={field.label}
                    required={field.required}
                    autoComplete={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'name'}
                  />
                </div>
              ))}
              <button type="submit" className="submit-btn" disabled={submitting}>
                {submitting ? 'Sending…' : submitLabel}
              </button>
              {error && <div className="error-msg">{error}</div>}
            </form>
          </>
        )}
        <div className="powered">
          Powered by <a href="/" target="_blank" rel="noopener noreferrer">Omnivyra</a>
        </div>
      </div>
    </>
  );
}
