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

// Blocked personal email domains
const BLOCKED_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'icloud.com',
  'protonmail.com',
  'mail.com',
  'yandex.com',
  '163.com',
  'qq.com',
  'foxmail.com',
  '1and1.com',
  'btinternet.com',
  'gmx.com',
  'mail.ru',
  'tutanota.com',
  'protonmail.ch',
  'mailbox.org',
]);

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
  if (BLOCKED_DOMAINS.has(domain)) {
    // Provide user-friendly error message
    const capitalizedDomain = domain
      .split('.')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('.');
    
    return {
      valid: false,
      reason: `${capitalizedDomain} accounts not supported. Please use your work email address.`,
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

  const domainMap: Record<string, string> = {
    'gmail.com': 'Gmail',
    'yahoo.com': 'Yahoo',
    'hotmail.com': 'Hotmail',
    'outlook.com': 'Outlook',
    'aol.com': 'AOL',
    'icloud.com': 'iCloud',
    'protonmail.com': 'ProtonMail',
    'yandex.com': 'Yandex',
  };

  return domainMap[domain] || null;
}
