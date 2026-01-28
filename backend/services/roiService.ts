export function calculateROI(input: {
  campaignId: string;
  costInputs: {
    adSpend?: number;
    productionCost?: number;
    manpowerCost?: number;
  };
  performanceMetrics?: {
    totalValue?: number;
    platformValues?: Record<string, number>;
  };
}): {
  totalCost: number;
  totalValue: number;
  roiPercent: number;
  bestPlatform: string | null;
  worstPlatform: string | null;
  recommendations: string[];
} {
  const totalCost =
    (input.costInputs.adSpend ?? 0) +
    (input.costInputs.productionCost ?? 0) +
    (input.costInputs.manpowerCost ?? 0);
  const totalValue = input.performanceMetrics?.totalValue ?? 0;
  const roiPercent = totalCost > 0 ? Number((((totalValue - totalCost) / totalCost) * 100).toFixed(2)) : 0;

  const platformValues = input.performanceMetrics?.platformValues ?? {};
  const sortedPlatforms = Object.entries(platformValues).sort((a, b) => b[1] - a[1]);
  const bestPlatform = sortedPlatforms[0]?.[0] ?? null;
  const worstPlatform = sortedPlatforms[sortedPlatforms.length - 1]?.[0] ?? null;

  const recommendations: string[] = [];
  if (roiPercent < 0) {
    recommendations.push('Reduce spend or reallocate budget to better-performing platforms.');
  } else if (roiPercent > 50) {
    recommendations.push('Scale spend on top-performing platforms.');
  }
  if (!totalValue) {
    recommendations.push('Track conversions or revenue to calculate ROI accurately.');
  }

  return {
    totalCost,
    totalValue,
    roiPercent,
    bestPlatform,
    worstPlatform,
    recommendations,
  };
}
