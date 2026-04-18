'use client';

import React, { useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { Save, ArrowRight, Undo2 } from 'lucide-react';
import type { ContentBlock, BlockType } from '../../lib/blog/blockTypes';
import { BLOCK_LABELS } from '../../lib/blog/blockTypes';
import {
  moveBlockUp,
  moveBlockDown,
  deleteBlock,
  duplicateBlock,
  insertBlockAfter,
} from '../../lib/blog/blockUtils';
import { BlockWrapper, BlockPicker } from '../content/blocks';

type Props = {
  blocks: ContentBlock[];
  onChange: (blocks: ContentBlock[]) => void;
  onSave?: (blocks: ContentBlock[], name: string) => void;
  onUse: (blocks: ContentBlock[]) => void;
  templateName?: string;
};

/**
 * TemplateCustomizer — a structure-only block editor.
 * Users add/remove/reorder blocks but don't edit content.
 * Each block shows its type, hint (if any), and structure placeholder.
 */
export function TemplateCustomizer({ blocks, onChange, onSave, onUse, templateName }: Props) {
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [saveName, setSaveName] = useState(templateName || '');
  const [showSaveInput, setShowSaveInput] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = (event: DragStartEvent) => setActiveBlockId(event.active.id as string);

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveBlockId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = blocks.findIndex((b) => b.id === active.id);
    const newIdx = blocks.findIndex((b) => b.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    onChange(arrayMove(blocks, oldIdx, newIdx));
  };

  const handleAdd = (afterIndex: number, type: BlockType) => {
    onChange(insertBlockAfter(blocks, afterIndex, type));
  };

  const activeBlock = activeBlockId ? blocks.find((b) => b.id === activeBlockId) : null;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <p className="text-sm font-medium text-gray-700 flex-1">
          Customize layout — add, remove, or reorder blocks
        </p>
        <div className="flex gap-2">
          {onSave && (
            <>
              {showSaveInput ? (
                <div className="flex gap-1.5 items-center">
                  <input
                    type="text"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="Template name..."
                    className="w-44 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-300"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (saveName.trim()) {
                        onSave(blocks, saveName.trim());
                        setShowSaveInput(false);
                      }
                    }}
                    disabled={!saveName.trim()}
                    className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition-colors"
                  >
                    <Save className="h-3.5 w-3.5" /> Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSaveInput(false)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowSaveInput(true)}
                  className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  <Save className="h-3.5 w-3.5" /> Save as Template
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => onUse(blocks)}
            className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 transition-colors"
          >
            Use This Layout <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Block list */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          {/* Picker before first block */}
          <div className="py-1.5">
            <BlockPicker onSelect={(type) => handleAdd(-1, type)} />
          </div>

          {blocks.map((block, i) => (
            <React.Fragment key={block.id}>
              <BlockWrapper
                block={block}
                index={i}
                total={blocks.length}
                onMoveUp={() => onChange(moveBlockUp(blocks, i))}
                onMoveDown={() => onChange(moveBlockDown(blocks, i))}
                onDelete={() => onChange(deleteBlock(blocks, i))}
                onDuplicate={() => onChange(duplicateBlock(blocks, i))}
              >
                {/* Structure-only placeholder: show block type + hint */}
                <StructurePlaceholder block={block} />
              </BlockWrapper>

              {/* Picker between blocks */}
              <div className="py-1.5">
                <BlockPicker onSelect={(type) => handleAdd(i, type)} />
              </div>
            </React.Fragment>
          ))}
        </SortableContext>

        {/* Drag overlay */}
        <DragOverlay>
          {activeBlock && (
            <div className="rounded-xl border border-purple-300 bg-purple-50 px-4 py-3 shadow-lg opacity-90">
              <p className="text-xs font-semibold text-purple-700">{BLOCK_LABELS[activeBlock.type]}</p>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

/** Shows a structural placeholder for each block type — no content editing. */
function StructurePlaceholder({ block }: { block: ContentBlock }) {
  const hint = (block as any).hint;
  switch (block.type) {
    case 'columns':
      return (
        <div className={`grid gap-2 ${
          block.columnCount === 3 ? 'grid-cols-3' : block.columnCount === 2 ? 'grid-cols-2' : 'grid-cols-1'
        }`}>
          {block.columns.map((col, ci) => (
            <div key={col.id} className="rounded-lg border border-dashed border-gray-300 bg-gray-50/50 p-2 min-h-[60px]">
              <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1">Column {ci + 1}</p>
              {col.blocks.map((inner) => (
                <div key={inner.id} className="mb-1 rounded bg-white border border-gray-200 px-2 py-1">
                  <p className="text-[10px] font-medium text-gray-500">{BLOCK_LABELS[inner.type]}</p>
                  {(inner as any).hint && (
                    <p className="text-[9px] text-gray-400 italic truncate">{(inner as any).hint}</p>
                  )}
                </div>
              ))}
              {col.blocks.length === 0 && (
                <p className="text-[9px] text-gray-400 text-center py-2">Empty — add blocks here</p>
              )}
            </div>
          ))}
        </div>
      );
    default:
      return (
        <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
          {hint && <p className="text-xs text-gray-500 italic">{hint}</p>}
          {!hint && <p className="text-xs text-gray-400">({BLOCK_LABELS[block.type]} — empty placeholder)</p>}
        </div>
      );
  }
}
