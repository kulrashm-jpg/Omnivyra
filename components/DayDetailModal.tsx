import React from 'react';
import { X, Target } from 'lucide-react';
import { getIntentLabelForContentType } from '../utils/formatLineForContentType';

export interface DayPlanItem {
  id: string;
  platform: string;
  contentType: string;
  title?: string;
  content?: string;
  description?: string;
  topic?: string;
  introObjective?: string;
  summary?: string;
  objective?: string;
  keyPoints?: string[];
  cta?: string;
  brandVoice?: string;
  themeLinkage?: string;
  formatNotes?: string;
  hashtags?: string[];
  scheduledTime?: string;
  status?: string;
  dailyObject?: Record<string, unknown>;
}

interface DayDetailModalProps {
  day: string;
  weekNumber: number;
  items: DayPlanItem[];
  onClose: () => void;
  /** Theme context for alignment — week and campaign */
  weekTheme?: string;
  weekFocus?: string;
  campaignTheme?: string;
  /** Target geo for local-time scheduling (e.g. "US", "UK, DE") */
  targetGeo?: string;
}

export default function DayDetailModal({ day, weekNumber, items, onClose, weekTheme, weekFocus, campaignTheme, targetGeo }: DayDetailModalProps) {
  const asObject = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;

  const toStringArray = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.map((v) => String(v ?? '').trim()).filter(Boolean)
      : [];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="p-4 border-b flex items-center justify-between shrink-0">
          <h3 className="text-lg font-semibold text-gray-900">
            {day} — Week {weekNumber}
          </h3>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Theme alignment — campaign → week → day */}
        {(campaignTheme || weekTheme || weekFocus) && (
          <div className="mx-4 mt-2 p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-sm">
            <div className="flex items-center gap-2 font-medium text-indigo-900 mb-2">
              <Target className="h-4 w-4" />
              Theme alignment
            </div>
            <div className="space-y-1 text-indigo-800">
              {campaignTheme && (
                <p><span className="font-medium">Campaign:</span> {campaignTheme}</p>
              )}
              {weekTheme && (
                <p><span className="font-medium">Week theme:</span> {weekTheme}</p>
              )}
              {weekFocus && (
                <p><span className="font-medium">Focus:</span> {weekFocus}</p>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {items.length === 0 ? (
            <p className="text-sm text-gray-500">No content planned for this day.</p>
          ) : (
            items.map((item) => (
              (() => {
                const daily = asObject(item.dailyObject);
                const contentGuidance = asObject(daily?.contentGuidance);
                const masterContent = asObject(daily?.master_content);
                const platformVariants = Array.isArray(daily?.platform_variants) ? daily?.platform_variants : [];
                const platformTargets = toStringArray(daily?.platformTargets);
                const effectivePlatforms = platformTargets.length > 0 ? platformTargets : [item.platform];
                const effectiveContentType = String(daily?.contentType ?? item.contentType ?? '').trim();
                const topicTitle = String(daily?.topicTitle ?? item.topic ?? item.title ?? '').trim();
                const objective = String(daily?.dailyObjective ?? item.objective ?? '').trim();
                const writingIntent = String(daily?.writingIntent ?? item.summary ?? item.description ?? '').trim();
                const learningGoal = String(daily?.whatShouldReaderLearn ?? item.introObjective ?? '').trim();
                const painPoint = String(daily?.whatProblemAreWeAddressing ?? '').trim();
                const desiredAction = String(daily?.desiredAction ?? item.cta ?? '').trim();
                const narrativeStyle = String(daily?.narrativeStyle ?? item.brandVoice ?? '').trim();
                const executionId = String(daily?.execution_id ?? '').trim();
                const sourceType = String(daily?.source_type ?? '').trim();
                const retentionState = String(daily?.retention_state ?? '').trim();
                const mediaStatus = String(daily?.media_status ?? '').trim();
                const primaryFormat = String(contentGuidance?.primaryFormat ?? '').trim();
                const maxWordTarget = Number(contentGuidance?.maxWordTarget);

                return (
                  <div
                    key={item.id}
                    className="border border-gray-200 rounded-lg p-4 bg-gray-50/50 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex flex-wrap gap-2 mb-3">
                      {effectivePlatforms.map((platform) => (
                        <span
                          key={`${item.id}-${platform}`}
                          className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded text-xs font-medium capitalize"
                        >
                          {platform}
                        </span>
                      ))}
                      <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-medium">
                        {effectiveContentType || item.contentType}
                      </span>
                      {item.status && (
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            item.status === 'completed'
                              ? 'bg-green-100 text-green-800'
                              : item.status === 'scheduled'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-gray-200 text-gray-700'
                          }`}
                        >
                          {item.status}
                        </span>
                      )}
                      {sourceType && (
                        <span className="px-2 py-1 rounded text-xs font-medium bg-amber-100 text-amber-800 capitalize">
                          {sourceType}
                        </span>
                      )}
                      {retentionState && (
                        <span className="px-2 py-1 rounded text-xs font-medium bg-teal-100 text-teal-800 capitalize">
                          retention: {retentionState}
                        </span>
                      )}
                      {mediaStatus && (
                        <span className="px-2 py-1 rounded text-xs font-medium bg-rose-100 text-rose-800 capitalize">
                          media: {mediaStatus}
                        </span>
                      )}
                    </div>

                    <div className="space-y-3 text-sm">
                      {topicTitle && (
                        <div>
                          <span className="font-medium text-gray-600">Topic:</span>
                          <p className="mt-0.5 text-gray-900 font-medium">{topicTitle}</p>
                        </div>
                      )}

                      {objective && (
                        <div>
                          <span className="font-medium text-gray-600">Daily objective:</span>
                          <p className="mt-0.5 text-gray-900">{objective}</p>
                        </div>
                      )}

                      {writingIntent && (
                        <div>
                          <span className="font-medium text-gray-600">{getIntentLabelForContentType(effectiveContentType)}:</span>
                          <p className="mt-0.5 text-gray-900">{writingIntent}</p>
                        </div>
                      )}

                      {learningGoal && (
                        <div>
                          <span className="font-medium text-gray-600">What reader should learn:</span>
                          <p className="mt-0.5 text-gray-900">{learningGoal}</p>
                        </div>
                      )}

                      {painPoint && (
                        <div>
                          <span className="font-medium text-gray-600">Problem addressed:</span>
                          <p className="mt-0.5 text-gray-900">{painPoint}</p>
                        </div>
                      )}

                      {desiredAction && (
                        <div>
                          <span className="font-medium text-gray-600">Desired action:</span>
                          <p className="mt-0.5 text-gray-900">{desiredAction}</p>
                        </div>
                      )}

                      {narrativeStyle && (
                        <div>
                          <span className="font-medium text-gray-600">Narrative style:</span>
                          <span className="ml-1 text-gray-900">{narrativeStyle}</span>
                        </div>
                      )}

                      {(item.keyPoints?.length ?? 0) > 0 && (
                        <div>
                          <span className="font-medium text-gray-600">Key points:</span>
                          <ul className="mt-0.5 list-disc list-inside text-gray-900 space-y-0.5">
                            {item.keyPoints!.map((pt, i) => (
                              <li key={i}>{pt}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {(primaryFormat || Number.isFinite(maxWordTarget)) && (
                        <div>
                          <span className="font-medium text-gray-600">Content guidance:</span>
                          <p className="mt-0.5 text-gray-900">
                            {primaryFormat || 'Format defined'}
                            {Number.isFinite(maxWordTarget) ? ` • max ${maxWordTarget} words` : ''}
                          </p>
                        </div>
                      )}

                      {(masterContent || platformVariants.length > 0 || executionId) && (
                        <div className="rounded-md border border-gray-200 bg-white p-2">
                          <div className="text-xs font-semibold text-gray-700 mb-1">Execution metadata</div>
                          {executionId && <p className="text-xs text-gray-700">Execution ID: {executionId}</p>}
                          {masterContent && (
                            <p className="text-xs text-gray-700">
                              Master content: {String(masterContent.generation_status ?? 'unknown')}
                            </p>
                          )}
                          {platformVariants.length > 0 && (
                            <p className="text-xs text-gray-700">Platform variants: {platformVariants.length}</p>
                          )}
                        </div>
                      )}

                      {item.themeLinkage && (
                        <div>
                          <span className="font-medium text-gray-600">Alignment:</span>
                          <p className="mt-0.5 text-gray-600 text-xs">{item.themeLinkage}</p>
                        </div>
                      )}

                      {item.formatNotes && !primaryFormat && (
                        <div>
                          <span className="font-medium text-gray-600">Format:</span>
                          <span className="ml-1 text-gray-900">{item.formatNotes}</span>
                        </div>
                      )}

                      {item.content && !writingIntent && !objective && (
                        <div>
                          <span className="font-medium text-gray-600">Brief:</span>
                          <p className="mt-0.5 text-gray-900 whitespace-pre-wrap">{item.content}</p>
                        </div>
                      )}

                      {item.scheduledTime && (
                        <div>
                          <span className="font-medium text-gray-600">Best time:</span>
                          <span className="ml-1 text-gray-900">{item.scheduledTime}</span>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {targetGeo
                              ? `Research-based for ${targetGeo}; scheduling uses local time`
                              : 'Research-based for target geo; scheduling uses local time'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()
            ))
          )}
        </div>
      </div>
    </div>
  );
}
