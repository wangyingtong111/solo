export enum EventType {
  DOCUMENT_CREATED = 'DOCUMENT_CREATED',
  DOCUMENT_UPDATED = 'DOCUMENT_UPDATED',
  DOCUMENT_DELETED = 'DOCUMENT_DELETED',
  SHEET_CREATED = 'SHEET_CREATED',
  SHEET_UPDATED = 'SHEET_UPDATED',
  SHEET_DELETED = 'SHEET_DELETED',
  CELL_UPDATED = 'CELL_UPDATED',
  CELL_FORMULA_UPDATED = 'CELL_FORMULA_UPDATED',
  CELL_STYLE_UPDATED = 'CELL_STYLE_UPDATED',
  PERMISSION_GRANTED = 'PERMISSION_GRANTED',
  PERMISSION_REVOKED = 'PERMISSION_REVOKED',
  SNAPSHOT_CREATED = 'SNAPSHOT_CREATED',
}

export interface VectorClock {
  [nodeId: string]: number;
}

export interface BaseEvent {
  id: string;
  docId: string;
  eventType: EventType;
  cellId?: string;
  userId: string;
  timestamp: number;
  payload: Record<string, unknown>;
  vectorClock: VectorClock;
  sequence?: number;
}

export interface DocumentCreatedPayload {
  title: string;
  ownerId: string;
  createdAt: number;
}

export interface DocumentUpdatedPayload {
  title?: string;
  updatedAt: number;
}

export interface DocumentDeletedPayload {
  deletedAt: number;
  deletedBy: string;
}

export interface SheetCreatedPayload {
  sheetId: string;
  name: string;
  index: number;
}

export interface SheetUpdatedPayload {
  sheetId: string;
  name?: string;
  index?: number;
}

export interface SheetDeletedPayload {
  sheetId: string;
}

export interface CellUpdatedPayload {
  sheetId: string;
  cellId: string;
  value: string | number | boolean | null;
  oldValue?: string | number | boolean | null;
}

export interface CellFormulaUpdatedPayload {
  sheetId: string;
  cellId: string;
  formula: string | null;
  oldFormula?: string | null;
}

export interface CellStyleUpdatedPayload {
  sheetId: string;
  cellId: string;
  style: Record<string, unknown>;
  oldStyle?: Record<string, unknown>;
}

export interface PermissionGrantedPayload {
  userId: string;
  role: 'owner' | 'editor' | 'viewer';
  grantedAt: number;
}

export interface PermissionRevokedPayload {
  userId: string;
  revokedAt: number;
  revokedBy: string;
}

export interface SnapshotCreatedPayload {
  version: number;
  snapshotData: Record<string, unknown>;
  createdAt: number;
}

export type EventPayload =
  | DocumentCreatedPayload
  | DocumentUpdatedPayload
  | DocumentDeletedPayload
  | SheetCreatedPayload
  | SheetUpdatedPayload
  | SheetDeletedPayload
  | CellUpdatedPayload
  | CellFormulaUpdatedPayload
  | CellStyleUpdatedPayload
  | PermissionGrantedPayload
  | PermissionRevokedPayload
  | SnapshotCreatedPayload;

export interface Event<T extends EventPayload = EventPayload> extends Omit<BaseEvent, 'payload'> {
  payload: T;
}

export interface Document {
  id: string;
  title: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  version: number;
}

export interface Sheet {
  id: string;
  docId: string;
  name: string;
  index: number;
  createdAt: number;
  updatedAt: number;
}

export interface Permission {
  id: string;
  docId: string;
  userId: string;
  role: 'owner' | 'editor' | 'viewer';
  grantedAt: number;
  revokedAt?: number;
}

export interface Snapshot {
  id: string;
  docId: string;
  version: number;
  snapshotData: Record<string, unknown>;
  createdAt: number;
}
