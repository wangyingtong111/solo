import type { Cell, SheetMeta } from '../types.js';

export interface DocumentState {
  id: string;
  cells: Record<string, Cell>;
  sheets: SheetMeta[];
  version: number;
  timestamp: number;
}

export interface VersionSnapshot {
  id: string;
  docId: string;
  version: number;
  name: string;
  cells: Record<string, Cell>;
  sheets: SheetMeta[];
  createdAt: number;
  createdBy: string;
}

export interface VersionDiff {
  addedCells: Cell[];
  modifiedCells: Array<{
    cellId: string;
    oldValue: Cell;
    newValue: Cell;
  }>;
  deletedCells: string[];
  addedSheets: SheetMeta[];
  modifiedSheets: Array<{
    sheetId: string;
    oldSheet: SheetMeta;
    newSheet: SheetMeta;
  }>;
  deletedSheets: string[];
}
