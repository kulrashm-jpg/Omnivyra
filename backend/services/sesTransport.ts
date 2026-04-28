/**
 * Amazon SES SMTP transport — singleton.
 *
 * Reads SMTP credentials from env at first use and caches a single
 * nodemailer transporter for the lifetime of the process. STARTTLS on
 * port 587 (secure: false → upgrade); use port 465 + secure: true if
 * the deployment requires implicit TLS.
 *
 * Required env vars:
 *   SES_SMTP_HOST   e.g. email-smtp.us-east-1.amazonaws.com
 *   SES_SMTP_PORT   587 (default) or 465
 *   SES_SMTP_USER   SES SMTP IAM credential username
 *   SES_SMTP_PASS   SES SMTP IAM credential password
 */

import nodemailer, { type Transporter } from 'nodemailer';

let _transporter: Transporter | null = null;

export function createSesTransport(): Transporter {
  if (_transporter) return _transporter;

  const host = process.env.SES_SMTP_HOST;
  const port = Number(process.env.SES_SMTP_PORT || 587);

  if (!host || !process.env.SES_SMTP_USER || !process.env.SES_SMTP_PASS) {
    throw new Error('SES SMTP not configured');
  }

  _transporter = nodemailer.createTransport({
    host,
    port,
    // STARTTLS upgrade on 587. Force `secure: true` when port is 465.
    secure: port === 465,
    auth: {
      user: process.env.SES_SMTP_USER,
      pass: process.env.SES_SMTP_PASS,
    },
  });

  return _transporter;
}
