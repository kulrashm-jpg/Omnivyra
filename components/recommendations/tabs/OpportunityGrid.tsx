import React from 'react';
import OpportunityCard, { type OpportunityItemForCard } from '../../OpportunityCard';

type OpportunityGridProps = {
  opportunities: OpportunityItemForCard[];
  companyId: string;
  onPromote: (opportunityId: string) => Promise<void>;
  onSchedule: (opportunityId: string, scheduledFor: string) => Promise<void>;
  onArchive: (opportunityId: string) => Promise<void>;
  onDismiss: (opportunityId: string) => Promise<void>;
  onMarkReviewed: (opportunityId: string) => Promise<void>;
  onActionComplete?: () => void;
};

export function OpportunityGrid({
  opportunities,
  companyId,
  onPromote,
  onSchedule,
  onArchive,
  onDismiss,
  onMarkReviewed,
  onActionComplete,
}: OpportunityGridProps) {
  if (opportunities.length === 0) {
    return <div className="text-sm text-gray-500 py-4">No active opportunities in this tab.</div>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {opportunities.map((opp) => (
        <OpportunityCard
          key={opp.id}
          opportunity={opp}
          companyId={companyId}
          onPromote={onPromote}
          onSchedule={onSchedule}
          onArchive={onArchive}
          onDismiss={onDismiss}
          onMarkReviewed={onMarkReviewed}
          onActionComplete={onActionComplete}
        />
      ))}
    </div>
  );
}
