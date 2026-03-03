/**
 * Message composer at bottom of side panel. Input + @mention structure only.
 * Does not send; parent handles onSubmit.
 */

import React, { useState, useCallback } from 'react';

export interface ActivityMessageComposerProps {
  onSubmit: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function ActivityMessageComposer({
  onSubmit,
  placeholder = 'Add a message… (@mention structure supported)',
  disabled = false,
}: ActivityMessageComposerProps) {
  const [value, setValue] = useState('');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (!trimmed || disabled) return;
      onSubmit(trimmed);
      setValue('');
    },
    [value, disabled, onSubmit]
  );

  return (
    <form onSubmit={handleSubmit} className="border-t bg-white p-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </form>
  );
}
