import type { Cell, CellRange } from '../types.js';

export type DocumentRole = 'owner' | 'editor' | 'viewer';

export interface CellPermissionRule {
  id: string;
  docId: string;
  userId: string;
  cellRange: CellRange;
  canRead: boolean;
  canEdit: boolean;
  grantedAt: number;
  grantedBy: string;
}

export interface DocumentRoleRule {
  id: string;
  docId: string;
  userId: string;
  role: DocumentRole;
  grantedAt: number;
  grantedBy: string;
}

export interface UserCellPermissions {
  userId: string;
  docId: string;
  editableRanges: CellRange[];
  readableRanges: CellRange[];
}

export interface PermissionFilterResult {
  allowedCells: Cell[];
  deniedCells: Cell[];
}
