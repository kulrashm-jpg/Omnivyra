import { logger } from './logger';
import type { SourceAdapter } from './sourceAdapter';

export const csvSourceAdapter: SourceAdapter = {
  source: 'csv',

  canHandle(source: string): boolean {
    const normalized = source.trim().toLowerCase();
    return normalized === 'csv';
  },

  async transform(records: any[], metadata?: any): Promise<any[]> {
    logger.info('csv_source_adapter_transform', {
      recordCount: records.length,
      metadata,
    });

    return records;
  },

  async load(transformedRecords: any[], context: any): Promise<void> {
    logger.info('csv_source_adapter_load', {
      companyId: context?.companyId,
      source: context?.source,
      sourceType: context?.sourceType,
      unifiedSource: context?.unifiedSource,
      ingestionRunId: context?.runId,
      recordCount: transformedRecords.length,
    });

    if (typeof context?.loadRecords === 'function') {
      context.loadResult = await context.loadRecords(transformedRecords, context);
    }
  },
};
