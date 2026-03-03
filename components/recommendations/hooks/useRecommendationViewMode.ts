import { useCompanyContext } from '../../CompanyContext';

export type RecommendationCardViewMode = 'FULL' | 'MINIMAL';

export function isFullRecommendationView(role: string | null): boolean {
  if (!role) return false;
  const normalized = role.toUpperCase();
  return (
    normalized === 'CONTENT_ARCHITECT' ||
    normalized === 'SUPER_ADMIN'
  );
}

export function useRecommendationViewMode(): RecommendationCardViewMode {
  const { userRole } = useCompanyContext();

  return isFullRecommendationView(userRole)
    ? 'FULL'
    : 'MINIMAL';
}
