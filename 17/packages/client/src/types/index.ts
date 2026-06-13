export interface User {
  id: string;
  name: string;
  color: string;
  role: 'owner' | 'editor' | 'viewer';
}

export interface CellPosition {
  sheetId: string;
  row: number;
  col: number;
}

export interface Cell {
  id: string;
  sheetId: string;
  row: number;
  col: number;
  value: string | number | boolean | null;
  formula: string | null;
  metadata: {
    userId?: string;
    updatedAt?: number;
    style?: Record<string, unknown>;
  };
}

export interface CellRange {
  sheetId: string;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

export interface SheetMeta {
  id: string;
  docId: string;
  name: string;
  rowCount: number;
  colCount: number;
  index: number;
}

export interface DocumentMeta {
  id: string;
  name: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
}

export interface VectorClock {
  [clientId: string]: number;
}

export interface PermissionRule {
  id: string;
  docId: string;
  userId: string;
  cellRange: CellRange;
  canRead: boolean;
  canEdit: boolean;
  grantedAt: number;
  grantedBy: string;
}

export interface FormulaDependency {
  cellId: string;
  dependencies: string[];
  dependents: string[];
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
  modifiedCells: Array<{ cellId: string; oldValue: Cell; newValue: Cell }>;
  deletedCells: string[];
  addedSheets: SheetMeta[];
  modifiedSheets: Array<{ sheetId: string; oldSheet: SheetMeta; newSheet: SheetMeta }>;
  deletedSheets: string[];
}

export interface WebSocketMessage {
  type: string;
  docId: string;
  clientId: string;
  data?: unknown;
  vectorClock?: VectorClock;
  timestamp?: number;
}

export interface OfflineChange {
  id: string;
  docId: string;
  clientId: string;
  eventType: string;
  payload: Record<string, unknown>;
  vectorClock: VectorClock;
  timestamp: number;
}

export interface SelectionRange {
  sheetId: string;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

export type UserColors = Record<string, string>;

export type OnlineUsers = Record<string, User>;
