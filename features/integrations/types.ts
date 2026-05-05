// Shared types for the integrations module.
// Co-located here so extracted components can import without depending
// on the view file (which would create reverse imports).

export type IntegrationType = 'lead_webhook' | 'wordpress' | 'custom_blog_api';
export type IntegrationStatus = 'connected' | 'failed' | 'pending';
export type FocusArea = 'website' | 'data';

export interface Integration {
  id: string;
  type: IntegrationType;
  name: string;
  status: IntegrationStatus;
  config: Record<string, string>;
  last_tested_at: string | null;
  last_error: string | null;
  created_at: string;
}

export type IntegrationAction =
  | { label: string; href: string }
  | { label: string; onClick: () => void; tone?: 'secondary' };

export type GoogleAnalyticsCardStatus =
  | 'not_connected'
  | 'property_selection'
  | 'connected'
  | 'waiting_for_data'
  | 'ready'
  | 'low_data'
  | 'error';

export type GoogleAnalyticsStatusResponse = {
  connected: boolean;
  property: {
    id: string;
    name: string;
    account_id: string | null;
  } | null;
  status: GoogleAnalyticsCardStatus;
  message: string;
  last_sync: string | null;
  events_last_30_days?: number;
  properties?: Array<{
    id: string;
    name: string;
    account_id: string | null;
    active: boolean;
  }>;
  reconnect_required?: boolean;
};

export type TrackingAssistResponse = {
  status: 'ok';
  script: string;
  placement_instructions: string[];
  validation_steps: string[];
};
