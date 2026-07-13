/**
 * Domain validation for email signup/login
 * 
 * Blocks personal email domains (gmail, yahoo, etc.) for public signup flows.
 * Allows all domains for:
 * - super_admin
 * - contentarchi
 * - admin-invited users
 * 
 * This validation runs BEFORE sending Supabase magic link to prevent
 * wasted OTP rate limit quota on invalid email domains.
 */

// Canonical blocklist — single source of truth (AUTH-001 Section 5).
import {
  isPublicEmailDomain,
  PUBLIC_EMAIL_PROVIDER_NAMES,
} from './publicEmailDomains';

/**
 * Validates if an email domain is allowed for public signup/login
 * 
 * @param email - User's email address
 * @returns { valid: true } if domain is allowed
 * @returns { valid: false, reason: string } if domain is blocked
 * 
 * @example
 * validateEmailDomain('user@gmail.com')
 * // { valid: false, reason: "Gmail accounts not supported. Please use your work email." }
 * 
 * @example
 * validateEmailDomain('user@company.com')
 * // { valid: true }
 */
export function validateEmailDomain(
  email: string
): { valid: true } | { valid: false; reason: string } {
  if (!email || !email.trim()) {
    return { valid: false, reason: 'Email is required.' };
  }

  const trimmed = email.trim().toLowerCase();
  
  // Extract domain from email
  const atIndex = trimmed.indexOf('@');
  if (atIndex === -1) {
    return { valid: false, reason: 'Please enter a valid email address.' };
  }

  const domain = trimmed.substring(atIndex + 1);
  
  if (!domain || domain.length === 0) {
    return { valid: false, reason: 'Please enter a valid email address.' };
  }

  // Check if domain is in blocked list
  if (isPublicEmailDomain(domain)) {
    // Provide user-friendly error message — use the provider's real name
    // when we know it ("Gmail"), otherwise show the domain as typed.
    const providerName = PUBLIC_EMAIL_PROVIDER_NAMES[domain] ?? domain;

    return {
      valid: false,
      reason: `${providerName} accounts not supported. Please use your work email address.`,
    };
  }

  // Domain is allowed
  return { valid: true };
}

/**
 * Gets a friendly name of the blocked domain (if applicable)
 * Used to provide contextual error messages
 * 
 * @example
 * getBlockedDomainName('user@gmail.com') // 'Gmail'
 */
export function getBlockedDomainName(email: string): string | null {
  const domain = email.trim().toLowerCase().split('@')[1];
  if (!domain) return null;
  return PUBLIC_EMAIL_PROVIDER_NAMES[domain] || null;
}
