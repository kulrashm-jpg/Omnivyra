'use client';

import React from 'react';
import { Plus, X } from 'lucide-react';
import type { ListBlock, ListItem, ListType } from '../../../lib/blog/blockTypes';
import { newId } from '../../../lib/blog/blockUtils';

type Props = {
  block: ListBlock;
  onChange: (block: ListBlock) => void;
};

function ListItemRow({
  item,
  index,
  depth,
  onChangeText,
  onRemove,
  onAddChild,
  onChangeChild,
  onRemoveChild,
  listType,
}: {
  item: ListItem;
  index: number;
  depth: number;
  listType: ListType;
  onChangeText: (text: string) => void;
  onRemove: () => void;
  onAddChild: () => void;
  onChangeChild: (childIndex: number, text: string) => void;
  onRemoveChild: (childIndex: number) => void;
}) {
  return (
    <div>
      <div className="flex items-start gap-2">
        <span className="mt-2.5 text-xs text-gray-400 w-4 text-right shrink-0">
          {listType === 'bullet' ? '•' : `${index + 1}.`}
        </span>
        <input
          type="text"
          value={item.text}
          onChange={(e) => onChangeText(e.target.value)}
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#3D4F61] focus:border-[#0A66C2] focus:outline-none"
          placeholder="List item…"
        />
        {depth < 1 && (
          <button
            type="button"
            onClick={onAddChild}
            className="mt-2 text-gray-400 hover:text-[#0A66C2] transition-colors"
            title="Add child item"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="mt-2 text-gray-400 hover:text-red-500"
          title="Remove"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Children — max depth 1 */}
      {item.children && item.children.length > 0 && (
        <div className="ml-6 mt-1 space-y-1">
          {item.children.map((child, ci) => (
            <div key={child.id} className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-3 text-right shrink-0">
                {listType === 'bullet' ? '–' : `${index + 1}.${ci + 1}`}
              </span>
              <input
                type="text"
                value={child.text}
                onChange={(e) => onChangeChild(ci, e.target.value)}
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#3D4F61] focus:border-[#0A66C2] focus:outline-none"
                placeholder="Child item…"
              />
              <button
                type="button"
                onClick={() => onRemoveChild(ci)}
                className="text-gray-400 hover:text-red-500"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ListBlockEditor({ block, onChange }: Props) {
  const setListType = (listType: ListType) => onChange({ ...block, listType });

  const updateItem = (index: number, text: string) => {
    const items = block.items.map((item, i) => (i === index ? { ...item, text } : item));
    onChange({ ...block, items });
  };

  const removeItem = (index: number) => {
    if (block.items.length <= 1) return;
    onChange({ ...block, items: block.items.filter((_, i) => i !== index) });
  };

  const addItem = () => {
    onChange({ ...block, items: [...block.items, { id: newId(), text: '' }] });
  };

  const addChild = (index: number) => {
    const items = block.items.map((item, i) => {
      if (i !== index) return item;
      const children = [...(item.children ?? []), { id: newId(), text: '' }];
      return { ...item, children };
    });
    onChange({ ...block, items });
  };

  const updateChild = (itemIndex: number, childIndex: number, text: string) => {
    const items = block.items.map((item, i) => {
      if (i !== itemIndex || !item.children) return item;
      const children = item.children.map((c, ci) => (ci === childIndex ? { ...c, text } : c));
      return { ...item, children };
    });
    onChange({ ...block, items });
  };

  const removeChild = (itemIndex: number, childIndex: number) => {
    const items = block.items.map((item, i) => {
      if (i !== itemIndex || !item.children) return item;
      const children = item.children.filter((_, ci) => ci !== childIndex);
      return { ...item, children };
    });
    onChange({ ...block, items });
  };

  return (
    <div className="space-y-3">
      {/* List type */}
      <div className="flex gap-2">
        {(['bullet', 'numbered'] as ListType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setListType(t)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
              block.listType === t
                ? 'bg-[#0A66C2] text-white border-[#0A66C2]'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t} list
          </button>
        ))}
      </div>

      {/* Items */}
      <div className="space-y-2">
        {block.items.map((item, i) => (
          <ListItemRow
            key={item.id}
            item={item}
            index={i}
            depth={0}
            listType={block.listType}
            onChangeText={(text) => updateItem(i, text)}
            onRemove={() => removeItem(i)}
            onAddChild={() => addChild(i)}
            onChangeChild={(ci, text) => updateChild(i, ci, text)}
            onRemoveChild={(ci) => removeChild(i, ci)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={addItem}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-500 hover:border-[#0A66C2] hover:text-[#0A66C2] transition-colors"
      >
        <Plus className="h-3.5 w-3.5" /> Add item
      </button>
    </div>
  );
}
