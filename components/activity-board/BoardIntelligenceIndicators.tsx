/**
 * Board Intelligence Indicators — one-line, icon-first row.
 * Renders in priority order: OVERDUE > BLOCKED > APPROVAL > COLLABORATION > OWNERSHIP.
 */

import React from 'react';
import {
  Clock,
  AlertCircle,
  CheckCircle,
  FileEdit,
  XCircle,
  MessageSquare,
  User,
  UserX,
} from 'lucide-react';
import type { BoardIndicatorItem, ApprovalDisplayState } from './board-indicators';

const ICON_CLASS = 'w-3.5 h-3.5 shrink-0';

function ApprovalIcon({ state }: { state?: ApprovalDisplayState }) {
  switch (state) {
    case 'approved':
      return <CheckCircle className={ICON_CLASS} />;
    case 'rejected':
      return <XCircle className={ICON_CLASS} />;
    case 'changes_requested':
      return <AlertCircle className={ICON_CLASS} />;
    case 'submitted':
    case 'draft':
    default:
      return <FileEdit className={ICON_CLASS} />;
  }
}

function IndicatorIcon({ item }: { item: BoardIndicatorItem }) {
  switch (item.kind) {
    case 'time_risk':
      return <Clock className={ICON_CLASS} />;
    case 'attention':
      return <AlertCircle className={ICON_CLASS} />;
    case 'approval':
      return <ApprovalIcon state={item.approvalState} />;
    case 'collaboration':
      return <MessageSquare className={ICON_CLASS} />;
    case 'ownership':
      return item.label.startsWith('Unassigned') ? (
        <UserX className={ICON_CLASS} />
      ) : (
        <User className={ICON_CLASS} />
      );
    case 'flow_blocker':
      return <AlertCircle className={ICON_CLASS} />;
    default:
      return null;
  }
}

export interface BoardIntelligenceIndicatorsProps {
  items: BoardIndicatorItem[];
  className?: string;
}

export default function BoardIntelligenceIndicators({
  items,
  className = '',
}: BoardIntelligenceIndicatorsProps) {
  return (
    <div
      className={`flex items-center gap-1.5 flex-wrap ${className}`}
      role="list"
      aria-label="Activity indicators"
    >
      {items.map((item) => (
        <span
          key={item.id}
          role="listitem"
          className={`inline-flex items-center gap-0.5 ${item.colorClass}`}
          title={item.label}
        >
          <IndicatorIcon item={item} />
          {item.count != null && item.count > 0 && (
            <span className="text-[10px] font-medium tabular-nums leading-none">
              {item.count}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
