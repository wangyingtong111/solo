import React, { useEffect, useRef } from 'react';
import type { Cell as CellType, CellPosition } from '../types';

interface CellProps {
  cell: CellType | null;
  position: CellPosition;
  computedValue: string | number | boolean | null;
  isSelected: boolean;
  isInSelection: boolean;
  isEditing: boolean;
  isEditable: boolean;
  editValue: string;
  width: number;
  height: number;
  top: number;
  left: number;
  onClick: (pos: CellPosition) => void;
  onDoubleClick: (pos: CellPosition) => void;
  onEditChange: (value: string) => void;
  onEditFinish: () => void;
  onEditCancel: () => void;
  onMouseEnter?: (pos: CellPosition) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

export const Cell: React.FC<CellProps> = ({
  cell,
  position,
  computedValue,
  isSelected,
  isInSelection,
  isEditing,
  isEditable,
  editValue,
  width,
  height,
  top,
  left,
  onClick,
  onDoubleClick,
  onEditChange,
  onEditFinish,
  onEditCancel,
  onMouseEnter,
  onKeyDown,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEditFinish();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onEditCancel();
    } else if (onKeyDown) {
      onKeyDown(e);
    }
  };

  const displayValue = isEditing
    ? editValue
    : cell?.formula
      ? (computedValue !== null && computedValue !== undefined ? String(computedValue) : '')
      : (cell?.value !== null && cell?.value !== undefined ? String(cell.value) : '');

  const className = [
    'sheet-cell',
    isSelected ? 'selected' : '',
    isInSelection && !isSelected ? 'in-selection' : '',
    isEditing ? 'editing' : '',
    isEditable ? 'editable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      style={{
        position: 'absolute',
        width,
        height,
        transform: `translate(${left}px, ${top}px)`,
      }}
      onClick={() => !isEditing && onClick(position)}
      onDoubleClick={() => !isEditing && onDoubleClick(position)}
      onMouseEnter={() => onMouseEnter?.(position)}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          className="cell-input"
          type="text"
          value={editValue}
          onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={handleInputKeyDown}
          onBlur={onEditFinish}
        />
      ) : (
        <span style={{ userSelect: 'none' }}>{displayValue}</span>
      )}
    </div>
  );
};
