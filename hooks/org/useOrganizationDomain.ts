import { useMemo } from 'react';

export const normalizeOrganizationDomain = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  const withoutProtocol = trimmed.replace(/^https?:\/\//, '');
  return withoutProtocol.split('/')[0]?.replace(/^www\./, '') ?? '';
};

export function useOrganizationDomain(domainInput: string) {
  const domain = useMemo(() => normalizeOrganizationDomain(domainInput), [domainInput]);
  const isValidDomain = useMemo(() => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain), [domain]);

  return {
    domain,
    isValidDomain,
  };
}
