export interface SourceAdapter {
  source: string;
  canHandle(source: string): boolean;
  transform(records: any[], metadata?: any): Promise<any[]>;
  load(transformedRecords: any[], context: any): Promise<void>;
}
