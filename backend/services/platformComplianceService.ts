import { saveComplianceReport } from '../db/platformPromotionStore';
import { checkPlatformCompliance, isOmniVyraEnabled } from './omnivyraClientV1';

export async function validatePlatformCompliance(input: {
  contentAssetId: string;
  platform: string;
  contentType: string;
  formattedContent: string;
  rule: any;
  promotionMetadata: any;
}): Promise<any> {
  if (isOmniVyraEnabled()) {
    const response = await checkPlatformCompliance({
      contentAssetId: input.contentAssetId,
      platform: input.platform,
      contentType: input.contentType,
      formattedContent: input.formattedContent,
      rule: input.rule,
      promotionMetadata: input.promotionMetadata,
    });
    if (response.status === 'ok') {
      const data = response.data || {};
      const statusRaw = data.status ?? 'warning';
      const status = statusRaw === 'block' ? 'blocked' : statusRaw;
      const report = await saveComplianceReport({
        content_asset_id: input.contentAssetId,
        platform: input.platform,
        violations: data.violations ?? [],
        warnings: data.warnings ?? [],
        status,
        created_at: new Date().toISOString(),
      });
      console.log('COMPLIANCE REPORT', {
        assetId: input.contentAssetId,
        platform: input.platform,
        status,
        source: 'omnivyra',
      });
      return {
        ...report,
        omnivyra: {
          decision_id: response.decision_id,
          confidence: response.confidence,
          placeholders: response.placeholders,
          explanation: response.explanation,
          contract_version: response.contract_version,
          partial: response.partial,
        },
      };
    }
    console.warn('OMNIVYRA_FALLBACK_COMPLIANCE', { reason: response.error?.message });
  }

  const violations: string[] = [];
  const warnings: string[] = [];

  if (input.rule?.max_length && input.formattedContent.length > input.rule.max_length) {
    violations.push('Exceeds max length');
  }
  if (input.rule?.min_length && input.formattedContent.length < input.rule.min_length) {
    warnings.push('Below min length');
  }
  const required = input.rule?.required_fields || [];
  required.forEach((field: string) => {
    if (!input.promotionMetadata?.[field]) {
      violations.push(`Missing required field: ${field}`);
    }
  });

  const status = violations.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'ok';
  const report = await saveComplianceReport({
    content_asset_id: input.contentAssetId,
    platform: input.platform,
    violations,
    warnings,
    status,
    created_at: new Date().toISOString(),
  });

  console.log('COMPLIANCE REPORT', { assetId: input.contentAssetId, platform: input.platform, status });
  return report;
}
