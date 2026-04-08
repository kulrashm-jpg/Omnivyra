'use client';

import React from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { Columns2, Columns3, Square } from 'lucide-react';
import type { ContentBlock, ColumnsBlock } from '../../../lib/blog/blockTypes';
import {
  createBlock,
  newId,
  deleteBlock,
  duplicateBlock,
  moveBlockUp,
  moveBlockDown,
} from '../../../lib/blog/blockUtils';
import { setColumnCount } from '../../../lib/blog/blockUtils';
import { BlockPicker } from './BlockPicker';
import { BlockWrapper } from './BlockWrapper';

type Props = {
  block: ColumnsBlock;
  onChange: (block: ColumnsBlock) => void;
  /** Render function for inner block editors, provided by the parent form. */
  renderBlock: (block: ContentBlock, onChange: (b: ContentBlock) => void) => React.ReactNode;
};

const COLUMN_OPTIONS: { count: 1 | 2 | 3; label: string; Icon: typeof Square }[] = [
  { count: 1, label: '1 Col', Icon: Square },
  { count: 2, label: '2 Col', Icon: Columns2 },
  { count: 3, label: '3 Col', Icon: Columns3 },
];

// ── Single column cell ───────────────────────────────────────────────────────

function ColumnCell({
  colIndex,
  blocks,
  onBlocksChange,
  renderBlock,
}: {
  colIndex: number;
  blocks: ContentBlock[];
  onBlocksChange: (blocks: ContentBlock[]) => void;
  renderBlock: Props['renderBlock'];
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = blocks.findIndex((b) => b.id === active.id);
    const newIdx = blocks.findIndex((b) => b.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    onBlocksChange(arrayMove(blocks, oldIdx, newIdx));
  };

  const handleInnerChange = (idx: number, updated: ContentBlock) => {
    const next = [...blocks];
    next[idx] = updated;
    onBlocksChange(next);
  };

  const handleAdd = (_afterIndex: number, type: ContentBlock['type']) => {
    const newBlock = createBlock(type);
    const next = [...blocks];
    next.splice(_afterIndex + 1, 0, newBlock);
    onBlocksChange(next);
  };

  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/50 p-2 min-h-[80px]">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 px-1">
        Column {colIndex + 1}
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={blocks.map((b) => b.id)}
          strategy={verticalListSortingStrategy}
        >
          {blocks.map((innerBlock, i) => (
            <React.Fragment key={innerBlock.id}>
              <BlockWrapper
                block={innerBlock}
                index={i}
                total={blocks.length}
                onMoveUp={() => onBlocksChange(moveBlockUp(blocks, i))}
                onMoveDown={() => onBlocksChange(moveBlockDown(blocks, i))}
                onDelete={() => onBlocksChange(deleteBlock(blocks, i))}
                onDuplicate={() => onBlocksChange(duplicateBlock(blocks, i))}
              >
                {renderBlock(innerBlock, (updated) => handleInnerChange(i, updated))}
              </BlockWrapper>

              {/* BlockPicker between blocks */}
              <div className="py-1">
                <BlockPicker
                  onSelect={(type) => handleAdd(i, type)}
                  excludeTypes={['columns']}
                />
              </div>
            </React.Fragment>
          ))}
        </SortableContext>
      </DndContext>

      {/* BlockPicker for empty columns or at the start */}
      {blocks.length === 0 && (
        <div className="py-2">
          <BlockPicker
            onSelect={(type) => handleAdd(-1, type)}
            excludeTypes={['columns']}
          />
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function ColumnsBlockEditor({ block, onChange, renderBlock }: Props) {
  const handleColumnCountChange = (count: 1 | 2 | 3) => {
    onChange(setColumnCount(block, count));
  };

  const handleCellBlocksChange = (colIndex: number, blocks: ContentBlock[]) => {
    const next = block.columns.map((col, i) =>
      i === colIndex ? { ...col, blocks } : col,
    );
    onChange({ ...block, columns: next });
  };

  const gridClass =
    block.columnCount === 3
      ? 'grid-cols-1 md:grid-cols-3'
      : block.columnCount === 2
        ? 'grid-cols-1 md:grid-cols-2'
        : 'grid-cols-1';

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-1 mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mr-2">
          Layout
        </span>
        {COLUMN_OPTIONS.map(({ count, label, Icon }) => (
          <button
            key={count}
            type="button"
            onClick={() => handleColumnCountChange(count)}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              block.columnCount === count
                ? 'bg-cyan-100 text-cyan-800 ring-1 ring-cyan-300'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Column grid */}
      <div className={`grid ${gridClass} gap-3`}>
        {block.columns.map((col, i) => (
          <ColumnCell
            key={col.id}
            colIndex={i}
            blocks={col.blocks}
            onBlocksChange={(blocks) => handleCellBlocksChange(i, blocks)}
            renderBlock={renderBlock}
          />
        ))}
      </div>
    </div>
  );
}
