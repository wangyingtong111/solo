import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cell } from './Cell';
import { useAppStore } from '../store/useAppStore';
import { usePermissionStore } from '../store/usePermissionStore';
import type { CellPosition, SelectionRange } from '../types';

const ROW_HEIGHT = 28;
const COL_WIDTH = 100;
const ROW_HEADER_WIDTH = 48;
const COL_HEADER_HEIGHT = 28;
const DEFAULT_ROW_COUNT = 100;
const DEFAULT_COL_COUNT = 26;
const BUFFER_ROWS = 5;
const BUFFER_COLS = 2;

const getColumnLetter = (col: number): string => {
  let result = '';
  let n = col;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
};

const getCellId = (sheetId: string, row: number, col: number): string =>
  `${sheetId}:${row}:${col}`;

const isCellInSelection = (
  row: number,
  col: number,
  selection: SelectionRange | null
): boolean => {
  if (!selection) return false;
  const startRow = Math.min(selection.startRow, selection.endRow);
  const endRow = Math.max(selection.startRow, selection.endRow);
  const startCol = Math.min(selection.startCol, selection.endCol);
  const endCol = Math.max(selection.startCol, selection.endCol);
  return row >= startRow && row <= endRow && col >= startCol && col <= endCol;
};

export const SpreadsheetGrid: React.FC = () => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [viewportWidth, setViewportWidth] = useState(800);
  const isMouseDownRef = useRef(false);
  const extendSelectionRef = useRef(false);

  const {
    sheets,
    activeSheetId,
    cells,
    computedValues,
    selectedCell,
    selection,
    editingCell,
    editValue,
    presences,
    selectCell,
    setSelection,
    startEditing,
    setEditValue,
    finishEditing,
    cancelEditing,
  } = useAppStore();

  const { canEditCell, editableRanges, currentUser, allUsers } = usePermissionStore();

  const activeSheet = sheets.find((s) => s.id === activeSheetId);
  const rowCount = activeSheet?.rowCount ?? DEFAULT_ROW_COUNT;
  const colCount = activeSheet?.colCount ?? DEFAULT_COL_COUNT;

  const totalWidth = ROW_HEADER_WIDTH + colCount * COL_WIDTH;
  const totalHeight = COL_HEADER_HEIGHT + rowCount * ROW_HEIGHT;

  useEffect(() => {
    const updateSize = () => {
      if (viewportRef.current) {
        setViewportHeight(viewportRef.current.clientHeight);
        setViewportWidth(viewportRef.current.clientWidth);
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const visibleStartRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
  const visibleEndRow = Math.min(
    rowCount - 1,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER_ROWS
  );
  const visibleStartCol = Math.max(0, Math.floor(scrollLeft / COL_WIDTH) - BUFFER_COLS);
  const visibleEndCol = Math.min(
    colCount - 1,
    Math.ceil((scrollLeft + viewportWidth) / COL_WIDTH) + BUFFER_COLS
  );

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
    setScrollLeft(e.currentTarget.scrollLeft);
  }, []);

  const navigateCell = useCallback(
    (deltaRow: number, deltaCol: number, extendSelection: boolean = false) => {
      if (!activeSheetId || !selectedCell) return;
      if (editingCell) {
        finishEditing();
      }
      const newRow = Math.max(0, Math.min(rowCount - 1, selectedCell.row + deltaRow));
      const newCol = Math.max(0, Math.min(colCount - 1, selectedCell.col + deltaCol));
      const newPos: CellPosition = { sheetId: activeSheetId, row: newRow, col: newCol };

      if (extendSelection && selection) {
        setSelection({
          sheetId: activeSheetId,
          startRow: selection.startRow,
          startCol: selection.startCol,
          endRow: newRow,
          endCol: newCol,
        });
      } else {
        selectCell(newPos);
      }

      const targetTop = newRow * ROW_HEIGHT;
      const targetLeft = newCol * COL_WIDTH;
      const viewport = viewportRef.current;
      if (viewport) {
        if (targetTop < scrollTop) {
          viewport.scrollTop = targetTop;
        } else if (targetTop + ROW_HEIGHT > scrollTop + viewportHeight - COL_HEADER_HEIGHT) {
          viewport.scrollTop = targetTop + ROW_HEIGHT - viewportHeight + COL_HEADER_HEIGHT;
        }
        if (targetLeft < scrollLeft) {
          viewport.scrollLeft = targetLeft;
        } else if (targetLeft + COL_WIDTH > scrollLeft + viewportWidth - ROW_HEADER_WIDTH) {
          viewport.scrollLeft = targetLeft + COL_WIDTH - viewportWidth + ROW_HEADER_WIDTH;
        }
      }
    },
    [
      activeSheetId,
      selectedCell,
      editingCell,
      rowCount,
      colCount,
      selection,
      scrollTop,
      scrollLeft,
      viewportHeight,
      viewportWidth,
      selectCell,
      setSelection,
      finishEditing,
    ]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!activeSheetId) return;
      const isEditing = editingCell !== null;

      if (isEditing) {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelEditing();
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finishEditing();
          navigateCell(1, 0, false);
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          finishEditing();
          navigateCell(0, e.shiftKey ? -1 : 1, false);
          return;
        }
        return;
      }

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          navigateCell(-1, 0, e.shiftKey);
          break;
        case 'ArrowDown':
          e.preventDefault();
          navigateCell(1, 0, e.shiftKey);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          navigateCell(0, -1, e.shiftKey);
          break;
        case 'ArrowRight':
          e.preventDefault();
          navigateCell(0, 1, e.shiftKey);
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedCell) {
            startEditing(selectedCell);
          }
          break;
        case 'F2':
          e.preventDefault();
          if (selectedCell) {
            startEditing(selectedCell);
          }
          break;
        case 'Tab':
          e.preventDefault();
          navigateCell(0, e.shiftKey ? -1 : 1, e.shiftKey);
          break;
        case 'Escape':
          e.preventDefault();
          if (selectedCell) {
            selectCell(selectedCell);
          }
          break;
        default:
          if (selectedCell && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
            e.preventDefault();
            startEditing(selectedCell, e.key);
          }
          break;
      }
    },
    [activeSheetId, editingCell, selectedCell, navigateCell, startEditing, finishEditing, cancelEditing, selectCell]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleCellClick = useCallback(
    (pos: CellPosition) => {
      if (extendSelectionRef.current && selection) {
        setSelection({
          sheetId: pos.sheetId,
          startRow: selection.startRow,
          startCol: selection.startCol,
          endRow: pos.row,
          endCol: pos.col,
        });
      } else {
        selectCell(pos);
      }
    },
    [selection, selectCell, setSelection]
  );

  const handleCellDoubleClick = useCallback(
    (pos: CellPosition) => {
      if (canEditCell(pos.sheetId, pos.row, pos.col)) {
        startEditing(pos);
      }
    },
    [canEditCell, startEditing]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isMouseDownRef.current = true;
      extendSelectionRef.current = e.shiftKey;
    },
    []
  );

  const handleMouseUp = useCallback(() => {
    isMouseDownRef.current = false;
    extendSelectionRef.current = false;
  }, []);

  const handleCellMouseEnter = useCallback(
    (pos: CellPosition) => {
      if (isMouseDownRef.current && selection) {
        setSelection({
          sheetId: pos.sheetId,
          startRow: selection.startRow,
          startCol: selection.startCol,
          endRow: pos.row,
          endCol: pos.col,
        });
      }
    },
    [selection, setSelection]
  );

  const isCellEditable = useCallback(
    (row: number, col: number): boolean => {
      if (!activeSheetId) return false;
      return canEditCell(activeSheetId, row, col);
    },
    [activeSheetId, canEditCell]
  );

  const getUserColor = useCallback(
    (userId: string): string => {
      const user = allUsers.find((u) => u.id === userId);
      return user?.color ?? '#1a73e8';
    },
    [allUsers]
  );

  const getUserName = useCallback(
    (userId: string): string => {
      const user = allUsers.find((u) => u.id === userId);
      return user?.name ?? 'Unknown';
    },
    [allUsers]
  );

  const remotePresences = useMemo(
    () =>
      presences.filter(
        (p) => p.online && p.user && p.user.id !== currentUser?.id && p.cursor && p.cursor.sheetId === activeSheetId
      ),
    [presences, currentUser, activeSheetId]
  );

  const editableHighlights = useMemo(() => {
    if (!activeSheetId) return [];
    return editableRanges
      .filter((r) => r.sheetId === activeSheetId)
      .map((range, idx) => {
        const colors = ['#1a73e8', '#34a853', '#fbbc04', '#ea4335', '#a142f4'];
        return {
          range,
          color: colors[idx % colors.length],
          top: COL_HEADER_HEIGHT + range.startRow * ROW_HEIGHT,
          left: ROW_HEADER_WIDTH + range.startCol * COL_WIDTH,
          width: (range.endCol - range.startCol + 1) * COL_WIDTH,
          height: (range.endRow - range.startRow + 1) * ROW_HEIGHT,
        };
      });
  }, [activeSheetId, editableRanges]);

  const colHeaders = [];
  for (let col = visibleStartCol; col <= visibleEndCol; col++) {
    colHeaders.push(
      <div
        key={`col-${col}`}
        className="header-cell"
        style={{
          position: 'absolute',
          width: COL_WIDTH,
          height: COL_HEADER_HEIGHT,
          transform: `translate(${ROW_HEADER_WIDTH + col * COL_WIDTH - scrollLeft}px, ${-scrollTop}px)`,
          top: 0,
          left: 0,
          zIndex: 10,
        }}
      >
        {getColumnLetter(col)}
      </div>
    );
  }

  const rowHeaders = [];
  for (let row = visibleStartRow; row <= visibleEndRow; row++) {
    rowHeaders.push(
      <div
        key={`row-${row}`}
        className="header-cell"
        style={{
          position: 'absolute',
          width: ROW_HEADER_WIDTH,
          height: ROW_HEIGHT,
          transform: `translate(${-scrollLeft}px, ${COL_HEADER_HEIGHT + row * ROW_HEIGHT - scrollTop}px)`,
          top: 0,
          left: 0,
          zIndex: 20,
        }}
      >
        {row + 1}
      </div>
    );
  }

  const cellElements = [];
  if (activeSheetId) {
    for (let row = visibleStartRow; row <= visibleEndRow; row++) {
      for (let col = visibleStartCol; col <= visibleEndCol; col++) {
        const cellId = getCellId(activeSheetId, row, col);
        const cellData = cells[cellId] ?? null;
        const computedVal = computedValues[cellId] ?? null;
        const isSelected =
          selectedCell?.sheetId === activeSheetId &&
          selectedCell?.row === row &&
          selectedCell?.col === col;
        const isInSelection = isCellInSelection(row, col, selection);
        const isEditing =
          editingCell?.sheetId === activeSheetId &&
          editingCell?.row === row &&
          editingCell?.col === col;

        cellElements.push(
          <Cell
            key={cellId}
            cell={cellData}
            position={{ sheetId: activeSheetId, row, col }}
            computedValue={computedVal}
            isSelected={isSelected}
            isInSelection={isInSelection}
            isEditing={isEditing}
            isEditable={isCellEditable(row, col)}
            editValue={isEditing ? editValue : ''}
            width={COL_WIDTH}
            height={ROW_HEIGHT}
            top={COL_HEADER_HEIGHT + row * ROW_HEIGHT}
            left={ROW_HEADER_WIDTH + col * COL_WIDTH}
            onClick={handleCellClick}
            onDoubleClick={handleCellDoubleClick}
            onEditChange={setEditValue}
            onEditFinish={finishEditing}
            onEditCancel={cancelEditing}
            onMouseEnter={handleCellMouseEnter}
          />
        );
      }
    }
  }

  const presenceElements = remotePresences.map((p) => {
    if (!p.cursor || p.cursor.sheetId !== activeSheetId) return null;
    const top = COL_HEADER_HEIGHT + p.cursor.row * ROW_HEIGHT;
    const left = ROW_HEADER_WIDTH + p.cursor.col * COL_WIDTH;
    const color = getUserColor(p.user.id);

    return (
      <React.Fragment key={p.clientId}>
        <div
          className="remote-cursor"
          style={{ top, left, height: ROW_HEIGHT, backgroundColor: color }}
        >
          <div className="remote-cursor-label" style={{ backgroundColor: color }}>
            {getUserName(p.user.id)}
          </div>
        </div>
        {p.selection && p.selection.sheetId === activeSheetId && (
          <div
            className="remote-selection"
            style={{
              top: COL_HEADER_HEIGHT + Math.min(p.selection.startRow, p.selection.endRow) * ROW_HEIGHT,
              left: ROW_HEADER_WIDTH + Math.min(p.selection.startCol, p.selection.endCol) * COL_WIDTH,
              width: (Math.abs(p.selection.endCol - p.selection.startCol) + 1) * COL_WIDTH,
              height: (Math.abs(p.selection.endRow - p.selection.startRow) + 1) * ROW_HEIGHT,
              backgroundColor: color,
              borderColor: color,
            }}
          />
        )}
      </React.Fragment>
    );
  });

  return (
    <div
      className="spreadsheet-container"
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    >
      <div
        ref={viewportRef}
        className="spreadsheet-viewport scrollbar-thin"
        onScroll={handleScroll}
      >
        <div
          className="spreadsheet-canvas"
          style={{ width: totalWidth, height: totalHeight }}
        >
          <div
            className="corner-header header-cell"
            style={{
              position: 'absolute',
              width: ROW_HEADER_WIDTH,
              height: COL_HEADER_HEIGHT,
              transform: `translate(${-scrollLeft}px, ${-scrollTop}px)`,
              top: 0,
              left: 0,
              zIndex: 30,
            }}
          />
          {colHeaders}
          {rowHeaders}
          {editableHighlights.map((h, idx) => (
            <div
              key={`highlight-${idx}`}
              style={{
                position: 'absolute',
                top: h.top - scrollTop,
                left: h.left - scrollLeft,
                width: h.width,
                height: h.height,
                border: `2px solid ${h.color}`,
                borderRadius: 2,
                opacity: 0.2,
                pointerEvents: 'none',
                zIndex: 3,
              }}
            />
          ))}
          {cellElements}
          {presenceElements}
        </div>
      </div>
    </div>
  );
};
