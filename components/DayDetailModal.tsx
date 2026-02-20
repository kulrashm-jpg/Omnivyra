import React from 'react';
import { X, Target } from 'lucide-react';

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
              <div
                key={item.id}
                className="border border-gray-200 rounded-lg p-4 bg-gray-50/50 hover:bg-gray-50 transition-colors"
              >
                <div className="flex flex-wrap gap-2 mb-3">
                  <span className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded text-xs font-medium capitalize">
                    {item.platform}
                  </span>
                  <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-medium">
                    {item.contentType}
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
                </div>

                <div className="space-y-3 text-sm">
                  {/* 1. Topic — what am I writing about */}
                  {(item.topic || item.title) && (
                    <div>
                      <span className="font-medium text-gray-600">Topic:</span>
                      <p className="mt-0.5 text-gray-900 font-medium">{item.topic || item.title}</p>
                    </div>
                  )}

                  {/* 2. Topic introduction — how to open/set up the piece */}
                  {item.introObjective && (
                    <div>
                      <span className="font-medium text-gray-600">Topic introduction:</span>
                      <p className="mt-0.5 text-gray-900">{item.introObjective}</p>
                    </div>
                  )}

                  {/* 3. Subject brief — few ideas aligned to daily + weekly plan */}
                  {(item.keyPoints?.length ?? 0) > 0 && (
                    <div>
                      <span className="font-medium text-gray-600">Subject brief (ideas aligned to plan):</span>
                      <ul className="mt-0.5 list-disc list-inside text-gray-900 space-y-0.5">
                        {item.keyPoints!.map((pt, i) => (
                          <li key={i}>{pt}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 4. Message to convey */}
                  {item.objective && (
                    <div>
                      <span className="font-medium text-gray-600">Message to convey:</span>
                      <p className="mt-0.5 text-gray-900">{item.objective}</p>
                    </div>
                  )}

                  {/* 5. Tone */}
                  {item.brandVoice && (
                    <div>
                      <span className="font-medium text-gray-600">Tone:</span>
                      <span className="ml-1 text-gray-900">{item.brandVoice}</span>
                    </div>
                  )}

                  {(item.summary || item.description) && (
                    <div>
                      <span className="font-medium text-gray-600">Summary:</span>
                      <p className="mt-0.5 text-gray-900">{item.summary || item.description}</p>
                    </div>
                  )}

                  {item.cta && (
                    <div>
                      <span className="font-medium text-gray-600">Call to action:</span>
                      <p className="mt-0.5 text-gray-900">{item.cta}</p>
                    </div>
                  )}

                  {item.themeLinkage && (
                    <div>
                      <span className="font-medium text-gray-600">Alignment:</span>
                      <p className="mt-0.5 text-gray-600 text-xs">{item.themeLinkage}</p>
                    </div>
                  )}

                  {item.formatNotes && (
                    <div>
                      <span className="font-medium text-gray-600">Format:</span>
                      <span className="ml-1 text-gray-900">{item.formatNotes}</span>
                    </div>
                  )}

                  {item.content && !item.summary && !item.description && (
                    <div>
                      <span className="font-medium text-gray-600">Brief:</span>
                      <p className="mt-0.5 text-gray-900 whitespace-pre-wrap">{item.content}</p>
                    </div>
                  )}

                  {/* Best time — research-based for target geo; scheduling uses local time */}
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
            ))
          )}
        </div>
      </div>
    </div>
  );
}
